import net from "node:net";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { z } from "zod";
import { ensureDir, pathExists, readTextFile } from "../../lib/fs-utils.js";
import { workspacePath } from "../../lib/workspace.js";
import { writeRuntimeLog } from "./runtime-log-store.js";
const runPreviewContainerInputSchema = z.object({
    containerPort: z.number().int().min(1).max(65535).optional(),
    startupTimeoutMs: z.number().int().min(5_000).max(180_000).optional(),
    logTailLines: z.number().int().min(20).max(2_000).default(300)
});
function shellSafeCommand(command, args) {
    return [command, ...args.map((arg) => (/[^A-Za-z0-9_./:-]/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}
function truncateOutput(value, maxChars = 220_000) {
    if (value.length <= maxChars) {
        return value;
    }
    return value.slice(value.length - maxChars);
}
async function acquireFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("Could not allocate an open host port."));
                return;
            }
            const freePort = address.port;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(freePort);
            });
        });
    });
}
async function wait(delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
}
async function canConnectToPort(port) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        const cleanup = (result) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(1_500);
        socket.once("connect", () => cleanup(true));
        socket.once("timeout", () => cleanup(false));
        socket.once("error", () => cleanup(false));
    });
}
async function runCommandCapture(input) {
    const timeoutMs = input.timeoutMs ?? 120_000;
    return new Promise((resolve, reject) => {
        const child = spawn(input.command, input.args, {
            cwd: input.cwd,
            env: {
                ...process.env,
                ...input.env
            }
        });
        let stdout = "";
        let stderr = "";
        let combined = `$ ${shellSafeCommand(input.command, input.args)}\n`;
        const appendChunk = (chunk, target) => {
            const text = chunk.toString("utf8");
            if (target === "stdout") {
                stdout = truncateOutput(stdout + text);
            }
            else {
                stderr = truncateOutput(stderr + text);
            }
            combined = truncateOutput(combined + text);
        };
        child.stdout.on("data", (chunk) => appendChunk(chunk, "stdout"));
        child.stderr.on("data", (chunk) => appendChunk(chunk, "stderr"));
        child.on("error", (error) => {
            reject(error);
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
            const resolvedCode = Number.isInteger(code) ? Number(code) : 1;
            const result = {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                combined: combined.trim(),
                exitCode: resolvedCode
            };
            if (resolvedCode !== 0 && !input.allowFailure) {
                reject(new Error(`${input.command} exited with code ${String(code ?? "unknown")}.`));
                return;
            }
            resolve(result);
        });
    });
}
function resolveContainerPort(inputPort) {
    if (Number.isInteger(inputPort)) {
        const value = Number(inputPort);
        if (value >= 1 && value <= 65535) {
            return value;
        }
    }
    const envValue = Number(process.env.AGENT_RUNTIME_CONTAINER_PORT || process.env.DEPLOY_CONTAINER_PORT || 3000);
    if (Number.isInteger(envValue) && envValue >= 1 && envValue <= 65535) {
        return envValue;
    }
    return 3000;
}
function escapeDoubleQuotes(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
async function resolveDockerfileForRuntime(input) {
    const existingDockerfile = path.join(input.projectRoot, "Dockerfile");
    if (await pathExists(existingDockerfile)) {
        return {
            dockerfilePath: existingDockerfile,
            generated: false
        };
    }
    const packageJsonPath = path.join(input.projectRoot, "package.json");
    if (!(await pathExists(packageJsonPath))) {
        throw new Error("No Dockerfile or package.json found in project workspace.");
    }
    const parsed = JSON.parse(await readTextFile(packageJsonPath));
    const scripts = parsed.scripts || {};
    let startCommand = "node index.js";
    if (typeof scripts.start === "string" && scripts.start.trim()) {
        startCommand = "npm run start";
    }
    else if (typeof scripts.preview === "string" && scripts.preview.trim()) {
        startCommand = `npm run preview -- --host 0.0.0.0 --port ${input.containerPort}`;
    }
    else if (typeof scripts.dev === "string" && scripts.dev.trim()) {
        startCommand = `npm run dev -- --host 0.0.0.0 --port ${input.containerPort}`;
    }
    const hasBuildScript = typeof scripts.build === "string" && scripts.build.trim().length > 0;
    const buildCommand = hasBuildScript ? "RUN npm run build\n" : "";
    const generatedDockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
${buildCommand}ENV NODE_ENV=production
ENV PORT=${input.containerPort}
EXPOSE ${input.containerPort}
CMD ["sh", "-lc", "${escapeDoubleQuotes(startCommand)}"]
`;
    const dockerfileDir = workspacePath(".data", "agent-runtime", "dockerfiles");
    await ensureDir(dockerfileDir);
    const dockerfilePath = path.join(dockerfileDir, `${input.requestId}.Dockerfile`);
    await fs.writeFile(dockerfilePath, generatedDockerfile, "utf8");
    return {
        dockerfilePath,
        generated: true
    };
}
async function inspectContainerStatus(dockerBin, cwd, containerName) {
    const result = await runCommandCapture({
        command: dockerBin,
        args: ["inspect", "--format", "{{.State.Status}}", containerName],
        cwd,
        allowFailure: true,
        timeoutMs: 20_000
    });
    if (result.exitCode !== 0) {
        return null;
    }
    return result.stdout.trim() || null;
}
export const runPreviewContainerTool = {
    name: "run_preview_container",
    description: "Build and run an ephemeral runtime container to verify startup health.",
    inputSchema: runPreviewContainerInputSchema,
    async execute(input, context) {
        const now = new Date().toISOString();
        const dockerBin = process.env.AGENT_RUNTIME_DOCKER_BIN || process.env.DEPLOY_DOCKER_BIN || "docker";
        const containerPort = resolveContainerPort(input.containerPort);
        const startupTimeoutMs = input.startupTimeoutMs ?? (Number(process.env.AGENT_RUNTIME_STARTUP_TIMEOUT_MS || 45_000) || 45_000);
        const imageTag = `deeprun-agent-preview:${context.project.id.slice(0, 8)}-${Date.now().toString(36)}`;
        const containerName = `deeprun-agent-preview-${context.project.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
        const hostPort = await acquireFreePort();
        let combinedLogs = "";
        let dockerfilePath = null;
        let generatedDockerfile = false;
        let containerStatus = null;
        let startupOk = false;
        let runtimeStatus = "failed";
        let errorMessage = null;
        const appendLogs = (chunk) => {
            combinedLogs = truncateOutput(`${combinedLogs}\n${chunk}`.trim());
        };
        const cleanup = async () => {
            const removeContainer = await runCommandCapture({
                command: dockerBin,
                args: ["rm", "-f", containerName],
                cwd: context.projectRoot,
                allowFailure: true,
                timeoutMs: 25_000
            });
            if (removeContainer.exitCode === 0) {
                appendLogs(removeContainer.combined);
            }
            if (process.env.AGENT_RUNTIME_KEEP_IMAGES === "true") {
                return;
            }
            const removeImage = await runCommandCapture({
                command: dockerBin,
                args: ["rmi", imageTag],
                cwd: context.projectRoot,
                allowFailure: true,
                timeoutMs: 25_000
            });
            if (removeImage.exitCode === 0) {
                appendLogs(removeImage.combined);
            }
        };
        try {
            const dockerfile = await resolveDockerfileForRuntime({
                projectRoot: context.projectRoot,
                requestId: context.requestId,
                containerPort
            });
            dockerfilePath = dockerfile.dockerfilePath;
            generatedDockerfile = dockerfile.generated;
            const buildResult = await runCommandCapture({
                command: dockerBin,
                args: ["build", "-t", imageTag, "-f", dockerfile.dockerfilePath, context.projectRoot],
                cwd: context.projectRoot,
                timeoutMs: 10 * 60_000,
                allowFailure: true
            });
            appendLogs(buildResult.combined);
            if (buildResult.exitCode !== 0) {
                errorMessage = "Preview image build failed.";
            }
            else {
                const runResult = await runCommandCapture({
                    command: dockerBin,
                    args: [
                        "run",
                        "-d",
                        "--name",
                        containerName,
                        "-e",
                        `PORT=${containerPort}`,
                        "-p",
                        `${hostPort}:${containerPort}`,
                        imageTag
                    ],
                    cwd: context.projectRoot,
                    timeoutMs: 45_000,
                    allowFailure: true
                });
                appendLogs(runResult.combined);
                if (runResult.exitCode !== 0) {
                    errorMessage = "Preview container failed to start.";
                }
                else {
                    const deadline = Date.now() + startupTimeoutMs;
                    while (Date.now() < deadline) {
                        containerStatus = await inspectContainerStatus(dockerBin, context.projectRoot, containerName);
                        if (containerStatus === "exited" || containerStatus === "dead") {
                            break;
                        }
                        if (await canConnectToPort(hostPort)) {
                            startupOk = true;
                            break;
                        }
                        await wait(900);
                    }
                    const logResult = await runCommandCapture({
                        command: dockerBin,
                        args: ["logs", "--tail", String(input.logTailLines), containerName],
                        cwd: context.projectRoot,
                        timeoutMs: 30_000,
                        allowFailure: true
                    });
                    appendLogs(logResult.combined);
                    if (startupOk) {
                        runtimeStatus = "healthy";
                        errorMessage = null;
                    }
                    else {
                        runtimeStatus = "failed";
                        errorMessage =
                            containerStatus === "exited" || containerStatus === "dead"
                                ? "Container exited before passing startup checks."
                                : "Container did not become reachable before timeout.";
                    }
                }
            }
        }
        catch (error) {
            runtimeStatus = "failed";
            startupOk = false;
            errorMessage = error instanceof Error ? error.message : String(error);
            appendLogs(errorMessage);
        }
        finally {
            await cleanup().catch(() => undefined);
            await writeRuntimeLog({
                projectId: context.project.id,
                status: runtimeStatus,
                logs: combinedLogs,
                metadata: {
                    requestId: context.requestId,
                    containerName,
                    containerPort,
                    hostPort,
                    imageTag,
                    generatedDockerfile,
                    dockerfilePath,
                    startupOk,
                    containerStatus
                },
                updatedAt: new Date().toISOString()
            }).catch(() => undefined);
        }
        return {
            checkedAt: now,
            runtimeStatus,
            startupOk,
            errorMessage,
            containerName,
            containerPort,
            hostPort,
            imageTag,
            dockerfilePath,
            generatedDockerfile,
            containerStatus,
            logs: truncateOutput(combinedLogs, 160_000)
        };
    }
};
