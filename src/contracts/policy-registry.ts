export const DETERMINISM_POLICY_VERSION = 1 as const;
export const NORMALIZATION_POLICY_VERSION = 1 as const;
export const PLANNER_POLICY_VERSION = 1 as const;
export const CORRECTION_RECIPE_VERSION = 1 as const;
export const VALIDATION_POLICY_VERSION = 1 as const;
export const GOVERNANCE_POLICY_VERSION = 1 as const;
export const EXECUTION_CONTRACT_RANDOMNESS_SEED = "forbidden:no-random-branching" as const;

export const POLICY_REGISTRY = {
  determinismPolicyVersion: DETERMINISM_POLICY_VERSION,
  normalizationPolicyVersion: NORMALIZATION_POLICY_VERSION,
  plannerPolicyVersion: PLANNER_POLICY_VERSION,
  correctionRecipeVersion: CORRECTION_RECIPE_VERSION,
  validationPolicyVersion: VALIDATION_POLICY_VERSION,
  governancePolicyVersion: GOVERNANCE_POLICY_VERSION
} as const;

export type PolicyRegistry = typeof POLICY_REGISTRY;

