import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("deeprun CLI tests require DATABASE_URL or TEST_DATABASE_URL.");
}

const requiredDatabaseUrl: string = databaseUrl;

interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function parseKeyValueLines(output: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of output.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();

    if (!key) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

async function acquireFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate free port for server test."));
        return;
      }

      const selected = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(selected);
      });
    });
  });
}

async function waitForHealthy(baseUrl: string, child: ReturnType<typeof spawn>): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 20_000;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Server process exited early with code ${String(child.exitCode)}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Continue polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for server health endpoint.");
}

async function startServer(envOverrides: Record<string, string | undefined> = {}): Promise<RunningServer> {
  const port = await acquireFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

  const child = spawn(process.execPath, [tsxCliPath, "-r", "dotenv/config", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: requiredDatabaseUrl,
      PORT: String(port),
      NODE_ENV: "test",
      CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || "http://localhost",
      RATE_LIMIT_LOGIN_MAX: process.env.RATE_LIMIT_LOGIN_MAX || "100",
      RATE_LIMIT_GENERATION_MAX: process.env.RATE_LIMIT_GENERATION_MAX || "100",
      AGENT_LIGHT_VALIDATION_MODE: "off",
      AGENT_HEAVY_VALIDATION_MODE: "off",
      AGENT_HEAVY_INSTALL_DEPS: "false",
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);

  await waitForHealthy(baseUrl, child);

  return {
    baseUrl,
    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 4_000))
      ]);

      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit").catch(() => undefined);
      }
    }
  };
}

async function runCli(args: string[], envOverrides: Record<string, string | undefined> = {}): Promise<CliResult> {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [tsxCliPath, "-r", "dotenv/config", "src/scripts/deeprun-cli.ts", ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...envOverrides
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });
  });
}

test("deeprun CLI supports init -> run(kernel) -> status -> validate", async () => {
  const server = await startServer();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deeprun-cli-"));
  const configPath = path.join(tmpDir, "cli.json");
  const suffix = randomUUID().slice(0, 8);
  const email = `cli-${suffix}@example.com`;

  try {
    const initResult = await runCli(
      [
        "init",
        "--api",
        server.baseUrl,
        "--email",
        email,
        "--password",
        "Password123!",
        "--name",
        `CLI Tester ${suffix}`,
        "--org",
        `CLI Org ${suffix}`,
        "--workspace",
        `CLI Workspace ${suffix}`
      ],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(initResult.code, 0, `init failed: ${initResult.stderr}`);
    assert.match(initResult.stdout, /Initialized deeprun CLI session\./);
    assert.match(initResult.stdout, /WORKSPACE_ID=/);

    const runResult = await runCli(
      [
        "run",
        `Build kernel run ${suffix}`,
        "--engine",
        "kernel",
        "--provider",
        "mock",
        "--project-name",
        `CLI Kernel Project ${suffix}`
      ],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(runResult.code, 0, `run failed: ${runResult.stderr}\n${runResult.stdout}`);

    const runKv = parseKeyValueLines(runResult.stdout);
    assert.ok(runKv.PROJECT_ID, `run output missing PROJECT_ID: ${runResult.stdout}`);
    assert.ok(runKv.RUN_ID, `run output missing RUN_ID: ${runResult.stdout}`);
    assert.equal(runKv.ENGINE, "kernel");
    assert.equal(runKv.RUN_STATUS, "complete");

    const statusResult = await runCli(
      ["status", "--engine", "kernel", "--project", runKv.PROJECT_ID, "--run", runKv.RUN_ID],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(statusResult.code, 0, `status failed: ${statusResult.stderr}`);

    const statusKv = parseKeyValueLines(statusResult.stdout);
    assert.equal(statusKv.PROJECT_ID, runKv.PROJECT_ID);
    assert.equal(statusKv.RUN_ID, runKv.RUN_ID);
    assert.equal(statusKv.ENGINE, "kernel");
    assert.ok(statusKv.RUN_STATUS);
    assert.ok(statusKv.CORRECTION_ATTEMPTS !== undefined);

    const validateResult = await runCli(
      ["validate", "--project", runKv.PROJECT_ID, "--run", runKv.RUN_ID],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl,
        AGENT_HEAVY_INSTALL_DEPS: "false"
      }
    );

    const validateKv = parseKeyValueLines(validateResult.stdout);
    assert.equal(validateKv.PROJECT_ID, runKv.PROJECT_ID);
    assert.equal(validateKv.RUN_ID, runKv.RUN_ID);
    assert.ok(validateKv.VALIDATION_OK === "true" || validateKv.VALIDATION_OK === "false");
    assert.ok(validateKv.BLOCKING_COUNT !== undefined);
    assert.ok(validateKv.WARNING_COUNT !== undefined);

    if (validateKv.VALIDATION_OK === "true") {
      assert.equal(validateResult.code, 0);
    } else {
      assert.equal(validateResult.code, 1);
    }
  } finally {
    await server.stop();
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("deeprun CLI supports backend bootstrap command", async () => {
  const server = await startServer();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deeprun-cli-bootstrap-"));
  const configPath = path.join(tmpDir, "cli.json");
  const suffix = randomUUID().slice(0, 8);
  const email = `cli-bootstrap-${suffix}@example.com`;

  try {
    const initResult = await runCli(
      [
        "init",
        "--api",
        server.baseUrl,
        "--email",
        email,
        "--password",
        "Password123!",
        "--name",
        `CLI Bootstrap Tester ${suffix}`,
        "--org",
        `CLI Bootstrap Org ${suffix}`,
        "--workspace",
        `CLI Bootstrap Workspace ${suffix}`
      ],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(initResult.code, 0, `init failed: ${initResult.stderr}`);

    const bootstrapResult = await runCli(
      [
        "bootstrap",
        `Bootstrap backend ${suffix}`,
        "--project-name",
        `CLI Bootstrap Project ${suffix}`,
        "--provider",
        "mock"
      ],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    const bootstrapKv = parseKeyValueLines(bootstrapResult.stdout);
    assert.ok(bootstrapKv.PROJECT_ID, `bootstrap output missing PROJECT_ID: ${bootstrapResult.stdout}`);
    assert.ok(bootstrapKv.RUN_ID, `bootstrap output missing RUN_ID: ${bootstrapResult.stdout}`);
    assert.equal(bootstrapKv.ENGINE, "kernel");
    assert.equal(bootstrapKv.RUN_STATUS, "complete");
    assert.ok(
      bootstrapKv.CERTIFICATION_OK === "true" || bootstrapKv.CERTIFICATION_OK === "false",
      `bootstrap output missing CERTIFICATION_OK: ${bootstrapResult.stdout}`
    );
    assert.ok(
      bootstrapKv.CERTIFICATION_BLOCKING_COUNT !== undefined,
      `bootstrap output missing CERTIFICATION_BLOCKING_COUNT: ${bootstrapResult.stdout}`
    );
    assert.ok(
      bootstrapKv.CERTIFICATION_WARNING_COUNT !== undefined,
      `bootstrap output missing CERTIFICATION_WARNING_COUNT: ${bootstrapResult.stdout}`
    );
    assert.ok(
      typeof bootstrapKv.CERTIFICATION_SUMMARY === "string" && bootstrapKv.CERTIFICATION_SUMMARY.length > 0,
      `bootstrap output missing CERTIFICATION_SUMMARY: ${bootstrapResult.stdout}`
    );
    if (bootstrapKv.CERTIFICATION_OK === "true") {
      assert.equal(bootstrapResult.code, 0, `bootstrap should succeed on certified pass: ${bootstrapResult.stderr}`);
      assert.equal(bootstrapKv.CERTIFICATION_BLOCKING_COUNT, "0");
    } else {
      assert.equal(bootstrapResult.code, 2, `bootstrap should fail-fast on certification failure: ${bootstrapResult.stdout}`);
      assert.match(bootstrapResult.stderr, /bootstrap certification failed/i);
    }
  } finally {
    await server.stop();
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("deeprun CLI status --watch streams progress and --verbose enables http trace", async () => {
  const server = await startServer();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deeprun-cli-status-watch-"));
  const configPath = path.join(tmpDir, "cli.json");
  const suffix = randomUUID().slice(0, 8);
  const email = `cli-status-watch-${suffix}@example.com`;

  try {
    const initResult = await runCli(
      [
        "init",
        "--api",
        server.baseUrl,
        "--email",
        email,
        "--password",
        "Password123!",
        "--name",
        `CLI Status Watch Tester ${suffix}`,
        "--org",
        `CLI Status Watch Org ${suffix}`,
        "--workspace",
        `CLI Status Watch Workspace ${suffix}`
      ],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(initResult.code, 0, `init failed: ${initResult.stderr}`);

    const runResult = await runCli(
      [
        "run",
        `Build state run ${suffix}`,
        "--engine",
        "state",
        "--provider",
        "mock",
        "--project-name",
        `CLI State Project ${suffix}`
      ],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(runResult.code, 0, `run failed: ${runResult.stderr}\n${runResult.stdout}`);
    const runKv = parseKeyValueLines(runResult.stdout);
    assert.ok(runKv.PROJECT_ID, `run output missing PROJECT_ID: ${runResult.stdout}`);
    assert.ok(runKv.RUN_ID, `run output missing RUN_ID: ${runResult.stdout}`);

    const watchResult = await runCli(
      ["status", "--engine", "state", "--project", runKv.PROJECT_ID, "--run", runKv.RUN_ID, "--watch"],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(watchResult.code, 0, `status --watch failed: ${watchResult.stderr}\n${watchResult.stdout}`);
    assert.match(watchResult.stdout, /state status=/);
    assert.match(watchResult.stdout, /RUN_STATUS=/);
    assert.equal(watchResult.stdout.includes("[http]"), false);

    const verboseResult = await runCli(
      ["status", "--engine", "state", "--project", runKv.PROJECT_ID, "--run", runKv.RUN_ID, "--watch", "--verbose"],
      {
        DEEPRUN_CLI_CONFIG: configPath,
        DATABASE_URL: requiredDatabaseUrl
      }
    );

    assert.equal(verboseResult.code, 0, `status --watch --verbose failed: ${verboseResult.stderr}\n${verboseResult.stdout}`);
    assert.match(verboseResult.stdout, /\[http\] GET /);
    assert.match(verboseResult.stdout, /state status=/);
  } finally {
    await server.stop();
    await rm(tmpDir, { recursive: true, force: true });
  }
});
