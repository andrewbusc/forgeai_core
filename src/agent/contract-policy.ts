import {
  CORRECTION_RECIPE_VERSION,
  DETERMINISM_POLICY_VERSION,
  EXECUTION_CONTRACT_RANDOMNESS_SEED,
  GOVERNANCE_POLICY_VERSION,
  NORMALIZATION_POLICY_VERSION,
  PLANNER_POLICY_VERSION,
  POLICY_REGISTRY,
  VALIDATION_POLICY_VERSION
} from "../contracts/policy-registry.js";

export {
  CORRECTION_RECIPE_VERSION,
  DETERMINISM_POLICY_VERSION,
  EXECUTION_CONTRACT_RANDOMNESS_SEED,
  GOVERNANCE_POLICY_VERSION,
  NORMALIZATION_POLICY_VERSION,
  PLANNER_POLICY_VERSION,
  POLICY_REGISTRY,
  VALIDATION_POLICY_VERSION
};

export interface SupportedExecutionContractRanges {
  schemaVersions: number[];
  determinismPolicyVersions: number[];
  normalizationPolicyVersions: number[];
  plannerPolicyVersions: number[];
  correctionRecipeVersions: number[];
  validationPolicyVersions: number[];
  governancePolicyVersions: number[];
  randomnessSeeds: string[];
}

export const SUPPORTED_EXECUTION_CONTRACT_RANGES: SupportedExecutionContractRanges = {
  schemaVersions: [1, 2],
  determinismPolicyVersions: [DETERMINISM_POLICY_VERSION],
  normalizationPolicyVersions: [NORMALIZATION_POLICY_VERSION],
  plannerPolicyVersions: [PLANNER_POLICY_VERSION],
  correctionRecipeVersions: [CORRECTION_RECIPE_VERSION],
  validationPolicyVersions: [VALIDATION_POLICY_VERSION],
  governancePolicyVersions: [GOVERNANCE_POLICY_VERSION],
  randomnessSeeds: [EXECUTION_CONTRACT_RANDOMNESS_SEED]
};
