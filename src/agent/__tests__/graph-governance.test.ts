import { describe, it, expect } from "vitest";
import { buildGraphGovernanceDecision, GRAPH_GOVERNANCE_VERSION } from "../graph-governance.js";
import { ExecutionGraph } from "../../lib/graph-store.js";
import { AgentLifecycleRun } from "../run-state-types.js";
import { buildDefaultGraphPolicyDescriptor } from "../graph-identity.js";

describe("graph-governance", () => {
  const mockGraph: ExecutionGraph = {
    id: "graph-1",
    projectId: "proj-1",
    orgId: "org-1",
    workspaceId: "ws-1",
    createdByUserId: "user-1",
    graphIdentityHash: "a".repeat(64),
    graphSchemaVersion: 1,
    graphPolicyDescriptor: buildDefaultGraphPolicyDescriptor(),
    status: "complete",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  };

  const mockCompleteRun: AgentLifecycleRun = {
    id: "run-1",
    projectId: "proj-1",
    orgId: "org-1",
    workspaceId: "ws-1",
    createdByUserId: "user-1",
    graphId: "graph-1",
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

  describe("deterministic decisions", () => {
    it("should produce PASS for valid graph with complete runs", () => {
      const decision = buildGraphGovernanceDecision({
        graph: mockGraph,
        runs: [mockCompleteRun]
      });

      expect(decision.verdict).toBe("PASS");
      expect(decision.governanceVersion).toBe(GRAPH_GOVERNANCE_VERSION);
      expect(decision.nodeValidations).toHaveLength(1);
      expect(decision.nodeValidations[0].valid).toBe(true);
      expect(decision.structuralInvariants.every(inv => inv.passed)).toBe(true);
    });

    it("should produce FAIL for graph with failed run", () => {
      const failedRun: AgentLifecycleRun = {
        ...mockCompleteRun,
        status: "failed",
        errorMessage: "Test failure"
      };

      const decision = buildGraphGovernanceDecision({
        graph: mockGraph,
        runs: [failedRun]
      });

      expect(decision.verdict).toBe("FAIL");
      expect(decision.nodeValidations[0].valid).toBe(false);
      expect(decision.nodeValidations[0].reason).toContain("Test failure");
    });

    it("should produce FAIL for empty graph", () => {
      const decision = buildGraphGovernanceDecision({
        graph: mockGraph,
        runs: []
      });

      expect(decision.verdict).toBe("FAIL");
      expect(decision.structuralInvariants.find(inv => inv.check === "all_nodes_have_runs")?.passed).toBe(false);
    });

    it("should produce FAIL for failed graph status", () => {
      const failedGraph: ExecutionGraph = {
        ...mockGraph,
        status: "failed"
      };

      const decision = buildGraphGovernanceDecision({
        graph: failedGraph,
        runs: [mockCompleteRun]
      });

      expect(decision.verdict).toBe("FAIL");
      expect(decision.structuralInvariants.find(inv => inv.check === "graph_not_empty")?.passed).toBe(false);
    });
  });

  describe("replay stability", () => {
    it("should produce identical decision for same inputs", () => {
      const decision1 = buildGraphGovernanceDecision({
        graph: mockGraph,
        runs: [mockCompleteRun]
      });

      const decision2 = buildGraphGovernanceDecision({
        graph: mockGraph,
        runs: [mockCompleteRun]
      });

      expect(decision1.verdict).toBe(decision2.verdict);
      expect(decision1.governanceVersion).toBe(decision2.governanceVersion);
      expect(decision1.nodeValidations).toEqual(decision2.nodeValidations);
      expect(decision1.structuralInvariants).toEqual(decision2.structuralInvariants);
    });

    it("should be deterministic across multiple runs", () => {
      const runs: AgentLifecycleRun[] = [
        { ...mockCompleteRun, id: "run-1" },
        { ...mockCompleteRun, id: "run-2" },
        { ...mockCompleteRun, id: "run-3" }
      ];

      const decision1 = buildGraphGovernanceDecision({ graph: mockGraph, runs });
      const decision2 = buildGraphGovernanceDecision({ graph: mockGraph, runs });

      expect(decision1.verdict).toBe(decision2.verdict);
      expect(decision1.nodeValidations).toEqual(decision2.nodeValidations);
    });
  });

  describe("governance version coupling", () => {
    it("should include governance version in decision", () => {
      const decision = buildGraphGovernanceDecision({
        graph: mockGraph,
        runs: [mockCompleteRun]
      });

      expect(decision.governanceVersion).toBe(1);
    });

    it("should be stable across identical snapshots", () => {
      const snapshot = {
        graph: mockGraph,
        runs: [mockCompleteRun]
      };

      const decision1 = buildGraphGovernanceDecision(snapshot);
      const decision2 = buildGraphGovernanceDecision(snapshot);

      expect(decision1.governanceVersion).toBe(decision2.governanceVersion);
      expect(decision1.verdict).toBe(decision2.verdict);
    });
  });
});
