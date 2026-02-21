import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getTemplate } from "../../../templates/catalog.js";
import { runLightProjectValidation } from "../project-validator.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

test("canonical-backend template scaffold passes light validation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-canonical-template-"));

  try {
    const template = getTemplate("canonical-backend");

    assert.equal(typeof template.starterFiles["src/app.ts"], "string");
    assert.equal(typeof template.starterFiles["src/server.ts"], "string");
    assert.equal(typeof template.starterFiles["src/config/env.ts"], "string");
    assert.equal(typeof template.starterFiles["src/config/logger.ts"], "string");
    assert.equal(typeof template.starterFiles["src/db/prisma.ts"], "string");
    assert.equal(typeof template.starterFiles["src/errors/BaseAppError.ts"], "string");
    assert.equal(typeof template.starterFiles["prisma/schema.prisma"], "string");
    assert.equal(typeof template.starterFiles["tests/integration/health.test.ts"], "string");

    await writeFixtureFiles(root, template.starterFiles);

    const result = await runLightProjectValidation(root);
    const testContractViolations = result.violations.filter((entry) => entry.ruleId.startsWith("TEST.CONTRACT"));

    assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
    assert.equal(result.blockingCount, 0);
    assert.equal(testContractViolations.length, 0, JSON.stringify(testContractViolations, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
