# Graph Execution Trace Primitive

## Purpose

Deterministic runtime introspection for AI orchestration kernel.

**NOT** free-form logging.  
**NOT** heuristic debug output.  
**NOT** timing-based traces.

This is **deterministic event algebra** for lifecycle transitions.

## Why This Precedes Parallelism

When parallel execution semantics are introduced, debugging becomes impossible without formal trace infrastructure.

Future parallel semantics will require:
- Conflict domain tracing
- Ordering trace
- Convergence analysis
- Branch execution trace

**Introspection is not a UX feature. It is infrastructure for future determinism.**

Without trace algebra, parallel execution becomes opaque.

## Architecture

### Trace Event Structure

```typescript
interface GraphExecutionEvent {
  graphRevisionId: string;
  nodeExecutionIdentityHash: string;
  transitionType: GraphExecutionTransitionType;
  previousState: string | null;
  newState: string;
  policyIdentityHash: string;
  timestamp: string; // ISO 8601, metadata only
  deterministicSequenceNumber: number;
  migrationMode?: string;
}
```

### Transition Types

Canonical lifecycle transitions:
- `NODE_QUEUED`
- `NODE_RUNNING`
- `NODE_CORRECTING`
- `NODE_OPTIMIZING`
- `NODE_VALIDATING`
- `NODE_COMPLETE`
- `NODE_FAILED`
- `NODE_CANCELLED`

### Deterministic Sequence Indexing

**Critical invariant**: Sequence numbers must be strictly increasing with no gaps.

Even serialized execution requires explicit ordering for future parallel semantics.

Sequence number is per-revision, starting at 1.

### Append-Only Semantics

- Events are never modified
- Events are never deleted
- Sequence numbers are unique per revision
- Database enforces `UNIQUE(graph_revision_id, deterministic_sequence_number)`

## Trace vs Identity

**Trace is part of audit layer, not identity layer.**

- Execution identity hash: defines what will execute
- Control-plane identity hash: defines authority semantics
- Graph identity hash: defines structural composition
- **Trace events: record what did execute**

Timestamp is metadata only - excluded from trace event material hashing.

## Trace Diff Primitive

Shows execution evolution between revisions:

```typescript
interface GraphExecutionTraceDiff {
  fromRevisionId: string;
  toRevisionId: string;
  eventsAdded: GraphExecutionEvent[];
  totalEventsFrom: number;
  totalEventsTo: number;
}
```

Append-only semantics mean diff is simply new events.

## Persistence Layer

### Table Schema

```sql
CREATE TABLE graph_execution_events (
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
```

### Indexes

- `idx_graph_execution_events_revision`: Query by revision
- `idx_graph_execution_events_node`: Query by node
- `idx_graph_execution_events_sequence`: Enforce ordering

## Test Coverage

### Deterministic Hashing
- ✅ Same event produces same hash
- ✅ Different events produce different hashes
- ✅ Timestamp excluded from material (metadata only)

### Ordering Validation
- ✅ Empty trace valid
- ✅ Correct sequence valid
- ✅ Detects sequence gaps
- ✅ Detects duplicate sequence numbers
- ✅ Detects mixed revision IDs

### Append-Only Semantics
- ✅ Events appended with deterministic sequence
- ✅ Unique sequence numbers enforced per revision
- ✅ Next sequence number calculated correctly

### Trace Diff
- ✅ Computes diff between revisions
- ✅ Handles empty diff (no new events)

### Replay Determinism
- ✅ 100-iteration replay produces identical trace hash

## Strategic Value

### Current State
You have:
- Execution identity
- Graph identity
- Policy descriptor hashing
- Revision algebra
- Migration algebra
- Governance v1
- Structural diff
- **Trace primitive** ← NEW

### What This Enables (Future)
- Policy-aware trace validation
- Trace replay for debugging
- Convergence analysis for parallel execution
- Conflict domain detection
- Branch execution introspection

### What This Does NOT Enable (Intentionally)
- Multi-node parallel execution (not yet)
- Planner auto-branching (not yet)
- Agent concurrency (not yet)
- Policy complexity increase (not yet)
- Runtime optimization (not yet)

## Architectural Trajectory

You are building:
**A deterministic, identity-bound AI orchestration kernel.**

You are no longer building:
- A CI plugin
- An AI wrapper

This system is becoming:
**A content-addressed execution control plane.**

## Discipline Maintained

Pattern: **Identity → Replay → Drift → Stress → Feature**

Applied at:
- ✅ Execution contract layer
- ✅ Control-plane layer
- ✅ Graph layer
- ✅ Revision layer
- ✅ **Trace layer** ← NEW

## Next Moves (Narrow)

Continue observability hardening:

1. ✅ Graph Execution Trace Primitive
2. ⏭️ Policy-Aware Trace Validation
3. ⏭️ Trace Replay Endpoint
4. ⏭️ Governance Decision Trace
5. ⏭️ Migration Audit Trail

**No execution widening yet.**

Seal observability algebra first.

## Mental Model Shift

**Introspection is not logging.**

**It is deterministic event algebra.**

That distinction matters.
