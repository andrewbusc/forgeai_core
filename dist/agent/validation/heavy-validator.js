import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { withIsolatedWorktree } from "../../lib/git-versioning.js";
import { pathExists, readTextFile } from "../../lib/fs-utils.js";
import { runLightProjectValidation } from "./project-validator.js";
function truncateOutput(value, maxChars = 120_000) {
    if (value.length <= maxChars) {
        return value;
    }
    return value.slice(value.length - maxChars);
}
function shellSafeCommand(command, args) {
    return [command, ...args.map((arg) => (/[^A-Za-z0-9_./:-]/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}
async function runCommand(input) {
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
        const append = (chunk, stream) => {
            const text = chunk.toString("utf8");
            if (stream === "stdout") {
                stdout = truncateOutput(stdout + text);
            }
            else {
                stderr = truncateOutput(stderr + text);
            }
            combined = truncateOutput(combined + text);
        };
        child.stdout.on("data", (chunk) => append(chunk, "stdout"));
        child.stderr.on("data", (chunk) => append(chunk, "stderr"));
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
            const result = {
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
async function acquireFreePort() {
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
async function canConnectToPort(port) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        const done = (value) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(1_000);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
    });
}
async function wait(delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
}
async function runBootCheck(input) {
    const port = await acquireFreePort();
    const child = spawn(input.npmBin, ["run", "start"], {
        cwd: input.cwd,
        env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(port)
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let logs = "";
    const append = (chunk) => {
        logs = truncateOutput(logs + chunk.toString("utf8"));
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const startedAt = Date.now();
    let healthy = false;
    let exited = false;
    child.on("close", () => {
        exited = true;
    });
    while (Date.now() - startedAt < input.timeoutMs) {
        healthy = await canConnectToPort(port);
        if (healthy || exited) {
            break;
        }
        await wait(250);
    }
    if (!child.killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
            if (!child.killed) {
                child.kill("SIGKILL");
            }
        }, 1_000).unref();
    }
    if (healthy) {
        return {
            id: "boot",
            status: "pass",
            message: "Application accepted TCP connections during startup check.",
            details: {
                port
            }
        };
    }
    return {
        id: "boot",
        status: "fail",
        message: exited ? "Application exited before becoming healthy." : "Application did not become reachable in time.",
        details: {
            port,
            logs: logs || undefined
        }
    };
}
function summarizeResult(result) {
    const failedChecks = result.checks.filter((check) => check.status === "fail").map((check) => check.id);
    const checksPart = failedChecks.length ? `failed checks: ${failedChecks.join(", ")}` : "all heavy checks passed";
    return `${checksPart}; blocking=${result.blockingCount}; warnings=${result.warningCount}`;
}
export async function runHeavyProjectValidation(input) {
    return withIsolatedWorktree({
        projectDir: input.projectRoot,
        ref: input.ref,
        prefix: "heavy"
    }, async (isolatedRoot) => {
        const checks = [];
        const logs = [];
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
        }
        else {
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
                summary,
                logs: logs.join("\n\n")
            };
        }
        const npmBin = process.env.AGENT_VALIDATION_NPM_BIN || "npm";
        const packageRaw = await readTextFile(packageJsonPath);
        const packageJson = JSON.parse(packageRaw);
        const scripts = packageJson.scripts || {};
        const shouldInstallDeps = process.env.AGENT_HEAVY_INSTALL_DEPS !== "false";
        if (shouldInstallDeps) {
            const hasNodeModules = await pathExists(path.join(isolatedRoot, "node_modules"));
            if (!hasNodeModules) {
                const install = await runCommand({
                    cwd: isolatedRoot,
                    command: npmBin,
                    args: ["install", "--no-audit", "--no-fund"],
                    timeoutMs: Number(process.env.AGENT_HEAVY_INSTALL_TIMEOUT_MS || 300_000),
                    allowFailure: true
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
                }
                else {
                    checks.push({
                        id: "install",
                        status: "pass",
                        message: "Dependencies installed successfully."
                    });
                }
            }
        }
        else {
            checks.push({
                id: "install",
                status: "skip",
                message: "Dependency installation skipped by configuration."
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
            }
            else {
                checks.push({
                    id: "typecheck",
                    status: "pass",
                    message: "Typecheck command passed."
                });
            }
        }
        else {
            checks.push({
                id: "typecheck",
                status: "skip",
                message: "No npm 'check' script; skipping typecheck command."
            });
        }
        if (typeof scripts.test === "string" && scripts.test.trim()) {
            const test = await runCommand({
                cwd: isolatedRoot,
                command: npmBin,
                args: ["test"],
                timeoutMs: Number(process.env.AGENT_HEAVY_TEST_TIMEOUT_MS || 180_000),
                allowFailure: true
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
            }
            else {
                checks.push({
                    id: "tests",
                    status: "pass",
                    message: "Test command passed."
                });
            }
        }
        else {
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
                timeoutMs: Number(process.env.AGENT_HEAVY_BOOT_TIMEOUT_MS || 25_000)
            });
            checks.push(boot);
            if (boot.status === "fail") {
                blockingCount += 1;
            }
        }
        else {
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
            summary,
            logs: logs.join("\n\n")
        };
    });
}
