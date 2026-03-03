# Step 3: Enforce Graph-Native Constraint - Implementation Summary

## Completed Changes

### 1. Database Schema
- Added `graph_id UUID REFERENCES execution_graphs(id)` column to `agent_runs` table
- Added index `idx_agent_runs_graph_id` for graph lookups
- Column is nullable initially for backward compatibility

### 2. Type System Updates
- Added `graphId: string` to `AgentLifecycleRun` interface
- Added `graphId: string` to `CreateLifecycleRunInput` interface
- Added `graphId: string` to `DbLifecycleRunRow` interface
- Updated `mapLifecycleRun()` to map `graph_id` column

### 3. GraphStore Integration
- Made `AppStore.pool` public (changed from private)
- Added `createSingleNodeGraph()` helper method to GraphStore
- Instantiated GraphStore in server.ts with shared pool
- Added `graphStore.initializeSchema()` call in server startup

### 4. Run Creation Flow
- Updated `CreateStateRunInput` to require `graphId` parameter
- Updated `AgentRunService.createRun()` to accept and pass `graphId`
- Updated `createLifecycleRun()` SQL to include `graph_id` column
- Updated `lifecycleRunSelectColumns` to include `graph_id`

### 5. API Endpoint Updates
- `POST /api/projects/:projectId/agent/state-runs`:
  - Creates single-node graph before creating run
  - Passes `graphId` to run creation
  - Uses placeholder `executionIdentityHash: "pending"` (will be computed later)

## Architecture Impact

### Graph-Native Constraint Enforced
Every run now belongs to a graph. Single runs are represented as graphs with one node and zero edges.

### Identity Flow
1. Graph created with placeholder identity hash
2. Run created with reference to graph
3. Run executes and computes actual execution identity
4. Graph node can be updated with real identity hash (future enhancement)

### Backward Compatibility
- `graph_id` column is nullable to support existing runs
- After migration, can be made NOT NULL with: `ALTER TABLE agent_runs ALTER COLUMN graph_id SET NOT NULL;`

## Files Modified

1. `src/lib/graph-store.ts` - Added `createSingleNodeGraph()` helper
2. `src/lib/project-store.ts` - Made pool public, added graph_id to schema and queries
3. `src/agent/run-state-types.ts` - Added graphId to interfaces
4. `src/agent/run-service.ts` - Added graphId parameter to createRun
5. `src/server.ts` - Integrated GraphStore, create graph before run

## Files Created

1. `docs/migration-add-graph-id.md` - SQL migration documentation
2. `docs/graph-native-step3-plan.md` - Implementation plan
3. `docs/graph-native-step3-summary.md` - This file

## Testing Status

- **Manual Testing Required**: Start server and create a state run via API
- **Integration Tests**: Need to update existing tests to provide graphId
- **Schema Migration**: Run on existing database to add column

## Next Steps

### Immediate
1. Test run creation flow end-to-end
2. Update existing tests to handle graphId requirement
3. Verify graph and run are created atomically

### Future Enhancements
1. Compute real execution identity hash after run completes
2. Update graph node with actual identity hash
3. Extend to kernel runs (agent_runs with provider_id != 'state-machine')
4. Add graph-level status tracking
5. Implement multi-node graphs for parallel execution
6. Add graph visualization endpoints

## Known Limitations

1. **Placeholder Identity**: Using `"pending"` as executionIdentityHash during graph creation
   - Should be computed from execution contract after run is created
   - Requires integration with execution-contract.ts

2. **State Machine Runs Only**: Only implemented for lifecycle runs
   - Kernel runs (via AgentKernel) not yet updated
   - Bootstrap, generate, chat endpoints still use old flow

3. **No Graph Status Sync**: Graph status not automatically updated based on run status
   - Graph remains in "created" status
   - Should transition to "running" → "complete"/"failed" based on run

4. **Single Tenant**: One run per graph only
   - Multi-node graphs not yet supported in run creation flow
   - Edge creation not exposed via API

## Migration Path

### Phase 1: State Machine Runs (DONE)
- ✅ Add graph_id column
- ✅ Create graph before state run
- ✅ Update types and interfaces

### Phase 2: Kernel Runs (TODO)
- Update AgentKernel.startRun() to create graph
- Update AgentKernel.queueRun() to create graph
- Update bootstrap endpoint
- Update generate/chat endpoints

### Phase 3: Identity Integration (TODO)
- Compute execution identity hash from contract
- Update graph node with real identity after run creation
- Remove "pending" placeholder

### Phase 4: Graph Operations (TODO)
- Add API endpoints for graph queries
- Implement graph status synchronization
- Support multi-node graph creation
- Add graph forking/branching

## Success Criteria

- [x] Every new state run has a graph_id
- [x] Graph is created before run
- [x] Graph has correct project/org/workspace references
- [x] Run references graph via foreign key
- [ ] Tests pass with new schema
- [ ] Server boots and creates runs successfully
- [ ] Graph identity hash is deterministic
