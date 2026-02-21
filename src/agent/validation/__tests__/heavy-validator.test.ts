import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getTemplate } from "../../../templates/catalog.js";
import { runHeavyProjectValidation } from "../heavy-validator.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

async function writePackageWithScripts(input: {
  root: string;
  startScript: string;
  includeSeedScript: boolean;
}): Promise<void> {
  const packageJsonPath = path.join(input.root, "package.json");
  const packageJsonRaw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonRaw) as {
    scripts?: Record<string, string>;
  };

  const scripts = packageJson.scripts || {};
  scripts.check = "node -e \"process.exit(0)\"";
  scripts.build = "node -e \"process.exit(0)\"";
  scripts.test = "node -e \"process.exit(0)\"";
  scripts["prisma:migrate"] = "node -e \"process.exit(0)\"";
  scripts.start = input.startScript;
  if (input.includeSeedScript) {
    scripts["prisma:seed"] = "node -e \"process.exit(0)\"";
  } else {
    delete scripts["prisma:seed"];
  }

  packageJson.scripts = scripts;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

function withHeavyTestEnv(): () => void {
  const previousInstall = process.env.AGENT_HEAVY_INSTALL_DEPS;
  const previousBootTimeout = process.env.AGENT_HEAVY_BOOT_TIMEOUT_MS;

  process.env.AGENT_HEAVY_INSTALL_DEPS = "false";
  process.env.AGENT_HEAVY_BOOT_TIMEOUT_MS = "2500";

  return () => {
    if (previousInstall === undefined) {
      delete process.env.AGENT_HEAVY_INSTALL_DEPS;
    } else {
      process.env.AGENT_HEAVY_INSTALL_DEPS = previousInstall;
    }

    if (previousBootTimeout === undefined) {
      delete process.env.AGENT_HEAVY_BOOT_TIMEOUT_MS;
    } else {
      process.env.AGENT_HEAVY_BOOT_TIMEOUT_MS = previousBootTimeout;
    }
  };
}

const healthyStartScript =
  "node -e \"const http=require('node:http');const server=http.createServer((req,res)=>{if(req.url==='/health'){res.statusCode=200;res.end('ok');return;}res.statusCode=404;res.end('missing');});server.listen(Number(process.env.PORT||3000));\"";
const unhealthyStartScript =
  "node -e \"const http=require('node:http');const server=http.createServer((req,res)=>{if(req.url==='/ready'){res.statusCode=200;res.end('ok');return;}res.statusCode=404;res.end('missing');});server.listen(Number(process.env.PORT||3000));\"";

test("heavy validation passes when migration, seed, and /health checks pass", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-heavy-pass-"));
  const restoreEnv = withHeavyTestEnv();

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);
    await writePackageWithScripts({
      root,
      startScript: healthyStartScript,
      includeSeedScript: true
    });

    const result = await runHeavyProjectValidation({ projectRoot: root });
    const byId = new Map(result.checks.map((entry) => [entry.id, entry]));

    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
    assert.equal(byId.get("migration")?.status, "pass");
    assert.equal(byId.get("seed")?.status, "pass");
    assert.equal(byId.get("boot")?.status, "pass");
  } finally {
    restoreEnv();
    await rm(root, { recursive: true, force: true });
  }
});

test("heavy validation fails when boot does not return 200 on /health", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-heavy-health-fail-"));
  const restoreEnv = withHeavyTestEnv();

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);
    await writePackageWithScripts({
      root,
      startScript: unhealthyStartScript,
      includeSeedScript: true
    });

    const result = await runHeavyProjectValidation({ projectRoot: root });
    const boot = result.checks.find((entry) => entry.id === "boot");

    assert.equal(result.ok, false);
    assert.equal(boot?.status, "fail");
  } finally {
    restoreEnv();
    await rm(root, { recursive: true, force: true });
  }
});

test("heavy validation fails when prisma seed script is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-heavy-seed-fail-"));
  const restoreEnv = withHeavyTestEnv();

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);
    await writePackageWithScripts({
      root,
      startScript: healthyStartScript,
      includeSeedScript: false
    });

    const result = await runHeavyProjectValidation({ projectRoot: root });
    const seed = result.checks.find((entry) => entry.id === "seed");

    assert.equal(result.ok, false);
    assert.equal(seed?.status, "fail");
  } finally {
    restoreEnv();
    await rm(root, { recursive: true, force: true });
  }
});

test("heavy validation fails when stack trace exposure is not production-gated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-heavy-production-config-fail-"));
  const restoreEnv = withHeavyTestEnv();

  try {
    const template = getTemplate("canonical-backend");
    await writeFixtureFiles(root, template.starterFiles);
    await writePackageWithScripts({
      root,
      startScript: healthyStartScript,
      includeSeedScript: true
    });

    const errorHandlerPath = path.join(root, "src", "errors", "errorHandler.ts");
    const raw = await readFile(errorHandlerPath, "utf8");
    const unguarded = raw.replace(
      /if\s*\(\s*env\.NODE_ENV\s*!==\s*"production"\s*\)\s*\{[\s\S]{0,120}?payload\.stack\s*=\s*error\.stack;\s*\}/,
      "payload.stack = error.stack;"
    );
    await writeFile(errorHandlerPath, unguarded, "utf8");

    const result = await runHeavyProjectValidation({ projectRoot: root });
    const production = result.checks.find((entry) => entry.id === "production_config");

    assert.equal(result.ok, false);
    assert.equal(production?.status, "fail");
  } finally {
    restoreEnv();
    await rm(root, { recursive: true, force: true });
  }
});
