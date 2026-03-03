import { describe, it, expect } from "vitest";
import {
  buildExecutionContractMaterial,
  buildExecutionContractMaterialForSchema,
  hashExecutionContractMaterial,
  buildExecutionContract
} from "../../agent/execution-contract.js";
import { buildControlPlaneIdentityHash } from "../../agent/control-plane-identity.js";
import { buildGovernanceDecision } from "../../governance/decision.js";
import type { AgentRunDetail, AgentRunExecutionConfig } from "../../agent/types.js";

describe("v2 schema stress tests", () => {
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
        hash: hashExecutionContractMaterial(material),
        material,
        effectiveConfig: baseConfig,
        fallbackUsed: false,
        fallbackFields: []
      },
      ...overrides
    } as AgentRunDetail;
  };

  describe("1. Identity Stability Under Load", () => {
    it("should produce identical execution identity hash across 100+ runs", () => {
      const hashes = new Set<string>();
      
      for (let i = 0; i < 150; i++) {
        const material = buildExecutionContractMaterial(baseConfig);
        const hash = hashExecutionContractMaterial(material);
        hashes.add(hash);
      }

      expect(hashes.size).toBe(1);
    });

    it("should produce identical control-plane identity hash across 100+ runs", () => {
      const hashes = new Set<string>();
      
      for (let i = 0; i < 150; i++) {
        const material = buildExecutionContractMaterial(baseConfig);
        const cpHash = buildControlPlaneIdentityHash({ executionContractMaterial: material });
        hashes.add(cpHash);
      }

      expect(hashes.size).toBe(1);
    });

    it("should produce identical decision hash across 100+ replays", () => {
      const snapshot = createMockRunDetail();
      const hashes = new Set<string>();
      
      for (let i = 0; i < 150; i++) {
        const decision = buildGovernanceDecision({ detail: snapshot });
        hashes.add(decision.decisionHash);
      }

      expect(hashes.size).toBe(1);
    });
  });

  describe("2. Policy Version Drift Enforcement", () => {
    it("should detect governance policy version mismatch on resume", () => {
      const material1 = buildExecutionContractMaterial(baseConfig);
      const hash1 = hashExecutionContractMaterial(material1);

      const material2 = {
        ...material1,
        policyVersions: {
          ...material1.policyVersions,
          governancePolicyVersion: material1.policyVersions.governancePolicyVersion + 1
        }
      };
      const hash2 = hashExecutionContractMaterial(material2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce different execution identity after governance bump", () => {
      const material1 = buildExecutionContractMaterial(baseConfig);
      const execHash1 = hashExecutionContractMaterial(material1);

      const material2 = {
        ...material1,
        policyVersions: {
          ...material1.policyVersions,
          governancePolicyVersion: material1.policyVersions.governancePolicyVersion + 1
        }
      };
      const execHash2 = hashExecutionContractMaterial(material2);

      expect(execHash1).not.toBe(execHash2);
    });

    it("should produce different control-plane identity after governance bump", () => {
      const material1 = buildExecutionContractMaterial(baseConfig);
      const cpHash1 = buildControlPlaneIdentityHash({ executionContractMaterial: material1 });

      const material2 = {
        ...material1,
        policyVersions: {
          ...material1.policyVersions,
          governancePolicyVersion: material1.policyVersions.governancePolicyVersion + 1
        }
      };
      const cpHash2 = buildControlPlaneIdentityHash({ executionContractMaterial: material2 });

      expect(cpHash1).not.toBe(cpHash2);
    });
  });

  describe("3. Mixed Schema Environment", () => {
    it("should use v1 identity rules for v1 contracts", () => {
      const v1Material = buildExecutionContractMaterialForSchema({
        config: baseConfig,
        contractSchemaVersion: 1
      });

      expect(v1Material.executionContractSchemaVersion).toBe(1);
      expect("determinismPolicyVersion" in v1Material).toBe(true);
      expect("policyVersions" in v1Material).toBe(false);
    });

    it("should use v2 identity rules for v2 contracts", () => {
      const v2Material = buildExecutionContractMaterialForSchema({
        config: baseConfig,
        contractSchemaVersion: 2
      });

      expect(v2Material.executionContractSchemaVersion).toBe(2);
      expect("policyVersions" in v2Material).toBe(true);
      expect("determinismPolicyVersion" in v2Material).toBe(false);
    });

    it("should produce different hashes for v1 vs v2 with same config", () => {
      const v1Material = buildExecutionContractMaterialForSchema({
        config: baseConfig,
        contractSchemaVersion: 1
      });
      const v1Hash = hashExecutionContractMaterial(v1Material);

      const v2Material = buildExecutionContractMaterialForSchema({
        config: baseConfig,
        contractSchemaVersion: 2
      });
      const v2Hash = hashExecutionContractMaterial(v2Material);

      expect(v1Hash).not.toBe(v2Hash);
    });

    it("should replay v1 decisions without reinterpretation", () => {
      const v1Material = buildExecutionContractMaterialForSchema({
        config: baseConfig,
        contractSchemaVersion: 1
      });
      const v1Snapshot = createMockRunDetail({
        contract: {
          schemaVersion: 1,
          hash: hashExecutionContractMaterial(v1Material),
          material: v1Material,
          effectiveConfig: baseConfig,
          fallbackUsed: false,
          fallbackFields: []
        }
      });

      const decision1 = buildGovernanceDecision({ detail: v1Snapshot });
      const decision2 = buildGovernanceDecision({ detail: v1Snapshot });

      expect(decision1.decisionHash).toBe(decision2.decisionHash);
      expect(decision1.contract.schemaVersion).toBe(1);
    });

    it("should replay v2 decisions without reinterpretation", () => {
      const v2Snapshot = createMockRunDetail();
      
      const decision1 = buildGovernanceDecision({ detail: v2Snapshot });
      const decision2 = buildGovernanceDecision({ detail: v2Snapshot });

      expect(decision1.decisionHash).toBe(decision2.decisionHash);
      expect(decision1.contract.schemaVersion).toBe(2);
    });
  });

  describe("4. Replay After Code Upgrade", () => {
    it("should preserve hash when non-identity code changes", () => {
      const snapshot = createMockRunDetail();
      const decision1 = buildGovernanceDecision({ detail: snapshot });

      const snapshotWithExtraMetadata = {
        ...snapshot,
        run: {
          ...snapshot.run,
          metadata: { ...snapshot.run.metadata, newLoggingField: "ignored" }
        }
      };
      const decision2 = buildGovernanceDecision({ detail: snapshotWithExtraMetadata });

      expect(decision1.contract.hash).toBe(decision2.contract.hash);
      expect(decision1.controlPlaneIdentityHash).toBe(decision2.controlPlaneIdentityHash);
    });

    it("should change hash when governance policy version changes", () => {
      const material1 = buildExecutionContractMaterial(baseConfig);
      const snapshot1 = createMockRunDetail({
        contract: {
          schemaVersion: 2,
          hash: hashExecutionContractMaterial(material1),
          material: material1,
          effectiveConfig: baseConfig,
          fallbackUsed: false,
          fallbackFields: []
        }
      });
      const decision1 = buildGovernanceDecision({ detail: snapshot1 });

      const material2 = {
        ...material1,
        policyVersions: {
          ...material1.policyVersions,
          governancePolicyVersion: material1.policyVersions.governancePolicyVersion + 1
        }
      };
      const snapshot2 = createMockRunDetail({
        contract: {
          schemaVersion: 2,
          hash: hashExecutionContractMaterial(material2),
          material: material2,
          effectiveConfig: baseConfig,
          fallbackUsed: false,
          fallbackFields: []
        }
      });
      const decision2 = buildGovernanceDecision({ detail: snapshot2 });

      expect(decision1.contract.hash).not.toBe(decision2.contract.hash);
      expect(decision1.controlPlaneIdentityHash).not.toBe(decision2.controlPlaneIdentityHash);
    });
  });

  describe("5. Worker Crash + Resume Under v2", () => {
    it("should preserve identity envelope after simulated crash", () => {
      const contract = buildExecutionContract(baseConfig);
      const originalHash = contract.hash;
      const originalCpHash = buildControlPlaneIdentityHash({
        executionContractMaterial: contract.material
      });

      const serialized = JSON.stringify(contract);
      const deserialized = JSON.parse(serialized);

      const resumedHash = deserialized.hash;
      const resumedCpHash = buildControlPlaneIdentityHash({
        executionContractMaterial: deserialized.material
      });

      expect(resumedHash).toBe(originalHash);
      expect(resumedCpHash).toBe(originalCpHash);
    });

    it("should maintain decision replay stability after resume", () => {
      const snapshot = createMockRunDetail();
      const decision1 = buildGovernanceDecision({ detail: snapshot });

      const serialized = JSON.stringify(snapshot);
      const deserialized = JSON.parse(serialized);
      const decision2 = buildGovernanceDecision({ detail: deserialized });

      expect(decision1.decisionHash).toBe(decision2.decisionHash);
      expect(decision1.controlPlaneIdentityHash).toBe(decision2.controlPlaneIdentityHash);
    });

    it("should detect normalization drift after resume", () => {
      const contract1 = buildExecutionContract(baseConfig);
      
      const modifiedConfig = { ...baseConfig, maxFilesPerStep: 51 };
      const contract2 = buildExecutionContract(modifiedConfig);

      expect(contract1.hash).not.toBe(contract2.hash);
    });

    it("should preserve control-plane identity across lease reclaim", () => {
      const material = buildExecutionContractMaterial(baseConfig);
      const cpHash1 = buildControlPlaneIdentityHash({ executionContractMaterial: material });

      const serialized = JSON.stringify(material);
      const deserialized = JSON.parse(serialized);
      const cpHash2 = buildControlPlaneIdentityHash({ executionContractMaterial: deserialized });

      expect(cpHash1).toBe(cpHash2);
    });
  });
});
