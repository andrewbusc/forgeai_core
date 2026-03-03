import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";
import { ExecutionGraph } from "./graph-store.js";
import { GraphNode, GraphEdge, buildGraphIdentityHash, type GraphPolicyDescriptor } from "../agent/graph-identity.js";

export interface GraphRevision {
  id: string;
  graphId: string;
  revisionNumber: number;
  graphIdentityHash: string;
  graphSchemaVersion: number;
  graphPolicyDescriptor: GraphPolicyDescriptor;
  parentRevisionId: string | null;
  createdByUserId: string;
  createdAt: string;
}

interface DbGraphRevisionRow {
  id: string;
  graph_id: string;
  revision_number: number;
  graph_identity_hash: string;
  graph_schema_version: number;
  graph_policy_descriptor: unknown;
  parent_revision_id: string | null;
  created_by_user_id: string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function mapGraphRevision(row: DbGraphRevisionRow): GraphRevision {
  return {
    id: row.id,
    graphId: row.graph_id,
    revisionNumber: row.revision_number,
    graphIdentityHash: row.graph_identity_hash,
    graphSchemaVersion: row.graph_schema_version,
    graphPolicyDescriptor: row.graph_policy_descriptor as GraphPolicyDescriptor,
    parentRevisionId: row.parent_revision_id,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at)
  };
}

export const graphRevisionSchemaSql = `
CREATE TABLE IF NOT EXISTS execution_graph_revisions (
  id UUID PRIMARY KEY,
  graph_id UUID NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  graph_identity_hash TEXT NOT NULL,
  graph_schema_version INTEGER NOT NULL,
  graph_policy_descriptor JSONB NOT NULL,
  parent_revision_id UUID REFERENCES execution_graph_revisions(id) ON DELETE RESTRICT,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(graph_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_graph_revisions_graph_id ON execution_graph_revisions (graph_id);
CREATE INDEX IF NOT EXISTS idx_graph_revisions_revision_number ON execution_graph_revisions (graph_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_graph_revisions_identity_hash ON execution_graph_revisions (graph_identity_hash);
`;

export class GraphRevisionStore {
  constructor(private readonly pool: Pool) {}

  async initializeSchema(client?: PoolClient): Promise<void> {
    if (client) {
      await client.query(graphRevisionSchemaSql);
    } else {
      await this.pool.query(graphRevisionSchemaSql);
    }
  }

  async createRevision(input: {
    graphId: string;
    policyDescriptor: GraphPolicyDescriptor;
    nodes: GraphNode[];
    edges: GraphEdge[];
    parentRevisionId?: string;
    createdByUserId: string;
  }): Promise<GraphRevision> {
    if (input.parentRevisionId) {
      const parent = await this.getRevision(input.parentRevisionId);
      if (!parent || parent.graphId !== input.graphId) {
        throw new Error("Parent revision must belong to same graph");
      }
    }

    const revisionId = randomUUID();
    const now = new Date().toISOString();
    
    const graphIdentityHash = buildGraphIdentityHash({
      policyDescriptor: input.policyDescriptor,
      nodes: input.nodes,
      edges: input.edges
    });

    const latestRevision = await this.getLatestRevision(input.graphId);
    const revisionNumber = latestRevision ? latestRevision.revisionNumber + 1 : 1;

    const result = await this.pool.query<DbGraphRevisionRow>(
      `INSERT INTO execution_graph_revisions (
         id, graph_id, revision_number, graph_identity_hash,
         graph_schema_version, graph_policy_descriptor,
         parent_revision_id, created_by_user_id, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
       RETURNING
         id, graph_id, revision_number, graph_identity_hash,
         graph_schema_version, graph_policy_descriptor,
         parent_revision_id, created_by_user_id, created_at`,
      [
        revisionId,
        input.graphId,
        revisionNumber,
        graphIdentityHash,
        1,
        JSON.stringify(input.policyDescriptor),
        input.parentRevisionId || null,
        input.createdByUserId,
        now
      ]
    );

    return mapGraphRevision(result.rows[0]);
  }

  async getRevision(revisionId: string): Promise<GraphRevision | undefined> {
    const result = await this.pool.query<DbGraphRevisionRow>(
      `SELECT
         id, graph_id, revision_number, graph_identity_hash,
         graph_schema_version, graph_policy_descriptor,
         parent_revision_id, created_by_user_id, created_at
       FROM execution_graph_revisions
       WHERE id = $1`,
      [revisionId]
    );

    return result.rows[0] ? mapGraphRevision(result.rows[0]) : undefined;
  }

  async getLatestRevision(graphId: string): Promise<GraphRevision | undefined> {
    const result = await this.pool.query<DbGraphRevisionRow>(
      `SELECT
         id, graph_id, revision_number, graph_identity_hash,
         graph_schema_version, graph_policy_descriptor,
         parent_revision_id, created_by_user_id, created_at
       FROM execution_graph_revisions
       WHERE graph_id = $1
       ORDER BY revision_number DESC
       LIMIT 1`,
      [graphId]
    );

    return result.rows[0] ? mapGraphRevision(result.rows[0]) : undefined;
  }

  async listRevisions(graphId: string, limit = 100): Promise<GraphRevision[]> {
    const result = await this.pool.query<DbGraphRevisionRow>(
      `SELECT
         id, graph_id, revision_number, graph_identity_hash,
         graph_schema_version, graph_policy_descriptor,
         parent_revision_id, created_by_user_id, created_at
       FROM execution_graph_revisions
       WHERE graph_id = $1
       ORDER BY revision_number DESC
       LIMIT $2`,
      [graphId, limit]
    );

    return result.rows.map(row => mapGraphRevision(row));
  }

  async getRevisionNodes(revisionId: string): Promise<GraphNode[]> {
    const revision = await this.getRevision(revisionId);
    if (!revision) {
      throw new Error("Revision not found");
    }

    const result = await this.pool.query<{ run_id: string; execution_identity_hash: string }>(
      `SELECT run_id, execution_identity_hash
       FROM execution_graph_nodes
       WHERE graph_id = $1`,
      [revision.graphId]
    );

    return result.rows.map(row => ({
      runId: row.run_id,
      executionIdentityHash: row.execution_identity_hash
    }));
  }

  async getRevisionEdges(revisionId: string): Promise<GraphEdge[]> {
    const revision = await this.getRevision(revisionId);
    if (!revision) {
      throw new Error("Revision not found");
    }

    const result = await this.pool.query<{ from_run_id: string; to_run_id: string }>(
      `SELECT from_run_id, to_run_id
       FROM execution_graph_edges
       WHERE graph_id = $1`,
      [revision.graphId]
    );

    return result.rows.map(row => ({
      fromRunId: row.from_run_id,
      toRunId: row.to_run_id
    }));
  }
}
