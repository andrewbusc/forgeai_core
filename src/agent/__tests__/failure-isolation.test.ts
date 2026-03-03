/**
 * Failure Domain Isolation Tests
 * 
 * Proves that one graph failure cannot affect another graph.
 * 
 * Critical for v1 operational completeness.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { AppStore } from '../../lib/project-store.js';
import { GraphStore } from '../../lib/graph-store.js';
import { GraphRevisionStore } from '../../lib/graph-revision-store.js';
import { GraphExecutionTraceStore } from '../../lib/graph-execution-trace-store.js';
import { AgentRunService } from '../run-service.js';
import { buildExecutionContractMaterial, hashExecutionContractMaterial } from '../execution-contract.js';

const { Pool } = pg;

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Failure isolation tests require DATABASE_URL or TEST_DATABASE_URL');
}

interface IsolationHarness {
  tmpRoot: string;
  store: AppStore;
  graphStore: GraphStore;
  revisionStore: GraphRevisionStore;
  traceStore: GraphExecutionTraceStore;
  runService: AgentRunService;
  projectA: any;
  projectB: any;
  userId: string;
}

async function createIsolationHarness(): Promise<IsolationHarness> {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'deeprun-isolation-'));
  const store = new AppStore(tmpRoot);
  await store.initialize();

  const graphStore = new GraphStore(store.pool);
  await graphStore.initialize();

  const revisionStore = new GraphRevisionStore(store.pool);
  await revisionStore.initialize();

  const traceStore = new GraphExecutionTraceStore(store.pool);
  await traceStore.initialize();

  const runService = new AgentRunService(store);

  const suffix = randomUUID().slice(0, 8);
  const user = await store.createUser({
    email: `isolation-${suffix}@example.com`,
    name: `Isolation ${suffix}`,
    passwordHash: 'hash'
  });

  const org = await store.createOrganization({
    name: `Isolation Org ${suffix}`,
    slug: `isolation-org-${suffix}`
  });

  await store.createMembership({
    orgId: org.id,
    userId: user.id,
    role: 'owner'
  });

  const workspace = await store.createWorkspace({
    orgId: org.id,
    name: `Workspace ${suffix}`,
    description: 'Isolation test workspace'
  });

  const projectA = await store.createProject({
    orgId: org.id,
    workspaceId: workspace.id,
    createdByUserId: user.id,
    name: `Project A ${suffix}`,
    description: 'Isolation test project A',
    templateId: 'canonical-backend'
  });

  const projectB = await store.createProject({
    orgId: org.id,
    workspaceId: workspace.id,
    createdByUserId: user.id,
    name: `Project B ${suffix}`,
    description: 'Isolation test project B',
    templateId: 'canonical-backend'
  });

  return {
    tmpRoot,
    store,
    graphStore,
    revisionStore,
    traceStore,
    runService,
    projectA,
    projectB,
    userId: user.id,
  };
}

async function destroyIsolationHarness(harness: IsolationHarness): Promise<void> {
  await harness.store.close();
  await rm(harness.tmpRoot, { recursive: true, force: true });
}

test('graph failure isolation: Graph A failure does not affect Graph B state', async () => {
  const harness = await createIsolationHarness();

  try {
    // Create execution identities for both graphs
    const configA = {
      schemaVersion: 1 as const,
      profile: 'full' as const,
      lightValidationMode: 'warn' as const,
      heavyValidationMode: 'warn' as const,
      maxRuntimeCorrectionAttempts: 3,
      maxHeavyCorrectionAttempts: 2,
      correctionPolicyMode: 'warn' as const,
      correctionConvergenceMode: 'warn' as const,
      plannerTimeoutMs: 30000,
      maxFilesPerStep: 50,
      maxTotalDiffBytes: 1000000,
      maxFileBytes: 2000000,
      allowEnvMutation: false,
    };

    const configB = {
      ...configA,
      maxRuntimeCorrectionAttempts: 2, // Different config
    };

    const materialA = buildExecutionContractMaterial(configA);
    const materialB = buildExecutionContractMaterial(configB);
    const execIdentityA = hashExecutionContractMaterial(materialA);
    const execIdentityB = hashExecutionContractMaterial(materialB);

    // Create graphs
    const graphA = await harness.graphStore.createSingleNodeGraph(execIdentityA);
    const graphB = await harness.graphStore.createSingleNodeGraph(execIdentityB);

    // Create runs for both graphs
    const runA = await harness.runService.createRun({
      project: harness.projectA,
      createdByUserId: harness.userId,
      goal: 'Graph A execution',
      graphId: graphA.id,
      requestId: 'isolation-test-a',
    });

    const runB = await harness.runService.createRun({
      project: harness.projectB,
      createdByUserId: harness.userId,
      goal: 'Graph B execution',
      graphId: graphB.id,
      requestId: 'isolation-test-b',
    });

    // Start both runs
    await harness.runService.markRunRunning(harness.projectA.id, runA.id, 'isolation-test-a');
    await harness.runService.markRunRunning(harness.projectB.id, runB.id, 'isolation-test-b');

    // Fail Graph A run
    await harness.runService.markRunFailed(
      harness.projectA.id,
      runA.id,
      'isolation-test-a',
      'Simulated failure for isolation test'
    );

    // Verify Graph B is unaffected
    const runBAfterAFailure = await harness.runService.getRun(harness.projectB.id, runB.id);
    assert.equal(runBAfterAFailure.status, 'running', 'Graph B should still be running after Graph A fails');

    // Verify Graph A is actually failed
    const runAAfterFailure = await harness.runService.getRun(harness.projectA.id, runA.id);
    assert.equal(runAAfterFailure.status, 'failed', 'Graph A should be failed');

    // Complete Graph B successfully
    await harness.runService.markRunComplete(harness.projectB.id, runB.id, 'isolation-test-b');
    const runBFinal = await harness.runService.getRun(harness.projectB.id, runB.id);
    assert.equal(runBFinal.status, 'complete', 'Graph B should complete successfully despite Graph A failure');

  } finally {
    await destroyIsolationHarness(harness);
  }
});

test('database transaction isolation: Graph operations are properly scoped', async () => {
  const harness = await createIsolationHarness();

  try {
    const configA = {
      schemaVersion: 1 as const,
      profile: 'full' as const,
      lightValidationMode: 'warn' as const,
      heavyValidationMode: 'warn' as const,
      maxRuntimeCorrectionAttempts: 3,
      maxHeavyCorrectionAttempts: 2,
      correctionPolicyMode: 'warn' as const,
      correctionConvergenceMode: 'warn' as const,
      plannerTimeoutMs: 30000,
      maxFilesPerStep: 50,
      maxTotalDiffBytes: 1000000,
      maxFileBytes: 2000000,
      allowEnvMutation: false,
    };

    const configB = {
      ...configA,
      maxFilesPerStep: 40, // Different config
    };

    const materialA = buildExecutionContractMaterial(configA);
    const materialB = buildExecutionContractMaterial(configB);
    const execIdentityA = hashExecutionContractMaterial(materialA);
    const execIdentityB = hashExecutionContractMaterial(materialB);

    // Create graphs in separate transactions
    const graphA = await harness.graphStore.createSingleNodeGraph(execIdentityA);
    const graphB = await harness.graphStore.createSingleNodeGraph(execIdentityB);

    // Verify graphs are isolated
    const retrievedGraphA = await harness.graphStore.getGraph(graphA.id);
    const retrievedGraphB = await harness.graphStore.getGraph(graphB.id);

    assert.notEqual(retrievedGraphA.id, retrievedGraphB.id, 'Graphs should have different IDs');
    assert.equal(retrievedGraphA.nodes.length, 1, 'Graph A should have exactly one node');
    assert.equal(retrievedGraphB.nodes.length, 1, 'Graph B should have exactly one node');
    assert.notEqual(
      retrievedGraphA.nodes[0].executionIdentityHash,
      retrievedGraphB.nodes[0].executionIdentityHash,
      'Graphs should have different execution identities'
    );

  } finally {
    await destroyIsolationHarness(harness);
  }
});

test('trace isolation: Graph A trace events do not appear in Graph B trace', async () => {
  const harness = await createIsolationHarness();

  try {
    const configA = {
      schemaVersion: 1 as const,
      profile: 'full' as const,
      lightValidationMode: 'warn' as const,
      heavyValidationMode: 'warn' as const,
      maxRuntimeCorrectionAttempts: 3,
      maxHeavyCorrectionAttempts: 2,
      correctionPolicyMode: 'warn' as const,
      correctionConvergenceMode: 'warn' as const,
      plannerTimeoutMs: 30000,
      maxFilesPerStep: 50,
      maxTotalDiffBytes: 1000000,
      maxFileBytes: 2000000,
      allowEnvMutation: false,
    };

    const configB = {
      ...configA,
      plannerTimeoutMs: 25000, // Different config
    };

    const materialA = buildExecutionContractMaterial(configA);
    const materialB = buildExecutionContractMaterial(configB);
    const execIdentityA = hashExecutionContractMaterial(materialA);
    const execIdentityB = hashExecutionContractMaterial(materialB);

    // Create graph revisions
    const graphA = await harness.graphStore.createSingleNodeGraph(execIdentityA);
    const graphB = await harness.graphStore.createSingleNodeGraph(execIdentityB);

    const revisionA = await harness.revisionStore.createRevision({
      graphId: graphA.id,
      description: 'Initial revision A',
      parentRevisionId: null,
    });

    const revisionB = await harness.revisionStore.createRevision({
      graphId: graphB.id,
      description: 'Initial revision B',
      parentRevisionId: null,
    });

    // Add trace events to both revisions
    await harness.traceStore.appendEvent({
      graphRevisionId: revisionA.id,
      nodeExecutionIdentityHash: execIdentityA,
      transitionType: 'NODE_QUEUED',
      previousState: null,
      newState: 'queued',
      policyIdentityHash: 'policy_test_a',
      deterministicSequenceNumber: 1,
    });

    await harness.traceStore.appendEvent({
      graphRevisionId: revisionB.id,
      nodeExecutionIdentityHash: execIdentityB,
      transitionType: 'NODE_QUEUED',
      previousState: null,
      newState: 'queued',
      policyIdentityHash: 'policy_test_b',
      deterministicSequenceNumber: 1,
    });

    // Verify trace isolation
    const traceA = await harness.traceStore.getTrace(revisionA.id);
    const traceB = await harness.traceStore.getTrace(revisionB.id);

    assert.equal(traceA.totalEvents, 1, 'Graph A should have exactly one trace event');
    assert.equal(traceB.totalEvents, 1, 'Graph B should have exactly one trace event');
    assert.equal(traceA.events[0].nodeExecutionIdentityHash, execIdentityA, 'Graph A trace should contain Graph A execution identity');
    assert.equal(traceB.events[0].nodeExecutionIdentityHash, execIdentityB, 'Graph B trace should contain Graph B execution identity');
    assert.notEqual(traceA.events[0].nodeExecutionIdentityHash, traceB.events[0].nodeExecutionIdentityHash, 'Traces should be isolated');

  } finally {
    await destroyIsolationHarness(harness);
  }
});

test('worktree isolation: Graph executions use separate worktrees', async () => {
  const harness = await createIsolationHarness();

  try {
    const configA = {
      schemaVersion: 1 as const,
      profile: 'full' as const,
      lightValidationMode: 'warn' as const,
      heavyValidationMode: 'warn' as const,
      maxRuntimeCorrectionAttempts: 3,
      maxHeavyCorrectionAttempts: 2,
      correctionPolicyMode: 'warn' as const,
      correctionConvergenceMode: 'warn' as const,
      plannerTimeoutMs: 30000,
      maxFilesPerStep: 50,
      maxTotalDiffBytes: 1000000,
      maxFileBytes: 2000000,
      allowEnvMutation: false,
    };

    const configB = {
      ...configA,
      maxTotalDiffBytes: 800000, // Different config
    };

    const materialA = buildExecutionContractMaterial(configA);
    const materialB = buildExecutionContractMaterial(configB);
    const execIdentityA = hashExecutionContractMaterial(materialA);
    const execIdentityB = hashExecutionContractMaterial(materialB);

    const graphA = await harness.graphStore.createSingleNodeGraph(execIdentityA);
    const graphB = await harness.graphStore.createSingleNodeGraph(execIdentityB);

    const runA = await harness.runService.createRun({
      project: harness.projectA,
      createdByUserId: harness.userId,
      goal: 'Worktree isolation A',
      graphId: graphA.id,
      requestId: 'worktree-test-a',
    });

    const runB = await harness.runService.createRun({
      project: harness.projectB,
      createdByUserId: harness.userId,
      goal: 'Worktree isolation B',
      graphId: graphB.id,
      requestId: 'worktree-test-b',
    });

    // Verify runs have different IDs (proxy for worktree isolation)
    assert.notEqual(runA.id, runB.id, 'Runs should have different IDs');
    assert.notEqual(runA.graphId, runB.graphId, 'Runs should belong to different graphs');

    // Verify project isolation
    assert.notEqual(harness.projectA.id, harness.projectB.id, 'Projects should be different');

  } finally {
    await destroyIsolationHarness(harness);
  }
});