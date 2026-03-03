import { ExecutionGraph } from "../lib/graph-store.js";
import { AgentLifecycleRun } from "./run-state-types.js";

export const GRAPH_GOVERNANCE_VERSION = 1 as const;

export interface GraphGovernanceDecision {
  graphId: string;
  governanceVersion: typeof GRAPH_GOVERNANCE_VERSION;
  verdict: "PASS" | "FAIL";
  reason: string;
  nodeValidations: Array<{
    runId: string;
    valid: boolean;
    reason?: string;
  }>;
  structuralInvariants: Array<{
    check: string;
    passed: boolean;
    reason?: string;
  }>;
  decidedAt: string;
}

export function buildGraphGovernanceDecision(input: {
  graph: ExecutionGraph;
  runs: AgentLifecycleRun[];
}): GraphGovernanceDecision {
  const nodeValidations = input.runs.map(run => {
    const valid = run.status === "complete" && run.errorMessage === null;
    return {
      runId: run.id,
      valid,
      reason: valid ? undefined : run.errorMessage || `Run status: ${run.status}`
    };
  });

  const allNodesValid = nodeValidations.every(v => v.valid);

  const structuralInvariants = [
    {
      check: "all_nodes_have_runs",
      passed: input.runs.length > 0,
      reason: input.runs.length === 0 ? "No runs found for graph nodes" : undefined
    },
    {
      check: "graph_not_empty",
      passed: input.graph.status !== "failed",
      reason: input.graph.status === "failed" ? "Graph marked as failed" : undefined
    }
  ];

  const allInvariantsPassed = structuralInvariants.every(inv => inv.passed);

  const verdict = allNodesValid && allInvariantsPassed ? "PASS" : "FAIL";
  const reason = verdict === "PASS"
    ? "All nodes valid and structural invariants satisfied"
    : `Failed: ${nodeValidations.filter(v => !v.valid).length} invalid nodes, ${structuralInvariants.filter(inv => !inv.passed).length} invariant violations`;

  return {
    graphId: input.graph.id,
    governanceVersion: GRAPH_GOVERNANCE_VERSION,
    verdict,
    reason,
    nodeValidations,
    structuralInvariants,
    decidedAt: new Date().toISOString()
  };
}
