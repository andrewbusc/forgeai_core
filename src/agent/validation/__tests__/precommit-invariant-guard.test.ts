import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { StagedFileChange } from "../../fs/types.js";
import { runPrecommitInvariantGuard } from "../precommit-invariant-guard.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

function stagedCreate(projectRoot: string, relativePath: string, newContent: string): StagedFileChange {
  return {
    path: relativePath,
    type: "create",
    newContent,
    absolutePath: path.join(projectRoot, relativePath),
    previousContent: null,
    previousContentHash: null,
    nextContentHash: null,
    diffPreview: "",
    diffBytes: 0
  };
}

test("precommit invariant guard blocks repository importing service layer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const repositoryPath = "src/modules/project/repository/project-repository.ts";
    const repositoryContent = [
      "import { projectService } from \"../service/project-service.js\";",
      "export const projectRepository = { projectService };",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      "src/modules/project/service/project-service.ts": "export const projectService = {};\n",
      [repositoryPath]: repositoryContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [stagedCreate(root, repositoryPath, repositoryContent)]
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.violations.some((entry) => entry.ruleId === "INVARIANT.LAYER_REPOSITORY_TO_SERVICE"),
      true,
      JSON.stringify(result.violations, null, 2)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precommit invariant guard blocks cross-module direct service imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const controllerPath = "src/modules/project/controller/project-controller.ts";
    const controllerContent = [
      "import { taskService } from \"../../task/service/task-service.js\";",
      "export const projectController = { taskService };",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      "src/modules/task/service/task-service.ts": "export const taskService = {};\n",
      [controllerPath]: controllerContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [stagedCreate(root, controllerPath, controllerContent)]
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.violations.some((entry) => entry.ruleId === "INVARIANT.CROSS_MODULE_DIRECT_SERVICE_IMPORT"),
      true,
      JSON.stringify(result.violations, null, 2)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precommit invariant guard explains cross-module service imports in tests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const testPath = "src/modules/project/tests/project.service.test.ts";
    const testContent = [
      "import { describe, it, expect } from \"vitest\";",
      "import { taskService } from \"../../task/service/task-service.js\";",
      "describe(\"project service\", () => {",
      "  it(\"uses local service only\", () => expect(taskService).toBeDefined());",
      "});",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      "src/modules/task/service/task-service.ts": "export const taskService = {};\n",
      [testPath]: testContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [stagedCreate(root, testPath, testContent)]
    });

    assert.equal(result.ok, false);
    const violation = result.violations.find((entry) => entry.ruleId === "INVARIANT.CROSS_MODULE_DIRECT_SERVICE_IMPORT");
    assert.ok(violation, JSON.stringify(result.violations, null, 2));
    assert.match(
      String(violation.message),
      /Module tests must import their own module's service layer only/,
      JSON.stringify(result.violations, null, 2)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precommit invariant guard blocks malformed and unresolved imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const servicePath = "src/modules/audit/service/audit-service.ts";
    const serviceContent = [
      "import { prisma } from \"../../db/prisma.js'\";",
      "import { auditRepository } from \"./repository/missing-repository.js\";",
      "export const auditService = { prisma, auditRepository };",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      [servicePath]: serviceContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [stagedCreate(root, servicePath, serviceContent)]
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.violations.some(
        (entry) =>
          entry.ruleId === "INVARIANT.IMPORT_MALFORMED_SPECIFIER" ||
          entry.ruleId === "INVARIANT.IMPORT_MALFORMED_JS_SUFFIX"
      ),
      true,
      JSON.stringify(result.violations, null, 2)
    );
    assert.equal(
      result.violations.some((entry) => entry.ruleId === "INVARIANT.IMPORT_MISSING_TARGET"),
      true,
      JSON.stringify(result.violations, null, 2)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precommit invariant guard explains invented db domain imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const testPath = "src/modules/audit/tests/audit-log.test.ts";
    const testContent = [
      "import { describe, expect, it } from \"vitest\";",
      "import { auditLog } from \"../../db/audit-log.js\";",
      "describe(\"audit log\", () => {",
      "  it(\"loads\", () => expect(auditLog).toBeDefined());",
      "});",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      [testPath]: testContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [stagedCreate(root, testPath, testContent)]
    });

    assert.equal(result.ok, false);
    const missingTarget = result.violations.find((entry) => entry.ruleId === "INVARIANT.IMPORT_MISSING_TARGET");
    assert.ok(missingTarget, JSON.stringify(result.violations, null, 2));
    assert.match(
      String(missingTarget.message),
      /Do not invent domain files under src\/db/,
      JSON.stringify(result.violations, null, 2)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precommit invariant guard explains missing module-local dto imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const servicePath = "src/modules/project/service/project-service.ts";
    const serviceContent = [
      "import type { ProjectDto } from \"../dto/project-dto.js\";",
      "export const projectService = { create: (input: ProjectDto) => input };",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      [servicePath]: serviceContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [stagedCreate(root, servicePath, serviceContent)]
    });

    assert.equal(result.ok, false);
    const missingTarget = result.violations.find((entry) => entry.ruleId === "INVARIANT.IMPORT_MISSING_TARGET");
    assert.ok(missingTarget, JSON.stringify(result.violations, null, 2));
    assert.match(
      String(missingTarget.message),
      /module-local dto\/ or schema\/ file/,
      JSON.stringify(result.violations, null, 2)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precommit invariant guard enforces vitest import in /tests/ files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const testPath = "src/modules/task/tests/task-service.test.ts";
    const testContent = [
      "describe(\"task service\", () => {",
      "  it(\"works\", () => {});",
      "});",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      [testPath]: testContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [stagedCreate(root, testPath, testContent)]
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.violations.some((entry) => entry.ruleId === "INVARIANT.TEST_MISSING_VITEST_IMPORT"),
      true,
      JSON.stringify(result.violations, null, 2)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precommit invariant guard passes valid canonical layer imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-precommit-guard-"));

  try {
    const controllerPath = "src/modules/project/controller/project-controller.ts";
    const controllerContent = [
      "import { projectService } from \"../service/project-service.js\";",
      "import type { ProjectDto } from \"../dto/project-dto.js\";",
      "export const projectController = (input: ProjectDto) => projectService.create(input);",
      ""
    ].join("\n");

    const repositoryPath = "src/modules/project/repository/project-repository.ts";
    const repositoryContent = [
      "import { prisma } from \"../../../db/prisma.js\";",
      "export const projectRepository = { prisma };",
      ""
    ].join("\n");

    await writeFixtureFiles(root, {
      "src/modules/project/service/project-service.ts": "export const projectService = { create: (_input: unknown) => _input };\n",
      "src/modules/project/dto/project-dto.ts": "export interface ProjectDto { name: string }\n",
      "src/db/prisma.ts": "export const prisma = {};\n",
      [controllerPath]: controllerContent,
      [repositoryPath]: repositoryContent
    });

    const result = await runPrecommitInvariantGuard({
      projectRoot: root,
      stagedChanges: [
        stagedCreate(root, controllerPath, controllerContent),
        stagedCreate(root, repositoryPath, repositoryContent)
      ]
    });

    assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
    assert.equal(result.blockingCount, 0);
    assert.equal(result.violations.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
