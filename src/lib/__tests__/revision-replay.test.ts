import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { GraphStore } from "../graph-store.js";
import { GraphRevisionStore } from "../graph-revision-store.js";
import { buildGraphGovernanceDecision } from "../../agent/graph-governance.js";
import { buildDefaultGraphPolicyDescriptor, type GraphNode } from "../../agent/graph-identity.js";
import { AgentLifecycleRun } from "../../agent/run-state-types.js";
import { randomUUID } from "node:crypto";

describe("revision-replay", () => {
  let pool: Pool;
  let graphStore: GraphStore;
  let revisionStore: GraphRevisionStore;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL required for tests");
    }

    pool = new Pool({ connectionString: databaseUrl });
    graphStore = new GraphStore(pool);
    revisionStore = new GraphRevisionStore(pool);
    
    await graphStore.initializeSchema();
    await revisionStore.initializeSchema();
  });

  afterAll(async () => {
    await pool.end();
  });

  const createMockIds = () => ({
    projectId: randomUUID(),
    orgId: randomUUID(),
    workspaceId: randomUUID(),
    userId: randomUUID()
  });

  const node1: GraphNode = {
    runId: randomUUID(),
    executionIdentityHash: "a".repeat(64)
  };

  const node2: GraphNode = {
    runId: randomUUID(),
    executionIdentityHash: "b".repeat(64)
  };

  describe("snapshot replay", () => {
    it("should produce identical decision from revision snapshot", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      const revision = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      const mockRun: AgentLifecycleRun = {
        id: node1.runId,
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        graphId: graph.id,
        goal: "test",
        phase: "goal",
        status: "complete",
        stepIndex: 5,
        correctionsUsed: 0,
        optimizationStepsUsed: 0,
        maxSteps: 20,
        maxCorrections: 2,
        maxOptimizations: 2,
        errorMessage: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z"
      };

      const decision1 = buildGraphGovernanceDecision({ graph, runs: [mockRun] });
      const decision2 = buildGraphGovernanceDecision({ graph, runs: [mockRun] });

      expect(decision1.verdict).toBe(decision2.verdict);
      expect(decision1.governanceVersion).toBe(decision2.governanceVersion);
      expect(decision1.graphId).toBe(graph.id);
    });

    it("should replay decision after revision migration", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      const mockRun: AgentLifecycleRun = {
        id: node1.runId,
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        graphId: graph.id,
        goal: "test",
        phase: "goal",
        status: "complete",
        stepIndex: 5,
        correctionsUsed: 0,
        optimizationStepsUsed: 0,
        maxSteps: 20,
        maxCorrections: 2,
        maxOptimizations: 2,
        errorMessage: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z"
      };

      const decisionAtRev1 = buildGraphGovernanceDecision({ graph, runs: [mockRun] });

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2],
        edges: [],
        parentRevisionId: rev1.id,
        createdByUserId: ids.userId
      });

      const decisionAfterMigration = buildGraphGovernanceDecision({ graph, runs: [mockRun] });

      expect(decisionAtRev1.verdict).toBe(decisionAfterMigration.verdict);
      expect(decisionAtRev1.governanceVersion).toBe(decisionAfterMigration.governanceVersion);
    });
  });

  describe("determinism across revisions", () => {
    it("should produce identical decision for same revision replayed", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      const revision = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      const mockRun: AgentLifecycleRun = {
        id: node1.runId,
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        graphId: graph.id,
        goal: "test",
        phase: "goal",
        status: "complete",
        stepIndex: 5,
        correctionsUsed: 0,
        optimizationStepsUsed: 0,
        maxSteps: 20,
        maxCorrections: 2,
        maxOptimizations: 2,
        errorMessage: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z"
      };

      const decisions = Array.from({ length: 10 }, () =>
        buildGraphGovernanceDecision({ graph, runs: [mockRun] })
      );

      const firstVerdict = decisions[0].verdict;
      expect(decisions.every(d => d.verdict === firstVerdict)).toBe(true);
      expect(decisions.every(d => d.governanceVersion === decisions[0].governanceVersion)).toBe(true);
    });

    it("should maintain identity stability across revision chain", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      const policy = buildDefaultGraphPolicyDescriptor();

      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy,
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy,
        nodes: [node1],
        edges: [],
        parentRevisionId: rev1.id,
        createdByUserId: ids.userId
      });

      const rev3 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy,
        nodes: [node1],
        edges: [],
        parentRevisionId: rev2.id,
        createdByUserId: ids.userId
      });

      expect(rev1.graphIdentityHash).toBe(rev2.graphIdentityHash);
      expect(rev2.graphIdentityHash).toBe(rev3.graphIdentityHash);
    });
  });
});
