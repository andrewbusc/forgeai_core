export interface ArtifactContractEntry {
  readonly kind: string;
  readonly pathPattern: string;
  readonly emittedWhen: string;
  readonly retentionContract: string;
  readonly authoritative: boolean;
}

export const artifactContractEntries: readonly ArtifactContractEntry[] = [
  {
    kind: "governance_decision",
    pathPattern: ".deeprun/decisions/<decisionHash>.json",
    emittedWhen: "Every CLI or API governance decision persistence event.",
    retentionContract: "Must exist through run terminal state. Post-terminal cleanup is allowed only after an explicit retention policy is introduced; consumers must not assume indefinite retention.",
    authoritative: true
  },
  {
    kind: "governance_decision_pointer",
    pathPattern: ".deeprun/decisions/latest.json",
    emittedWhen: "Every governance decision persistence event.",
    retentionContract: "Convenience pointer only. It may be overwritten by later decisions and is never authoritative.",
    authoritative: false
  },
  {
    kind: "run_worktree",
    pathPattern: ".deeprun/worktrees/<runId>/",
    emittedWhen: "Kernel run start/fork when isolated execution worktree is prepared.",
    retentionContract: "Must exist until the run reaches a terminal state. Post-terminal cleanup may happen under a future retention policy.",
    authoritative: false
  },
  {
    kind: "learning_run_jsonl",
    pathPattern: ".deeprun/learning/runs/<runId>.jsonl",
    emittedWhen: "Correction telemetry events append immutable learning rows.",
    retentionContract: "Must exist until the originating run reaches terminal state. Later cleanup is allowed only by explicit retention policy.",
    authoritative: false
  },
  {
    kind: "learning_snapshot",
    pathPattern: ".deeprun/learning/snapshots/<runId>_<stepIndex>_<attempt>.json",
    emittedWhen: "Correction telemetry snapshot persistence.",
    retentionContract: "Must exist until the originating run reaches terminal state. Later cleanup is allowed only by explicit retention policy.",
    authoritative: false
  },
  {
    kind: "stub_debt_artifact",
    pathPattern: ".deeprun/learning/stub-debt/<runId>_<stepIndex>_<attempt>.json",
    emittedWhen: "Stub debt opens/closes or debt paydown events are recorded.",
    retentionContract: "Must exist until the originating run reaches terminal state. Consumers should treat these as diagnostic and derive pass/fail from the governance decision payload instead.",
    authoritative: false
  },
  {
    kind: "stress_snapshot",
    pathPattern: ".deeprun/stress/<sessionId>/window-<NNN>.json",
    emittedWhen: "Stress harness snapshot cadence.",
    retentionContract: "Must exist for the lifetime of the stress session. Future GC may remove them after the configured retention threshold.",
    authoritative: false
  },
  {
    kind: "stress_gate_stop",
    pathPattern: ".deeprun/stress/<sessionId>/gate-stop-<NNN>.json",
    emittedWhen: "A stress gate trips.",
    retentionContract: "Must exist through the end of the failed stress session. Future GC may remove them after the configured retention threshold.",
    authoritative: false
  },
  {
    kind: "reliability_matrix_proof_pack",
    pathPattern: ".deeprun/reliability-matrix/proof-pack.json",
    emittedWhen: "Reliability matrix runner completes.",
    retentionContract: "Must exist through matrix completion. Future GC may remove it only after the configured retention threshold.",
    authoritative: false
  }
];

export function renderArtifactContractMarkdown(): string {
  const lines = [
    "# Artifact Contract",
    "",
    "This document is authoritative for stable diagnostic artifact names and retention expectations. It is generated from `src/contracts/artifact-contract.ts`, and tests fail if the checked-in doc drifts.",
    "",
    "Stable interface rules:",
    "- The governance decision payload is the authoritative pass/fail interface.",
    "- Artifacts are diagnostic. CI and external consumers must not depend on log scraping or artifact body parsing for merge decisions.",
    "- Artifact retention is guaranteed only until terminal state for the originating run/session unless a stricter retention policy is introduced.",
    "",
    "| Kind | Path Pattern | Emitted When | Retention Contract | Authoritative |",
    "| --- | --- | --- | --- | --- |"
  ];

  for (const entry of artifactContractEntries) {
    lines.push(
      `| \`${entry.kind}\` | \`${entry.pathPattern}\` | ${entry.emittedWhen} | ${entry.retentionContract} | ${entry.authoritative ? "yes" : "no"} |`
    );
  }

  lines.push("", "Retention notes:", "- No artifact GC is part of the current runtime contract.", "- If artifact GC is introduced later, tests must prove that cleanup never happens before terminal state.");

  return `${lines.join("\n")}\n`;
}
