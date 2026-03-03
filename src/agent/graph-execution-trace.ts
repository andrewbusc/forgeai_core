/**
 * Graph Execution Trace Primitive
 * 
 * Deterministic execution trace artifacts for runtime introspection.
 * 
 * NOT free-form logging.
 * NOT heuristic debug output.
 * NOT timing-based traces.
 * 
 * This is append-only, persisted, replayable, deterministically ordered event algebra.
 * 
 * Trace is part of audit layer, not identity layer.
 */

import crypto from 'node:crypto';

/**
 * Transition types for lifecycle state changes
 */
export type GraphExecutionTransitionType =
  | 'NODE_QUEUED'
  | 'NODE_RUNNING'
  | 'NODE_CORRECTING'
  | 'NODE_OPTIMIZING'
  | 'NODE_VALIDATING'
  | 'NODE_COMPLETE'
  | 'NODE_FAILED'
  | 'NODE_CANCELLED';

/**
 * Graph execution event - deterministic trace record
 */
export interface GraphExecutionEvent {
  graphRevisionId: string;
  nodeExecutionIdentityHash: string;
  transitionType: GraphExecutionTransitionType;
  previousState: string | null;
  newState: string;
  policyIdentityHash: string;
  timestamp: string; // ISO 8601, metadata only
  deterministicSequenceNumber: number;
  migrationMode?: string; // optional migration context
}

/**
 * Trace query result
 */
export interface GraphExecutionTrace {
  revisionId: string;
  events: GraphExecutionEvent[];
  totalEvents: number;
}

/**
 * Build deterministic trace event material for hashing
 * 
 * Used for trace integrity verification, not identity.
 */
export function buildTraceEventMaterial(event: Omit<GraphExecutionEvent, 'timestamp'>): string {
  const material = {
    graphRevisionId: event.graphRevisionId,
    nodeExecutionIdentityHash: event.nodeExecutionIdentityHash,
    transitionType: event.transitionType,
    previousState: event.previousState,
    newState: event.newState,
    policyIdentityHash: event.policyIdentityHash,
    deterministicSequenceNumber: event.deterministicSequenceNumber,
    migrationMode: event.migrationMode || null,
  };
  return JSON.stringify(material);
}

/**
 * Hash trace event material for integrity verification
 */
export function hashTraceEventMaterial(material: string): string {
  return crypto.createHash('sha256').update(material).digest('hex');
}

/**
 * Validate trace event deterministic ordering
 * 
 * Ensures sequence numbers are strictly increasing with no gaps.
 */
export function validateTraceOrdering(events: GraphExecutionEvent[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (events.length === 0) {
    return { valid: true, errors: [] };
  }

  // Sort by sequence number
  const sorted = [...events].sort((a, b) => 
    a.deterministicSequenceNumber - b.deterministicSequenceNumber
  );

  // Check for gaps and duplicates
  for (let i = 0; i < sorted.length; i++) {
    const expected = i + 1;
    const actual = sorted[i].deterministicSequenceNumber;
    
    if (actual !== expected) {
      errors.push(
        `Sequence gap or duplicate at index ${i}: expected ${expected}, got ${actual}`
      );
    }
  }

  // Check revision consistency
  const revisionIds = new Set(events.map(e => e.graphRevisionId));
  if (revisionIds.size > 1) {
    errors.push(
      `Multiple revision IDs in trace: ${Array.from(revisionIds).join(', ')}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Build trace diff between two revisions
 * 
 * Shows execution evolution, not structural evolution.
 */
export interface GraphExecutionTraceDiff {
  fromRevisionId: string;
  toRevisionId: string;
  eventsAdded: GraphExecutionEvent[];
  totalEventsFrom: number;
  totalEventsTo: number;
}

export function buildGraphExecutionTraceDiff(
  fromTrace: GraphExecutionTrace,
  toTrace: GraphExecutionTrace
): GraphExecutionTraceDiff {
  // Events are append-only, so diff is just new events
  const fromSequenceNumbers = new Set(
    fromTrace.events.map(e => e.deterministicSequenceNumber)
  );
  
  const eventsAdded = toTrace.events
    .filter(e => !fromSequenceNumbers.has(e.deterministicSequenceNumber))
    .sort((a, b) => a.deterministicSequenceNumber - b.deterministicSequenceNumber);

  return {
    fromRevisionId: fromTrace.revisionId,
    toRevisionId: toTrace.revisionId,
    eventsAdded,
    totalEventsFrom: fromTrace.totalEvents,
    totalEventsTo: toTrace.totalEvents,
  };
}
