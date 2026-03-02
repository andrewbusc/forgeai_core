import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { withIsolatedWorktree } from "../../lib/git-versioning.js";
import { pathExists, readTextFile } from "../../lib/fs-utils.js";
import { parseCommandFailures, ValidationFailure } from "./failure-parser.js";
import { runLightProjectValidation } from "./project-validator.js";

type HeavyCheckStatus = "pass" | "fail" | "skip";

export interface HeavyValidationCheck {
  id: string;
  status: HeavyCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface HeavyValidationResult {
  ok: boolean;
  blockingCount: number;
  warningCount: number;
  checks: HeavyValidationCheck[];
  failures: ValidationFailure[];
  summary: string;
  logs: string;
}

export interface HeavyValidationInput {
  projectRoot: string;
  ref?: string | null;
}

interface CommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
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

function normalizeSchemaScope(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);

  return normalized || "validation";
}

function buildScopedValidationDatabaseUrl(databaseUrl: string | undefined, scope: string): string | undefined {
  const raw = String(databaseUrl || "").trim();
  if (!raw) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
    return raw;
  }

  const existingSchema = parsed.searchParams.get("schema");
  if (existingSchema && existingSchema.trim().length > 0) {
    return raw;
  }

  const scopedSchema = `deeprun_hv_${normalizeSchemaScope(scope)}_${randomBytes(4).toString("hex")}`.slice(0, 63);
  parsed.searchParams.set("schema", scopedSchema);
  return parsed.toString();
}

async function runCommand(input: {
  cwd: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  const timeoutMs = Number(input.timeoutMs || 0) > 0 ? Number(input.timeoutMs) : 300_000;

  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let combined = `$ ${shellSafeCommand(input.command, input.args)}\n`;

    const append = (chunk: Buffer, stream: "stdout" | "stderr"): void => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        stdout = truncateOutput(stdout + text);
      } else {
        stderr = truncateOutput(stderr + text);
      }
      combined = truncateOutput(combined + text);
    };

    child.stdout.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    child.on("error", reject);

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
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        combined: combined.trim()
      };

      if (!result.ok && !input.allowFailure) {
        reject(new Error(`${input.command} exited with code ${String(code ?? "unknown")}.`));
        return;
      }

      resolve(result);
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
        reject(new Error("Could not allocate a free validation port."));
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

async function probeHealth(urlText: string, timeoutMs = 1_200): Promise<{ statusCode: number | null; body: string; error?: string }> {
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

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runBootCheck(input: {
  cwd: string;
  npmBin: string;
  timeoutMs: number;
  healthPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<HeavyValidationCheck> {
  const port = await acquireFreePort();
  const child = spawn(input.npmBin, ["run", "start"], {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...(input.env || {}),
      NODE_ENV: "production",
      PORT: String(port)
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  const append = (chunk: Buffer): void => {
    logs = truncateOutput(logs + chunk.toString("utf8"));
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const startedAt = Date.now();
  let healthy = false;
  let exited = false;
  let lastProbeStatus: number | null = null;
  let lastProbeError: string | null = null;
  let lastProbeBody = "";

  child.on("close", () => {
    exited = true;
  });

  while (Date.now() - startedAt < input.timeoutMs) {
    if (exited) {
      break;
    }

    const probe = await probeHealth(`http://127.0.0.1:${port}${input.healthPath}`);
    lastProbeStatus = probe.statusCode;
    lastProbeError = probe.error || null;
    lastProbeBody = probe.body || "";

    if (probe.statusCode === 200) {
      healthy = true;
      break;
    }

    await wait(250);
  }

  const terminateBootProcess = (): void => {
    const pid = child.pid;

    if (!pid || pid <= 0) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
      return;
    }

    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }
    }, 1_000).unref();
  };

  terminateBootProcess();

  if (healthy) {
    return {
      id: "boot",
      status: "pass",
      message: `Application responded with HTTP 200 on '${input.healthPath}'.`,
      details: {
        port,
        healthPath: input.healthPath
      }
    };
  }

  const detailSuffix =
    lastProbeStatus !== null
      ? `Last status=${String(lastProbeStatus)}.`
      : lastProbeError
        ? `Last error=${lastProbeError}.`
        : "No health response received.";

  return {
    id: "boot",
    status: "fail",
    message: exited
      ? `Application exited before '${input.healthPath}' returned HTTP 200. ${detailSuffix}`
      : `Application did not pass health check '${input.healthPath}' in time. ${detailSuffix}`,
    details: {
      port,
      healthPath: input.healthPath,
      lastStatusCode: lastProbeStatus ?? undefined,
      lastProbeError: lastProbeError || undefined,
      lastProbeBody: lastProbeBody || undefined,
      logs: logs || undefined
    }
  };
}

async function runProductionConfigCheck(projectRoot: string): Promise<HeavyValidationCheck> {
  const envConfigPath = path.join(projectRoot, "src", "config", "env.ts");
  if (!(await pathExists(envConfigPath))) {
    return {
      id: "production_config",
      status: "fail",
      message: "Missing required env config file 'src/config/env.ts'."
    };
  }

  const envConfigRaw = await readTextFile(envConfigPath);
  const hasNodeEnvProductionSupport =
    /NODE_ENV[\s\S]{0,320}production/i.test(envConfigRaw) || /production[\s\S]{0,320}NODE_ENV/i.test(envConfigRaw);

  if (!hasNodeEnvProductionSupport) {
    return {
      id: "production_config",
      status: "fail",
      message: "Environment config must validate and support NODE_ENV=production.",
      details: {
        file: "src/config/env.ts"
      }
    };
  }

  const errorHandlerPath = path.join(projectRoot, "src", "errors", "errorHandler.ts");
  if (!(await pathExists(errorHandlerPath))) {
    return {
      id: "production_config",
      status: "fail",
      message: "Missing required error handler file 'src/errors/errorHandler.ts'."
    };
  }

  const errorHandlerRaw = await readTextFile(errorHandlerPath);
  const hasStackReference = /\bstack\b/i.test(errorHandlerRaw);
  const hasGuardedStackExposure =
    /if\s*\(\s*[^)]*NODE_ENV[^)]*production[^)]*\)\s*\{[\s\S]{0,320}\bstack\b[\s\S]{0,320}\}/i.test(errorHandlerRaw);

  if (hasStackReference && !hasGuardedStackExposure) {
    return {
      id: "production_config",
      status: "fail",
      message: "Error stack exposure must be guarded so stack traces are hidden in production.",
      details: {
        file: "src/errors/errorHandler.ts"
      }
    };
  }

  return {
    id: "production_config",
    status: "pass",
    message: "Production mode config and error sanitization checks passed."
  };
}

function resolveScript(scripts: Record<string, string | undefined>, names: string[]): string | null {
  for (const scriptName of names) {
    if (typeof scripts[scriptName] === "string" && scripts[scriptName]?.trim()) {
      return scriptName;
    }
  }

  return null;
}

function summarizeResult(result: {
  blockingCount: number;
  warningCount: number;
  checks: HeavyValidationCheck[];
}): string {
  const failedChecks = result.checks.filter((check) => check.status === "fail").map((check) => check.id);
  const checksPart = failedChecks.length ? `failed checks: ${failedChecks.join(", ")}` : "all heavy checks passed";
  return `${checksPart}; blocking=${result.blockingCount}; warnings=${result.warningCount}`;
}

export async function runHeavyProjectValidation(input: HeavyValidationInput): Promise<HeavyValidationResult> {
  return withIsolatedWorktree(
    {
      projectDir: input.projectRoot,
      ref: input.ref,
      prefix: "heavy"
    },
    async (isolatedRoot) => {
      const checks: HeavyValidationCheck[] = [];
      const logs: string[] = [];
      const failures: ValidationFailure[] = [];
      let blockingCount = 0;
      let warningCount = 0;

      const light = await runLightProjectValidation(isolatedRoot);
      warningCount += light.warningCount;

      if (light.ok) {
        checks.push({
          id: "architecture",
          status: "pass",
          message: "Light architecture validation passed.",
          details: {
            warningCount: light.warningCount
          }
        });
      } else {
        blockingCount += light.blockingCount;
        checks.push({
          id: "architecture",
          status: "fail",
          message: "Light architecture validation failed.",
          details: {
            blockingCount: light.blockingCount,
            warningCount: light.warningCount,
            violations: light.violations.slice(0, 25)
          }
        });
      }

      const productionConfig = await runProductionConfigCheck(isolatedRoot);
      checks.push(productionConfig);
      if (productionConfig.status === "fail") {
        blockingCount += 1;
      }

      const packageJsonPath = path.join(isolatedRoot, "package.json");
      if (!(await pathExists(packageJsonPath))) {
        checks.push({
          id: "package",
          status: "skip",
          message: "No package.json found; skipping package-based checks."
        });

        const summary = summarizeResult({
          blockingCount,
          warningCount,
          checks
        });

        return {
          ok: blockingCount === 0,
          blockingCount,
          warningCount,
          checks,
          failures,
          summary,
          logs: logs.join("\n\n")
        };
      }

      const npmBin = process.env.AGENT_VALIDATION_NPM_BIN || "npm";
      const validationDatabaseUrl = buildScopedValidationDatabaseUrl(
        process.env.AGENT_HEAVY_DATABASE_URL || process.env.DATABASE_URL,
        path.basename(isolatedRoot)
      );
      const validationCommandEnv = validationDatabaseUrl ? { DATABASE_URL: validationDatabaseUrl } : undefined;
      const packageRaw = await readTextFile(packageJsonPath);
      const packageJson = JSON.parse(packageRaw) as {
        scripts?: Record<string, string | undefined>;
      };
      const scripts = packageJson.scripts || {};

      const shouldInstallDeps = process.env.AGENT_HEAVY_INSTALL_DEPS !== "false";
      if (shouldInstallDeps) {
        const hasNodeModules = await pathExists(path.join(isolatedRoot, "node_modules"));
        if (!hasNodeModules) {
          const install = await runCommand({
            cwd: isolatedRoot,
            command: npmBin,
            // Validation is CI-like and must include devDependencies (tsx, vitest, etc.).
            args: ["ci", "--include=dev", "--no-audit", "--no-fund"],
            timeoutMs: Number(process.env.AGENT_HEAVY_INSTALL_TIMEOUT_MS || 300_000),
            allowFailure: true,
            env: {
              NODE_ENV: "development",
              NPM_CONFIG_PRODUCTION: "false",
              npm_config_production: "false"
            }
          });

          logs.push(install.combined);

          if (!install.ok) {
            blockingCount += 1;
            checks.push({
              id: "install",
              status: "fail",
              message: "Dependency installation failed.",
              details: {
                exitCode: install.exitCode,
                stderr: install.stderr || undefined
              }
            });
            failures.push(
              ...parseCommandFailures({
                sourceCheckId: "install",
                combined: install.combined,
                stderr: install.stderr,
                stdout: install.stdout
              })
            );
          } else {
            checks.push({
              id: "install",
              status: "pass",
              message: "Dependencies installed successfully."
            });
          }
        }
      } else {
        checks.push({
          id: "install",
          status: "skip",
          message: "Dependency installation skipped by configuration."
        });
      }

      const prismaSchemaPath = path.join(isolatedRoot, "prisma", "schema.prisma");
      const hasPrismaSchema = await pathExists(prismaSchemaPath);
      const migrationScript = resolveScript(scripts, ["prisma:migrate", "db:migrate", "migrate:deploy", "migrate"]);
      const seedScript = resolveScript(scripts, ["prisma:seed", "db:seed", "seed"]);
      const prismaCheckRequired = hasPrismaSchema || Boolean(migrationScript) || Boolean(seedScript);

      if (prismaCheckRequired && !migrationScript) {
        blockingCount += 1;
        checks.push({
          id: "migration",
          status: "fail",
          message: "Prisma migration script is required but missing.",
          details: {
            expectedScripts: ["prisma:migrate", "db:migrate", "migrate:deploy", "migrate"]
          }
        });
      } else if (migrationScript) {
        const migration = await runCommand({
          cwd: isolatedRoot,
          command: npmBin,
          args: ["run", migrationScript],
          timeoutMs: Number(process.env.AGENT_HEAVY_MIGRATION_TIMEOUT_MS || 180_000),
          allowFailure: true,
          env: validationCommandEnv
        });

        logs.push(migration.combined);
        if (!migration.ok) {
          blockingCount += 1;
          checks.push({
            id: "migration",
            status: "fail",
            message: "Migration command failed.",
            details: {
              command: `npm run ${migrationScript}`,
              exitCode: migration.exitCode,
              stderr: migration.stderr || undefined
            }
          });
          failures.push(
            ...parseCommandFailures({
              sourceCheckId: "migration",
              combined: migration.combined,
              stderr: migration.stderr,
              stdout: migration.stdout
            })
          );
        } else {
          checks.push({
            id: "migration",
            status: "pass",
            message: "Migration command passed."
          });
        }
      } else {
        checks.push({
          id: "migration",
          status: "skip",
          message: "No Prisma schema detected; skipping migration check."
        });
      }

      if (prismaCheckRequired && !seedScript) {
        blockingCount += 1;
        checks.push({
          id: "seed",
          status: "fail",
          message: "Prisma seed script is required but missing.",
          details: {
            expectedScripts: ["prisma:seed", "db:seed", "seed"]
          }
        });
      } else if (seedScript) {
        const seed = await runCommand({
          cwd: isolatedRoot,
          command: npmBin,
          args: ["run", seedScript],
          timeoutMs: Number(process.env.AGENT_HEAVY_SEED_TIMEOUT_MS || 180_000),
          allowFailure: true,
          env: validationCommandEnv
        });

        logs.push(seed.combined);
        if (!seed.ok) {
          blockingCount += 1;
          checks.push({
            id: "seed",
            status: "fail",
            message: "Seed command failed.",
            details: {
              command: `npm run ${seedScript}`,
              exitCode: seed.exitCode,
              stderr: seed.stderr || undefined
            }
          });
          failures.push(
            ...parseCommandFailures({
              sourceCheckId: "seed",
              combined: seed.combined,
              stderr: seed.stderr,
              stdout: seed.stdout
            })
          );
        } else {
          checks.push({
            id: "seed",
            status: "pass",
            message: "Seed command passed."
          });
        }
      } else {
        checks.push({
          id: "seed",
          status: "skip",
          message: "No Prisma schema detected; skipping seed check."
        });
      }

      if (typeof scripts.check === "string" && scripts.check.trim()) {
        const typecheck = await runCommand({
          cwd: isolatedRoot,
          command: npmBin,
          args: ["run", "check"],
          timeoutMs: Number(process.env.AGENT_HEAVY_TYPECHECK_TIMEOUT_MS || 120_000),
          allowFailure: true
        });

        logs.push(typecheck.combined);
        if (!typecheck.ok) {
          blockingCount += 1;
          checks.push({
            id: "typecheck",
            status: "fail",
            message: "Typecheck command failed.",
            details: {
              exitCode: typecheck.exitCode,
              stderr: typecheck.stderr || undefined
            }
          });
          failures.push(
            ...parseCommandFailures({
              sourceCheckId: "typecheck",
              combined: typecheck.combined,
              stderr: typecheck.stderr,
              stdout: typecheck.stdout
            })
          );
        } else {
          checks.push({
            id: "typecheck",
            status: "pass",
            message: "Typecheck command passed."
          });
        }
      } else {
        checks.push({
          id: "typecheck",
          status: "skip",
          message: "No npm 'check' script; skipping typecheck command."
        });
      }

      if (typeof scripts.build === "string" && scripts.build.trim()) {
        const build = await runCommand({
          cwd: isolatedRoot,
          command: npmBin,
          args: ["run", "build"],
          timeoutMs: Number(process.env.AGENT_HEAVY_BUILD_TIMEOUT_MS || 180_000),
          allowFailure: true
        });

        logs.push(build.combined);
        if (!build.ok) {
          blockingCount += 1;
          checks.push({
            id: "build",
            status: "fail",
            message: "Build command failed.",
            details: {
              exitCode: build.exitCode,
              stderr: build.stderr || undefined
            }
          });
          failures.push(
            ...parseCommandFailures({
              sourceCheckId: "build",
              combined: build.combined,
              stderr: build.stderr,
              stdout: build.stdout
            })
          );
        } else {
          checks.push({
            id: "build",
            status: "pass",
            message: "Build command passed."
          });
        }
      } else {
        checks.push({
          id: "build",
          status: "skip",
          message: "No npm 'build' script; skipping build."
        });
      }

      if (typeof scripts.test === "string" && scripts.test.trim()) {
        const test = await runCommand({
          cwd: isolatedRoot,
          command: npmBin,
          args: ["test"],
          timeoutMs: Number(process.env.AGENT_HEAVY_TEST_TIMEOUT_MS || 180_000),
          allowFailure: true,
          env: validationCommandEnv
        });

        logs.push(test.combined);
        if (!test.ok) {
          blockingCount += 1;
          checks.push({
            id: "tests",
            status: "fail",
            message: "Test command failed.",
            details: {
              exitCode: test.exitCode,
              stderr: test.stderr || undefined
            }
          });
          failures.push(
            ...parseCommandFailures({
              sourceCheckId: "tests",
              combined: test.combined,
              stderr: test.stderr,
              stdout: test.stdout
            })
          );
        } else {
          checks.push({
            id: "tests",
            status: "pass",
            message: "Test command passed."
          });
        }
      } else {
        checks.push({
          id: "tests",
          status: "skip",
          message: "No npm 'test' script; skipping tests."
        });
      }

      if (typeof scripts.start === "string" && scripts.start.trim()) {
        const boot = await runBootCheck({
          cwd: isolatedRoot,
          npmBin,
          timeoutMs: Number(process.env.AGENT_HEAVY_BOOT_TIMEOUT_MS || 25_000),
          healthPath: process.env.AGENT_HEAVY_HEALTH_PATH || "/health",
          env: validationCommandEnv
        });

        checks.push(boot);
        if (boot.status === "fail") {
          blockingCount += 1;
          const bootLogs =
            boot.details && typeof boot.details === "object" && !Array.isArray(boot.details)
              ? (boot.details as Record<string, unknown>).logs
              : undefined;
          failures.push(
            ...parseCommandFailures({
              sourceCheckId: "boot",
              combined: typeof bootLogs === "string" ? bootLogs : boot.message
            })
          );
        }
      } else {
        checks.push({
          id: "boot",
          status: "skip",
          message: "No npm 'start' script; skipping boot check."
        });
      }

      const summary = summarizeResult({
        blockingCount,
        warningCount,
        checks
      });

      return {
        ok: blockingCount === 0,
        blockingCount,
        warningCount,
        checks,
        failures,
        summary,
        logs: logs.join("\n\n")
      };
    }
  );
}
