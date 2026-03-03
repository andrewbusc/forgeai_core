# Step 5: Remove Execution Identity Placeholder - Implementation Plan

## Problem
Currently using `executionIdentityHash: "pending"` when creating graph before run.

## Solution
Compute execution identity BEFORE graph creation:

1. Build execution contract material from run parameters
2. Hash to get execution identity
3. Create graph with real identity
4. Create run with graph reference

## For State Machine Runs
State runs use simplified execution config:
- No provider/model (uses "state-machine" provider)
- Fixed policy versions
- Deterministic from: goal, maxSteps, maxCorrections, maxOptimizations

## Implementation
Add `buildStateRunExecutionIdentity()` helper that:
- Takes run parameters (goal, limits)
- Builds minimal execution contract
- Returns identity hash

## Kernel Rule
**No provisional identity allowed**
- Graph insertion waits for finalized identity
- Identity cannot be "pending" or placeholder
- If identity depends on later computation, graph insertion must wait
