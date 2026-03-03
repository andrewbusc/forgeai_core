import { createHash } from "node:crypto";
import { z } from "zod";
import { stableExecutionContractJson } from "./execution-contract.js";

export const GRAPH_SCHEMA_VERSION = 1 as const;
export const GRAPH_POLICY_VERSION = 1 as const;

export interface GraphPolicyDescriptor {
  graphPolicyVersion: typeof GRAPH_POLICY_VERSION;
  parallelismMode: "sequential" | "parallel";
  maxConcurrentNodes: number;
  failureStrategy: "fail-fast" | "continue";
}

export interface GraphNode {
  runId: string;
  executionIdentityHash: string;
}

export interface GraphEdge {
  fromRunId: string;
  toRunId: string;
}

export interface ExecutionGraphIdentityMaterial {
  graphSchemaVersion: typeof GRAPH_SCHEMA_VERSION;
  policyIdentityHash: string;
  nodes: string[];
  edges: [string, string][];
}

export const graphPolicyDescriptorSchema = z.object({
  graphPolicyVersion: z.literal(GRAPH_POLICY_VERSION),
  parallelismMode: z.enum(["sequential", "parallel"]),
  maxConcurrentNodes: z.number().int().min(1),
  failureStrategy: z.enum(["fail-fast", "continue"])
});

export const graphNodeSchema = z.object({
  runId: z.string().uuid(),
  executionIdentityHash: z.string().length(64)
});

export const graphEdgeSchema = z.object({
  fromRunId: z.string().uuid(),
  toRunId: z.string().uuid()
});

export const executionGraphIdentityMaterialSchema = z.object({
  graphSchemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  policyIdentityHash: z.string().length(64),
  nodes: z.array(z.string().length(64)),
  edges: z.array(z.tuple([z.string().length(64), z.string().length(64)]))
});

export function buildDefaultGraphPolicyDescriptor(): GraphPolicyDescriptor {
  return {
    graphPolicyVersion: GRAPH_POLICY_VERSION,
    parallelismMode: "sequential",
    maxConcurrentNodes: 1,
    failureStrategy: "fail-fast"
  };
}

export function hashGraphPolicyDescriptor(descriptor: GraphPolicyDescriptor): string {
  return createHash("sha256")
    .update(stableExecutionContractJson(descriptor))
    .digest("hex");
}

function canonicalizeNodes(nodes: GraphNode[]): string[] {
  return nodes
    .map(node => node.executionIdentityHash)
    .sort();
}

function canonicalizeEdges(nodes: GraphNode[], edges: GraphEdge[]): [string, string][] {
  const hashMap = new Map(nodes.map(n => [n.runId, n.executionIdentityHash]));
  
  return edges
    .map(edge => {
      const fromHash = hashMap.get(edge.fromRunId);
      const toHash = hashMap.get(edge.toRunId);
      if (!fromHash || !toHash) {
        throw new Error(`Edge references unknown node: ${edge.fromRunId} -> ${edge.toRunId}`);
      }
      return [fromHash, toHash] as [string, string];
    })
    .sort((a, b) => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      if (a[1] < b[1]) return -1;
      if (a[1] > b[1]) return 1;
      return 0;
    });
}

export function buildGraphIdentityMaterial(input: {
  policyDescriptor: GraphPolicyDescriptor;
  nodes: GraphNode[];
  edges: GraphEdge[];
}): ExecutionGraphIdentityMaterial {
  return {
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    policyIdentityHash: hashGraphPolicyDescriptor(input.policyDescriptor),
    nodes: canonicalizeNodes(input.nodes),
    edges: canonicalizeEdges(input.nodes, input.edges)
  };
}

export function hashGraphIdentityMaterial(material: ExecutionGraphIdentityMaterial): string {
  return createHash("sha256")
    .update(stableExecutionContractJson(material))
    .digest("hex");
}

export function buildGraphIdentityHash(input: {
  policyDescriptor: GraphPolicyDescriptor;
  nodes: GraphNode[];
  edges: GraphEdge[];
}): string {
  const material = buildGraphIdentityMaterial(input);
  return hashGraphIdentityMaterial(material);
}

export function validateGraphAcyclic(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  
  for (const node of nodes) {
    adjacency.set(node.runId, new Set());
    inDegree.set(node.runId, 0);
  }
  
  for (const edge of edges) {
    adjacency.get(edge.fromRunId)?.add(edge.toRunId);
    inDegree.set(edge.toRunId, (inDegree.get(edge.toRunId) || 0) + 1);
  }
  
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }
  
  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    
    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }
  
  return processed === nodes.length;
}
