import { randomUUID } from "node:crypto";
import { ensureRunWorktree, isWorktreeDirty, listCommits, readCurrentCommitHash, resetWorktreeToCommit } from "../lib/git-versioning.js";
import { logInfo, serializeError } from "../lib/logging.js";
import { AgentExecutor } from "./executor.js";
import { FileSession } from "./fs/file-session.js";
import { proposedFileChangeSchema } from "./fs/types.js";
import { runHeavyProjectValidation } from "./validation/heavy-validator.js";
import { runLightProjectValidation } from "./validation/project-validator.js";
import { analyzeProjectForMemory } from "./memory.js";
import { AgentPlanner } from "./planner.js";
import { createDefaultAgentToolRegistry } from "./tools/index.js";
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
export class AgentKernel {
    planner;
    executor;
    store;
    maxRuntimeCorrectionAttempts;
    maxHeavyCorrectionAttempts;
    constructor(input) {
        this.store = input.store;
        this.planner = input.planner ?? new AgentPlanner();
        this.executor = input.executor ?? new AgentExecutor(createDefaultAgentToolRegistry());
        this.maxRuntimeCorrectionAttempts = this.resolveMaxRuntimeCorrectionAttempts();
        this.maxHeavyCorrectionAttempts = this.resolveMaxHeavyCorrectionAttempts();
    }
    resolveMaxRuntimeCorrectionAttempts() {
        const parsed = Number(process.env.AGENT_RUNTIME_MAX_CORRECTIONS || 1);
        if (!Number.isFinite(parsed)) {
            return 1;
        }
        return Math.min(2, Math.max(0, Math.floor(parsed)));
    }
    resolveMaxHeavyCorrectionAttempts() {
        const parsed = Number(process.env.AGENT_HEAVY_MAX_CORRECTIONS || 2);
        if (!Number.isFinite(parsed)) {
            return 2;
        }
        return Math.min(5, Math.max(0, Math.floor(parsed)));
    }
    isMutatingStep(step) {
        return step.type === "modify" || step.tool === "write_file" || step.tool === "apply_patch";
    }
    isRuntimeVerifyStep(step) {
        return step.type === "verify" && step.tool === "run_preview_container";
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
        const run = (await this.store.updateAgentRun(input.run.id, {
            runBranch: resolved.runBranch,
            worktreePath: resolved.worktreePath,
            baseCommitHash: resolved.baseCommitHash,
            currentCommitHash: resolved.currentCommitHash,
            lastValidCommitHash: input.run.lastValidCommitHash || resolved.currentCommitHash || input.run.currentCommitHash || resolved.baseCommitHash
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
        return {
            run: attachLastStep(run, steps),
            steps
        };
    }
    async queueRuntimeCorrection(input) {
        const correction = await this.planner.planRuntimeCorrection({
            goal: input.run.goal,
            providerId: input.run.providerId,
            model: input.run.model,
            project: input.project,
            projectRoot: input.executionRoot,
            memory: input.plannerMemory,
            failedStepId: input.failedStep.id,
            runtimeLogs: input.runtimeLogs,
            attempt: input.attempt
        });
        const correctionStep = {
            ...correction,
            id: `runtime-correction-${input.attempt}`,
            type: "modify"
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
            retryStepId: retryStep.id
        });
        return ((await this.store.updateAgentRun(input.run.id, {
            status: "running",
            currentStepIndex: input.stepIndex + 1,
            plan: input.run.plan,
            lastStepId: input.failedStepRecord.id,
            errorMessage: null,
            finishedAt: null
        })) || input.run);
    }
    async queueHeavyValidationCorrection(input) {
        const correction = await this.planner.planRuntimeCorrection({
            goal: input.run.goal,
            providerId: input.run.providerId,
            model: input.run.model,
            project: input.project,
            projectRoot: input.executionRoot,
            memory: input.plannerMemory,
            failedStepId: `heavy-validation-${input.attempt}`,
            runtimeLogs: `${input.heavyValidationSummary}\n\n${input.heavyValidationLogs}`.trim(),
            attempt: input.attempt
        });
        const correctionStep = {
            ...correction,
            id: `validation-correction-${input.attempt}`,
            type: "modify"
        };
        input.run.plan.steps.splice(input.stepIndex + 1, 0, correctionStep);
        logInfo("agent.heavy_validation_correction.queued", {
            requestId: input.requestId,
            runId: input.run.id,
            projectId: input.run.projectId,
            attempt: input.attempt,
            correctionStepId: correctionStep.id,
            summary: input.heavyValidationSummary
        });
        return ((await this.store.updateAgentRun(input.run.id, {
            status: "running",
            currentStepIndex: input.stepIndex + 1,
            plan: input.run.plan,
            errorMessage: null,
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
            const executionContext = await this.ensureRunExecutionContext({
                run,
                workspaceRoot,
                requestId: input.requestId
            });
            run = executionContext.run;
            const projectRoot = executionContext.executionRoot;
            run = await this.recoverRunWorkspaceIfNeeded({
                run,
                executionRoot: projectRoot,
                requestId: input.requestId
            });
            let runtimeCorrectionCount = this.countRuntimeCorrectionSteps(run.plan);
            let heavyCorrectionCount = this.countHeavyCorrectionSteps(run.plan);
            const lightValidationMode = this.resolveLightValidationMode();
            const heavyValidationMode = this.resolveHeavyValidationMode();
            const fileSession = await FileSession.create({
                projectId: run.projectId,
                projectRoot,
                baseCommitHash: run.currentCommitHash || run.baseCommitHash || undefined,
                options: {
                    maxFilesPerStep: Number(process.env.AGENT_FS_MAX_FILES_PER_STEP || 15),
                    maxTotalDiffBytes: Number(process.env.AGENT_FS_MAX_TOTAL_DIFF_BYTES || 400_000),
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
                let queueHeavyCorrectionAttempt = null;
                let heavyRollbackReason = null;
                if (status === "completed" && this.isMutatingStep(step)) {
                    try {
                        const proposedChanges = this.extractProposedChanges(output);
                        if (!proposedChanges.length) {
                            output = {
                                ...output,
                                stagedFileCount: 0,
                                stagedDiffs: []
                            };
                        }
                        else {
                            fileSession.beginStep(step.id, stepIndex);
                            for (const change of proposedChanges) {
                                await fileSession.stageChange(change);
                            }
                            const validation = fileSession.validateStep();
                            await fileSession.applyStepChanges();
                            const lightValidation = await runLightProjectValidation(projectRoot);
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
                        status = "failed";
                        errorMessage = `Step transaction failed: ${String(error.message || error)}`;
                        output = {
                            ...output,
                            transactionError: serializeError(error)
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
                        output = {
                            ...output,
                            runtimeStatus: "failed"
                        };
                    }
                    else {
                        output = {
                            ...output,
                            runtimeStatus: "healthy"
                        };
                    }
                }
                const doneCandidate = stepIndex + 1 >= run.plan.steps.length;
                if (status === "completed" && doneCandidate && heavyValidationMode !== "off") {
                    try {
                        const validationRef = run.currentCommitHash || (await readCurrentCommitHash(projectRoot));
                        const heavyValidation = await runHeavyProjectValidation({
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
                                summary: heavyValidation.summary
                            }
                        };
                        if (!heavyValidation.ok && heavyValidationMode === "enforce") {
                            if (heavyCorrectionCount < this.maxHeavyCorrectionAttempts) {
                                queueHeavyCorrectionAttempt = heavyCorrectionCount + 1;
                                runtimeLogs = heavyValidation.logs;
                            }
                            else {
                                status = "failed";
                                heavyRollbackReason = `Heavy validation failed after ${heavyCorrectionCount}/${this.maxHeavyCorrectionAttempts} correction attempts.`;
                                errorMessage = heavyRollbackReason;
                            }
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
                const existingStepIndex = steps.findIndex((entry) => entry.stepIndex === stepRecord.stepIndex);
                if (existingStepIndex >= 0) {
                    steps[existingStepIndex] = stepRecord;
                }
                else {
                    steps.push(stepRecord);
                }
                steps.sort((a, b) => a.stepIndex - b.stepIndex);
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
                            project: input.project,
                            executionRoot: projectRoot,
                            requestId: input.requestId,
                            plannerMemory: input.plannerMemory
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
                                finishedAt: new Date().toISOString()
                            })) || run;
                        return {
                            run: attachLastStep(run, steps),
                            steps
                        };
                    }
                }
                if (status === "failed" && this.isRuntimeVerifyStep(step) && runtimeCorrectionCount < this.maxRuntimeCorrectionAttempts) {
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
                            plannerMemory: input.plannerMemory
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
                                finishedAt: new Date().toISOString()
                            })) || run;
                        return {
                            run: attachLastStep(run, steps),
                            steps
                        };
                    }
                }
                if (status === "failed") {
                    if (!heavyRollbackReason && this.isRuntimeVerifyStep(step) && runtimeCorrectionCount >= this.maxRuntimeCorrectionAttempts) {
                        heavyRollbackReason = `Runtime correction limit reached (${runtimeCorrectionCount}/${this.maxRuntimeCorrectionAttempts}).`;
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
                            finishedAt: new Date().toISOString()
                        })) || run;
                    return {
                        run: attachLastStep(run, steps),
                        steps
                    };
                }
                const nextStepIndex = stepIndex + 1;
                const done = nextStepIndex >= run.plan.steps.length;
                run =
                    (await this.store.updateAgentRun(run.id, {
                        status: done ? "completed" : "running",
                        currentStepIndex: nextStepIndex,
                        lastStepId: stepRecord.id,
                        errorMessage: null,
                        finishedAt: done ? new Date().toISOString() : null,
                        plan: run.plan
                    })) || run;
            }
            return {
                run: attachLastStep(run, steps),
                steps
            };
        }
        finally {
            await this.store.releaseAgentRunExecutionLock(run.id, lockOwner).catch(() => undefined);
        }
    }
    async startRun(input) {
        const runId = randomUUID();
        const projectRoot = this.store.getProjectWorkspacePath(input.project);
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
            memory: plannerMemory
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
            status: plan.steps.length ? "running" : "completed",
            currentStepIndex: 0,
            plan,
            errorMessage: null,
            finishedAt: plan.steps.length ? null : new Date().toISOString()
        });
        let detail = {
            run,
            steps: []
        };
        if (plan.steps.length) {
            detail = await this.executeLoop({
                run,
                project: input.project,
                requestId: input.requestId,
                plannerMemory
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
            status: run.status
        });
        return {
            run: detail.run,
            steps: detail.steps,
            executedStep
        };
    }
    async resumeRun(input) {
        const existing = await this.store.getAgentRunById(input.project.id, input.runId);
        if (!existing) {
            throw new Error("Agent run not found.");
        }
        if (existing.status === "completed") {
            const steps = await this.store.listAgentStepsByRun(existing.id);
            return {
                run: attachLastStep(existing, steps),
                steps
            };
        }
        const run = (await this.store.updateAgentRun(existing.id, {
            status: "running",
            errorMessage: null,
            finishedAt: null
        })) || existing;
        const plannerMemory = await this.buildPlannerMemoryContext({
            project: input.project,
            projectRoot: this.store.getProjectWorkspacePath(input.project),
            requestId: input.requestId
        });
        const detail = await this.executeLoop({
            run,
            project: input.project,
            requestId: input.requestId,
            plannerMemory
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
    async forkRun(input) {
        const sourceRun = await this.store.getAgentRunById(input.project.id, input.runId);
        if (!sourceRun) {
            throw new Error("Agent run not found.");
        }
        const sourceSteps = await this.store.listAgentStepsByRun(sourceRun.id);
        const sourceStep = sourceSteps.find((step) => step.stepId === input.stepId || step.id === input.stepId);
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
            status: hasRemainingSteps ? "planned" : "completed",
            currentStepIndex: nextStepIndex,
            plan: sourceRun.plan,
            lastStepId: null,
            runBranch: forkContext.runBranch,
            worktreePath: forkContext.worktreePath,
            baseCommitHash: forkContext.baseCommitHash,
            currentCommitHash: forkContext.currentCommitHash,
            lastValidCommitHash: forkContext.currentCommitHash || forkContext.baseCommitHash,
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
        return {
            run: forkRun,
            steps: []
        };
    }
    async validateRunOutput(input) {
        const run = await this.store.getAgentRunById(input.project.id, input.runId);
        if (!run) {
            throw new Error("Agent run not found.");
        }
        if (run.status === "running") {
            throw new Error("Cannot validate output while run is still running.");
        }
        const workspaceRoot = this.store.getProjectWorkspacePath(input.project);
        const executionContext = await this.ensureRunExecutionContext({
            run,
            workspaceRoot,
            requestId: input.requestId
        });
        const ref = executionContext.run.currentCommitHash || (await readCurrentCommitHash(executionContext.executionRoot));
        const validation = await runHeavyProjectValidation({
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
