import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { pathExists, readTextFile, safeResolvePath } from "../lib/fs-utils.js";
import { ensureRunWorktree, isWorktreeDirty, listCommits, readCurrentCommitHash, resetWorktreeToCommit } from "../lib/git-versioning.js";
import { logInfo, logWarn, serializeError } from "../lib/logging.js";
import { appendLearningJsonl, writeSnapshot, writeStubDebtArtifact } from "../learning/learning-writer.js";
import { summarizeStubDebt } from "../learning/stub-debt.js";
import { getTemplate, getTemplateValidationProfile } from "../templates/catalog.js";
import { AgentExecutor } from "./executor.js";
import { classifyFailureForCorrection } from "./correction/failure-classifier.js";
import { evaluateCorrectionPolicy } from "./correction/policy-engine.js";
import { FileSession } from "./fs/file-session.js";
import { proposedFileChangeSchema } from "./fs/types.js";
import { dispatchValidationForProfile } from "./validation/profile-dispatcher.js";
import { classifyPrecommitInvariantFailure, classifyValidationFailure } from "./validation/validation-failure-classifier.js";
import { runLightProjectValidation } from "./validation/project-validator.js";
import { isPrecommitInvariantResult, runPrecommitInvariantGuard } from "./validation/precommit-invariant-guard.js";
import { analyzeProjectForMemory } from "./memory.js";
import { AgentPlanner } from "./planner.js";
import { isExecutingAgentRunStatus } from "./run-status.js";
import { createDefaultAgentToolRegistry } from "./tools/index.js";
import { withAgentPlanCapabilities } from "./types.js";
function truncateText(value, maxLength) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return normalized.slice(0, maxLength);
}
function tailText(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return value.slice(value.length - maxLength);
}
async function runValidationForTemplateProfile(input) {
    const template = getTemplate(input.templateId);
    const profile = getTemplateValidationProfile(input.templateId);
    return dispatchValidationForProfile({
        profile,
        templateType: template.type,
        projectRoot: input.projectRoot,
        ref: input.ref
    });
}
function toStepExecution(step) {
    return {
        stepId: step.stepId,
        tool: step.tool,
        type: step.type,
        status: step.status,
        input: step.inputPayload,
        output: step.outputPayload,
        error: step.errorMessage || undefined,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt
    };
}
function attachLastStep(run, steps) {
    if (!steps.length) {
        return run;
    }
    const preferred = run.lastStepId ? steps.find((step) => step.id === run.lastStepId) : undefined;
    const fallback = steps[steps.length - 1];
    const resolved = preferred || fallback;
    return {
        ...run,
        lastStepId: resolved.id,
        lastStep: toStepExecution(resolved)
    };
}
function coerceRuntimeStatus(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "healthy" || normalized === "ok" || normalized === "passed" || normalized === "success") {
        return "healthy";
    }
    if (normalized === "failed" || normalized === "unhealthy" || normalized === "error") {
        return "failed";
    }
    return null;
}
function normalizeStepId(base, suffix) {
    const safeBase = base.replace(/[^a-zA-Z0-9-_.]/g, "-");
    const safeSuffix = suffix.replace(/[^a-zA-Z0-9-_.]/g, "-");
    const maxBaseLength = Math.max(1, 80 - safeSuffix.length - 1);
    return `${safeBase.slice(0, maxBaseLength)}-${safeSuffix}`;
}
const MAX_VALIDATION_AUTO_CORRECTION_ATTEMPTS = 2;
const MAX_PRECOMMIT_INVARIANT_RETRIES_PER_ATTEMPT = 3;
const IMPORT_RESOLUTION_GUARDRAIL_WINDOW = 20;
const IMPORT_RESOLUTION_GUARDRAIL_MIN_COUNT = 5;
const IMPORT_RESOLUTION_GUARDRAIL_MIN_REGRESSION_RATE = 0.25;
const MICRO_TARGETED_STALL_WINDOW = 20;
const MICRO_TARGETED_STALL_MIN_RUNS = 8;
const MICRO_TARGETED_STALL_MIN_RATE = 0.5;
const MICRO_TARGETED_STALL_ESCALATION_LIMIT = 1;
const MICRO_TARGETED_STALL_RECONSTRUCTION_LIMIT = 2;
const DEEPRUN_STUB_MARKER_PREFIX = "// @deeprun-stub ";
export class AgentKernel {
    planner;
    executor;
    store;
    constructor(input) {
        this.store = input.store;
        this.planner = input.planner ?? new AgentPlanner();
        this.executor = input.executor ?? new AgentExecutor(createDefaultAgentToolRegistry({ providers: input.providers }));
    }
    resolveMaxRuntimeCorrectionAttempts() {
        const parsed = Number(process.env.AGENT_GOAL_MAX_CORRECTIONS || process.env.AGENT_RUNTIME_MAX_CORRECTIONS || 5);
        if (!Number.isFinite(parsed)) {
            return 5;
        }
        return Math.min(5, Math.max(0, Math.floor(parsed)));
    }
    resolveMaxHeavyCorrectionAttempts() {
        const parsed = Number(process.env.AGENT_OPTIMIZATION_MAX_CORRECTIONS || process.env.AGENT_HEAVY_MAX_CORRECTIONS || 3);
        if (!Number.isFinite(parsed)) {
            return 3;
        }
        return Math.min(3, Math.max(0, Math.floor(parsed)));
    }
    parseExecutionValidationMode(value) {
        if (value === "off" || value === "warn" || value === "enforce") {
            return value;
        }
        return null;
    }
    parseExecutionProfile(value) {
        if (value === "full" || value === "ci" || value === "smoke") {
            return value;
        }
        return null;
    }
    parseBoundedInt(value, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return null;
        }
        return Math.min(max, Math.max(min, Math.floor(parsed)));
    }
    resolvePlannerTimeoutMs() {
        const parsed = Number(process.env.DEEPRUN_PLANNER_TIMEOUT_MS || 120_000);
        if (!Number.isFinite(parsed)) {
            return 120_000;
        }
        return Math.min(300_000, Math.max(1_000, Math.floor(parsed)));
    }
    executionConfigPreset(profile) {
        switch (profile) {
            case "ci":
                return {
                    lightValidationMode: "off",
                    heavyValidationMode: "off",
                    maxRuntimeCorrectionAttempts: 0,
                    maxHeavyCorrectionAttempts: 0,
                    correctionPolicyMode: "warn",
                    correctionConvergenceMode: "warn",
                    plannerTimeoutMs: 5_000
                };
            case "smoke":
                return {
                    lightValidationMode: "warn",
                    heavyValidationMode: "warn",
                    maxRuntimeCorrectionAttempts: 1,
                    maxHeavyCorrectionAttempts: 1,
                    correctionPolicyMode: "warn",
                    correctionConvergenceMode: "warn",
                    plannerTimeoutMs: 10_000
                };
            case "full":
            default:
                return {};
        }
    }
    resolveExecutionConfig(input) {
        const metadata = this.toRecord(input?.metadata);
        const metadataExecutionConfig = this.toRecord(metadata?.executionConfig);
        const overrideExecutionConfig = input?.executionConfig && typeof input.executionConfig === "object" ? input.executionConfig : null;
        const rawConfig = overrideExecutionConfig || metadataExecutionConfig || {};
        const profile = this.parseExecutionProfile(rawConfig.profile) || "full";
        const resolved = {
            profile,
            lightValidationMode: this.resolveLightValidationMode(),
            heavyValidationMode: this.resolveHeavyValidationMode(),
            maxRuntimeCorrectionAttempts: this.resolveMaxRuntimeCorrectionAttempts(),
            maxHeavyCorrectionAttempts: this.resolveMaxHeavyCorrectionAttempts(),
            correctionPolicyMode: this.resolveCorrectionPolicyMode(),
            correctionConvergenceMode: this.resolveCorrectionConvergenceMode(),
            plannerTimeoutMs: this.resolvePlannerTimeoutMs(),
            ...this.executionConfigPreset(profile)
        };
        const lightValidationMode = this.parseExecutionValidationMode(rawConfig.lightValidationMode);
        if (lightValidationMode) {
            resolved.lightValidationMode = lightValidationMode;
        }
        const heavyValidationMode = this.parseExecutionValidationMode(rawConfig.heavyValidationMode);
        if (heavyValidationMode) {
            resolved.heavyValidationMode = heavyValidationMode;
        }
        const correctionPolicyMode = this.parseExecutionValidationMode(rawConfig.correctionPolicyMode);
        if (correctionPolicyMode) {
            resolved.correctionPolicyMode = correctionPolicyMode;
        }
        const correctionConvergenceMode = this.parseExecutionValidationMode(rawConfig.correctionConvergenceMode);
        if (correctionConvergenceMode) {
            resolved.correctionConvergenceMode = correctionConvergenceMode;
        }
        const maxRuntimeCorrectionAttempts = this.parseBoundedInt(rawConfig.maxRuntimeCorrectionAttempts, 0, 5);
        if (maxRuntimeCorrectionAttempts !== null) {
            resolved.maxRuntimeCorrectionAttempts = maxRuntimeCorrectionAttempts;
        }
        const maxHeavyCorrectionAttempts = this.parseBoundedInt(rawConfig.maxHeavyCorrectionAttempts, 0, 3);
        if (maxHeavyCorrectionAttempts !== null) {
            resolved.maxHeavyCorrectionAttempts = maxHeavyCorrectionAttempts;
        }
        const plannerTimeoutMs = this.parseBoundedInt(rawConfig.plannerTimeoutMs, 1_000, 300_000);
        if (plannerTimeoutMs !== null) {
            resolved.plannerTimeoutMs = plannerTimeoutMs;
        }
        if ((input?.executionProfile || "default") === "builder") {
            resolved.lightValidationMode = "off";
            resolved.heavyValidationMode = "off";
        }
        return resolved;
    }
    withExecutionConfigMetadata(metadata, executionConfig) {
        return {
            ...(this.toRecord(metadata) || {}),
            executionConfig
        };
    }
    isMutatingStep(step) {
        return step.mutates === true;
    }
    isRuntimeVerifyStep(step) {
        return step.type === "verify" && step.tool === "run_preview_container";
    }
    isCorrectionStep(step) {
        return step.id.startsWith("runtime-correction-") || step.id.startsWith("validation-correction-");
    }
    async ensurePlanCapabilitiesPersisted(run) {
        const normalizedPlan = withAgentPlanCapabilities(run.plan);
        const changed = normalizedPlan.steps.some((step, index) => step.mutates !== run.plan.steps[index]?.mutates);
        if (!changed) {
            return run;
        }
        return (await this.store.updateAgentRun(run.id, { plan: normalizedPlan })) || {
            ...run,
            plan: normalizedPlan
        };
    }
    commitMessageForStep(_runId, _stepIndex, step, goal) {
        const goalSummary = truncateText(goal, 64);
        return `${step.id} (${step.tool}) :: ${goalSummary}`;
    }
    extractProposedChanges(output) {
        const raw = output.proposedChanges;
        if (!Array.isArray(raw)) {
            throw new Error("Mutating steps must return proposedChanges[].");
        }
        return raw.map((entry) => proposedFileChangeSchema.parse(entry));
    }
    runtimeVerificationOutcome(input) {
        const explicitStatus = coerceRuntimeStatus(input.output.runtimeStatus);
        const startupOk = input.output.startupOk === true;
        const runtimeStatus = explicitStatus || (startupOk ? "healthy" : input.status === "completed" ? "failed" : "failed");
        const logBlock = typeof input.output.logs === "string" && input.output.logs
            ? input.output.logs
            : JSON.stringify(input.output, null, 2);
        if (runtimeStatus === "healthy") {
            return {
                runtimeStatus,
                ok: true,
                reason: null,
                logs: tailText(logBlock || "", 16_000)
            };
        }
        const outputReason = typeof input.output.errorMessage === "string" && input.output.errorMessage.trim()
            ? input.output.errorMessage.trim()
            : null;
        return {
            runtimeStatus,
            ok: false,
            reason: outputReason || input.errorMessage || "Runtime verification failed.",
            logs: tailText(logBlock || "", 16_000)
        };
    }
    countRuntimeCorrectionSteps(plan) {
        return plan.steps.filter((step) => step.id.startsWith("runtime-correction-")).length;
    }
    countHeavyCorrectionSteps(plan) {
        return plan.steps.filter((step) => step.id.startsWith("validation-correction-")).length;
    }
    runtimeFailureSignature(reason, logs) {
        const reasonPart = truncateText(reason || "runtime-failure", 240).toLowerCase();
        const logsPart = tailText(logs || "", 2_000).toLowerCase();
        return `${reasonPart}::${logsPart}`;
    }
    buildStepFailureDetails(input) {
        const transactionError = this.toRecord(input.output.transactionError);
        const heavyValidationError = this.toRecord(input.output.heavyValidationError);
        const heavyValidation = this.toRecord(input.output.heavyValidation);
        const correctionPolicy = this.toRecord(input.output.correctionPolicy);
        const runtimeConvergence = this.toRecord(input.output.runtimeConvergence);
        const heavyValidationConvergence = heavyValidation ? this.toRecord(heavyValidation.convergence) : null;
        let category = "step_execution";
        if (transactionError || String(input.errorMessage || "").startsWith("Step transaction failed:")) {
            category = "step_transaction";
        }
        else if (heavyValidationError) {
            category = "heavy_validation_execution";
        }
        else if (heavyValidation && heavyValidation.ok === false) {
            category = "heavy_validation";
        }
        else if (this.isRuntimeVerifyStep(input.step)) {
            category = "runtime_verification";
        }
        else if (correctionPolicy &&
            typeof input.errorMessage === "string" &&
            input.errorMessage.startsWith("Correction policy violation:")) {
            category = "correction_policy";
        }
        const details = {
            version: 1,
            source: "agent_kernel",
            category,
            runId: input.run.id,
            stepId: input.step.id,
            stepType: input.step.type,
            tool: input.step.tool,
            stepIndex: input.stepIndex,
            errorMessage: input.errorMessage || "Agent step failed.",
            runtimeStatus: input.runtimeStatus,
            createdAt: input.finishedAt
        };
        if (input.runtimeLogs) {
            details.runtimeLogTail = tailText(input.runtimeLogs, 4_000);
        }
        if (transactionError) {
            details.transactionError = transactionError;
        }
        if (heavyValidationError) {
            details.heavyValidationError = heavyValidationError;
        }
        if (runtimeConvergence) {
            details.runtimeConvergence = runtimeConvergence;
        }
        if (heavyValidationConvergence) {
            details.heavyValidationConvergence = heavyValidationConvergence;
        }
        if (correctionPolicy) {
            details.correctionPolicy = {
                ok: correctionPolicy.ok === true,
                blockingCount: Number(correctionPolicy.blockingCount || 0),
                warningCount: Number(correctionPolicy.warningCount || 0),
                summary: typeof correctionPolicy.summary === "string" ? correctionPolicy.summary : ""
            };
        }
        if (heavyValidation) {
            const failedChecks = Array.isArray(heavyValidation.checks)
                ? heavyValidation.checks
                    .map((entry) => this.toRecord(entry))
                    .filter((entry) => Boolean(entry))
                    .filter((entry) => String(entry.status || "") === "fail")
                    .map((entry) => ({
                    id: typeof entry.id === "string" ? entry.id : "unknown",
                    message: typeof entry.message === "string" ? entry.message : ""
                }))
                    .slice(0, 12)
                : [];
            const parsedFailures = Array.isArray(heavyValidation.failures)
                ? heavyValidation.failures
                    .map((entry) => this.toRecord(entry))
                    .filter((entry) => Boolean(entry))
                    .map((entry) => ({
                    sourceCheckId: typeof entry.sourceCheckId === "string" ? entry.sourceCheckId : "unknown",
                    kind: typeof entry.kind === "string" ? entry.kind : "unknown",
                    code: typeof entry.code === "string" ? entry.code : undefined,
                    message: typeof entry.message === "string" ? entry.message : "",
                    file: typeof entry.file === "string" ? entry.file : undefined,
                    line: Number.isFinite(Number(entry.line)) ? Number(entry.line) : undefined,
                    column: Number.isFinite(Number(entry.column)) ? Number(entry.column) : undefined
                }))
                    .slice(0, 25)
                : [];
            details.heavyValidation = {
                ok: heavyValidation.ok === true,
                blockingCount: Number(heavyValidation.blockingCount || 0),
                warningCount: Number(heavyValidation.warningCount || 0),
                summary: typeof heavyValidation.summary === "string" ? heavyValidation.summary : "",
                failedChecks,
                failures: parsedFailures
            };
        }
        return details;
    }
    buildRunFailureDetailsFromStepRecord(input) {
        const outputPayload = this.toRecord(input.stepRecord.outputPayload);
        const stepFailureDetails = this.toRecord(outputPayload?.failureDetails);
        const details = {
            version: 1,
            source: "agent_kernel",
            category: input.category,
            errorMessage: input.errorMessage || input.stepRecord.errorMessage || "Agent run failed.",
            runId: input.run.id,
            projectId: input.run.projectId,
            failedStep: {
                recordId: input.stepRecord.id,
                stepId: input.stepRecord.stepId,
                stepIndex: input.stepRecord.stepIndex,
                attempt: input.stepRecord.attempt,
                type: input.stepRecord.type,
                tool: input.stepRecord.tool,
                status: input.stepRecord.status,
                runtimeStatus: input.stepRecord.runtimeStatus,
                commitHash: input.stepRecord.commitHash
            },
            createdAt: new Date().toISOString()
        };
        if (input.rollbackReason) {
            details.rollbackReason = input.rollbackReason;
        }
        if (stepFailureDetails) {
            details.stepFailure = stepFailureDetails;
        }
        if (input.plannerError !== undefined) {
            details.plannerError = serializeError(input.plannerError);
        }
        return details;
    }
    normalizeCorrectionPathPrefix(value) {
        return value.replaceAll("\\", "/").replace(/^\/+/, "").trim();
    }
    coerceCorrectionIntent(value) {
        const normalized = String(value || "").trim();
        switch (normalized) {
            case "runtime_boot":
            case "runtime_health":
            case "typescript_compile":
            case "test_failure":
            case "migration_failure":
            case "architecture_violation":
            case "security_baseline":
            case "unknown":
                return normalized;
            default:
                return "unknown";
        }
    }
    toRecord(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
        }
        return value;
    }
    toPrecommitInvariantResult(error) {
        if (!error || typeof error !== "object") {
            return null;
        }
        const maybeRecord = error;
        if (!isPrecommitInvariantResult(maybeRecord.precommitInvariantResult)) {
            return null;
        }
        const result = maybeRecord.precommitInvariantResult;
        return result.ok ? null : result;
    }
    extractInvariantViolationFromStep(step) {
        if (!step) {
            return null;
        }
        const outputPayload = this.toRecord(step.outputPayload);
        const invariant = this.toRecord(outputPayload?.invariantViolation);
        if (!invariant) {
            return null;
        }
        const reason = typeof invariant.reason === "string" ? invariant.reason.trim() : "";
        if (reason !== "invariant_violation") {
            return null;
        }
        const summary = typeof invariant.summary === "string" && invariant.summary.trim().length > 0
            ? invariant.summary.trim()
            : "Pre-commit invariant violation.";
        const violations = Array.isArray(invariant.violations) ? invariant.violations : [];
        const firstViolation = violations
            .map((entry) => this.toRecord(entry))
            .filter((entry) => Boolean(entry))
            .map((entry) => (typeof entry.message === "string" ? entry.message.trim() : ""))
            .find((entry) => entry.length > 0);
        const context = firstViolation ? `${summary} First violation: ${firstViolation}` : summary;
        const correctionProfile = classifyPrecommitInvariantFailure(invariant);
        return {
            summary,
            context,
            correctionProfile
        };
    }
    collectLearningAttemptSteps(steps, stepsBeforeCount) {
        return steps.slice(Math.max(0, stepsBeforeCount));
    }
    collectLearningInvariantFailures(steps) {
        const failures = [];
        for (const step of steps) {
            const outputPayload = this.toRecord(step.outputPayload);
            const invariant = this.toRecord(outputPayload?.invariantViolation);
            if (!invariant || invariant.reason !== "invariant_violation" || !Array.isArray(invariant.violations)) {
                continue;
            }
            for (const entry of invariant.violations) {
                const record = this.toRecord(entry);
                if (record) {
                    failures.push(record);
                }
            }
        }
        return failures;
    }
    resolveLearningPhase(input) {
        const phases = new Set();
        for (const step of input.correctionSteps.length ? input.correctionSteps : input.attemptSteps) {
            const inputPayload = this.toRecord(step.inputPayload);
            const phase = typeof inputPayload?.phase === "string" && inputPayload.phase.trim()
                ? inputPayload.phase.trim()
                : null;
            if (phase) {
                phases.add(phase);
            }
        }
        const resolvedPhases = phases.size ? Array.from(phases) : ["single"];
        return resolvedPhases.length === 1 ? resolvedPhases[0] : resolvedPhases.join("+");
    }
    classifyLearningOutcome(blockingBefore, blockingAfter) {
        if (blockingAfter === 0) {
            return "success";
        }
        if (blockingAfter < blockingBefore) {
            return "improved";
        }
        if (blockingAfter > blockingBefore) {
            return "regressed";
        }
        return "noop";
    }
    isMicroPrimaryCluster(cluster) {
        return (cluster.type === "layer_boundary_violation" ||
            cluster.type === "import_resolution_error" ||
            cluster.type === "test_contract_gap");
    }
    isMicroAuxiliaryCluster(cluster) {
        return (cluster.type === "typecheck_failure" ||
            cluster.type === "build_failure" ||
            cluster.type === "test_failure");
    }
    isMicroTargetedProfile(profile) {
        if (profile.architectureCollapse || profile.plannerModeOverride === "architecture_reconstruction") {
            return false;
        }
        return profile.clusters.some((cluster) => this.isMicroPrimaryCluster(cluster) || this.isMicroAuxiliaryCluster(cluster));
    }
    collectClusterTypes(profile) {
        return Array.from(new Set(profile.clusters
            .map((cluster) => cluster.type.trim())
            .filter((value) => value.length > 0))).sort();
    }
    classifyAttemptOutcome(input) {
        const blockingBefore = input.validationBefore.blockingCount;
        const blockingAfter = input.validationAfter.blockingCount;
        const baseOutcome = this.classifyLearningOutcome(blockingBefore, blockingAfter);
        if (input.validationAfter.ok) {
            if (input.phase === "debt_resolution" && !input.debtResolutionResult?.debtPaidDown) {
                return "stalled";
            }
            return baseOutcome;
        }
        const afterProfile = classifyValidationFailure(input.validationAfter);
        const beforeClusters = this.collectClusterTypes(input.beforeProfile);
        const afterClusters = this.collectClusterTypes(afterProfile);
        const unchangedClusters = beforeClusters.length === afterClusters.length && beforeClusters.every((value, index) => value === afterClusters[index]);
        const blockingUnchanged = blockingAfter === blockingBefore;
        const changedFiles = input.correctionOutput?.changedFiles ?? input.correctionOutput?.filesChanged;
        const hasChangedFiles = Array.isArray(changedFiles) && changedFiles.length > 0;
        const hasCommittedChange = input.correctionSteps.some((step) => typeof step.commitHash === "string" && step.commitHash.trim());
        const mutationAttempted = input.correctionSteps.length > 0 || hasChangedFiles || hasCommittedChange;
        const microTargetedLoop = input.phase === "micro_targeted_repair";
        if (mutationAttempted && (unchangedClusters || blockingUnchanged || microTargetedLoop)) {
            return "stalled";
        }
        return baseOutcome;
    }
    extractStressSessionId(run) {
        const metadata = this.toRecord(run.metadata);
        return typeof metadata?.stressSessionId === "string" && metadata.stressSessionId.trim()
            ? metadata.stressSessionId.trim()
            : null;
    }
    async queryMicroTargetedStallPressureStats(run) {
        const stressSessionId = this.extractStressSessionId(run);
        let sessionMicroRuns = 0;
        let sessionStalledRuns = 0;
        if (stressSessionId) {
            const sessionRows = await this.store.query(`
          SELECT phase, outcome
          FROM learning_events
          WHERE metadata->>'stressSessionId' = $1
          ORDER BY created_at DESC
          LIMIT $2
        `, [stressSessionId, MICRO_TARGETED_STALL_WINDOW]);
            for (const row of sessionRows) {
                if (row.phase !== "micro_targeted_repair") {
                    continue;
                }
                sessionMicroRuns += 1;
                if (row.outcome === "stalled") {
                    sessionStalledRuns += 1;
                }
            }
        }
        const runRows = await this.store.query(`
        SELECT phase, outcome
        FROM learning_events
        WHERE run_id = $1
        ORDER BY created_at DESC
        LIMIT 5
      `, [run.id]);
        let runConsecutiveStalls = 0;
        for (const row of runRows) {
            if (row.phase === "micro_targeted_repair" && row.outcome === "stalled") {
                runConsecutiveStalls += 1;
                continue;
            }
            break;
        }
        return {
            sessionMicroRuns,
            sessionStalledRuns,
            sessionStallRate: sessionMicroRuns > 0 ? sessionStalledRuns / sessionMicroRuns : 0,
            runConsecutiveStalls
        };
    }
    shouldUseMicroTargetedStallGuardrail(stats) {
        const sessionStalling = stats.sessionMicroRuns >= MICRO_TARGETED_STALL_MIN_RUNS && stats.sessionStallRate >= MICRO_TARGETED_STALL_MIN_RATE;
        const runStalling = stats.runConsecutiveStalls >= MICRO_TARGETED_STALL_ESCALATION_LIMIT;
        return sessionStalling || runStalling;
    }
    resolveMicroTargetedEscalation(profile, stats) {
        const structurallyInconsistent = profile.architectureModules?.length && profile.architectureModules.length > 1
            ? true
            : profile.clusters.some((cluster) => cluster.type === "layer_boundary_violation" || cluster.type === "architecture_contract");
        if (stats.runConsecutiveStalls >= MICRO_TARGETED_STALL_RECONSTRUCTION_LIMIT || structurallyInconsistent) {
            return "architecture_reconstruction";
        }
        return "feature_reintegration";
    }
    extractDebtTargetsFromStubMetadata(stubDebtMetadata) {
        if (!stubDebtMetadata?.stubTargets?.length) {
            return [];
        }
        return stubDebtMetadata.stubTargets
            .filter((entry) => typeof entry.path === "string" && entry.path.trim())
            .map((entry) => ({
            path: entry.path,
            exportsSummary: entry.exportsSummary ?? null,
            referrers: Array.isArray(entry.referrers)
                ? entry.referrers.flatMap((referrer) => {
                    if (!referrer ||
                        typeof referrer.containingFile !== "string" ||
                        !referrer.containingFile.trim() ||
                        typeof referrer.specifier !== "string" ||
                        !referrer.specifier.trim()) {
                        return [];
                    }
                    return [
                        {
                            containingFile: referrer.containingFile.trim(),
                            specifier: referrer.specifier.trim()
                        }
                    ];
                })
                : []
        }));
    }
    buildDebtResolutionValidationSummary(input) {
        const debtLines = input.stubDebtMetadata.stubTargets.length
            ? input.stubDebtMetadata.stubTargets.map((entry) => {
                const exportSummary = entry.exportsSummary ? JSON.stringify(entry.exportsSummary) : null;
                return exportSummary ? `${entry.path} exports=${exportSummary}` : entry.path;
            })
            : [input.stubDebtMetadata.stubPath || "untracked-stub"];
        return [
            "Provisionally fixed import-resolution stub debt remains open.",
            "Replace the following provisional stubs with canonical real implementations:",
            ...debtLines.map((entry) => `- ${entry}`)
        ].join("\n");
    }
    hashContent(value) {
        return createHash("sha256").update(value).digest("hex");
    }
    buildStubMarkerLine(input) {
        const runMetadata = this.toRecord(input.run.metadata) || {};
        const payload = {
            createdByRunId: input.run.id,
            projectId: input.run.projectId,
            stubPath: input.stubPath,
            stubExports: input.exportsSummary ?? null,
            createdAt: new Date().toISOString()
        };
        if (typeof runMetadata.scenarioRunId === "string" && runMetadata.scenarioRunId.trim()) {
            payload.scenarioRunId = runMetadata.scenarioRunId.trim();
        }
        if (typeof runMetadata.scenarioLabel === "string" && runMetadata.scenarioLabel.trim()) {
            payload.scenarioLabel = runMetadata.scenarioLabel.trim();
        }
        return `${DEEPRUN_STUB_MARKER_PREFIX}${JSON.stringify(payload)}`;
    }
    parseStubMarker(content) {
        const firstLine = content.split(/\r?\n/, 1)[0] || "";
        if (!firstLine.startsWith(DEEPRUN_STUB_MARKER_PREFIX)) {
            return null;
        }
        const payload = firstLine.slice(DEEPRUN_STUB_MARKER_PREFIX.length).trim();
        if (!payload) {
            return null;
        }
        try {
            return this.toRecord(JSON.parse(payload));
        }
        catch {
            return null;
        }
    }
    isStubLikeModuleContent(content) {
        if (content.includes(DEEPRUN_STUB_MARKER_PREFIX)) {
            return true;
        }
        const normalized = content.replace(/\r\n/g, "\n");
        return (normalized.includes("DeepRun stub: auto-materialized for import resolution") ||
            /export\s+type\s+\w+\s*=\s*any\b/.test(normalized) ||
            /undefined as any/.test(normalized) ||
            /const __default: any = \{\};/.test(normalized) ||
            /export const __all: any = \{\};/.test(normalized));
    }
    buildDebtResolutionModuleContent(input) {
        const exportsSummary = input.exportsSummary || {};
        const named = Array.isArray(exportsSummary.named)
            ? exportsSummary.named.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            : [];
        const isTypeOnly = exportsSummary.typeOnly === true || input.targetPath.endsWith(".d.ts");
        const hasDefault = exportsSummary.default === true;
        const hasNamespace = exportsSummary.namespace === true;
        const lines = ["// DeepRun debt resolution placeholder: replace with canonical implementation."];
        if (isTypeOnly) {
            if (hasDefault) {
                lines.push("export default interface DeepRunDefaultContract {");
                lines.push("  readonly kind: \"default_contract\";");
                lines.push("}");
            }
            for (const name of named) {
                lines.push(`export interface ${name} {`);
                lines.push(`  readonly kind: \"${name}\";`);
                lines.push("}");
            }
            if (!hasDefault && named.length === 0) {
                lines.push("export interface DeepRunContract {");
                lines.push("  readonly kind: \"contract\";");
                lines.push("}");
            }
        }
        else {
            if (hasDefault) {
                lines.push("const deepRunDefault = {");
                lines.push("  kind: \"default_contract\",");
                lines.push("  status: \"draft\"");
                lines.push("} as const;");
                lines.push("export default deepRunDefault;");
            }
            for (const name of named) {
                lines.push(`export const ${name} = {`);
                lines.push(`  kind: \"${name}\",`);
                lines.push("  status: \"draft\"");
                lines.push("} as const;");
            }
            if (hasNamespace) {
                lines.push("export const deepRunModule = {");
                lines.push("  kind: \"module_contract\",");
                lines.push("  status: \"draft\"");
                lines.push("} as const;");
            }
            if (!hasDefault && named.length === 0 && !hasNamespace) {
                lines.push("export const deepRunContract = {");
                lines.push("  kind: \"contract\",");
                lines.push("  status: \"draft\"");
                lines.push("} as const;");
            }
        }
        return `${lines.join("\n")}\n`;
    }
    async captureDebtResolutionTargets(input) {
        const capturedTargets = [];
        for (const target of input.debtTargets) {
            if (typeof target.path !== "string" || !target.path.trim()) {
                continue;
            }
            const normalizedPath = target.path.trim();
            const absolutePath = safeResolvePath(input.projectRoot, normalizedPath);
            const exists = await pathExists(absolutePath);
            const content = exists ? await readTextFile(absolutePath) : null;
            capturedTargets.push({
                path: normalizedPath,
                exportsSummary: target.exportsSummary ?? null,
                referrers: Array.isArray(target.referrers) ? target.referrers : [],
                stubHashBefore: content ? this.hashContent(content) : null,
                markerPresentBefore: content ? Boolean(this.parseStubMarker(content)) : false
            });
        }
        return capturedTargets;
    }
    async buildDeterministicDebtResolutionPlan(input) {
        const files = input.debtTargets
            .filter((target) => typeof target.path === "string" && target.path.trim())
            .map((target) => ({
            path: target.path.trim(),
            content: this.buildDebtResolutionModuleContent({
                targetPath: target.path.trim(),
                exportsSummary: target.exportsSummary ?? null
            })
        }));
        if (!files.length) {
            return null;
        }
        const allowedPathPrefixes = files.map((entry) => entry.path);
        const correctionReasoning = {
            phase: "debt_resolution",
            attempt: input.attempt,
            failedStepId: input.failedStepId,
            summary: input.validationSummary,
            reason: "Deterministic debt-resolution follow-up for provisional stub removal.",
            classification: {
                intent: "typescript_compile",
                failedChecks: ["typecheck"],
                failureKinds: ["typescript"],
                rationale: "Replace provisional stub modules with non-stub placeholder implementations."
            },
            constraint: {
                intent: "typescript_compile",
                maxFiles: Math.max(1, Math.min(files.length, 8)),
                maxTotalDiffBytes: 160_000,
                allowedPathPrefixes,
                guidance: ["Replace only the tracked provisional stub modules."]
            },
            createdAt: new Date().toISOString()
        };
        return withAgentPlanCapabilities({
            goal: input.run.goal,
            steps: [
                {
                    id: `validation-correction-${input.attempt}`,
                    type: "modify",
                    tool: "write_file",
                    mutates: true,
                    input: {
                        mode: "correction",
                        phase: "debt_resolution",
                        files,
                        originalIntent: input.run.goal,
                        validationSummary: input.validationSummary,
                        correctionProfile: {
                            plannerModeOverride: "debt_resolution",
                            debtTargets: input.debtTargets
                        },
                        _deepCorrection: correctionReasoning
                    }
                }
            ]
        });
    }
    async evaluateDebtResolution(input) {
        if (input.phase !== "debt_resolution" || !input.targets?.length) {
            return null;
        }
        const targets = [];
        for (const target of input.targets) {
            const absolutePath = safeResolvePath(input.projectRoot, target.path);
            const exists = await pathExists(absolutePath);
            const content = exists ? await readTextFile(absolutePath) : null;
            const markerPresentAfter = content ? Boolean(this.parseStubMarker(content)) : false;
            const stubHashAfter = content ? this.hashContent(content) : null;
            const replacedStub = Boolean(content) &&
                !markerPresentAfter &&
                stubHashAfter !== target.stubHashBefore &&
                !this.isStubLikeModuleContent(content || "");
            const rewiredImport = exists && !replacedStub
                ? await this.evaluateRewiredImportTargets({
                    projectRoot: input.projectRoot,
                    targetPath: target.path,
                    referrers: target.referrers
                })
                : null;
            const paidDown = !exists || replacedStub || Boolean(rewiredImport && rewiredImport.stillReferring.length === 0);
            targets.push({
                path: target.path,
                stubHashBefore: target.stubHashBefore,
                stubHashAfter,
                markerPresentBefore: target.markerPresentBefore,
                markerPresentAfter,
                paidDown,
                rewiredImport
            });
        }
        const debtPaidDown = targets.length > 0 && targets.every((target) => target.paidDown);
        const allRemoved = targets.length > 0 && targets.every((target) => target.stubHashAfter === null);
        const allRewired = debtPaidDown &&
            targets.length > 0 &&
            targets.every((target) => target.stubHashAfter !== null &&
                target.rewiredImport !== null &&
                target.rewiredImport.stillReferring.length === 0);
        return {
            debtPaidDown,
            action: debtPaidDown ? (allRemoved ? "removed_stub" : allRewired ? "rewired_import" : "replaced_stub") : "failed",
            targets
        };
    }
    extractStubDebtMetadata(input) {
        if (input?.importRecipeAction !== "materialize_missing_module") {
            return null;
        }
        const stubTargets = Array.isArray(input.stubTargets)
            ? input.stubTargets
                .map((entry) => this.toRecord(entry))
                .flatMap((entry) => {
                const targetPath = typeof entry?.path === "string" && entry.path.trim() ? entry.path.trim() : null;
                if (!targetPath) {
                    return [];
                }
                return [
                    {
                        path: targetPath,
                        exportsSummary: this.toRecord(entry?.exportsSummary),
                        referrers: Array.isArray(entry?.referrers)
                            ? entry.referrers.flatMap((referrer) => {
                                const normalizedReferrer = this.toRecord(referrer);
                                const containingFile = typeof normalizedReferrer?.containingFile === "string" &&
                                    normalizedReferrer.containingFile.trim()
                                    ? normalizedReferrer.containingFile.trim()
                                    : null;
                                const specifier = typeof normalizedReferrer?.specifier === "string" && normalizedReferrer.specifier.trim()
                                    ? normalizedReferrer.specifier.trim()
                                    : null;
                                if (!containingFile || !specifier) {
                                    return [];
                                }
                                return [{ containingFile, specifier }];
                            })
                            : []
                    }
                ];
            })
            : [];
        return {
            importRecipeAction: "materialize_missing_module",
            stubPath: stubTargets[0]?.path ?? null,
            stubExports: stubTargets[0]?.exportsSummary ?? null,
            stubTargets
        };
    }
    buildLearningEventMetadata(input) {
        const runMetadata = this.toRecord(input.run.metadata) || {};
        const metadata = {
            attemptIndex: input.attemptIndex
        };
        if (typeof runMetadata.stress === "boolean") {
            metadata.stress = runMetadata.stress;
        }
        if (typeof runMetadata.scenarioLabel === "string" && runMetadata.scenarioLabel.trim()) {
            metadata.scenarioLabel = runMetadata.scenarioLabel.trim();
        }
        if (typeof runMetadata.scenarioRunId === "string" && runMetadata.scenarioRunId.trim()) {
            metadata.scenarioRunId = runMetadata.scenarioRunId.trim();
        }
        if (typeof runMetadata.stressSessionId === "string" && runMetadata.stressSessionId.trim()) {
            metadata.stressSessionId = runMetadata.stressSessionId.trim();
        }
        if (typeof runMetadata.stressSeed === "string" && runMetadata.stressSeed.trim()) {
            metadata.stressSeed = runMetadata.stressSeed.trim();
        }
        if (Number.isInteger(runMetadata.stressOrdinal) && Number(runMetadata.stressOrdinal) > 0) {
            metadata.stressOrdinal = Number(runMetadata.stressOrdinal);
        }
        if (typeof runMetadata.stressNegativeControl === "string" && runMetadata.stressNegativeControl.trim()) {
            metadata.stressNegativeControl = runMetadata.stressNegativeControl.trim();
        }
        if (input.extra) {
            Object.assign(metadata, input.extra);
        }
        return metadata;
    }
    getProjectCompilerOptions(projectRoot) {
        const fallback = {
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ES2022,
            allowJs: true,
            resolveJsonModule: true,
            esModuleInterop: true
        };
        const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
        if (!configPath) {
            return fallback;
        }
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        if (configFile.error) {
            return fallback;
        }
        const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
        return parsed.options || fallback;
    }
    async resolveModuleSpecifierToAbsolutePath(input) {
        const referrerPath = this.normalizeImportResolutionSourcePath(input.containingFile) || input.containingFile;
        let referrerAbs;
        try {
            referrerAbs = safeResolvePath(input.projectRoot, referrerPath);
        }
        catch {
            return null;
        }
        const compilerOptions = this.getProjectCompilerOptions(input.projectRoot);
        const resolved = ts.resolveModuleName(input.specifier, referrerAbs, compilerOptions, ts.sys).resolvedModule;
        if (resolved?.resolvedFileName) {
            const absoluteResolved = path.resolve(resolved.resolvedFileName);
            const safeRoot = `${path.resolve(input.projectRoot)}${path.sep}`;
            if (absoluteResolved === path.resolve(input.projectRoot) || absoluteResolved.startsWith(safeRoot)) {
                return absoluteResolved;
            }
        }
        if (!input.specifier.startsWith(".")) {
            return null;
        }
        const fallbackCandidates = this.resolveImportCandidates(referrerAbs, input.specifier, input.projectRoot);
        for (const candidate of fallbackCandidates) {
            if (await pathExists(candidate)) {
                return path.resolve(candidate);
            }
        }
        return null;
    }
    async collectReferrerModuleResolutions(input) {
        const referrerPath = this.normalizeImportResolutionSourcePath(input.containingFile) || input.containingFile;
        const referrerAbs = safeResolvePath(input.projectRoot, referrerPath);
        if (!(await pathExists(referrerAbs))) {
            return [];
        }
        const sourceText = await readTextFile(referrerAbs);
        const sourceFile = ts.createSourceFile(referrerAbs, sourceText, ts.ScriptTarget.Latest, true);
        const specifiers = new Set();
        const visit = (node) => {
            if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteralLike(node.moduleSpecifier)) {
                specifiers.add(node.moduleSpecifier.text);
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        const resolvedPaths = new Set();
        for (const specifier of specifiers) {
            const resolved = await this.resolveModuleSpecifierToAbsolutePath({
                projectRoot: input.projectRoot,
                containingFile: referrerPath,
                specifier
            });
            if (resolved) {
                resolvedPaths.add(path.resolve(resolved));
            }
        }
        return Array.from(resolvedPaths);
    }
    async evaluateRewiredImportTargets(input) {
        if (!input.referrers.length) {
            return null;
        }
        const absoluteTarget = path.resolve(safeResolvePath(input.projectRoot, input.targetPath));
        const uniqueReferrers = Array.from(new Map(input.referrers
            .filter((referrer) => typeof referrer?.containingFile === "string" &&
            referrer.containingFile.trim() &&
            typeof referrer?.specifier === "string" &&
            referrer.specifier.trim())
            .map((referrer) => [referrer.containingFile.trim(), referrer])).values());
        const stillReferring = [];
        for (const referrer of uniqueReferrers) {
            const resolvedModules = await this.collectReferrerModuleResolutions({
                projectRoot: input.projectRoot,
                containingFile: referrer.containingFile
            });
            if (resolvedModules.some((entry) => path.resolve(entry) === absoluteTarget)) {
                stillReferring.push(referrer.containingFile);
            }
        }
        return {
            referrersChecked: uniqueReferrers.length,
            stillReferring
        };
    }
    extractValidationSignal(validation) {
        for (const check of validation.checks) {
            if (check.status !== "fail") {
                continue;
            }
            const details = this.toRecord(check.details);
            if (!details) {
                continue;
            }
            const stderr = typeof details.stderr === "string" && details.stderr.trim() ? details.stderr.trim() : null;
            const stdout = typeof details.stdout === "string" && details.stdout.trim() ? details.stdout.trim() : null;
            const logs = typeof details.logs === "string" && details.logs.trim() ? details.logs.trim() : null;
            const exitCode = Number.isFinite(Number(details.exitCode)) ? Number(details.exitCode) : 1;
            if (!stderr && !stdout && !logs) {
                continue;
            }
            return {
                tool: typeof check.id === "string" && check.id.trim() ? check.id.trim() : "validation",
                exitCode,
                ...(stdout ? { stdout: stdout.slice(0, 4000) } : {}),
                ...(stderr || logs ? { stderr: (stderr || logs || "").slice(0, 4000) } : {})
            };
        }
        return null;
    }
    extractImportSignal(raw) {
        if (!raw) {
            return null;
        }
        const text = `${raw.stderr ?? ""}\n${raw.stdout ?? ""}`.replaceAll("\\", "/");
        if (!text.trim()) {
            return null;
        }
        const tscMatch = /([^\n(]+)\((\d+),(\d+)\):\s*error\s*TS2307:\s*Cannot find module '([^']+)'/m.exec(text);
        if (tscMatch?.[1] && tscMatch?.[4]) {
            return {
                source: "tsc",
                containingFile: tscMatch[1].trim(),
                specifier: tscMatch[4].trim(),
                line: Number(tscMatch[2] || 0) || null,
                column: Number(tscMatch[3] || 0) || null
            };
        }
        const viteMatch = /Failed to resolve import\s+"([^"]+)"\s+from\s+"([^"]+)"/m.exec(text);
        if (viteMatch?.[1] && viteMatch?.[2]) {
            return {
                source: "vite",
                containingFile: viteMatch[2].trim(),
                specifier: viteMatch[1].trim(),
                line: null,
                column: null
            };
        }
        const nodeMatch = /Cannot find module '([^']+)' imported from '([^']+)'/m.exec(text);
        if (nodeMatch?.[1] && nodeMatch?.[2]) {
            return {
                source: "node",
                containingFile: nodeMatch[2].trim(),
                specifier: nodeMatch[1].trim(),
                line: null,
                column: null
            };
        }
        return null;
    }
    isImportResolutionFailure(profile) {
        return profile.clusters.some((cluster) => cluster.type === "import_resolution_error");
    }
    normalizeImportResolutionSourcePath(value) {
        const normalized = value.replaceAll("\\", "/").trim();
        if (!normalized) {
            return null;
        }
        if (normalized.includes("/.deeprun/") ||
            normalized.includes("/dist/") ||
            normalized.includes("/node_modules/")) {
            return null;
        }
        let candidate = normalized;
        if (!candidate.startsWith("src/")) {
            const srcSegmentIndex = candidate.lastIndexOf("/src/");
            if (srcSegmentIndex < 0) {
                return null;
            }
            candidate = candidate.slice(srcSegmentIndex + 1);
        }
        candidate = candidate.replace(/^\/+/, "");
        return candidate.startsWith("src/") ? candidate : null;
    }
    async queryImportResolutionPressureStats() {
        const rows = await this.store.query(`
        WITH recent AS (
          SELECT clusters, delta, regression_flag
          FROM learning_events
          ORDER BY created_at DESC
          LIMIT $2
        )
        SELECT
          COUNT(*)::text AS recent_count,
          AVG(delta)::text AS avg_delta,
          (
            SUM(CASE WHEN regression_flag THEN 1 ELSE 0 END)::float
            / NULLIF(COUNT(*), 0)
          )::text AS regression_rate
        FROM recent
        WHERE EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(recent.clusters, '[]'::jsonb)) AS cluster
          WHERE CASE
            WHEN jsonb_typeof(cluster) = 'object' THEN cluster->>'type' = $1
            WHEN jsonb_typeof(cluster) = 'string' THEN trim(both '\"' from cluster::text) = $1
            ELSE FALSE
          END
        )
      `, ["import_resolution_error", IMPORT_RESOLUTION_GUARDRAIL_WINDOW]);
        const row = rows[0];
        return {
            recentCount: Number(row?.recent_count || 0),
            avgDelta: Number(row?.avg_delta || 0),
            regressionRate: Number(row?.regression_rate || 0)
        };
    }
    shouldUseImportResolutionGuardrail(profile, stats) {
        if (!this.isImportResolutionFailure(profile)) {
            return false;
        }
        if (stats.recentCount < IMPORT_RESOLUTION_GUARDRAIL_MIN_COUNT) {
            return false;
        }
        return stats.regressionRate >= IMPORT_RESOLUTION_GUARDRAIL_MIN_REGRESSION_RATE || stats.avgDelta <= 0;
    }
    async resolveImportRecipeTarget(projectRoot, sourceFile, importTarget) {
        const normalizedTarget = importTarget.replaceAll("\\", "/").trim();
        if (!normalizedTarget.startsWith(".")) {
            return null;
        }
        const sourceDir = path.posix.dirname(sourceFile);
        const joinedTarget = path.posix.normalize(path.posix.join(sourceDir, normalizedTarget));
        const targetBase = joinedTarget.replace(/\.(?:[cm]?[jt]sx?)$/i, "");
        const candidates = [
            `${targetBase}.ts`,
            `${targetBase}.tsx`,
            `${targetBase}.js`,
            `${targetBase}.jsx`,
            `${targetBase}/index.ts`,
            `${targetBase}/index.tsx`,
            `${targetBase}/index.js`,
            `${targetBase}/index.jsx`
        ];
        for (const candidate of candidates) {
            const normalizedCandidate = this.normalizeImportResolutionSourcePath(candidate);
            if (!normalizedCandidate) {
                continue;
            }
            if (await pathExists(safeResolvePath(projectRoot, normalizedCandidate))) {
                return normalizedCandidate;
            }
        }
        return null;
    }
    toRuntimeImportSpecifier(sourceFile, targetFile) {
        let relative = path.posix.relative(path.posix.dirname(sourceFile), targetFile);
        if (!relative.startsWith(".")) {
            relative = `./${relative}`;
        }
        return relative
            .replace(/\.(?:ts|tsx|jsx)$/i, ".js")
            .replace(/\/index\.(?:ts|tsx|jsx)$/i, "/index.js");
    }
    buildImportResolutionCorrectionConstraint(paths) {
        return {
            intent: "typescript_compile",
            maxFiles: Math.max(1, Math.min(paths.length, 8)),
            maxTotalDiffBytes: 160_000,
            allowedPathPrefixes: Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right)),
            guidance: [
                "Normalize broken relative imports only.",
                "Do not broaden the correction beyond the implicated source files."
            ]
        };
    }
    resolveImportCandidates(containingAbs, specifier, projectRoot) {
        if (!specifier.startsWith(".")) {
            return [];
        }
        const normalizedSpecifier = specifier.replaceAll("\\", "/").trim();
        const containingDir = path.dirname(containingAbs);
        const joinedTarget = path.resolve(containingDir, normalizedSpecifier);
        const targetBase = joinedTarget.replace(/\.(?:[cm]?[jt]sx?)$/i, "");
        const candidates = [
            `${targetBase}.ts`,
            `${targetBase}.tsx`,
            `${targetBase}.d.ts`,
            `${targetBase}.js`,
            `${targetBase}/index.ts`,
            `${targetBase}/index.tsx`,
            `${targetBase}/index.d.ts`,
            `${targetBase}/index.js`
        ];
        return Array.from(new Set(candidates
            .map((candidate) => path.resolve(candidate))
            .filter((candidate) => {
            const safeRoot = `${path.resolve(projectRoot)}${path.sep}`;
            return candidate === path.resolve(projectRoot) || candidate.startsWith(safeRoot);
        })));
    }
    async findImportDeclaration(containingAbs, specifier) {
        if (!(await pathExists(containingAbs))) {
            return null;
        }
        const sourceText = await readTextFile(containingAbs);
        const sourceFile = ts.createSourceFile(containingAbs, sourceText, ts.ScriptTarget.Latest, true);
        for (const statement of sourceFile.statements) {
            if (!ts.isImportDeclaration(statement)) {
                continue;
            }
            if (!ts.isStringLiteral(statement.moduleSpecifier)) {
                continue;
            }
            if (statement.moduleSpecifier.text === specifier) {
                return statement;
            }
        }
        return null;
    }
    buildStubModuleFromImport(_containingAbs, decl) {
        if (!decl?.importClause) {
            return {
                content: "// DeepRun stub: auto-materialized for import resolution\nexport {};\n",
                exportsSummary: { any: true }
            };
        }
        const importClause = decl.importClause;
        const typeOnly = !!importClause.isTypeOnly;
        const defaultName = importClause.name?.text ?? null;
        const named = importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)
            ? importClause.namedBindings.elements.map((entry) => entry.name.text)
            : [];
        const namespace = importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)
            ? importClause.namedBindings.name.text
            : null;
        const lines = ["// DeepRun stub: auto-materialized for import resolution"];
        if (typeOnly) {
            if (defaultName) {
                lines.push(`export type ${defaultName} = any;`);
            }
            for (const name of named) {
                lines.push(`export type ${name} = any;`);
            }
            if (!defaultName && named.length === 0) {
                lines.push("export type __DeepRun = any;");
            }
        }
        else {
            if (defaultName) {
                lines.push("const __default: any = {};");
                lines.push("export default __default;");
            }
            for (const name of named) {
                lines.push(`export const ${name}: any = undefined as any;`);
            }
            if (namespace) {
                lines.push("export const __all: any = {};");
            }
            if (!defaultName && named.length === 0 && !namespace) {
                lines.push("export {};");
            }
        }
        return {
            content: `${lines.join("\n")}\n`,
            exportsSummary: {
                typeOnly,
                default: Boolean(defaultName),
                named,
                namespace: Boolean(namespace)
            }
        };
    }
    pickBestStubPath(candidates) {
        const preference = [".ts", "/index.ts", ".d.ts", "/index.d.ts", ".js", "/index.js", ".tsx", "/index.tsx"];
        for (const suffix of preference) {
            const match = candidates.find((candidate) => candidate.endsWith(suffix));
            if (match) {
                return match;
            }
        }
        return candidates[0] || null;
    }
    extractImportRecipeSignal(input) {
        for (const cluster of input.correctionProfile.clusters) {
            if (cluster.type !== "import_resolution_error") {
                continue;
            }
            const sourceFiles = Array.isArray(cluster.files) ? cluster.files : [];
            const importTargets = Array.isArray(cluster.imports) ? cluster.imports : [];
            for (const sourceEntry of sourceFiles) {
                if (typeof sourceEntry !== "string") {
                    continue;
                }
                const normalizedSource = this.normalizeImportResolutionSourcePath(sourceEntry);
                if (!normalizedSource) {
                    continue;
                }
                for (const importEntry of importTargets) {
                    if (typeof importEntry !== "string" || !importEntry.trim()) {
                        continue;
                    }
                    return {
                        specifier: importEntry.trim(),
                        containingFile: normalizedSource,
                        line: null,
                        column: null,
                        source: "cluster"
                    };
                }
            }
        }
        const normalizedSummary = input.validationSummary.replaceAll("\\", "/");
        const tscInlineMatch = normalizedSummary.match(/([^\n()]+)\((\d+),(\d+)\):\s*error\s+TS2307:\s+Cannot find module ['"]([^'"]+)['"]/m);
        if (tscInlineMatch?.[1] && tscInlineMatch?.[4]) {
            return {
                specifier: tscInlineMatch[4].trim(),
                containingFile: this.normalizeImportResolutionSourcePath(tscInlineMatch[1]) || tscInlineMatch[1].trim(),
                line: Number(tscInlineMatch[2] || 0) || null,
                column: Number(tscInlineMatch[3] || 0) || null,
                source: "tsc"
            };
        }
        const tscTrailingMatch = normalizedSummary.match(/TS2307:\s+Cannot find module ['"]([^'"]+)['"][\s\S]{0,400}?\n\s*([^\n]+)\((\d+),(\d+)\)/m);
        if (tscTrailingMatch?.[1] && tscTrailingMatch?.[2]) {
            return {
                specifier: tscTrailingMatch[1].trim(),
                containingFile: this.normalizeImportResolutionSourcePath(tscTrailingMatch[2]) || tscTrailingMatch[2].trim(),
                line: Number(tscTrailingMatch[3] || 0) || null,
                column: Number(tscTrailingMatch[4] || 0) || null,
                source: "tsc"
            };
        }
        const viteMatch = normalizedSummary.match(/Failed to resolve import\s+"([^"]+)"\s+from\s+"([^"]+)"/m);
        if (viteMatch?.[1] && viteMatch?.[2]) {
            return {
                specifier: viteMatch[1].trim(),
                containingFile: this.normalizeImportResolutionSourcePath(viteMatch[2]) || viteMatch[2].trim(),
                line: null,
                column: null,
                source: "vite"
            };
        }
        return null;
    }
    async buildDeterministicImportResolutionPlan(input) {
        const files = [];
        const changedPaths = new Set();
        const stubWrites = [];
        const candidatePairs = [];
        let missReason;
        let missExtracted = null;
        const noteMiss = (reason, extracted) => {
            if (!missReason) {
                missReason = reason;
                missExtracted = extracted ?? missExtracted;
            }
        };
        if (input.importSignal?.specifier && input.importSignal.containingFile) {
            const normalizedSource = this.normalizeImportResolutionSourcePath(input.importSignal.containingFile) || input.importSignal.containingFile;
            candidatePairs.push({
                sourceFile: normalizedSource,
                importTarget: input.importSignal.specifier,
                extracted: {
                    ...input.importSignal,
                    containingFile: normalizedSource
                }
            });
        }
        else {
            for (const cluster of input.correctionProfile.clusters) {
                if (cluster.type !== "import_resolution_error") {
                    continue;
                }
                const sourceFiles = Array.isArray(cluster.files) ? cluster.files : [];
                const importTargets = Array.isArray(cluster.imports) ? cluster.imports : [];
                for (const sourceEntry of sourceFiles) {
                    if (typeof sourceEntry !== "string") {
                        continue;
                    }
                    const sourceFile = this.normalizeImportResolutionSourcePath(sourceEntry);
                    if (!sourceFile) {
                        continue;
                    }
                    for (const importEntry of importTargets) {
                        if (typeof importEntry !== "string" || !importEntry.trim()) {
                            continue;
                        }
                        candidatePairs.push({
                            sourceFile,
                            importTarget: importEntry.trim(),
                            extracted: {
                                specifier: importEntry.trim(),
                                containingFile: sourceFile,
                                line: null,
                                column: null,
                                source: "cluster"
                            }
                        });
                    }
                }
            }
        }
        if (!candidatePairs.length) {
            const extracted = this.extractImportRecipeSignal({
                correctionProfile: input.correctionProfile,
                validationSummary: input.validationSummary
            });
            if (!extracted?.specifier || !extracted.containingFile) {
                return {
                    plan: null,
                    missReason: extracted ? "incomplete_signal_extraction" : "no_import_signal",
                    extracted
                };
            }
            candidatePairs.push({
                sourceFile: extracted.containingFile,
                importTarget: extracted.specifier,
                extracted
            });
        }
        for (const candidate of candidatePairs) {
            const sourceAbs = safeResolvePath(input.projectRoot, candidate.sourceFile);
            const sourceExists = await pathExists(sourceAbs);
            const content = sourceExists ? await readTextFile(sourceAbs) : null;
            if (sourceExists && content && !content.includes(candidate.importTarget)) {
                noteMiss("import_not_found_in_source", candidate.extracted);
                continue;
            }
            const resolvedTarget = await this.resolveImportRecipeTarget(input.projectRoot, candidate.sourceFile, candidate.importTarget);
            if (resolvedTarget) {
                if (!sourceExists || !content) {
                    noteMiss("source_file_missing", candidate.extracted);
                    continue;
                }
                const replacement = this.toRuntimeImportSpecifier(candidate.sourceFile, resolvedTarget);
                if (replacement === candidate.importTarget) {
                    noteMiss("replacement_unchanged", candidate.extracted);
                    continue;
                }
                const operation = {
                    search: candidate.importTarget,
                    replace: replacement,
                    replaceAll: true
                };
                const existing = files.find((entry) => entry.path === candidate.sourceFile);
                if (existing) {
                    existing.operations.push(operation);
                }
                else {
                    files.push({
                        path: candidate.sourceFile,
                        operations: [operation]
                    });
                }
                changedPaths.add(candidate.sourceFile);
                continue;
            }
            const stubCandidates = this.resolveImportCandidates(sourceAbs, candidate.importTarget, input.projectRoot);
            const existingTarget = [];
            for (const stubCandidate of stubCandidates) {
                if (await pathExists(stubCandidate)) {
                    existingTarget.push(stubCandidate);
                }
            }
            if (existingTarget.length > 0) {
                noteMiss("target_exists_but_unresolved", candidate.extracted);
                continue;
            }
            const stubTarget = this.pickBestStubPath(stubCandidates);
            if (!stubTarget) {
                noteMiss(sourceExists ? "target_not_resolvable" : "source_file_missing", candidate.extracted);
                continue;
            }
            const importDecl = await this.findImportDeclaration(sourceAbs, candidate.importTarget);
            const stub = this.buildStubModuleFromImport(sourceAbs, importDecl);
            const relativeStubPath = path.relative(input.projectRoot, stubTarget).replaceAll("\\", "/");
            if (!relativeStubPath || relativeStubPath.startsWith("..")) {
                noteMiss("stub_path_outside_project", candidate.extracted);
                continue;
            }
            const existingStubWrite = stubWrites.find((entry) => entry.path === relativeStubPath);
            if (!existingStubWrite) {
                const stubContent = `${this.buildStubMarkerLine({
                    run: input.run,
                    stubPath: relativeStubPath,
                    exportsSummary: stub.exportsSummary
                })}\n${stub.content}`;
                stubWrites.push({
                    path: relativeStubPath,
                    content: stubContent,
                    exportsSummary: stub.exportsSummary,
                    referrers: [
                        {
                            containingFile: candidate.sourceFile,
                            specifier: candidate.importTarget
                        }
                    ]
                });
            }
            else if (!existingStubWrite.referrers.some((referrer) => referrer.containingFile === candidate.sourceFile && referrer.specifier === candidate.importTarget)) {
                existingStubWrite.referrers.push({
                    containingFile: candidate.sourceFile,
                    specifier: candidate.importTarget
                });
            }
            changedPaths.add(relativeStubPath);
        }
        if (!files.length && !stubWrites.length) {
            return {
                plan: null,
                missReason: missReason || "no_patch_operations",
                extracted: missExtracted
            };
        }
        const constraint = this.buildImportResolutionCorrectionConstraint(Array.from(changedPaths));
        const correctionReasoning = {
            phase: "import_resolution_recipe",
            attempt: input.attempt,
            failedStepId: input.failedStepId,
            summary: input.validationSummary,
            reason: "Deterministic import-resolution guardrail override.",
            classification: {
                intent: constraint.intent,
                failedChecks: ["typecheck"],
                failureKinds: ["typescript"],
                rationale: `Recent import_resolution_error pressure is unstable (count=${input.stats.recentCount}, avgDelta=${input.stats.avgDelta}, regressionRate=${input.stats.regressionRate}).`
            },
            constraint,
            createdAt: new Date().toISOString()
        };
        const recipeStep = stubWrites.length > 0
            ? {
                id: `validation-correction-${input.attempt}`,
                type: "modify",
                tool: "write_file",
                mutates: true,
                input: {
                    mode: "correction",
                    phase: "import_resolution_recipe",
                    files: stubWrites.map((entry) => ({
                        path: entry.path,
                        content: entry.content
                    })),
                    originalIntent: input.run.goal,
                    validationSummary: input.validationSummary,
                    correctionProfile: input.correctionProfile,
                    importRecipeAction: "materialize_missing_module",
                    stubTargets: stubWrites.map((entry) => ({
                        path: entry.path,
                        exportsSummary: entry.exportsSummary,
                        referrers: entry.referrers
                    })),
                    _deepCorrection: correctionReasoning
                }
            }
            : {
                id: `validation-correction-${input.attempt}`,
                type: "modify",
                tool: "apply_patch",
                mutates: true,
                input: {
                    mode: "correction",
                    phase: "import_resolution_recipe",
                    files,
                    originalIntent: input.run.goal,
                    validationSummary: input.validationSummary,
                    correctionProfile: input.correctionProfile,
                    _deepCorrection: correctionReasoning
                }
            };
        return {
            plan: withAgentPlanCapabilities({
                goal: input.run.goal,
                steps: [recipeStep]
            })
        };
    }
    async persistLearningTelemetry(input) {
        const attemptSteps = this.collectLearningAttemptSteps(input.steps, input.pendingAttempt.stepsBeforeCount);
        const correctionSteps = attemptSteps.filter((step) => {
            const inputPayload = this.toRecord(step.inputPayload);
            return inputPayload?.mode === "correction" || step.tool === "ai_mutation";
        });
        const correctionStep = correctionSteps[0] ?? attemptSteps[attemptSteps.length - 1];
        const correctionInput = this.toRecord(correctionStep?.inputPayload);
        const correctionOutput = this.toRecord(correctionStep?.outputPayload);
        const originalPromptInput = this.toRecord(input.run.plan.steps.find((step) => typeof this.toRecord(step.input)?.prompt === "string")?.input);
        const stepIndex = correctionSteps[0]?.stepIndex ?? input.pendingAttempt.stepIndex;
        const phase = this.resolveLearningPhase({
            correctionSteps,
            attemptSteps
        });
        const invariantFailures = this.collectLearningInvariantFailures(attemptSteps);
        const blockingBefore = input.pendingAttempt.validationBefore.blockingCount;
        const blockingAfter = input.validationAfter.blockingCount;
        const stubDebtMetadata = this.extractStubDebtMetadata(correctionInput);
        const debtResolutionResult = await this.evaluateDebtResolution({
            projectRoot: input.projectRoot,
            phase,
            targets: input.pendingAttempt.debtTargets
        });
        const baseOutcome = this.classifyAttemptOutcome({
            validationBefore: input.pendingAttempt.validationBefore,
            validationAfter: input.validationAfter,
            beforeProfile: input.pendingAttempt.correctionProfile,
            phase,
            correctionSteps,
            correctionOutput,
            debtResolutionResult
        });
        const provisionalOutcome = Boolean(stubDebtMetadata && phase !== "debt_resolution" && baseOutcome === "success");
        const outcome = provisionalOutcome ? "provisionally_fixed" : baseOutcome;
        const timestamp = new Date().toISOString();
        const learningEventMetadata = this.buildLearningEventMetadata({
            run: input.run,
            attemptIndex: input.pendingAttempt.attempt,
            extra: {
                ...(input.pendingAttempt.learningEventMetadataExtra ?? {}),
                ...(stubDebtMetadata
                    ? {
                        importRecipeAction: stubDebtMetadata.importRecipeAction,
                        stubPath: stubDebtMetadata.stubPath,
                        stubExports: stubDebtMetadata.stubExports,
                        stubTargets: stubDebtMetadata.stubTargets,
                        provisionalOutcome
                    }
                    : {}),
                ...(debtResolutionResult
                    ? {
                        debtPaidDown: debtResolutionResult.debtPaidDown,
                        debtPaydownAction: debtResolutionResult.action,
                        debtTarget: debtResolutionResult.targets[0] ?? null,
                        debtTargets: debtResolutionResult.targets
                    }
                    : {})
            }
        });
        // Enrich the immutable artifact with prompt, file, and invariant context for offline dataset hydration.
        const artifactPayload = {
            runId: input.run.id,
            projectId: input.run.projectId,
            stepIndex,
            phase,
            originalIntent: input.run.goal ?? null,
            prompt: typeof originalPromptInput?.prompt === "string" ? originalPromptInput.prompt : null,
            correctionPrompt: correctionInput?.prompt ?? correctionInput?.messages ?? null,
            blockingBefore,
            blockingAfter,
            outcome,
            correctionProfile: input.pendingAttempt.correctionProfile,
            validationBefore: input.pendingAttempt.validationBefore,
            validationAfter: input.validationAfter,
            validationSignal: input.pendingAttempt.validation ?? null,
            changedFiles: correctionOutput?.changedFiles ?? correctionOutput?.filesChanged ?? null,
            invariantFailures: invariantFailures.length > 0 ? invariantFailures : null,
            commitHash: correctionStep?.commitHash ?? null,
            importRecipeAction: stubDebtMetadata?.importRecipeAction ?? null,
            stubPath: stubDebtMetadata?.stubPath ?? null,
            stubExports: stubDebtMetadata?.stubExports ?? null,
            stubTargets: stubDebtMetadata?.stubTargets ?? null,
            provisionalOutcome,
            debtPaidDown: debtResolutionResult?.debtPaidDown ?? null,
            debtPaydownAction: debtResolutionResult?.action ?? null,
            debtTarget: debtResolutionResult?.targets[0] ?? null,
            debtTargets: debtResolutionResult?.targets ?? null,
            metadata: learningEventMetadata,
            timestamp
        };
        try {
            await this.store.writeLearningEvent({
                runId: input.run.id,
                projectId: input.run.projectId,
                stepIndex,
                eventType: "correction",
                phase,
                clusters: input.pendingAttempt.correctionProfile.clusters ?? null,
                blockingBefore,
                blockingAfter,
                architectureCollapse: input.pendingAttempt.correctionProfile.architectureCollapse ?? false,
                invariantCount: invariantFailures.length,
                metadata: learningEventMetadata,
                outcome
            });
        }
        catch (error) {
            logWarn("learning.telemetry.db_write_failed", {
                runId: input.run.id,
                stepIndex,
                attempt: input.pendingAttempt.attempt,
                ...serializeError(error)
            });
        }
        try {
            await appendLearningJsonl(input.projectRoot, input.run.id, artifactPayload);
            await writeSnapshot(input.projectRoot, input.run.id, stepIndex, input.pendingAttempt.attempt, artifactPayload);
            if (stubDebtMetadata) {
                await writeStubDebtArtifact(input.projectRoot, input.run.id, stepIndex, input.pendingAttempt.attempt, {
                    status: "open",
                    createdAt: timestamp,
                    runId: input.run.id,
                    projectId: input.run.projectId,
                    stepIndex,
                    attempt: input.pendingAttempt.attempt,
                    outcome,
                    importRecipeAction: stubDebtMetadata.importRecipeAction,
                    stubPath: stubDebtMetadata.stubPath,
                    stubExports: stubDebtMetadata.stubExports,
                    stubTargets: stubDebtMetadata.stubTargets,
                    resolutionStrategy: learningEventMetadata.resolutionStrategy ?? null,
                    note: "Auto-materialized stub requires follow-up review before production promotion."
                });
            }
            if (debtResolutionResult) {
                await writeStubDebtArtifact(input.projectRoot, input.run.id, stepIndex, input.pendingAttempt.attempt, {
                    status: debtResolutionResult.debtPaidDown ? "closed" : "open",
                    resolvedAt: timestamp,
                    runId: input.run.id,
                    projectId: input.run.projectId,
                    stepIndex,
                    attempt: input.pendingAttempt.attempt,
                    outcome,
                    debtPaidDown: debtResolutionResult.debtPaidDown,
                    debtPaydownAction: debtResolutionResult.action,
                    debtTargets: debtResolutionResult.targets
                });
            }
        }
        catch (error) {
            logWarn("learning.telemetry.artifact_write_failed", {
                runId: input.run.id,
                stepIndex,
                attempt: input.pendingAttempt.attempt,
                ...serializeError(error)
            });
        }
        return {
            outcome,
            phase,
            correctionProfile: input.pendingAttempt.correctionProfile,
            stubDebtMetadata,
            debtResolutionResult
        };
    }
    toStringArray(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        const deduped = new Set();
        for (const entry of value) {
            if (typeof entry !== "string") {
                continue;
            }
            const normalized = entry.trim();
            if (!normalized) {
                continue;
            }
            deduped.add(normalized);
        }
        return Array.from(deduped.values());
    }
    parseCorrectionConstraint(value) {
        const constraint = this.toRecord(value);
        if (!constraint) {
            return null;
        }
        const allowedPathPrefixes = this.toStringArray(constraint.allowedPathPrefixes)
            .map((entry) => this.normalizeCorrectionPathPrefix(entry))
            .filter(Boolean);
        const maxFiles = Number(constraint.maxFiles);
        const maxTotalDiffBytes = Number(constraint.maxTotalDiffBytes);
        return {
            intent: this.coerceCorrectionIntent(constraint.intent),
            maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : 15,
            maxTotalDiffBytes: Number.isFinite(maxTotalDiffBytes) && maxTotalDiffBytes > 0 ? Math.floor(maxTotalDiffBytes) : 400_000,
            allowedPathPrefixes,
            guidance: this.toStringArray(constraint.guidance)
        };
    }
    resolveCorrectionConstraintForStep(step) {
        const deepCorrection = this.toRecord(step.input?._deepCorrection);
        if (!deepCorrection) {
            return null;
        }
        return this.parseCorrectionConstraint(deepCorrection.constraint);
    }
    extractCorrectionTelemetryForStep(step) {
        const inputPayload = this.toRecord(step.inputPayload);
        const deepCorrection = this.toRecord(inputPayload?._deepCorrection);
        if (!deepCorrection) {
            return null;
        }
        const classificationRaw = this.toRecord(deepCorrection.classification);
        const classificationIntent = this.coerceCorrectionIntent(classificationRaw?.intent);
        const constraint = this.parseCorrectionConstraint(deepCorrection.constraint) || {
            intent: classificationIntent,
            maxFiles: 15,
            maxTotalDiffBytes: 400_000,
            allowedPathPrefixes: [],
            guidance: []
        };
        const phase = typeof deepCorrection.phase === "string" && deepCorrection.phase.trim()
            ? deepCorrection.phase.trim()
            : "unknown";
        const attempt = Number(deepCorrection.attempt);
        const createdAt = typeof deepCorrection.createdAt === "string" && deepCorrection.createdAt.trim()
            ? deepCorrection.createdAt
            : step.createdAt;
        return {
            phase,
            attempt: Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : step.attempt,
            failedStepId: typeof deepCorrection.failedStepId === "string" && deepCorrection.failedStepId.trim()
                ? deepCorrection.failedStepId.trim()
                : step.stepId,
            reason: typeof deepCorrection.reason === "string" && deepCorrection.reason.trim()
                ? deepCorrection.reason.trim()
                : undefined,
            summary: typeof deepCorrection.summary === "string" && deepCorrection.summary.trim()
                ? deepCorrection.summary.trim()
                : undefined,
            runtimeLogTail: typeof deepCorrection.runtimeLogTail === "string" && deepCorrection.runtimeLogTail.trim()
                ? deepCorrection.runtimeLogTail
                : undefined,
            classification: {
                intent: classificationIntent,
                failedChecks: this.toStringArray(classificationRaw?.failedChecks),
                failureKinds: this.toStringArray(classificationRaw?.failureKinds),
                rationale: typeof classificationRaw?.rationale === "string" && classificationRaw.rationale.trim()
                    ? classificationRaw.rationale.trim()
                    : `intent=${classificationIntent}`
            },
            constraint,
            createdAt
        };
    }
    parseCorrectionPolicyMode(value) {
        if (typeof value !== "string") {
            return undefined;
        }
        const normalized = value.trim().toLowerCase();
        if (normalized === "off" || normalized === "warn" || normalized === "enforce") {
            return normalized;
        }
        return undefined;
    }
    extractCorrectionPolicyForStep(step) {
        const outputPayload = this.toRecord(step.outputPayload);
        const raw = this.toRecord(outputPayload?.correctionPolicy);
        if (!raw || typeof raw.ok !== "boolean") {
            return null;
        }
        const violations = [];
        const rawViolations = Array.isArray(raw.violations) ? raw.violations : [];
        for (const entry of rawViolations) {
            const record = this.toRecord(entry);
            if (!record) {
                continue;
            }
            const ruleId = typeof record.ruleId === "string" ? record.ruleId.trim() : "";
            const message = typeof record.message === "string" ? record.message.trim() : "";
            const severityRaw = typeof record.severity === "string" ? record.severity.trim().toLowerCase() : "";
            const severity = severityRaw === "warning" ? "warning" : severityRaw === "error" ? "error" : null;
            if (!ruleId || !message || !severity) {
                continue;
            }
            const details = this.toRecord(record.details) || undefined;
            violations.push({
                ruleId,
                severity,
                message,
                ...(details ? { details } : {})
            });
        }
        const blockingFromViolations = violations.filter((entry) => entry.severity === "error").length;
        const warningFromViolations = violations.length - blockingFromViolations;
        const blockingCount = Number(raw.blockingCount);
        const warningCount = Number(raw.warningCount);
        const resolvedBlockingCount = Number.isFinite(blockingCount) && blockingCount >= 0 ? Math.floor(blockingCount) : blockingFromViolations;
        const resolvedWarningCount = Number.isFinite(warningCount) && warningCount >= 0 ? Math.floor(warningCount) : warningFromViolations;
        const summary = typeof raw.summary === "string" && raw.summary.trim()
            ? raw.summary.trim()
            : resolvedBlockingCount === 0
                ? `correction policy passed; warnings=${resolvedWarningCount}`
                : `failed rules; blocking=${resolvedBlockingCount}; warnings=${resolvedWarningCount}`;
        return {
            ok: raw.ok,
            mode: this.parseCorrectionPolicyMode(raw.mode),
            blockingCount: resolvedBlockingCount,
            warningCount: resolvedWarningCount,
            summary,
            violations
        };
    }
    buildRunDetail(run, steps) {
        const corrections = [];
        const correctionPolicies = [];
        const enrichedSteps = steps.map((step) => {
            const correctionTelemetry = this.extractCorrectionTelemetryForStep(step);
            const correctionPolicy = this.extractCorrectionPolicyForStep(step);
            if (correctionPolicy) {
                correctionPolicies.push({
                    stepRecordId: step.id,
                    stepId: step.stepId,
                    stepIndex: step.stepIndex,
                    stepAttempt: step.attempt,
                    status: step.status,
                    errorMessage: step.errorMessage,
                    commitHash: step.commitHash,
                    createdAt: step.createdAt,
                    policy: correctionPolicy
                });
            }
            if (correctionTelemetry) {
                corrections.push({
                    stepRecordId: step.id,
                    stepId: step.stepId,
                    stepIndex: step.stepIndex,
                    stepAttempt: step.attempt,
                    status: step.status,
                    errorMessage: step.errorMessage,
                    commitHash: step.commitHash,
                    createdAt: step.createdAt,
                    telemetry: correctionTelemetry,
                    correctionPolicy
                });
            }
            if (!correctionTelemetry && !correctionPolicy) {
                return step;
            }
            return {
                ...step,
                ...(correctionTelemetry ? { correctionTelemetry } : {}),
                ...(correctionPolicy ? { correctionPolicy } : {})
            };
        });
        return {
            run: attachLastStep(run, enrichedSteps),
            steps: enrichedSteps,
            telemetry: {
                corrections,
                correctionPolicies
            }
        };
    }
    async buildRunStubDebtSummary(run) {
        const candidateRoots = [];
        if (typeof run.worktreePath === "string" && run.worktreePath.trim()) {
            candidateRoots.push(run.worktreePath.trim());
        }
        const validationResult = this.toRecord(run.validationResult);
        const validationTargetPath = typeof validationResult?.targetPath === "string" && validationResult.targetPath.trim()
            ? validationResult.targetPath.trim()
            : null;
        if (validationTargetPath) {
            candidateRoots.push(validationTargetPath);
        }
        if (!candidateRoots.length) {
            const project = await this.store.getProject(run.projectId);
            if (project) {
                candidateRoots.push(this.store.getProjectWorkspacePath(project));
            }
        }
        for (const candidateRoot of candidateRoots) {
            if (!(await pathExists(candidateRoot))) {
                continue;
            }
            const summary = await summarizeStubDebt(candidateRoot);
            return {
                markerCount: summary.markerCount,
                markerPaths: summary.markerPaths,
                openCount: summary.openCount,
                openTargets: summary.openTargets,
                lastStubPath: summary.lastStubPath,
                lastPaydownAction: summary.lastPaydownAction,
                lastPaydownStatus: summary.lastPaydownStatus,
                lastPaydownAt: summary.lastPaydownAt
            };
        }
        return {
            markerCount: 0,
            markerPaths: [],
            openCount: 0,
            openTargets: [],
            lastStubPath: null,
            lastPaydownAction: null,
            lastPaydownStatus: null,
            lastPaydownAt: null
        };
    }
    isPathAllowedByConstraint(pathValue, allowedPathPrefixes) {
        if (!allowedPathPrefixes.length) {
            return true;
        }
        const normalizedPath = this.normalizeCorrectionPathPrefix(pathValue);
        for (const candidate of allowedPathPrefixes) {
            const prefix = this.normalizeCorrectionPathPrefix(candidate);
            if (!prefix) {
                continue;
            }
            const isDirectoryPrefix = prefix.endsWith("/");
            if (isDirectoryPrefix) {
                if (normalizedPath.startsWith(prefix)) {
                    return true;
                }
                continue;
            }
            if (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)) {
                return true;
            }
        }
        return false;
    }
    assertCorrectionChangeScope(input) {
        const constraint = input.constraint;
        if (!constraint) {
            return;
        }
        if (input.proposedChanges.length > constraint.maxFiles) {
            throw new Error(`Correction step '${input.step.id}' exceeds file cap (${input.proposedChanges.length}/${constraint.maxFiles}).`);
        }
        const disallowedPaths = input.proposedChanges
            .map((entry) => entry.path)
            .filter((entry) => !this.isPathAllowedByConstraint(entry, constraint.allowedPathPrefixes));
        if (disallowedPaths.length) {
            throw new Error(`Correction step '${input.step.id}' changed disallowed paths: ${disallowedPaths.slice(0, 5).join(", ")}.`);
        }
    }
    assertCorrectionStagedBounds(input) {
        const constraint = input.constraint;
        if (!constraint) {
            return;
        }
        const totalBytes = input.stagedDiffs.reduce((sum, entry) => sum + Math.max(0, Number(entry.diffBytes || 0)), 0);
        if (totalBytes > constraint.maxTotalDiffBytes) {
            throw new Error(`Correction step '${input.step.id}' exceeds diff-size cap (${totalBytes}/${constraint.maxTotalDiffBytes} bytes).`);
        }
        const disallowedPaths = input.stagedDiffs
            .map((entry) => entry.path)
            .filter((entry) => !this.isPathAllowedByConstraint(entry, constraint.allowedPathPrefixes));
        if (disallowedPaths.length) {
            throw new Error(`Correction step '${input.step.id}' staged disallowed paths: ${disallowedPaths.slice(0, 5).join(", ")}.`);
        }
    }
    resolveLightValidationMode() {
        const raw = (process.env.AGENT_LIGHT_VALIDATION_MODE || "enforce").trim().toLowerCase();
        if (raw === "off" || raw === "warn" || raw === "enforce") {
            return raw;
        }
        return "enforce";
    }
    resolveHeavyValidationMode() {
        const raw = (process.env.AGENT_HEAVY_VALIDATION_MODE || "enforce").trim().toLowerCase();
        if (raw === "off" || raw === "warn" || raw === "enforce") {
            return raw;
        }
        return "enforce";
    }
    resolveCorrectionPolicyMode() {
        const raw = (process.env.AGENT_CORRECTION_POLICY_MODE || "enforce").trim().toLowerCase();
        if (raw === "off" || raw === "warn" || raw === "enforce") {
            return raw;
        }
        return "enforce";
    }
    resolveCorrectionConvergenceMode() {
        const raw = (process.env.AGENT_CORRECTION_CONVERGENCE_MODE || "enforce").trim().toLowerCase();
        if (raw === "off" || raw === "warn" || raw === "enforce") {
            return raw;
        }
        return "enforce";
    }
    resolveRunLockStaleSeconds() {
        const parsed = Number(process.env.AGENT_RUN_LOCK_STALE_SECONDS || 1800);
        if (!Number.isFinite(parsed)) {
            return 1800;
        }
        return Math.min(86_400, Math.max(60, Math.floor(parsed)));
    }
    buildRunLockOwner(requestId) {
        return `${process.pid}:${requestId}`;
    }
    async ensureRunExecutionContext(input) {
        const resolved = await ensureRunWorktree({
            projectDir: input.workspaceRoot,
            runId: input.run.id,
            runBranch: input.run.runBranch,
            worktreePath: input.run.worktreePath,
            baseCommitHash: input.run.baseCommitHash
        });
        if (!resolved.runBranch.startsWith("run/")) {
            throw new Error(`Invalid run branch '${resolved.runBranch}'. Run branches must use the run/<runId> namespace.`);
        }
        const isRunInitializationPhase = input.run.status === "queued" && input.run.currentStepIndex === 0;
        const shouldSyncCommitPointers = input.syncCommitPointers ?? isRunInitializationPhase;
        const run = (await this.store.updateAgentRun(input.run.id, {
            runBranch: resolved.runBranch,
            worktreePath: resolved.worktreePath,
            ...(shouldSyncCommitPointers
                ? {
                    baseCommitHash: resolved.baseCommitHash,
                    currentCommitHash: resolved.currentCommitHash,
                    lastValidCommitHash: input.run.lastValidCommitHash ||
                        resolved.currentCommitHash ||
                        input.run.currentCommitHash ||
                        resolved.baseCommitHash
                }
                : {})
        })) || input.run;
        logInfo("agent.run.execution_context", {
            requestId: input.requestId,
            runId: run.id,
            projectId: run.projectId,
            runBranch: run.runBranch,
            worktreePath: run.worktreePath,
            baseCommitHash: run.baseCommitHash,
            currentCommitHash: run.currentCommitHash
        });
        return {
            run,
            executionRoot: resolved.worktreePath
        };
    }
    async recoverRunWorkspaceIfNeeded(input) {
        const dirty = await isWorktreeDirty(input.executionRoot).catch(() => false);
        if (!dirty) {
            return input.run;
        }
        const recoveryRef = input.run.lastValidCommitHash || input.run.currentCommitHash || input.run.baseCommitHash;
        if (!recoveryRef) {
            throw new Error("Run worktree is dirty and no recovery commit hash is available.");
        }
        const currentCommitHash = await resetWorktreeToCommit(input.executionRoot, recoveryRef);
        const updated = (await this.store.updateAgentRun(input.run.id, {
            baseCommitHash: currentCommitHash || recoveryRef,
            currentCommitHash: currentCommitHash || recoveryRef
        })) || input.run;
        logInfo("agent.run.recovered", {
            requestId: input.requestId,
            runId: input.run.id,
            projectId: input.run.projectId,
            recoveryRef,
            currentCommitHash: updated.currentCommitHash
        });
        return updated;
    }
    async rollbackRunToLastValid(input) {
        const rollbackRef = input.run.lastValidCommitHash || input.run.currentCommitHash || input.run.baseCommitHash;
        if (!rollbackRef) {
            return input.run;
        }
        const rolledBackHash = await resetWorktreeToCommit(input.executionRoot, rollbackRef).catch(() => null);
        const nextHash = rolledBackHash || rollbackRef;
        const updated = (await this.store.updateAgentRun(input.run.id, {
            baseCommitHash: nextHash,
            currentCommitHash: nextHash
        })) || input.run;
        logInfo("agent.run.rolled_back", {
            requestId: input.requestId,
            runId: input.run.id,
            projectId: input.run.projectId,
            reason: input.reason,
            rollbackRef: nextHash
        });
        return updated;
    }
    async resolveProjectMetadata(input) {
        const existing = await this.store.getProjectMetadata(input.project.id);
        if (existing) {
            return existing;
        }
        const analyzed = await analyzeProjectForMemory(input.projectRoot);
        const created = await this.store.upsertProjectMetadata({
            projectId: input.project.id,
            orgId: input.project.orgId,
            workspaceId: input.project.workspaceId,
            architectureSummary: analyzed.architectureSummary,
            stackInfo: analyzed.stackInfo
        });
        logInfo("agent.memory.generated", {
            requestId: input.requestId,
            projectId: input.project.id,
            framework: created.architectureSummary.framework,
            database: created.architectureSummary.database,
            auth: created.architectureSummary.auth,
            payment: created.architectureSummary.payment
        });
        return created;
    }
    async buildPlannerMemoryContext(input) {
        const metadata = await this.resolveProjectMetadata(input);
        const recentCommits = await listCommits(input.projectRoot, 8).catch(() => []);
        const recentRuns = await this.store.listAgentRunsByProject(input.project.id, 3);
        return {
            stackInfo: metadata.stackInfo,
            architectureSummary: metadata.architectureSummary,
            recentCommits: recentCommits.map((entry) => ({
                hash: entry.hash,
                shortHash: entry.shortHash,
                subject: entry.subject,
                date: entry.date
            })),
            recentAgentRuns: recentRuns.map((run) => ({
                id: run.id,
                goal: run.goal,
                status: run.status,
                updatedAt: run.updatedAt,
                errorMessage: run.errorMessage || null
            }))
        };
    }
    async getRunDetail(projectId, runId) {
        const run = await this.store.getAgentRunById(projectId, runId);
        if (!run) {
            return undefined;
        }
        const steps = await this.store.listAgentStepsByRun(run.id);
        const detail = this.buildRunDetail(run, steps);
        return {
            ...detail,
            stubDebt: await this.buildRunStubDebtSummary(run)
        };
    }
    async queueRuntimeCorrection(input) {
        const classification = classifyFailureForCorrection({
            phase: "goal",
            failedStepId: input.failedStep.id,
            attempt: input.attempt,
            runtimeLogs: input.runtimeLogs,
            failureReport: input.failureReport,
            limits: {
                maxFilesPerStep: Number(process.env.AGENT_FS_MAX_FILES_PER_STEP || 15),
                maxTotalDiffBytes: Number(process.env.AGENT_FS_MAX_TOTAL_DIFF_BYTES || 400_000)
            }
        });
        const correction = await this.planner.planRuntimeCorrection({
            goal: input.run.goal,
            providerId: input.run.providerId,
            model: input.run.model,
            project: input.project,
            projectRoot: input.executionRoot,
            memory: input.plannerMemory,
            plannerTimeoutMs: input.executionConfig.plannerTimeoutMs,
            failedStepId: input.failedStep.id,
            runtimeLogs: input.runtimeLogs,
            attempt: input.attempt,
            failureReport: input.failureReport,
            correctionConstraint: classification.constraint
        });
        const correctionReasoning = {
            phase: "goal",
            attempt: input.attempt,
            failedStepId: input.failedStep.id,
            reason: input.failedStepRecord.errorMessage || "Runtime verification failed.",
            runtimeLogTail: tailText(input.runtimeLogs || "", 3_000),
            classification: {
                intent: classification.intent,
                failedChecks: classification.failedChecks,
                failureKinds: classification.failureKinds,
                rationale: classification.rationale
            },
            constraint: classification.constraint,
            createdAt: new Date().toISOString()
        };
        const correctionStep = {
            ...correction,
            id: `runtime-correction-${input.attempt}`,
            type: "modify",
            input: {
                ...correction.input,
                _deepCorrection: correctionReasoning
            }
        };
        const retryStep = {
            ...input.failedStep,
            id: normalizeStepId(input.failedStep.id, `runtime-retry-${input.attempt}`),
            type: "verify",
            tool: "run_preview_container"
        };
        input.run.plan.steps.splice(input.stepIndex + 1, 0, correctionStep, retryStep);
        logInfo("agent.runtime_correction.queued", {
            requestId: input.requestId,
            runId: input.run.id,
            projectId: input.run.projectId,
            attempt: input.attempt,
            correctionStepId: correctionStep.id,
            retryStepId: retryStep.id,
            reasoning: correctionReasoning
        });
        return ((await this.store.updateAgentRun(input.run.id, {
            status: "correcting",
            currentStepIndex: input.stepIndex + 1,
            plan: input.run.plan,
            lastStepId: input.failedStepRecord.id,
            errorMessage: null,
            errorDetails: null,
            finishedAt: null
        })) || input.run);
    }
    async queueHeavyValidationCorrection(input) {
        const failedStepId = `heavy-validation-${input.attempt}`;
        const classification = classifyFailureForCorrection({
            phase: "optimization",
            failedStepId,
            attempt: input.attempt,
            runtimeLogs: `${input.heavyValidationSummary}\n\n${input.heavyValidationLogs}`.trim(),
            failureReport: input.heavyFailureReport,
            limits: {
                maxFilesPerStep: Number(process.env.AGENT_FS_MAX_FILES_PER_STEP || 15),
                maxTotalDiffBytes: Number(process.env.AGENT_FS_MAX_TOTAL_DIFF_BYTES || 400_000)
            }
        });
        const correction = await this.planner.planRuntimeCorrection({
            goal: input.run.goal,
            providerId: input.run.providerId,
            model: input.run.model,
            project: input.project,
            projectRoot: input.executionRoot,
            memory: input.plannerMemory,
            plannerTimeoutMs: input.executionConfig.plannerTimeoutMs,
            failedStepId,
            runtimeLogs: `${input.heavyValidationSummary}\n\n${input.heavyValidationLogs}`.trim(),
            attempt: input.attempt,
            failureReport: input.heavyFailureReport,
            correctionConstraint: classification.constraint
        });
        const correctionReasoning = {
            phase: "optimization",
            attempt: input.attempt,
            failedStepId,
            summary: input.heavyValidationSummary,
            failureCount: input.heavyFailureReport?.failures.length || 0,
            runtimeLogTail: tailText(input.heavyValidationLogs || "", 3_000),
            classification: {
                intent: classification.intent,
                failedChecks: classification.failedChecks,
                failureKinds: classification.failureKinds,
                rationale: classification.rationale
            },
            constraint: classification.constraint,
            createdAt: new Date().toISOString()
        };
        const correctionStep = {
            ...correction,
            id: `validation-correction-${input.attempt}`,
            type: "modify",
            input: {
                ...correction.input,
                _deepCorrection: correctionReasoning
            }
        };
        input.run.plan.steps.splice(input.stepIndex + 1, 0, correctionStep);
        logInfo("agent.heavy_validation_correction.queued", {
            requestId: input.requestId,
            runId: input.run.id,
            projectId: input.run.projectId,
            attempt: input.attempt,
            correctionStepId: correctionStep.id,
            summary: input.heavyValidationSummary,
            reasoning: correctionReasoning
        });
        return ((await this.store.updateAgentRun(input.run.id, {
            status: "optimizing",
            currentStepIndex: input.stepIndex + 1,
            plan: input.run.plan,
            errorMessage: null,
            errorDetails: null,
            finishedAt: null
        })) || input.run);
    }
    async queuePrecommitInvariantCorrection(input) {
        if (!input.correctionProfile.shouldAutoCorrect || input.correctionProfile.reason === null) {
            return null;
        }
        const correctionPlan = await this.planner.planCorrection({
            originalIntent: input.run.goal,
            validationSummary: input.validationSummary,
            correctionProfile: input.correctionProfile
        });
        if (!correctionPlan.steps.length) {
            return null;
        }
        const updatedSteps = [...input.run.plan.steps];
        updatedSteps.splice(input.failedStep.stepIndex + 1, 0, ...correctionPlan.steps);
        const updatedPlan = withAgentPlanCapabilities({
            ...input.run.plan,
            steps: updatedSteps
        });
        const nextStepIndex = input.failedStep.stepIndex + 1;
        logInfo("agent.precommit_invariant_correction.queued", {
            requestId: input.requestId,
            runId: input.run.id,
            projectId: input.run.projectId,
            correctionStepIds: correctionPlan.steps.map((step) => step.id),
            blockingCount: input.correctionProfile.blockingCount,
            reason: input.correctionProfile.reason,
            architectureModules: input.correctionProfile.architectureModules || []
        });
        return ((await this.store.updateAgentRun(input.run.id, {
            status: "correcting",
            currentStepIndex: nextStepIndex,
            plan: updatedPlan,
            lastStepId: input.failedStep.id,
            errorMessage: null,
            errorDetails: null,
            finishedAt: null
        })) || input.run);
    }
    async executeLoop(input) {
        let run = input.run;
        const workspaceRoot = this.store.getProjectWorkspacePath(input.project);
        const lockOwner = this.buildRunLockOwner(input.requestId);
        const acquired = await this.store.acquireAgentRunExecutionLock(run.id, lockOwner, this.resolveRunLockStaleSeconds());
        if (!acquired) {
            const existing = await this.store.getAgentRun(run.id);
            if (!existing) {
                throw new Error("Agent run not found.");
            }
            throw new Error("Agent run is currently locked by another worker.");
        }
        run = acquired;
        try {
            const steps = await this.store.listAgentStepsByRun(run.id);
            const executionMode = input.executionMode || "isolated";
            const executionProfile = input.executionProfile || "default";
            const executionConfig = input.executionConfig || this.resolveExecutionConfig({
                metadata: run.metadata,
                executionProfile
            });
            let projectRoot = workspaceRoot;
            if (executionMode === "project") {
                // Project-mode runs mutate the live workspace. Only sync from HEAD when initializing a brand-new
                // execution; intra-run continuation (including validation auto-correction resumes) must trust
                // the run's persisted commit pointers.
                const isInitialProjectExecution = run.status === "queued" && run.currentStepIndex === 0 && steps.length === 0;
                if (isInitialProjectExecution) {
                    const currentCommitHash = await readCurrentCommitHash(workspaceRoot);
                    run =
                        (await this.store.updateAgentRun(run.id, {
                            runBranch: null,
                            worktreePath: null,
                            baseCommitHash: run.baseCommitHash || currentCommitHash || null,
                            currentCommitHash: currentCommitHash || null,
                            lastValidCommitHash: run.lastValidCommitHash || currentCommitHash || run.currentCommitHash || run.baseCommitHash || null
                        })) || run;
                }
            }
            else {
                const executionContext = await this.ensureRunExecutionContext({
                    run,
                    workspaceRoot,
                    requestId: input.requestId,
                    syncCommitPointers: run.status === "queued" && run.currentStepIndex === 0
                });
                run = executionContext.run;
                projectRoot = executionContext.executionRoot;
                run = await this.recoverRunWorkspaceIfNeeded({
                    run,
                    executionRoot: projectRoot,
                    requestId: input.requestId
                });
            }
            run =
                (await this.store.updateAgentRun(run.id, {
                    status: "running",
                    errorMessage: null,
                    errorDetails: null,
                    finishedAt: null
                })) || run;
            let runtimeCorrectionCount = this.countRuntimeCorrectionSteps(run.plan);
            let heavyCorrectionCount = this.countHeavyCorrectionSteps(run.plan);
            let lastRuntimeFailureSignature = null;
            let lastHeavyBlockingCount = null;
            const lightValidationMode = executionConfig.lightValidationMode;
            const heavyValidationMode = executionConfig.heavyValidationMode;
            const maxFilesPerStep = Number(process.env.AGENT_FS_MAX_FILES_PER_STEP || 15);
            const maxTotalDiffBytes = Number(process.env.AGENT_FS_MAX_TOTAL_DIFF_BYTES || 400_000);
            const fileSession = await FileSession.create({
                projectId: run.projectId,
                projectRoot,
                baseCommitHash: run.currentCommitHash || run.baseCommitHash || undefined,
                options: {
                    maxFilesPerStep,
                    maxTotalDiffBytes,
                    maxFileBytes: Number(process.env.AGENT_FS_MAX_FILE_BYTES || 1_500_000),
                    allowEnvMutation: process.env.AGENT_FS_ALLOW_ENV_MUTATION === "true"
                }
            });
            for (let stepIndex = run.currentStepIndex; stepIndex < run.plan.steps.length; stepIndex += 1) {
                const step = run.plan.steps[stepIndex];
                const lockStillHeld = await this.store.refreshAgentRunExecutionLock(run.id, lockOwner);
                if (!lockStillHeld) {
                    throw new Error("Agent run execution lock was lost during execution.");
                }
                const executed = await this.executor.executeStep(step, {
                    project: input.project,
                    projectRoot,
                    requestId: input.requestId
                });
                let status = executed.status;
                let errorMessage = executed.error || null;
                let output = executed.output || {};
                let commitHash = null;
                let runtimeStatus = null;
                let runtimeLogs = "";
                let heavyFailureReport;
                let queueHeavyCorrectionAttempt = null;
                let heavyRollbackReason = null;
                const correctionConstraint = this.isCorrectionStep(step) ? this.resolveCorrectionConstraintForStep(step) : null;
                if (status === "completed" && this.isMutatingStep(step)) {
                    try {
                        const proposedChanges = this.extractProposedChanges(output);
                        if (!proposedChanges.length) {
                            if (this.isCorrectionStep(step)) {
                                throw new Error(`Correction step '${step.id}' produced no proposed changes.`);
                            }
                            output = {
                                ...output,
                                stagedFileCount: 0,
                                stagedDiffs: []
                            };
                        }
                        else {
                            if (this.isCorrectionStep(step)) {
                                this.assertCorrectionChangeScope({
                                    step,
                                    proposedChanges,
                                    constraint: correctionConstraint
                                });
                            }
                            fileSession.beginStep(step.id, stepIndex);
                            for (const change of proposedChanges) {
                                await fileSession.stageChange(change);
                            }
                            if (this.isCorrectionStep(step)) {
                                const stagedForConstraint = fileSession.getStagedDiffs().map((entry) => ({
                                    path: entry.path,
                                    diffBytes: entry.diffBytes
                                }));
                                this.assertCorrectionStagedBounds({
                                    step,
                                    stagedDiffs: stagedForConstraint,
                                    constraint: correctionConstraint
                                });
                            }
                            const validation = fileSession.validateStep();
                            await fileSession.applyStepChanges();
                            const enforcePrecommitInvariants = input.project.templateId === "canonical-backend" && step.tool === "ai_mutation";
                            if (enforcePrecommitInvariants) {
                                const precommitInvariant = await runPrecommitInvariantGuard({
                                    projectRoot,
                                    stagedChanges: fileSession.getStagedDiffs()
                                });
                                if (!precommitInvariant.ok) {
                                    const invariantError = new Error(precommitInvariant.summary);
                                    invariantError.name = "PrecommitInvariantViolationError";
                                    invariantError.code = "INVARIANT_VIOLATION";
                                    invariantError.precommitInvariantResult = precommitInvariant;
                                    throw invariantError;
                                }
                            }
                            const lightValidation = lightValidationMode === "off"
                                ? {
                                    ok: true,
                                    blockingCount: 0,
                                    warningCount: 0,
                                    violations: []
                                }
                                : await runLightProjectValidation(projectRoot);
                            const lightValidationSummary = lightValidation.violations.slice(0, 12).map((entry) => ({
                                ruleId: entry.ruleId,
                                severity: entry.severity,
                                file: entry.file,
                                target: entry.target,
                                message: entry.message
                            }));
                            if (!lightValidation.ok && lightValidationMode === "enforce") {
                                const summaryText = lightValidationSummary
                                    .slice(0, 3)
                                    .map((entry) => `${entry.ruleId} @ ${entry.file}: ${entry.message}`)
                                    .join(" | ");
                                throw new Error(`Light validation failed with ${lightValidation.blockingCount} blocking violations.${summaryText ? ` ${summaryText}` : ""}`);
                            }
                            commitHash = await fileSession.commitStep({
                                agentRunId: run.id,
                                stepIndex,
                                stepId: step.id,
                                summary: this.commitMessageForStep(run.id, stepIndex, step, run.goal)
                            });
                            if (this.isCorrectionStep(step) && !commitHash) {
                                throw new Error(`Correction step '${step.id}' produced no commit. Silent patching is blocked.`);
                            }
                            run =
                                (await this.store.updateAgentRun(run.id, {
                                    baseCommitHash: fileSession.baseCommitHash,
                                    currentCommitHash: fileSession.currentCommitHash,
                                    lastValidCommitHash: fileSession.currentCommitHash || run.lastValidCommitHash || fileSession.baseCommitHash || null
                                })) || run;
                            const stagedDiffs = fileSession.getLastCommittedDiffs();
                            output = {
                                ...output,
                                stagedFileCount: stagedDiffs.length,
                                stagedDiffs: stagedDiffs.map((entry) => ({
                                    path: entry.path,
                                    type: entry.type,
                                    previousContentHash: entry.previousContentHash,
                                    nextContentHash: entry.nextContentHash,
                                    diffPreview: entry.diffPreview
                                })),
                                validation,
                                lightValidation: {
                                    mode: lightValidationMode,
                                    ok: lightValidation.ok,
                                    blockingCount: lightValidation.blockingCount,
                                    warningCount: lightValidation.warningCount,
                                    violations: lightValidationSummary
                                },
                                runBranch: run.runBranch,
                                worktreePath: run.worktreePath,
                                baseCommitHash: run.baseCommitHash,
                                currentCommitHash: run.currentCommitHash
                            };
                        }
                    }
                    catch (error) {
                        await fileSession.abortStep().catch(() => undefined);
                        const precommitInvariant = this.toPrecommitInvariantResult(error);
                        const transactionError = serializeError(error);
                        if (precommitInvariant) {
                            transactionError.code = "INVARIANT_VIOLATION";
                        }
                        status = "failed";
                        errorMessage = `Step transaction failed: ${String(error.message || error)}`;
                        output = {
                            ...output,
                            transactionError,
                            ...(precommitInvariant
                                ? {
                                    invariantViolation: {
                                        reason: "invariant_violation",
                                        summary: precommitInvariant.summary,
                                        blockingCount: precommitInvariant.blockingCount,
                                        warningCount: precommitInvariant.warningCount,
                                        violations: precommitInvariant.violations.slice(0, 20)
                                    }
                                }
                                : {})
                        };
                    }
                }
                if (this.isRuntimeVerifyStep(step)) {
                    const verification = this.runtimeVerificationOutcome({
                        status,
                        output,
                        errorMessage
                    });
                    runtimeStatus = verification.runtimeStatus;
                    runtimeLogs = verification.logs;
                    if (!verification.ok) {
                        status = "failed";
                        errorMessage = verification.reason;
                        const signature = this.runtimeFailureSignature(errorMessage, runtimeLogs);
                        const repeatedSignature = runtimeCorrectionCount > 0 && lastRuntimeFailureSignature !== null && signature === lastRuntimeFailureSignature;
                        if (repeatedSignature && executionConfig.correctionConvergenceMode !== "off") {
                            const message = `Runtime correction did not converge: repeated failure signature after ${runtimeCorrectionCount} correction attempt(s).`;
                            if (executionConfig.correctionConvergenceMode === "enforce") {
                                heavyRollbackReason = message;
                                errorMessage = message;
                                output = {
                                    ...output,
                                    runtimeStatus: "failed",
                                    runtimeConvergence: {
                                        ok: false,
                                        repeatedSignature: true,
                                        signature,
                                        mode: executionConfig.correctionConvergenceMode
                                    }
                                };
                            }
                            else {
                                output = {
                                    ...output,
                                    runtimeStatus: "failed",
                                    runtimeConvergence: {
                                        ok: false,
                                        repeatedSignature: true,
                                        signature,
                                        mode: executionConfig.correctionConvergenceMode,
                                        warning: message
                                    }
                                };
                            }
                        }
                        else {
                            output = {
                                ...output,
                                runtimeStatus: "failed"
                            };
                        }
                        lastRuntimeFailureSignature = signature;
                    }
                    else {
                        lastRuntimeFailureSignature = null;
                        output = {
                            ...output,
                            runtimeStatus: "healthy"
                        };
                    }
                }
                const doneCandidate = stepIndex + 1 >= run.plan.steps.length;
                if (status === "completed" && doneCandidate && heavyValidationMode !== "off") {
                    run =
                        (await this.store.updateAgentRun(run.id, {
                            status: "validating",
                            errorMessage: null,
                            errorDetails: null,
                            finishedAt: null
                        })) || run;
                    try {
                        const validationRef = run.currentCommitHash || (await readCurrentCommitHash(projectRoot));
                        const heavyValidation = await runValidationForTemplateProfile({
                            templateId: input.project.templateId,
                            projectRoot,
                            ref: validationRef
                        });
                        output = {
                            ...output,
                            heavyValidation: {
                                mode: heavyValidationMode,
                                ok: heavyValidation.ok,
                                blockingCount: heavyValidation.blockingCount,
                                warningCount: heavyValidation.warningCount,
                                checks: heavyValidation.checks,
                                summary: heavyValidation.summary,
                                failures: heavyValidation.failures
                            }
                        };
                        if (!heavyValidation.ok) {
                            const previousBlocking = lastHeavyBlockingCount;
                            const regressionDetected = previousBlocking !== null && heavyValidation.blockingCount >= previousBlocking;
                            const convergenceMessage = previousBlocking === null
                                ? null
                                : `Heavy validation did not converge: blocking count ${previousBlocking} -> ${heavyValidation.blockingCount}.`;
                            if (regressionDetected && executionConfig.correctionConvergenceMode !== "off") {
                                if (executionConfig.correctionConvergenceMode === "enforce") {
                                    status = "failed";
                                    heavyRollbackReason = convergenceMessage;
                                    errorMessage = convergenceMessage;
                                }
                                output = {
                                    ...output,
                                    heavyValidation: {
                                        ...output.heavyValidation,
                                        convergence: {
                                            ok: false,
                                            mode: executionConfig.correctionConvergenceMode,
                                            previousBlockingCount: previousBlocking,
                                            currentBlockingCount: heavyValidation.blockingCount,
                                            warning: executionConfig.correctionConvergenceMode === "warn" ? convergenceMessage : undefined
                                        }
                                    }
                                };
                            }
                            lastHeavyBlockingCount = heavyValidation.blockingCount;
                            if (status === "completed") {
                                if (heavyCorrectionCount < executionConfig.maxHeavyCorrectionAttempts) {
                                    queueHeavyCorrectionAttempt = heavyCorrectionCount + 1;
                                    runtimeLogs = heavyValidation.logs;
                                    if (heavyValidation.failures.length > 0) {
                                        heavyFailureReport = {
                                            summary: heavyValidation.summary,
                                            failures: heavyValidation.failures.slice(0, 25).map((entry) => ({
                                                sourceCheckId: entry.sourceCheckId,
                                                kind: entry.kind,
                                                code: entry.code,
                                                message: entry.message,
                                                file: entry.file,
                                                line: entry.line,
                                                column: entry.column,
                                                excerpt: entry.excerpt
                                            }))
                                        };
                                    }
                                }
                                else {
                                    status = "failed";
                                    heavyRollbackReason = `Heavy validation failed after ${heavyCorrectionCount}/${executionConfig.maxHeavyCorrectionAttempts} correction attempts.`;
                                    errorMessage = heavyRollbackReason;
                                }
                            }
                        }
                        else {
                            lastHeavyBlockingCount = null;
                        }
                    }
                    catch (error) {
                        status = "failed";
                        heavyRollbackReason = "Heavy validation execution failed.";
                        errorMessage = `${heavyRollbackReason} ${String(error.message || error)}`;
                        output = {
                            ...output,
                            heavyValidationError: serializeError(error)
                        };
                    }
                }
                if (this.isCorrectionStep(step) && executionConfig.correctionPolicyMode !== "off") {
                    const correctionPolicy = evaluateCorrectionPolicy({
                        step,
                        status,
                        errorMessage,
                        commitHash,
                        outputPayload: output,
                        resolvedConstraint: correctionConstraint,
                        maxFilesPerStep,
                        maxTotalDiffBytes
                    });
                    output = {
                        ...output,
                        correctionPolicy: {
                            ok: correctionPolicy.ok,
                            mode: executionConfig.correctionPolicyMode,
                            blockingCount: correctionPolicy.blockingCount,
                            warningCount: correctionPolicy.warningCount,
                            summary: correctionPolicy.summary,
                            violations: correctionPolicy.violations
                        }
                    };
                    if (!correctionPolicy.ok && status === "completed" && executionConfig.correctionPolicyMode === "enforce") {
                        const message = `Correction policy violation: ${correctionPolicy.summary}`;
                        status = "failed";
                        errorMessage = message;
                        heavyRollbackReason = heavyRollbackReason || message;
                    }
                }
                if (status === "failed") {
                    output = {
                        ...output,
                        failureDetails: this.buildStepFailureDetails({
                            run,
                            step,
                            stepIndex,
                            errorMessage,
                            output,
                            runtimeStatus,
                            runtimeLogs,
                            finishedAt: executed.finishedAt
                        })
                    };
                }
                const stepRecord = await this.store.createAgentStep({
                    runId: run.id,
                    projectId: run.projectId,
                    stepIndex,
                    stepId: step.id,
                    type: step.type,
                    tool: step.tool,
                    inputPayload: step.input,
                    outputPayload: output,
                    status,
                    errorMessage,
                    commitHash,
                    runtimeStatus,
                    startedAt: executed.startedAt,
                    finishedAt: executed.finishedAt
                });
                steps.push(stepRecord);
                steps.sort((a, b) => a.stepIndex - b.stepIndex || a.attempt - b.attempt || a.createdAt.localeCompare(b.createdAt));
                if (queueHeavyCorrectionAttempt !== null) {
                    try {
                        const heavyValidationPayload = output.heavyValidation &&
                            typeof output.heavyValidation === "object" &&
                            !Array.isArray(output.heavyValidation)
                            ? output.heavyValidation
                            : {};
                        const heavySummary = typeof heavyValidationPayload.summary === "string"
                            ? heavyValidationPayload.summary
                            : "Heavy validation failed.";
                        run = await this.queueHeavyValidationCorrection({
                            run,
                            stepIndex,
                            attempt: queueHeavyCorrectionAttempt,
                            heavyValidationSummary: heavySummary,
                            heavyValidationLogs: runtimeLogs || heavySummary,
                            heavyFailureReport,
                            project: input.project,
                            executionRoot: projectRoot,
                            requestId: input.requestId,
                            plannerMemory: input.plannerMemory,
                            executionConfig
                        });
                        heavyCorrectionCount = queueHeavyCorrectionAttempt;
                        continue;
                    }
                    catch (error) {
                        const correctionMessage = `Heavy validation correction planning failed: ${String(error.message || error)}`;
                        run =
                            (await this.store.updateAgentRun(run.id, {
                                status: "failed",
                                currentStepIndex: stepIndex,
                                lastStepId: stepRecord.id,
                                errorMessage: correctionMessage,
                                errorDetails: this.buildRunFailureDetailsFromStepRecord({
                                    run,
                                    stepRecord,
                                    category: "heavy_validation_correction_planning_failure",
                                    errorMessage: correctionMessage,
                                    plannerError: error
                                }),
                                finishedAt: new Date().toISOString()
                            })) || run;
                        return this.buildRunDetail(run, steps);
                    }
                }
                if (status === "failed" &&
                    this.isRuntimeVerifyStep(step) &&
                    runtimeCorrectionCount < executionConfig.maxRuntimeCorrectionAttempts) {
                    const attempt = runtimeCorrectionCount + 1;
                    try {
                        run = await this.queueRuntimeCorrection({
                            run,
                            failedStep: step,
                            failedStepRecord: stepRecord,
                            stepIndex,
                            attempt,
                            runtimeLogs,
                            project: input.project,
                            executionRoot: projectRoot,
                            requestId: input.requestId,
                            plannerMemory: input.plannerMemory,
                            executionConfig
                        });
                        runtimeCorrectionCount = attempt;
                        continue;
                    }
                    catch (error) {
                        const correctionMessage = `Runtime correction planning failed: ${String(error.message || error)}`;
                        run =
                            (await this.store.updateAgentRun(run.id, {
                                status: "failed",
                                currentStepIndex: stepIndex,
                                lastStepId: stepRecord.id,
                                errorMessage: correctionMessage,
                                errorDetails: this.buildRunFailureDetailsFromStepRecord({
                                    run,
                                    stepRecord,
                                    category: "runtime_correction_planning_failure",
                                    errorMessage: correctionMessage,
                                    plannerError: error
                                }),
                                finishedAt: new Date().toISOString()
                            })) || run;
                        return this.buildRunDetail(run, steps);
                    }
                }
                if (status === "failed") {
                    if (!heavyRollbackReason &&
                        this.isRuntimeVerifyStep(step) &&
                        runtimeCorrectionCount >= executionConfig.maxRuntimeCorrectionAttempts) {
                        heavyRollbackReason = `Runtime correction limit reached (${runtimeCorrectionCount}/${executionConfig.maxRuntimeCorrectionAttempts}).`;
                        errorMessage = heavyRollbackReason;
                    }
                    if (heavyRollbackReason) {
                        run = await this.rollbackRunToLastValid({
                            run,
                            executionRoot: projectRoot,
                            requestId: input.requestId,
                            reason: heavyRollbackReason
                        });
                    }
                    run =
                        (await this.store.updateAgentRun(run.id, {
                            status: "failed",
                            currentStepIndex: stepIndex,
                            lastStepId: stepRecord.id,
                            errorMessage: errorMessage || "Agent step failed.",
                            errorDetails: this.buildRunFailureDetailsFromStepRecord({
                                run,
                                stepRecord,
                                category: heavyRollbackReason && heavyRollbackReason.startsWith("Runtime correction limit reached")
                                    ? "runtime_correction_limit"
                                    : heavyRollbackReason && heavyRollbackReason.startsWith("Heavy validation failed after")
                                        ? "heavy_validation_correction_limit"
                                        : heavyRollbackReason && heavyRollbackReason.startsWith("Heavy validation did not converge")
                                            ? "heavy_validation_convergence"
                                            : heavyRollbackReason && heavyRollbackReason.startsWith("Runtime correction did not converge")
                                                ? "runtime_correction_convergence"
                                                : "step_failure",
                                errorMessage: errorMessage || "Agent step failed.",
                                rollbackReason: heavyRollbackReason
                            }),
                            finishedAt: new Date().toISOString()
                        })) || run;
                    return this.buildRunDetail(run, steps);
                }
                const nextStepIndex = stepIndex + 1;
                const done = nextStepIndex >= run.plan.steps.length;
                run =
                    (await this.store.updateAgentRun(run.id, {
                        status: done ? "complete" : "running",
                        currentStepIndex: nextStepIndex,
                        lastStepId: stepRecord.id,
                        errorMessage: null,
                        errorDetails: null,
                        finishedAt: done ? new Date().toISOString() : null,
                        plan: run.plan
                    })) || run;
            }
            return this.buildRunDetail(run, steps);
        }
        finally {
            await this.store.releaseAgentRunExecutionLock(run.id, lockOwner).catch(() => undefined);
        }
    }
    async persistRunValidationSnapshot(input) {
        return ((await this.store.updateAgentRun(input.run.id, {
            validationStatus: input.validation.ok ? "passed" : "failed",
            validationResult: {
                targetPath: input.targetPath,
                validation: input.validation
            },
            validatedAt: new Date().toISOString()
        })) || input.run);
    }
    async executeWithValidationAutoCorrection(input) {
        const executionConfig = input.executionConfig ||
            this.resolveExecutionConfig({
                metadata: input.run.metadata,
                executionProfile: input.executionProfile
            });
        let detail = await this.executeLoop({
            ...input,
            executionConfig
        });
        const learningProjectRoot = this.store.getProjectWorkspacePath(input.project);
        const autoCorrectionEligible = (input.executionProfile || "default") === "builder" &&
            detail.run.plan.steps.some((step) => step.tool === "ai_mutation");
        let pendingInvariantContext = null;
        let pendingLearningAttempt = null;
        const invariantRetriesByAttempt = new Map();
        if (!autoCorrectionEligible) {
            return detail;
        }
        while (detail.run.status !== "complete") {
            const failedStep = detail.steps[detail.steps.length - 1];
            const invariantFailure = this.extractInvariantViolationFromStep(failedStep);
            if (!invariantFailure || !failedStep) {
                return detail;
            }
            const attemptsUsed = Math.max(0, detail.run.correctionAttempts || 0);
            const invariantRetries = (invariantRetriesByAttempt.get(attemptsUsed) || 0) + 1;
            invariantRetriesByAttempt.set(attemptsUsed, invariantRetries);
            if (invariantRetries > MAX_PRECOMMIT_INVARIANT_RETRIES_PER_ATTEMPT) {
                logInfo("agent.precommit_invariant_correction.retry_limit", {
                    requestId: input.requestId,
                    runId: detail.run.id,
                    projectId: detail.run.projectId,
                    attempt: attemptsUsed,
                    retries: invariantRetries,
                    maxRetries: MAX_PRECOMMIT_INVARIANT_RETRIES_PER_ATTEMPT,
                    summary: invariantFailure.summary
                });
                return detail;
            }
            let resumedRun = null;
            try {
                resumedRun = await this.queuePrecommitInvariantCorrection({
                    run: detail.run,
                    failedStep,
                    correctionProfile: invariantFailure.correctionProfile,
                    validationSummary: invariantFailure.context,
                    requestId: input.requestId
                });
            }
            catch (error) {
                logInfo("agent.precommit_invariant_correction.plan_failed", {
                    requestId: input.requestId,
                    runId: detail.run.id,
                    projectId: detail.run.projectId,
                    attempt: attemptsUsed,
                    summary: invariantFailure.summary,
                    error: serializeError(error)
                });
                return detail;
            }
            if (!resumedRun) {
                return detail;
            }
            detail = await this.executeLoop({
                ...input,
                run: resumedRun,
                executionConfig
            });
        }
        while (detail.run.status === "complete") {
            const validationOutput = await this.validateRunOutput({
                project: input.project,
                runId: detail.run.id,
                requestId: `${input.requestId}:auto-validate:${detail.run.correctionAttempts ?? 0}`
            });
            const persistedRun = await this.persistRunValidationSnapshot({
                run: detail.run,
                validation: validationOutput.validation,
                targetPath: validationOutput.targetPath
            });
            detail = this.buildRunDetail(persistedRun, detail.steps);
            let persistedLearningResult = null;
            if (pendingLearningAttempt) {
                persistedLearningResult = await this.persistLearningTelemetry({
                    projectRoot: learningProjectRoot,
                    run: persistedRun,
                    steps: detail.steps,
                    pendingAttempt: pendingLearningAttempt,
                    validationAfter: validationOutput.validation
                });
                pendingLearningAttempt = null;
            }
            if (validationOutput.validation.ok) {
                const attemptsUsed = Math.max(0, detail.run.correctionAttempts || 0);
                const shouldQueueDebtResolution = persistedLearningResult?.outcome === "provisionally_fixed" &&
                    Boolean(persistedLearningResult.stubDebtMetadata) &&
                    attemptsUsed < MAX_VALIDATION_AUTO_CORRECTION_ATTEMPTS;
                if (shouldQueueDebtResolution && persistedLearningResult?.stubDebtMetadata) {
                    const debtTargets = this.extractDebtTargetsFromStubMetadata(persistedLearningResult.stubDebtMetadata);
                    const capturedDebtTargets = await this.captureDebtResolutionTargets({
                        projectRoot: learningProjectRoot,
                        debtTargets
                    });
                    const debtProfile = {
                        ...persistedLearningResult.correctionProfile,
                        plannerModeOverride: "debt_resolution",
                        debtTargets
                    };
                    const debtValidationSummary = this.buildDebtResolutionValidationSummary({
                        stubDebtMetadata: persistedLearningResult.stubDebtMetadata
                    });
                    const plannedAttempt = attemptsUsed + 1;
                    let debtPlan = null;
                    try {
                        debtPlan =
                            (await this.buildDeterministicDebtResolutionPlan({
                                run: detail.run,
                                attempt: plannedAttempt,
                                validationSummary: debtValidationSummary,
                                failedStepId: detail.run.lastStepId || "debt-resolution-followup",
                                debtTargets
                            })) ||
                                (await this.planner.planCorrection({
                                    originalIntent: detail.run.goal,
                                    validationSummary: debtValidationSummary,
                                    correctionProfile: debtProfile
                                }));
                    }
                    catch (error) {
                        logWarn("agent.validation_auto_correction.debt_resolution_plan_failed", {
                            requestId: input.requestId,
                            runId: detail.run.id,
                            projectId: detail.run.projectId,
                            attempt: plannedAttempt,
                            error: serializeError(error)
                        });
                    }
                    if (debtPlan?.steps.length) {
                        const updatedPlan = withAgentPlanCapabilities({
                            ...detail.run.plan,
                            steps: [...detail.run.plan.steps, ...debtPlan.steps]
                        });
                        pendingLearningAttempt = {
                            attempt: plannedAttempt,
                            stepIndex: detail.run.plan.steps.length,
                            stepsBeforeCount: detail.steps.length,
                            validationBefore: validationOutput.validation,
                            correctionProfile: debtProfile,
                            beforeCommitHash: detail.run.currentCommitHash || null,
                            debtTargets: capturedDebtTargets,
                            learningEventMetadataExtra: {
                                debtResolutionTriggered: true,
                                debtTargets,
                                sourceOutcome: persistedLearningResult.outcome,
                                sourcePhase: persistedLearningResult.phase,
                                sourceImportRecipeAction: persistedLearningResult.stubDebtMetadata.importRecipeAction
                            }
                        };
                        const resumedRun = (await this.store.updateAgentRun(detail.run.id, {
                            status: "running",
                            plan: updatedPlan,
                            errorMessage: null,
                            errorDetails: null,
                            finishedAt: null
                        })) || detail.run;
                        logInfo("agent.validation_auto_correction.debt_resolution_queued", {
                            requestId: input.requestId,
                            runId: detail.run.id,
                            projectId: detail.run.projectId,
                            attempt: plannedAttempt,
                            debtTargets: debtTargets.map((entry) => entry.path)
                        });
                        detail = await this.executeLoop({
                            ...input,
                            run: resumedRun,
                            executionConfig
                        });
                        if (detail.run.status === "complete") {
                            const correctedRun = (await this.store.updateAgentRun(detail.run.id, {
                                correctionAttempts: plannedAttempt
                            })) || detail.run;
                            detail = this.buildRunDetail(correctedRun, detail.steps);
                            continue;
                        }
                    }
                }
                return detail;
            }
            const correctionProfile = classifyValidationFailure(validationOutput.validation);
            const attemptsUsed = Math.max(0, detail.run.correctionAttempts || 0);
            if (!correctionProfile.shouldAutoCorrect || correctionProfile.reason === null) {
                return detail;
            }
            if (attemptsUsed >= MAX_VALIDATION_AUTO_CORRECTION_ATTEMPTS) {
                return detail;
            }
            const correctionValidationSummary = pendingInvariantContext
                ? `${validationOutput.validation.summary}\nPre-commit invariant violation context: ${pendingInvariantContext}`
                : validationOutput.validation.summary;
            const validationSignal = this.extractValidationSignal(validationOutput.validation);
            const importSignal = this.extractImportSignal(validationSignal);
            const failedStepId = detail.steps[detail.steps.length - 1]?.stepId || detail.run.lastStepId || `validation-auto-${attemptsUsed + 1}`;
            let plannerProfile = correctionProfile;
            let correctionPlan = null;
            let guardrailTriggered = false;
            let resolutionStrategy = "planner";
            let importStats = null;
            let recipeMissReason;
            let recipeExtracted = null;
            let microStallStats = null;
            let phaseGuardrailTriggered = false;
            let phaseEscalationStrategy = null;
            const isImportFailure = this.isImportResolutionFailure(correctionProfile);
            try {
                if (isImportFailure) {
                    importStats = await this.queryImportResolutionPressureStats();
                    const recipeResult = await this.buildDeterministicImportResolutionPlan({
                        run: detail.run,
                        projectRoot: learningProjectRoot,
                        correctionProfile,
                        validationSummary: correctionValidationSummary,
                        attempt: attemptsUsed + 1,
                        failedStepId,
                        stats: importStats,
                        importSignal
                    });
                    if (recipeResult.plan) {
                        correctionPlan = recipeResult.plan;
                        guardrailTriggered = true;
                        resolutionStrategy = "import_recipe";
                        logInfo("agent.validation_auto_correction.import_resolution_guardrail", {
                            requestId: input.requestId,
                            runId: detail.run.id,
                            projectId: detail.run.projectId,
                            attempt: attemptsUsed + 1,
                            strategy: "import_recipe",
                            recentCount: importStats.recentCount,
                            avgDelta: importStats.avgDelta,
                            regressionRate: importStats.regressionRate
                        });
                    }
                    else {
                        recipeMissReason = recipeResult.missReason || "unknown";
                        recipeExtracted = recipeResult.extracted ?? null;
                    }
                    if (!correctionPlan && this.shouldUseImportResolutionGuardrail(correctionProfile, importStats)) {
                        plannerProfile = {
                            ...correctionProfile,
                            architectureCollapse: true
                        };
                        guardrailTriggered = true;
                        resolutionStrategy = "structural_reset_fallback";
                        logInfo("agent.validation_auto_correction.import_resolution_guardrail", {
                            requestId: input.requestId,
                            runId: detail.run.id,
                            projectId: detail.run.projectId,
                            attempt: attemptsUsed + 1,
                            strategy: "structural_reset_fallback",
                            recentCount: importStats.recentCount,
                            avgDelta: importStats.avgDelta,
                            regressionRate: importStats.regressionRate,
                            recipeMissReason,
                            recipeExtracted
                        });
                    }
                    else if (!correctionPlan) {
                        logInfo("agent.validation_auto_correction.import_resolution_guardrail", {
                            requestId: input.requestId,
                            runId: detail.run.id,
                            projectId: detail.run.projectId,
                            attempt: attemptsUsed + 1,
                            strategy: "recipe_miss_planner_continue",
                            recentCount: importStats.recentCount,
                            avgDelta: importStats.avgDelta,
                            regressionRate: importStats.regressionRate,
                            recipeMissReason,
                            recipeExtracted
                        });
                    }
                }
            }
            catch (error) {
                logWarn("agent.validation_auto_correction.import_resolution_guardrail_failed", {
                    requestId: input.requestId,
                    runId: detail.run.id,
                    projectId: detail.run.projectId,
                    attempt: attemptsUsed + 1,
                    ...serializeError(error)
                });
            }
            try {
                if (!correctionPlan && this.isMicroTargetedProfile(plannerProfile)) {
                    microStallStats = await this.queryMicroTargetedStallPressureStats(detail.run);
                    if (this.shouldUseMicroTargetedStallGuardrail(microStallStats)) {
                        phaseEscalationStrategy = this.resolveMicroTargetedEscalation(plannerProfile, microStallStats);
                        plannerProfile = {
                            ...plannerProfile,
                            plannerModeOverride: phaseEscalationStrategy,
                            ...(phaseEscalationStrategy === "architecture_reconstruction" ? { architectureCollapse: true } : {})
                        };
                        phaseGuardrailTriggered = true;
                        logInfo("agent.validation_auto_correction.micro_targeted_stall_guardrail", {
                            requestId: input.requestId,
                            runId: detail.run.id,
                            projectId: detail.run.projectId,
                            attempt: attemptsUsed + 1,
                            escalation: phaseEscalationStrategy,
                            sessionMicroRuns: microStallStats.sessionMicroRuns,
                            sessionStalledRuns: microStallStats.sessionStalledRuns,
                            sessionStallRate: microStallStats.sessionStallRate,
                            runConsecutiveStalls: microStallStats.runConsecutiveStalls
                        });
                    }
                }
            }
            catch (error) {
                logWarn("agent.validation_auto_correction.micro_targeted_stall_guardrail_failed", {
                    requestId: input.requestId,
                    runId: detail.run.id,
                    projectId: detail.run.projectId,
                    attempt: attemptsUsed + 1,
                    ...serializeError(error)
                });
            }
            try {
                correctionPlan =
                    correctionPlan ||
                        (await this.planner.planCorrection({
                            originalIntent: detail.run.goal,
                            validationSummary: correctionValidationSummary,
                            correctionProfile: plannerProfile
                        }));
            }
            catch (error) {
                logInfo("agent.validation_auto_correction.plan_failed", {
                    requestId: input.requestId,
                    runId: detail.run.id,
                    projectId: detail.run.projectId,
                    attempt: attemptsUsed + 1,
                    reason: plannerProfile.reason,
                    error: serializeError(error)
                });
                return detail;
            }
            if (!correctionPlan.steps.length) {
                return detail;
            }
            const updatedPlan = withAgentPlanCapabilities({
                ...detail.run.plan,
                steps: [...detail.run.plan.steps, ...correctionPlan.steps]
            });
            const plannedAttempt = attemptsUsed + 1;
            pendingLearningAttempt = {
                attempt: plannedAttempt,
                stepIndex: detail.run.plan.steps.length,
                stepsBeforeCount: detail.steps.length,
                validationBefore: validationOutput.validation,
                correctionProfile: plannerProfile,
                beforeCommitHash: detail.run.currentCommitHash || null,
                ...(validationSignal ? { validation: validationSignal } : {}),
                learningEventMetadataExtra: {
                    guardrailTriggered,
                    resolutionStrategy,
                    phaseGuardrailTriggered,
                    ...(phaseEscalationStrategy ? { phaseEscalationStrategy } : {}),
                    ...(validationSignal
                        ? {
                            validationSignal: {
                                tool: validationSignal.tool,
                                exitCode: validationSignal.exitCode,
                                stderrHead: validationSignal.stderr?.slice(0, 600) ?? null
                            }
                        }
                        : {}),
                    ...(importSignal ? { importSignal } : {}),
                    ...(recipeMissReason ? { recipeMissReason } : {}),
                    ...(recipeExtracted ? { recipeExtracted } : {}),
                    ...(importStats
                        ? {
                            importPressure: {
                                window: IMPORT_RESOLUTION_GUARDRAIL_WINDOW,
                                recentCount: importStats.recentCount,
                                avgDelta: importStats.avgDelta,
                                regressionRate: importStats.regressionRate
                            }
                        }
                        : {}),
                    ...(microStallStats
                        ? {
                            microStallPressure: {
                                window: MICRO_TARGETED_STALL_WINDOW,
                                sessionMicroRuns: microStallStats.sessionMicroRuns,
                                sessionStalledRuns: microStallStats.sessionStalledRuns,
                                sessionStallRate: microStallStats.sessionStallRate,
                                runConsecutiveStalls: microStallStats.runConsecutiveStalls
                            }
                        }
                        : {})
                }
            };
            const resumedRun = (await this.store.updateAgentRun(detail.run.id, {
                status: "running",
                plan: updatedPlan,
                errorMessage: null,
                errorDetails: null,
                finishedAt: null
            })) || detail.run;
            logInfo("agent.validation_auto_correction.queued", {
                requestId: input.requestId,
                runId: detail.run.id,
                projectId: detail.run.projectId,
                attempt: plannedAttempt,
                reason: plannerProfile.reason,
                addedStepIds: correctionPlan.steps.map((step) => step.id),
                blockingCount: plannerProfile.blockingCount,
                architectureModules: plannerProfile.architectureModules || []
            });
            detail = await this.executeLoop({
                ...input,
                run: resumedRun,
                executionConfig
            });
            if (detail.run.status === "complete") {
                invariantRetriesByAttempt.delete(attemptsUsed);
                pendingInvariantContext = null;
                const correctedRun = (await this.store.updateAgentRun(detail.run.id, {
                    correctionAttempts: plannedAttempt,
                    lastCorrectionReason: correctionProfile.reason
                })) || detail.run;
                detail = this.buildRunDetail(correctedRun, detail.steps);
                continue;
            }
            const failedStep = detail.steps[detail.steps.length - 1];
            const invariantFailure = this.extractInvariantViolationFromStep(failedStep);
            if (!invariantFailure) {
                return detail;
            }
            const invariantRetries = (invariantRetriesByAttempt.get(attemptsUsed) || 0) + 1;
            invariantRetriesByAttempt.set(attemptsUsed, invariantRetries);
            if (invariantRetries > MAX_PRECOMMIT_INVARIANT_RETRIES_PER_ATTEMPT) {
                logInfo("agent.validation_auto_correction.invariant_retry_limit", {
                    requestId: input.requestId,
                    runId: detail.run.id,
                    projectId: detail.run.projectId,
                    attempt: plannedAttempt,
                    retries: invariantRetries,
                    maxRetries: MAX_PRECOMMIT_INVARIANT_RETRIES_PER_ATTEMPT,
                    summary: invariantFailure.summary
                });
                return detail;
            }
            const resumedAfterInvariantFailure = (await this.store.updateAgentRun(detail.run.id, {
                status: "complete",
                currentStepIndex: Math.min(detail.run.plan.steps.length, (failedStep?.stepIndex || detail.run.currentStepIndex) + 1),
                lastStepId: failedStep?.id || detail.run.lastStepId,
                correctionAttempts: attemptsUsed,
                errorMessage: null,
                errorDetails: null,
                finishedAt: new Date().toISOString()
            })) || detail.run;
            detail = this.buildRunDetail(resumedAfterInvariantFailure, detail.steps);
            pendingInvariantContext = invariantFailure.context;
            logInfo("agent.validation_auto_correction.invariant_retry", {
                requestId: input.requestId,
                runId: detail.run.id,
                projectId: detail.run.projectId,
                attempt: plannedAttempt,
                retries: invariantRetries,
                maxRetries: MAX_PRECOMMIT_INVARIANT_RETRIES_PER_ATTEMPT,
                summary: invariantFailure.summary
            });
        }
        return detail;
    }
    async createAndExecuteRun(input) {
        const runId = randomUUID();
        const plan = withAgentPlanCapabilities(input.plan);
        const resolvedExecutionConfig = this.resolveExecutionConfig({
            metadata: input.metadata,
            executionConfig: input.executionConfig,
            executionProfile: input.executionProfile
        });
        let run = await this.store.createAgentRun({
            runId,
            projectId: input.project.id,
            orgId: input.project.orgId,
            workspaceId: input.project.workspaceId,
            createdByUserId: input.createdByUserId,
            goal: input.goal,
            providerId: input.providerId,
            model: input.model,
            status: plan.steps.length ? "queued" : "complete",
            currentStepIndex: 0,
            plan,
            metadata: this.withExecutionConfigMetadata(input.metadata, resolvedExecutionConfig),
            errorMessage: null,
            finishedAt: plan.steps.length ? null : new Date().toISOString()
        });
        let detail = this.buildRunDetail(run, []);
        if (plan.steps.length) {
            detail = await this.executeWithValidationAutoCorrection({
                run,
                project: input.project,
                requestId: input.requestId,
                plannerMemory: input.plannerMemory,
                executionMode: input.executionMode,
                executionProfile: input.executionProfile,
                executionConfig: resolvedExecutionConfig
            });
            run = detail.run;
        }
        const executedStep = detail.steps.length ? toStepExecution(detail.steps[detail.steps.length - 1]) : undefined;
        logInfo("agent.run.started", {
            requestId: input.requestId,
            runId,
            projectId: input.project.id,
            goal: input.goal,
            providerId: input.providerId,
            planStepCount: run.plan.steps.length,
            currentStepIndex: run.currentStepIndex,
            status: run.status,
            executionMode: input.executionMode || "isolated",
            executionProfile: input.executionProfile || "default",
            executionConfig: resolvedExecutionConfig,
            metadata: run.metadata || null
        });
        return {
            run: detail.run,
            steps: detail.steps,
            telemetry: detail.telemetry,
            executedStep
        };
    }
    async createQueuedRun(input) {
        const runId = randomUUID();
        const plan = withAgentPlanCapabilities(input.plan);
        const resolvedExecutionConfig = this.resolveExecutionConfig({
            metadata: input.metadata,
            executionConfig: input.executionConfig
        });
        const run = await this.store.createAgentRun({
            runId,
            projectId: input.project.id,
            orgId: input.project.orgId,
            workspaceId: input.project.workspaceId,
            createdByUserId: input.createdByUserId,
            goal: input.goal,
            providerId: input.providerId,
            model: input.model,
            status: plan.steps.length ? "queued" : "complete",
            currentStepIndex: 0,
            plan,
            metadata: this.withExecutionConfigMetadata(input.metadata, resolvedExecutionConfig),
            errorMessage: null,
            finishedAt: plan.steps.length ? null : new Date().toISOString()
        });
        const detail = this.buildRunDetail(run, []);
        const queuedJob = plan.steps.length
            ? await this.store.enqueueRunJob({
                runId,
                jobType: "kernel",
                targetRole: "compute",
                requiredCapabilities: null
            })
            : undefined;
        logInfo("agent.run.queued", {
            requestId: input.requestId,
            runId,
            projectId: input.project.id,
            goal: input.goal,
            providerId: input.providerId,
            planStepCount: run.plan.steps.length,
            currentStepIndex: run.currentStepIndex,
            status: run.status,
            queuedJobId: queuedJob?.id || null,
            executionConfig: resolvedExecutionConfig,
            metadata: run.metadata || null
        });
        return {
            run: detail.run,
            steps: detail.steps,
            telemetry: detail.telemetry,
            queuedJob
        };
    }
    async startRun(input) {
        const projectRoot = this.store.getProjectWorkspacePath(input.project);
        const resolvedExecutionConfig = this.resolveExecutionConfig({
            metadata: null,
            executionConfig: input.executionConfig
        });
        const plannerMemory = await this.buildPlannerMemoryContext({
            project: input.project,
            projectRoot,
            requestId: input.requestId
        });
        const plan = await this.planner.plan({
            goal: input.goal,
            providerId: input.providerId,
            model: input.model,
            project: input.project,
            projectRoot,
            memory: plannerMemory,
            plannerTimeoutMs: resolvedExecutionConfig.plannerTimeoutMs
        });
        return this.createAndExecuteRun({
            project: input.project,
            createdByUserId: input.createdByUserId,
            goal: input.goal,
            providerId: input.providerId,
            model: input.model,
            plan,
            requestId: input.requestId,
            plannerMemory,
            executionMode: "isolated",
            executionProfile: "default",
            executionConfig: resolvedExecutionConfig
        });
    }
    async queueRun(input) {
        const projectRoot = this.store.getProjectWorkspacePath(input.project);
        const resolvedExecutionConfig = this.resolveExecutionConfig({
            metadata: null,
            executionConfig: input.executionConfig
        });
        const plannerMemory = await this.buildPlannerMemoryContext({
            project: input.project,
            projectRoot,
            requestId: input.requestId
        });
        const plan = await this.planner.plan({
            goal: input.goal,
            providerId: input.providerId,
            model: input.model,
            project: input.project,
            projectRoot,
            memory: plannerMemory,
            plannerTimeoutMs: resolvedExecutionConfig.plannerTimeoutMs
        });
        return this.createQueuedRun({
            project: input.project,
            createdByUserId: input.createdByUserId,
            goal: input.goal,
            providerId: input.providerId,
            model: input.model,
            plan,
            requestId: input.requestId,
            executionConfig: resolvedExecutionConfig
        });
    }
    async startRunWithPlan(input) {
        return this.createAndExecuteRun({
            project: input.project,
            createdByUserId: input.createdByUserId,
            goal: input.goal,
            providerId: input.providerId,
            model: input.model,
            plan: input.plan,
            requestId: input.requestId,
            executionMode: input.executionMode || "isolated",
            executionProfile: input.executionProfile || "default",
            metadata: input.metadata,
            executionConfig: input.executionConfig
        });
    }
    async resumeRun(input) {
        const existing = await this.store.getAgentRunById(input.project.id, input.runId);
        if (!existing) {
            throw new Error("Agent run not found.");
        }
        const normalizedExisting = await this.ensurePlanCapabilitiesPersisted(existing);
        if (normalizedExisting.status === "complete") {
            const steps = await this.store.listAgentStepsByRun(normalizedExisting.id);
            return this.buildRunDetail(normalizedExisting, steps);
        }
        const run = (await this.store.updateAgentRun(normalizedExisting.id, {
            status: "queued",
            errorMessage: null,
            errorDetails: null,
            finishedAt: null
        })) || normalizedExisting;
        const plannerMemory = await this.buildPlannerMemoryContext({
            project: input.project,
            projectRoot: this.store.getProjectWorkspacePath(input.project),
            requestId: input.requestId
        });
        const detail = await this.executeWithValidationAutoCorrection({
            run,
            project: input.project,
            requestId: input.requestId,
            plannerMemory,
            executionConfig: this.resolveExecutionConfig({
                metadata: run.metadata
            })
        });
        logInfo("agent.run.resumed", {
            requestId: input.requestId,
            runId: input.runId,
            projectId: input.project.id,
            status: detail.run.status,
            currentStepIndex: detail.run.currentStepIndex
        });
        return detail;
    }
    async queueResumeRun(input) {
        const existing = await this.store.getAgentRunById(input.project.id, input.runId);
        if (!existing) {
            throw new Error("Agent run not found.");
        }
        const normalizedExisting = await this.ensurePlanCapabilitiesPersisted(existing);
        const steps = await this.store.listAgentStepsByRun(normalizedExisting.id);
        if (normalizedExisting.status === "complete") {
            return this.buildRunDetail(normalizedExisting, steps);
        }
        const run = (await this.store.updateAgentRun(normalizedExisting.id, {
            status: "queued",
            errorMessage: null,
            errorDetails: null,
            finishedAt: null
        })) || normalizedExisting;
        const queuedJob = await this.store.enqueueRunJob({
            runId: run.id,
            jobType: "kernel",
            targetRole: "compute",
            requiredCapabilities: null
        });
        const detail = this.buildRunDetail(run, steps);
        logInfo("agent.run.requeued", {
            requestId: input.requestId,
            runId: input.runId,
            projectId: input.project.id,
            status: detail.run.status,
            currentStepIndex: detail.run.currentStepIndex,
            queuedJobId: queuedJob.id
        });
        return {
            ...detail,
            queuedJob
        };
    }
    async forkRun(input) {
        const sourceRun = await this.store.getAgentRunById(input.project.id, input.runId);
        if (!sourceRun) {
            throw new Error("Agent run not found.");
        }
        const sourceSteps = await this.store.listAgentStepsByRun(sourceRun.id);
        const sourceStep = [...sourceSteps]
            .sort((a, b) => b.stepIndex - a.stepIndex || b.attempt - a.attempt || b.createdAt.localeCompare(a.createdAt))
            .find((step) => step.stepId === input.stepId || step.id === input.stepId);
        if (!sourceStep) {
            throw new Error("Agent step not found.");
        }
        if (!sourceStep.commitHash) {
            throw new Error("Selected step has no commit hash and cannot be forked.");
        }
        const forkRunId = randomUUID();
        const workspaceRoot = this.store.getProjectWorkspacePath(input.project);
        const forkContext = await ensureRunWorktree({
            projectDir: workspaceRoot,
            runId: forkRunId,
            baseCommitHash: sourceStep.commitHash
        });
        const nextStepIndex = Math.min(sourceStep.stepIndex + 1, sourceRun.plan.steps.length);
        const hasRemainingSteps = nextStepIndex < sourceRun.plan.steps.length;
        const forkRun = await this.store.createAgentRun({
            runId: forkRunId,
            projectId: sourceRun.projectId,
            orgId: sourceRun.orgId,
            workspaceId: sourceRun.workspaceId,
            createdByUserId: input.createdByUserId,
            goal: sourceRun.goal,
            providerId: sourceRun.providerId,
            model: sourceRun.model,
            status: hasRemainingSteps ? "queued" : "complete",
            currentStepIndex: nextStepIndex,
            plan: sourceRun.plan,
            lastStepId: null,
            runBranch: forkContext.runBranch,
            worktreePath: forkContext.worktreePath,
            baseCommitHash: forkContext.baseCommitHash,
            currentCommitHash: forkContext.currentCommitHash,
            lastValidCommitHash: forkContext.currentCommitHash || forkContext.baseCommitHash,
            metadata: sourceRun.metadata ?? {},
            errorMessage: null,
            finishedAt: hasRemainingSteps ? null : new Date().toISOString()
        });
        logInfo("agent.run.forked", {
            requestId: input.requestId,
            projectId: input.project.id,
            sourceRunId: sourceRun.id,
            sourceStepId: sourceStep.stepId,
            sourceCommitHash: sourceStep.commitHash,
            forkRunId: forkRun.id,
            forkRunBranch: forkRun.runBranch,
            forkCurrentStepIndex: forkRun.currentStepIndex
        });
        return this.buildRunDetail(forkRun, []);
    }
    async validateRunOutput(input) {
        const run = await this.store.getAgentRunById(input.project.id, input.runId);
        if (!run) {
            throw new Error("Agent run not found.");
        }
        if (isExecutingAgentRunStatus(run.status)) {
            throw new Error("Cannot validate output while run is still running.");
        }
        const workspaceRoot = this.store.getProjectWorkspacePath(input.project);
        const executionContext = await this.ensureRunExecutionContext({
            run,
            workspaceRoot,
            requestId: input.requestId,
            // Validation must not mutate run commit pointers. It only needs a workspace context.
            syncCommitPointers: false
        });
        const ref = executionContext.run.currentCommitHash || (await readCurrentCommitHash(executionContext.executionRoot));
        const validation = await runValidationForTemplateProfile({
            templateId: input.project.templateId,
            projectRoot: executionContext.executionRoot,
            ref
        });
        logInfo("agent.run.validated", {
            requestId: input.requestId,
            runId: executionContext.run.id,
            projectId: executionContext.run.projectId,
            ok: validation.ok,
            blockingCount: validation.blockingCount,
            warningCount: validation.warningCount,
            summary: validation.summary
        });
        return {
            run: executionContext.run,
            targetPath: executionContext.executionRoot,
            validation: {
                ok: validation.ok,
                blockingCount: validation.blockingCount,
                warningCount: validation.warningCount,
                summary: validation.summary,
                checks: validation.checks
            }
        };
    }
    async executeRunJob(input) {
        if (input.job.jobType !== "kernel") {
            throw new Error(`Unsupported run job type '${input.job.jobType}'.`);
        }
        const run = await this.store.getAgentRun(input.job.runId);
        if (!run) {
            throw new Error(`Run not found: ${input.job.runId}`);
        }
        const normalizedRun = await this.ensurePlanCapabilitiesPersisted(run);
        if (normalizedRun.status === "complete" || normalizedRun.status === "cancelled") {
            const steps = await this.store.listAgentStepsByRun(normalizedRun.id);
            return this.buildRunDetail(normalizedRun, steps);
        }
        const plannerMemory = await this.buildPlannerMemoryContext({
            project: input.project,
            projectRoot: this.store.getProjectWorkspacePath(input.project),
            requestId: input.requestId
        });
        return this.executeWithValidationAutoCorrection({
            run: normalizedRun,
            project: input.project,
            requestId: input.requestId,
            plannerMemory,
            executionMode: "isolated",
            executionProfile: "default",
            executionConfig: this.resolveExecutionConfig({
                metadata: normalizedRun.metadata
            })
        });
    }
    async executeQueuedRun(input) {
        const run = await this.store.getAgentRun(input.runId);
        if (!run) {
            throw new Error("Agent run not found.");
        }
        const project = await this.store.getProject(run.projectId);
        if (!project) {
            throw new Error("Project not found.");
        }
        const detail = await this.executeRunJob({
            job: {
                jobType: "kernel",
                runId: input.runId
            },
            project,
            requestId: input.requestId
        });
        logInfo("agent.run.executed_from_queue", {
            requestId: input.requestId,
            runId: detail.run.id,
            projectId: detail.run.projectId,
            status: detail.run.status,
            currentStepIndex: detail.run.currentStepIndex
        });
        return detail;
    }
    async getRun(projectId, runId) {
        const detail = await this.getRunDetail(projectId, runId);
        return detail?.run;
    }
    async getRunWithSteps(projectId, runId) {
        return this.getRunDetail(projectId, runId);
    }
    async listRuns(projectId) {
        const runs = await this.store.listAgentRunsByProject(projectId);
        const hydrated = [];
        for (const run of runs) {
            const steps = await this.store.listAgentStepsByRun(run.id);
            hydrated.push(attachLastStep(run, steps));
        }
        return hydrated;
    }
}
