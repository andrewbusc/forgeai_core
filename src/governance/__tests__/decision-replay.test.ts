import { describe, it, expect } from "vitest";
import { buildGovernanceDecision, buildGovernanceDecisionHash } from "../decision.js";
import { buildExecutionContractMaterial } from "../../agent/execution-contract.js";
import type { AgentRunDetail, AgentRunExecutionConfig } from "../../agent/types.js";

describe("governance decision replay", () => {
  const baseConfig: AgentRunExecutionConfig = {
    schemaVersion: 1,
    profile: "full",
    lightValidationMode: "warn",
    heavyValidationMode: "warn",
    maxRuntimeCorrectionAttempts: 3,
    maxHeavyCorrectionAttempts: 2,
    correctionPolicyMode: "warn",
    correctionConvergenceMode: "warn",
    plannerTimeoutMs: 30_000,
    maxFilesPerStep: 50,
    maxTotalDiffBytes: 1_000_000,
    maxFileBytes: 5_000_000,
    allowEnvMutation: false
  };

  const createMockRunDetail = (overrides?: Partial<AgentRunDetail>): AgentRunDetail => {
    const material = buildExecutionContractMaterial(baseConfig);
    return {
      run: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        projectId: "proj-123",
        orgId: "org-123",
        workspaceId: "ws-123",
        createdByUserId: "user-123",
        goal: "test goal",
        providerId: "openai",
        status: "complete",
        currentStepIndex: 1,
        plan: { goal: "test", steps: [] },
        correctionAttempts: 0,
        validationStatus: "passed",
        currentCommitHash: "abc123",
        worktreePath: "/tmp/worktree",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        validationResult: {
          validation: {
            ok: true,
            blockingCount: 0,
            warningCount: 0,
            summary: "all checks passed"
          }
        }
      },
      steps: [],
      telemetry: { corrections: [], correctionPolicies: [] },
      contract: {
        schemaVersion: 2,
        hash: "test-hash",
        material,
        effectiveConfig: baseConfig,
        fallbackUsed: false,
        fallbackFields: []
      },
      ...overrides
    } as AgentRunDetail;
  };

  it("should produce identical decision hash from same snapshot", () => {
    const snapshot = createMockRunDetail();
    
    const decision1 = buildGovernanceDecision({ detail: snapshot });
    const decision2 = buildGovernanceDecision({ detail: snapshot });

    expect(decision1.decisionHash).toBe(decision2.decisionHash);
    expect(decision1.decision).toBe(decision2.decision);
    expect(decision1.reasonCodes).toEqual(decision2.reasonCodes);
  });

  it("should produce identical decision from re-evaluated snapshot", () => {
    const snapshot = createMockRunDetail();
    
    const decision1 = buildGovernanceDecision({ detail: snapshot });
    
    const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
    const decision2 = buildGovernanceDecision({ detail: snapshotCopy });

    expect(decision1.decisionHash).toBe(decision2.decisionHash);
    expect(decision1.controlPlaneIdentityHash).toBe(decision2.controlPlaneIdentityHash);
  });

  it("should produce PASS decision for valid complete run", () => {
    const snapshot = createMockRunDetail();
    const decision = buildGovernanceDecision({ detail: snapshot });

    expect(decision.decision).toBe("PASS");
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.reasons).toEqual([]);
  });

  it("should produce FAIL decision for incomplete run", () => {
    const snapshot = createMockRunDetail({
      run: {
        ...createMockRunDetail().run,
        status: "running"
      }
    });
    const decision = buildGovernanceDecision({ detail: snapshot });

    expect(decision.decision).toBe("FAIL");
    expect(decision.reasonCodes).toContain("RUN_NOT_COMPLETE");
  });

  it("should produce FAIL decision for failed validation", () => {
    const snapshot = createMockRunDetail({
      run: {
        ...createMockRunDetail().run,
        validationStatus: "failed",
        validationResult: {
          validation: {
            ok: false,
            blockingCount: 2,
            warningCount: 1,
            summary: "validation failed"
          }
        }
      }
    });
    const decision = buildGovernanceDecision({ detail: snapshot });

    expect(decision.decision).toBe("FAIL");
    expect(decision.reasonCodes).toContain("RUN_VALIDATION_FAILED");
  });

  it("should change decision hash when run state changes", () => {
    const snapshot1 = createMockRunDetail();
    const decision1 = buildGovernanceDecision({ detail: snapshot1 });

    const snapshot2 = createMockRunDetail({
      run: {
        ...createMockRunDetail().run,
        status: "failed"
      }
    });
    const decision2 = buildGovernanceDecision({ detail: snapshot2 });

    expect(decision1.decisionHash).not.toBe(decision2.decisionHash);
    expect(decision1.decision).toBe("PASS");
    expect(decision2.decision).toBe("FAIL");
  });

  it("should preserve control-plane identity hash across replays", () => {
    const snapshot = createMockRunDetail();
    
    const decision1 = buildGovernanceDecision({ detail: snapshot });
    const decision2 = buildGovernanceDecision({ detail: snapshot });

    expect(decision1.controlPlaneIdentityHash).toBe(decision2.controlPlaneIdentityHash);
    expect(decision1.controlPlaneIdentityHash).toHaveLength(64);
  });

  it("should include contract details in decision", () => {
    const snapshot = createMockRunDetail();
    const decision = buildGovernanceDecision({ detail: snapshot });

    expect(decision.contract.schemaVersion).toBe(2);
    expect(decision.contract.governancePolicyVersion).toBe(1);
    expect(decision.contract.hash).toBe("test-hash");
  });

  it("should sort artifact refs deterministically", () => {
    const snapshot = createMockRunDetail({
      run: {
        ...createMockRunDetail().run,
        worktreePath: "/tmp/worktree-b",
        validationResult: {
          targetPath: "/tmp/target-a",
          validation: {
            ok: true,
            blockingCount: 0,
            warningCount: 0,
            summary: "passed"
          }
        }
      }
    });

    const decision1 = buildGovernanceDecision({ detail: snapshot });
    const decision2 = buildGovernanceDecision({ detail: snapshot });

    expect(decision1.artifactRefs).toEqual(decision2.artifactRefs);
    expect(decision1.artifactRefs[0].kind).toBe("run_worktree");
    expect(decision1.artifactRefs[1].kind).toBe("validation_target");
  });
});
