import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getTemplate } from "../../../templates/catalog.js";
import { runStructuralValidation } from "../structural-validator.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

test("structural validation passes for canonical backend starter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-structural-canonical-"));

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);

    const violations = await runStructuralValidation(root);
    assert.equal(violations.length, 0, JSON.stringify(violations, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structural validation reports missing required stack dependencies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-structural-package-"));

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);

    const packageJsonPath = path.join(root, "package.json");
    const packageJsonRaw = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as {
      dependencies: Record<string, string>;
    };

    delete packageJson.dependencies.fastify;
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

    const violations = await runStructuralValidation(root);
    const hasDependencyViolation = violations.some(
      (entry) => entry.ruleId === "STRUCTURE.REQUIRED_DEPENDENCY" && entry.target === "fastify"
    );

    assert.equal(hasDependencyViolation, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structural validation requires production NODE_ENV in Dockerfile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-structural-docker-node-env-"));

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);

    const dockerfilePath = path.join(root, "Dockerfile");
    const dockerfileRaw = await readFile(dockerfilePath, "utf8");
    const patchedDockerfile = dockerfileRaw.replace(/ENV NODE_ENV=production\s*/g, "");
    await writeFile(dockerfilePath, patchedDockerfile, "utf8");

    const violations = await runStructuralValidation(root);
    const hasDockerNodeEnvViolation = violations.some(
      (entry) => entry.ruleId === "STRUCTURE.DOCKER_NODE_ENV_PRODUCTION_REQUIRED"
    );

    assert.equal(hasDockerNodeEnvViolation, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structural validation requires .env to be ignored in Docker context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-structural-dockerignore-env-"));

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);

    const dockerignorePath = path.join(root, ".dockerignore");
    const dockerignoreRaw = await readFile(dockerignorePath, "utf8");
    const patchedDockerignore = dockerignoreRaw
      .split(/\r?\n/)
      .filter((entry) => entry.trim() !== ".env")
      .join("\n");
    await writeFile(dockerignorePath, patchedDockerignore, "utf8");

    const violations = await runStructuralValidation(root);
    const hasDockerignoreEnvViolation = violations.some(
      (entry) => entry.ruleId === "STRUCTURE.DOCKERIGNORE_REQUIRED_ENTRY" && entry.target === ".env"
    );

    assert.equal(hasDockerignoreEnvViolation, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
