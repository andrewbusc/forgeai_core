import { z } from "zod";
import { Project } from "../types.js";
import { CanonicalAgentRunStatus, canonicalAgentRunStatusSchema } from "./run-status.js";

export const agentStepTypeSchema = z.enum(["analyze", "modify", "verify"]);
export type AgentStepType = z.infer<typeof agentStepTypeSchema>;

export const agentToolNameSchema = z.enum([
  "ai_mutation",
  "manual_file_write",
  "read_file",
  "write_file",
  "apply_patch",
  "list_files",
  "run_preview_container",
  "fetch_runtime_logs"
]);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;

export const agentStepSchema = z.object({
  id: z.string().min(1).max(80),
  type: agentStepTypeSchema,
  tool: agentToolNameSchema,
  mutates: z.boolean().optional(),
  input: z.record(z.unknown()).default({})
});
export type AgentStep = z.infer<typeof agentStepSchema>;

export const agentPlanSchema = z.object({
  goal: z.string().min(1).max(8_000),
  steps: z.array(agentStepSchema).min(1).max(20)
});
export type AgentPlan = z.infer<typeof agentPlanSchema>;

export const agentRunStatusSchema = canonicalAgentRunStatusSchema;
export type AgentRunStatus = CanonicalAgentRunStatus;
export const agentRunValidationStatusSchema = z.enum(["failed", "passed"]);
export type AgentRunValidationStatus = z.infer<typeof agentRunValidationStatusSchema>;

export const agentStepExecutionStatusSchema = z.enum(["completed", "failed"]);
export type AgentStepExecutionStatus = z.infer<typeof agentStepExecutionStatusSchema>;

export const agentRunJobTypeSchema = z.enum(["kernel", "validation", "evaluation"]);
export type AgentRunJobType = z.infer<typeof agentRunJobTypeSchema>;

export const agentRunJobStatusSchema = z.enum(["queued", "claimed", "running", "complete", "failed"]);
export type AgentRunJobStatus = z.infer<typeof agentRunJobStatusSchema>;

export const workerNodeRoleSchema = z.enum(["compute", "eval"]);
export type WorkerNodeRole = z.infer<typeof workerNodeRoleSchema>;

export const workerNodeStatusSchema = z.enum(["online", "offline"]);
export type WorkerNodeStatus = z.infer<typeof workerNodeStatusSchema>;

export const agentRunExecutionValidationModeSchema = z.enum(["off", "warn", "enforce"]);
export type AgentRunExecutionValidationMode = z.infer<typeof agentRunExecutionValidationModeSchema>;

export const agentRunExecutionProfileSchema = z.enum(["full", "ci", "smoke"]);
export type AgentRunExecutionProfile = z.infer<typeof agentRunExecutionProfileSchema>;

export interface AgentContext {
  project: Project;
  projectRoot: string;
  requestId: string;
}

export interface AgentStepExecution {
  stepId: string;
  tool: AgentToolName;
  type: AgentStepType;
  status: AgentStepExecutionStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  finishedAt: string;
}

export interface AgentStepRecord {
  id: string;
  runId: string;
  projectId: string;
  stepIndex: number;
  attempt: number;
  stepId: string;
  type: AgentStepType;
  tool: AgentToolName;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  status: AgentStepExecutionStatus;
  errorMessage: string | null;
  commitHash: string | null;
  runtimeStatus: string | null;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  correctionTelemetry?: AgentCorrectionTelemetry | null;
  correctionPolicy?: AgentCorrectionPolicyTelemetry | null;
}

export interface AgentRun {
  id: string;
  projectId: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  goal: string;
  providerId: string;
  model?: string;
  status: AgentRunStatus;
  currentStepIndex: number;
  plan: AgentPlan;
  lastStepId?: string | null;
  lastStep?: AgentStepExecution;
  runBranch?: string | null;
  worktreePath?: string | null;
  baseCommitHash?: string | null;
  currentCommitHash?: string | null;
  lastValidCommitHash?: string | null;
  correctionAttempts: number;
  lastCorrectionReason?: string | null;
  validationStatus?: AgentRunValidationStatus | null;
  validationResult?: Record<string, unknown> | null;
  validatedAt?: string | null;
  runLockOwner?: string | null;
  runLockAcquiredAt?: string | null;
  metadata?: Record<string, unknown>;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunJob {
  id: string;
  runId: string;
  jobType: AgentRunJobType;
  targetRole: WorkerNodeRole;
  status: AgentRunJobStatus;
  requiredCapabilities?: Record<string, unknown> | null;
  assignedNode?: string | null;
  leaseExpiresAt?: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerNode {
  nodeId: string;
  role: WorkerNodeRole;
  capabilities: Record<string, unknown>;
  lastHeartbeat: string;
  status: WorkerNodeStatus;
}

export interface StartAgentRunInput {
  project: Project;
  createdByUserId: string;
  goal: string;
  providerId: string;
  model?: string;
  requestId: string;
  executionConfig?: Partial<AgentRunExecutionConfig>;
}

export interface StartAgentRunWithPlanInput {
  project: Project;
  createdByUserId: string;
  goal: string;
  providerId: string;
  model?: string;
  plan: AgentPlan;
  requestId: string;
  metadata?: Record<string, unknown>;
  executionMode?: "isolated" | "project";
  executionProfile?: "default" | "builder";
  executionConfig?: Partial<AgentRunExecutionConfig>;
}

export interface ResumeAgentRunInput {
  project: Project;
  runId: string;
  requestId: string;
  createdByUserId?: string;
  executionConfig?: Partial<AgentRunExecutionConfig>;
  overrideExecutionConfig?: boolean;
  fork?: boolean;
}

export interface ForkAgentRunInput {
  project: Project;
  runId: string;
  stepId: string;
  createdByUserId: string;
  requestId: string;
}

export interface ValidateAgentRunInput {
  project: Project;
  runId: string;
  requestId: string;
}

export interface ValidateAgentRunOutput {
  run: AgentRun;
  targetPath: string;
  validation: {
    ok: boolean;
    blockingCount: number;
    warningCount: number;
    summary: string;
    checks: Array<{
      id: string;
      status: "pass" | "fail" | "skip";
      message: string;
      details?: Record<string, unknown>;
    }>;
  };
}

export interface AgentRunDetail {
  run: AgentRun;
  steps: AgentStepRecord[];
  telemetry: AgentRunTelemetry;
  executionConfigSummary?: AgentRunExecutionConfig;
  contract?: AgentRunExecutionContract;
  stubDebt?: {
    markerCount: number;
    markerPaths: string[];
    openCount: number;
    openTargets: string[];
    lastStubPath: string | null;
    lastPaydownAction: string | null;
    lastPaydownStatus: "open" | "closed" | null;
    lastPaydownAt: string | null;
  };
}

export interface AgentCorrectionClassificationTelemetry {
  intent: PlannerCorrectionIntent;
  failedChecks: string[];
  failureKinds: string[];
  rationale: string;
}

export interface AgentCorrectionTelemetry {
  phase: string;
  attempt: number;
  failedStepId: string;
  reason?: string;
  summary?: string;
  runtimeLogTail?: string;
  classification: AgentCorrectionClassificationTelemetry;
  constraint: PlannerCorrectionConstraint;
  createdAt: string;
}

export interface AgentCorrectionPolicyViolation {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface AgentCorrectionPolicyTelemetry {
  ok: boolean;
  mode?: "off" | "warn" | "enforce";
  blockingCount: number;
  warningCount: number;
  summary: string;
  violations: AgentCorrectionPolicyViolation[];
}

export interface AgentRunCorrectionTelemetryEntry {
  stepRecordId: string;
  stepId: string;
  stepIndex: number;
  stepAttempt: number;
  status: AgentStepExecutionStatus;
  errorMessage: string | null;
  commitHash: string | null;
  createdAt: string;
  telemetry: AgentCorrectionTelemetry;
  correctionPolicy?: AgentCorrectionPolicyTelemetry | null;
}

export interface AgentRunCorrectionPolicyTelemetryEntry {
  stepRecordId: string;
  stepId: string;
  stepIndex: number;
  stepAttempt: number;
  status: AgentStepExecutionStatus;
  errorMessage: string | null;
  commitHash: string | null;
  createdAt: string;
  policy: AgentCorrectionPolicyTelemetry;
}

export interface AgentRunTelemetry {
  corrections: AgentRunCorrectionTelemetryEntry[];
  correctionPolicies: AgentRunCorrectionPolicyTelemetryEntry[];
}

export interface StartAgentRunOutput extends AgentRunDetail {
  executedStep?: AgentStepExecution;
  queuedJob?: AgentRunJob;
}

export interface ResumeAgentRunOutput extends AgentRunDetail {
  queuedJob?: AgentRunJob;
}

export interface ForkAgentRunOutput extends AgentRunDetail {}

export interface ProjectArchitectureSummary {
  framework: string;
  database: string;
  auth: string;
  payment: string;
  keyFiles: string[];
}

export interface ProjectMetadata {
  projectId: string;
  orgId: string;
  workspaceId: string;
  architectureSummary: ProjectArchitectureSummary;
  stackInfo: Record<string, unknown>;
  lastAnalyzedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerMemoryContext {
  stackInfo: Record<string, unknown>;
  architectureSummary: ProjectArchitectureSummary;
  recentCommits: Array<{
    hash: string;
    shortHash: string;
    subject: string;
    date: string;
  }>;
  recentAgentRuns: Array<{
    id: string;
    goal: string;
    status: AgentRunStatus;
    updatedAt: string;
    errorMessage: string | null;
  }>;
}

export interface PlannerInput {
  goal: string;
  providerId: string;
  model?: string;
  project: Project;
  projectRoot: string;
  memory?: PlannerMemoryContext;
  plannerTimeoutMs?: number;
}

export interface PlannerFailureDiagnostic {
  sourceCheckId: string;
  kind: "typescript" | "test" | "boot" | "migration" | "dependency" | "unknown";
  code?: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  excerpt?: string;
}

export interface PlannerFailureReport {
  summary: string;
  failures: PlannerFailureDiagnostic[];
}

export type PlannerCorrectionIntent =
  | "runtime_boot"
  | "runtime_health"
  | "typescript_compile"
  | "test_failure"
  | "migration_failure"
  | "architecture_violation"
  | "security_baseline"
  | "unknown";

export interface PlannerCorrectionConstraint {
  intent: PlannerCorrectionIntent;
  maxFiles: number;
  maxTotalDiffBytes: number;
  allowedPathPrefixes: string[];
  guidance: string[];
}

export interface PlannerRuntimeCorrectionInput extends PlannerInput {
  failedStepId: string;
  runtimeLogs: string;
  attempt: number;
  failureReport?: PlannerFailureReport;
  correctionConstraint?: PlannerCorrectionConstraint;
}

export interface AgentRunExecutionConfig {
  schemaVersion: number;
  profile: AgentRunExecutionProfile;
  lightValidationMode: AgentRunExecutionValidationMode;
  heavyValidationMode: AgentRunExecutionValidationMode;
  maxRuntimeCorrectionAttempts: number;
  maxHeavyCorrectionAttempts: number;
  correctionPolicyMode: AgentRunExecutionValidationMode;
  correctionConvergenceMode: AgentRunExecutionValidationMode;
  plannerTimeoutMs: number;
  maxFilesPerStep: number;
  maxTotalDiffBytes: number;
  maxFileBytes: number;
  allowEnvMutation: boolean;
}

export interface AgentRunExecutionContract {
  schemaVersion: number;
  hash: string;
  material: {
    executionContractSchemaVersion: number;
    normalizedExecutionConfig: AgentRunExecutionConfig;
    determinismPolicyVersion: number;
    plannerPolicyVersion: number;
    correctionRecipeVersion: number;
    validationPolicyVersion: number;
    randomnessSeed: string;
  };
  effectiveConfig: AgentRunExecutionConfig;
  fallbackUsed: boolean;
  fallbackFields: Array<keyof AgentRunExecutionConfig>;
}

export function withAgentStepCapabilities(step: AgentStep): AgentStep {
  if (typeof step.mutates === "boolean") {
    return step;
  }

  return {
    ...step,
    mutates: step.type === "modify"
  };
}

export function withAgentPlanCapabilities(plan: AgentPlan): AgentPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => withAgentStepCapabilities(step))
  };
}
