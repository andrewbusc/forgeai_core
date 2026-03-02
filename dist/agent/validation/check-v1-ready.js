import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withIsolatedWorktree } from "../../lib/git-versioning.js";
import { pathExists, readTextFile } from "../../lib/fs-utils.js";
import { summarizeStubDebt } from "../../learning/stub-debt.js";
import { runHeavyProjectValidation } from "./heavy-validator.js";
function truncateOutput(value, maxChars = 120_000) {
    if (value.length <= maxChars) {
        return value;
    }
    return value.slice(value.length - maxChars);
}
function shellSafeCommand(command, args) {
    return [command, ...args.map((arg) => (/[^A-Za-z0-9_./:-]/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}
function normalizeHealthPath(pathValue) {
    return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}
function rewriteDatabaseUrlForDocker(raw) {
    const value = raw.trim();
    if (!value) {
        return value;
    }
    try {
        const parsed = new URL(value);
        if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
            parsed.hostname = "host.docker.internal";
        }
        return parsed.toString();
    }
    catch {
        return value;
    }
}
async function readNpmScripts(projectRoot) {
    const packageJsonPath = path.join(projectRoot, "package.json");
    if (!(await pathExists(packageJsonPath))) {
        return {};
    }
    try {
        const parsed = JSON.parse(await readTextFile(packageJsonPath));
        const scripts = parsed.scripts || {};
        const result = {};
        for (const [name, command] of Object.entries(scripts)) {
            if (typeof command === "string" && command.trim().length > 0) {
                result[name] = command;
            }
        }
        return result;
    }
    catch {
        return {};
    }
}
function runCommand(input) {
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
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            stdout = truncateOutput(stdout + text);
            combined = truncateOutput(combined + text);
        });
        child.stderr.on("data", (chunk) => {
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
            const result = {
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
async function acquireFreePort() {
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
async function wait(delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
}
async function probeHealth(urlText, timeoutMs = 1_500) {
    return new Promise((resolve) => {
        const url = new URL(urlText);
        const req = http.request({
            hostname: url.hostname,
            port: Number(url.port),
            path: url.pathname + url.search,
            method: "GET",
            timeout: timeoutMs
        }, (res) => {
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
        });
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
async function runHeavyValidationCheck(target) {
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
                checks: result.checks,
                failures: result.failures
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
            failures: result.failures,
            logsTail: truncateOutput(result.logs, 24_000)
        }
    };
}
async function runStubDebtIntegrityChecks(target) {
    const summary = await summarizeStubDebt(target);
    const checks = [];
    if (summary.markerCount > 0) {
        checks.push({
            id: "stub_markers",
            status: "fail",
            message: "DeepRun provisional stub markers remain in the target.",
            details: {
                count: summary.markerCount,
                paths: summary.markerPaths.slice(0, 25)
            }
        });
    }
    else {
        checks.push({
            id: "stub_markers",
            status: "pass",
            message: "No DeepRun provisional stub markers found."
        });
    }
    if (summary.openCount > 0) {
        checks.push({
            id: "stub_debt",
            status: "fail",
            message: "Open stub-debt artifacts remain unresolved.",
            details: {
                count: summary.openCount,
                targets: summary.openTargets.slice(0, 25),
                lastStubPath: summary.lastStubPath,
                lastPaydownAction: summary.lastPaydownAction,
                lastPaydownStatus: summary.lastPaydownStatus,
                lastPaydownAt: summary.lastPaydownAt
            }
        });
    }
    else {
        checks.push({
            id: "stub_debt",
            status: "pass",
            message: "No open stub-debt artifacts remain."
        });
    }
    return checks;
}
async function runDockerValidationChecks(target) {
    const dockerBin = process.env.V1_DOCKER_BIN || process.env.DEPLOY_DOCKER_BIN || "docker";
    const buildTimeoutMs = Number(process.env.V1_DOCKER_BUILD_TIMEOUT_MS || 600_000);
    const bootTimeoutMs = Number(process.env.V1_DOCKER_BOOT_TIMEOUT_MS || 45_000);
    const containerPort = Number(process.env.V1_DOCKER_CONTAINER_PORT || process.env.DEPLOY_CONTAINER_PORT || 3000);
    const healthPath = normalizeHealthPath(process.env.V1_DOCKER_HEALTH_PATH || "/health");
    const keepImage = process.env.V1_DOCKER_KEEP_IMAGE === "true";
    const runMigrationCheck = process.env.V1_DOCKER_RUN_MIGRATION === "true";
    const migrationScript = (process.env.V1_DOCKER_MIGRATION_SCRIPT || "prisma:migrate").trim();
    const migrationTimeoutMs = Number(process.env.V1_DOCKER_MIGRATION_TIMEOUT_MS || 180_000);
    const migrationDatabaseUrlRaw = (process.env.V1_DOCKER_MIGRATION_DATABASE_URL ||
        process.env.DATABASE_URL ||
        "").trim();
    const bootDatabaseUrlRaw = (process.env.V1_DOCKER_BOOT_DATABASE_URL ||
        process.env.V1_DOCKER_MIGRATION_DATABASE_URL ||
        process.env.DATABASE_URL ||
        "").trim();
    const checks = [];
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
            id: "docker_migration",
            status: "skip",
            message: "Containerized migration dry run skipped because Docker CLI is unavailable."
        });
        checks.push({
            id: "docker_boot",
            status: "skip",
            message: "Docker boot check skipped because Docker CLI is unavailable."
        });
        return checks;
    }
    return withIsolatedWorktree({
        projectDir: target,
        prefix: "v1docker"
    }, async (isolatedRoot) => {
        const dockerfilePath = path.join(isolatedRoot, "Dockerfile");
        if (!(await pathExists(dockerfilePath))) {
            checks.push({
                id: "docker_build",
                status: "fail",
                message: "Dockerfile is missing."
            });
            checks.push({
                id: "docker_migration",
                status: "skip",
                message: "Containerized migration dry run skipped because Docker build did not run."
            });
            checks.push({
                id: "docker_boot",
                status: "skip",
                message: "Docker boot check skipped because Docker build did not run."
            });
            return checks;
        }
        const imageTag = `deeprun-v1-${Date.now()}-${randomBytes(4).toString("hex")}`.toLowerCase();
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
                id: "docker_migration",
                status: "skip",
                message: "Containerized migration dry run skipped because Docker build failed."
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
        if (!runMigrationCheck) {
            checks.push({
                id: "docker_migration",
                status: "skip",
                message: "Containerized migration dry run skipped (set V1_DOCKER_RUN_MIGRATION=true to enable)."
            });
        }
        else if (!migrationScript) {
            checks.push({
                id: "docker_migration",
                status: "fail",
                message: "Containerized migration dry run enabled but migration script is empty."
            });
        }
        else {
            const scripts = await readNpmScripts(isolatedRoot);
            if (!scripts[migrationScript]) {
                checks.push({
                    id: "docker_migration",
                    status: "fail",
                    message: `Containerized migration script '${migrationScript}' was not found in package.json scripts.`
                });
            }
            else if (!migrationDatabaseUrlRaw) {
                checks.push({
                    id: "docker_migration",
                    status: "fail",
                    message: "Containerized migration dry run requires DATABASE_URL (or V1_DOCKER_MIGRATION_DATABASE_URL) when enabled."
                });
            }
            else {
                const migrationDatabaseUrl = rewriteDatabaseUrlForDocker(migrationDatabaseUrlRaw);
                const migration = await runCommand({
                    command: dockerBin,
                    args: [
                        "run",
                        "--rm",
                        "--add-host",
                        "host.docker.internal:host-gateway",
                        "-e",
                        `DATABASE_URL=${migrationDatabaseUrl}`,
                        imageTag,
                        "npm",
                        "run",
                        migrationScript
                    ],
                    cwd: isolatedRoot,
                    allowFailure: true,
                    timeoutMs: migrationTimeoutMs
                });
                if (!migration.ok) {
                    checks.push({
                        id: "docker_migration",
                        status: "fail",
                        message: "Containerized migration dry run failed.",
                        details: {
                            script: migrationScript,
                            exitCode: migration.exitCode,
                            stderr: migration.stderr || undefined,
                            logsTail: truncateOutput(migration.combined, 24_000)
                        }
                    });
                }
                else {
                    checks.push({
                        id: "docker_migration",
                        status: "pass",
                        message: "Containerized migration dry run passed.",
                        details: {
                            script: migrationScript
                        }
                    });
                }
            }
        }
        let containerId = "";
        const hostPort = await acquireFreePort();
        const containerName = `deeprun-v1-check-${Date.now()}-${randomBytes(3).toString("hex")}`;
        const dockerBootEnvArgs = [];
        if (bootDatabaseUrlRaw) {
            dockerBootEnvArgs.push("-e", `DATABASE_URL=${rewriteDatabaseUrlForDocker(bootDatabaseUrlRaw)}`);
        }
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
                ...dockerBootEnvArgs,
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
        const healthUrl = `http://127.0.0.1:${hostPort}${healthPath}`;
        const startedAt = Date.now();
        let lastProbe = {
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
        }
        else {
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
    });
}
export async function runV1ReadinessCheck(targetPath, options = {}) {
    const target = targetPath ? path.resolve(targetPath) : process.cwd();
    const checks = [];
    const runHeavyCheck = options.runHeavyCheck || runHeavyValidationCheck;
    const runDockerChecks = options.runDockerChecks || runDockerValidationChecks;
    const now = options.now || (() => new Date());
    try {
        checks.push(await runHeavyCheck(target));
    }
    catch (error) {
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
        const stubDebtChecks = await runStubDebtIntegrityChecks(target);
        checks.push(...stubDebtChecks);
    }
    catch (error) {
        checks.push({
            id: "stub_markers",
            status: "fail",
            message: "Stub marker scan failed.",
            details: {
                error: error instanceof Error ? error.message : String(error)
            }
        });
        checks.push({
            id: "stub_debt",
            status: "fail",
            message: "Stub-debt integrity scan failed.",
            details: {
                error: error instanceof Error ? error.message : String(error)
            }
        });
    }
    try {
        const dockerChecks = await runDockerChecks(target);
        checks.push(...dockerChecks);
    }
    catch (error) {
        checks.push({
            id: "docker_build",
            status: "fail",
            message: "Docker validation execution failed.",
            details: {
                error: error instanceof Error ? error.message : String(error)
            }
        });
        checks.push({
            id: "docker_migration",
            status: "skip",
            message: "Containerized migration dry run skipped due to Docker validation execution failure."
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
        generatedAt: now().toISOString()
    };
    return payload;
}
async function main() {
    const payload = await runV1ReadinessCheck(process.argv[2]);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (!payload.ok) {
        process.exitCode = 1;
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stdout.write(`${JSON.stringify({
            verdict: "NO",
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        }, null, 2)}\n`);
        process.exitCode = 1;
    });
}
