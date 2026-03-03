import { createHash } from "node:crypto";
import { z } from "zod";
import { GOVERNANCE_DECISION_SCHEMA_VERSION } from "../governance/decision.js";
import {
  type AgentRunExecutionContractMaterial,
  type AgentRunExecutionPolicyVersions
} from "./types.js";
import {
  executionContractPolicyVersions,
  hashExecutionContractMaterial,
  stableExecutionContractJson
} from "./execution-contract.js";

export const CONTROL_PLANE_IDENTITY_SCHEMA_VERSION = 1 as const;

export interface ControlPlaneIdentityMaterial {
  controlPlaneIdentitySchemaVersion: typeof CONTROL_PLANE_IDENTITY_SCHEMA_VERSION;
  executionIdentityHash: string;
  governanceProjectionVersion: number;
  decisionSchemaVersion: number;
}

export const controlPlaneIdentityMaterialSchema = z.object({
  controlPlaneIdentitySchemaVersion: z.literal(CONTROL_PLANE_IDENTITY_SCHEMA_VERSION),
  executionIdentityHash: z.string().length(64),
  governanceProjectionVersion: z.number().int().min(1),
  decisionSchemaVersion: z.number().int().min(1)
});

export function buildControlPlaneIdentityMaterial(input: {
  executionContractMaterial: AgentRunExecutionContractMaterial;
}): ControlPlaneIdentityMaterial {
  const executionIdentityHash = hashExecutionContractMaterial(input.executionContractMaterial);
  const policyVersions = executionContractPolicyVersions(input.executionContractMaterial);

  return {
    controlPlaneIdentitySchemaVersion: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
    executionIdentityHash,
    governanceProjectionVersion: policyVersions.governancePolicyVersion,
    decisionSchemaVersion: GOVERNANCE_DECISION_SCHEMA_VERSION
  };
}

export function hashControlPlaneIdentityMaterial(material: ControlPlaneIdentityMaterial): string {
  return createHash("sha256")
    .update(stableExecutionContractJson(material))
    .digest("hex");
}

export function buildControlPlaneIdentityHash(input: {
  executionContractMaterial: AgentRunExecutionContractMaterial;
}): string {
  const material = buildControlPlaneIdentityMaterial(input);
  return hashControlPlaneIdentityMaterial(material);
}
