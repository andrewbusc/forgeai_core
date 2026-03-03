import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { GraphStore } from "../graph-store.js";
import { buildGraphIdentityHash, buildDefaultGraphPolicyDescriptor, type GraphNode, type GraphEdge } from "../../agent/graph-identity.js";
import { randomUUID } from "node:crypto";

describe("graph-store", () => {
  let pool: Pool;
  let store: GraphStore;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL required for tests");
    }

    pool = new Pool({ connectionString: databaseUrl });
    store = new GraphStore(pool);
    await store.initializeSchema();
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
    executionIdentityHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };

  const node2: GraphNode = {
    runId: randomUUID(),
    executionIdentityHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  };

  const node3: GraphNode = {
    runId: randomUUID(),
    executionIdentityHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  };

  describe("graph creation", () => {
    it("should create graph with nodes and edges", async () => {
      const ids = createMockIds();
      const edges: GraphEdge[] = [
        { fromRunId: node1.runId, toRunId: node2.runId }
      ];

      const graph = await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1, node2],
        edges
      });

      expect(graph.id).toBeDefined();
      expect(graph.graphIdentityHash).toHaveLength(64);
      expect(graph.graphSchemaVersion).toBe(1);
      expect(graph.graphPolicyDescriptor).toBeDefined();
      expect(graph.graphPolicyDescriptor.graphPolicyVersion).toBe(1);
      expect(graph.status).toBe("created");
    });

    it("should compute correct identity hash", async () => {
      const ids = createMockIds();
      const nodes = [node1, node2];
      const edges: GraphEdge[] = [{ fromRunId: node1.runId, toRunId: node2.runId }];
      const policyDescriptor = buildDefaultGraphPolicyDescriptor();

      const expectedHash = buildGraphIdentityHash({ policyDescriptor, nodes, edges });

      const graph = await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes,
        edges
      });

      expect(graph.graphIdentityHash).toBe(expectedHash);
    });

    it("should reject cyclic graphs", async () => {
      const ids = createMockIds();
      const edges: GraphEdge[] = [
        { fromRunId: node1.runId, toRunId: node2.runId },
        { fromRunId: node2.runId, toRunId: node1.runId }
      ];

      await expect(
        store.createExecutionGraph({
          projectId: ids.projectId,
          orgId: ids.orgId,
          workspaceId: ids.workspaceId,
          createdByUserId: ids.userId,
          nodes: [node1, node2],
          edges
        })
      ).rejects.toThrow("Graph contains cycles");
    });

    it("should create single-node graph", async () => {
      const ids = createMockIds();

      const graph = await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      expect(graph.id).toBeDefined();
      expect(graph.graphIdentityHash).toHaveLength(64);
    });
  });

  describe("graph retrieval", () => {
    it("should retrieve graph by id", async () => {
      const ids = createMockIds();
      const created = await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1, node2],
        edges: [{ fromRunId: node1.runId, toRunId: node2.runId }]
      });

      const retrieved = await store.getExecutionGraph(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.graphIdentityHash).toBe(created.graphIdentityHash);
    });

    it("should retrieve graph nodes", async () => {
      const ids = createMockIds();
      const nodes = [node1, node2, node3];
      const graph = await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes,
        edges: []
      });

      const retrievedNodes = await store.getGraphNodes(graph.id);

      expect(retrievedNodes).toHaveLength(3);
      expect(retrievedNodes.map(n => n.runId).sort()).toEqual(
        nodes.map(n => n.runId).sort()
      );
    });

    it("should retrieve graph edges", async () => {
      const ids = createMockIds();
      const edges: GraphEdge[] = [
        { fromRunId: node1.runId, toRunId: node2.runId },
        { fromRunId: node2.runId, toRunId: node3.runId }
      ];

      const graph = await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1, node2, node3],
        edges
      });

      const retrievedEdges = await store.getGraphEdges(graph.id);

      expect(retrievedEdges).toHaveLength(2);
    });

    it("should list graphs by project", async () => {
      const ids = createMockIds();

      await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node2],
        edges: []
      });

      const graphs = await store.listExecutionGraphsByProject(ids.projectId);

      expect(graphs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("graph status updates", () => {
    it("should update graph status", async () => {
      const ids = createMockIds();
      const graph = await store.createExecutionGraph({
        projectId: ids.projectId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        createdByUserId: ids.userId,
        nodes: [node1],
        edges: []
      });

      const updated = await store.updateGraphStatus(graph.id, "running");

      expect(updated?.status).toBe("running");
      expect(updated?.id).toBe(graph.id);
    });
  });

  describe("identity stability", () => {
    it("should produce same hash for structurally identical graphs", async () => {
      const ids1 = createMockIds();
      const ids2 = createMockIds();

      const graph1 = await store.createExecutionGraph({
        projectId: ids1.projectId,
        orgId: ids1.orgId,
        workspaceId: ids1.workspaceId,
        createdByUserId: ids1.userId,
        nodes: [node1, node2],
        edges: [{ fromRunId: node1.runId, toRunId: node2.runId }]
      });

      const graph2 = await store.createExecutionGraph({
        projectId: ids2.projectId,
        orgId: ids2.orgId,
        workspaceId: ids2.workspaceId,
        createdByUserId: ids2.userId,
        nodes: [node1, node2],
        edges: [{ fromRunId: node1.runId, toRunId: node2.runId }]
      });

      expect(graph1.graphIdentityHash).toBe(graph2.graphIdentityHash);
    });
  });
});
