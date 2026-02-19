import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { withIsolatedWorktree } from "../../lib/git-versioning.js";
import { pathExists } from "../../lib/fs-utils.js";
import { runHeavyProjectValidation } from "./heavy-validator.js";

type CheckStatus = "pass" | "fail" | "skip";

interface CheckResult {
  id: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  combined: string;
}

function truncateOutput(value: string, maxChars = 120_000): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(value.length - maxChars);
}

function shellSafeCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => (/[^A-Za-z0-9_./:-]/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}

function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}): Promise<CommandResult> {
  const timeoutMs = Number(input.timeoutMs || 0) > 0 ? Number(input.timeoutMs) : 300_000;

  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let combined = `$ ${shellSafeCommand(input.command, input.args)}\n`;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout = truncateOutput(stdout + text);
      combined = truncateOutput(combined + text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr = truncateOutput(stderr + text);
      combined = truncateOutput(combined + text);
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      const exitCode = Number.isInteger(code) ? Number(code) : 1;
      const result: CommandResult = {
        ok: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        combined: combined.trim()
      };

      if (!result.ok && !input.allowFailure) {
        resolve({
          ...result,
          stderr: result.stderr || `${input.command} exited with code ${String(code ?? "unknown")}.`
        });
        return;
      }

      resolve({
        ...result
      });
    });
  });
}

async function acquireFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate free port."));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function probeHealth(urlText: string, timeoutMs = 1_500): Promise<{ statusCode: number | null; body: string; error?: string }> {
  return new Promise((resolve) => {
    const url = new URL(urlText);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: "GET",
        timeout: timeoutMs
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body = truncateOutput(body + chunk.toString("utf8"), 16_000);
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || null,
            body: body.trim()
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error) => {
      resolve({
        statusCode: null,
        body: "",
        error: error.message
      });
    });
    req.end();
  });
}

async function runHeavyValidationCheck(target: string): Promise<CheckResult> {
  const result = await runHeavyProjectValidation({
    projectRoot: target
  });

  if (result.ok) {
    return {
      id: "heavy_validation",
      status: "pass",
      message: "Heavy validation passed.",
      details: {
        blockingCount: result.blockingCount,
        warningCount: result.warningCount,
        summary: result.summary,
        checks: result.checks
      }
    };
  }

  return {
    id: "heavy_validation",
    status: "fail",
    message: "Heavy validation failed.",
    details: {
      blockingCount: result.blockingCount,
      warningCount: result.warningCount,
      summary: result.summary,
      checks: result.checks,
      logsTail: truncateOutput(result.logs, 24_000)
    }
  };
}

async function runDockerValidationChecks(target: string): Promise<CheckResult[]> {
  const dockerBin = process.env.V1_DOCKER_BIN || process.env.DEPLOY_DOCKER_BIN || "docker";
  const buildTimeoutMs = Number(process.env.V1_DOCKER_BUILD_TIMEOUT_MS || 600_000);
  const bootTimeoutMs = Number(process.env.V1_DOCKER_BOOT_TIMEOUT_MS || 45_000);
  const containerPort = Number(process.env.V1_DOCKER_CONTAINER_PORT || process.env.DEPLOY_CONTAINER_PORT || 3000);
  const healthPath = process.env.V1_DOCKER_HEALTH_PATH || "/health";
  const keepImage = process.env.V1_DOCKER_KEEP_IMAGE === "true";

  const checks: CheckResult[] = [];

  const dockerAvailability = await runCommand({
    command: dockerBin,
    args: ["--version"],
    cwd: target,
    allowFailure: true,
    timeoutMs: 20_000
  });

  if (!dockerAvailability.ok) {
    checks.push({
      id: "docker_build",
      status: "fail",
      message: `Docker CLI '${dockerBin}' is unavailable.`,
      details: {
        stderr: dockerAvailability.stderr || undefined
      }
    });
    checks.push({
      id: "docker_boot",
      status: "skip",
      message: "Docker boot check skipped because Docker CLI is unavailable."
    });
    return checks;
  }

  return withIsolatedWorktree(
    {
      projectDir: target,
      prefix: "v1docker"
    },
    async (isolatedRoot) => {
      const dockerfilePath = path.join(isolatedRoot, "Dockerfile");
      if (!(await pathExists(dockerfilePath))) {
        checks.push({
          id: "docker_build",
          status: "fail",
          message: "Dockerfile is missing."
        });
        checks.push({
          id: "docker_boot",
          status: "skip",
          message: "Docker boot check skipped because Docker build did not run."
        });
        return checks;
      }

      const imageTag = `forgeai-v1-${Date.now()}-${randomBytes(4).toString("hex")}`.toLowerCase();
      const buildArgs = ["build", "-t", imageTag, "."];

      const buildResult = await runCommand({
        command: dockerBin,
        args: buildArgs,
        cwd: isolatedRoot,
        allowFailure: true,
        timeoutMs: buildTimeoutMs
      });

      if (!buildResult.ok) {
        checks.push({
          id: "docker_build",
          status: "fail",
          message: "Docker build failed.",
          details: {
            exitCode: buildResult.exitCode,
            stderr: buildResult.stderr || undefined,
            logsTail: truncateOutput(buildResult.combined, 24_000)
          }
        });
        checks.push({
          id: "docker_boot",
          status: "skip",
          message: "Docker boot check skipped because Docker build failed."
        });
        return checks;
      }

      checks.push({
        id: "docker_build",
        status: "pass",
        message: "Docker image build passed.",
        details: {
          imageTag
        }
      });

      let containerId = "";
      const hostPort = await acquireFreePort();
      const containerName = `forgeai-v1-check-${Date.now()}-${randomBytes(3).toString("hex")}`;
      const runResult = await runCommand({
        command: dockerBin,
        args: [
          "run",
          "-d",
          "--rm",
          "--name",
          containerName,
          "-e",
          "NODE_ENV=production",
          "-e",
          `PORT=${containerPort}`,
          "-p",
          `127.0.0.1:${hostPort}:${containerPort}`,
          imageTag
        ],
        cwd: isolatedRoot,
        allowFailure: true,
        timeoutMs: 30_000
      });

      if (!runResult.ok) {
        checks.push({
          id: "docker_boot",
          status: "fail",
          message: "Docker container failed to start.",
          details: {
            exitCode: runResult.exitCode,
            stderr: runResult.stderr || undefined,
            logsTail: truncateOutput(runResult.combined, 24_000)
          }
        });

        if (!keepImage) {
          await runCommand({
            command: dockerBin,
            args: ["image", "rm", "-f", imageTag],
            cwd: isolatedRoot,
            allowFailure: true,
            timeoutMs: 30_000
          });
        }

        return checks;
      }

      containerId = runResult.stdout.split("\n")[0]?.trim() || containerName;
      const healthUrl = `http://127.0.0.1:${hostPort}${healthPath.startsWith("/") ? healthPath : `/${healthPath}`}`;
      const startedAt = Date.now();
      let lastProbe: { statusCode: number | null; body: string; error?: string } = {
        statusCode: null,
        body: ""
      };
      let healthy = false;

      while (Date.now() - startedAt < bootTimeoutMs) {
        lastProbe = await probeHealth(healthUrl, 1_500);
        if (lastProbe.statusCode === 200) {
          healthy = true;
          break;
        }
        await wait(350);
      }

      if (healthy) {
        checks.push({
          id: "docker_boot",
          status: "pass",
          message: "Docker container booted and /health returned 200.",
          details: {
            url: healthUrl,
            statusCode: 200
          }
        });
      } else {
        const logsResult = await runCommand({
          command: dockerBin,
          args: ["logs", containerId],
          cwd: isolatedRoot,
          allowFailure: true,
          timeoutMs: 20_000
        });

        checks.push({
          id: "docker_boot",
          status: "fail",
          message: "Docker container did not pass /health check.",
          details: {
            url: healthUrl,
            statusCode: lastProbe.statusCode,
            probeError: lastProbe.error || undefined,
            probeBody: lastProbe.body || undefined,
            containerLogs: truncateOutput(logsResult.combined || logsResult.stderr || "", 24_000)
          }
        });
      }

      await runCommand({
        command: dockerBin,
        args: ["stop", containerId],
        cwd: isolatedRoot,
        allowFailure: true,
        timeoutMs: 20_000
      });

      if (!keepImage) {
        await runCommand({
          command: dockerBin,
          args: ["image", "rm", "-f", imageTag],
          cwd: isolatedRoot,
          allowFailure: true,
          timeoutMs: 30_000
        });
      }

      return checks;
    }
  );
}

async function main(): Promise<void> {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const checks: CheckResult[] = [];

  try {
    checks.push(await runHeavyValidationCheck(target));
  } catch (error) {
    checks.push({
      id: "heavy_validation",
      status: "fail",
      message: "Heavy validation execution failed.",
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }

  try {
    const dockerChecks = await runDockerValidationChecks(target);
    checks.push(...dockerChecks);
  } catch (error) {
    checks.push({
      id: "docker_build",
      status: "fail",
      message: "Docker validation execution failed.",
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
    checks.push({
      id: "docker_boot",
      status: "skip",
      message: "Docker boot check skipped due to Docker validation execution failure."
    });
  }

  const failed = checks.filter((check) => check.status === "fail");
  const verdict = failed.length === 0 ? "YES" : "NO";

  const payload = {
    target,
    verdict,
    ok: verdict === "YES",
    checks,
    generatedAt: new Date().toISOString()
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (verdict !== "YES") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify(
      {
        verdict: "NO",
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
