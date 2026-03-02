import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, PoolClient, QueryResultRow } from "pg";
import { ensureDir } from "./fs-utils.js";
import { resolveWorkspaceRoot } from "./workspace.js";
import {
  AuthSession,
  Deployment,
  DeploymentStatus,
  MembershipRole,
  Organization,
  OrganizationMembership,
  Project,
  ProjectTemplateId,
  PublicUser,
  User,
  Workspace
} from "../types.js";
import {
  AgentPlan,
  AgentRunJob,
  AgentRunJobStatus,
  AgentRunJobType,
  AgentRun,
  AgentRunStatus,
  AgentRunValidationStatus,
  AgentStepRecord,
  AgentStepType,
  ProjectArchitectureSummary,
  ProjectMetadata,
  WorkerNode,
  WorkerNodeRole,
  WorkerNodeStatus
} from "../agent/types.js";
import {
  AgentLifecycleRun,
  AgentLifecycleStep,
  AgentRunLifecycleStatus,
  AgentRunPhase,
  AgentRunStepStatus,
  AgentRunStepType,
  CreateLifecycleRunInput,
  CreateLifecycleStepInput,
  LifecycleRunPatchInput,
  LifecycleStepPatchInput
} from "../agent/run-state-types.js";

interface CreateProjectInput {
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  name: string;
  description?: string;
  templateId: ProjectTemplateId;
}

interface CreateSessionInput {
  sessionId?: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
}

interface CreateDeploymentInput {
  deploymentId?: string;
  projectId: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  runId?: string | null;
  commitHash?: string | null;
  status: DeploymentStatus;
  subdomain: string;
  publicUrl: string;
  customDomain?: string | null;
  metadata?: Record<string, unknown>;
  containerPort?: number | null;
  imageRepository?: string | null;
  imageTag?: string | null;
  imageRef?: string | null;
  registryHost?: string | null;
}

interface DeploymentPatchInput {
  status?: DeploymentStatus;
  imageRepository?: string | null;
  imageTag?: string | null;
  imageRef?: string | null;
  imageDigest?: string | null;
  registryHost?: string | null;
  containerName?: string | null;
  containerId?: string | null;
  containerPort?: number | null;
  hostPort?: number | null;
  subdomain?: string;
  publicUrl?: string;
  customDomain?: string | null;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  errorMessage?: string | null;
  finishedAt?: string | null;
}

interface CreateAgentRunInput {
  runId?: string;
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
  runBranch?: string | null;
  worktreePath?: string | null;
  baseCommitHash?: string | null;
  currentCommitHash?: string | null;
  lastValidCommitHash?: string | null;
  metadata?: Record<string, unknown> | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
  finishedAt?: string | null;
}

interface AgentRunPatchInput {
  status?: AgentRunStatus;
  currentStepIndex?: number;
  plan?: AgentPlan;
  lastStepId?: string | null;
  runBranch?: string | null;
  worktreePath?: string | null;
  baseCommitHash?: string | null;
  currentCommitHash?: string | null;
  lastValidCommitHash?: string | null;
  correctionAttempts?: number;
  lastCorrectionReason?: string | null;
  validationStatus?: AgentRunValidationStatus | null;
  validationResult?: Record<string, unknown> | null;
  validatedAt?: string | null;
  runLockOwner?: string | null;
  runLockAcquiredAt?: string | null;
  metadata?: Record<string, unknown> | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
  finishedAt?: string | null;
}

interface CreateAgentStepInput {
  runId: string;
  projectId: string;
  stepIndex: number;
  stepId: string;
  type: AgentStepType;
  tool: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  status: "completed" | "failed";
  errorMessage?: string | null;
  commitHash?: string | null;
  runtimeStatus?: string | null;
  startedAt: string;
  finishedAt: string;
}

interface LearningEventWriteInput {
  runId: string;
  projectId: string;
  stepIndex?: number;
  eventType: "generate" | "correction" | "validation" | "completion";
  phase?: string | null;
  clusters?: unknown;
  blockingBefore?: number | null;
  blockingAfter?: number | null;
  architectureCollapse?: boolean | null;
  invariantCount?: number | null;
  metadata?: Record<string, unknown> | null;
  outcome: "success" | "failed" | "improved" | "regressed" | "noop" | "provisionally_fixed" | "stalled";
}

function deriveLearningEventMetrics(
  blockingBefore: number | null | undefined,
  blockingAfter: number | null | undefined
): {
  delta: number | null;
  regressionFlag: boolean;
  convergenceFlag: boolean;
} {
  const hasBlockingValues = typeof blockingBefore === "number" && typeof blockingAfter === "number";

  return {
    delta: hasBlockingValues ? blockingBefore - blockingAfter : null,
    regressionFlag: hasBlockingValues ? blockingAfter > blockingBefore : false,
    convergenceFlag: typeof blockingAfter === "number" ? blockingAfter === 0 : false
  };
}

interface CreateRunJobInput {
  runId: string;
  jobType: AgentRunJobType;
  targetRole: WorkerNodeRole;
  requiredCapabilities?: Record<string, unknown> | null;
}

interface UpsertWorkerNodeHeartbeatInput {
  nodeId: string;
  role: WorkerNodeRole;
  capabilities?: Record<string, unknown>;
  status?: WorkerNodeStatus;
}

interface UpsertProjectMetadataInput {
  projectId: string;
  orgId: string;
  workspaceId: string;
  architectureSummary: ProjectArchitectureSummary;
  stackInfo: Record<string, unknown>;
  lastAnalyzedAt?: string;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  template_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects (org_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON projects (workspace_id);

CREATE TABLE IF NOT EXISTS project_metadata (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  architecture_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  stack_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_analyzed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_metadata_org_id ON project_metadata (org_id);
CREATE INDEX IF NOT EXISTS idx_project_metadata_workspace_id ON project_metadata (workspace_id);

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  run_id UUID,
  commit_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'building', 'pushing', 'launching', 'ready', 'failed')),
  image_repository TEXT,
  image_tag TEXT,
  image_ref TEXT,
  image_digest TEXT,
  registry_host TEXT,
  container_name TEXT,
  container_id TEXT,
  container_port INTEGER,
  host_port INTEGER,
  subdomain TEXT NOT NULL,
  public_url TEXT NOT NULL,
  custom_domain TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments (project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project_created_at ON deployments (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_project_active ON deployments (project_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  goal TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'goal' CHECK (phase IN ('goal', 'optimization')),
  provider_id TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'correcting', 'optimizing', 'validating', 'cancelled', 'failed', 'complete'
  )),
  step_index INTEGER NOT NULL DEFAULT 0,
  corrections_used INTEGER NOT NULL DEFAULT 0,
  optimization_steps_used INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL DEFAULT 20,
  max_corrections INTEGER NOT NULL DEFAULT 2,
  max_optimizations INTEGER NOT NULL DEFAULT 2,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_step_id UUID,
  run_branch TEXT,
  worktree_path TEXT,
  base_commit_hash TEXT,
  current_commit_hash TEXT,
  last_valid_commit_hash TEXT,
  correction_attempts INTEGER NOT NULL DEFAULT 0,
  last_correction_reason TEXT,
  validation_status TEXT CHECK (validation_status IN ('failed', 'passed')),
  validation_result JSONB,
  validated_at TIMESTAMPTZ,
  run_lock_owner TEXT,
  run_lock_acquired_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_id ON agent_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project_created_at ON agent_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (status);

CREATE TABLE IF NOT EXISTS agent_steps (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  step_id TEXT NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN (
    'goal', 'correction', 'optimization',
    'analyze', 'modify', 'verify'
  )),
  tool TEXT NOT NULL,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed', 'completed')),
  summary TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  commit_hash TEXT,
  runtime_status TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_run_step_index ON agent_steps (run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_id ON agent_steps (run_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_project_id ON agent_steps (project_id);

CREATE TABLE IF NOT EXISTS run_jobs (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('kernel', 'validation', 'evaluation')),
  target_role TEXT NOT NULL CHECK (target_role IN ('compute', 'eval')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'running', 'complete', 'failed')),
  required_capabilities JSONB,
  assigned_node TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_jobs_target_role_status_created_at
  ON run_jobs (target_role, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_run_jobs_lease_expires_at ON run_jobs (lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_run_jobs_required_caps ON run_jobs USING GIN (required_capabilities);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_jobs_active_run_id
  ON run_jobs (run_id)
  WHERE status IN ('queued', 'claimed', 'running');

CREATE TABLE IF NOT EXISTS worker_nodes (
  node_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('compute', 'eval')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online', 'offline'))
);

CREATE INDEX IF NOT EXISTS idx_worker_nodes_role_status ON worker_nodes (role, status);
CREATE INDEX IF NOT EXISTS idx_worker_nodes_last_heartbeat ON worker_nodes (last_heartbeat);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits (reset_at);
`;

const deploymentSelectColumns = `
id, project_id, org_id, workspace_id, created_by_user_id, run_id, commit_hash, status,
image_repository, image_tag, image_ref, image_digest, registry_host,
container_name, container_id, container_port, host_port,
subdomain, public_url, custom_domain, is_active, metadata, logs,
error_message, created_at, updated_at, finished_at
`;

const agentRunSelectColumns = `
id, project_id, org_id, workspace_id, created_by_user_id, goal,
provider_id, model, status, current_step_index, plan, last_step_id,
run_branch, worktree_path, base_commit_hash, current_commit_hash, last_valid_commit_hash,
correction_attempts, last_correction_reason,
validation_status, validation_result, validated_at,
run_lock_owner, run_lock_acquired_at, metadata,
error_message, error_details, created_at, updated_at, finished_at
`;

const agentStepSelectColumns = `
id, run_id, project_id, step_index, attempt, step_id, step_type, tool,
input_payload, output_payload, status, error_message, commit_hash,
runtime_status, started_at, finished_at, created_at
`;

const runJobSelectColumns = `
id, run_id, job_type, target_role, status, required_capabilities, assigned_node, lease_expires_at,
attempt_count, created_at, updated_at
`;

const workerNodeSelectColumns = `
node_id, role, capabilities, last_heartbeat, status
`;

const projectMetadataSelectColumns = `
project_id, org_id, workspace_id, architecture_summary, stack_info,
last_analyzed_at, created_at, updated_at
`;

const lifecycleRunSelectColumns = `
id, project_id, org_id, workspace_id, created_by_user_id, goal, phase, status,
step_index, corrections_used, optimization_steps_used, max_steps, max_corrections,
max_optimizations, error_message, created_at, updated_at
`;

const lifecycleStepSelectColumns = `
id, run_id, project_id, step_index, step_type, status, summary, commit_hash,
created_at, completed_at
`;

interface DbProjectRow {
  id: string;
  org_id: string;
  workspace_id: string;
  created_by_user_id: string;
  name: string;
  description: string;
  template_id: ProjectTemplateId;
  created_at: Date | string;
  updated_at: Date | string;
  history: unknown;
  messages: unknown;
}

interface DbProjectMetadataRow {
  project_id: string;
  org_id: string;
  workspace_id: string;
  architecture_summary: unknown;
  stack_info: unknown;
  last_analyzed_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbUserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbOrganizationRow {
  id: string;
  name: string;
  slug: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbWorkspaceRow {
  id: string;
  org_id: string;
  name: string;
  description: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbMembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: Date | string;
}

interface DbSessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  ip_address: string | null;
  user_agent: string | null;
}

interface DbDeploymentRow {
  id: string;
  project_id: string;
  org_id: string;
  workspace_id: string;
  created_by_user_id: string;
  run_id: string | null;
  commit_hash: string | null;
  status: DeploymentStatus;
  image_repository: string | null;
  image_tag: string | null;
  image_ref: string | null;
  image_digest: string | null;
  registry_host: string | null;
  container_name: string | null;
  container_id: string | null;
  container_port: number | null;
  host_port: number | null;
  subdomain: string;
  public_url: string;
  custom_domain: string | null;
  is_active: boolean;
  metadata: unknown;
  logs: string;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
}

interface DbAgentRunRow {
  id: string;
  project_id: string;
  org_id: string;
  workspace_id: string;
  created_by_user_id: string;
  goal: string;
  provider_id: string;
  model: string | null;
  status: AgentRunStatus;
  current_step_index: number;
  plan: unknown;
  last_step_id: string | null;
  run_branch: string | null;
  worktree_path: string | null;
  base_commit_hash: string | null;
  current_commit_hash: string | null;
  last_valid_commit_hash: string | null;
  correction_attempts: number | null;
  last_correction_reason: string | null;
  validation_status: string | null;
  validation_result: unknown;
  validated_at: Date | string | null;
  run_lock_owner: string | null;
  run_lock_acquired_at: Date | string | null;
  metadata: unknown;
  error_message: string | null;
  error_details: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
}

interface DbAgentStepRow {
  id: string;
  run_id: string;
  project_id: string;
  step_index: number;
  attempt: number;
  step_id: string;
  step_type: AgentStepType;
  tool: string;
  input_payload: unknown;
  output_payload: unknown;
  status: "completed" | "failed";
  error_message: string | null;
  commit_hash: string | null;
  runtime_status: string | null;
  started_at: Date | string;
  finished_at: Date | string;
  created_at: Date | string;
}

interface DbRunJobRow {
  id: string;
  run_id: string;
  job_type: AgentRunJobType;
  target_role: WorkerNodeRole;
  status: AgentRunJobStatus;
  required_capabilities: unknown;
  assigned_node: string | null;
  lease_expires_at: Date | string | null;
  attempt_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbWorkerNodeRow {
  node_id: string;
  role: WorkerNodeRole;
  capabilities: unknown;
  last_heartbeat: Date | string;
  status: WorkerNodeStatus;
}

interface DbLifecycleRunRow {
  id: string;
  project_id: string;
  org_id: string;
  workspace_id: string;
  created_by_user_id: string;
  goal: string;
  phase: AgentRunPhase;
  status: AgentRunLifecycleStatus;
  step_index: number;
  corrections_used: number;
  optimization_steps_used: number;
  max_steps: number;
  max_corrections: number;
  max_optimizations: number;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbLifecycleStepRow {
  id: string;
  run_id: string;
  project_id: string;
  step_index: number;
  step_type: AgentRunStepType;
  status: AgentRunStepStatus;
  summary: string;
  commit_hash: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function isPgUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: string }).code) === "23505"
  );
}

function mapUser(row: DbUserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapOrganization(row: DbOrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapWorkspace(row: DbWorkspaceRow): Workspace {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapMembership(row: DbMembershipRow): OrganizationMembership {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    role: row.role,
    createdAt: toIso(row.created_at)
  };
}

function mapSession(row: DbSessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    expiresAt: toIso(row.expires_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent
  };
}

function mapProject(row: DbProjectRow): Project {
  return {
    id: row.id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    name: row.name,
    description: row.description,
    templateId: row.template_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    history: Array.isArray(row.history) ? row.history : [],
    messages: Array.isArray(row.messages) ? row.messages : []
  };
}

function mapProjectMetadata(row: DbProjectMetadataRow): ProjectMetadata {
  const architectureRaw =
    row.architecture_summary && typeof row.architecture_summary === "object" && !Array.isArray(row.architecture_summary)
      ? (row.architecture_summary as Record<string, unknown>)
      : {};

  return {
    projectId: row.project_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    architectureSummary: {
      framework:
        typeof architectureRaw.framework === "string" && architectureRaw.framework
          ? architectureRaw.framework
          : "Unknown",
      database:
        typeof architectureRaw.database === "string" && architectureRaw.database
          ? architectureRaw.database
          : "Unknown",
      auth: typeof architectureRaw.auth === "string" && architectureRaw.auth ? architectureRaw.auth : "None detected",
      payment:
        typeof architectureRaw.payment === "string" && architectureRaw.payment
          ? architectureRaw.payment
          : "None detected",
      keyFiles: Array.isArray(architectureRaw.keyFiles)
        ? architectureRaw.keyFiles.filter((item): item is string => typeof item === "string").slice(0, 20)
        : []
    },
    stackInfo:
      row.stack_info && typeof row.stack_info === "object" && !Array.isArray(row.stack_info)
        ? (row.stack_info as Record<string, unknown>)
        : {},
    lastAnalyzedAt: toIso(row.last_analyzed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapDeployment(row: DbDeploymentRow): Deployment {
  return {
    id: row.id,
    projectId: row.project_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    runId: row.run_id,
    commitHash: row.commit_hash,
    status: row.status,
    imageRepository: row.image_repository,
    imageTag: row.image_tag,
    imageRef: row.image_ref,
    imageDigest: row.image_digest,
    registryHost: row.registry_host,
    containerName: row.container_name,
    containerId: row.container_id,
    containerPort: row.container_port,
    hostPort: row.host_port,
    subdomain: row.subdomain,
    publicUrl: row.public_url,
    customDomain: row.custom_domain,
    isActive: row.is_active,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    logs: row.logs || "",
    errorMessage: row.error_message,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null
  };
}

function normalizeAgentRunStatus(value: unknown): AgentRunStatus {
  const raw = String(value || "").trim().toLowerCase();

  if (raw === "planned") {
    return "queued";
  }

  if (raw === "paused" || raw === "cancelling") {
    return "cancelled";
  }

  if (raw === "completed") {
    return "complete";
  }

  if (
    raw === "queued" ||
    raw === "running" ||
    raw === "correcting" ||
    raw === "optimizing" ||
    raw === "validating" ||
    raw === "cancelled" ||
    raw === "failed" ||
    raw === "complete"
  ) {
    return raw;
  }

  return "failed";
}

function normalizeAgentRunValidationStatus(value: unknown): AgentRunValidationStatus | null {
  const raw = String(value || "").trim().toLowerCase();

  if (raw === "failed" || raw === "passed") {
    return raw;
  }

  return null;
}

function normalizeAgentRunJobStatus(value: unknown): AgentRunJobStatus {
  const raw = String(value || "").trim().toLowerCase();

  if (raw === "queued" || raw === "claimed" || raw === "running" || raw === "complete" || raw === "failed") {
    return raw;
  }

  return "failed";
}

function normalizeAgentRunJobType(value: unknown): AgentRunJobType {
  const raw = String(value || "").trim().toLowerCase();

  if (raw === "kernel" || raw === "validation" || raw === "evaluation") {
    return raw;
  }

  return "kernel";
}

function normalizeWorkerNodeRole(value: unknown): WorkerNodeRole {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "eval" ? "eval" : "compute";
}

function normalizeWorkerNodeStatus(value: unknown): WorkerNodeStatus {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "offline" ? "offline" : "online";
}

function mapAgentRun(row: DbAgentRunRow): AgentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    goal: row.goal,
    providerId: row.provider_id,
    model: row.model || undefined,
    status: normalizeAgentRunStatus(row.status),
    currentStepIndex: Number(row.current_step_index) || 0,
    plan:
      row.plan && typeof row.plan === "object" && !Array.isArray(row.plan)
        ? (row.plan as AgentPlan)
        : ({ goal: row.goal, steps: [] } as AgentPlan),
    lastStepId: row.last_step_id,
    runBranch: row.run_branch,
    worktreePath: row.worktree_path,
    baseCommitHash: row.base_commit_hash,
    currentCommitHash: row.current_commit_hash,
    lastValidCommitHash: row.last_valid_commit_hash,
    correctionAttempts: Math.max(0, Number(row.correction_attempts) || 0),
    lastCorrectionReason: row.last_correction_reason,
    validationStatus: normalizeAgentRunValidationStatus(row.validation_status),
    validationResult:
      row.validation_result && typeof row.validation_result === "object" && !Array.isArray(row.validation_result)
        ? (row.validation_result as Record<string, unknown>)
        : null,
    validatedAt: row.validated_at ? toIso(row.validated_at) : null,
    runLockOwner: row.run_lock_owner,
    runLockAcquiredAt: row.run_lock_acquired_at ? toIso(row.run_lock_acquired_at) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    errorMessage: row.error_message,
    errorDetails:
      row.error_details && typeof row.error_details === "object" && !Array.isArray(row.error_details)
        ? (row.error_details as Record<string, unknown>)
        : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null
  };
}

function mapAgentStep(row: DbAgentStepRow): AgentStepRecord {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    stepIndex: Number(row.step_index) || 0,
    attempt: Math.max(1, Number(row.attempt) || 1),
    stepId: row.step_id,
    type: row.step_type,
    tool: row.tool as AgentStepRecord["tool"],
    inputPayload:
      row.input_payload && typeof row.input_payload === "object" && !Array.isArray(row.input_payload)
        ? (row.input_payload as Record<string, unknown>)
        : {},
    outputPayload:
      row.output_payload && typeof row.output_payload === "object" && !Array.isArray(row.output_payload)
        ? (row.output_payload as Record<string, unknown>)
        : {},
    status: row.status,
    errorMessage: row.error_message,
    commitHash: row.commit_hash,
    runtimeStatus: row.runtime_status,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    createdAt: toIso(row.created_at)
  };
}

function mapRunJob(row: DbRunJobRow): AgentRunJob {
  return {
    id: row.id,
    runId: row.run_id,
    jobType: normalizeAgentRunJobType(row.job_type),
    targetRole: normalizeWorkerNodeRole(row.target_role),
    status: normalizeAgentRunJobStatus(row.status),
    requiredCapabilities:
      row.required_capabilities && typeof row.required_capabilities === "object" && !Array.isArray(row.required_capabilities)
        ? (row.required_capabilities as Record<string, unknown>)
        : null,
    assignedNode: row.assigned_node,
    leaseExpiresAt: row.lease_expires_at ? toIso(row.lease_expires_at) : null,
    attemptCount: Math.max(0, Number(row.attempt_count) || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapWorkerNode(row: DbWorkerNodeRow): WorkerNode {
  return {
    nodeId: row.node_id,
    role: normalizeWorkerNodeRole(row.role),
    capabilities:
      row.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)
        ? (row.capabilities as Record<string, unknown>)
        : {},
    lastHeartbeat: toIso(row.last_heartbeat),
    status: normalizeWorkerNodeStatus(row.status)
  };
}

function mapLifecycleRun(row: DbLifecycleRunRow): AgentLifecycleRun {
  return {
    id: row.id,
    projectId: row.project_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    goal: row.goal,
    phase: row.phase,
    status: row.status,
    stepIndex: Number(row.step_index) || 0,
    correctionsUsed: Number(row.corrections_used) || 0,
    optimizationStepsUsed: Number(row.optimization_steps_used) || 0,
    maxSteps: Number(row.max_steps) || 0,
    maxCorrections: Number(row.max_corrections) || 0,
    maxOptimizations: Number(row.max_optimizations) || 0,
    errorMessage: row.error_message,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapLifecycleStep(row: DbLifecycleStepRow): AgentLifecycleStep {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    stepIndex: Number(row.step_index) || 0,
    type: row.step_type,
    status: row.status,
    summary: row.summary || "",
    commitHash: row.commit_hash,
    createdAt: toIso(row.created_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null
  };
}

export class AppStore {
  private readonly workspaceDir: string;
  private readonly pool: Pool;

  constructor(rootDir?: string) {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required.");
    }

    this.workspaceDir = path.join(resolveWorkspaceRoot(rootDir), ".workspace");
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl:
        process.env.DATABASE_SSL === "require"
          ? {
              rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
            }
          : undefined
    });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();

    await ensureDir(this.workspaceDir);
    try {
      await client.query(`SELECT pg_advisory_lock(74022101)`);
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await client.query(schemaSql);
      await this.migrateRunQueueCapabilitySchema(client);
      await this.migrateAgentRunMetadataSchema(client);
      await this.migrateLearningTelemetrySchema(client);
      await this.migrateAgentStateMachineSchema(client);
      await this.migrateAgentRunValidationSchema(client);
      await this.migrateAgentRunCorrectionTrackingSchema(client);
      await this.migrateDeploymentRunPinSchema(client);
      await this.pruneExpiredSessions(client);
      await this.markIncompleteDeploymentsFailed(client);
    } finally {
      await client.query(`SELECT pg_advisory_unlock(74022101)`).catch(() => undefined);
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T[]> {
    const result = await this.pool.query<T>(text, values);
    return result.rows;
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async withTransaction<T>(runner: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await runner(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async runQuery<T extends QueryResultRow>(sql: string, values: unknown[] = [], client?: PoolClient) {
    if (client) {
      return client.query<T>(sql, values);
    }

    return this.pool.query<T>(sql, values);
  }

  getProjectWorkspacePath(project: Project): string {
    return path.join(this.workspaceDir, project.orgId, project.workspaceId, project.id);
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const normalized = email.trim().toLowerCase();

    const result = await this.pool.query<DbUserRow>(
      `SELECT id, email, name, password_hash, created_at, updated_at
       FROM users
       WHERE email = $1`,
      [normalized]
    );

    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async getUserById(userId: string): Promise<User | undefined> {
    const result = await this.pool.query<DbUserRow>(
      `SELECT id, email, name, password_hash, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async createUser(input: { email: string; name: string; passwordHash: string }): Promise<User> {
    const normalized = input.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const id = randomUUID();

    const result = await this.pool.query<DbUserRow>(
      `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
       RETURNING id, email, name, password_hash, created_at, updated_at`,
      [id, normalized, input.name.trim(), input.passwordHash, now, now]
    );

    return mapUser(result.rows[0]);
  }

  async updateUser(user: User): Promise<void> {
    await this.pool.query(
      `UPDATE users
       SET email = $2, name = $3, password_hash = $4, updated_at = $5::timestamptz
       WHERE id = $1`,
      [user.id, user.email, user.name, user.passwordHash, user.updatedAt]
    );
  }

  async createOrganization(input: { name: string; slug: string }): Promise<Organization> {
    const now = new Date().toISOString();
    const id = randomUUID();

    const result = await this.pool.query<DbOrganizationRow>(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
       RETURNING id, name, slug, created_at, updated_at`,
      [id, input.name.trim(), input.slug.trim().toLowerCase(), now, now]
    );

    return mapOrganization(result.rows[0]);
  }

  async getOrganizationById(orgId: string): Promise<Organization | undefined> {
    const result = await this.pool.query<DbOrganizationRow>(
      `SELECT id, name, slug, created_at, updated_at
       FROM organizations
       WHERE id = $1`,
      [orgId]
    );

    return result.rows[0] ? mapOrganization(result.rows[0]) : undefined;
  }

  async createMembership(input: {
    orgId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<OrganizationMembership> {
    const createdAt = new Date().toISOString();
    const id = randomUUID();

    const inserted = await this.pool.query<DbMembershipRow>(
      `INSERT INTO organization_memberships (id, org_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (org_id, user_id) DO NOTHING
       RETURNING id, org_id, user_id, role, created_at`,
      [id, input.orgId, input.userId, input.role, createdAt]
    );

    if (inserted.rows[0]) {
      return mapMembership(inserted.rows[0]);
    }

    const existing = await this.pool.query<DbMembershipRow>(
      `SELECT id, org_id, user_id, role, created_at
       FROM organization_memberships
       WHERE org_id = $1 AND user_id = $2`,
      [input.orgId, input.userId]
    );

    if (!existing.rows[0]) {
      throw new Error("Membership could not be created.");
    }

    return mapMembership(existing.rows[0]);
  }

  async updateMembershipRole(orgId: string, userId: string, role: MembershipRole): Promise<void> {
    await this.pool.query(
      `UPDATE organization_memberships
       SET role = $3
       WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId, role]
    );
  }

  async getMembership(userId: string, orgId: string): Promise<OrganizationMembership | undefined> {
    const result = await this.pool.query<DbMembershipRow>(
      `SELECT id, org_id, user_id, role, created_at
       FROM organization_memberships
       WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId]
    );

    return result.rows[0] ? mapMembership(result.rows[0]) : undefined;
  }

  async listOrganizationsForUser(userId: string): Promise<Array<{ organization: Organization; role: MembershipRole }>> {
    const result = await this.pool.query<DbOrganizationRow & { role: MembershipRole }>(
      `SELECT o.id, o.name, o.slug, o.created_at, o.updated_at, m.role
       FROM organization_memberships m
       JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1
       ORDER BY o.name ASC`,
      [userId]
    );

    return result.rows.map((row) => ({
      organization: mapOrganization(row),
      role: row.role
    }));
  }

  async createWorkspace(input: { orgId: string; name: string; description?: string }): Promise<Workspace> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const result = await this.pool.query<DbWorkspaceRow>(
      `INSERT INTO workspaces (id, org_id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
       RETURNING id, org_id, name, description, created_at, updated_at`,
      [id, input.orgId, input.name.trim(), input.description?.trim() || "", now, now]
    );

    return mapWorkspace(result.rows[0]);
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | undefined> {
    const result = await this.pool.query<DbWorkspaceRow>(
      `SELECT id, org_id, name, description, created_at, updated_at
       FROM workspaces
       WHERE id = $1`,
      [workspaceId]
    );

    return result.rows[0] ? mapWorkspace(result.rows[0]) : undefined;
  }

  async listWorkspacesByOrg(orgId: string): Promise<Workspace[]> {
    const result = await this.pool.query<DbWorkspaceRow>(
      `SELECT id, org_id, name, description, created_at, updated_at
       FROM workspaces
       WHERE org_id = $1
       ORDER BY name ASC`,
      [orgId]
    );

    return result.rows.map((row) => mapWorkspace(row));
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const result = await this.pool.query<DbProjectRow>(
      `INSERT INTO projects
       (id, org_id, workspace_id, created_by_user_id, name, description, template_id, created_at, updated_at, history, messages)
       VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::jsonb, $11::jsonb)
       RETURNING id, org_id, workspace_id, created_by_user_id, name, description, template_id, created_at, updated_at, history, messages`,
      [
        id,
        input.orgId,
        input.workspaceId,
        input.createdByUserId,
        input.name,
        input.description ?? "",
        input.templateId,
        now,
        now,
        JSON.stringify([]),
        JSON.stringify([])
      ]
    );

    await ensureDir(this.getProjectWorkspacePath(mapProject(result.rows[0])));

    return mapProject(result.rows[0]);
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    const result = await this.pool.query<DbProjectRow>(
      `SELECT id, org_id, workspace_id, created_by_user_id, name, description, template_id, created_at, updated_at, history, messages
       FROM projects
       WHERE id = $1`,
      [projectId]
    );

    return result.rows[0] ? mapProject(result.rows[0]) : undefined;
  }

  async updateProject(project: Project): Promise<void> {
    await this.pool.query(
      `UPDATE projects
       SET
         name = $2,
         description = $3,
         template_id = $4,
         updated_at = $5::timestamptz,
         history = $6::jsonb,
         messages = $7::jsonb
       WHERE id = $1`,
      [
        project.id,
        project.name,
        project.description,
        project.templateId,
        project.updatedAt,
        JSON.stringify(project.history),
        JSON.stringify(project.messages)
      ]
    );
  }

  async listProjectsForUser(userId: string, workspaceId?: string): Promise<Project[]> {
    const result = await this.pool.query<DbProjectRow>(
      `SELECT p.id, p.org_id, p.workspace_id, p.created_by_user_id, p.name, p.description, p.template_id,
              p.created_at, p.updated_at, p.history, p.messages
       FROM projects p
       JOIN organization_memberships m ON m.org_id = p.org_id
       WHERE m.user_id = $1
         AND ($2::uuid IS NULL OR p.workspace_id = $2::uuid)
       ORDER BY p.updated_at DESC`,
      [userId, workspaceId ?? null]
    );

    return result.rows.map((row) => mapProject(row));
  }

  async listProjectsByWorkspace(workspaceId: string): Promise<Project[]> {
    const result = await this.pool.query<DbProjectRow>(
      `SELECT id, org_id, workspace_id, created_by_user_id, name, description, template_id,
              created_at, updated_at, history, messages
       FROM projects
       WHERE workspace_id = $1
       ORDER BY updated_at DESC`,
      [workspaceId]
    );

    return result.rows.map((row) => mapProject(row));
  }

  async hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM workspaces w
         JOIN organization_memberships m ON m.org_id = w.org_id
         WHERE w.id = $1 AND m.user_id = $2
       ) AS exists`,
      [workspaceId, userId]
    );

    return result.rows[0]?.exists ?? false;
  }

  async hasProjectAccess(userId: string, projectId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM projects p
         JOIN organization_memberships m ON m.org_id = p.org_id
         WHERE p.id = $1 AND m.user_id = $2
       ) AS exists`,
      [projectId, userId]
    );

    return result.rows[0]?.exists ?? false;
  }

  async getProjectMetadata(projectId: string): Promise<ProjectMetadata | undefined> {
    const result = await this.pool.query<DbProjectMetadataRow>(
      `SELECT ${projectMetadataSelectColumns}
       FROM project_metadata
       WHERE project_id = $1`,
      [projectId]
    );

    return result.rows[0] ? mapProjectMetadata(result.rows[0]) : undefined;
  }

  async upsertProjectMetadata(input: UpsertProjectMetadataInput): Promise<ProjectMetadata> {
    const now = new Date().toISOString();
    const analyzedAt = input.lastAnalyzedAt || now;

    const result = await this.pool.query<DbProjectMetadataRow>(
      `INSERT INTO project_metadata (
         project_id, org_id, workspace_id, architecture_summary, stack_info,
         last_analyzed_at, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb,
         $6::timestamptz, $7::timestamptz, $8::timestamptz
       )
       ON CONFLICT (project_id) DO UPDATE
       SET
         org_id = EXCLUDED.org_id,
         workspace_id = EXCLUDED.workspace_id,
         architecture_summary = EXCLUDED.architecture_summary,
         stack_info = EXCLUDED.stack_info,
         last_analyzed_at = EXCLUDED.last_analyzed_at,
         updated_at = EXCLUDED.updated_at
       RETURNING ${projectMetadataSelectColumns}`,
      [
        input.projectId,
        input.orgId,
        input.workspaceId,
        JSON.stringify(input.architectureSummary),
        JSON.stringify(input.stackInfo),
        analyzedAt,
        now,
        now
      ]
    );

    return mapProjectMetadata(result.rows[0]);
  }

  async createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    const id = input.deploymentId || randomUUID();
    const now = new Date().toISOString();

    const result = await this.pool.query<DbDeploymentRow>(
      `INSERT INTO deployments (
         id, project_id, org_id, workspace_id, created_by_user_id, run_id, commit_hash, status,
         image_repository, image_tag, image_ref, image_digest, registry_host,
         container_name, container_id, container_port, host_port,
         subdomain, public_url, custom_domain, is_active, metadata, logs, error_message,
         created_at, updated_at, finished_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, NULL, $12,
         NULL, NULL, $13, NULL,
         $14, $15, $16, FALSE, $17::jsonb, '', NULL,
         $18::timestamptz, $19::timestamptz, NULL
       )
       RETURNING ${deploymentSelectColumns}`,
      [
        id,
        input.projectId,
        input.orgId,
        input.workspaceId,
        input.createdByUserId,
        input.runId ?? null,
        input.commitHash ?? null,
        input.status,
        input.imageRepository ?? null,
        input.imageTag ?? null,
        input.imageRef ?? null,
        input.registryHost ?? null,
        input.containerPort ?? null,
        input.subdomain,
        input.publicUrl,
        input.customDomain ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now
      ]
    );

    return mapDeployment(result.rows[0]);
  }

  async getDeploymentById(projectId: string, deploymentId: string): Promise<Deployment | undefined> {
    const result = await this.pool.query<DbDeploymentRow>(
      `SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE id = $1 AND project_id = $2`,
      [deploymentId, projectId]
    );

    return result.rows[0] ? mapDeployment(result.rows[0]) : undefined;
  }

  async getDeployment(deploymentId: string): Promise<Deployment | undefined> {
    const result = await this.pool.query<DbDeploymentRow>(
      `SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE id = $1`,
      [deploymentId]
    );

    return result.rows[0] ? mapDeployment(result.rows[0]) : undefined;
  }

  async listDeploymentsByProject(projectId: string): Promise<Deployment[]> {
    const result = await this.pool.query<DbDeploymentRow>(
      `SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
    );

    return result.rows.map((row) => mapDeployment(row));
  }

  async listActiveDeploymentsByProject(projectId: string): Promise<Deployment[]> {
    const result = await this.pool.query<DbDeploymentRow>(
      `SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE project_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC`,
      [projectId]
    );

    return result.rows.map((row) => mapDeployment(row));
  }

  async hasInProgressDeployment(projectId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM deployments
         WHERE project_id = $1
           AND status IN ('queued', 'building', 'pushing', 'launching')
       ) AS exists`,
      [projectId]
    );

    return result.rows[0]?.exists ?? false;
  }

  async updateDeployment(deploymentId: string, patch: DeploymentPatchInput): Promise<Deployment | undefined> {
    const patchEntries = Object.entries(patch) as Array<[keyof DeploymentPatchInput, unknown]>;

    if (!patchEntries.length) {
      return this.getDeployment(deploymentId);
    }

    const mapping: Record<
      keyof DeploymentPatchInput,
      {
        column: string;
        cast?: string;
        transform?: (value: unknown) => unknown;
      }
    > = {
      status: {
        column: "status",
        transform: (value) => {
          if (value === "completed") {
            return "complete";
          }
          if (value === "planned") {
            return "queued";
          }
          if (value === "paused") {
            return "cancelling";
          }
          return value;
        }
      },
      imageRepository: { column: "image_repository" },
      imageTag: { column: "image_tag" },
      imageRef: { column: "image_ref" },
      imageDigest: { column: "image_digest" },
      registryHost: { column: "registry_host" },
      containerName: { column: "container_name" },
      containerId: { column: "container_id" },
      containerPort: { column: "container_port" },
      hostPort: { column: "host_port" },
      subdomain: { column: "subdomain" },
      publicUrl: { column: "public_url" },
      customDomain: { column: "custom_domain" },
      isActive: { column: "is_active" },
      metadata: {
        column: "metadata",
        cast: "::jsonb",
        transform: (value) => JSON.stringify(value ?? {})
      },
      errorMessage: { column: "error_message" },
      finishedAt: { column: "finished_at", cast: "::timestamptz" }
    };

    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of patchEntries) {
      if (value === undefined) {
        continue;
      }

      const mapped = mapping[key];

      if (!mapped) {
        continue;
      }

      values.push(mapped.transform ? mapped.transform(value) : value);
      assignments.push(`${mapped.column} = $${values.length}${mapped.cast ?? ""}`);
    }

    if (!assignments.length) {
      return this.getDeployment(deploymentId);
    }

    const result = await this.pool.query<DbDeploymentRow>(
      `UPDATE deployments
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${deploymentSelectColumns}`,
      [...values, deploymentId]
    );

    return result.rows[0] ? mapDeployment(result.rows[0]) : undefined;
  }

  async setActiveDeployment(projectId: string, deploymentId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(
        `UPDATE deployments
         SET is_active = FALSE, updated_at = NOW()
         WHERE project_id = $1`,
        [projectId]
      );

      await client.query(
        `UPDATE deployments
         SET is_active = TRUE, updated_at = NOW()
         WHERE id = $1 AND project_id = $2`,
        [deploymentId, projectId]
      );
    });
  }

  async appendDeploymentLog(deploymentId: string, content: string): Promise<void> {
    await this.pool.query(
      `UPDATE deployments
       SET logs = COALESCE(logs, '') || $2, updated_at = NOW()
       WHERE id = $1`,
      [deploymentId, content]
    );
  }

  async markIncompleteDeploymentsFailed(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `UPDATE deployments
       SET
         status = 'failed',
         error_message = COALESCE(error_message, 'Deployment interrupted during server restart.'),
         finished_at = NOW(),
         updated_at = NOW(),
         is_active = FALSE
       WHERE status IN ('queued', 'building', 'pushing', 'launching')`,
      [],
      client
    );
  }

  async migrateAgentStateMachineSchema(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `ALTER TABLE agent_runs
       ADD COLUMN IF NOT EXISTS phase TEXT,
       ADD COLUMN IF NOT EXISTS step_index INTEGER,
       ADD COLUMN IF NOT EXISTS corrections_used INTEGER,
       ADD COLUMN IF NOT EXISTS optimization_steps_used INTEGER,
       ADD COLUMN IF NOT EXISTS max_steps INTEGER,
       ADD COLUMN IF NOT EXISTS max_corrections INTEGER,
       ADD COLUMN IF NOT EXISTS max_optimizations INTEGER,
       ADD COLUMN IF NOT EXISTS run_branch TEXT,
       ADD COLUMN IF NOT EXISTS worktree_path TEXT,
       ADD COLUMN IF NOT EXISTS base_commit_hash TEXT,
       ADD COLUMN IF NOT EXISTS current_commit_hash TEXT,
       ADD COLUMN IF NOT EXISTS last_valid_commit_hash TEXT,
       ADD COLUMN IF NOT EXISTS run_lock_owner TEXT,
       ADD COLUMN IF NOT EXISTS run_lock_acquired_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS error_details JSONB`,
      [],
      client
    );

    await this.runQuery(
      `UPDATE agent_runs
       SET
         phase = COALESCE(phase, 'goal'),
         step_index = COALESCE(step_index, current_step_index, 0),
         corrections_used = COALESCE(corrections_used, 0),
         optimization_steps_used = COALESCE(optimization_steps_used, 0),
         max_steps = COALESCE(max_steps, 20),
         max_corrections = COALESCE(max_corrections, 2),
         max_optimizations = COALESCE(max_optimizations, 2),
         last_valid_commit_hash = COALESCE(last_valid_commit_hash, current_commit_hash, base_commit_hash),
         status = CASE status
           WHEN 'planned' THEN 'queued'
           WHEN 'paused' THEN 'cancelled'
           WHEN 'cancelling' THEN 'cancelled'
           WHEN 'completed' THEN 'complete'
           ELSE status
         END`,
      [],
      client
    );

    await this.runQuery(
      `ALTER TABLE agent_runs
       ALTER COLUMN phase SET DEFAULT 'goal',
       ALTER COLUMN phase SET NOT NULL,
       ALTER COLUMN step_index SET DEFAULT 0,
       ALTER COLUMN step_index SET NOT NULL,
       ALTER COLUMN corrections_used SET DEFAULT 0,
       ALTER COLUMN corrections_used SET NOT NULL,
       ALTER COLUMN optimization_steps_used SET DEFAULT 0,
       ALTER COLUMN optimization_steps_used SET NOT NULL,
       ALTER COLUMN max_steps SET DEFAULT 20,
       ALTER COLUMN max_steps SET NOT NULL,
       ALTER COLUMN max_corrections SET DEFAULT 2,
       ALTER COLUMN max_corrections SET NOT NULL,
       ALTER COLUMN max_optimizations SET DEFAULT 2,
       ALTER COLUMN max_optimizations SET NOT NULL`,
      [],
      client
    );

    await this.runQuery(
      `DO $$
       DECLARE con RECORD;
       BEGIN
         FOR con IN
           SELECT c.conname
           FROM pg_constraint c
           WHERE c.conrelid = 'agent_runs'::regclass
             AND c.contype = 'c'
             AND (
               pg_get_constraintdef(c.oid) ILIKE '%status%'
               OR pg_get_constraintdef(c.oid) ILIKE '%phase%'
             )
         LOOP
           EXECUTE format('ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS %I', con.conname);
         END LOOP;
       END $$;`,
      [],
      client
    );

    await this.runQuery(
      `DO $$
       BEGIN
         ALTER TABLE agent_runs
         ADD CONSTRAINT agent_runs_status_check
         CHECK (status IN ('queued', 'running', 'correcting', 'optimizing', 'validating', 'cancelled', 'failed', 'complete'));
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;`,
      [],
      client
    );

    await this.runQuery(
      `DO $$
       BEGIN
         ALTER TABLE agent_runs
         ADD CONSTRAINT agent_runs_phase_check
         CHECK (phase IN ('goal', 'optimization'));
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;`,
      [],
      client
    );

    await this.runQuery(
      `ALTER TABLE agent_steps
       ADD COLUMN IF NOT EXISTS attempt INTEGER,
       ADD COLUMN IF NOT EXISTS summary TEXT,
       ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
      [],
      client
    );

    await this.runQuery(
      `UPDATE agent_steps
       SET
         attempt = COALESCE(attempt, 1),
         summary = COALESCE(summary, ''),
         status = CASE status
           WHEN 'completed' THEN 'complete'
           ELSE status
         END`,
      [],
      client
    );

    await this.runQuery(
      `ALTER TABLE agent_steps
       ALTER COLUMN attempt SET DEFAULT 1,
       ALTER COLUMN attempt SET NOT NULL,
       ALTER COLUMN summary SET DEFAULT '',
       ALTER COLUMN summary SET NOT NULL`,
      [],
      client
    );

    await this.runQuery(
      `DO $$
       DECLARE con RECORD;
       BEGIN
         FOR con IN
           SELECT c.conname
           FROM pg_constraint c
           WHERE c.conrelid = 'agent_steps'::regclass
             AND c.contype = 'c'
             AND (
               pg_get_constraintdef(c.oid) ILIKE '%step_type%'
               OR pg_get_constraintdef(c.oid) ILIKE '%status%'
             )
         LOOP
           EXECUTE format('ALTER TABLE agent_steps DROP CONSTRAINT IF EXISTS %I', con.conname);
         END LOOP;
       END $$;`,
      [],
      client
    );

    await this.runQuery(
      `DO $$
       BEGIN
         ALTER TABLE agent_steps
         ADD CONSTRAINT agent_steps_step_type_check
         CHECK (step_type IN ('goal', 'correction', 'optimization', 'analyze', 'modify', 'verify'));
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;`,
      [],
      client
    );

    await this.runQuery(
      `DO $$
       BEGIN
         ALTER TABLE agent_steps
         ADD CONSTRAINT agent_steps_status_check
         CHECK (status IN ('pending', 'running', 'complete', 'failed', 'completed'));
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;`
    );

    await this.runQuery(
      `DO $$
       BEGIN
         ALTER TABLE agent_steps
         ADD CONSTRAINT agent_steps_attempt_positive_check
         CHECK (attempt >= 1);
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;`,
      [],
      client
    );

    await this.runQuery(`DROP INDEX IF EXISTS idx_agent_steps_run_step_index;`, [], client);
    await this.runQuery(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_run_step_attempt_unique ON agent_steps (run_id, step_index, attempt);`,
      [],
      client
    );
    await this.runQuery(
      `CREATE INDEX IF NOT EXISTS idx_agent_steps_run_step_index ON agent_steps (run_id, step_index);`,
      [],
      client
    );
  }

  async migrateAgentRunValidationSchema(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `ALTER TABLE agent_runs
       ADD COLUMN IF NOT EXISTS validation_status TEXT CHECK (validation_status IN ('failed', 'passed')),
       ADD COLUMN IF NOT EXISTS validation_result JSONB,
       ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ`,
      [],
      client
    );
  }

  async migrateAgentRunCorrectionTrackingSchema(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `ALTER TABLE agent_runs
       ADD COLUMN IF NOT EXISTS correction_attempts INTEGER NOT NULL DEFAULT 0,
       ADD COLUMN IF NOT EXISTS last_correction_reason TEXT`,
      [],
      client
    );
  }

  async migrateDeploymentRunPinSchema(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `ALTER TABLE deployments
       ADD COLUMN IF NOT EXISTS run_id UUID,
       ADD COLUMN IF NOT EXISTS commit_hash TEXT`,
      [],
      client
    );
  }

  async migrateRunQueueCapabilitySchema(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `ALTER TABLE run_jobs
       ADD COLUMN IF NOT EXISTS required_capabilities JSONB`,
      [],
      client
    );
    await this.runQuery(
      `UPDATE run_jobs
       SET required_capabilities = NULL
       WHERE required_capabilities = 'null'::jsonb`,
      [],
      client
    );
    await this.runQuery(
      `ALTER TABLE run_jobs
       DROP CONSTRAINT IF EXISTS run_jobs_required_capabilities_object_check`,
      [],
      client
    );
    await this.runQuery(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'run_jobs_required_capabilities_object_check'
         ) THEN
           ALTER TABLE run_jobs
             ADD CONSTRAINT run_jobs_required_capabilities_object_check
             CHECK (required_capabilities IS NULL OR jsonb_typeof(required_capabilities) = 'object');
         END IF;
       END
       $$`,
      [],
      client
    );
    await this.runQuery(`CREATE INDEX IF NOT EXISTS idx_run_jobs_required_caps ON run_jobs USING GIN (required_capabilities)`, [], client);
    await this.runQuery(
      `ALTER TABLE worker_nodes
       ADD COLUMN IF NOT EXISTS capabilities JSONB`,
      [],
      client
    );
    await this.runQuery(
      `UPDATE worker_nodes
       SET capabilities = '{}'::jsonb
       WHERE capabilities IS NULL`,
      [],
      client
    );
    await this.runQuery(
      `ALTER TABLE worker_nodes
       ALTER COLUMN capabilities SET DEFAULT '{}'::jsonb,
       ALTER COLUMN capabilities SET NOT NULL`,
      [],
      client
    );
  }

  async migrateAgentRunMetadataSchema(client?: PoolClient): Promise<void> {
    await this.runQuery(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS metadata JSONB`, [], client);
    await this.runQuery(
      `UPDATE agent_runs
       SET metadata = '{}'::jsonb
       WHERE metadata IS NULL`,
      [],
      client
    );
    await this.runQuery(
      `ALTER TABLE agent_runs
       ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
       ALTER COLUMN metadata SET NOT NULL`,
      [],
      client
    );
  }

  async migrateLearningTelemetrySchema(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `CREATE TABLE IF NOT EXISTS learning_events (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         run_id UUID NOT NULL,
         project_id UUID NOT NULL,
         step_index INT,
         event_type TEXT NOT NULL,
         phase TEXT,
         clusters JSONB,
         blocking_before INT,
         blocking_after INT,
         architecture_collapse BOOLEAN,
         invariant_count INT,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         outcome TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      [],
      client
    );
    await this.runQuery(`ALTER TABLE learning_events ALTER COLUMN id SET DEFAULT gen_random_uuid()`, [], client);
    await this.runQuery(`ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS project_id UUID`, [], client);
    await this.runQuery(`ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS event_type TEXT`, [], client);
    await this.runQuery(
      `ALTER TABLE learning_events
       ADD COLUMN IF NOT EXISTS delta INTEGER,
       ADD COLUMN IF NOT EXISTS regression_flag BOOLEAN,
       ADD COLUMN IF NOT EXISTS convergence_flag BOOLEAN,
       ADD COLUMN IF NOT EXISTS metadata JSONB`,
      [],
      client
    );
    await this.runQuery(`ALTER TABLE learning_events ALTER COLUMN step_index DROP NOT NULL`, [], client);
    await this.runQuery(
      `UPDATE learning_events
       SET
         project_id = COALESCE(learning_events.project_id, agent_runs.project_id),
         event_type = COALESCE(NULLIF(learning_events.event_type, ''), 'correction')
       FROM agent_runs
       WHERE agent_runs.id = learning_events.run_id`,
      [],
      client
    );
    await this.runQuery(
      `UPDATE learning_events
       SET outcome = COALESCE(NULLIF(learning_events.outcome, ''), 'noop')`,
      [],
      client
    );
    await this.runQuery(
      `UPDATE learning_events
       SET metadata = '{}'::jsonb
       WHERE metadata IS NULL`,
      [],
      client
    );
    await this.runQuery(
      `UPDATE learning_events
       SET
         delta = CASE
           WHEN blocking_before IS NOT NULL AND blocking_after IS NOT NULL
             THEN blocking_before - blocking_after
           ELSE NULL
         END,
         regression_flag = CASE
           WHEN blocking_before IS NOT NULL AND blocking_after IS NOT NULL
             THEN blocking_after > blocking_before
           ELSE FALSE
         END,
         convergence_flag = CASE
           WHEN blocking_after IS NOT NULL
             THEN blocking_after = 0
           ELSE FALSE
         END
       WHERE delta IS NULL
          OR regression_flag IS NULL
          OR convergence_flag IS NULL`,
      [],
      client
    );
    await this.runQuery(
      `ALTER TABLE learning_events
       ALTER COLUMN project_id SET NOT NULL,
       ALTER COLUMN event_type SET NOT NULL,
       ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
       ALTER COLUMN metadata SET NOT NULL,
       ALTER COLUMN outcome SET NOT NULL`,
      [],
      client
    );
    await this.runQuery(`CREATE INDEX IF NOT EXISTS learning_events_run_idx ON learning_events(run_id)`, [], client);
    await this.runQuery(`CREATE INDEX IF NOT EXISTS learning_events_project_idx ON learning_events(project_id)`, [], client);
    await this.runQuery(`CREATE INDEX IF NOT EXISTS learning_events_outcome_idx ON learning_events(outcome)`, [], client);
    await this.runQuery(`CREATE INDEX IF NOT EXISTS learning_events_clusters_idx ON learning_events USING GIN (clusters)`, [], client);
  }

  async createLifecycleRun(input: CreateLifecycleRunInput, client?: PoolClient): Promise<AgentLifecycleRun> {
    const runId = input.runId || randomUUID();
    const now = new Date().toISOString();

    const result = await this.runQuery<DbLifecycleRunRow>(
      `INSERT INTO agent_runs (
         id, project_id, org_id, workspace_id, created_by_user_id, goal,
         phase, status, step_index, corrections_used, optimization_steps_used,
         max_steps, max_corrections, max_optimizations,
         provider_id, model, current_step_index, plan, last_step_id, error_message,
         created_at, updated_at, finished_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14,
         'state-machine', NULL, $9, '{}'::jsonb, NULL, $15,
         $16::timestamptz, $17::timestamptz, NULL
       )
       RETURNING ${lifecycleRunSelectColumns}`,
      [
        runId,
        input.projectId,
        input.orgId,
        input.workspaceId,
        input.createdByUserId,
        input.goal,
        input.phase,
        input.status,
        input.stepIndex,
        input.correctionsUsed,
        input.optimizationStepsUsed,
        input.maxSteps,
        input.maxCorrections,
        input.maxOptimizations,
        input.errorMessage ?? null,
        now,
        now
      ],
      client
    );

    return mapLifecycleRun(result.rows[0]);
  }

  async getLifecycleRunById(projectId: string, runId: string, client?: PoolClient): Promise<AgentLifecycleRun | undefined> {
    const result = await this.runQuery<DbLifecycleRunRow>(
      `SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND project_id = $2 AND provider_id = 'state-machine'`,
      [runId, projectId],
      client
    );

    return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
  }

  async getLifecycleRun(runId: string, client?: PoolClient): Promise<AgentLifecycleRun | undefined> {
    const result = await this.runQuery<DbLifecycleRunRow>(
      `SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND provider_id = 'state-machine'`,
      [runId],
      client
    );

    return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
  }

  async listLifecycleRunsByProject(projectId: string, limit = 100): Promise<AgentLifecycleRun[]> {
    const result = await this.runQuery<DbLifecycleRunRow>(
      `SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE project_id = $1 AND provider_id = 'state-machine'
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );

    return result.rows.map((row) => mapLifecycleRun(row));
  }

  async lockLifecycleRunForUpdate(runId: string, client: PoolClient): Promise<AgentLifecycleRun | undefined> {
    const result = await this.runQuery<DbLifecycleRunRow>(
      `SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND provider_id = 'state-machine'
       FOR UPDATE`,
      [runId],
      client
    );

    return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
  }

  async updateLifecycleRun(runId: string, patch: LifecycleRunPatchInput, client?: PoolClient): Promise<AgentLifecycleRun | undefined> {
    const patchEntries = Object.entries(patch) as Array<[keyof LifecycleRunPatchInput, unknown]>;

    if (!patchEntries.length) {
      return this.getLifecycleRun(runId, client);
    }

    const mapping: Record<
      keyof LifecycleRunPatchInput,
      {
        column: string;
      }
    > = {
      phase: { column: "phase" },
      status: { column: "status" },
      stepIndex: { column: "step_index" },
      correctionsUsed: { column: "corrections_used" },
      optimizationStepsUsed: { column: "optimization_steps_used" },
      maxSteps: { column: "max_steps" },
      maxCorrections: { column: "max_corrections" },
      maxOptimizations: { column: "max_optimizations" },
      errorMessage: { column: "error_message" }
    };

    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of patchEntries) {
      if (value === undefined) {
        continue;
      }

      const mapped = mapping[key];
      if (!mapped) {
        continue;
      }

      values.push(value);
      assignments.push(`${mapped.column} = $${values.length}`);
    }

    if (!assignments.length) {
      return this.getLifecycleRun(runId, client);
    }

    const result = await this.runQuery<DbLifecycleRunRow>(
      `UPDATE agent_runs
       SET ${assignments.join(", ")}, current_step_index = step_index, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${lifecycleRunSelectColumns}`,
      [...values, runId],
      client
    );

    return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
  }

  async createLifecycleStep(input: CreateLifecycleStepInput, client?: PoolClient): Promise<AgentLifecycleStep> {
    const stepId = randomUUID();
    const createdAt = new Date().toISOString();

    const result = await this.runQuery<DbLifecycleStepRow>(
      `INSERT INTO agent_steps (
         id, run_id, project_id, step_index, step_id, step_type, tool,
         input_payload, output_payload, status, summary, error_message, commit_hash, runtime_status,
         started_at, finished_at, completed_at, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, 'state_machine_step',
         '{}'::jsonb, '{}'::jsonb, $7, $8, NULL, $9, NULL,
         NOW(), NOW(), $10::timestamptz, $11::timestamptz
       )
       RETURNING ${lifecycleStepSelectColumns}`,
      [
        stepId,
        input.runId,
        input.projectId,
        input.stepIndex,
        `state-step-${input.stepIndex}`,
        input.type,
        input.status,
        input.summary,
        input.commitHash ?? null,
        input.completedAt ?? null,
        createdAt
      ],
      client
    );

    return mapLifecycleStep(result.rows[0]);
  }

  async updateLifecycleStep(stepId: string, patch: LifecycleStepPatchInput, client?: PoolClient): Promise<AgentLifecycleStep | undefined> {
    const patchEntries = Object.entries(patch) as Array<[keyof LifecycleStepPatchInput, unknown]>;

    if (!patchEntries.length) {
      const existing = await this.runQuery<DbLifecycleStepRow>(
        `SELECT ${lifecycleStepSelectColumns}
         FROM agent_steps
         WHERE id = $1`,
        [stepId],
        client
      );
      return existing.rows[0] ? mapLifecycleStep(existing.rows[0]) : undefined;
    }

    const mapping: Record<
      keyof LifecycleStepPatchInput,
      {
        column: string;
        cast?: string;
      }
    > = {
      status: { column: "status" },
      summary: { column: "summary" },
      commitHash: { column: "commit_hash" },
      completedAt: { column: "completed_at", cast: "::timestamptz" }
    };

    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of patchEntries) {
      if (value === undefined) {
        continue;
      }

      const mapped = mapping[key];
      if (!mapped) {
        continue;
      }

      values.push(value);
      assignments.push(`${mapped.column} = $${values.length}${mapped.cast ?? ""}`);
    }

    if (!assignments.length) {
      return undefined;
    }

    const result = await this.runQuery<DbLifecycleStepRow>(
      `UPDATE agent_steps
       SET ${assignments.join(", ")}
       WHERE id = $${values.length + 1}
       RETURNING ${lifecycleStepSelectColumns}`,
      [...values, stepId],
      client
    );

    return result.rows[0] ? mapLifecycleStep(result.rows[0]) : undefined;
  }

  async listLifecycleStepsByRun(runId: string): Promise<AgentLifecycleStep[]> {
    const result = await this.runQuery<DbLifecycleStepRow>(
      `SELECT ${lifecycleStepSelectColumns}
       FROM agent_steps
       WHERE run_id = $1
       ORDER BY step_index ASC, created_at ASC`,
      [runId]
    );

    return result.rows.map((row) => mapLifecycleStep(row));
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const runId = input.runId || randomUUID();
    const now = new Date().toISOString();
    const normalizedStatus = normalizeAgentRunStatus(input.status);

    const result = await this.pool.query<DbAgentRunRow>(
      `INSERT INTO agent_runs (
         id, project_id, org_id, workspace_id, created_by_user_id, goal,
         provider_id, model, status, current_step_index, plan, last_step_id,
         run_branch, worktree_path, base_commit_hash, current_commit_hash, last_valid_commit_hash,
         run_lock_owner, run_lock_acquired_at, metadata,
         error_message, error_details, created_at, updated_at, finished_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11::jsonb, $12,
         $13, $14, $15, $16, $17,
         NULL, NULL, $18::jsonb,
         $19, $20::jsonb, $21::timestamptz, $22::timestamptz, $23::timestamptz
       )
       RETURNING ${agentRunSelectColumns}`,
      [
        runId,
        input.projectId,
        input.orgId,
        input.workspaceId,
        input.createdByUserId,
        input.goal,
        input.providerId,
        input.model ?? null,
        normalizedStatus,
        input.currentStepIndex,
        JSON.stringify(input.plan),
        input.lastStepId ?? null,
        input.runBranch ?? null,
        input.worktreePath ?? null,
        input.baseCommitHash ?? null,
        input.currentCommitHash ?? null,
        input.lastValidCommitHash ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.errorMessage ?? null,
        JSON.stringify(input.errorDetails ?? null),
        now,
        now,
        input.finishedAt ?? null
      ]
    );

    return mapAgentRun(result.rows[0]);
  }

  async getAgentRunById(projectId: string, runId: string): Promise<AgentRun | undefined> {
    const result = await this.pool.query<DbAgentRunRow>(
      `SELECT ${agentRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND project_id = $2 AND provider_id <> 'state-machine'`,
      [runId, projectId]
    );

    return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
  }

  async getAgentRun(runId: string): Promise<AgentRun | undefined> {
    const result = await this.pool.query<DbAgentRunRow>(
      `SELECT ${agentRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND provider_id <> 'state-machine'`,
      [runId]
    );

    return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
  }

  async listAgentRunsByProject(projectId: string, limit = 100): Promise<AgentRun[]> {
    const result = await this.pool.query<DbAgentRunRow>(
      `SELECT ${agentRunSelectColumns}
       FROM agent_runs
       WHERE project_id = $1 AND provider_id <> 'state-machine'
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );

    return result.rows.map((row) => mapAgentRun(row));
  }

  async enqueueRunJob(input: CreateRunJobInput): Promise<AgentRunJob> {
    const jobId = randomUUID();
    const now = new Date().toISOString();

    try {
      const result = await this.pool.query<DbRunJobRow>(
        `INSERT INTO run_jobs (
           id, run_id, job_type, target_role, status, required_capabilities, assigned_node, lease_expires_at, attempt_count, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, 'queued', $5::jsonb, NULL, NULL, 0, $6::timestamptz, $7::timestamptz
         )
         RETURNING ${runJobSelectColumns}`,
        [
          jobId,
          input.runId,
          normalizeAgentRunJobType(input.jobType),
          normalizeWorkerNodeRole(input.targetRole),
          input.requiredCapabilities ? JSON.stringify(input.requiredCapabilities) : null,
          now,
          now
        ]
      );

      return mapRunJob(result.rows[0]);
    } catch (error) {
      if (!isPgUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.getActiveRunJobByRunId(input.runId);
      if (!existing) {
        throw error;
      }
      return existing;
    }
  }

  async getActiveRunJobByRunId(runId: string): Promise<AgentRunJob | undefined> {
    const result = await this.pool.query<DbRunJobRow>(
      `SELECT ${runJobSelectColumns}
       FROM run_jobs
       WHERE run_id = $1
         AND status IN ('queued', 'claimed', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
      [runId]
    );

    return result.rows[0] ? mapRunJob(result.rows[0]) : undefined;
  }

  async claimNextRunJob(input: {
    nodeId: string;
    targetRole: WorkerNodeRole;
    workerCapabilities?: Record<string, unknown>;
    leaseSeconds?: number;
    runId?: string;
    runIds?: string[];
  }): Promise<AgentRunJob | undefined> {
    const leaseSeconds = Math.max(15, Math.floor(Number(input.leaseSeconds) || 60));
    const workerCapabilities = JSON.stringify(input.workerCapabilities ?? {});
    const runIds = [
      ...(input.runId ? [String(input.runId)] : []),
      ...((Array.isArray(input.runIds) ? input.runIds : []).map((value) => String(value)).filter(Boolean))
    ];
    const runIdFilter = runIds.length > 0 ? Array.from(new Set(runIds)) : null;

    const result = await this.pool.query<DbRunJobRow>(
      `UPDATE run_jobs
       SET status = 'claimed',
           assigned_node = $1,
           lease_expires_at = NOW() + make_interval(secs => $4::int),
           attempt_count = attempt_count + 1,
           updated_at = NOW()
       WHERE id = (
         SELECT id
         FROM run_jobs
         WHERE target_role = $2
           AND ($5::uuid[] IS NULL OR run_id = ANY($5::uuid[]))
           AND (
             required_capabilities IS NULL
             OR required_capabilities <@ $3::jsonb
           )
           AND EXISTS (
             SELECT 1
             FROM worker_nodes
             WHERE node_id = $1
               AND role = $2
               AND status = 'online'
           )
           AND (
             status = 'queued'
             OR (
               status IN ('claimed', 'running')
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at < NOW()
             )
           )
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING ${runJobSelectColumns}`,
      [input.nodeId, normalizeWorkerNodeRole(input.targetRole), workerCapabilities, leaseSeconds, runIdFilter]
    );

    return result.rows[0] ? mapRunJob(result.rows[0]) : undefined;
  }

  async markRunJobRunning(jobId: string, nodeId: string, leaseSeconds = 60): Promise<AgentRunJob | undefined> {
    const normalizedLeaseSeconds = Math.max(15, Math.floor(Number(leaseSeconds) || 60));
    const result = await this.pool.query<DbRunJobRow>(
      `UPDATE run_jobs
       SET status = 'running',
           lease_expires_at = NOW() + make_interval(secs => $3::int),
           updated_at = NOW()
       WHERE id = $1
         AND assigned_node = $2
         AND status IN ('claimed', 'running')
       RETURNING ${runJobSelectColumns}`,
      [jobId, nodeId, normalizedLeaseSeconds]
    );

    return result.rows[0] ? mapRunJob(result.rows[0]) : undefined;
  }

  async renewRunJobLease(jobId: string, nodeId: string, leaseSeconds = 60): Promise<boolean> {
    const normalizedLeaseSeconds = Math.max(15, Math.floor(Number(leaseSeconds) || 60));
    const result = await this.pool.query(
      `UPDATE run_jobs
       SET lease_expires_at = NOW() + make_interval(secs => $3::int),
           updated_at = NOW()
       WHERE id = $1
         AND assigned_node = $2
         AND status IN ('claimed', 'running')`,
      [jobId, nodeId, normalizedLeaseSeconds]
    );

    return Number(result.rowCount || 0) > 0;
  }

  async completeRunJob(jobId: string, nodeId: string): Promise<AgentRunJob | undefined> {
    const result = await this.pool.query<DbRunJobRow>(
      `UPDATE run_jobs
       SET status = 'complete',
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND assigned_node = $2
         AND status IN ('claimed', 'running')
       RETURNING ${runJobSelectColumns}`,
      [jobId, nodeId]
    );

    return result.rows[0] ? mapRunJob(result.rows[0]) : undefined;
  }

  async failRunJob(jobId: string, nodeId: string): Promise<AgentRunJob | undefined> {
    const result = await this.pool.query<DbRunJobRow>(
      `UPDATE run_jobs
       SET status = 'failed',
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND assigned_node = $2
         AND status IN ('claimed', 'running')
       RETURNING ${runJobSelectColumns}`,
      [jobId, nodeId]
    );

    return result.rows[0] ? mapRunJob(result.rows[0]) : undefined;
  }

  async upsertWorkerNodeHeartbeat(input: UpsertWorkerNodeHeartbeatInput): Promise<WorkerNode> {
    const result = await this.pool.query<DbWorkerNodeRow>(
      `INSERT INTO worker_nodes (
         node_id, role, capabilities, last_heartbeat, status
       )
       VALUES (
         $1, $2, $3::jsonb, NOW(), $4
       )
       ON CONFLICT (node_id) DO UPDATE
         SET capabilities = EXCLUDED.capabilities,
             last_heartbeat = NOW(),
             status = EXCLUDED.status
         WHERE worker_nodes.role = EXCLUDED.role
       RETURNING ${workerNodeSelectColumns}`,
      [
        input.nodeId,
        normalizeWorkerNodeRole(input.role),
        JSON.stringify(input.capabilities ?? {}),
        normalizeWorkerNodeStatus(input.status ?? "online")
      ]
    );

    if (!result.rows[0]) {
      throw new Error(`Worker node '${input.nodeId}' is already registered with a different role.`);
    }

    return mapWorkerNode(result.rows[0]);
  }

  async markWorkerNodeOffline(nodeId: string): Promise<WorkerNode | undefined> {
    const result = await this.pool.query<DbWorkerNodeRow>(
      `UPDATE worker_nodes
       SET status = 'offline',
           last_heartbeat = NOW()
       WHERE node_id = $1
       RETURNING ${workerNodeSelectColumns}`,
      [nodeId]
    );

    return result.rows[0] ? mapWorkerNode(result.rows[0]) : undefined;
  }

  async listWorkerNodes(limit = 100): Promise<WorkerNode[]> {
    const result = await this.pool.query<DbWorkerNodeRow>(
      `SELECT ${workerNodeSelectColumns}
       FROM worker_nodes
       ORDER BY last_heartbeat DESC, node_id ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => mapWorkerNode(row));
  }

  async listRunJobs(limit = 200): Promise<AgentRunJob[]> {
    const result = await this.pool.query<DbRunJobRow>(
      `SELECT ${runJobSelectColumns}
       FROM run_jobs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => mapRunJob(row));
  }

  async hasActiveAgentRun(projectId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM agent_runs
         WHERE project_id = $1
           AND provider_id <> 'state-machine'
           AND status IN ('queued', 'running', 'correcting', 'optimizing', 'validating')
       ) AS exists`,
      [projectId]
    );

    return result.rows[0]?.exists === true;
  }

  async updateAgentRun(runId: string, patch: AgentRunPatchInput): Promise<AgentRun | undefined> {
    const patchEntries = Object.entries(patch) as Array<[keyof AgentRunPatchInput, unknown]>;

    if (!patchEntries.length) {
      return this.getAgentRun(runId);
    }

    const mapping: Record<
      keyof AgentRunPatchInput,
      {
        column: string;
        cast?: string;
        transform?: (value: unknown) => unknown;
      }
    > = {
      status: {
        column: "status",
        transform: (value) => normalizeAgentRunStatus(value)
      },
      currentStepIndex: { column: "current_step_index" },
      plan: {
        column: "plan",
        cast: "::jsonb",
        transform: (value) => JSON.stringify(value ?? {})
      },
      lastStepId: { column: "last_step_id" },
      runBranch: { column: "run_branch" },
      worktreePath: { column: "worktree_path" },
      baseCommitHash: { column: "base_commit_hash" },
      currentCommitHash: { column: "current_commit_hash" },
      lastValidCommitHash: { column: "last_valid_commit_hash" },
      correctionAttempts: { column: "correction_attempts" },
      lastCorrectionReason: { column: "last_correction_reason" },
      validationStatus: {
        column: "validation_status",
        transform: (value) => normalizeAgentRunValidationStatus(value)
      },
      validationResult: {
        column: "validation_result",
        cast: "::jsonb",
        transform: (value) => JSON.stringify(value ?? null)
      },
      validatedAt: { column: "validated_at", cast: "::timestamptz" },
      runLockOwner: { column: "run_lock_owner" },
      runLockAcquiredAt: { column: "run_lock_acquired_at", cast: "::timestamptz" },
      metadata: {
        column: "metadata",
        cast: "::jsonb",
        transform: (value) => JSON.stringify(value ?? {})
      },
      errorMessage: { column: "error_message" },
      errorDetails: {
        column: "error_details",
        cast: "::jsonb",
        transform: (value) => JSON.stringify(value ?? null)
      },
      finishedAt: { column: "finished_at", cast: "::timestamptz" }
    };

    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of patchEntries) {
      if (value === undefined) {
        continue;
      }

      const mapped = mapping[key];

      if (!mapped) {
        continue;
      }

      values.push(mapped.transform ? mapped.transform(value) : value);
      assignments.push(`${mapped.column} = $${values.length}${mapped.cast ?? ""}`);
    }

    if (!assignments.length) {
      return this.getAgentRun(runId);
    }

    const result = await this.pool.query<DbAgentRunRow>(
      `UPDATE agent_runs
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${agentRunSelectColumns}`,
      [...values, runId]
    );

    return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
  }

  async acquireAgentRunExecutionLock(
    runId: string,
    lockOwner: string,
    staleAfterSeconds = 1800
  ): Promise<AgentRun | undefined> {
    const staleSeconds = Math.max(30, Math.floor(Number(staleAfterSeconds) || 1800));

    const result = await this.pool.query<DbAgentRunRow>(
      `UPDATE agent_runs
       SET run_lock_owner = $2, run_lock_acquired_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND provider_id <> 'state-machine'
         AND (
           run_lock_owner IS NULL
           OR run_lock_owner = $2
           OR run_lock_acquired_at IS NULL
           OR run_lock_acquired_at < NOW() - make_interval(secs => $3::int)
         )
       RETURNING ${agentRunSelectColumns}`,
      [runId, lockOwner, staleSeconds]
    );

    return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
  }

  async releaseAgentRunExecutionLock(runId: string, lockOwner: string): Promise<AgentRun | undefined> {
    const result = await this.pool.query<DbAgentRunRow>(
      `UPDATE agent_runs
       SET run_lock_owner = NULL, run_lock_acquired_at = NULL, updated_at = NOW()
       WHERE id = $1
         AND provider_id <> 'state-machine'
         AND (run_lock_owner IS NULL OR run_lock_owner = $2)
       RETURNING ${agentRunSelectColumns}`,
      [runId, lockOwner]
    );

    return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
  }

  async refreshAgentRunExecutionLock(runId: string, lockOwner: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE agent_runs
       SET run_lock_acquired_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND provider_id <> 'state-machine'
         AND run_lock_owner = $2`,
      [runId, lockOwner]
    );

    return Number(result.rowCount || 0) > 0;
  }

  async createAgentStep(input: CreateAgentStepInput): Promise<AgentStepRecord> {
    const stepId = randomUUID();
    const createdAt = new Date().toISOString();

    const result = await this.pool.query<DbAgentStepRow>(
      `WITH next_attempt AS (
         SELECT COALESCE(MAX(attempt), 0) + 1 AS value
         FROM agent_steps
         WHERE run_id = $2 AND step_index = $4
       )
       INSERT INTO agent_steps (
         id, run_id, project_id, step_index, attempt, step_id, step_type, tool,
         input_payload, output_payload, status, error_message, commit_hash,
         runtime_status, started_at, finished_at, created_at
       )
       VALUES (
         $1, $2, $3, $4, (SELECT value FROM next_attempt), $5, $6, $7,
         $8::jsonb, $9::jsonb, $10, $11, $12,
         $13, $14::timestamptz, $15::timestamptz, $16::timestamptz
       )
       RETURNING ${agentStepSelectColumns}`,
      [
        stepId,
        input.runId,
        input.projectId,
        input.stepIndex,
        input.stepId,
        input.type,
        input.tool,
        JSON.stringify(input.inputPayload ?? {}),
        JSON.stringify(input.outputPayload ?? {}),
        input.status,
        input.errorMessage ?? null,
        input.commitHash ?? null,
        input.runtimeStatus ?? null,
        input.startedAt,
        input.finishedAt,
        createdAt
      ]
    );

    return mapAgentStep(result.rows[0]);
  }

  async writeLearningEvent(input: LearningEventWriteInput): Promise<void> {
    const derived = deriveLearningEventMetrics(input.blockingBefore ?? null, input.blockingAfter ?? null);

    await this.pool.query(
      `INSERT INTO learning_events (
         run_id,
         project_id,
         step_index,
         event_type,
         phase,
         clusters,
         blocking_before,
         blocking_after,
         architecture_collapse,
         invariant_count,
         metadata,
         outcome,
         delta,
         regression_flag,
         convergence_flag
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)`,
      [
        input.runId,
        input.projectId,
        input.stepIndex ?? null,
        input.eventType,
        input.phase ?? null,
        input.clusters ? JSON.stringify(input.clusters) : null,
        input.blockingBefore ?? null,
        input.blockingAfter ?? null,
        input.architectureCollapse ?? null,
        input.invariantCount ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.outcome,
        derived.delta,
        derived.regressionFlag,
        derived.convergenceFlag
      ]
    );
  }

  async listAgentStepsByRun(runId: string): Promise<AgentStepRecord[]> {
    const result = await this.pool.query<DbAgentStepRow>(
      `SELECT ${agentStepSelectColumns}
       FROM agent_steps
       WHERE run_id = $1
       ORDER BY step_index ASC, attempt ASC, created_at ASC`,
      [runId]
    );

    return result.rows.map((row) => mapAgentStep(row));
  }

  async createSession(input: CreateSessionInput): Promise<AuthSession> {
    const id = input.sessionId || randomUUID();
    const now = new Date().toISOString();

    const result = await this.pool.query<DbSessionRow>(
      `INSERT INTO auth_sessions
       (id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, NULL, $7, $8)
       RETURNING id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent`,
      [
        id,
        input.userId,
        input.refreshTokenHash,
        now,
        now,
        input.expiresAt,
        input.ipAddress ?? null,
        input.userAgent ?? null
      ]
    );

    return mapSession(result.rows[0]);
  }

  async getSessionById(sessionId: string): Promise<AuthSession | undefined> {
    const result = await this.pool.query<DbSessionRow>(
      `SELECT id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent
       FROM auth_sessions
       WHERE id = $1`,
      [sessionId]
    );

    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<AuthSession | undefined> {
    const result = await this.pool.query<DbSessionRow>(
      `SELECT id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent
       FROM auth_sessions
       WHERE refresh_token_hash = $1`,
      [refreshTokenHash]
    );

    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async rotateSession(sessionId: string, refreshTokenHash: string, expiresAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET refresh_token_hash = $2, expires_at = $3::timestamptz, updated_at = NOW(), revoked_at = NULL
       WHERE id = $1`,
      [sessionId, refreshTokenHash, expiresAt]
    );
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET updated_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM auth_sessions
       WHERE id = $1`,
      [sessionId]
    );
  }

  async pruneExpiredSessions(client?: PoolClient): Promise<void> {
    await this.runQuery(
      `DELETE FROM auth_sessions
       WHERE expires_at <= NOW() OR (revoked_at IS NOT NULL AND revoked_at <= NOW() - INTERVAL '30 days')`,
      [],
      client
    );
  }

  async consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number; resetAt: string }> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSeconds / windowSeconds);
    const bucketKey = `${key}:${bucket}`;
    const resetAtSeconds = (bucket + 1) * windowSeconds;
    const resetAt = new Date(resetAtSeconds * 1000).toISOString();

    await this.pool.query(`DELETE FROM rate_limits WHERE reset_at <= NOW()`);

    const upsert = await this.pool.query<{ count: number }>(
      `INSERT INTO rate_limits (rate_key, count, reset_at)
       VALUES ($1, 1, $2::timestamptz)
       ON CONFLICT (rate_key) DO UPDATE
         SET count = rate_limits.count + 1
       RETURNING count`,
      [bucketKey, resetAt]
    );

    const count = Number(upsert.rows[0]?.count ?? 0);
    const allowed = count <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, resetAtSeconds - nowSeconds),
      resetAt
    };
  }
}
