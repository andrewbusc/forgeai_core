import { randomUUID } from "node:crypto";
import {
  ensureRunWorktree,
  isWorktreeDirty,
  listCommits,
  readCurrentCommitHash,
  resetWorktreeToCommit
} from "../lib/git-versioning.js";
import { logInfo, serializeError } from "../lib/logging.js";
import { AppStore } from "../lib/project-store.js";
import { AgentExecutor } from "./executor.js";
import { classifyFailureForCorrection } from "./correction/failure-classifier.js";
import { FileSession } from "./fs/file-session.js";
import { ProposedFileChange, proposedFileChangeSchema } from "./fs/types.js";
import { runHeavyProjectValidation } from "./validation/heavy-validator.js";
import { runLightProjectValidation } from "./validation/project-validator.js";
import { analyzeProjectForMemory } from "./memory.js";
import { AgentPlanner } from "./planner.js";
import { isExecutingAgentRunStatus } from "./run-status.js";
import { createDefaultAgentToolRegistry } from "./tools/index.js";
import {
  AgentCorrectionTelemetry,
  AgentRun,
  AgentRunCorrectionTelemetryEntry,
  AgentRunDetail,
  AgentStep,
  AgentStepExecution,
  AgentStepRecord,
  ForkAgentRunInput,
  ForkAgentRunOutput,
  PlannerFailureReport,
  PlannerMemoryContext,
  PlannerCorrectionConstraint,
  ResumeAgentRunInput,
  ResumeAgentRunOutput,
  StartAgentRunInput,
  StartAgentRunOutput,
  ValidateAgentRunInput,
  ValidateAgentRunOutput
} from "./types.js";

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

function tailText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(value.length - maxLength);
}

function toStepExecution(step: AgentStepRecord): AgentStepExecution {
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

function attachLastStep(run: AgentRun, steps: AgentStepRecord[]): AgentRun {
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

function coerceRuntimeStatus(value: unknown): "healthy" | "failed" | null {
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

function normalizeStepId(base: string, suffix: string): string {
  const safeBase = base.replace(/[^a-zA-Z0-9-_.]/g, "-");
  const safeSuffix = suffix.replace(/[^a-zA-Z0-9-_.]/g, "-");
  const maxBaseLength = Math.max(1, 80 - safeSuffix.length - 1);
  return `${safeBase.slice(0, maxBaseLength)}-${safeSuffix}`;
}

export class AgentKernel {
  private readonly planner: AgentPlanner;
  private readonly executor: AgentExecutor;
  private readonly store: AppStore;
  private readonly maxRuntimeCorrectionAttempts: number;
  private readonly maxHeavyCorrectionAttempts: number;
  private readonly correctionConvergenceMode: "off" | "warn" | "enforce";

  constructor(input: { store: AppStore; planner?: AgentPlanner; executor?: AgentExecutor }) {
    this.store = input.store;
    this.planner = input.planner ?? new AgentPlanner();
    this.executor = input.executor ?? new AgentExecutor(createDefaultAgentToolRegistry());
    this.maxRuntimeCorrectionAttempts = this.resolveMaxRuntimeCorrectionAttempts();
    this.maxHeavyCorrectionAttempts = this.resolveMaxHeavyCorrectionAttempts();
    this.correctionConvergenceMode = this.resolveCorrectionConvergenceMode();
  }

  private resolveMaxRuntimeCorrectionAttempts(): number {
    const parsed = Number(process.env.AGENT_GOAL_MAX_CORRECTIONS || process.env.AGENT_RUNTIME_MAX_CORRECTIONS || 5);

    if (!Number.isFinite(parsed)) {
      return 5;
    }

    return Math.min(5, Math.max(0, Math.floor(parsed)));
  }

  private resolveMaxHeavyCorrectionAttempts(): number {
    const parsed = Number(
      process.env.AGENT_OPTIMIZATION_MAX_CORRECTIONS || process.env.AGENT_HEAVY_MAX_CORRECTIONS || 3
    );

    if (!Number.isFinite(parsed)) {
      return 3;
    }

    return Math.min(3, Math.max(0, Math.floor(parsed)));
  }

  private isMutatingStep(step: AgentStep): boolean {
    return step.type === "modify" || step.tool === "write_file" || step.tool === "apply_patch";
  }

  private isRuntimeVerifyStep(step: AgentStep): boolean {
    return step.type === "verify" && step.tool === "run_preview_container";
  }

  private isCorrectionStep(step: AgentStep): boolean {
    return step.id.startsWith("runtime-correction-") || step.id.startsWith("validation-correction-");
  }

  private commitMessageForStep(_runId: string, _stepIndex: number, step: AgentStep, goal: string): string {
    const goalSummary = truncateText(goal, 64);
    return `${step.id} (${step.tool}) :: ${goalSummary}`;
  }

  private extractProposedChanges(output: Record<string, unknown>): ProposedFileChange[] {
    const raw = output.proposedChanges;
    if (!Array.isArray(raw)) {
      throw new Error("Mutating steps must return proposedChanges[].");
    }

    return raw.map((entry) => proposedFileChangeSchema.parse(entry));
  }

  private runtimeVerificationOutcome(input: {
    status: AgentStepExecution["status"];
    output: Record<string, unknown>;
    errorMessage: string | null;
  }): {
    runtimeStatus: "healthy" | "failed";
    ok: boolean;
    reason: string | null;
    logs: string;
  } {
    const explicitStatus = coerceRuntimeStatus(input.output.runtimeStatus);
    const startupOk = input.output.startupOk === true;
    const runtimeStatus =
      explicitStatus || (startupOk ? "healthy" : input.status === "completed" ? "failed" : "failed");

    const logBlock =
      typeof input.output.logs === "string" && input.output.logs
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

    const outputReason =
      typeof input.output.errorMessage === "string" && input.output.errorMessage.trim()
        ? input.output.errorMessage.trim()
        : null;

    return {
      runtimeStatus,
      ok: false,
      reason: outputReason || input.errorMessage || "Runtime verification failed.",
      logs: tailText(logBlock || "", 16_000)
    };
  }

  private countRuntimeCorrectionSteps(plan: AgentRun["plan"]): number {
    return plan.steps.filter((step) => step.id.startsWith("runtime-correction-")).length;
  }

  private countHeavyCorrectionSteps(plan: AgentRun["plan"]): number {
    return plan.steps.filter((step) => step.id.startsWith("validation-correction-")).length;
  }

  private runtimeFailureSignature(reason: string | null, logs: string): string {
    const reasonPart = truncateText(reason || "runtime-failure", 240).toLowerCase();
    const logsPart = tailText(logs || "", 2_000).toLowerCase();
    return `${reasonPart}::${logsPart}`;
  }

  private normalizeCorrectionPathPrefix(value: string): string {
    return value.replaceAll("\\", "/").replace(/^\/+/, "").trim();
  }

  private coerceCorrectionIntent(value: unknown): PlannerCorrectionConstraint["intent"] {
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

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const deduped = new Set<string>();
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

  private parseCorrectionConstraint(value: unknown): PlannerCorrectionConstraint | null {
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
      maxTotalDiffBytes:
        Number.isFinite(maxTotalDiffBytes) && maxTotalDiffBytes > 0 ? Math.floor(maxTotalDiffBytes) : 400_000,
      allowedPathPrefixes,
      guidance: this.toStringArray(constraint.guidance)
    };
  }

  private resolveCorrectionConstraintForStep(step: AgentStep): PlannerCorrectionConstraint | null {
    const deepCorrection = this.toRecord(step.input?._deepCorrection);
    if (!deepCorrection) {
      return null;
    }

    return this.parseCorrectionConstraint(deepCorrection.constraint);
  }

  private extractCorrectionTelemetryForStep(step: AgentStepRecord): AgentCorrectionTelemetry | null {
    const inputPayload = this.toRecord(step.inputPayload);
    const deepCorrection = this.toRecord(inputPayload?._deepCorrection);
    if (!deepCorrection) {
      return null;
    }

    const classificationRaw = this.toRecord(deepCorrection.classification);
    const classificationIntent = this.coerceCorrectionIntent(classificationRaw?.intent);
    const constraint =
      this.parseCorrectionConstraint(deepCorrection.constraint) || {
        intent: classificationIntent,
        maxFiles: 15,
        maxTotalDiffBytes: 400_000,
        allowedPathPrefixes: [],
        guidance: []
      };
    const phase =
      typeof deepCorrection.phase === "string" && deepCorrection.phase.trim()
        ? deepCorrection.phase.trim()
        : "unknown";
    const attempt = Number(deepCorrection.attempt);
    const createdAt =
      typeof deepCorrection.createdAt === "string" && deepCorrection.createdAt.trim()
        ? deepCorrection.createdAt
        : step.createdAt;

    return {
      phase,
      attempt: Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : step.attempt,
      failedStepId:
        typeof deepCorrection.failedStepId === "string" && deepCorrection.failedStepId.trim()
          ? deepCorrection.failedStepId.trim()
          : step.stepId,
      reason:
        typeof deepCorrection.reason === "string" && deepCorrection.reason.trim()
          ? deepCorrection.reason.trim()
          : undefined,
      summary:
        typeof deepCorrection.summary === "string" && deepCorrection.summary.trim()
          ? deepCorrection.summary.trim()
          : undefined,
      runtimeLogTail:
        typeof deepCorrection.runtimeLogTail === "string" && deepCorrection.runtimeLogTail.trim()
          ? deepCorrection.runtimeLogTail
          : undefined,
      classification: {
        intent: classificationIntent,
        failedChecks: this.toStringArray(classificationRaw?.failedChecks),
        failureKinds: this.toStringArray(classificationRaw?.failureKinds),
        rationale:
          typeof classificationRaw?.rationale === "string" && classificationRaw.rationale.trim()
            ? classificationRaw.rationale.trim()
            : `intent=${classificationIntent}`
      },
      constraint,
      createdAt
    };
  }

  private buildRunDetail(run: AgentRun, steps: AgentStepRecord[]): AgentRunDetail {
    const corrections: AgentRunCorrectionTelemetryEntry[] = [];
    const enrichedSteps = steps.map((step) => {
      const correctionTelemetry = this.extractCorrectionTelemetryForStep(step);
      if (!correctionTelemetry) {
        return step;
      }

      corrections.push({
        stepRecordId: step.id,
        stepId: step.stepId,
        stepIndex: step.stepIndex,
        stepAttempt: step.attempt,
        status: step.status,
        errorMessage: step.errorMessage,
        commitHash: step.commitHash,
        createdAt: step.createdAt,
        telemetry: correctionTelemetry
      });

      return {
        ...step,
        correctionTelemetry
      };
    });

    return {
      run: attachLastStep(run, enrichedSteps),
      steps: enrichedSteps,
      telemetry: {
        corrections
      }
    };
  }

  private isPathAllowedByConstraint(pathValue: string, allowedPathPrefixes: string[]): boolean {
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

  private assertCorrectionChangeScope(input: {
    step: AgentStep;
    proposedChanges: ProposedFileChange[];
    constraint: PlannerCorrectionConstraint | null;
  }): void {
    const constraint = input.constraint;
    if (!constraint) {
      return;
    }

    if (input.proposedChanges.length > constraint.maxFiles) {
      throw new Error(
        `Correction step '${input.step.id}' exceeds file cap (${input.proposedChanges.length}/${constraint.maxFiles}).`
      );
    }

    const disallowedPaths = input.proposedChanges
      .map((entry) => entry.path)
      .filter((entry) => !this.isPathAllowedByConstraint(entry, constraint.allowedPathPrefixes));

    if (disallowedPaths.length) {
      throw new Error(
        `Correction step '${input.step.id}' changed disallowed paths: ${disallowedPaths.slice(0, 5).join(", ")}.`
      );
    }
  }

  private assertCorrectionStagedBounds(input: {
    step: AgentStep;
    stagedDiffs: Array<{ path: string; diffBytes: number }>;
    constraint: PlannerCorrectionConstraint | null;
  }): void {
    const constraint = input.constraint;
    if (!constraint) {
      return;
    }

    const totalBytes = input.stagedDiffs.reduce((sum, entry) => sum + Math.max(0, Number(entry.diffBytes || 0)), 0);

    if (totalBytes > constraint.maxTotalDiffBytes) {
      throw new Error(
        `Correction step '${input.step.id}' exceeds diff-size cap (${totalBytes}/${constraint.maxTotalDiffBytes} bytes).`
      );
    }

    const disallowedPaths = input.stagedDiffs
      .map((entry) => entry.path)
      .filter((entry) => !this.isPathAllowedByConstraint(entry, constraint.allowedPathPrefixes));

    if (disallowedPaths.length) {
      throw new Error(
        `Correction step '${input.step.id}' staged disallowed paths: ${disallowedPaths.slice(0, 5).join(", ")}.`
      );
    }
  }

  private resolveLightValidationMode(): "off" | "warn" | "enforce" {
    const raw = (process.env.AGENT_LIGHT_VALIDATION_MODE || "enforce").trim().toLowerCase();
    if (raw === "off" || raw === "warn" || raw === "enforce") {
      return raw;
    }
    return "enforce";
  }

  private resolveHeavyValidationMode(): "off" | "warn" | "enforce" {
    const raw = (process.env.AGENT_HEAVY_VALIDATION_MODE || "enforce").trim().toLowerCase();
    if (raw === "off" || raw === "warn" || raw === "enforce") {
      return raw;
    }
    return "enforce";
  }

  private resolveCorrectionConvergenceMode(): "off" | "warn" | "enforce" {
    const raw = (process.env.AGENT_CORRECTION_CONVERGENCE_MODE || "enforce").trim().toLowerCase();
    if (raw === "off" || raw === "warn" || raw === "enforce") {
      return raw;
    }
    return "enforce";
  }

  private resolveRunLockStaleSeconds(): number {
    const parsed = Number(process.env.AGENT_RUN_LOCK_STALE_SECONDS || 1800);
    if (!Number.isFinite(parsed)) {
      return 1800;
    }
    return Math.min(86_400, Math.max(60, Math.floor(parsed)));
  }

  private buildRunLockOwner(requestId: string): string {
    return `${process.pid}:${requestId}`;
  }

  private async ensureRunExecutionContext(input: {
    run: AgentRun;
    workspaceRoot: string;
    requestId: string;
  }): Promise<{ run: AgentRun; executionRoot: string }> {
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

    const run =
      (await this.store.updateAgentRun(input.run.id, {
        runBranch: resolved.runBranch,
        worktreePath: resolved.worktreePath,
        baseCommitHash: resolved.baseCommitHash,
        currentCommitHash: resolved.currentCommitHash,
        lastValidCommitHash:
          input.run.lastValidCommitHash || resolved.currentCommitHash || input.run.currentCommitHash || resolved.baseCommitHash
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

  private async recoverRunWorkspaceIfNeeded(input: {
    run: AgentRun;
    executionRoot: string;
    requestId: string;
  }): Promise<AgentRun> {
    const dirty = await isWorktreeDirty(input.executionRoot).catch(() => false);
    if (!dirty) {
      return input.run;
    }

    const recoveryRef = input.run.lastValidCommitHash || input.run.currentCommitHash || input.run.baseCommitHash;

    if (!recoveryRef) {
      throw new Error("Run worktree is dirty and no recovery commit hash is available.");
    }

    const currentCommitHash = await resetWorktreeToCommit(input.executionRoot, recoveryRef);
    const updated =
      (await this.store.updateAgentRun(input.run.id, {
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

  private async rollbackRunToLastValid(input: {
    run: AgentRun;
    executionRoot: string;
    requestId: string;
    reason: string;
  }): Promise<AgentRun> {
    const rollbackRef = input.run.lastValidCommitHash || input.run.currentCommitHash || input.run.baseCommitHash;

    if (!rollbackRef) {
      return input.run;
    }

    const rolledBackHash = await resetWorktreeToCommit(input.executionRoot, rollbackRef).catch(() => null);
    const nextHash = rolledBackHash || rollbackRef;

    const updated =
      (await this.store.updateAgentRun(input.run.id, {
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

  private async resolveProjectMetadata(input: {
    project: StartAgentRunInput["project"] | ResumeAgentRunInput["project"];
    projectRoot: string;
    requestId: string;
  }) {
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

  private async buildPlannerMemoryContext(input: {
    project: StartAgentRunInput["project"] | ResumeAgentRunInput["project"];
    projectRoot: string;
    requestId: string;
  }): Promise<PlannerMemoryContext> {
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

  private async getRunDetail(projectId: string, runId: string): Promise<AgentRunDetail | undefined> {
    const run = await this.store.getAgentRunById(projectId, runId);

    if (!run) {
      return undefined;
    }

    const steps = await this.store.listAgentStepsByRun(run.id);
    return this.buildRunDetail(run, steps);
  }

  private async queueRuntimeCorrection(input: {
    run: AgentRun;
    failedStep: AgentStep;
    failedStepRecord: AgentStepRecord;
    stepIndex: number;
    attempt: number;
    runtimeLogs: string;
    failureReport?: PlannerFailureReport;
    project: StartAgentRunInput["project"] | ResumeAgentRunInput["project"];
    executionRoot: string;
    requestId: string;
    plannerMemory?: PlannerMemoryContext;
  }): Promise<AgentRun> {
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

    const correctionStep: AgentStep = {
      ...correction,
      id: `runtime-correction-${input.attempt}`,
      type: "modify",
      input: {
        ...correction.input,
        _deepCorrection: correctionReasoning
      }
    };

    const retryStep: AgentStep = {
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

    return (
      (await this.store.updateAgentRun(input.run.id, {
        status: "correcting",
        currentStepIndex: input.stepIndex + 1,
        plan: input.run.plan,
        lastStepId: input.failedStepRecord.id,
        errorMessage: null,
        finishedAt: null
      })) || input.run
    );
  }

  private async queueHeavyValidationCorrection(input: {
    run: AgentRun;
    stepIndex: number;
    attempt: number;
    heavyValidationSummary: string;
    heavyValidationLogs: string;
    heavyFailureReport?: PlannerFailureReport;
    project: StartAgentRunInput["project"] | ResumeAgentRunInput["project"];
    executionRoot: string;
    requestId: string;
    plannerMemory?: PlannerMemoryContext;
  }): Promise<AgentRun> {
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

    const correctionStep: AgentStep = {
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

    return (
      (await this.store.updateAgentRun(input.run.id, {
        status: "optimizing",
        currentStepIndex: input.stepIndex + 1,
        plan: input.run.plan,
        errorMessage: null,
        finishedAt: null
      })) || input.run
    );
  }

  private async executeLoop(input: {
    run: AgentRun;
    project: StartAgentRunInput["project"] | ResumeAgentRunInput["project"];
    requestId: string;
    plannerMemory?: PlannerMemoryContext;
  }): Promise<AgentRunDetail> {
    let run = input.run;
    const workspaceRoot = this.store.getProjectWorkspacePath(input.project);
    const lockOwner = this.buildRunLockOwner(input.requestId);
    const acquired = await this.store.acquireAgentRunExecutionLock(
      run.id,
      lockOwner,
      this.resolveRunLockStaleSeconds()
    );

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
      run =
        (await this.store.updateAgentRun(run.id, {
          status: "running",
          errorMessage: null,
          finishedAt: null
        })) || run;
      let runtimeCorrectionCount = this.countRuntimeCorrectionSteps(run.plan);
      let heavyCorrectionCount = this.countHeavyCorrectionSteps(run.plan);
      let lastRuntimeFailureSignature: string | null = null;
      let lastHeavyBlockingCount: number | null = null;
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
        let commitHash: string | null = null;
        let runtimeStatus: string | null = null;
        let runtimeLogs = "";
        let heavyFailureReport: PlannerFailureReport | undefined;
        let queueHeavyCorrectionAttempt: number | null = null;
        let heavyRollbackReason: string | null = null;
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
            } else {
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
                throw new Error(
                  `Light validation failed with ${lightValidation.blockingCount} blocking violations.${summaryText ? ` ${summaryText}` : ""}`
                );
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
                  lastValidCommitHash:
                    fileSession.currentCommitHash || run.lastValidCommitHash || fileSession.baseCommitHash || null
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
          } catch (error) {
            await fileSession.abortStep().catch(() => undefined);
            status = "failed";
            errorMessage = `Step transaction failed: ${String((error as Error).message || error)}`;
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
            const signature = this.runtimeFailureSignature(errorMessage, runtimeLogs);
            const repeatedSignature =
              runtimeCorrectionCount > 0 && lastRuntimeFailureSignature !== null && signature === lastRuntimeFailureSignature;

            if (repeatedSignature && this.correctionConvergenceMode !== "off") {
              const message = `Runtime correction did not converge: repeated failure signature after ${runtimeCorrectionCount} correction attempt(s).`;

              if (this.correctionConvergenceMode === "enforce") {
                heavyRollbackReason = message;
                errorMessage = message;
                output = {
                  ...output,
                  runtimeStatus: "failed",
                  runtimeConvergence: {
                    ok: false,
                    repeatedSignature: true,
                    signature,
                    mode: this.correctionConvergenceMode
                  }
                };
              } else {
                output = {
                  ...output,
                  runtimeStatus: "failed",
                  runtimeConvergence: {
                    ok: false,
                    repeatedSignature: true,
                    signature,
                    mode: this.correctionConvergenceMode,
                    warning: message
                  }
                };
              }
            } else {
              output = {
                ...output,
                runtimeStatus: "failed"
              };
            }

            lastRuntimeFailureSignature = signature;
          } else {
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
              finishedAt: null
            })) || run;

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
                summary: heavyValidation.summary,
                failures: heavyValidation.failures
              }
            };

            if (!heavyValidation.ok) {
              const previousBlocking = lastHeavyBlockingCount;
              const regressionDetected =
                previousBlocking !== null && heavyValidation.blockingCount >= previousBlocking;
              const convergenceMessage =
                previousBlocking === null
                  ? null
                  : `Heavy validation did not converge: blocking count ${previousBlocking} -> ${heavyValidation.blockingCount}.`;

              if (regressionDetected && this.correctionConvergenceMode !== "off") {
                if (this.correctionConvergenceMode === "enforce") {
                  status = "failed";
                  heavyRollbackReason = convergenceMessage;
                  errorMessage = convergenceMessage;
                }

                output = {
                  ...output,
                  heavyValidation: {
                    ...(output.heavyValidation as Record<string, unknown>),
                    convergence: {
                      ok: false,
                      mode: this.correctionConvergenceMode,
                      previousBlockingCount: previousBlocking,
                      currentBlockingCount: heavyValidation.blockingCount,
                      warning: this.correctionConvergenceMode === "warn" ? convergenceMessage : undefined
                    }
                  }
                };
              }

              lastHeavyBlockingCount = heavyValidation.blockingCount;

              if (status === "completed") {
                if (heavyCorrectionCount < this.maxHeavyCorrectionAttempts) {
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
                } else {
                  status = "failed";
                  heavyRollbackReason = `Heavy validation failed after ${heavyCorrectionCount}/${this.maxHeavyCorrectionAttempts} correction attempts.`;
                  errorMessage = heavyRollbackReason;
                }
              }
            } else {
              lastHeavyBlockingCount = null;
            }
          } catch (error) {
            status = "failed";
            heavyRollbackReason = "Heavy validation execution failed.";
            errorMessage = `${heavyRollbackReason} ${String((error as Error).message || error)}`;
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

        steps.push(stepRecord);
        steps.sort((a, b) => a.stepIndex - b.stepIndex || a.attempt - b.attempt || a.createdAt.localeCompare(b.createdAt));

        if (queueHeavyCorrectionAttempt !== null) {
          try {
            const heavyValidationPayload =
              output.heavyValidation &&
              typeof output.heavyValidation === "object" &&
              !Array.isArray(output.heavyValidation)
                ? (output.heavyValidation as Record<string, unknown>)
                : {};

            const heavySummary =
              typeof heavyValidationPayload.summary === "string"
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
              plannerMemory: input.plannerMemory
            });

            heavyCorrectionCount = queueHeavyCorrectionAttempt;
            continue;
          } catch (error) {
            const correctionMessage = `Heavy validation correction planning failed: ${String((error as Error).message || error)}`;

            run =
              (await this.store.updateAgentRun(run.id, {
                status: "failed",
                currentStepIndex: stepIndex,
                lastStepId: stepRecord.id,
                errorMessage: correctionMessage,
                finishedAt: new Date().toISOString()
              })) || run;

            return this.buildRunDetail(run, steps);
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
          } catch (error) {
            const correctionMessage = `Runtime correction planning failed: ${String((error as Error).message || error)}`;

            run =
              (await this.store.updateAgentRun(run.id, {
                status: "failed",
                currentStepIndex: stepIndex,
                lastStepId: stepRecord.id,
                errorMessage: correctionMessage,
                finishedAt: new Date().toISOString()
              })) || run;

            return this.buildRunDetail(run, steps);
          }
        }

        if (status === "failed") {
          if (!heavyRollbackReason && this.isRuntimeVerifyStep(step) && runtimeCorrectionCount >= this.maxRuntimeCorrectionAttempts) {
            heavyRollbackReason = `Runtime correction limit reached (${runtimeCorrectionCount}/${this.maxRuntimeCorrectionAttempts}).`;
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
            finishedAt: done ? new Date().toISOString() : null,
            plan: run.plan
          })) || run;
      }

      return this.buildRunDetail(run, steps);
    } finally {
      await this.store.releaseAgentRunExecutionLock(run.id, lockOwner).catch(() => undefined);
    }
  }

  async startRun(input: StartAgentRunInput): Promise<StartAgentRunOutput> {
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
      status: plan.steps.length ? "queued" : "complete",
      currentStepIndex: 0,
      plan,
      errorMessage: null,
      finishedAt: plan.steps.length ? null : new Date().toISOString()
    });

    let detail: AgentRunDetail = this.buildRunDetail(run, []);

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
      telemetry: detail.telemetry,
      executedStep
    };
  }

  async resumeRun(input: ResumeAgentRunInput): Promise<ResumeAgentRunOutput> {
    const existing = await this.store.getAgentRunById(input.project.id, input.runId);

    if (!existing) {
      throw new Error("Agent run not found.");
    }

    if (existing.status === "complete") {
      const steps = await this.store.listAgentStepsByRun(existing.id);
      return this.buildRunDetail(existing, steps);
    }

    const run =
      (await this.store.updateAgentRun(existing.id, {
        status: "queued",
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

  async forkRun(input: ForkAgentRunInput): Promise<ForkAgentRunOutput> {
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

  async validateRunOutput(input: ValidateAgentRunInput): Promise<ValidateAgentRunOutput> {
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

  async getRun(projectId: string, runId: string): Promise<AgentRun | undefined> {
    const detail = await this.getRunDetail(projectId, runId);
    return detail?.run;
  }

  async getRunWithSteps(projectId: string, runId: string): Promise<AgentRunDetail | undefined> {
    return this.getRunDetail(projectId, runId);
  }

  async listRuns(projectId: string): Promise<AgentRun[]> {
    const runs = await this.store.listAgentRunsByProject(projectId);
    const hydrated: AgentRun[] = [];

    for (const run of runs) {
      const steps = await this.store.listAgentStepsByRun(run.id);
      hydrated.push(attachLastStep(run, steps));
    }

    return hydrated;
  }
}
