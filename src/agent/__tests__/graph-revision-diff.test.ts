import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { GraphStore } from "../../lib/graph-store.js";
import { GraphRevisionStore } from "../../lib/graph-revision-store.js";
import { buildGraphRevisionDiff } from "../graph-revision-diff.js";
import { buildDefaultGraphPolicyDescriptor, type GraphNode, type GraphEdge } from "../graph-identity.js";
import { randomUUID } from "node:crypto";

describe("graph-revision-diff", () => {
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

  const node3: GraphNode = {
    runId: randomUUID(),
    executionIdentityHash: "c".repeat(64)
  };

  describe("deterministic diff", () => {
    it("should produce identical diff for same revisions", async () => {
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

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2],
        edges: [],
        createdByUserId: ids.userId
      });

      const diff1 = buildGraphRevisionDiff({
        fromRevision: rev1,
        toRevision: rev2,
        fromNodes: [node1],
        toNodes: [node1, node2],
        fromEdges: [],
        toEdges: []
      });

      const diff2 = buildGraphRevisionDiff({
        fromRevision: rev1,
        toRevision: rev2,
        fromNodes: [node1],
        toNodes: [node1, node2],
        fromEdges: [],
        toEdges: []
      });

      expect(diff1).toEqual(diff2);
    });

    it("should detect nodes added", async () => {
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

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2, node3],
        edges: [],
        createdByUserId: ids.userId
      });

      const diff = buildGraphRevisionDiff({
        fromRevision: rev1,
        toRevision: rev2,
        fromNodes: [node1],
        toNodes: [node1, node2, node3],
        fromEdges: [],
        toEdges: []
      });

      expect(diff.nodesAdded).toEqual([node2.executionIdentityHash, node3.executionIdentityHash].sort());
      expect(diff.nodesRemoved).toEqual([]);
    });

    it("should detect nodes removed", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1, node2, node3],
        edges: []
      });

      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2, node3],
        edges: [],
        createdByUserId: ids.userId
      });

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      const diff = buildGraphRevisionDiff({
        fromRevision: rev1,
        toRevision: rev2,
        fromNodes: [node1, node2, node3],
        toNodes: [node1],
        fromEdges: [],
        toEdges: []
      });

      expect(diff.nodesRemoved).toEqual([node2.executionIdentityHash, node3.executionIdentityHash].sort());
      expect(diff.nodesAdded).toEqual([]);
    });

    it("should detect edges added", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1, node2],
        edges: []
      });

      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2],
        edges: [],
        createdByUserId: ids.userId
      });

      const edge: GraphEdge = { fromRunId: node1.runId, toRunId: node2.runId };

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2],
        edges: [edge],
        createdByUserId: ids.userId
      });

      const diff = buildGraphRevisionDiff({
        fromRevision: rev1,
        toRevision: rev2,
        fromNodes: [node1, node2],
        toNodes: [node1, node2],
        fromEdges: [],
        toEdges: [edge]
      });

      expect(diff.edgesAdded).toEqual([[node1.executionIdentityHash, node2.executionIdentityHash]]);
      expect(diff.edgesRemoved).toEqual([]);
    });

    it("should detect policy descriptor changes", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      const policy1 = buildDefaultGraphPolicyDescriptor();
      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy1,
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      const policy2 = { ...policy1, maxConcurrentNodes: 10 };
      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy2,
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      const diff = buildGraphRevisionDiff({
        fromRevision: rev1,
        toRevision: rev2,
        fromNodes: [node1],
        toNodes: [node1],
        fromEdges: [],
        toEdges: []
      });

      expect(diff.policyDescriptorChanged).toBe(true);
      expect(diff.identityHashChanged).toBe(true);
    });
  });

  describe("structural diff only", () => {
    it("should not include instance state", async () => {
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

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2],
        edges: [],
        createdByUserId: ids.userId
      });

      const diff = buildGraphRevisionDiff({
        fromRevision: rev1,
        toRevision: rev2,
        fromNodes: [node1],
        toNodes: [node1, node2],
        fromEdges: [],
        toEdges: []
      });

      expect(diff).not.toHaveProperty("runStatus");
      expect(diff).not.toHaveProperty("runErrors");
      expect(diff).not.toHaveProperty("timestamps");
      expect(diff).toHaveProperty("nodesAdded");
      expect(diff).toHaveProperty("nodesRemoved");
      expect(diff).toHaveProperty("edgesAdded");
      expect(diff).toHaveProperty("edgesRemoved");
    });
  });

  describe("replay stability", () => {
    it("should produce identical diff across 100 iterations", async () => {
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

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2],
        edges: [],
        createdByUserId: ids.userId
      });

      const diffs = Array.from({ length: 100 }, () =>
        buildGraphRevisionDiff({
          fromRevision: rev1,
          toRevision: rev2,
          fromNodes: [node1],
          toNodes: [node1, node2],
          fromEdges: [],
          toEdges: []
        })
      );

      const firstDiff = diffs[0];
      expect(diffs.every(d => JSON.stringify(d) === JSON.stringify(firstDiff))).toBe(true);
    });
  });

  describe("validation", () => {
    it("should reject cross-graph diff", async () => {
      const ids1 = createMockIds();
      const ids2 = createMockIds();

      const graph1 = await graphStore.createExecutionGraph({
        projectId: ids1.projectId,
        orgId: ids1.orgId,
        workspaceId: ids1.workspaceId,
        createdByUserId: ids1.userId,
        nodes: [node1],
        edges: []
      });

      const graph2 = await graphStore.createExecutionGraph({
        projectId: ids2.projectId,
        orgId: ids2.orgId,
        workspaceId: ids2.workspaceId,
        createdByUserId: ids2.userId,
        nodes: [node1],
        edges: []
      });

      const rev1 = await revisionStore.createRevision({
        graphId: graph1.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1],
        edges: [],
        createdByUserId: ids1.userId
      });

      const rev2 = await revisionStore.createRevision({
        graphId: graph2.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1],
        edges: [],
        createdByUserId: ids2.userId
      });

      expect(() =>
        buildGraphRevisionDiff({
          fromRevision: rev1,
          toRevision: rev2,
          fromNodes: [node1],
          toNodes: [node1],
          fromEdges: [],
          toEdges: []
        })
      ).toThrow("Revisions must belong to same graph");
    });
  });
});
