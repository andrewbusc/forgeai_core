export const DETERMINISM_POLICY_VERSION = 1 as const;
export const PLANNER_POLICY_VERSION = 1 as const;
export const CORRECTION_RECIPE_VERSION = 1 as const;
export const VALIDATION_POLICY_VERSION = 1 as const;
export const EXECUTION_CONTRACT_RANDOMNESS_SEED = "forbidden:no-random-branching" as const;

export interface SupportedExecutionContractRanges {
  schemaVersions: number[];
  determinismPolicyVersions: number[];
  plannerPolicyVersions: number[];
  correctionRecipeVersions: number[];
  validationPolicyVersions: number[];
  randomnessSeeds: string[];
}

export const SUPPORTED_EXECUTION_CONTRACT_RANGES: SupportedExecutionContractRanges = {
  schemaVersions: [1],
  determinismPolicyVersions: [DETERMINISM_POLICY_VERSION],
  plannerPolicyVersions: [PLANNER_POLICY_VERSION],
  correctionRecipeVersions: [CORRECTION_RECIPE_VERSION],
  validationPolicyVersions: [VALIDATION_POLICY_VERSION],
  randomnessSeeds: [EXECUTION_CONTRACT_RANDOMNESS_SEED]
};
