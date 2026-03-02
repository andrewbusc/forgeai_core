# Execution Contract

DeepRun kernel runs execute under a persisted execution contract. The contract is attached to `agent_runs.metadata` and is authoritative for queue execution, resume, fork, CLI status, API run detail, and worker compatibility checks.

## Execution Contract Schema

Current execution contract schema version: `1`

Normalized `executionConfig` schema:

```json
{
  "schemaVersion": 1,
  "profile": "full | ci | smoke",
  "lightValidationMode": "off | warn | enforce",
  "heavyValidationMode": "off | warn | enforce",
  "maxRuntimeCorrectionAttempts": "0..5",
  "maxHeavyCorrectionAttempts": "0..3",
  "correctionPolicyMode": "off | warn | enforce",
  "correctionConvergenceMode": "off | warn | enforce",
  "plannerTimeoutMs": "1000..300000",
  "maxFilesPerStep": "1..100",
  "maxTotalDiffBytes": "1000..10000000",
  "maxFileBytes": "1000..20000000",
  "allowEnvMutation": "boolean"
}
```

Persisted metadata keys:

- `executionConfig`
- `executionContractSchemaVersion`
- `executionContractHash`
- `executionContractMaterial`
- `effectiveExecutionConfig`
- `executionContractFallbackUsed`
- `executionContractFallbackFields`

`effectiveExecutionConfig` is the normalized snapshot. `executionConfig` is kept in sync with it for compatibility.

## Contract Material

The closed contract material is:

```json
{
  "executionContractSchemaVersion": 1,
  "normalizedExecutionConfig": "{normalized executionConfig}",
  "determinismPolicyVersion": 1,
  "plannerPolicyVersion": 1,
  "correctionRecipeVersion": 1,
  "validationPolicyVersion": 1,
  "randomnessSeed": "forbidden:no-random-branching"
}
```

Hash algorithm:

`executionContractHash = sha256(canonicalJson(executionContractMaterial))`

Canonical JSON rule:

- objects are recursively key-sorted before hashing
- arrays preserve element order
- no field may be omitted from contract material if it affects branching

Rule:

- any code change that affects branching must increment one of:
  - `executionContractSchemaVersion`
  - `determinismPolicyVersion`
  - `plannerPolicyVersion`
  - `correctionRecipeVersion`
  - `validationPolicyVersion`

## Resolution Order

The authoritative resolver is implemented in [execution-contract.ts](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/src/agent/execution-contract.ts).

Resolution order:

1. persisted `run.metadata.executionConfig`
2. explicit CLI/API requested overrides
3. environment fallback
4. hard defaults

Rules:

- a persisted contract is authoritative once present
- env fallback is allowed only when a run has no persisted contract yet
- fallback usage is recorded with:
  - `executionContractFallbackUsed=true`
  - `executionContractFallbackFields=[...]`

## Profile Presets

`full`
- default strict validation and correction caps

`ci`
- `lightValidationMode=off`
- `heavyValidationMode=off`
- `maxRuntimeCorrectionAttempts=0`
- `maxHeavyCorrectionAttempts=0`
- `correctionPolicyMode=warn`
- `correctionConvergenceMode=warn`
- `plannerTimeoutMs=5000`

`smoke`
- `lightValidationMode=warn`
- `heavyValidationMode=warn`
- `maxRuntimeCorrectionAttempts=1`
- `maxHeavyCorrectionAttempts=1`
- `correctionPolicyMode=warn`
- `correctionConvergenceMode=warn`
- `plannerTimeoutMs=10000`

## Resume and Fork Rules

Resume:

- resume uses the persisted execution contract by default
- legacy runs with no persisted contract get one attached deterministically on first continue/resume
- worker environment must not silently mutate a resumed run's contract

Mismatch handling:

- if requested execution config differs from persisted config:
  - `--override-execution-config`: mutate the existing run contract, then resume in place
  - `--fork`: create a new queued run with the requested contract
  - otherwise: fail with explicit contract mismatch details

Fork:

- source run keeps its original execution contract and hash
- forked run receives a new execution contract and hash
- forked resume creates a new `runId`

## Runtime Proof and Enforcement

Run detail and CLI status surface:

- `schemaVersion`
- `hash`
- contract material policy versions
- `randomnessSeed`
- normalized effective config
- fallback provenance

Worker execution asserts:

- stored contract material is supported by the worker runtime
- stored schema version matches recomputed schema version
- stored contract hash matches recomputed contract hash
- stored effective config matches recomputed normalized config
- stored contract material matches recomputed material when present

Failure modes:

- `CONTRACT_MISMATCH`: stored contract metadata is inconsistent with recomputed normalized contract material
- `UNSUPPORTED_CONTRACT`: worker/runtime does not support the run's contract schema/policy versions

`UNSUPPORTED_CONTRACT` is governance-visible and must not require log scraping.
