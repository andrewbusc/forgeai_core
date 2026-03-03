# Failure Isolation Guarantees

## Purpose

DeepRun v1 guarantees that one graph failure cannot affect another graph's execution.

This is critical for operational safety in production environments.

## Isolation Boundaries

### 1. Graph State Isolation

**Guarantee**: Graph A failure cannot corrupt Graph B state.

**Implementation**:
- Each graph has unique identity hash
- Database transactions are scoped per graph
- No shared mutable state between graphs
- Graph revisions are append-only per graph

**Test Coverage**: `src/agent/__tests__/failure-isolation.test.ts`

### 2. Execution Worktree Isolation

**Guarantee**: Graph executions use separate worktrees.

**Implementation**:
- Each run gets isolated worktree: `.deeprun/worktrees/<runId>`
- Git branches are scoped per run: `run/<runId>`
- File system mutations are isolated per worktree
- No cross-worktree file access

**Test Coverage**: Worktree path verification in isolation tests

### 3. Database Transaction Isolation

**Guarantee**: Graph operations are properly scoped.

**Implementation**:
- Graph creation uses separate transactions
- Run state updates are atomic per run
- Trace events are scoped per graph revision
- No cross-graph foreign key dependencies

**Test Coverage**: Transaction isolation verification

### 4. Trace Event Isolation

**Guarantee**: Graph A trace events do not appear in Graph B trace.

**Implementation**:
- Trace events are scoped by `graph_revision_id`
- Deterministic sequence numbers are per-revision
- No cross-revision trace contamination
- Query isolation enforced at database level

**Test Coverage**: Trace isolation verification

## Resource Boundaries

### Timeout Limits

- **Run Timeout**: `AGENT_RUN_TIMEOUT_MS` (default: 1 hour)
- **Step Timeout**: `AGENT_STEP_TIMEOUT_MS` (default: 5 minutes)

### Memory Limits

- **Max Memory**: `AGENT_MAX_MEMORY_MB` (default: 2GB)
- **Memory Monitoring**: Heap usage checked per step

### Retry Limits

- **Max Retries**: `AGENT_MAX_RETRIES` (default: 3)
- **Bounded Corrections**: Already enforced via correction policies

## Abort Semantics

When resource boundaries are exceeded:

1. **Timeout Abort**: Run marked as `failed` with timeout reason
2. **Memory Abort**: Run marked as `failed` with memory reason  
3. **Retry Abort**: Run marked as `failed` with retry exhaustion reason

All aborts produce deterministic trace events.

## Failure Classification

Failures are classified and isolated:

- **Syntax Errors**: Isolated to single run
- **Validation Errors**: Isolated to single run
- **Runtime Errors**: Isolated to single run
- **Resource Exhaustion**: Isolated to single run
- **Infrastructure Errors**: May affect multiple runs (database, disk)

Only infrastructure errors can cross graph boundaries.

## Operational Safety

### What Is Guaranteed

✅ Graph A failure cannot corrupt Graph B  
✅ Worktree isolation prevents cross-contamination  
✅ Database transactions are properly scoped  
✅ Trace events are isolated per graph  
✅ Resource boundaries prevent runaway execution  
✅ Abort semantics are deterministic  

### What Is NOT Guaranteed

❌ Infrastructure failure isolation (database down affects all)  
❌ Host resource exhaustion (disk full affects all)  
❌ Network partition tolerance  
❌ Distributed system semantics  

## Test Verification

Run isolation tests:

```bash
npx tsx -r dotenv/config --test src/agent/__tests__/failure-isolation.test.ts
npx tsx -r dotenv/config --test src/agent/__tests__/resource-boundaries.test.ts
```

All tests must pass for v1 operational completeness.

## Environment Configuration

```bash
# Resource boundaries (optional)
AGENT_RUN_TIMEOUT_MS=3600000      # 1 hour
AGENT_STEP_TIMEOUT_MS=300000      # 5 minutes  
AGENT_MAX_MEMORY_MB=2048          # 2GB
AGENT_MAX_RETRIES=3               # 3 retries

# Correction policies (already configured)
AGENT_GOAL_MAX_CORRECTIONS=5
AGENT_OPTIMIZATION_MAX_CORRECTIONS=3
AGENT_HEAVY_MAX_CORRECTIONS=2
```

## Monitoring

Resource boundary violations are logged as structured events:

```json
{
  "type": "resource_boundary_violation",
  "boundaryType": "timeout|memory|retries",
  "runId": "run_123",
  "stepIndex": 5,
  "limit": 1000,
  "actual": 2000,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## V1 Readiness Criteria

- ✅ Failure isolation tests pass
- ✅ Resource boundaries enforced  
- ✅ Abort semantics documented
- ✅ Monitoring events structured
- ✅ Environment configuration validated

**Failure isolation is sealed for v1.**