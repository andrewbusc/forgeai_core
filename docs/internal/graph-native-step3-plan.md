# Step 3: Enforce Graph-Native Constraint - Implementation Plan

## Goal
Every run must belong to a graph. Eliminate standalone run execution paths.

## Changes Required

### 1. Database Schema
- Add `graph_id UUID NOT NULL REFERENCES execution_graphs(id)` to `agent_lifecycle_runs` table
- Add `graph_id UUID NOT NULL REFERENCES execution_graphs(id)` to `agent_runs` table

### 2. GraphStore Integration
- Expose `pool` in AppStore OR pass GraphStore to services that need it
- Add `createSingleNodeGraph()` helper (DONE)

### 3. Run Creation Flow
- Before creating run, create single-node graph
- Pass `graphId` to run creation
- Update `CreateStateRunInput` to require `graphId` (DONE)
- Update `AgentRunService.createRun()` to pass graphId (DONE)

### 4. Update All Run Creation Call Sites
- `POST /api/projects/:projectId/agent/state-runs` - create graph first
- AgentKernel run creation paths - create graph first
- Bootstrap backend flow - create graph first

### 5. Type Updates
- Add `graphId` to `AgentLifecycleRun` type
- Add `graphId` to `AgentRun` type

## Implementation Strategy
1. Add graphId column to database tables
2. Expose pool or pass GraphStore to services
3. Update run creation to create graph first
4. Update all call sites
5. Add tests

## Minimal Changes
- Focus on state machine runs first (simpler)
- Then update kernel runs
- Maintain backward compatibility during transition
