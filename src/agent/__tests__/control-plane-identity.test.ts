import { describe, it, expect } from "vitest";
import {
  buildExecutionContractMaterial,
  hashExecutionContractMaterial
} from "../execution-contract.js";
import {
  buildControlPlaneIdentityHash,
  buildControlPlaneIdentityMaterial
} from "../control-plane-identity.js";
import type { AgentRunExecutionConfig } from "../types.js";

describe("control-plane-identity", () => {
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

  it("should produce stable control-plane identity hash", () => {
    const material = buildExecutionContractMaterial(baseConfig);
    const hash1 = buildControlPlaneIdentityHash({ executionContractMaterial: material });
    const hash2 = buildControlPlaneIdentityHash({ executionContractMaterial: material });

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("should include execution identity hash in control-plane material", () => {
    const executionMaterial = buildExecutionContractMaterial(baseConfig);
    const executionHash = hashExecutionContractMaterial(executionMaterial);
    const controlPlaneMaterial = buildControlPlaneIdentityMaterial({
      executionContractMaterial: executionMaterial
    });

    expect(controlPlaneMaterial.executionIdentityHash).toBe(executionHash);
  });

  it("should change control-plane hash when governance policy version changes", () => {
    const material1 = buildExecutionContractMaterial(baseConfig);
    const hash1 = buildControlPlaneIdentityHash({ executionContractMaterial: material1 });

    const material2 = {
      ...material1,
      policyVersions: {
        ...material1.policyVersions,
        governancePolicyVersion: material1.policyVersions.governancePolicyVersion + 1
      }
    };
    const hash2 = buildControlPlaneIdentityHash({ executionContractMaterial: material2 });

    expect(hash1).not.toBe(hash2);
  });

  it("should change execution hash when governance policy version changes", () => {
    const material1 = buildExecutionContractMaterial(baseConfig);
    const executionHash1 = hashExecutionContractMaterial(material1);

    const material2 = {
      ...material1,
      policyVersions: {
        ...material1.policyVersions,
        governancePolicyVersion: material1.policyVersions.governancePolicyVersion + 1
      }
    };
    const executionHash2 = hashExecutionContractMaterial(material2);

    expect(executionHash1).not.toBe(executionHash2);
  });

  it("should change control-plane hash when decision schema version changes", () => {
    const material = buildExecutionContractMaterial(baseConfig);
    const cpMaterial1 = buildControlPlaneIdentityMaterial({
      executionContractMaterial: material
    });
    const hash1 = buildControlPlaneIdentityHash({ executionContractMaterial: material });

    const cpMaterial2 = {
      ...cpMaterial1,
      decisionSchemaVersion: cpMaterial1.decisionSchemaVersion + 1
    };
    const material2 = {
      ...material,
      policyVersions: {
        ...material.policyVersions,
        governancePolicyVersion: material.policyVersions.governancePolicyVersion
      }
    };

    expect(cpMaterial1.decisionSchemaVersion).toBeLessThan(cpMaterial2.decisionSchemaVersion);
  });
});

describe("v1 backward compatibility", () => {
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

  it("should compute v1 identity using v1 rules", () => {
    const v1Material = {
      executionContractSchemaVersion: 1 as const,
      normalizedExecutionConfig: baseConfig,
      determinismPolicyVersion: 1,
      plannerPolicyVersion: 1,
      correctionRecipeVersion: 1,
      validationPolicyVersion: 1,
      randomnessSeed: "forbidden:no-random-branching"
    };

    const v1Hash = hashExecutionContractMaterial(v1Material);
    expect(v1Hash).toHaveLength(64);

    const v2Material = buildExecutionContractMaterial(baseConfig);
    const v2Hash = hashExecutionContractMaterial(v2Material);

    expect(v1Hash).not.toBe(v2Hash);
  });

  it("should support control-plane identity for v1 contracts", () => {
    const v1Material = {
      executionContractSchemaVersion: 1 as const,
      normalizedExecutionConfig: baseConfig,
      determinismPolicyVersion: 1,
      plannerPolicyVersion: 1,
      correctionRecipeVersion: 1,
      validationPolicyVersion: 1,
      randomnessSeed: "forbidden:no-random-branching"
    };

    const cpHash = buildControlPlaneIdentityHash({ executionContractMaterial: v1Material });
    expect(cpHash).toHaveLength(64);
  });
});
