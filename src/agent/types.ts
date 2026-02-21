import { z } from "zod";
import { Project } from "../types.js";
import { CanonicalAgentRunStatus, canonicalAgentRunStatusSchema } from "./run-status.js";

export const agentStepTypeSchema = z.enum(["analyze", "modify", "verify"]);
export type AgentStepType = z.infer<typeof agentStepTypeSchema>;

export const agentToolNameSchema = z.enum([
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

export const agentStepExecutionStatusSchema = z.enum(["completed", "failed"]);
export type AgentStepExecutionStatus = z.infer<typeof agentStepExecutionStatusSchema>;

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
  runLockOwner?: string | null;
  runLockAcquiredAt?: string | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StartAgentRunInput {
  project: Project;
  createdByUserId: string;
  goal: string;
  providerId: string;
  model?: string;
  requestId: string;
}

export interface ResumeAgentRunInput {
  project: Project;
  runId: string;
  requestId: string;
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
}

export interface AgentRunTelemetry {
  corrections: AgentRunCorrectionTelemetryEntry[];
}

export interface StartAgentRunOutput extends AgentRunDetail {
  executedStep?: AgentStepExecution;
}

export interface ResumeAgentRunOutput extends AgentRunDetail {}

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
