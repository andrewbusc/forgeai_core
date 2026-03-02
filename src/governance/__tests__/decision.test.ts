import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildGovernanceDecisionHash,
  finalizeGovernanceDecision,
  GOVERNANCE_DECISION_SCHEMA_VERSION,
  governanceDecisionSchema,
  persistGovernanceDecision
} from "../decision.js";

test("governance decision hash is stable for identical payloads", () => {
  const payload = {
    decisionSchemaVersion: GOVERNANCE_DECISION_SCHEMA_VERSION,
    decision: "PASS" as const,
    reasonCodes: [],
    reasons: [],
    runId: "11111111-1111-1111-1111-111111111111",
    contract: {
      schemaVersion: 1,
      hash: "abc123",
      determinismPolicyVersion: 1,
      plannerPolicyVersion: 1,
      correctionRecipeVersion: 1,
      validationPolicyVersion: 1,
      randomnessSeed: "forbidden:no-random-branching"
    },
    artifactRefs: [
      {
        kind: "validation_target",
        path: "/tmp/project"
      }
    ]
  };

  assert.equal(buildGovernanceDecisionHash(payload), buildGovernanceDecisionHash({ ...payload }));
});

test("governance decision payload is canonicalizable and includes decisionHash", () => {
  const decision = finalizeGovernanceDecision({
    decisionSchemaVersion: GOVERNANCE_DECISION_SCHEMA_VERSION,
    decision: "FAIL",
    reasonCodes: ["RUN_VALIDATION_FAILED"],
    reasons: [
      {
        code: "RUN_VALIDATION_FAILED",
        message: "validation failed"
      }
    ],
    runId: "22222222-2222-2222-2222-222222222222",
    contract: {
      schemaVersion: 1,
      hash: "def456",
      determinismPolicyVersion: 1,
      plannerPolicyVersion: 1,
      correctionRecipeVersion: 1,
      validationPolicyVersion: 1,
      randomnessSeed: "forbidden:no-random-branching"
    },
    artifactRefs: []
  });

  const parsed = governanceDecisionSchema.parse(decision);
  assert.equal(parsed.decisionHash.length, 64);
  assert.equal(parsed.reasonCodes[0], "RUN_VALIDATION_FAILED");
});

test("persistGovernanceDecision writes content-addressed and latest decision files", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "deeprun-governance-decision-"));

  try {
    const decision = finalizeGovernanceDecision({
      decisionSchemaVersion: GOVERNANCE_DECISION_SCHEMA_VERSION,
      decision: "PASS",
      reasonCodes: [],
      reasons: [],
      runId: "33333333-3333-3333-3333-333333333333",
      contract: {
        schemaVersion: 1,
        hash: "ghi789",
        determinismPolicyVersion: 1,
        plannerPolicyVersion: 1,
        correctionRecipeVersion: 1,
        validationPolicyVersion: 1,
        randomnessSeed: "forbidden:no-random-branching"
      },
      artifactRefs: []
    });

    const persisted = await persistGovernanceDecision({
      decision,
      rootDir: tmpRoot
    });

    const contentAddressed = JSON.parse(await readFile(persisted.decisionPath, "utf8")) as { decisionHash: string };
    const latest = JSON.parse(await readFile(persisted.latestPath, "utf8")) as { decisionHash: string };

    assert.equal(contentAddressed.decisionHash, decision.decisionHash);
    assert.equal(latest.decisionHash, decision.decisionHash);
    assert.equal(path.basename(persisted.decisionPath), `${decision.decisionHash}.json`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
