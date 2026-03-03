import { GraphRevision } from "../lib/graph-revision-store.js";
import { GraphNode, GraphEdge } from "./graph-identity.js";

export interface GraphRevisionDiff {
  fromRevisionId: string;
  toRevisionId: string;
  fromRevisionNumber: number;
  toRevisionNumber: number;
  nodesAdded: string[];
  nodesRemoved: string[];
  edgesAdded: Array<[string, string]>;
  edgesRemoved: Array<[string, string]>;
  policyDescriptorChanged: boolean;
  identityHashChanged: boolean;
}

export function buildGraphRevisionDiff(input: {
  fromRevision: GraphRevision;
  toRevision: GraphRevision;
  fromNodes: GraphNode[];
  toNodes: GraphNode[];
  fromEdges: GraphEdge[];
  toEdges: GraphEdge[];
}): GraphRevisionDiff {
  if (input.fromRevision.graphId !== input.toRevision.graphId) {
    throw new Error("Revisions must belong to same graph");
  }

  const fromNodeHashes = new Set(input.fromNodes.map(n => n.executionIdentityHash));
  const toNodeHashes = new Set(input.toNodes.map(n => n.executionIdentityHash));

  const nodesAdded = input.toNodes
    .filter(n => !fromNodeHashes.has(n.executionIdentityHash))
    .map(n => n.executionIdentityHash)
    .sort();

  const nodesRemoved = input.fromNodes
    .filter(n => !toNodeHashes.has(n.executionIdentityHash))
    .map(n => n.executionIdentityHash)
    .sort();

  const fromNodeHashToRunId = new Map(input.fromNodes.map(n => [n.executionIdentityHash, n.runId]));
  const toNodeHashToRunId = new Map(input.toNodes.map(n => [n.executionIdentityHash, n.runId]));

  const fromEdgeSet = new Set(
    input.fromEdges.map(e => {
      const fromHash = input.fromNodes.find(n => n.runId === e.fromRunId)?.executionIdentityHash;
      const toHash = input.fromNodes.find(n => n.runId === e.toRunId)?.executionIdentityHash;
      return `${fromHash}:${toHash}`;
    })
  );

  const toEdgeSet = new Set(
    input.toEdges.map(e => {
      const fromHash = input.toNodes.find(n => n.runId === e.fromRunId)?.executionIdentityHash;
      const toHash = input.toNodes.find(n => n.runId === e.toRunId)?.executionIdentityHash;
      return `${fromHash}:${toHash}`;
    })
  );

  const edgesAdded: Array<[string, string]> = [];
  for (const edge of toEdgeSet) {
    if (!fromEdgeSet.has(edge)) {
      const [from, to] = edge.split(":");
      edgesAdded.push([from, to]);
    }
  }
  edgesAdded.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });

  const edgesRemoved: Array<[string, string]> = [];
  for (const edge of fromEdgeSet) {
    if (!toEdgeSet.has(edge)) {
      const [from, to] = edge.split(":");
      edgesRemoved.push([from, to]);
    }
  }
  edgesRemoved.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });

  const policyDescriptorChanged = 
    JSON.stringify(input.fromRevision.graphPolicyDescriptor) !== 
    JSON.stringify(input.toRevision.graphPolicyDescriptor);

  const identityHashChanged = 
    input.fromRevision.graphIdentityHash !== input.toRevision.graphIdentityHash;

  return {
    fromRevisionId: input.fromRevision.id,
    toRevisionId: input.toRevision.id,
    fromRevisionNumber: input.fromRevision.revisionNumber,
    toRevisionNumber: input.toRevision.revisionNumber,
    nodesAdded,
    nodesRemoved,
    edgesAdded,
    edgesRemoved,
    policyDescriptorChanged,
    identityHashChanged
  };
}
