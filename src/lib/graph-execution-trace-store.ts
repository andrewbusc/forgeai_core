/**
 * Graph Execution Trace Store
 * 
 * Persistence layer for deterministic execution trace events.
 * 
 * Append-only semantics.
 * Deterministic sequence indexing.
 * No ephemeral logs.
 */

import type { Pool } from 'pg';
import type {
  GraphExecutionEvent,
  GraphExecutionTrace,
  GraphExecutionTransitionType,
} from '../agent/graph-execution-trace.js';

interface DbTraceEventRow {
  id: string;
  graph_revision_id: string;
  node_execution_identity_hash: string;
  transition_type: string;
  previous_state: string | null;
  new_state: string;
  policy_identity_hash: string;
  timestamp: Date;
  deterministic_sequence_number: number;
  migration_mode: string | null;
}

export class GraphExecutionTraceStore {
  constructor(private pool: Pool) {}

  /**
   * Initialize trace table
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS graph_execution_events (
        id TEXT PRIMARY KEY,
        graph_revision_id TEXT NOT NULL,
        node_execution_identity_hash TEXT NOT NULL,
        transition_type TEXT NOT NULL,
        previous_state TEXT,
        new_state TEXT NOT NULL,
        policy_identity_hash TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deterministic_sequence_number INTEGER NOT NULL,
        migration_mode TEXT,
        UNIQUE(graph_revision_id, deterministic_sequence_number)
      );

      CREATE INDEX IF NOT EXISTS idx_graph_execution_events_revision 
        ON graph_execution_events(graph_revision_id);
      
      CREATE INDEX IF NOT EXISTS idx_graph_execution_events_node 
        ON graph_execution_events(node_execution_identity_hash);
      
      CREATE INDEX IF NOT EXISTS idx_graph_execution_events_sequence 
        ON graph_execution_events(graph_revision_id, deterministic_sequence_number);
    `);
  }

  /**
   * Append trace event (deterministic sequence)
   * 
   * Sequence number must be next in sequence for revision.
   * Enforces append-only semantics.
   */
  async appendEvent(event: Omit<GraphExecutionEvent, 'timestamp'>): Promise<GraphExecutionEvent> {
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const timestamp = new Date().toISOString();

    const result = await this.pool.query<DbTraceEventRow>(
      `INSERT INTO graph_execution_events (
        id,
        graph_revision_id,
        node_execution_identity_hash,
        transition_type,
        previous_state,
        new_state,
        policy_identity_hash,
        timestamp,
        deterministic_sequence_number,
        migration_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id,
        event.graphRevisionId,
        event.nodeExecutionIdentityHash,
        event.transitionType,
        event.previousState,
        event.newState,
        event.policyIdentityHash,
        timestamp,
        event.deterministicSequenceNumber,
        event.migrationMode || null,
      ]
    );

    return this.mapTraceEvent(result.rows[0]);
  }

  /**
   * Get next sequence number for revision
   */
  async getNextSequenceNumber(revisionId: string): Promise<number> {
    const result = await this.pool.query<{ max_seq: number | null }>(
      `SELECT MAX(deterministic_sequence_number) as max_seq
       FROM graph_execution_events
       WHERE graph_revision_id = $1`,
      [revisionId]
    );

    const maxSeq = result.rows[0]?.max_seq;
    return maxSeq === null ? 1 : maxSeq + 1;
  }

  /**
   * Get trace for revision (deterministically ordered)
   */
  async getTrace(revisionId: string): Promise<GraphExecutionTrace> {
    const result = await this.pool.query<DbTraceEventRow>(
      `SELECT * FROM graph_execution_events
       WHERE graph_revision_id = $1
       ORDER BY deterministic_sequence_number ASC`,
      [revisionId]
    );

    const events = result.rows.map(row => this.mapTraceEvent(row));

    return {
      revisionId,
      events,
      totalEvents: events.length,
    };
  }

  /**
   * Get trace events for specific node
   */
  async getNodeTrace(
    revisionId: string,
    nodeExecutionIdentityHash: string
  ): Promise<GraphExecutionEvent[]> {
    const result = await this.pool.query<DbTraceEventRow>(
      `SELECT * FROM graph_execution_events
       WHERE graph_revision_id = $1
         AND node_execution_identity_hash = $2
       ORDER BY deterministic_sequence_number ASC`,
      [revisionId, nodeExecutionIdentityHash]
    );

    return result.rows.map(row => this.mapTraceEvent(row));
  }

  /**
   * Get trace events by transition type
   */
  async getTraceByTransition(
    revisionId: string,
    transitionType: GraphExecutionTransitionType
  ): Promise<GraphExecutionEvent[]> {
    const result = await this.pool.query<DbTraceEventRow>(
      `SELECT * FROM graph_execution_events
       WHERE graph_revision_id = $1
         AND transition_type = $2
       ORDER BY deterministic_sequence_number ASC`,
      [revisionId, transitionType]
    );

    return result.rows.map(row => this.mapTraceEvent(row));
  }

  private mapTraceEvent(row: DbTraceEventRow): GraphExecutionEvent {
    return {
      graphRevisionId: row.graph_revision_id,
      nodeExecutionIdentityHash: row.node_execution_identity_hash,
      transitionType: row.transition_type as GraphExecutionTransitionType,
      previousState: row.previous_state,
      newState: row.new_state,
      policyIdentityHash: row.policy_identity_hash,
      timestamp: row.timestamp.toISOString(),
      deterministicSequenceNumber: row.deterministic_sequence_number,
      migrationMode: row.migration_mode || undefined,
    };
  }
}
