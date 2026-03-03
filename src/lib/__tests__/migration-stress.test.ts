import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { GraphStore } from "../graph-store.js";
import { GraphRevisionStore } from "../graph-revision-store.js";
import { buildDefaultGraphPolicyDescriptor, type GraphNode, type GraphEdge } from "../../agent/graph-identity.js";
import { randomUUID } from "node:crypto";

describe("migration-stress", () => {
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

  const createNode = (): GraphNode => ({
    runId: randomUUID(),
    executionIdentityHash: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")
  });

  describe("mixed eligible/ineligible nodes", () => {
    it("should handle partial node updates atomically", async () => {
      const ids = createMockIds();
      const nodes = Array.from({ length: 5 }, createNode);

      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes,
        edges: []
      });

      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes,
        edges: [],
        createdByUserId: ids.userId
      });

      const updatedNodes = [...nodes.slice(0, 3), createNode(), createNode()];

      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: updatedNodes,
        edges: [],
        parentRevisionId: rev1.id,
        createdByUserId: ids.userId
      });

      expect(rev2.revisionNumber).toBe(2);
      expect(rev2.graphIdentityHash).not.toBe(rev1.graphIdentityHash);
    });

    it("should reject invalid node identity", async () => {
      const ids = createMockIds();
      const validNode = createNode();

      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [validNode],
        edges: []
      });

      const invalidNode: GraphNode = {
        runId: randomUUID(),
        executionIdentityHash: "invalid"
      };

      await expect(
        revisionStore.createRevision({
          graphId: graph.id,
          policyDescriptor: buildDefaultGraphPolicyDescriptor(),
          nodes: [invalidNode],
          edges: [],
          createdByUserId: ids.userId
        })
      ).rejects.toThrow();
    });
  });

  describe("policy change stress", () => {
    it("should handle policy descriptor changes", async () => {
      const ids = createMockIds();
      const node = createNode();

      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node],
        edges: []
      });

      const policy1 = buildDefaultGraphPolicyDescriptor();
      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy1,
        nodes: [node],
        edges: [],
        createdByUserId: ids.userId
      });

      const policy2 = { ...policy1, maxConcurrentNodes: 10 };
      const rev2 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy2,
        nodes: [node],
        edges: [],
        parentRevisionId: rev1.id,
        createdByUserId: ids.userId
      });

      expect(rev1.graphIdentityHash).not.toBe(rev2.graphIdentityHash);
      expect(rev2.graphPolicyDescriptor.maxConcurrentNodes).toBe(10);
    });

    it("should maintain atomicity under concurrent policy changes", async () => {
      const ids = createMockIds();
      const node = createNode();

      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node],
        edges: []
      });

      const policy = buildDefaultGraphPolicyDescriptor();
      const rev1 = await revisionStore.createRevision({
        graphId: graph.id,
        policyDescriptor: policy,
        nodes: [node],
        edges: [],
        createdByUserId: ids.userId
      });

      const revisions = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          revisionStore.createRevision({
            graphId: graph.id,
            policyDescriptor: { ...policy, maxConcurrentNodes: i + 2 },
            nodes: [node],
            edges: [],
            parentRevisionId: rev1.id,
            createdByUserId: ids.userId
          })
        )
      );

      expect(revisions).toHaveLength(5);
      expect(new Set(revisions.map(r => r.revisionNumber)).size).toBe(5);
    });
  });

  describe("rejection protocol", () => {
    it("should reject cross-graph parent reference", async () => {
      const ids1 = createMockIds();
      const ids2 = createMockIds();

      const graph1 = await graphStore.createExecutionGraph({
        projectId: ids1.projectId,
        orgId: ids1.orgId,
        workspaceId: ids1.workspaceId,
        createdByUserId: ids1.userId,
        nodes: [createNode()],
        edges: []
      });

      const graph2 = await graphStore.createExecutionGraph({
        projectId: ids2.projectId,
        orgId: ids2.orgId,
        workspaceId: ids2.workspaceId,
        createdByUserId: ids2.userId,
        nodes: [createNode()],
        edges: []
      });

      const rev1 = await revisionStore.createRevision({
        graphId: graph1.id,
        policyDescriptor: buildDefaultGraphPolicyDescriptor(),
        nodes: [createNode()],
        edges: [],
        createdByUserId: ids1.userId
      });

      await expect(
        revisionStore.createRevision({
          graphId: graph2.id,
          policyDescriptor: buildDefaultGraphPolicyDescriptor(),
          nodes: [createNode()],
          edges: [],
          parentRevisionId: rev1.id,
          createdByUserId: ids2.userId
        })
      ).rejects.toThrow("Parent revision must belong to same graph");
    });

    it("should reject nonexistent parent", async () => {
      const ids = createMockIds();

      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [createNode()],
        edges: []
      });

      await expect(
        revisionStore.createRevision({
          graphId: graph.id,
          policyDescriptor: buildDefaultGraphPolicyDescriptor(),
          nodes: [createNode()],
          edges: [],
          parentRevisionId: randomUUID(),
          createdByUserId: ids.userId
        })
      ).rejects.toThrow();
    });
  });

  describe("load stress", () => {
    it("should handle rapid revision creation", async () => {
      const ids = createMockIds();
      const node = createNode();

      const graph = await graphStore.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node],
        edges: []
      });

      const policy = buildDefaultGraphPolicyDescriptor();
      const revisions: any[] = [];

      for (let i = 0; i < 20; i++) {
        const rev = await revisionStore.createRevision({
          graphId: graph.id,
          policyDescriptor: policy,
          nodes: [node],
          edges: [],
          parentRevisionId: revisions[i - 1]?.id,
          createdByUserId: ids.userId
        });
        revisions.push(rev);
      }

      expect(revisions).toHaveLength(20);
      expect(revisions[19].revisionNumber).toBe(20);
      expect(revisions.every((r, i) => r.revisionNumber === i + 1)).toBe(true);
    });
  });
});
