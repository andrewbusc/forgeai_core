import { describe, it, expect } from "vitest";
import {
  buildGraphIdentityMaterial,
  buildGraphIdentityHash,
  hashGraphIdentityMaterial,
  validateGraphAcyclic,
  buildDefaultGraphPolicyDescriptor,
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
  type GraphEdge
} from "../graph-identity.js";

describe("graph identity", () => {
  const node1: GraphNode = {
    runId: "550e8400-e29b-41d4-a716-446655440001",
    executionIdentityHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };

  const node2: GraphNode = {
    runId: "550e8400-e29b-41d4-a716-446655440002",
    executionIdentityHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  };

  const node3: GraphNode = {
    runId: "550e8400-e29b-41d4-a716-446655440003",
    executionIdentityHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  };

  describe("canonical ordering", () => {
    it("should produce identical hash regardless of node insertion order", () => {
      const policyDescriptor = buildDefaultGraphPolicyDescriptor();
      const hash1 = buildGraphIdentityHash({
        policyDescriptor,
        nodes: [node1, node2, node3],
        edges: []
      });

      const hash2 = buildGraphIdentityHash({
        policyDescriptor,
        nodes: [node3, node1, node2],
        edges: []
      });

      const hash3 = buildGraphIdentityHash({
        policyDescriptor,
        nodes: [node2, node3, node1],
        edges: []
      });

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("should produce identical hash regardless of edge insertion order", () => {
      const policyDescriptor = buildDefaultGraphPolicyDescriptor();
      const edge1: GraphEdge = { fromRunId: node1.runId, toRunId: node2.runId };
      const edge2: GraphEdge = { fromRunId: node2.runId, toRunId: node3.runId };

      const hash1 = buildGraphIdentityHash({
        policyDescriptor,
        nodes: [node1, node2, node3],
        edges: [edge1, edge2]
      });

      const hash2 = buildGraphIdentityHash({
        policyDescriptor,
        nodes: [node1, node2, node3],
        edges: [edge2, edge1]
      });

      expect(hash1).toBe(hash2);
    });

    it("should sort nodes by execution identity hash", () => {
      const material = buildGraphIdentityMaterial({
        nodes: [node3, node1, node2],
        edges: []
      });

      expect(material.nodes).toEqual([
        node1.executionIdentityHash,
        node2.executionIdentityHash,
        node3.executionIdentityHash
      ]);
    });

    it("should sort edges lexicographically by hash pairs", () => {
      const edge1: GraphEdge = { fromRunId: node2.runId, toRunId: node3.runId };
      const edge2: GraphEdge = { fromRunId: node1.runId, toRunId: node2.runId };

      const material = buildGraphIdentityMaterial({
        nodes: [node1, node2, node3],
        edges: [edge1, edge2]
      });

      expect(material.edges).toEqual([
        [node1.executionIdentityHash, node2.executionIdentityHash],
        [node2.executionIdentityHash, node3.executionIdentityHash]
      ]);
    });
  });

  describe("identity stability", () => {
    it("should produce stable hash for same structure", () => {
      const nodes = [node1, node2];
      const edges: GraphEdge[] = [{ fromRunId: node1.runId, toRunId: node2.runId }];

      const hash1 = buildGraphIdentityHash({ policyDescriptor: buildDefaultGraphPolicyDescriptor(), nodes, edges });
      const hash2 = buildGraphIdentityHash({ policyDescriptor: buildDefaultGraphPolicyDescriptor(), nodes, edges });

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("should change hash when node added", () => {
      const hash1 = buildGraphIdentityHash({
        nodes: [node1, node2],
        edges: []
      });

      const hash2 = buildGraphIdentityHash({
        nodes: [node1, node2, node3],
        edges: []
      });

      expect(hash1).not.toBe(hash2);
    });

    it("should change hash when node removed", () => {
      const hash1 = buildGraphIdentityHash({
        nodes: [node1, node2, node3],
        edges: []
      });

      const hash2 = buildGraphIdentityHash({
        nodes: [node1, node2],
        edges: []
      });

      expect(hash1).not.toBe(hash2);
    });

    it("should change hash when edge added", () => {
      const nodes = [node1, node2];
      
      const hash1 = buildGraphIdentityHash({
        nodes,
        edges: []
      });

      const hash2 = buildGraphIdentityHash({
        nodes,
        edges: [{ fromRunId: node1.runId, toRunId: node2.runId }]
      });

      expect(hash1).not.toBe(hash2);
    });

    it("should change hash when edge removed", () => {
      const nodes = [node1, node2];
      const edges: GraphEdge[] = [{ fromRunId: node1.runId, toRunId: node2.runId }];

      const hash1 = buildGraphIdentityHash({ policyDescriptor: buildDefaultGraphPolicyDescriptor(), nodes, edges });
      const hash2 = buildGraphIdentityHash({ policyDescriptor: buildDefaultGraphPolicyDescriptor(), nodes, edges: [] });

      expect(hash1).not.toBe(hash2);
    });

    it("should change hash when node identity changes", () => {
      const hash1 = buildGraphIdentityHash({
        nodes: [node1, node2],
        edges: []
      });

      const modifiedNode2 = {
        ...node2,
        executionIdentityHash: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      };

      const hash2 = buildGraphIdentityHash({
        nodes: [node1, modifiedNode2],
        edges: []
      });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("policy version coupling", () => {
    it("should include graph schema version in material", () => {
      const material = buildGraphIdentityMaterial({
        nodes: [node1],
        edges: []
      });

      expect(material.graphSchemaVersion).toBe(GRAPH_SCHEMA_VERSION);
    });

    it("should include graph policy version in material", () => {
      const material = buildGraphIdentityMaterial({
        nodes: [node1],
        edges: []
      });

      expect(material.policyIdentityHash).toHaveLength(64);
    });

    it("should change hash when policy descriptor changes", () => {
      const policy1 = buildDefaultGraphPolicyDescriptor();
      const material1 = buildGraphIdentityMaterial({
        policyDescriptor: policy1,
        nodes: [node1],
        edges: []
      });
      const hash1 = hashGraphIdentityMaterial(material1);

      const policy2 = { ...policy1, maxConcurrentNodes: 10 };
      const material2 = buildGraphIdentityMaterial({
        policyDescriptor: policy2,
        nodes: [node1],
        edges: []
      });
      const hash2 = hashGraphIdentityMaterial(material2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("serialization stability", () => {
    it("should produce identical hash after JSON round-trip", () => {
      const material = buildGraphIdentityMaterial({
        nodes: [node1, node2],
        edges: [{ fromRunId: node1.runId, toRunId: node2.runId }]
      });
      const hash1 = hashGraphIdentityMaterial(material);

      const serialized = JSON.stringify(material);
      const deserialized = JSON.parse(serialized);
      const hash2 = hashGraphIdentityMaterial(deserialized);

      expect(hash1).toBe(hash2);
    });
  });

  describe("DAG validation", () => {
    it("should validate acyclic graph", () => {
      const nodes = [node1, node2, node3];
      const edges: GraphEdge[] = [
        { fromRunId: node1.runId, toRunId: node2.runId },
        { fromRunId: node2.runId, toRunId: node3.runId }
      ];

      expect(validateGraphAcyclic(nodes, edges)).toBe(true);
    });

    it("should detect simple cycle", () => {
      const nodes = [node1, node2];
      const edges: GraphEdge[] = [
        { fromRunId: node1.runId, toRunId: node2.runId },
        { fromRunId: node2.runId, toRunId: node1.runId }
      ];

      expect(validateGraphAcyclic(nodes, edges)).toBe(false);
    });

    it("should detect complex cycle", () => {
      const nodes = [node1, node2, node3];
      const edges: GraphEdge[] = [
        { fromRunId: node1.runId, toRunId: node2.runId },
        { fromRunId: node2.runId, toRunId: node3.runId },
        { fromRunId: node3.runId, toRunId: node1.runId }
      ];

      expect(validateGraphAcyclic(nodes, edges)).toBe(false);
    });

    it("should validate graph with parallel branches", () => {
      const nodes = [node1, node2, node3];
      const edges: GraphEdge[] = [
        { fromRunId: node1.runId, toRunId: node2.runId },
        { fromRunId: node1.runId, toRunId: node3.runId }
      ];

      expect(validateGraphAcyclic(nodes, edges)).toBe(true);
    });

    it("should validate single node graph", () => {
      expect(validateGraphAcyclic([node1], [])).toBe(true);
    });
  });

  describe("edge validation", () => {
    it("should throw when edge references unknown node", () => {
      const unknownNode: GraphNode = {
        runId: "550e8400-e29b-41d4-a716-446655440099",
        executionIdentityHash: "9999999999999999999999999999999999999999999999999999999999999999"
      };

      expect(() => {
        buildGraphIdentityMaterial({
          nodes: [node1, node2],
          edges: [{ fromRunId: node1.runId, toRunId: unknownNode.runId }]
        });
      }).toThrow("Edge references unknown node");
    });
  });

  describe("composition with run identity", () => {
    it("should compose run identities without recomputing them", () => {
      const material = buildGraphIdentityMaterial({
        nodes: [node1, node2],
        edges: []
      });

      expect(material.nodes).toContain(node1.executionIdentityHash);
      expect(material.nodes).toContain(node2.executionIdentityHash);
    });

    it("should preserve run identity hashes in canonical form", () => {
      const nodes = [node1, node2, node3];
      const material = buildGraphIdentityMaterial({ policyDescriptor: buildDefaultGraphPolicyDescriptor(), nodes, edges: [] });

      const expectedHashes = nodes
        .map(n => n.executionIdentityHash)
        .sort();

      expect(material.nodes).toEqual(expectedHashes);
    });
  });
});
