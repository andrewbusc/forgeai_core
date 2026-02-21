import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getTemplate } from "../../../templates/catalog.js";
import { architectureContractV1 } from "../contract.js";
import { runArchitectureCheck } from "../check-architecture.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

test("check-architecture report includes contract metadata and blocks violations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-check-architecture-fail-"));

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

    const report = await runArchitectureCheck(root);

    assert.equal(report.ok, false);
    assert.equal(report.blockingCount > 0, true);
    assert.equal(report.contractVersion, architectureContractV1.version);
    assert.equal(report.deterministicOrdering, true);
    assert.equal(report.noMutation, true);
    assert.equal(report.byRule.some((entry) => entry.ruleId.startsWith("TEST.CONTRACT")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("check-architecture report passes for canonical backend template fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-check-architecture-pass-"));

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);

    const report = await runArchitectureCheck(root);

    assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
    assert.equal(report.blockingCount, 0);
    assert.equal(report.contractVersion, architectureContractV1.version);
    assert.equal(report.byRule.some((entry) => entry.ruleId.startsWith("TEST.CONTRACT")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
