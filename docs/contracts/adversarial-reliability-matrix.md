# Adversarial Reliability Matrix

This matrix is the Phase 3 proof contract for DeepRun reliability. It exists to prove two things at the same time:

1. the intended negative controls always trip the intended gate
2. legal slow or bounded-progress runs do not create false positives

The matrix is machine-readable through `proof-pack.json`; CI and operators should consume that artifact instead of scraping logs.

## Scope

The Phase 3 matrix covers:

- worker lease reclaim idempotency
- pathological import graph recovery
- long correction loop stall detection
- execution contract injection attempts
- artificial regression spikes
- legal slow convergence

## Worker Death Mid-Job

Crash simulation policy:

- worker A claims a job and starts execution
- worker A dies before acknowledging the `run_jobs` row as complete
- the lease expires
- worker B reclaims the same job and executes the same run deterministically

Idempotency invariants:

- committed run-step side effects must remain exactly-once
- learning event count must not increase on terminal reclaim
- stub debt artifact count must not increase on terminal reclaim
- no duplicate gate-stop artifacts may be emitted

The reference proof lives in the queue reclaim test suite.

## Legal Slow Acceptance Rule

Let:

- `W` = the rolling gate window
- `P` = rolling debt paydown rate in `W`
- `B_t` = `blocking_after` for event `t` in chronological order
- `epsilon` = allowed bounded slack (`legalSlowBlockingEpsilon`)

A window is accepted as **legal slow** iff:

- every event in the window is tagged `scenarioLabel = legal_slow_convergence` (or `metadata.legalSlow = true`)
- no event in the window is marked as a regression
- and at least one of:
  - `P >= debtMinPaydownRate`
  - `B_t` is bounded and non-increasing for the whole window:
    - `B_t <= B_(t-1) + epsilon` for every adjacent pair
    - `B_last <= B_first + epsilon`

If a legal-slow window is accepted, convergence and debt gates must remain quiet. Regression-spike gates still apply.

Target false-positive rate for the deterministic legal-slow matrix:

- `falsePositiveRate = gateTrips / N`
- required threshold: `0%`

## Matrix Cases

Each case produces a pass/fail result, machine-readable reasons, and decision hashes when a run reaches governance evaluation.

| Case | Category | Control | Expected Result |
| --- | --- | --- | --- |
| `pathological-import-graph-positive` | pathological import graphs | positive | no gate, governance PASS |
| `pathological-import-graph-negative` | pathological import graphs | negative | `DEBT_PAYDOWN_FAILURE` |
| `long-correction-loop-negative` | long correction loops | negative | `MICRO_STALL_SPIRAL` |
| `artificial-regression-spike-negative` | artificial regression spikes | negative | `CLUSTER_REGRESSION_SPIKE` |
| `legal-slow-convergence-positive` | legal slow convergence | positive | no gate, false positives = 0 |
| `execution-config-injection-negative` | execution contract injection | negative | explicit `CONTRACT_MISMATCH` |
| `execution-config-injection-positive` | execution contract injection | positive | explicit fork accepted; governance PASS on forked run |

## Proof Pack

The matrix writes:

- `.deeprun/reliability-matrix/proof-pack.json`

Payload shape:

- `proofPackSchemaVersion`
- `proofPackHash`
- `sessionId`
- `createdAt`
- `thresholds`
- `results[]`
  - `name`
  - `category`
  - `control`
  - `pass`
  - `expected`
  - `actual`
  - `reasonCodes`
  - `decisionHashes`
  - `artifacts`

## CI Rule

The reliability workflow must pass only if:

- all negative controls trip the intended gate or contract error
- all positive controls remain quiet
- legal slow false positives remain at `0%`

Artifacts are uploaded for inspection, but the workflow decision should depend on `proof-pack.json`, not logs.

The proof-pack benchmark contract follows the same content-addressable rule as governance decisions:

- `proofPackHash = sha256(canonicalJson(payloadWithoutHash))`
- identical proof packs must produce identical hashes
