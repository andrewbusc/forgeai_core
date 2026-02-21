import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAstValidation } from "../ast-validator.js";

async function createProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-ast-validation-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }

  return root;
}

test("controller prisma import is flagged", async () => {
  const root = await createProject({
    "src/modules/users/controller/users-controller.ts": `
      import { PrismaClient } from "@prisma/client";
      export function handler(): string {
        return String(PrismaClient);
      }
    `
  });

  try {
    const violations = await runAstValidation(root);
    assert.equal(
      violations.some((entry) => entry.ruleId === "AST.CONTROLLER_NO_PRISMA_IMPORT"),
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("service request import is flagged", async () => {
  const root = await createProject({
    "src/modules/users/service/users-service.ts": `
      import type { Request } from "express";
      export function execute(input: Request): string {
        return input.url;
      }
    `
  });

  try {
    const violations = await runAstValidation(root);
    assert.equal(
      violations.some((entry) => entry.ruleId === "AST.SERVICE_NO_REQUEST_IMPORT"),
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("raw Error throw is flagged", async () => {
  const root = await createProject({
    "src/modules/users/service/users-service.ts": `
      export function execute(): void {
        throw new Error("boom");
      }
    `
  });

  try {
    const violations = await runAstValidation(root);
    assert.equal(
      violations.some((entry) => entry.ruleId === "AST.NO_RAW_ERROR_THROW"),
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("typed errors are allowed", async () => {
  const root = await createProject({
    "src/modules/users/service/users-service.ts": `
      class DomainError extends Error {}
      export function execute(): void {
        throw new DomainError("expected");
      }
    `
  });

  try {
    const violations = await runAstValidation(root);
    assert.equal(
      violations.some((entry) => entry.ruleId === "AST.NO_RAW_ERROR_THROW"),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
