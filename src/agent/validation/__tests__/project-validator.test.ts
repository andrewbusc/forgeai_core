import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runLightProjectValidation } from "../project-validator.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

async function snapshotTextFiles(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      const content = await readFile(absolute, "utf8");
      result.set(relative, content);
    }
  }

  await walk(root);
  return result;
}

test("light project validation is deterministic and never mutates project files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-validation-determinism-"));

  try {
    await writeFixtureFiles(root, {
      "src/app.ts": "export const app = true;\n",
      "src/server.ts": "export const server = true;\n",
      "src/config/env.ts": "export const env = process.env.NODE_ENV || 'test';\n",
      "src/modules/users/service/users-service.ts": "export const usersService = true;\n",
      "src/middleware/index.ts": "export const middleware = true;\n",
      "src/errors/index.ts": "export class DomainError extends Error {}\n",
      "src/db/index.ts": "export const db = true;\n"
    });

    const before = await snapshotTextFiles(root);
    const first = await runLightProjectValidation(root);
    const second = await runLightProjectValidation(root);
    const after = await snapshotTextFiles(root);

    assert.deepEqual(after, before);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("light project validation includes module test-contract violations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-validation-test-contract-"));

  try {
    await writeFixtureFiles(root, {
      "src/app.ts": "export const app = true;\n",
      "src/server.ts": "export const server = true;\n",
      "src/config/env.ts": "export const env = process.env.NODE_ENV || 'test';\n",
      "src/config/logger.ts": "export const logger = { info() {} };\n",
      "src/modules/users/service/users-service.ts": "export const usersService = true;\n",
      "src/modules/users/controller/users-controller.ts": "export const usersController = true;\n",
      "src/middleware/index.ts": "export const middleware = true;\n",
      "src/errors/BaseAppError.ts": "export class BaseAppError extends Error {}\n",
      "src/errors/DomainError.ts": "export class DomainError extends Error {}\n",
      "src/db/prisma.ts": "export const prisma = {};\n"
    });

    const result = await runLightProjectValidation(root);
    const testContractRules = result.violations
      .filter((entry) => entry.ruleId.startsWith("TEST.CONTRACT"))
      .map((entry) => entry.ruleId);

    assert.equal(result.ok, false);
    assert.equal(result.blockingCount > 0, true);
    assert.equal(testContractRules.length > 0, true, JSON.stringify(result.violations, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
