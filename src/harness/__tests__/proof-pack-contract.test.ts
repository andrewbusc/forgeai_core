import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PROOF_PACK_SCHEMA_VERSION,
  buildProofPackHash,
  finalizeProofPack,
  persistProofPack,
  proofPackSchema
} from "../benchmarks/proof-pack-contract.js";

test("proof pack hash is stable for identical payloads", () => {
  const payload = {
    proofPackSchemaVersion: PROOF_PACK_SCHEMA_VERSION,
    startedAt: "2026-03-02T00:00:00.000Z",
    finishedAt: "2026-03-02T00:01:00.000Z",
    git: {
      sha: "abc123"
    },
    config: {
      scale: 1
    },
    steps: [
      {
        name: "phase1-typecheck",
        ok: true,
        exitCode: 0,
        startedAt: "2026-03-02T00:00:00.000Z",
        finishedAt: "2026-03-02T00:00:10.000Z",
        artifacts: ["/tmp/phase1.log"]
      }
    ],
    summary: {
      ok: true,
      failedSteps: []
    }
  };

  assert.equal(buildProofPackHash(payload), buildProofPackHash(payload));
});

test("proof pack payload is canonicalizable and includes proofPackHash", () => {
  const proofPack = finalizeProofPack({
    proofPackSchemaVersion: PROOF_PACK_SCHEMA_VERSION,
    startedAt: "2026-03-02T00:00:00.000Z",
    finishedAt: "2026-03-02T00:01:00.000Z",
    config: {
      scale: 1,
      legalSlowSessions: 5
    },
    steps: [
      {
        name: "phase2-public-pass-decision",
        ok: true,
        exitCode: 0,
        startedAt: "2026-03-02T00:00:10.000Z",
        finishedAt: "2026-03-02T00:00:11.000Z",
        artifacts: ["/tmp/governance-decision.pass.json"],
        details: {
          decision: "PASS",
          contractHash: "hash"
        }
      }
    ],
    summary: {
      ok: true,
      failedSteps: []
    }
  });

  const parsed = proofPackSchema.parse(proofPack);
  assert.equal(parsed.proofPackSchemaVersion, PROOF_PACK_SCHEMA_VERSION);
  assert.equal(parsed.proofPackHash.length, 64);
});

test("persistProofPack writes canonical, content-addressed, and latest proof-pack artifacts", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "deeprun-proof-pack-"));

  try {
    const benchmarkDir = path.join(tmpRoot, "run-001");
    const proofPack = finalizeProofPack({
      proofPackSchemaVersion: PROOF_PACK_SCHEMA_VERSION,
      startedAt: "2026-03-02T00:00:00.000Z",
      finishedAt: "2026-03-02T00:01:00.000Z",
      config: {
        scale: 1
      },
      steps: [],
      summary: {
        ok: true,
        failedSteps: []
      }
    });

    const persisted = await persistProofPack({
      proofPack,
      benchmarkDir,
      rootDir: tmpRoot
    });

    const canonical = JSON.parse(await readFile(persisted.proofPackPath, "utf8")) as { proofPackHash: string };
    const contentAddressed = JSON.parse(await readFile(persisted.contentAddressedPath, "utf8")) as {
      proofPackHash: string;
    };
    const latest = JSON.parse(await readFile(persisted.latestPath, "utf8")) as { proofPackHash: string };

    assert.equal(canonical.proofPackHash, proofPack.proofPackHash);
    assert.equal(contentAddressed.proofPackHash, proofPack.proofPackHash);
    assert.equal(latest.proofPackHash, proofPack.proofPackHash);
    assert.equal(path.basename(persisted.contentAddressedPath), `${proofPack.proofPackHash}.json`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
