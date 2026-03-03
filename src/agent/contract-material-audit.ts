export type ContractMaterialCategory =
  | "executionContractSchemaVersion"
  | "determinismPolicyVersion"
  | "plannerPolicyVersion"
  | "correctionRecipeVersion"
  | "validationPolicyVersion"
  | "randomnessSeed"
  | "nonContract";

export interface ContractMaterialAuditEntry {
  file: string;
  symbol: string;
  category: ContractMaterialCategory;
  rationale: string;
}

export interface ContractNormalizationAuditEntry {
  file: string;
  symbol: string;
  category: Exclude<ContractMaterialCategory, "nonContract">;
  rationale: string;
}

export const CONTRACT_MATERIAL_AUDIT: {
  versionedSymbols: ContractMaterialAuditEntry[];
  normalization: ContractNormalizationAuditEntry[];
} = {
  versionedSymbols: [
    {
      file: "src/agent/kernel.ts",
      symbol: "MAX_VALIDATION_AUTO_CORRECTION_ATTEMPTS",
      category: "validationPolicyVersion",
      rationale: "Caps automatic validation correction retries and therefore changes execution branching."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "MAX_PRECOMMIT_INVARIANT_RETRIES_PER_ATTEMPT",
      category: "validationPolicyVersion",
      rationale: "Changes invariant retry behavior before a step is considered terminal."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "IMPORT_RESOLUTION_GUARDRAIL_WINDOW",
      category: "correctionRecipeVersion",
      rationale: "Changes import-resolution pressure routing and recipe escalation."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "IMPORT_RESOLUTION_GUARDRAIL_MIN_COUNT",
      category: "correctionRecipeVersion",
      rationale: "Changes when import guardrail routing becomes active."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "IMPORT_RESOLUTION_GUARDRAIL_MIN_REGRESSION_RATE",
      category: "correctionRecipeVersion",
      rationale: "Changes import guardrail fallback threshold."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "MICRO_TARGETED_STALL_WINDOW",
      category: "correctionRecipeVersion",
      rationale: "Changes stall detection window for correction escalation."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "MICRO_TARGETED_STALL_MIN_RUNS",
      category: "correctionRecipeVersion",
      rationale: "Changes minimum sample size for micro-stall routing."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "MICRO_TARGETED_STALL_MIN_RATE",
      category: "correctionRecipeVersion",
      rationale: "Changes when micro-targeted correction is considered stalled."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "MICRO_TARGETED_STALL_ESCALATION_LIMIT",
      category: "correctionRecipeVersion",
      rationale: "Changes phase escalation threshold after micro-targeted stalls."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "MICRO_TARGETED_STALL_RECONSTRUCTION_LIMIT",
      category: "correctionRecipeVersion",
      rationale: "Changes architecture reconstruction escalation threshold."
    },
    {
      file: "src/agent/kernel.ts",
      symbol: "DEEPRUN_STUB_MARKER_PREFIX",
      category: "correctionRecipeVersion",
      rationale: "Changes stub debt detection and paydown branching."
    },
    {
      file: "src/agent/validation/validation-failure-classifier.ts",
      symbol: "ARCHITECTURE_COLLAPSE_MISSING_LAYER_THRESHOLD",
      category: "plannerPolicyVersion",
      rationale: "Changes architecture-collapse classification thresholds."
    },
    {
      file: "src/agent/validation/validation-failure-classifier.ts",
      symbol: "ARCHITECTURE_COLLAPSE_UNKNOWN_LAYER_FILE_THRESHOLD",
      category: "plannerPolicyVersion",
      rationale: "Changes architecture-collapse classification thresholds."
    },
    {
      file: "src/agent/validation/validation-failure-classifier.ts",
      symbol: "ARCHITECTURE_COLLAPSE_ARCH_BLOCKING_THRESHOLD",
      category: "plannerPolicyVersion",
      rationale: "Changes architecture-collapse classification thresholds."
    },
    {
      file: "src/agent/validation/validation-failure-classifier.ts",
      symbol: "ARCHITECTURE_COLLAPSE_SCORE_THRESHOLD",
      category: "plannerPolicyVersion",
      rationale: "Changes when planner routing is forced into architecture collapse."
    }
  ],
  normalization: [
    {
      file: "src/agent/execution-contract.ts",
      symbol: "normalizeExecutionConfig",
      category: "determinismPolicyVersion",
      rationale: "Any change to normalization/defaulting semantics changes effective contract resolution and must advance determinism policy."
    }
  ]
};

