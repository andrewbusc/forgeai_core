import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { GraphStore } from "../graph-store.js";
import { GraphRevisionStore } from "../graph-revision-store.js";
import { buildDefaultGraphPolicyDescriptor, type GraphNode } from "../../agent/graph-identity.js";
import { randomUUID } from "node:crypto";

describe("graph-revision-store", () => {
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

  describe("append-only semantics", () => {
    it("should create initial revision", async () => {
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

      expect(revision.revisionNumber).toBe(1);
      expect(revision.graphId).toBe(graph.id);
      expect(revision.parentRevisionId).toBeNull();
    });

    it("should increment revision number", async () => {
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
        parentRevisionId: rev1.id,
        createdByUserId: ids.userId
      });

      expect(rev2.revisionNumber).toBe(2);
      expect(rev2.parentRevisionId).toBe(rev1.id);
    });

    it("should recompute identity hash per revision", async () => {
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

      expect(rev1.graphIdentityHash).not.toBe(rev2.graphIdentityHash);
    });
  });

  describe("revision retrieval", () => {
    it("should retrieve latest revision", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      await revisionStore.createRevision({
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

      const latest = await revisionStore.getLatestRevision(graph.id);

      expect(latest?.id).toBe(rev2.id);
      expect(latest?.revisionNumber).toBe(2);
    });

    it("should list all revisions", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1],
        edges: [],
        createdByUserId: ids.userId
      });

      await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [node1, node2],
        edges: [],
        createdByUserId: ids.userId
      });

      const revisions = await revisionStore.listRevisions(graph.id);

      expect(revisions).toHaveLength(2);
      expect(revisions[0].revisionNumber).toBe(2);
      expect(revisions[1].revisionNumber).toBe(1);
    });
  });

  describe("replay stability", () => {
    it("should produce same identity for same structure across revisions", async () => {
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
        createdByUserId: ids.userId
      });

      expect(rev1.graphIdentityHash).toBe(rev2.graphIdentityHash);
    });
  });

  describe("lineage integrity", () => {
    it("should enforce parent belongs to same graph", async () => {
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

      await expect(
        revisionStore.createRevision({
          graphId: graph2.id,
          policyDescriptor: buildDefaultGraphPolicyDescriptor(),
          nodes: [node1],
          edges: [],
          parentRevisionId: rev1.id,
          createdByUserId: ids2.userId
        })
      ).rejects.toThrow("Parent revision must belong to same graph");
    });

    it("should verify parent exists", async () => {
      const ids = createMockIds();
      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      await expect(
        revisionStore.createRevision({
          graphId: graph.id,
          policyDescriptor: buildDefaultGraphPolicyDescriptor(),
          nodes: [node1],
          edges: [],
          parentRevisionId: randomUUID(),
          createdByUserId: ids.userId
        })
      ).rejects.toThrow("Parent revision must belong to same graph");
    });

    it("should not leak lineage into graph identity hash", async () => {
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

      expect(rev1.graphIdentityHash).toBe(rev2.graphIdentityHash);
      expect(rev1.parentRevisionId).toBeNull();
      expect(rev2.parentRevisionId).toBe(rev1.id);
    });
  });
});
