import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendLearningJsonl, writeSnapshot } from "../learning-writer.js";

test("learning writer appends JSONL and writes immutable attempt snapshots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-learning-"));

  try {
    const payloadOne = {
      runId: "run-123",
      stepIndex: 4,
      outcome: "noop"
    };
    const payloadTwo = {
      runId: "run-123",
      stepIndex: 4,
      outcome: "success"
    };

    await appendLearningJsonl(root, "run-123", payloadOne);
    await appendLearningJsonl(root, "run-123", payloadTwo);
    await writeSnapshot(root, "run-123", 4, 1, payloadOne);
    await writeSnapshot(root, "run-123", 4, 2, payloadTwo);

    const jsonlPath = path.join(root, ".deeprun", "learning", "runs", "run-123.jsonl");
    const snapshotOnePath = path.join(root, ".deeprun", "learning", "snapshots", "run-123_4_1.json");
    const snapshotTwoPath = path.join(root, ".deeprun", "learning", "snapshots", "run-123_4_2.json");

    const jsonl = await readFile(jsonlPath, "utf8");
    const snapshotOne = await readFile(snapshotOnePath, "utf8");
    const snapshotTwo = await readFile(snapshotTwoPath, "utf8");

    const lines = jsonl
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { outcome?: string });

    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.outcome, "noop");
    assert.equal(lines[1]?.outcome, "success");
    assert.match(snapshotOne, /"outcome": "noop"/);
    assert.match(snapshotTwo, /"outcome": "success"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
