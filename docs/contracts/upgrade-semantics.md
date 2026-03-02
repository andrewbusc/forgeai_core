# Upgrade Semantics

## Policy

In-flight runs must finish under their original execution contract hash.

Workers may execute only contracts they support. Support is defined by the worker/runtime allowlist for:

- `executionContractSchemaVersion`
- `determinismPolicyVersion`
- `plannerPolicyVersion`
- `correctionRecipeVersion`
- `validationPolicyVersion`
- `randomnessSeed`

The current support allowlist is implemented in [contract-policy.ts](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/src/agent/contract-policy.ts).

## Worker Behavior

On claim/execute, the worker:

1. loads the persisted run contract material
2. checks whether the contract material is supported
3. refuses execution if unsupported
4. surfaces `UNSUPPORTED_CONTRACT` as a machine-readable failure reason

## Migration Rules

- Existing runs are never silently upgraded in place by a worker.
- Legacy runs with no persisted contract get a deterministic current contract attached on first continue/resume.
- Runs with a persisted contract must keep that contract unless the operator explicitly:
  - resumes with `--override-execution-config`, or
  - forks with `--fork`

## Unsupported Contracts

If a worker cannot support a run's contract:

- it must not execute the run
- it must emit `UNSUPPORTED_CONTRACT`
- governance must return `FAIL` with an `UNSUPPORTED_CONTRACT` reason

Current implementation fails the run closed when an incompatible worker attempts execution. Leaving the job queued or moving it to a blocked state remains a future enhancement; the important invariant is deterministic refusal without silent fallback.
