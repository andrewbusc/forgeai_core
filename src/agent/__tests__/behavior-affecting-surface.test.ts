import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BAS_ENVIRONMENT_KNOBS, readBasEnv } from "../bas-env.js";
import { buildTree, collectFiles } from "../../lib/fs-utils.js";

interface BasInventory {
  executionContract: {
    schemaVersion: number;
    fields: string[];
  };
  environmentKnobs: Array<{
    key: string;
    file: string;
    classification: "CONTRACTUAL" | "NON_CONTRACTUAL";
    surface: string;
    allowedInfluence: string;
  }>;
  determinismConstraints: {
    clockPolicy: string;
    filesystemPolicy: string;
    randomnessPolicy: string;
    networkPolicy: string;
  };
  forbiddenPrimitives: {
    directEnvReads: string[];
    wallClockForBranching: string[];
    randomness: string[];
  };
}

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const basDocPath = path.join(rootDir, "docs", "contracts", "behavior-affecting-surface.md");
const basDecisionFiles = [
  "src/agent/kernel.ts",
  "src/agent/planner.ts",
  "src/scripts/agent-job-worker.ts"
];

async function loadBasInventory(): Promise<BasInventory> {
  const markdown = await readFile(basDocPath, "utf8");
  const jsonMatch = markdown.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(jsonMatch, "behavior-affecting-surface.md must include a machine-readable JSON block");
  return JSON.parse(jsonMatch[1]) as BasInventory;
}

test("behavior-affecting surface inventory matches code BAS env declarations", async () => {
  const inventory = await loadBasInventory();
  const fromDoc = inventory.environmentKnobs
    .map((entry) => `${entry.file}:${entry.key}:${entry.classification}:${entry.surface}:${entry.allowedInfluence}`)
    .sort();
  const fromCode = BAS_ENVIRONMENT_KNOBS
    .map((entry) => `${entry.file}:${entry.key}:${entry.classification}:${entry.surface}:${entry.allowedInfluence}`)
    .sort();

  assert.deepEqual(fromDoc, fromCode);
});

test("behavior-affecting surface doc declares determinism constraints and forbidden primitives", async () => {
  const inventory = await loadBasInventory();

  assert.ok(inventory.determinismConstraints.clockPolicy.trim().length > 0);
  assert.ok(inventory.determinismConstraints.filesystemPolicy.trim().length > 0);
  assert.ok(inventory.determinismConstraints.randomnessPolicy.trim().length > 0);
  assert.ok(inventory.determinismConstraints.networkPolicy.trim().length > 0);
  assert.ok(inventory.forbiddenPrimitives.directEnvReads.includes("process.env"));
  assert.ok(inventory.forbiddenPrimitives.wallClockForBranching.includes("Date.now"));
  assert.ok(inventory.forbiddenPrimitives.randomness.includes("Math.random"));
});

test("decision-path files do not use forbidden primitives directly", async () => {
  for (const relativePath of basDecisionFiles) {
    const content = await readFile(path.join(rootDir, relativePath), "utf8");
    assert.equal(/process\.env\.[A-Z0-9_]+/.test(content), false, `${relativePath} must use readBasEnv instead of process.env`);
    assert.equal(/Math\.random\(/.test(content), false, `${relativePath} must not use Math.random in decision paths`);
    assert.equal(/Date\.now\(/.test(content), false, `${relativePath} must not use Date.now in decision paths`);
  }
});

test("strict BAS mode throws on undeclared env reads", () => {
  const previous = process.env.DEEPRUN_STRICT_BAS;
  process.env.DEEPRUN_STRICT_BAS = "1";

  try {
    assert.throws(
      () => readBasEnv({ key: "UNDECLARED_ENV_KEY", file: "src/agent/kernel.ts" }),
      /BAS_VIOLATION/
    );
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPRUN_STRICT_BAS;
    } else {
      process.env.DEEPRUN_STRICT_BAS = previous;
    }
  }
});

test("filesystem traversal helpers return deterministic sorted output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-bas-fs-"));

  try {
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "src", "zeta"));
    await mkdir(path.join(root, "src", "alpha"));
    await writeFile(path.join(root, "src", "zeta", "b.txt"), "b");
    await writeFile(path.join(root, "src", "alpha", "a.txt"), "a");

    const tree = await buildTree(root);
    const files = await collectFiles(root, 10, 100);

    assert.deepEqual(
      tree.map((entry) => entry.path),
      ["src"]
    );
    assert.deepEqual(
      tree[0]?.children?.map((entry) => entry.path),
      ["src/alpha", "src/zeta"]
    );
    assert.deepEqual(
      files.map((entry) => entry.path),
      ["src/alpha/a.txt", "src/zeta/b.txt"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
