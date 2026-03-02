# Phase 1 Definition Of Done

Phase 1 is complete when there are no invisible behavior levers in the kernel/planner/worker path and contract drift fails closed instead of silently changing execution.

## 1. Contract Spec Is Explicit

- [x] A versioned execution contract spec exists in [execution-contract.md](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/docs/contracts/execution-contract.md).
- [x] The spec defines:
  - execution contract schema version
  - canonical normalized `effectiveExecutionConfig`
  - stable contract hash derivation
  - lifecycle rules for runs and jobs
  - resume/fork rules
- [x] The behavior-affecting surface inventory exists in [behavior-affecting-surface.md](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/docs/contracts/behavior-affecting-surface.md).

## 2. All Contractual Knobs Are Persisted

- [x] New runs persist:
  - `executionConfig`
  - `executionContractSchemaVersion`
  - `executionContractHash`
  - `effectiveExecutionConfig`
  - `executionContractFallbackUsed`
  - `executionContractFallbackFields`
- [x] Resume of legacy runs attaches a deterministic persisted contract on first continue.
- [x] File-session mutation limits are part of the execution contract:
  - `maxFilesPerStep`
  - `maxTotalDiffBytes`
  - `maxFileBytes`
  - `allowEnvMutation`
- [x] Effective model selection is materialized before planning when the caller omits `model`.

## 3. No Silent Contract Drift

- [x] Resume uses the persisted contract by default.
- [x] Contract mismatch is rejected unless the caller uses:
  - `--override-execution-config`, or
  - `--fork`
- [x] Fork creates a new run with a new contract and leaves the source run unchanged.
- [x] Worker execution asserts stored contract metadata against recomputed normalized config and fails with `CONTRACT_MISMATCH` if they diverge.

## 4. No Invisible Env Reads

- [x] Every env read in:
  - `src/agent/kernel.ts`
  - `src/agent/planner.ts`
  - `src/scripts/agent-job-worker.ts`
  is declared in the BAS inventory and classified as `CONTRACTUAL` or `NON_CONTRACTUAL`.
- [x] Contractual env reads are only allowed as fallback when no persisted execution contract exists yet.
- [x] Fallback provenance is persisted on the run contract.

## 5. Proof Tests Are Green

Required proof set:

- [x] `npm run check`
- [x] [execution-contract.test.ts](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/src/agent/__tests__/execution-contract.test.ts)
- [x] [behavior-affecting-surface.test.ts](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/src/agent/__tests__/behavior-affecting-surface.test.ts)
- [x] Focused contract lifecycle tests in [kernel-run-flow.test.ts](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/src/agent/__tests__/kernel-run-flow.test.ts)
- [x] Focused API/CLI contract tests in:
  - [agent-kernel-routes.test.ts](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/src/__tests__/agent-kernel-routes.test.ts)
  - [deeprun-cli.test.ts](/home/ab/compute-storage/Data/01_Projects/_Projects/_deeprun/src/__tests__/deeprun-cli.test.ts)

## 6. Operator Visibility Exists

- [x] Run detail exposes execution config summary.
- [x] Run detail exposes contract metadata:
  - schema version
  - hash
  - fallback used
  - fallback fields
- [x] CLI `status` prints the same contract summary.

## 7. Exit Rule

Phase 1 is closed only if this statement is true:

> There is no behavior-affecting knob in the kernel/planner/worker path that can change run decisions without being reflected in persisted run state and the execution contract hash.

## 8. Current Status

As of March 1, 2026, the focused Phase 1 contract path is green locally.

What is done:

- persisted normalized execution contracts
- stable contract hashing
- worker-side contract mismatch fail-closed
- BAS inventory plus machine-enforced env coverage
- focused contract lifecycle proof tests

What is still recommended before broader production rollout, but is not required to call Phase 1 closed:

- wire the focused contract proof suite into required CI
- add a legacy-run audit script for runs missing contract metadata
- complete worker authentication / control-plane auth hardening
