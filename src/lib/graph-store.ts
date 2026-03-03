import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";
import {
  buildGraphIdentityHash,
  validateGraphAcyclic,
  buildDefaultGraphPolicyDescriptor,
  type GraphNode,
  type GraphEdge,
  type GraphPolicyDescriptor,
  GRAPH_SCHEMA_VERSION
} from "../agent/graph-identity.js";

export interface ExecutionGraph {
  id: string;
  projectId: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  graphIdentityHash: string;
  graphSchemaVersion: number;
  graphPolicyDescriptor: GraphPolicyDescriptor;
  status: "created" | "running" | "complete" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionGraphInput {
  graphId?: string;
  projectId: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  policyDescriptor?: GraphPolicyDescriptor;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface DbExecutionGraphRow {
  id: string;
  project_id: string;
  org_id: string;
  workspace_id: string;
  created_by_user_id: string;
  graph_identity_hash: string;
  graph_schema_version: number;
  graph_policy_descriptor: unknown;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbGraphNodeRow {
  graph_id: string;
  run_id: string;
  execution_identity_hash: string;
  created_at: Date | string;
}

interface DbGraphEdgeRow {
  graph_id: string;
  from_run_id: string;
  to_run_id: string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function mapExecutionGraph(row: DbExecutionGraphRow): ExecutionGraph {
  return {
    id: row.id,
    projectId: row.project_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    graphIdentityHash: row.graph_identity_hash,
    graphSchemaVersion: row.graph_schema_version,
    graphPolicyDescriptor: row.graph_policy_descriptor as GraphPolicyDescriptor,
    status: row.status as ExecutionGraph["status"],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export const graphSchemaSql = `
CREATE TABLE IF NOT EXISTS execution_graphs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  graph_identity_hash TEXT NOT NULL,
  graph_schema_version INTEGER NOT NULL,
  graph_policy_descriptor JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created', 'running', 'complete', 'failed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_graphs_project_id ON execution_graphs (project_id);
CREATE INDEX IF NOT EXISTS idx_execution_graphs_identity_hash ON execution_graphs (graph_identity_hash);
CREATE INDEX IF NOT EXISTS idx_execution_graphs_status ON execution_graphs (status);

CREATE TABLE IF NOT EXISTS execution_graph_nodes (
  graph_id UUID NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  execution_identity_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (graph_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_execution_graph_nodes_graph_id ON execution_graph_nodes (graph_id);
CREATE INDEX IF NOT EXISTS idx_execution_graph_nodes_run_id ON execution_graph_nodes (run_id);

CREATE TABLE IF NOT EXISTS execution_graph_edges (
  graph_id UUID NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
  from_run_id UUID NOT NULL,
  to_run_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (graph_id, from_run_id, to_run_id),
  FOREIGN KEY (graph_id, from_run_id) REFERENCES execution_graph_nodes(graph_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (graph_id, to_run_id) REFERENCES execution_graph_nodes(graph_id, run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_graph_edges_graph_id ON execution_graph_edges (graph_id);
CREATE INDEX IF NOT EXISTS idx_execution_graph_edges_from_run_id ON execution_graph_edges (from_run_id);
CREATE INDEX IF NOT EXISTS idx_execution_graph_edges_to_run_id ON execution_graph_edges (to_run_id);
`;

export class GraphStore {
  constructor(private readonly pool: Pool) {}

  async initializeSchema(client?: PoolClient): Promise<void> {
    if (client) {
      await client.query(graphSchemaSql);
    } else {
      await this.pool.query(graphSchemaSql);
    }
  }

  async createExecutionGraph(input: CreateExecutionGraphInput, client?: PoolClient): Promise<ExecutionGraph> {
    if (!validateGraphAcyclic(input.nodes, input.edges)) {
      throw new Error("Graph contains cycles");
    }

    const graphId = input.graphId || randomUUID();
    const now = new Date().toISOString();
    const policyDescriptor = input.policyDescriptor || buildDefaultGraphPolicyDescriptor();
    const graphIdentityHash = buildGraphIdentityHash({
      policyDescriptor,
      nodes: input.nodes,
      edges: input.edges
    });

    const executor = client || this.pool;

    const graphResult = await executor.query<DbExecutionGraphRow>(
      `INSERT INTO execution_graphs (
         id, project_id, org_id, workspace_id, created_by_user_id,
         graph_identity_hash, graph_schema_version, graph_policy_descriptor,
         status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'created', $9::timestamptz, $10::timestamptz)
       RETURNING
         id, project_id, org_id, workspace_id, created_by_user_id,
         graph_identity_hash, graph_schema_version, graph_policy_descriptor,
         status, created_at, updated_at`,
      [
        graphId,
        input.projectId,
        input.orgId,
        input.workspaceId,
        input.createdByUserId,
        graphIdentityHash,
        GRAPH_SCHEMA_VERSION,
        JSON.stringify(policyDescriptor),
        now,
        now
      ]
    );

    for (const node of input.nodes) {
      await executor.query(
        `INSERT INTO execution_graph_nodes (graph_id, run_id, execution_identity_hash, created_at)
         VALUES ($1, $2, $3, $4::timestamptz)`,
        [graphId, node.runId, node.executionIdentityHash, now]
      );
    }

    for (const edge of input.edges) {
      await executor.query(
        `INSERT INTO execution_graph_edges (graph_id, from_run_id, to_run_id, created_at)
         VALUES ($1, $2, $3, $4::timestamptz)`,
        [graphId, edge.fromRunId, edge.toRunId, now]
      );
    }

    return mapExecutionGraph(graphResult.rows[0]);
  }

  async getExecutionGraph(graphId: string, client?: PoolClient): Promise<ExecutionGraph | undefined> {
    const executor = client || this.pool;
    const result = await executor.query<DbExecutionGraphRow>(
      `SELECT
         id, project_id, org_id, workspace_id, created_by_user_id,
         graph_identity_hash, graph_schema_version, graph_policy_descriptor,
         status, created_at, updated_at
       FROM execution_graphs
       WHERE id = $1`,
      [graphId]
    );

    return result.rows[0] ? mapExecutionGraph(result.rows[0]) : undefined;
  }

  async getGraphNodes(graphId: string, client?: PoolClient): Promise<GraphNode[]> {
    const executor = client || this.pool;
    const result = await executor.query<DbGraphNodeRow>(
      `SELECT graph_id, run_id, execution_identity_hash, created_at
       FROM execution_graph_nodes
       WHERE graph_id = $1
       ORDER BY created_at ASC`,
      [graphId]
    );

    return result.rows.map(row => ({
      runId: row.run_id,
      executionIdentityHash: row.execution_identity_hash
    }));
  }

  async getGraphEdges(graphId: string, client?: PoolClient): Promise<GraphEdge[]> {
    const executor = client || this.pool;
    const result = await executor.query<DbGraphEdgeRow>(
      `SELECT graph_id, from_run_id, to_run_id, created_at
       FROM execution_graph_edges
       WHERE graph_id = $1
       ORDER BY created_at ASC`,
      [graphId]
    );

    return result.rows.map(row => ({
      fromRunId: row.from_run_id,
      toRunId: row.to_run_id
    }));
  }

  async listExecutionGraphsByProject(projectId: string, limit = 100): Promise<ExecutionGraph[]> {
    const result = await this.pool.query<DbExecutionGraphRow>(
      `SELECT
         id, project_id, org_id, workspace_id, created_by_user_id,
         graph_identity_hash, graph_schema_version, graph_policy_descriptor,
         status, created_at, updated_at
       FROM execution_graphs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );

    return result.rows.map(row => mapExecutionGraph(row));
  }

  async updateGraphStatus(
    graphId: string,
    status: ExecutionGraph["status"],
    client?: PoolClient
  ): Promise<ExecutionGraph | undefined> {
    const executor = client || this.pool;
    const result = await executor.query<DbExecutionGraphRow>(
      `UPDATE execution_graphs
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING
         id, project_id, org_id, workspace_id, created_by_user_id,
         graph_identity_hash, graph_schema_version, graph_policy_descriptor,
         status, created_at, updated_at`,
      [graphId, status]
    );

    return result.rows[0] ? mapExecutionGraph(result.rows[0]) : undefined;
  }

  async createSingleNodeGraph(input: {
    projectId: string;
    orgId: string;
    workspaceId: string;
    createdByUserId: string;
    runId: string;
    executionIdentityHash: string;
  }): Promise<ExecutionGraph> {
    if (input.executionIdentityHash === "pending" || input.executionIdentityHash.length !== 64) {
      throw new Error("Execution identity must be finalized before graph creation");
    }

    return this.createExecutionGraph({
      projectId: input.projectId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      createdByUserId: input.createdByUserId,
      nodes: [
        {
          runId: input.runId,
          executionIdentityHash: input.executionIdentityHash
        }
      ],
      edges: []
    });
  }
}
