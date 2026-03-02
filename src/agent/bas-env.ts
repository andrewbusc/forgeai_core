type BasClassification = "CONTRACTUAL" | "NON_CONTRACTUAL";

export interface BasEnvironmentKnob {
  key: string;
  file: string;
  classification: BasClassification;
  surface: string;
  allowedInfluence: string;
}

export const BAS_ENVIRONMENT_KNOBS: BasEnvironmentKnob[] = [
  {
    key: "AGENT_GOAL_MAX_CORRECTIONS",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.maxRuntimeCorrectionAttempts",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_RUNTIME_MAX_CORRECTIONS",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.maxRuntimeCorrectionAttempts",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_OPTIMIZATION_MAX_CORRECTIONS",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.maxHeavyCorrectionAttempts",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_HEAVY_MAX_CORRECTIONS",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.maxHeavyCorrectionAttempts",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "DEEPRUN_PLANNER_TIMEOUT_MS",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.plannerTimeoutMs",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_LIGHT_VALIDATION_MODE",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.lightValidationMode",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_HEAVY_VALIDATION_MODE",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.heavyValidationMode",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_CORRECTION_POLICY_MODE",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.correctionPolicyMode",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_CORRECTION_CONVERGENCE_MODE",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.correctionConvergenceMode",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_FS_MAX_FILES_PER_STEP",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.maxFilesPerStep",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_FS_MAX_TOTAL_DIFF_BYTES",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.maxTotalDiffBytes",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_FS_MAX_FILE_BYTES",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.maxFileBytes",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_FS_ALLOW_ENV_MUTATION",
    file: "src/agent/kernel.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.allowEnvMutation",
    allowedInfluence: "Legacy/new-run fallback only; persisted into execution contract."
  },
  {
    key: "AGENT_RUN_LOCK_STALE_SECONDS",
    file: "src/agent/kernel.ts",
    classification: "NON_CONTRACTUAL",
    surface: "run execution lock recovery",
    allowedInfluence: "Operational lock expiry only; must not change the persisted execution contract."
  },
  {
    key: "DEEPRUN_PLANNER_TIMEOUT_MS",
    file: "src/agent/planner.ts",
    classification: "CONTRACTUAL",
    surface: "executionConfig.plannerTimeoutMs",
    allowedInfluence: "Only as fallback when caller omitted plannerTimeoutMs; kernel persists the normalized value."
  },
  {
    key: "OPENAI_API_KEY",
    file: "src/agent/planner.ts",
    classification: "NON_CONTRACTUAL",
    surface: "planner provider authentication",
    allowedInfluence: "Credential only; run decisions must be driven by persisted provider/model."
  },
  {
    key: "OPENAI_BASE_URL",
    file: "src/agent/planner.ts",
    classification: "NON_CONTRACTUAL",
    surface: "planner provider transport",
    allowedInfluence: "Endpoint routing only; run decisions must be driven by persisted provider/model."
  },
  {
    key: "OPENAI_MODEL",
    file: "src/agent/planner.ts",
    classification: "CONTRACTUAL",
    surface: "run.model default",
    allowedInfluence: "Only when caller omitted model; kernel materializes the effective model before planning."
  },
  {
    key: "OPENROUTER_API_KEY",
    file: "src/agent/planner.ts",
    classification: "NON_CONTRACTUAL",
    surface: "planner provider authentication",
    allowedInfluence: "Credential only; run decisions must be driven by persisted provider/model."
  },
  {
    key: "OPENROUTER_BASE_URL",
    file: "src/agent/planner.ts",
    classification: "NON_CONTRACTUAL",
    surface: "planner provider transport",
    allowedInfluence: "Endpoint routing only; run decisions must be driven by persisted provider/model."
  },
  {
    key: "OPENROUTER_MODEL",
    file: "src/agent/planner.ts",
    classification: "CONTRACTUAL",
    surface: "run.model default",
    allowedInfluence: "Only when caller omitted model; kernel materializes the effective model before planning."
  },
  {
    key: "NODE_ID",
    file: "src/scripts/agent-job-worker.ts",
    classification: "NON_CONTRACTUAL",
    surface: "worker identity",
    allowedInfluence: "Operational worker registration and job attribution only."
  },
  {
    key: "NODE_ROLE",
    file: "src/scripts/agent-job-worker.ts",
    classification: "NON_CONTRACTUAL",
    surface: "worker role routing",
    allowedInfluence: "Operational queue routing only; contract execution decisions remain on the run."
  },
  {
    key: "WORKER_CAPABILITIES",
    file: "src/scripts/agent-job-worker.ts",
    classification: "NON_CONTRACTUAL",
    surface: "worker capability routing",
    allowedInfluence: "Operational claim filtering only."
  },
  {
    key: "WORKER_HEARTBEAT_MS",
    file: "src/scripts/agent-job-worker.ts",
    classification: "NON_CONTRACTUAL",
    surface: "worker heartbeat cadence",
    allowedInfluence: "Operational liveness only."
  },
  {
    key: "WORKER_POLL_MS",
    file: "src/scripts/agent-job-worker.ts",
    classification: "NON_CONTRACTUAL",
    surface: "worker polling cadence",
    allowedInfluence: "Operational queue polling only."
  },
  {
    key: "WORKER_JOB_LEASE_SECONDS",
    file: "src/scripts/agent-job-worker.ts",
    classification: "NON_CONTRACTUAL",
    surface: "job lease duration",
    allowedInfluence: "Operational crash recovery only."
  }
];

const BAS_ENV_KEY_LOOKUP = new Set(BAS_ENVIRONMENT_KNOBS.map((entry) => `${entry.file}:${entry.key}`));

export function readBasEnv(input: { key: string; file: string }): string | undefined {
  if (process.env.DEEPRUN_STRICT_BAS === "1" && !BAS_ENV_KEY_LOOKUP.has(`${input.file}:${input.key}`)) {
    throw new Error(
      `BAS_VIOLATION: undeclared env read ${input.file}:${input.key}. Add it to the BAS inventory before using it.`
    );
  }

  return process.env[input.key];
}
