# Artifact Contract

This document is authoritative for stable diagnostic artifact names and retention expectations. It is generated from `src/contracts/artifact-contract.ts`, and tests fail if the checked-in doc drifts.

Stable interface rules:
- The governance decision payload is the authoritative pass/fail interface.
- Artifacts are diagnostic. CI and external consumers must not depend on log scraping or artifact body parsing for merge decisions.
- Artifact retention is guaranteed only until terminal state for the originating run/session unless a stricter retention policy is introduced.

| Kind | Path Pattern | Emitted When | Retention Contract | Authoritative |
| --- | --- | --- | --- | --- |
| `governance_decision` | `.deeprun/decisions/<decisionHash>.json` | Every CLI or API governance decision persistence event. | Must exist through run terminal state. Post-terminal cleanup is allowed only after an explicit retention policy is introduced; consumers must not assume indefinite retention. | yes |
| `governance_decision_pointer` | `.deeprun/decisions/latest.json` | Every governance decision persistence event. | Convenience pointer only. It may be overwritten by later decisions and is never authoritative. | no |
| `run_worktree` | `.deeprun/worktrees/<runId>/` | Kernel run start/fork when isolated execution worktree is prepared. | Must exist until the run reaches a terminal state. Post-terminal cleanup may happen under a future retention policy. | no |
| `learning_run_jsonl` | `.deeprun/learning/runs/<runId>.jsonl` | Correction telemetry events append immutable learning rows. | Must exist until the originating run reaches terminal state. Later cleanup is allowed only by explicit retention policy. | no |
| `learning_snapshot` | `.deeprun/learning/snapshots/<runId>_<stepIndex>_<attempt>.json` | Correction telemetry snapshot persistence. | Must exist until the originating run reaches terminal state. Later cleanup is allowed only by explicit retention policy. | no |
| `stub_debt_artifact` | `.deeprun/learning/stub-debt/<runId>_<stepIndex>_<attempt>.json` | Stub debt opens/closes or debt paydown events are recorded. | Must exist until the originating run reaches terminal state. Consumers should treat these as diagnostic and derive pass/fail from the governance decision payload instead. | no |
| `stress_snapshot` | `.deeprun/stress/<sessionId>/window-<NNN>.json` | Stress harness snapshot cadence. | Must exist for the lifetime of the stress session. Future GC may remove them after the configured retention threshold. | no |
| `stress_gate_stop` | `.deeprun/stress/<sessionId>/gate-stop-<NNN>.json` | A stress gate trips. | Must exist through the end of the failed stress session. Future GC may remove them after the configured retention threshold. | no |
| `reliability_matrix_proof_pack` | `.deeprun/reliability-matrix/proof-pack.json` | Reliability matrix runner completes. | Must exist through matrix completion. Future GC may remove it only after the configured retention threshold. | no |

Retention notes:
- No artifact GC is part of the current runtime contract.
- If artifact GC is introduced later, tests must prove that cleanup never happens before terminal state.
