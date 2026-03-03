import { describe, it, expect } from "vitest";
import {
  buildExecutionContractMaterial,
  hashExecutionContractMaterial,
  EXECUTION_CONTRACT_SCHEMA_VERSION
} from "../../agent/execution-contract.js";
import { buildControlPlaneIdentityHash, CONTROL_PLANE_IDENTITY_SCHEMA_VERSION } from "../../agent/control-plane-identity.js";
import { buildGovernanceDecision, GOVERNANCE_DECISION_SCHEMA_VERSION } from "../../governance/decision.js";
import {
  DETERMINISM_POLICY_VERSION,
  NORMALIZATION_POLICY_VERSION,
  PLANNER_POLICY_VERSION,
  CORRECTION_RECIPE_VERSION,
  VALIDATION_POLICY_VERSION,
  GOVERNANCE_POLICY_VERSION,
  EXECUTION_CONTRACT_RANDOMNESS_SEED
} from "../../contracts/policy-registry.js";
import type { AgentRunDetail, AgentRunExecutionConfig } from "../../agent/types.js";

describe("identity drift tests", () => {
  const frozenConfig: AgentRunExecutionConfig = {
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

  const FROZEN_EXECUTION_IDENTITY_HASH = "fff55f87868878e82470cf2b8ca6a5dd7c9a24c1a57eb1a7bef2bf071bd5d3e3";
  const FROZEN_CONTROL_PLANE_IDENTITY_HASH = "5c62e091b8c0565f84d7b2f84e8e8e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e";

  const createMockRunDetail = (): AgentRunDetail => {
    const material = buildExecutionContractMaterial(frozenConfig);
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
        hash: hashExecutionContractMaterial(material),
        material,
        effectiveConfig: frozenConfig,
        fallbackUsed: false,
        fallbackFields: []
      }
    } as AgentRunDetail;
  };

  describe("frozen identity baseline", () => {
    it("should match frozen execution identity hash", () => {
      const material = buildExecutionContractMaterial(frozenConfig);
      const hash = hashExecutionContractMaterial(material);

      expect(hash).toBe(FROZEN_EXECUTION_IDENTITY_HASH);
    });

    it("should detect execution identity drift", () => {
      const material = buildExecutionContractMaterial(frozenConfig);
      const hash = hashExecutionContractMaterial(material);

      if (hash !== FROZEN_EXECUTION_IDENTITY_HASH) {
        throw new Error(
          `EXECUTION IDENTITY DRIFT DETECTED!\n` +
          `Expected: ${FROZEN_EXECUTION_IDENTITY_HASH}\n` +
          `Got:      ${hash}\n` +
          `This indicates unintended changes to identity material.`
        );
      }
    });
  });

  describe("policy version stability", () => {
    it("should maintain stable policy versions", () => {
      expect(DETERMINISM_POLICY_VERSION).toBe(1);
      expect(NORMALIZATION_POLICY_VERSION).toBe(1);
      expect(PLANNER_POLICY_VERSION).toBe(1);
      expect(CORRECTION_RECIPE_VERSION).toBe(1);
      expect(VALIDATION_POLICY_VERSION).toBe(1);
      expect(GOVERNANCE_POLICY_VERSION).toBe(1);
    });

    it("should maintain stable randomness seed", () => {
      expect(EXECUTION_CONTRACT_RANDOMNESS_SEED).toBe("forbidden:no-random-branching");
    });

    it("should maintain stable schema versions", () => {
      expect(EXECUTION_CONTRACT_SCHEMA_VERSION).toBe(2);
      expect(CONTROL_PLANE_IDENTITY_SCHEMA_VERSION).toBe(1);
      expect(GOVERNANCE_DECISION_SCHEMA_VERSION).toBe(3);
    });
  });

  describe("identity material structure drift", () => {
    it("should maintain v2 material structure", () => {
      const material = buildExecutionContractMaterial(frozenConfig);

      expect(material).toHaveProperty("executionContractSchemaVersion");
      expect(material).toHaveProperty("normalizedExecutionConfig");
      expect(material).toHaveProperty("randomnessSeed");
      expect(material).toHaveProperty("policyVersions");

      expect(material.policyVersions).toHaveProperty("determinismPolicyVersion");
      expect(material.policyVersions).toHaveProperty("normalizationPolicyVersion");
      expect(material.policyVersions).toHaveProperty("plannerPolicyVersion");
      expect(material.policyVersions).toHaveProperty("correctionRecipeVersion");
      expect(material.policyVersions).toHaveProperty("validationPolicyVersion");
      expect(material.policyVersions).toHaveProperty("governancePolicyVersion");
    });

    it("should not have v1 fields in v2 material", () => {
      const material = buildExecutionContractMaterial(frozenConfig);

      expect(material).not.toHaveProperty("determinismPolicyVersion");
      expect(material).not.toHaveProperty("plannerPolicyVersion");
      expect(material).not.toHaveProperty("correctionRecipeVersion");
      expect(material).not.toHaveProperty("validationPolicyVersion");
    });
  });

  describe("decision structure drift", () => {
    it("should maintain decision payload structure", () => {
      const snapshot = createMockRunDetail();
      const decision = buildGovernanceDecision({ detail: snapshot });

      expect(decision).toHaveProperty("decisionSchemaVersion");
      expect(decision).toHaveProperty("decision");
      expect(decision).toHaveProperty("reasonCodes");
      expect(decision).toHaveProperty("reasons");
      expect(decision).toHaveProperty("runId");
      expect(decision).toHaveProperty("contract");
      expect(decision).toHaveProperty("controlPlaneIdentityHash");
      expect(decision).toHaveProperty("artifactRefs");
      expect(decision).toHaveProperty("decisionHash");
    });

    it("should maintain contract metadata structure", () => {
      const snapshot = createMockRunDetail();
      const decision = buildGovernanceDecision({ detail: snapshot });

      expect(decision.contract).toHaveProperty("schemaVersion");
      expect(decision.contract).toHaveProperty("hash");
      expect(decision.contract).toHaveProperty("determinismPolicyVersion");
      expect(decision.contract).toHaveProperty("normalizationPolicyVersion");
      expect(decision.contract).toHaveProperty("plannerPolicyVersion");
      expect(decision.contract).toHaveProperty("correctionRecipeVersion");
      expect(decision.contract).toHaveProperty("validationPolicyVersion");
      expect(decision.contract).toHaveProperty("governancePolicyVersion");
      expect(decision.contract).toHaveProperty("randomnessSeed");
    });
  });

  describe("hash stability over time", () => {
    it("should produce identical hash after 1000ms delay", async () => {
      const material1 = buildExecutionContractMaterial(frozenConfig);
      const hash1 = hashExecutionContractMaterial(material1);

      await new Promise(resolve => setTimeout(resolve, 1000));

      const material2 = buildExecutionContractMaterial(frozenConfig);
      const hash2 = hashExecutionContractMaterial(material2);

      expect(hash1).toBe(hash2);
    });

    it("should produce identical control-plane hash after delay", async () => {
      const material1 = buildExecutionContractMaterial(frozenConfig);
      const cpHash1 = buildControlPlaneIdentityHash({ executionContractMaterial: material1 });

      await new Promise(resolve => setTimeout(resolve, 500));

      const material2 = buildExecutionContractMaterial(frozenConfig);
      const cpHash2 = buildControlPlaneIdentityHash({ executionContractMaterial: material2 });

      expect(cpHash1).toBe(cpHash2);
    });
  });

  describe("config normalization drift", () => {
    it("should normalize config identically across calls", () => {
      const material1 = buildExecutionContractMaterial(frozenConfig);
      const material2 = buildExecutionContractMaterial(frozenConfig);

      expect(JSON.stringify(material1.normalizedExecutionConfig))
        .toBe(JSON.stringify(material2.normalizedExecutionConfig));
    });

    it("should detect config field addition", () => {
      const material = buildExecutionContractMaterial(frozenConfig);
      const configKeys = Object.keys(material.normalizedExecutionConfig).sort();

      const expectedKeys = [
        "schemaVersion",
        "profile",
        "lightValidationMode",
        "heavyValidationMode",
        "maxRuntimeCorrectionAttempts",
        "maxHeavyCorrectionAttempts",
        "correctionPolicyMode",
        "correctionConvergenceMode",
        "plannerTimeoutMs",
        "maxFilesPerStep",
        "maxTotalDiffBytes",
        "maxFileBytes",
        "allowEnvMutation"
      ].sort();

      expect(configKeys).toEqual(expectedKeys);
    });
  });

  describe("serialization drift", () => {
    it("should produce identical hash after JSON round-trip", () => {
      const material1 = buildExecutionContractMaterial(frozenConfig);
      const hash1 = hashExecutionContractMaterial(material1);

      const serialized = JSON.stringify(material1);
      const deserialized = JSON.parse(serialized);
      const hash2 = hashExecutionContractMaterial(deserialized);

      expect(hash1).toBe(hash2);
    });

    it("should produce identical decision hash after JSON round-trip", () => {
      const snapshot = createMockRunDetail();
      const decision1 = buildGovernanceDecision({ detail: snapshot });

      const serialized = JSON.stringify(snapshot);
      const deserialized = JSON.parse(serialized);
      const decision2 = buildGovernanceDecision({ detail: deserialized });

      expect(decision1.decisionHash).toBe(decision2.decisionHash);
    });
  });
});
