import "dotenv/config";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GOVERNANCE_DECISION_SCHEMA_VERSION, governanceDecisionSchema } from "../governance/decision.js";
import { workspacePath } from "../lib/workspace.js";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

type FreshIntegrationMode = "pass" | "fail";

function readFlag(args: string[], name: string): string | null {
  const exact = `--${name}`;
  const equals = args.find((arg) => arg.startsWith(`${exact}=`));
  if (equals) {
    return equals.slice(exact.length + 1);
  }

  const index = args.indexOf(exact);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1] ?? null;
  }

  return null;
}

function parseKeyValueLines(output: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of output.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      values[key] = value;
    }
  }

  return values;
}

async function runCli(args: string[], envOverrides: Record<string, string | undefined>): Promise<CliResult> {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCliPath, "-r", "dotenv/config", "src/scripts/deeprun-cli.ts", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apiBaseUrl = readFlag(args, "api") || process.env.DEEPRUN_INTEGRATION_API;
  if (!apiBaseUrl) {
    throw new Error("fresh integration check requires --api <baseUrl>.");
  }
  const modeRaw = (readFlag(args, "mode") || "fail").trim().toLowerCase();
  if (modeRaw !== "pass" && modeRaw !== "fail") {
    throw new Error(`fresh integration check requires --mode pass|fail. Received '${modeRaw}'.`);
  }
  const mode = modeRaw as FreshIntegrationMode;

  const outputPath = path.resolve(
    readFlag(args, "output") || workspacePath(".deeprun", "fresh-integration", "governance-decision.json")
  );
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deeprun-fresh-integration-"));
  const cliConfigPath = path.join(tmpRoot, "cli.json");
  const suffix = randomUUID().slice(0, 8);
  const email = `fresh-gate-${suffix}@deeprun.local`;
  const sharedEnv = {
    DEEPRUN_CLI_CONFIG: cliConfigPath,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL
  };

  try {
    const init = await runCli(
      [
        "init",
        "--api",
        apiBaseUrl,
        "--email",
        email,
        "--password",
        "Password123!",
        "--name",
        `Fresh Integration ${suffix}`,
        "--org",
        `Fresh Integration Org ${suffix}`,
        "--workspace",
        `Fresh Integration Workspace ${suffix}`
      ],
      sharedEnv
    );
    assert.equal(init.code, 0, `init failed:\n${init.stderr}\n${init.stdout}`);

    const runValues =
      mode === "pass"
        ? parseKeyValueLines(
            (
              await (async () => {
                const bootstrap = await runCli(
                  [
                    "bootstrap",
                    `Fresh integration bootstrap ${suffix}`,
                    "--provider",
                    "mock",
                    "--project-name",
                    `Fresh Integration Bootstrap ${suffix}`
                  ],
                  sharedEnv
                );
                assert.equal(bootstrap.code, 0, `bootstrap failed:\n${bootstrap.stderr}\n${bootstrap.stdout}`);
                const values = parseKeyValueLines(bootstrap.stdout);
                assert.equal(values.CERTIFICATION_OK, "true", `bootstrap did not certify pass:\n${bootstrap.stdout}`);
                return bootstrap.stdout;
              })()
            )
          )
        : parseKeyValueLines(
            (
              await (async () => {
                const run = await runCli(
                  [
                    "run",
                    `Fresh integration governance run ${suffix}`,
                    "--engine",
                    "kernel",
                    "--provider",
                    "mock",
                    "--profile",
                    "ci",
                    "--wait",
                    "--project-name",
                    `Fresh Integration Project ${suffix}`
                  ],
                  sharedEnv
                );
                assert.equal(run.code, 0, `run failed:\n${run.stderr}\n${run.stdout}`);
                return run.stdout;
              })()
            )
          );

    assert.ok(runValues.PROJECT_ID, "fresh integration flow did not emit PROJECT_ID");
    assert.ok(runValues.RUN_ID, "fresh integration flow did not emit RUN_ID");

    const gate = await runCli(
      [
        "gate",
        "--project",
        runValues.PROJECT_ID,
        "--run",
        runValues.RUN_ID,
        ...(mode === "fail" ? ["--strict-v1-ready"] : []),
        "--output",
        outputPath
      ],
      mode === "fail"
        ? {
            ...sharedEnv,
            V1_DOCKER_BIN: "__missing_docker_binary__"
          }
        : sharedEnv
    );

    assert.equal(
      gate.code,
      mode === "pass" ? 0 : 1,
      `${mode} gate result mismatch:\n${gate.stderr}\n${gate.stdout}`
    );

    const decision = governanceDecisionSchema.parse(JSON.parse(await fs.readFile(outputPath, "utf8")));
    assert.equal(decision.decisionSchemaVersion, GOVERNANCE_DECISION_SCHEMA_VERSION);
    assert.equal(decision.decision, mode === "pass" ? "PASS" : "FAIL");
    assert.equal(decision.decisionHash.length, 64);
    assert.ok(decision.contract.hash);
    if (mode === "pass") {
      assert.deepEqual(decision.reasonCodes, []);
    } else {
      assert.ok(decision.reasonCodes.includes("RUN_V1_READY_FAILED"));
    }

    process.stdout.write(`DECISION_PATH=${outputPath}\n`);
    process.stdout.write(`DECISION_HASH=${decision.decisionHash}\n`);
    process.stdout.write(`DECISION=${decision.decision}\n`);
    process.stdout.write(`REASON_CODES=${decision.reasonCodes.join(",")}\n`);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
