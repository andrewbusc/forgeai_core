import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { CONTRACT_MATERIAL_AUDIT } from "../contract-material-audit.js";
import {
  buildExecutionContractMaterial,
  EXECUTION_CONFIG_SCHEMA_VERSION
} from "../execution-contract.js";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const auditDocPath = path.join(rootDir, "docs", "contracts", "contract-material-audit.md");

function parseMachineAudit(markdown: string): typeof CONTRACT_MATERIAL_AUDIT {
  const jsonMatch = markdown.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(jsonMatch, "contract-material-audit.md must include a machine-readable JSON block");
  return JSON.parse(jsonMatch[1]) as typeof CONTRACT_MATERIAL_AUDIT;
}

function scanTopLevelPolicyConsts(content: string): string[] {
  const matches = content.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=/gm);
  return Array.from(matches, (match) => match[1]).sort();
}

test("contract material audit doc matches code registry", async () => {
  const markdown = await readFile(auditDocPath, "utf8");
  const fromDoc = parseMachineAudit(markdown);

  assert.deepEqual(fromDoc, CONTRACT_MATERIAL_AUDIT);
});

test("audited policy files contain no unregistered top-level policy constants", async () => {
  const files = Array.from(new Set(CONTRACT_MATERIAL_AUDIT.versionedSymbols.map((entry) => entry.file))).sort();

  for (const relativePath of files) {
    const absolutePath = path.join(rootDir, relativePath);
    const content = await readFile(absolutePath, "utf8");
    const discovered = scanTopLevelPolicyConsts(content);
    const expected = CONTRACT_MATERIAL_AUDIT.versionedSymbols
      .filter((entry) => entry.file === relativePath)
      .map((entry) => entry.symbol)
      .sort();

    assert.deepEqual(
      discovered,
      expected,
      `${relativePath} contains unregistered policy-driving constants; add them to contract-material-audit`
    );
  }
});

test("normalization coupling is explicitly audited", async () => {
  const normalizationEntry = CONTRACT_MATERIAL_AUDIT.normalization.find(
    (entry) => entry.file === "src/agent/execution-contract.ts" && entry.symbol === "normalizeExecutionConfig"
  );

  assert.ok(normalizationEntry, "normalizeExecutionConfig must be declared in the contract material audit");
  assert.equal(normalizationEntry?.category, "determinismPolicyVersion");

  const content = await readFile(path.join(rootDir, "src", "agent", "execution-contract.ts"), "utf8");
  assert.match(content, /\bfunction normalizeExecutionConfig\(/);
});

test("execution contract material exposes all required versioned policy fields", () => {
  const material = buildExecutionContractMaterial({
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "full",
    lightValidationMode: "enforce",
    heavyValidationMode: "enforce",
    maxRuntimeCorrectionAttempts: 2,
    maxHeavyCorrectionAttempts: 2,
    correctionPolicyMode: "enforce",
    correctionConvergenceMode: "enforce",
    plannerTimeoutMs: 30_000,
    maxFilesPerStep: 20,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  });

  assert.equal(typeof material.executionContractSchemaVersion, "number");
  assert.equal(typeof material.determinismPolicyVersion, "number");
  assert.equal(typeof material.plannerPolicyVersion, "number");
  assert.equal(typeof material.correctionRecipeVersion, "number");
  assert.equal(typeof material.validationPolicyVersion, "number");
  assert.equal(typeof material.randomnessSeed, "string");
});

