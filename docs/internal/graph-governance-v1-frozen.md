# Graph Governance v1 - FROZEN

## Version
`GRAPH_GOVERNANCE_VERSION = 1`

## Frozen Semantics

### PASS Criteria (Immutable)
Graph passes if and only if:
1. All nodes VALID: `run.status === "complete" && run.errorMessage === null`
2. All structural invariants satisfied:
   - `all_nodes_have_runs`: At least one run exists
   - `graph_not_empty`: Graph status !== "failed"

### Decision Structure (Immutable)
```typescript
interface GraphGovernanceDecision {
  graphId: string;
  governanceVersion: 1;
  verdict: "PASS" | "FAIL";
  reason: string;
  nodeValidations: Array<{runId, valid, reason}>;
  structuralInvariants: Array<{check, passed, reason}>;
  decidedAt: string;
}
```

### What v1 Does NOT Include
- ❌ Scheduling logic
- ❌ Parallelism decisions
- ❌ Optimization strategies
- ❌ Resource allocation
- ❌ Retry policies
- ❌ Timeout enforcement
- ❌ Cost optimization
- ❌ Performance tuning

### Determinism Guarantees
- Same graph + same runs → same verdict
- No hidden state
- No time-dependent logic
- No external dependencies
- Pure projection

### Replay Contract
```typescript
const decision1 = buildGraphGovernanceDecision({ graph, runs });
const decision2 = buildGraphGovernanceDecision({ graph, runs });

assert(decision1.verdict === decision2.verdict);
assert(decision1.governanceVersion === decision2.governanceVersion);
assert(decision1.nodeValidations === decision2.nodeValidations);
```

## Expansion Rules

### Before v2 Can Be Considered
Must have:
- ✅ v1 frozen and sealed
- ✅ v1 replay tests passing
- ✅ v1 drift tests passing
- ✅ v1 stress tests passing
- ✅ Revision algebra sealed
- ✅ Migration protocol proven

### v2 Expansion Candidates (Not Yet)
Potential future additions:
- Parallelism policy enforcement
- Resource constraint validation
- Timeout policy checks
- Retry strategy validation
- Cost threshold enforcement

### Expansion Protocol
When v2 is considered:
1. Create `GRAPH_GOVERNANCE_VERSION = 2`
2. New decision structure with version field
3. Replay tests for v1 → v2 migration
4. Stress tests for mixed v1/v2 graphs
5. Drift tests for version stability

## Test Coverage Requirements

### Replay Tests ✅
- Identical inputs → identical decisions
- Snapshot replay stability
- Revision migration replay
- Multi-iteration determinism

### Drift Tests (TODO)
- Frozen baseline hash
- Version coupling stability
- Structure validation
- Time-based stability

### Stress Tests (TODO)
- High node count (100+ nodes)
- Mixed valid/invalid nodes
- Concurrent decision requests
- Policy version mixing

## Immutability Contract

### Cannot Change in v1
- PASS criteria logic
- Decision structure fields
- Governance version number
- Determinism guarantees
- Replay contract

### Can Change (Non-Breaking)
- Error message formatting
- Logging/telemetry
- Performance optimizations
- Internal implementation details

## Seal Date
**2024-01-XX** (When drift + stress tests pass)

Until sealed:
- No execution engine expansion
- No multi-node orchestration
- No dynamic graph mutation
- No scheduling features

## Verification Checklist

Before unsealing for expansion:
- [ ] All replay tests passing
- [ ] Drift tests implemented and passing
- [ ] Stress tests implemented and passing
- [ ] Revision algebra sealed
- [ ] Migration protocol proven
- [ ] Documentation complete
- [ ] Baseline hash frozen

## Authority
This document defines the immutable contract for Graph Governance v1.

Any deviation requires:
1. Version increment to v2
2. Migration path definition
3. Replay test coverage
4. Explicit approval

**Status**: FROZEN (pending drift + stress tests)
