# Behavior Affecting Surface

This document is the authoritative inventory for behavior-affecting inputs in the kernel/planner/worker path. The JSON block below is machine-checked against the runtime BAS declarations.

## Classification Rules

- `CONTRACTUAL`: can change run decisions and must be reflected in persisted contract material before a worker executes the run.
- `NON_CONTRACTUAL`: operational/runtime only. These may affect availability, connectivity, logging, or queue mechanics, but they must not silently change an already-persisted run's execution decisions.

## Machine Inventory

```json
{
  "executionContract": {
    "schemaVersion": 1,
    "fields": [
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
    ]
  },
  "runInputs": [
    "providerId",
    "model",
    "goal",
    "project template/config",
    "repo/worktree state",
    "seed derivation spec"
  ],
  "plannerRoutingPolicies": [
    "planner policy version",
    "persisted provider/model selection",
    "profile preset normalization"
  ],
  "correctionRoutingPolicies": [
    "correction recipe version",
    "import-resolution recipe routing",
    "phase escalation and stall routing",
    "correction constraints derived from executionConfig file/diff caps"
  ],
  "validationPolicies": [
    "lightValidationMode",
    "heavyValidationMode",
    "validation policy version"
  ],
  "retryBackoffPolicies": [
    "maxRuntimeCorrectionAttempts",
    "maxHeavyCorrectionAttempts",
    "plannerTimeoutMs",
    "job lease duration is operational, not contractual"
  ],
  "environmentKnobs": [
    {
      "key": "AGENT_GOAL_MAX_CORRECTIONS",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.maxRuntimeCorrectionAttempts",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_RUNTIME_MAX_CORRECTIONS",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.maxRuntimeCorrectionAttempts",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_OPTIMIZATION_MAX_CORRECTIONS",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.maxHeavyCorrectionAttempts",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_HEAVY_MAX_CORRECTIONS",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.maxHeavyCorrectionAttempts",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "DEEPRUN_PLANNER_TIMEOUT_MS",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.plannerTimeoutMs",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_LIGHT_VALIDATION_MODE",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.lightValidationMode",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_HEAVY_VALIDATION_MODE",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.heavyValidationMode",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_CORRECTION_POLICY_MODE",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.correctionPolicyMode",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_CORRECTION_CONVERGENCE_MODE",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.correctionConvergenceMode",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_FS_MAX_FILES_PER_STEP",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.maxFilesPerStep",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_FS_MAX_TOTAL_DIFF_BYTES",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.maxTotalDiffBytes",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_FS_MAX_FILE_BYTES",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.maxFileBytes",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_FS_ALLOW_ENV_MUTATION",
      "file": "src/agent/kernel.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.allowEnvMutation",
      "allowedInfluence": "Legacy/new-run fallback only; persisted into execution contract."
    },
    {
      "key": "AGENT_RUN_LOCK_STALE_SECONDS",
      "file": "src/agent/kernel.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "run execution lock recovery",
      "allowedInfluence": "Operational lock expiry only; must not change the persisted execution contract."
    },
    {
      "key": "DEEPRUN_PLANNER_TIMEOUT_MS",
      "file": "src/agent/planner.ts",
      "classification": "CONTRACTUAL",
      "surface": "executionConfig.plannerTimeoutMs",
      "allowedInfluence": "Only as fallback when caller omitted plannerTimeoutMs; kernel persists the normalized value."
    },
    {
      "key": "OPENAI_API_KEY",
      "file": "src/agent/planner.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "planner provider authentication",
      "allowedInfluence": "Credential only; run decisions must be driven by persisted provider/model."
    },
    {
      "key": "OPENAI_BASE_URL",
      "file": "src/agent/planner.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "planner provider transport",
      "allowedInfluence": "Endpoint routing only; run decisions must be driven by persisted provider/model."
    },
    {
      "key": "OPENAI_MODEL",
      "file": "src/agent/planner.ts",
      "classification": "CONTRACTUAL",
      "surface": "run.model default",
      "allowedInfluence": "Only when caller omitted model; kernel materializes the effective model before planning."
    },
    {
      "key": "OPENROUTER_API_KEY",
      "file": "src/agent/planner.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "planner provider authentication",
      "allowedInfluence": "Credential only; run decisions must be driven by persisted provider/model."
    },
    {
      "key": "OPENROUTER_BASE_URL",
      "file": "src/agent/planner.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "planner provider transport",
      "allowedInfluence": "Endpoint routing only; run decisions must be driven by persisted provider/model."
    },
    {
      "key": "OPENROUTER_MODEL",
      "file": "src/agent/planner.ts",
      "classification": "CONTRACTUAL",
      "surface": "run.model default",
      "allowedInfluence": "Only when caller omitted model; kernel materializes the effective model before planning."
    },
    {
      "key": "NODE_ID",
      "file": "src/scripts/agent-job-worker.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "worker identity",
      "allowedInfluence": "Operational worker registration and job attribution only."
    },
    {
      "key": "NODE_ROLE",
      "file": "src/scripts/agent-job-worker.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "worker role routing",
      "allowedInfluence": "Operational queue routing only; contract execution decisions remain on the run."
    },
    {
      "key": "WORKER_CAPABILITIES",
      "file": "src/scripts/agent-job-worker.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "worker capability routing",
      "allowedInfluence": "Operational claim filtering only."
    },
    {
      "key": "WORKER_HEARTBEAT_MS",
      "file": "src/scripts/agent-job-worker.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "worker heartbeat cadence",
      "allowedInfluence": "Operational liveness only."
    },
    {
      "key": "WORKER_POLL_MS",
      "file": "src/scripts/agent-job-worker.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "worker polling cadence",
      "allowedInfluence": "Operational queue polling only."
    },
    {
      "key": "WORKER_JOB_LEASE_SECONDS",
      "file": "src/scripts/agent-job-worker.ts",
      "classification": "NON_CONTRACTUAL",
      "surface": "job lease duration",
      "allowedInfluence": "Operational crash recovery only."
    }
  ],
  "filesystemAccessPatterns": [
    {
      "helper": "src/lib/fs-utils.ts#buildTree",
      "policy": "Entries must be sorted by normalized path before selection or traversal."
    },
    {
      "helper": "src/lib/fs-utils.ts#collectFiles",
      "policy": "Entries must be sorted by normalized path before traversal; traversal order must be stable across runs."
    }
  ],
  "timeAccessPatterns": [
    {
      "surface": "plannerTimeoutMs",
      "policy": "Contractual deadline budget only; wall clock must not select plans or correction branches."
    },
    {
      "surface": "worker lease duration / poll cadence",
      "policy": "Operational only; affects liveness and crash recovery, not persisted branching."
    }
  ],
  "randomnessSources": [
    {
      "source": "randomUUID identifiers",
      "classification": "NON_CONTRACTUAL",
      "allowedInfluence": "Identifiers only; must not drive planner, correction, or governance branching."
    }
  ],
  "externalDependencies": [
    {
      "name": "filesystem",
      "classification": "ALLOWED",
      "notes": "Workspace reads/writes are explicit run inputs and must use deterministic traversal order."
    },
    {
      "name": "network",
      "classification": "FORBIDDEN_FOR_GOVERNANCE_CORE",
      "notes": "Governance decisions must not depend on external network responses. Provider calls are allowed only before governance and must be explicit in the run."
    },
    {
      "name": "clock",
      "classification": "ALLOWED_WITH_CONSTRAINTS",
      "notes": "Wall clock is allowed for timestamps and operational deadlines only; it must not branch correction or governance decisions."
    }
  ],
  "determinismConstraints": {
    "clockPolicy": "Wall clock is forbidden for branching in kernel/planner/worker decision paths. Only contractual budgets may bound execution.",
    "filesystemPolicy": "Traversal and selection must be canonicalized with deterministic path sorting using locale-independent normalized paths.",
    "randomnessPolicy": "Random branching is forbidden. Any randomness must be represented by an explicit contractual seed; current contract uses the fixed seed derivation spec 'forbidden:no-random-branching'.",
    "networkPolicy": "Governance core is network-independent. External provider traffic must not affect governance decisions after run state is persisted."
  },
  "forbiddenPrimitives": {
    "directEnvReads": ["process.env"],
    "wallClockForBranching": ["Date.now"],
    "randomness": ["Math.random"]
  }
}
```

## Enforcement Notes

- Kernel/planner/worker code must read env via the BAS helper, not raw `process.env`.
- CI/runtime strict mode is `DEEPRUN_STRICT_BAS=1`; undeclared env reads then throw immediately.
- Decision-path tests forbid direct `process.env`, `Math.random`, and `Date.now` in kernel/planner/worker.
- Deterministic filesystem helpers are covered by tests against `buildTree(...)` and `collectFiles(...)`.
