import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ensureDir } from "./fs-utils.js";
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
    'queued', 'running', 'cancelling', 'cancelled', 'failed', 'complete',
    'planned', 'paused', 'completed'
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
  run_lock_owner TEXT,
  run_lock_acquired_at TIMESTAMPTZ,
  error_message TEXT,
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
id, project_id, org_id, workspace_id, created_by_user_id, status,
image_repository, image_tag, image_ref, image_digest, registry_host,
container_name, container_id, container_port, host_port,
subdomain, public_url, custom_domain, is_active, metadata, logs,
error_message, created_at, updated_at, finished_at
`;
const agentRunSelectColumns = `
id, project_id, org_id, workspace_id, created_by_user_id, goal,
provider_id, model, status, current_step_index, plan, last_step_id,
run_branch, worktree_path, base_commit_hash, current_commit_hash, last_valid_commit_hash,
run_lock_owner, run_lock_acquired_at,
error_message, created_at, updated_at, finished_at
`;
const agentStepSelectColumns = `
id, run_id, project_id, step_index, step_id, step_type, tool,
input_payload, output_payload, status, error_message, commit_hash,
runtime_status, started_at, finished_at, created_at
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
function toIso(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return new Date(value).toISOString();
}
function mapUser(row) {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        passwordHash: row.password_hash,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
    };
}
function mapOrganization(row) {
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
    };
}
function mapWorkspace(row) {
    return {
        id: row.id,
        orgId: row.org_id,
        name: row.name,
        description: row.description,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
    };
}
function mapMembership(row) {
    return {
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        role: row.role,
        createdAt: toIso(row.created_at)
    };
}
function mapSession(row) {
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
function mapProject(row) {
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
function mapProjectMetadata(row) {
    const architectureRaw = row.architecture_summary && typeof row.architecture_summary === "object" && !Array.isArray(row.architecture_summary)
        ? row.architecture_summary
        : {};
    return {
        projectId: row.project_id,
        orgId: row.org_id,
        workspaceId: row.workspace_id,
        architectureSummary: {
            framework: typeof architectureRaw.framework === "string" && architectureRaw.framework
                ? architectureRaw.framework
                : "Unknown",
            database: typeof architectureRaw.database === "string" && architectureRaw.database
                ? architectureRaw.database
                : "Unknown",
            auth: typeof architectureRaw.auth === "string" && architectureRaw.auth ? architectureRaw.auth : "None detected",
            payment: typeof architectureRaw.payment === "string" && architectureRaw.payment
                ? architectureRaw.payment
                : "None detected",
            keyFiles: Array.isArray(architectureRaw.keyFiles)
                ? architectureRaw.keyFiles.filter((item) => typeof item === "string").slice(0, 20)
                : []
        },
        stackInfo: row.stack_info && typeof row.stack_info === "object" && !Array.isArray(row.stack_info)
            ? row.stack_info
            : {},
        lastAnalyzedAt: toIso(row.last_analyzed_at),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
    };
}
function mapDeployment(row) {
    return {
        id: row.id,
        projectId: row.project_id,
        orgId: row.org_id,
        workspaceId: row.workspace_id,
        createdByUserId: row.created_by_user_id,
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
        metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? row.metadata
            : {},
        logs: row.logs || "",
        errorMessage: row.error_message,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        finishedAt: row.finished_at ? toIso(row.finished_at) : null
    };
}
function mapAgentRun(row) {
    const rawStatus = row.status;
    const normalizedStatus = rawStatus === "complete"
        ? "completed"
        : rawStatus === "queued"
            ? "planned"
            : rawStatus === "cancelling" || rawStatus === "cancelled"
                ? "paused"
                : rawStatus;
    return {
        id: row.id,
        projectId: row.project_id,
        orgId: row.org_id,
        workspaceId: row.workspace_id,
        createdByUserId: row.created_by_user_id,
        goal: row.goal,
        providerId: row.provider_id,
        model: row.model || undefined,
        status: normalizedStatus,
        currentStepIndex: Number(row.current_step_index) || 0,
        plan: row.plan && typeof row.plan === "object" && !Array.isArray(row.plan)
            ? row.plan
            : { goal: row.goal, steps: [] },
        lastStepId: row.last_step_id,
        runBranch: row.run_branch,
        worktreePath: row.worktree_path,
        baseCommitHash: row.base_commit_hash,
        currentCommitHash: row.current_commit_hash,
        lastValidCommitHash: row.last_valid_commit_hash,
        runLockOwner: row.run_lock_owner,
        runLockAcquiredAt: row.run_lock_acquired_at ? toIso(row.run_lock_acquired_at) : null,
        errorMessage: row.error_message,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        finishedAt: row.finished_at ? toIso(row.finished_at) : null
    };
}
function mapAgentStep(row) {
    return {
        id: row.id,
        runId: row.run_id,
        projectId: row.project_id,
        stepIndex: Number(row.step_index) || 0,
        stepId: row.step_id,
        type: row.step_type,
        tool: row.tool,
        inputPayload: row.input_payload && typeof row.input_payload === "object" && !Array.isArray(row.input_payload)
            ? row.input_payload
            : {},
        outputPayload: row.output_payload && typeof row.output_payload === "object" && !Array.isArray(row.output_payload)
            ? row.output_payload
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
function mapLifecycleRun(row) {
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
function mapLifecycleStep(row) {
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
    workspaceDir;
    pool;
    constructor(rootDir = process.cwd()) {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error("DATABASE_URL is required.");
        }
        this.workspaceDir = path.join(rootDir, ".workspace");
        this.pool = new Pool({
            connectionString: databaseUrl,
            ssl: process.env.DATABASE_SSL === "require"
                ? {
                    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
                }
                : undefined
        });
    }
    async initialize() {
        await ensureDir(this.workspaceDir);
        await this.pool.query(schemaSql);
        await this.migrateAgentStateMachineSchema();
        await this.pruneExpiredSessions();
        await this.markIncompleteDeploymentsFailed();
    }
    async close() {
        await this.pool.end();
    }
    async withTransaction(runner) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const result = await runner(client);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async runQuery(sql, values = [], client) {
        const target = client ?? this.pool;
        return target.query(sql, values);
    }
    getProjectWorkspacePath(project) {
        return path.join(this.workspaceDir, project.orgId, project.workspaceId, project.id);
    }
    toPublicUser(user) {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };
    }
    async findUserByEmail(email) {
        const normalized = email.trim().toLowerCase();
        const result = await this.pool.query(`SELECT id, email, name, password_hash, created_at, updated_at
       FROM users
       WHERE email = $1`, [normalized]);
        return result.rows[0] ? mapUser(result.rows[0]) : undefined;
    }
    async getUserById(userId) {
        const result = await this.pool.query(`SELECT id, email, name, password_hash, created_at, updated_at
       FROM users
       WHERE id = $1`, [userId]);
        return result.rows[0] ? mapUser(result.rows[0]) : undefined;
    }
    async createUser(input) {
        const normalized = input.email.trim().toLowerCase();
        const now = new Date().toISOString();
        const id = randomUUID();
        const result = await this.pool.query(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
       RETURNING id, email, name, password_hash, created_at, updated_at`, [id, normalized, input.name.trim(), input.passwordHash, now, now]);
        return mapUser(result.rows[0]);
    }
    async updateUser(user) {
        await this.pool.query(`UPDATE users
       SET email = $2, name = $3, password_hash = $4, updated_at = $5::timestamptz
       WHERE id = $1`, [user.id, user.email, user.name, user.passwordHash, user.updatedAt]);
    }
    async createOrganization(input) {
        const now = new Date().toISOString();
        const id = randomUUID();
        const result = await this.pool.query(`INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
       RETURNING id, name, slug, created_at, updated_at`, [id, input.name.trim(), input.slug.trim().toLowerCase(), now, now]);
        return mapOrganization(result.rows[0]);
    }
    async getOrganizationById(orgId) {
        const result = await this.pool.query(`SELECT id, name, slug, created_at, updated_at
       FROM organizations
       WHERE id = $1`, [orgId]);
        return result.rows[0] ? mapOrganization(result.rows[0]) : undefined;
    }
    async createMembership(input) {
        const createdAt = new Date().toISOString();
        const id = randomUUID();
        const inserted = await this.pool.query(`INSERT INTO organization_memberships (id, org_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (org_id, user_id) DO NOTHING
       RETURNING id, org_id, user_id, role, created_at`, [id, input.orgId, input.userId, input.role, createdAt]);
        if (inserted.rows[0]) {
            return mapMembership(inserted.rows[0]);
        }
        const existing = await this.pool.query(`SELECT id, org_id, user_id, role, created_at
       FROM organization_memberships
       WHERE org_id = $1 AND user_id = $2`, [input.orgId, input.userId]);
        if (!existing.rows[0]) {
            throw new Error("Membership could not be created.");
        }
        return mapMembership(existing.rows[0]);
    }
    async updateMembershipRole(orgId, userId, role) {
        await this.pool.query(`UPDATE organization_memberships
       SET role = $3
       WHERE org_id = $1 AND user_id = $2`, [orgId, userId, role]);
    }
    async getMembership(userId, orgId) {
        const result = await this.pool.query(`SELECT id, org_id, user_id, role, created_at
       FROM organization_memberships
       WHERE user_id = $1 AND org_id = $2`, [userId, orgId]);
        return result.rows[0] ? mapMembership(result.rows[0]) : undefined;
    }
    async listOrganizationsForUser(userId) {
        const result = await this.pool.query(`SELECT o.id, o.name, o.slug, o.created_at, o.updated_at, m.role
       FROM organization_memberships m
       JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1
       ORDER BY o.name ASC`, [userId]);
        return result.rows.map((row) => ({
            organization: mapOrganization(row),
            role: row.role
        }));
    }
    async createWorkspace(input) {
        const id = randomUUID();
        const now = new Date().toISOString();
        const result = await this.pool.query(`INSERT INTO workspaces (id, org_id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
       RETURNING id, org_id, name, description, created_at, updated_at`, [id, input.orgId, input.name.trim(), input.description?.trim() || "", now, now]);
        return mapWorkspace(result.rows[0]);
    }
    async getWorkspace(workspaceId) {
        const result = await this.pool.query(`SELECT id, org_id, name, description, created_at, updated_at
       FROM workspaces
       WHERE id = $1`, [workspaceId]);
        return result.rows[0] ? mapWorkspace(result.rows[0]) : undefined;
    }
    async listWorkspacesByOrg(orgId) {
        const result = await this.pool.query(`SELECT id, org_id, name, description, created_at, updated_at
       FROM workspaces
       WHERE org_id = $1
       ORDER BY name ASC`, [orgId]);
        return result.rows.map((row) => mapWorkspace(row));
    }
    async createProject(input) {
        const id = randomUUID();
        const now = new Date().toISOString();
        const result = await this.pool.query(`INSERT INTO projects
       (id, org_id, workspace_id, created_by_user_id, name, description, template_id, created_at, updated_at, history, messages)
       VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::jsonb, $11::jsonb)
       RETURNING id, org_id, workspace_id, created_by_user_id, name, description, template_id, created_at, updated_at, history, messages`, [
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
        ]);
        await ensureDir(this.getProjectWorkspacePath(mapProject(result.rows[0])));
        return mapProject(result.rows[0]);
    }
    async getProject(projectId) {
        const result = await this.pool.query(`SELECT id, org_id, workspace_id, created_by_user_id, name, description, template_id, created_at, updated_at, history, messages
       FROM projects
       WHERE id = $1`, [projectId]);
        return result.rows[0] ? mapProject(result.rows[0]) : undefined;
    }
    async updateProject(project) {
        await this.pool.query(`UPDATE projects
       SET
         name = $2,
         description = $3,
         template_id = $4,
         updated_at = $5::timestamptz,
         history = $6::jsonb,
         messages = $7::jsonb
       WHERE id = $1`, [
            project.id,
            project.name,
            project.description,
            project.templateId,
            project.updatedAt,
            JSON.stringify(project.history),
            JSON.stringify(project.messages)
        ]);
    }
    async listProjectsForUser(userId, workspaceId) {
        const result = await this.pool.query(`SELECT p.id, p.org_id, p.workspace_id, p.created_by_user_id, p.name, p.description, p.template_id,
              p.created_at, p.updated_at, p.history, p.messages
       FROM projects p
       JOIN organization_memberships m ON m.org_id = p.org_id
       WHERE m.user_id = $1
         AND ($2::uuid IS NULL OR p.workspace_id = $2::uuid)
       ORDER BY p.updated_at DESC`, [userId, workspaceId ?? null]);
        return result.rows.map((row) => mapProject(row));
    }
    async listProjectsByWorkspace(workspaceId) {
        const result = await this.pool.query(`SELECT id, org_id, workspace_id, created_by_user_id, name, description, template_id,
              created_at, updated_at, history, messages
       FROM projects
       WHERE workspace_id = $1
       ORDER BY updated_at DESC`, [workspaceId]);
        return result.rows.map((row) => mapProject(row));
    }
    async hasWorkspaceAccess(userId, workspaceId) {
        const result = await this.pool.query(`SELECT EXISTS(
         SELECT 1
         FROM workspaces w
         JOIN organization_memberships m ON m.org_id = w.org_id
         WHERE w.id = $1 AND m.user_id = $2
       ) AS exists`, [workspaceId, userId]);
        return result.rows[0]?.exists ?? false;
    }
    async hasProjectAccess(userId, projectId) {
        const result = await this.pool.query(`SELECT EXISTS(
         SELECT 1
         FROM projects p
         JOIN organization_memberships m ON m.org_id = p.org_id
         WHERE p.id = $1 AND m.user_id = $2
       ) AS exists`, [projectId, userId]);
        return result.rows[0]?.exists ?? false;
    }
    async getProjectMetadata(projectId) {
        const result = await this.pool.query(`SELECT ${projectMetadataSelectColumns}
       FROM project_metadata
       WHERE project_id = $1`, [projectId]);
        return result.rows[0] ? mapProjectMetadata(result.rows[0]) : undefined;
    }
    async upsertProjectMetadata(input) {
        const now = new Date().toISOString();
        const analyzedAt = input.lastAnalyzedAt || now;
        const result = await this.pool.query(`INSERT INTO project_metadata (
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
       RETURNING ${projectMetadataSelectColumns}`, [
            input.projectId,
            input.orgId,
            input.workspaceId,
            JSON.stringify(input.architectureSummary),
            JSON.stringify(input.stackInfo),
            analyzedAt,
            now,
            now
        ]);
        return mapProjectMetadata(result.rows[0]);
    }
    async createDeployment(input) {
        const id = input.deploymentId || randomUUID();
        const now = new Date().toISOString();
        const result = await this.pool.query(`INSERT INTO deployments (
         id, project_id, org_id, workspace_id, created_by_user_id, status,
         image_repository, image_tag, image_ref, image_digest, registry_host,
         container_name, container_id, container_port, host_port,
         subdomain, public_url, custom_domain, is_active, metadata, logs, error_message,
         created_at, updated_at, finished_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, NULL, $10,
         NULL, NULL, $11, NULL,
         $12, $13, $14, FALSE, $15::jsonb, '', NULL,
         $16::timestamptz, $17::timestamptz, NULL
       )
       RETURNING ${deploymentSelectColumns}`, [
            id,
            input.projectId,
            input.orgId,
            input.workspaceId,
            input.createdByUserId,
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
        ]);
        return mapDeployment(result.rows[0]);
    }
    async getDeploymentById(projectId, deploymentId) {
        const result = await this.pool.query(`SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE id = $1 AND project_id = $2`, [deploymentId, projectId]);
        return result.rows[0] ? mapDeployment(result.rows[0]) : undefined;
    }
    async getDeployment(deploymentId) {
        const result = await this.pool.query(`SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE id = $1`, [deploymentId]);
        return result.rows[0] ? mapDeployment(result.rows[0]) : undefined;
    }
    async listDeploymentsByProject(projectId) {
        const result = await this.pool.query(`SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE project_id = $1
       ORDER BY created_at DESC`, [projectId]);
        return result.rows.map((row) => mapDeployment(row));
    }
    async listActiveDeploymentsByProject(projectId) {
        const result = await this.pool.query(`SELECT ${deploymentSelectColumns}
       FROM deployments
       WHERE project_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC`, [projectId]);
        return result.rows.map((row) => mapDeployment(row));
    }
    async hasInProgressDeployment(projectId) {
        const result = await this.pool.query(`SELECT EXISTS(
         SELECT 1
         FROM deployments
         WHERE project_id = $1
           AND status IN ('queued', 'building', 'pushing', 'launching')
       ) AS exists`, [projectId]);
        return result.rows[0]?.exists ?? false;
    }
    async updateDeployment(deploymentId, patch) {
        const patchEntries = Object.entries(patch);
        if (!patchEntries.length) {
            return this.getDeployment(deploymentId);
        }
        const mapping = {
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
        const assignments = [];
        const values = [];
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
        const result = await this.pool.query(`UPDATE deployments
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${deploymentSelectColumns}`, [...values, deploymentId]);
        return result.rows[0] ? mapDeployment(result.rows[0]) : undefined;
    }
    async setActiveDeployment(projectId, deploymentId) {
        await this.withTransaction(async (client) => {
            await client.query(`UPDATE deployments
         SET is_active = FALSE, updated_at = NOW()
         WHERE project_id = $1`, [projectId]);
            await client.query(`UPDATE deployments
         SET is_active = TRUE, updated_at = NOW()
         WHERE id = $1 AND project_id = $2`, [deploymentId, projectId]);
        });
    }
    async appendDeploymentLog(deploymentId, content) {
        await this.pool.query(`UPDATE deployments
       SET logs = COALESCE(logs, '') || $2, updated_at = NOW()
       WHERE id = $1`, [deploymentId, content]);
    }
    async markIncompleteDeploymentsFailed() {
        await this.pool.query(`UPDATE deployments
       SET
         status = 'failed',
         error_message = COALESCE(error_message, 'Deployment interrupted during server restart.'),
         finished_at = NOW(),
         updated_at = NOW(),
         is_active = FALSE
       WHERE status IN ('queued', 'building', 'pushing', 'launching')`);
    }
    async migrateAgentStateMachineSchema() {
        await this.pool.query(`ALTER TABLE agent_runs
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
       ADD COLUMN IF NOT EXISTS run_lock_acquired_at TIMESTAMPTZ`);
        await this.pool.query(`UPDATE agent_runs
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
           WHEN 'completed' THEN 'complete'
           ELSE status
         END`);
        await this.pool.query(`ALTER TABLE agent_runs
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
       ALTER COLUMN max_optimizations SET NOT NULL`);
        await this.pool.query(`DO $$
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
       END $$;`);
        await this.pool.query(`ALTER TABLE agent_runs
       ADD CONSTRAINT agent_runs_status_check
       CHECK (status IN ('queued', 'running', 'cancelling', 'cancelled', 'failed', 'complete'))`);
        await this.pool.query(`ALTER TABLE agent_runs
       ADD CONSTRAINT agent_runs_phase_check
       CHECK (phase IN ('goal', 'optimization'))`);
        await this.pool.query(`ALTER TABLE agent_steps
       ADD COLUMN IF NOT EXISTS summary TEXT,
       ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
        await this.pool.query(`UPDATE agent_steps
       SET
         summary = COALESCE(summary, ''),
         status = CASE status
           WHEN 'completed' THEN 'complete'
           ELSE status
         END`);
        await this.pool.query(`ALTER TABLE agent_steps
       ALTER COLUMN summary SET DEFAULT '',
       ALTER COLUMN summary SET NOT NULL`);
        await this.pool.query(`DO $$
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
       END $$;`);
        await this.pool.query(`ALTER TABLE agent_steps
       ADD CONSTRAINT agent_steps_step_type_check
       CHECK (step_type IN ('goal', 'correction', 'optimization', 'analyze', 'modify', 'verify'))`);
        await this.pool.query(`ALTER TABLE agent_steps
       ADD CONSTRAINT agent_steps_status_check
       CHECK (status IN ('pending', 'running', 'complete', 'failed', 'completed'))`);
    }
    async createLifecycleRun(input, client) {
        const runId = input.runId || randomUUID();
        const now = new Date().toISOString();
        const result = await this.runQuery(`INSERT INTO agent_runs (
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
       RETURNING ${lifecycleRunSelectColumns}`, [
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
        ], client);
        return mapLifecycleRun(result.rows[0]);
    }
    async getLifecycleRunById(projectId, runId, client) {
        const result = await this.runQuery(`SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND project_id = $2 AND provider_id = 'state-machine'`, [runId, projectId], client);
        return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
    }
    async getLifecycleRun(runId, client) {
        const result = await this.runQuery(`SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND provider_id = 'state-machine'`, [runId], client);
        return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
    }
    async listLifecycleRunsByProject(projectId, limit = 100) {
        const result = await this.runQuery(`SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE project_id = $1 AND provider_id = 'state-machine'
       ORDER BY created_at DESC
       LIMIT $2`, [projectId, limit]);
        return result.rows.map((row) => mapLifecycleRun(row));
    }
    async lockLifecycleRunForUpdate(runId, client) {
        const result = await this.runQuery(`SELECT ${lifecycleRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND provider_id = 'state-machine'
       FOR UPDATE`, [runId], client);
        return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
    }
    async updateLifecycleRun(runId, patch, client) {
        const patchEntries = Object.entries(patch);
        if (!patchEntries.length) {
            return this.getLifecycleRun(runId, client);
        }
        const mapping = {
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
        const assignments = [];
        const values = [];
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
        const result = await this.runQuery(`UPDATE agent_runs
       SET ${assignments.join(", ")}, current_step_index = step_index, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${lifecycleRunSelectColumns}`, [...values, runId], client);
        return result.rows[0] ? mapLifecycleRun(result.rows[0]) : undefined;
    }
    async createLifecycleStep(input, client) {
        const stepId = randomUUID();
        const createdAt = new Date().toISOString();
        const result = await this.runQuery(`INSERT INTO agent_steps (
         id, run_id, project_id, step_index, step_id, step_type, tool,
         input_payload, output_payload, status, summary, error_message, commit_hash, runtime_status,
         started_at, finished_at, completed_at, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, 'state_machine_step',
         '{}'::jsonb, '{}'::jsonb, $7, $8, NULL, $9, NULL,
         NOW(), NOW(), $10::timestamptz, $11::timestamptz
       )
       RETURNING ${lifecycleStepSelectColumns}`, [
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
        ], client);
        return mapLifecycleStep(result.rows[0]);
    }
    async updateLifecycleStep(stepId, patch, client) {
        const patchEntries = Object.entries(patch);
        if (!patchEntries.length) {
            const existing = await this.runQuery(`SELECT ${lifecycleStepSelectColumns}
         FROM agent_steps
         WHERE id = $1`, [stepId], client);
            return existing.rows[0] ? mapLifecycleStep(existing.rows[0]) : undefined;
        }
        const mapping = {
            status: { column: "status" },
            summary: { column: "summary" },
            commitHash: { column: "commit_hash" },
            completedAt: { column: "completed_at", cast: "::timestamptz" }
        };
        const assignments = [];
        const values = [];
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
        const result = await this.runQuery(`UPDATE agent_steps
       SET ${assignments.join(", ")}
       WHERE id = $${values.length + 1}
       RETURNING ${lifecycleStepSelectColumns}`, [...values, stepId], client);
        return result.rows[0] ? mapLifecycleStep(result.rows[0]) : undefined;
    }
    async listLifecycleStepsByRun(runId) {
        const result = await this.runQuery(`SELECT ${lifecycleStepSelectColumns}
       FROM agent_steps
       WHERE run_id = $1
       ORDER BY step_index ASC, created_at ASC`, [runId]);
        return result.rows.map((row) => mapLifecycleStep(row));
    }
    async createAgentRun(input) {
        const runId = input.runId || randomUUID();
        const now = new Date().toISOString();
        const normalizedStatus = input.status === "completed"
            ? "complete"
            : input.status === "planned"
                ? "queued"
                : input.status === "paused"
                    ? "cancelling"
                    : input.status;
        const result = await this.pool.query(`INSERT INTO agent_runs (
         id, project_id, org_id, workspace_id, created_by_user_id, goal,
         provider_id, model, status, current_step_index, plan, last_step_id,
         run_branch, worktree_path, base_commit_hash, current_commit_hash, last_valid_commit_hash,
         run_lock_owner, run_lock_acquired_at,
         error_message, created_at, updated_at, finished_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11::jsonb, $12,
         $13, $14, $15, $16, $17,
         NULL, NULL,
         $18, $19::timestamptz, $20::timestamptz, $21::timestamptz
       )
       RETURNING ${agentRunSelectColumns}`, [
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
            input.errorMessage ?? null,
            now,
            now,
            input.finishedAt ?? null
        ]);
        return mapAgentRun(result.rows[0]);
    }
    async getAgentRunById(projectId, runId) {
        const result = await this.pool.query(`SELECT ${agentRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND project_id = $2 AND provider_id <> 'state-machine'`, [runId, projectId]);
        return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
    }
    async getAgentRun(runId) {
        const result = await this.pool.query(`SELECT ${agentRunSelectColumns}
       FROM agent_runs
       WHERE id = $1 AND provider_id <> 'state-machine'`, [runId]);
        return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
    }
    async listAgentRunsByProject(projectId, limit = 100) {
        const result = await this.pool.query(`SELECT ${agentRunSelectColumns}
       FROM agent_runs
       WHERE project_id = $1 AND provider_id <> 'state-machine'
       ORDER BY created_at DESC
       LIMIT $2`, [projectId, limit]);
        return result.rows.map((row) => mapAgentRun(row));
    }
    async hasActiveAgentRun(projectId) {
        const result = await this.pool.query(`SELECT EXISTS(
         SELECT 1
         FROM agent_runs
         WHERE project_id = $1
           AND provider_id <> 'state-machine'
           AND status IN ('queued', 'running', 'cancelling')
       ) AS exists`, [projectId]);
        return result.rows[0]?.exists === true;
    }
    async updateAgentRun(runId, patch) {
        const patchEntries = Object.entries(patch);
        if (!patchEntries.length) {
            return this.getAgentRun(runId);
        }
        const mapping = {
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
            runLockOwner: { column: "run_lock_owner" },
            runLockAcquiredAt: { column: "run_lock_acquired_at", cast: "::timestamptz" },
            errorMessage: { column: "error_message" },
            finishedAt: { column: "finished_at", cast: "::timestamptz" }
        };
        const assignments = [];
        const values = [];
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
        const result = await this.pool.query(`UPDATE agent_runs
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${agentRunSelectColumns}`, [...values, runId]);
        return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
    }
    async acquireAgentRunExecutionLock(runId, lockOwner, staleAfterSeconds = 1800) {
        const staleSeconds = Math.max(30, Math.floor(Number(staleAfterSeconds) || 1800));
        const result = await this.pool.query(`UPDATE agent_runs
       SET run_lock_owner = $2, run_lock_acquired_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND provider_id <> 'state-machine'
         AND (
           run_lock_owner IS NULL
           OR run_lock_owner = $2
           OR run_lock_acquired_at IS NULL
           OR run_lock_acquired_at < NOW() - make_interval(secs => $3::int)
         )
       RETURNING ${agentRunSelectColumns}`, [runId, lockOwner, staleSeconds]);
        return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
    }
    async releaseAgentRunExecutionLock(runId, lockOwner) {
        const result = await this.pool.query(`UPDATE agent_runs
       SET run_lock_owner = NULL, run_lock_acquired_at = NULL, updated_at = NOW()
       WHERE id = $1
         AND provider_id <> 'state-machine'
         AND (run_lock_owner IS NULL OR run_lock_owner = $2)
       RETURNING ${agentRunSelectColumns}`, [runId, lockOwner]);
        return result.rows[0] ? mapAgentRun(result.rows[0]) : undefined;
    }
    async refreshAgentRunExecutionLock(runId, lockOwner) {
        const result = await this.pool.query(`UPDATE agent_runs
       SET run_lock_acquired_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND provider_id <> 'state-machine'
         AND run_lock_owner = $2`, [runId, lockOwner]);
        return Number(result.rowCount || 0) > 0;
    }
    async createAgentStep(input) {
        const stepId = randomUUID();
        const createdAt = new Date().toISOString();
        const result = await this.pool.query(`INSERT INTO agent_steps (
         id, run_id, project_id, step_index, step_id, step_type, tool,
         input_payload, output_payload, status, error_message, commit_hash,
         runtime_status, started_at, finished_at, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::jsonb, $9::jsonb, $10, $11, $12,
         $13, $14::timestamptz, $15::timestamptz, $16::timestamptz
       )
       ON CONFLICT (run_id, step_index) DO UPDATE
       SET
         step_id = EXCLUDED.step_id,
         step_type = EXCLUDED.step_type,
         tool = EXCLUDED.tool,
         input_payload = EXCLUDED.input_payload,
         output_payload = EXCLUDED.output_payload,
         status = EXCLUDED.status,
         error_message = EXCLUDED.error_message,
         commit_hash = EXCLUDED.commit_hash,
         runtime_status = EXCLUDED.runtime_status,
         started_at = EXCLUDED.started_at,
         finished_at = EXCLUDED.finished_at
       RETURNING ${agentStepSelectColumns}`, [
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
        ]);
        return mapAgentStep(result.rows[0]);
    }
    async listAgentStepsByRun(runId) {
        const result = await this.pool.query(`SELECT ${agentStepSelectColumns}
       FROM agent_steps
       WHERE run_id = $1
       ORDER BY step_index ASC, created_at ASC`, [runId]);
        return result.rows.map((row) => mapAgentStep(row));
    }
    async createSession(input) {
        const id = input.sessionId || randomUUID();
        const now = new Date().toISOString();
        const result = await this.pool.query(`INSERT INTO auth_sessions
       (id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, NULL, $7, $8)
       RETURNING id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent`, [
            id,
            input.userId,
            input.refreshTokenHash,
            now,
            now,
            input.expiresAt,
            input.ipAddress ?? null,
            input.userAgent ?? null
        ]);
        return mapSession(result.rows[0]);
    }
    async getSessionById(sessionId) {
        const result = await this.pool.query(`SELECT id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent
       FROM auth_sessions
       WHERE id = $1`, [sessionId]);
        return result.rows[0] ? mapSession(result.rows[0]) : undefined;
    }
    async getSessionByRefreshTokenHash(refreshTokenHash) {
        const result = await this.pool.query(`SELECT id, user_id, refresh_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent
       FROM auth_sessions
       WHERE refresh_token_hash = $1`, [refreshTokenHash]);
        return result.rows[0] ? mapSession(result.rows[0]) : undefined;
    }
    async rotateSession(sessionId, refreshTokenHash, expiresAt) {
        await this.pool.query(`UPDATE auth_sessions
       SET refresh_token_hash = $2, expires_at = $3::timestamptz, updated_at = NOW(), revoked_at = NULL
       WHERE id = $1`, [sessionId, refreshTokenHash, expiresAt]);
    }
    async touchSession(sessionId) {
        await this.pool.query(`UPDATE auth_sessions
       SET updated_at = NOW()
       WHERE id = $1`, [sessionId]);
    }
    async revokeSession(sessionId) {
        await this.pool.query(`UPDATE auth_sessions
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1`, [sessionId]);
    }
    async deleteSession(sessionId) {
        await this.pool.query(`DELETE FROM auth_sessions
       WHERE id = $1`, [sessionId]);
    }
    async pruneExpiredSessions() {
        await this.pool.query(`DELETE FROM auth_sessions
       WHERE expires_at <= NOW() OR (revoked_at IS NOT NULL AND revoked_at <= NOW() - INTERVAL '30 days')`);
    }
    async consumeRateLimit(key, limit, windowSeconds) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const bucket = Math.floor(nowSeconds / windowSeconds);
        const bucketKey = `${key}:${bucket}`;
        const resetAtSeconds = (bucket + 1) * windowSeconds;
        const resetAt = new Date(resetAtSeconds * 1000).toISOString();
        await this.pool.query(`DELETE FROM rate_limits WHERE reset_at <= NOW()`);
        const upsert = await this.pool.query(`INSERT INTO rate_limits (rate_key, count, reset_at)
       VALUES ($1, 1, $2::timestamptz)
       ON CONFLICT (rate_key) DO UPDATE
         SET count = rate_limits.count + 1
       RETURNING count`, [bucketKey, resetAt]);
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
