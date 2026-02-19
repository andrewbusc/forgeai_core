import "dotenv/config";
import cors from "cors";
import express from "express";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";
import { runGeneration } from "./lib/generator.js";
import { buildTree, ensureDir, pathExists, readTextFile, safeResolvePath, writeTextFile } from "./lib/fs-utils.js";
import { AppStore } from "./lib/project-store.js";
import { ProviderRegistry } from "./lib/providers.js";
import { AgentKernel } from "./agent/kernel.js";
import { AgentRunService } from "./agent/run-service.js";
import { AgentRunWorker } from "./agent/run-worker.js";
import { getTemplate, listTemplates } from "./templates/catalog.js";
import { hashPassword, verifyPassword } from "./lib/auth.js";
import { slugify } from "./lib/strings.js";
import { createAutoCommit, listCommits, readDiff } from "./lib/git-versioning.js";
import { createAccessToken, createRefreshToken, getAccessTokenMaxAgeSeconds, getRefreshTokenMaxAgeSeconds, hashRefreshToken, verifyToken } from "./lib/tokens.js";
import { parseCookies, serializeCookie } from "./lib/http-cookies.js";
import { logError, logInfo, logWarn, serializeError } from "./lib/logging.js";
const templateIdSchema = z.enum(["saas-web-app", "agent-workflow", "chatbot"]);
const registerSchema = z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8).max(160),
    organizationName: z.string().min(2).max(120).optional(),
    workspaceName: z.string().min(2).max(120).optional()
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(160)
});
const createOrgSchema = z.object({
    name: z.string().min(2).max(120),
    workspaceName: z.string().min(2).max(120).optional()
});
const addMemberSchema = z.object({
    email: z.string().email(),
    role: z.enum(["admin", "member"]).default("member")
});
const createWorkspaceSchema = z.object({
    orgId: z.string().uuid(),
    name: z.string().min(2).max(120),
    description: z.string().max(400).optional()
});
const createProjectSchema = z.object({
    workspaceId: z.string().uuid(),
    name: z.string().min(2).max(100),
    description: z.string().max(500).optional(),
    templateId: templateIdSchema.default("saas-web-app")
});
const generateSchema = z.object({
    prompt: z.string().min(4).max(24_000),
    provider: z.string().default("mock"),
    model: z.string().max(100).optional()
});
const createAgentRunSchema = z.object({
    goal: z.string().min(4).max(24_000),
    provider: z.string().default("mock"),
    model: z.string().max(100).optional()
});
const createAgentStateRunSchema = z.object({
    goal: z.string().min(4).max(24_000),
    maxSteps: z.number().int().min(1).max(1_000).optional(),
    maxCorrections: z.number().int().min(0).max(100).optional(),
    maxOptimizations: z.number().int().min(0).max(100).optional(),
    autoStart: z.boolean().default(true)
});
const tickAgentStateRunSchema = z.object({
    expectedStepIndex: z.number().int().min(0).optional()
});
const updateFileSchema = z.object({
    path: z.string().min(1).max(240),
    content: z.string().max(1_500_000)
});
const gitCommitSchema = z.object({
    message: z.string().min(4).max(200)
});
const createDeploymentSchema = z.object({
    customDomain: z.string().trim().max(255).optional(),
    containerPort: z.number().int().min(1).max(65535).optional()
});
const app = express();
const store = new AppStore();
const providers = new ProviderRegistry();
const agentKernel = new AgentKernel({ store });
const agentRunService = new AgentRunService(store);
const agentRunWorker = new AgentRunWorker(agentRunService);
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
if (!corsAllowedOrigins.length) {
    throw new Error("CORS_ALLOWED_ORIGINS must be set to one or more explicit origins.");
}
if (corsAllowedOrigins.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS cannot include '*'. Use explicit origins.");
}
function parseSameSite(value) {
    if (value === "Strict" || value === "None") {
        return value;
    }
    return "Lax";
}
const cookieSecure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const cookieSameSite = parseSameSite(process.env.COOKIE_SAMESITE);
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
if (cookieSameSite === "None" && !cookieSecure) {
    throw new Error("COOKIE_SAMESITE=None requires COOKIE_SECURE=true.");
}
const ACCESS_COOKIE_NAME = "forgeai_at";
const REFRESH_COOKIE_NAME = "forgeai_rt";
const rateLimitConfig = {
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX || 8),
    loginWindowSec: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_SEC || 600),
    generationMax: Number(process.env.RATE_LIMIT_GENERATION_MAX || 30),
    generationWindowSec: Number(process.env.RATE_LIMIT_GENERATION_WINDOW_SEC || 300)
};
const deploymentConfig = {
    dockerBin: process.env.DEPLOY_DOCKER_BIN || "docker",
    registryHost: (process.env.DEPLOY_REGISTRY || "").trim(),
    baseDomain: (process.env.DEPLOY_BASE_DOMAIN || "forgeai.app").trim().toLowerCase(),
    publicUrlTemplate: (process.env.DEPLOY_PUBLIC_URL_TEMPLATE || "").trim(),
    dockerNetwork: (process.env.DEPLOY_DOCKER_NETWORK || "").trim(),
    containerPortDefault: Number(process.env.DEPLOY_CONTAINER_PORT || 3000),
    stopPrevious: process.env.DEPLOY_STOP_PREVIOUS !== "false"
};
const deploymentJobsByProject = new Set();
const customDomainRegex = /^(?=.{3,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
app.use(cors({
    origin(origin, callback) {
        if (!origin) {
            callback(null, true);
            return;
        }
        if (corsAllowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error("Origin not allowed by CORS."));
    },
    credentials: true
}));
app.use(express.json({ limit: "10mb" }));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
app.use(express.static(publicDir));
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function isPgUniqueViolation(error) {
    return Boolean(error &&
        typeof error === "object" &&
        "code" in error &&
        String(error.code) === "23505");
}
function appendCookie(res, cookie) {
    res.append("Set-Cookie", cookie);
}
function setAuthCookies(res, accessToken, refreshToken) {
    appendCookie(res, serializeCookie(ACCESS_COOKIE_NAME, accessToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        path: "/",
        domain: cookieDomain,
        maxAgeSeconds: getAccessTokenMaxAgeSeconds()
    }));
    appendCookie(res, serializeCookie(REFRESH_COOKIE_NAME, refreshToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        path: "/",
        domain: cookieDomain,
        maxAgeSeconds: getRefreshTokenMaxAgeSeconds()
    }));
}
function clearAuthCookies(res) {
    appendCookie(res, serializeCookie(ACCESS_COOKIE_NAME, "", {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        path: "/",
        domain: cookieDomain,
        maxAgeSeconds: 0
    }));
    appendCookie(res, serializeCookie(REFRESH_COOKIE_NAME, "", {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        path: "/",
        domain: cookieDomain,
        maxAgeSeconds: 0
    }));
}
function getRequestId(req) {
    return req.requestId || "unknown";
}
app.use((req, res, next) => {
    const requestIdHeader = req.headers["x-request-id"];
    const requestId = typeof requestIdHeader === "string" && requestIdHeader ? requestIdHeader : randomUUID();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    const startedAt = Date.now();
    logInfo("http.request", {
        requestId,
        method: req.method,
        path: req.path,
        ip: req.ip
    });
    res.on("finish", () => {
        logInfo("http.response", {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            userId: req.auth?.user.id || null
        });
    });
    next();
});
async function enforceRateLimit(req, res, options) {
    const decision = await store.consumeRateLimit(options.key, options.limit, options.windowSec);
    res.setHeader("x-ratelimit-limit", String(options.limit));
    res.setHeader("x-ratelimit-remaining", String(decision.remaining));
    res.setHeader("x-ratelimit-reset", decision.resetAt);
    if (!decision.allowed) {
        res.setHeader("retry-after", String(decision.retryAfterSeconds));
        throw new HttpError(429, options.reason);
    }
}
const authRequired = async (req, res, next) => {
    try {
        const cookies = parseCookies(req.headers.cookie);
        const accessToken = cookies[ACCESS_COOKIE_NAME];
        if (!accessToken) {
            throw new HttpError(401, "Authentication required.");
        }
        let payload;
        try {
            payload = verifyToken(accessToken, "access");
        }
        catch {
            throw new HttpError(401, "Invalid access token.");
        }
        const session = await store.getSessionById(payload.sid);
        if (!session || session.revokedAt || session.expiresAt <= new Date().toISOString()) {
            clearAuthCookies(res);
            throw new HttpError(401, "Session is no longer valid.");
        }
        if (session.userId !== payload.uid) {
            await store.revokeSession(session.id);
            clearAuthCookies(res);
            throw new HttpError(401, "Session mismatch.");
        }
        const user = await store.getUserById(session.userId);
        if (!user) {
            await store.revokeSession(session.id);
            clearAuthCookies(res);
            throw new HttpError(401, "Session user not found.");
        }
        await store.touchSession(session.id);
        req.auth = {
            user: store.toPublicUser(user),
            sessionId: session.id
        };
        next();
    }
    catch (error) {
        next(error);
    }
};
function getAuth(req) {
    const appReq = req;
    if (!appReq.auth) {
        throw new HttpError(401, "Authentication required.");
    }
    return appReq.auth;
}
function isOrgManager(role) {
    return role === "owner" || role === "admin";
}
function commitMessageForPrompt(kind, prompt) {
    const prefix = kind === "generate" ? "AI generate:" : "AI chat:";
    const trimmed = prompt.replace(/\s+/g, " ").trim().slice(0, 68);
    return `${prefix} ${trimmed}`;
}
async function createOrganizationWithUniqueSlug(name) {
    const baseSlug = slugify(name);
    let counter = 1;
    while (counter <= 60) {
        const candidate = counter === 1 ? baseSlug : `${baseSlug}-${counter}`;
        try {
            return await store.createOrganization({ name, slug: candidate });
        }
        catch (error) {
            if (isPgUniqueViolation(error)) {
                counter += 1;
                continue;
            }
            throw error;
        }
    }
    throw new Error("Could not allocate organization slug.");
}
async function requireWorkspaceAccess(userId, workspaceId) {
    const workspace = await store.getWorkspace(workspaceId);
    if (!workspace) {
        throw new HttpError(404, "Workspace not found.");
    }
    const membership = await store.getMembership(userId, workspace.orgId);
    if (!membership) {
        throw new HttpError(403, "No access to this workspace.");
    }
    return { workspace, membership };
}
async function requireProjectAccess(userId, projectId) {
    const project = await store.getProject(projectId);
    if (!project) {
        throw new HttpError(404, "Project not found.");
    }
    const membership = await store.getMembership(userId, project.orgId);
    if (!membership) {
        throw new HttpError(403, "No access to this project.");
    }
    return project;
}
async function assertNoActiveAgentRunMutation(projectId) {
    const locked = await store.hasActiveAgentRun(projectId);
    if (locked) {
        throw new HttpError(409, "Project branch mutation is blocked while an agent run is active. Complete, cancel, or fail the active run first.");
    }
}
async function buildAccountPayload(user) {
    const orgMemberships = await store.listOrganizationsForUser(user.id);
    const organizations = await Promise.all(orgMemberships.map(async (entry) => {
        const workspaces = await store.listWorkspacesByOrg(entry.organization.id);
        return {
            id: entry.organization.id,
            name: entry.organization.name,
            slug: entry.organization.slug,
            role: entry.role,
            workspaces
        };
    }));
    return {
        user,
        organizations
    };
}
async function createAndSetSession(req, res, userId) {
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken(sessionId, userId);
    const accessToken = createAccessToken(sessionId, userId);
    await store.createSession({
        sessionId,
        userId,
        refreshTokenHash: hashRefreshToken(refreshToken.token),
        expiresAt: refreshToken.expiresAt,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || undefined
    });
    setAuthCookies(res, accessToken.token, refreshToken.token);
    return {
        sessionExpiresAt: refreshToken.expiresAt
    };
}
function sanitizeCustomDomain(value) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (!customDomainRegex.test(normalized)) {
        throw new HttpError(400, "customDomain must be a valid domain.");
    }
    return normalized;
}
function getContainerPort(candidate) {
    const fallback = Number.isInteger(deploymentConfig.containerPortDefault)
        ? deploymentConfig.containerPortDefault
        : 3000;
    const value = Number.isInteger(candidate) ? candidate : fallback;
    if (value < 1 || value > 65535) {
        throw new HttpError(400, "containerPort must be between 1 and 65535.");
    }
    return value;
}
function buildDeploymentSubdomain(project, deploymentId) {
    const base = slugify(project.name).replace(/^-+|-+$/g, "") || "app";
    const suffix = deploymentId.slice(0, 8);
    const truncatedBase = base.slice(0, Math.max(1, 63 - suffix.length - 1));
    return `${truncatedBase}-${suffix}`;
}
function resolveDeploymentPublicUrl(subdomain, customDomain) {
    if (customDomain) {
        return `https://${customDomain}`;
    }
    if (deploymentConfig.publicUrlTemplate) {
        return deploymentConfig.publicUrlTemplate
            .replaceAll("{{subdomain}}", subdomain)
            .replaceAll("{{baseDomain}}", deploymentConfig.baseDomain);
    }
    return `https://${subdomain}.${deploymentConfig.baseDomain}`;
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
function shellSafeCommand(command, args) {
    return [command, ...args.map((arg) => (/[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}
async function runCommandWithLogs(input) {
    input.onLog(`$ ${shellSafeCommand(input.command, input.args)}`);
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
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            stdout += text;
            input.onLog(text);
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            stderr += text;
            input.onLog(text);
        });
        child.on("error", (error) => {
            reject(error);
        });
        child.on("close", (code) => {
            if (code === 0) {
                resolve({
                    stdout: stdout.trim(),
                    stderr: stderr.trim()
                });
                return;
            }
            reject(new Error(`${input.command} exited with code ${String(code ?? "unknown")}.`));
        });
    });
}
function escapeDoubleQuotes(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
async function resolveDockerfileForDeployment(input) {
    const defaultDockerfilePath = path.join(input.projectPath, "Dockerfile");
    if (await pathExists(defaultDockerfilePath)) {
        return {
            dockerfilePath: defaultDockerfilePath,
            generated: false
        };
    }
    const packageJsonPath = path.join(input.projectPath, "package.json");
    if (!(await pathExists(packageJsonPath))) {
        throw new Error("No Dockerfile found. Add a Dockerfile to this project before deploying.");
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
    const generatedDir = path.join(rootDir, ".data", "deploy", "dockerfiles");
    await ensureDir(generatedDir);
    const generatedPath = path.join(generatedDir, `${input.deploymentId}.Dockerfile`);
    await fs.writeFile(generatedPath, generatedDockerfile, "utf8");
    return {
        dockerfilePath: generatedPath,
        generated: true
    };
}
function deploymentPublicShape(deployment) {
    const { logs: _logs, ...rest } = deployment;
    return rest;
}
async function runDeploymentPipeline(input) {
    const deployment = await store.getDeployment(input.deploymentId);
    if (!deployment) {
        deploymentJobsByProject.delete(input.project.id);
        return;
    }
    let logChain = Promise.resolve();
    const queueLog = (raw) => {
        const normalized = raw.replaceAll("\r", "");
        const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
        if (!lines.length) {
            return;
        }
        for (const line of lines) {
            const entry = `[${new Date().toISOString()}] ${line}\n`;
            logChain = logChain
                .then(() => store.appendDeploymentLog(input.deploymentId, entry))
                .catch((error) => {
                logWarn("deployment.log_append_failed", {
                    requestId: input.requestId,
                    deploymentId: input.deploymentId,
                    ...serializeError(error)
                });
            });
        }
    };
    const updateDeployment = async (patch) => {
        await store.updateDeployment(input.deploymentId, patch);
    };
    try {
        if (!deploymentConfig.registryHost) {
            throw new Error("DEPLOY_REGISTRY is not configured.");
        }
        const previousActive = await store.listActiveDeploymentsByProject(input.project.id);
        const projectPath = store.getProjectWorkspacePath(input.project);
        if (!(await pathExists(projectPath))) {
            throw new Error("Project workspace does not exist.");
        }
        const imageRepositorySlug = slugify(`${input.project.name}-${input.project.id.slice(0, 8)}`);
        const imageRepository = `${deploymentConfig.registryHost}/${imageRepositorySlug}`;
        const imageTag = input.deploymentId;
        const imageRef = `${imageRepository}:${imageTag}`;
        await updateDeployment({
            status: "building",
            imageRepository,
            imageTag,
            imageRef,
            registryHost: deploymentConfig.registryHost,
            errorMessage: null,
            finishedAt: null
        });
        queueLog(`Starting deployment ${input.deploymentId} for project ${input.project.id}.`);
        queueLog(`Assigning immutable image tag ${imageRef}.`);
        const containerPort = deployment.containerPort || getContainerPort(undefined);
        const dockerfile = await resolveDockerfileForDeployment({
            projectPath,
            deploymentId: input.deploymentId,
            containerPort
        });
        queueLog(dockerfile.generated ? `Generated Dockerfile: ${dockerfile.dockerfilePath}` : "Using project Dockerfile.");
        await runCommandWithLogs({
            command: deploymentConfig.dockerBin,
            args: ["build", "-t", imageRef, "-f", dockerfile.dockerfilePath, projectPath],
            cwd: projectPath,
            onLog: queueLog
        });
        await updateDeployment({ status: "pushing" });
        queueLog("Docker image built. Pushing to registry...");
        await runCommandWithLogs({
            command: deploymentConfig.dockerBin,
            args: ["push", imageRef],
            cwd: projectPath,
            onLog: queueLog
        });
        let imageDigest = null;
        try {
            const inspect = await runCommandWithLogs({
                command: deploymentConfig.dockerBin,
                args: ["image", "inspect", imageRef, "--format", "{{index .RepoDigests 0}}"],
                cwd: projectPath,
                onLog: queueLog
            });
            imageDigest = inspect.stdout || null;
        }
        catch (error) {
            queueLog(`Could not resolve pushed image digest: ${String(error.message || error)}`);
        }
        await updateDeployment({
            status: "launching",
            imageDigest
        });
        queueLog("Launching production container...");
        const hostPort = await acquireFreePort();
        const containerName = `forgeai-${input.project.id.slice(0, 8)}-${input.deploymentId.slice(0, 8)}`;
        const runArgs = [
            "run",
            "-d",
            "--restart",
            "unless-stopped",
            "--name",
            containerName,
            "-e",
            `PORT=${containerPort}`,
            "-p",
            `${hostPort}:${containerPort}`
        ];
        if (deploymentConfig.dockerNetwork) {
            runArgs.push("--network", deploymentConfig.dockerNetwork);
        }
        runArgs.push(imageRef);
        const runResult = await runCommandWithLogs({
            command: deploymentConfig.dockerBin,
            args: runArgs,
            cwd: projectPath,
            onLog: queueLog
        });
        const containerId = runResult.stdout.split(/\s+/).pop() || null;
        await updateDeployment({
            status: "ready",
            containerName,
            containerId,
            containerPort,
            hostPort,
            errorMessage: null,
            finishedAt: new Date().toISOString()
        });
        await store.setActiveDeployment(input.project.id, input.deploymentId);
        queueLog(`Deployment ready: ${deployment.publicUrl}`);
        queueLog(`Container ${containerName} is exposed on localhost:${hostPort}.`);
        if (deploymentConfig.stopPrevious) {
            for (const oldDeployment of previousActive) {
                if (!oldDeployment.containerName || oldDeployment.id === input.deploymentId) {
                    continue;
                }
                try {
                    queueLog(`Stopping previous container ${oldDeployment.containerName}...`);
                    await runCommandWithLogs({
                        command: deploymentConfig.dockerBin,
                        args: ["rm", "-f", oldDeployment.containerName],
                        cwd: projectPath,
                        onLog: queueLog
                    });
                    await store.updateDeployment(oldDeployment.id, { isActive: false });
                }
                catch (error) {
                    queueLog(`Failed to remove previous container ${oldDeployment.containerName}.`);
                    logWarn("deployment.previous_cleanup_failed", {
                        requestId: input.requestId,
                        deploymentId: oldDeployment.id,
                        containerName: oldDeployment.containerName,
                        ...serializeError(error)
                    });
                }
            }
        }
        logInfo("deployment.completed", {
            requestId: input.requestId,
            deploymentId: input.deploymentId,
            projectId: input.project.id,
            imageRef,
            hostPort
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        queueLog(`Deployment failed: ${message}`);
        try {
            await updateDeployment({
                status: "failed",
                errorMessage: message,
                finishedAt: new Date().toISOString(),
                isActive: false
            });
        }
        catch (updateError) {
            logError("deployment.failure_state_write_failed", {
                requestId: input.requestId,
                deploymentId: input.deploymentId,
                projectId: input.project.id,
                ...serializeError(updateError)
            });
        }
        logError("deployment.failed", {
            requestId: input.requestId,
            deploymentId: input.deploymentId,
            projectId: input.project.id,
            ...serializeError(error)
        });
    }
    finally {
        await logChain;
        deploymentJobsByProject.delete(input.project.id);
    }
}
app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        now: new Date().toISOString()
    });
});
app.post("/api/auth/register", async (req, res, next) => {
    try {
        const parsed = registerSchema.parse(req.body ?? {});
        const passwordHash = await hashPassword(parsed.password);
        let user;
        try {
            user = await store.createUser({
                name: parsed.name,
                email: parsed.email,
                passwordHash
            });
        }
        catch (error) {
            if (isPgUniqueViolation(error)) {
                throw new HttpError(409, "Email is already in use.");
            }
            throw error;
        }
        const organization = await createOrganizationWithUniqueSlug(parsed.organizationName || `${parsed.name}'s Organization`);
        await store.createMembership({
            orgId: organization.id,
            userId: user.id,
            role: "owner"
        });
        const workspace = await store.createWorkspace({
            orgId: organization.id,
            name: parsed.workspaceName || "Primary Workspace",
            description: "Default workspace"
        });
        const sessionData = await createAndSetSession(req, res, user.id);
        const payload = await buildAccountPayload(store.toPublicUser(user));
        res.status(201).json({
            sessionExpiresAt: sessionData.sessionExpiresAt,
            ...payload,
            activeOrganizationId: organization.id,
            activeWorkspaceId: workspace.id
        });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/auth/login", async (req, res, next) => {
    try {
        const parsed = loginSchema.parse(req.body ?? {});
        await enforceRateLimit(req, res, {
            key: `login:${req.ip}:${parsed.email.toLowerCase()}`,
            limit: rateLimitConfig.loginMax,
            windowSec: rateLimitConfig.loginWindowSec,
            reason: "Too many login attempts. Try again later."
        });
        const user = await store.findUserByEmail(parsed.email);
        if (!user) {
            throw new HttpError(401, "Invalid credentials.");
        }
        const validPassword = await verifyPassword(parsed.password, user.passwordHash);
        if (!validPassword) {
            throw new HttpError(401, "Invalid credentials.");
        }
        const sessionData = await createAndSetSession(req, res, user.id);
        const payload = await buildAccountPayload(store.toPublicUser(user));
        const activeOrganizationId = payload.organizations[0]?.id;
        const activeWorkspaceId = payload.organizations[0]?.workspaces?.[0]?.id;
        res.json({
            sessionExpiresAt: sessionData.sessionExpiresAt,
            ...payload,
            activeOrganizationId,
            activeWorkspaceId
        });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/auth/refresh", async (req, res, next) => {
    try {
        const cookies = parseCookies(req.headers.cookie);
        const refreshToken = cookies[REFRESH_COOKIE_NAME];
        if (!refreshToken) {
            throw new HttpError(401, "Missing refresh token.");
        }
        let payload;
        try {
            payload = verifyToken(refreshToken, "refresh");
        }
        catch {
            clearAuthCookies(res);
            throw new HttpError(401, "Invalid refresh token.");
        }
        const session = await store.getSessionById(payload.sid);
        if (!session || session.revokedAt || session.expiresAt <= new Date().toISOString()) {
            clearAuthCookies(res);
            throw new HttpError(401, "Refresh session expired.");
        }
        if (session.userId !== payload.uid) {
            await store.revokeSession(session.id);
            clearAuthCookies(res);
            throw new HttpError(401, "Refresh token mismatch.");
        }
        const refreshHash = hashRefreshToken(refreshToken);
        if (refreshHash !== session.refreshTokenHash) {
            await store.revokeSession(session.id);
            clearAuthCookies(res);
            throw new HttpError(401, "Refresh token reuse detected.");
        }
        const user = await store.getUserById(session.userId);
        if (!user) {
            await store.revokeSession(session.id);
            clearAuthCookies(res);
            throw new HttpError(401, "Session user not found.");
        }
        const newRefresh = createRefreshToken(session.id, session.userId);
        const newAccess = createAccessToken(session.id, session.userId);
        await store.rotateSession(session.id, hashRefreshToken(newRefresh.token), newRefresh.expiresAt);
        setAuthCookies(res, newAccess.token, newRefresh.token);
        res.json({
            ok: true,
            sessionExpiresAt: newRefresh.expiresAt,
            user: store.toPublicUser(user)
        });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/auth/me", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const payload = await buildAccountPayload(auth.user);
        res.json(payload);
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/auth/logout", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        await store.revokeSession(auth.sessionId);
        clearAuthCookies(res);
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/providers", authRequired, (_req, res) => {
    res.json({ providers: providers.list() });
});
app.get("/api/templates", authRequired, (_req, res) => {
    const templates = listTemplates().map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        recommendedPrompt: template.recommendedPrompt,
        starterFileCount: Object.keys(template.starterFiles).length
    }));
    res.json({ templates });
});
app.get("/api/orgs", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const organizations = await store.listOrganizationsForUser(auth.user.id);
        const payload = await Promise.all(organizations.map(async (entry) => ({
            id: entry.organization.id,
            name: entry.organization.name,
            slug: entry.organization.slug,
            role: entry.role,
            workspaces: await store.listWorkspacesByOrg(entry.organization.id)
        })));
        res.json({ organizations: payload });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/orgs", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const parsed = createOrgSchema.parse(req.body ?? {});
        const organization = await createOrganizationWithUniqueSlug(parsed.name);
        await store.createMembership({
            orgId: organization.id,
            userId: auth.user.id,
            role: "owner"
        });
        const workspace = await store.createWorkspace({
            orgId: organization.id,
            name: parsed.workspaceName || "Primary Workspace",
            description: "Default workspace"
        });
        res.status(201).json({ organization, workspace });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/orgs/:orgId/members", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const parsed = addMemberSchema.parse(req.body ?? {});
        const membership = await store.getMembership(auth.user.id, req.params.orgId);
        if (!membership || !isOrgManager(membership.role)) {
            throw new HttpError(403, "Only owners/admins can add members.");
        }
        const user = await store.findUserByEmail(parsed.email);
        if (!user) {
            throw new HttpError(404, "User with that email was not found.");
        }
        const addedMembership = await store.createMembership({
            orgId: req.params.orgId,
            userId: user.id,
            role: parsed.role
        });
        await store.updateMembershipRole(req.params.orgId, user.id, parsed.role);
        res.status(201).json({ membership: { ...addedMembership, role: parsed.role }, user: store.toPublicUser(user) });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/workspaces", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const orgId = String(req.query.orgId ?? "");
        if (!orgId) {
            throw new HttpError(400, "orgId query param is required.");
        }
        const membership = await store.getMembership(auth.user.id, orgId);
        if (!membership) {
            throw new HttpError(403, "No access to this organization.");
        }
        const workspaces = await store.listWorkspacesByOrg(orgId);
        res.json({ workspaces });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/workspaces", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const parsed = createWorkspaceSchema.parse(req.body ?? {});
        const membership = await store.getMembership(auth.user.id, parsed.orgId);
        if (!membership || !isOrgManager(membership.role)) {
            throw new HttpError(403, "Only owners/admins can create workspaces.");
        }
        const workspace = await store.createWorkspace(parsed);
        res.status(201).json({ workspace });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : undefined;
        if (workspaceId) {
            await requireWorkspaceAccess(auth.user.id, workspaceId);
        }
        const projects = await store.listProjectsForUser(auth.user.id, workspaceId);
        res.json({ projects });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const parsed = createProjectSchema.parse(req.body ?? {});
        const { workspace } = await requireWorkspaceAccess(auth.user.id, parsed.workspaceId);
        const project = await store.createProject({
            orgId: workspace.orgId,
            workspaceId: workspace.id,
            createdByUserId: auth.user.id,
            name: parsed.name,
            description: parsed.description,
            templateId: parsed.templateId
        });
        const template = getTemplate(parsed.templateId);
        const projectPath = store.getProjectWorkspacePath(project);
        for (const [relativePath, content] of Object.entries(template.starterFiles)) {
            const target = safeResolvePath(projectPath, relativePath);
            await writeTextFile(target, content);
        }
        const commitHash = await createAutoCommit(projectPath, `Scaffold ${template.name} template`).catch(() => null);
        project.history.unshift({
            id: randomUUID(),
            kind: "generate",
            prompt: "Initial scaffold",
            summary: `Scaffolded ${template.name} template with ${Object.keys(template.starterFiles).length} files.`,
            provider: "system",
            model: "template",
            filesChanged: Object.keys(template.starterFiles),
            commands: ["npm install", "npm run dev"],
            commitHash: commitHash ?? undefined,
            createdAt: new Date().toISOString()
        });
        await store.updateProject(project);
        res.status(201).json({ project });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const tree = await buildTree(store.getProjectWorkspacePath(project));
        res.json({ project, tree });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/tree", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const tree = await buildTree(store.getProjectWorkspacePath(project));
        res.json({ tree });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/file", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const queryPath = String(req.query.path ?? "");
        if (!queryPath) {
            throw new HttpError(400, "Missing path query parameter.");
        }
        const fullPath = safeResolvePath(store.getProjectWorkspacePath(project), queryPath);
        const content = await readTextFile(fullPath);
        res.json({ path: queryPath, content });
    }
    catch (error) {
        next(error);
    }
});
app.put("/api/projects/:projectId/file", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        await assertNoActiveAgentRunMutation(project.id);
        const parsed = updateFileSchema.parse(req.body ?? {});
        const target = safeResolvePath(store.getProjectWorkspacePath(project), parsed.path);
        await writeTextFile(target, parsed.content);
        const now = new Date().toISOString();
        const commitHash = await createAutoCommit(store.getProjectWorkspacePath(project), `Manual edit: ${parsed.path}`).catch(() => null);
        project.updatedAt = now;
        project.history.unshift({
            id: randomUUID(),
            kind: "manual-edit",
            prompt: `Manual edit: ${parsed.path}`,
            summary: `Updated ${parsed.path}`,
            provider: "system",
            model: "manual",
            filesChanged: [parsed.path],
            commands: [],
            commitHash: commitHash ?? undefined,
            createdAt: now
        });
        project.history = project.history.slice(0, 80);
        await store.updateProject(project);
        res.json({ ok: true, commitHash });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/history", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        res.json({ history: project.history });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/runs", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        await assertNoActiveAgentRunMutation(project.id);
        const parsed = createAgentRunSchema.parse(req.body ?? {});
        await enforceRateLimit(req, res, {
            key: `generate:${auth.user.id}`,
            limit: rateLimitConfig.generationMax,
            windowSec: rateLimitConfig.generationWindowSec,
            reason: "Generation rate limit reached. Try again shortly."
        });
        const run = await agentKernel.startRun({
            project,
            createdByUserId: auth.user.id,
            goal: parsed.goal,
            providerId: parsed.provider,
            model: parsed.model,
            requestId
        });
        res.status(201).json(run);
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/agent/runs", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const runs = await agentKernel.listRuns(project.id);
        res.json({ runs });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/agent/runs/:runId", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const detail = await agentKernel.getRunWithSteps(project.id, req.params.runId);
        if (!detail) {
            throw new HttpError(404, "Agent run not found.");
        }
        res.json(detail);
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/runs/:runId/resume", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        await enforceRateLimit(req, res, {
            key: `generate:${auth.user.id}`,
            limit: rateLimitConfig.generationMax,
            windowSec: rateLimitConfig.generationWindowSec,
            reason: "Generation rate limit reached. Try again shortly."
        });
        let detail;
        try {
            detail = await agentKernel.resumeRun({
                project,
                runId: req.params.runId,
                requestId
            });
        }
        catch (error) {
            if (error instanceof Error && error.message === "Agent run not found.") {
                throw new HttpError(404, "Agent run not found.");
            }
            throw error;
        }
        res.json(detail);
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/runs/:runId/fork/:stepId", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        await assertNoActiveAgentRunMutation(project.id);
        const detail = await agentKernel.forkRun({
            project,
            runId: req.params.runId,
            stepId: req.params.stepId,
            createdByUserId: auth.user.id,
            requestId
        });
        res.status(201).json(detail);
    }
    catch (error) {
        if (error instanceof Error && error.message === "Agent run not found.") {
            next(new HttpError(404, "Agent run not found."));
            return;
        }
        if (error instanceof Error && error.message === "Agent step not found.") {
            next(new HttpError(404, "Agent step not found for fork."));
            return;
        }
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/runs/:runId/validate", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const result = await agentKernel.validateRunOutput({
            project,
            runId: req.params.runId,
            requestId
        });
        res.json(result);
    }
    catch (error) {
        if (error instanceof Error && error.message === "Agent run not found.") {
            next(new HttpError(404, "Agent run not found."));
            return;
        }
        if (error instanceof Error && error.message === "Cannot validate output while run is still running.") {
            next(new HttpError(409, error.message));
            return;
        }
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/state-runs", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const parsed = createAgentStateRunSchema.parse(req.body ?? {});
        const run = await agentRunService.createRun({
            project,
            createdByUserId: auth.user.id,
            goal: parsed.goal,
            maxSteps: parsed.maxSteps,
            maxCorrections: parsed.maxCorrections,
            maxOptimizations: parsed.maxOptimizations,
            requestId
        });
        if (parsed.autoStart) {
            agentRunWorker.enqueue({
                projectId: project.id,
                runId: run.id,
                requestId
            });
        }
        res.status(201).json({
            run
        });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/agent/state-runs", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const runs = await agentRunService.listRuns(project.id);
        res.json({ runs });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/agent/state-runs/:runId", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const detail = await agentRunService.getRunWithSteps(project.id, req.params.runId);
        if (!detail) {
            throw new HttpError(404, "Agent state run not found.");
        }
        res.json(detail);
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/state-runs/:runId/cancel", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        let run;
        try {
            run = await agentRunService.markRunCancelling(project.id, req.params.runId, requestId);
        }
        catch (error) {
            if (error instanceof Error && error.message === "Agent run not found.") {
                throw new HttpError(404, "Agent state run not found.");
            }
            throw error;
        }
        agentRunWorker.enqueue({
            projectId: project.id,
            runId: run.id,
            requestId
        });
        res.json({ run });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/state-runs/:runId/resume", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        let run;
        try {
            run = await agentRunService.resumeRun(project.id, req.params.runId, requestId);
        }
        catch (error) {
            if (error instanceof Error && error.message === "Agent run not found.") {
                throw new HttpError(404, "Agent state run not found.");
            }
            throw error;
        }
        agentRunWorker.enqueue({
            projectId: project.id,
            runId: run.id,
            requestId
        });
        res.json({ run });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/agent/state-runs/:runId/tick", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const parsed = tickAgentStateRunSchema.parse(req.body ?? {});
        const result = await agentRunWorker.processOnce({
            projectId: project.id,
            runId: req.params.runId,
            requestId,
            expectedStepIndex: parsed.expectedStepIndex
        });
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/deployments", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const parsed = createDeploymentSchema.parse(req.body ?? {});
        const customDomain = sanitizeCustomDomain(parsed.customDomain);
        const containerPort = getContainerPort(parsed.containerPort);
        if (deploymentJobsByProject.has(project.id) || (await store.hasInProgressDeployment(project.id))) {
            throw new HttpError(409, "A deployment is already running for this project.");
        }
        const deploymentId = randomUUID();
        const subdomain = buildDeploymentSubdomain(project, deploymentId);
        const publicUrl = resolveDeploymentPublicUrl(subdomain, customDomain);
        const deployment = await store.createDeployment({
            deploymentId,
            projectId: project.id,
            orgId: project.orgId,
            workspaceId: project.workspaceId,
            createdByUserId: auth.user.id,
            status: "queued",
            subdomain,
            publicUrl,
            customDomain: customDomain ?? null,
            containerPort,
            metadata: {
                requestedBy: auth.user.id,
                requestId
            }
        });
        await store.appendDeploymentLog(deployment.id, `[${new Date().toISOString()}] Deployment queued for project ${project.id} by user ${auth.user.id}.\n`);
        deploymentJobsByProject.add(project.id);
        void runDeploymentPipeline({
            requestId,
            project,
            deploymentId: deployment.id
        });
        logInfo("deployment.queued", {
            requestId,
            deploymentId: deployment.id,
            projectId: project.id,
            userId: auth.user.id,
            publicUrl
        });
        res.status(202).json({
            deployment: deploymentPublicShape(deployment)
        });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/deployments", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const deployments = await store.listDeploymentsByProject(project.id);
        res.json({
            deployments: deployments.map((deployment) => deploymentPublicShape(deployment))
        });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/deployments/:deploymentId", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const deployment = await store.getDeploymentById(project.id, req.params.deploymentId);
        if (!deployment) {
            throw new HttpError(404, "Deployment not found.");
        }
        res.json({
            deployment: deploymentPublicShape(deployment)
        });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/deployments/:deploymentId/logs", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const deployment = await store.getDeploymentById(project.id, req.params.deploymentId);
        if (!deployment) {
            throw new HttpError(404, "Deployment not found.");
        }
        res.json({
            deployment: deploymentPublicShape(deployment),
            logs: deployment.logs
        });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/generate", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        await assertNoActiveAgentRunMutation(project.id);
        await enforceRateLimit(req, res, {
            key: `generate:${auth.user.id}`,
            limit: rateLimitConfig.generationMax,
            windowSec: rateLimitConfig.generationWindowSec,
            reason: "Generation rate limit reached. Try again shortly."
        });
        const parsed = generateSchema.parse(req.body ?? {});
        logInfo("generation.started", {
            requestId,
            userId: auth.user.id,
            projectId: project.id,
            mode: "generate",
            provider: parsed.provider,
            model: parsed.model || null
        });
        const startedAt = Date.now();
        const result = await runGeneration({
            store,
            registry: providers,
            project,
            prompt: parsed.prompt,
            providerId: parsed.provider,
            model: parsed.model,
            kind: "generate"
        });
        const refreshed = await store.getProject(project.id);
        const projectPath = store.getProjectWorkspacePath(project);
        const commitHash = await createAutoCommit(projectPath, commitMessageForPrompt("generate", parsed.prompt)).catch(() => null);
        if (commitHash && refreshed?.history[0]) {
            refreshed.history[0].commitHash = commitHash;
            await store.updateProject(refreshed);
        }
        logInfo("generation.completed", {
            requestId,
            userId: auth.user.id,
            projectId: project.id,
            mode: "generate",
            provider: parsed.provider,
            model: parsed.model || null,
            filesChangedCount: result.filesChanged.length,
            durationMs: Date.now() - startedAt,
            commitHash: commitHash || null
        });
        res.json({
            result: {
                ...result,
                commitHash
            }
        });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/chat", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const requestId = getRequestId(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        await assertNoActiveAgentRunMutation(project.id);
        await enforceRateLimit(req, res, {
            key: `generate:${auth.user.id}`,
            limit: rateLimitConfig.generationMax,
            windowSec: rateLimitConfig.generationWindowSec,
            reason: "Generation rate limit reached. Try again shortly."
        });
        const parsed = generateSchema.parse({
            ...req.body,
            prompt: req.body?.message ?? req.body?.prompt
        });
        logInfo("generation.started", {
            requestId,
            userId: auth.user.id,
            projectId: project.id,
            mode: "chat",
            provider: parsed.provider,
            model: parsed.model || null
        });
        const startedAt = Date.now();
        const result = await runGeneration({
            store,
            registry: providers,
            project,
            prompt: parsed.prompt,
            providerId: parsed.provider,
            model: parsed.model,
            kind: "chat"
        });
        const refreshed = await store.getProject(project.id);
        const projectPath = store.getProjectWorkspacePath(project);
        const commitHash = await createAutoCommit(projectPath, commitMessageForPrompt("chat", parsed.prompt)).catch(() => null);
        if (commitHash && refreshed?.history[0]) {
            refreshed.history[0].commitHash = commitHash;
            await store.updateProject(refreshed);
        }
        logInfo("generation.completed", {
            requestId,
            userId: auth.user.id,
            projectId: project.id,
            mode: "chat",
            provider: parsed.provider,
            model: parsed.model || null,
            filesChangedCount: result.filesChanged.length,
            durationMs: Date.now() - startedAt,
            commitHash: commitHash || null
        });
        res.json({
            result: {
                ...result,
                commitHash
            }
        });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/projects/:projectId/git/commit", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        await assertNoActiveAgentRunMutation(project.id);
        const parsed = gitCommitSchema.parse(req.body ?? {});
        const commitHash = await createAutoCommit(store.getProjectWorkspacePath(project), parsed.message);
        res.json({ commitHash });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/git/history", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const commits = await listCommits(store.getProjectWorkspacePath(project));
        res.json({ commits });
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/projects/:projectId/git/diff", authRequired, async (req, res, next) => {
    try {
        const auth = getAuth(req);
        const project = await requireProjectAccess(auth.user.id, req.params.projectId);
        const from = req.query.from ? String(req.query.from) : undefined;
        const to = req.query.to ? String(req.query.to) : undefined;
        const payload = await readDiff(store.getProjectWorkspacePath(project), from, to);
        res.json(payload);
    }
    catch (error) {
        next(error);
    }
});
app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
        return next();
    }
    return res.sendFile(path.join(publicDir, "index.html"));
});
app.use((error, req, res, _next) => {
    const requestId = getRequestId(req);
    if (error instanceof ZodError) {
        logError("http.error.validation", {
            requestId,
            details: error.issues.map((issue) => issue.message)
        });
        return res.status(400).json({
            error: "Invalid request payload.",
            details: error.issues.map((issue) => issue.message)
        });
    }
    if (error instanceof HttpError) {
        logError("http.error", {
            requestId,
            statusCode: error.status,
            ...serializeError(error)
        });
        return res.status(error.status).json({ error: error.message });
    }
    logError("http.error.unhandled", {
        requestId,
        ...serializeError(error)
    });
    return res.status(500).json({ error: "Internal server error." });
});
async function main() {
    await store.initialize();
    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => {
        logInfo("server.started", {
            port,
            origins: corsAllowedOrigins
        });
        console.log(`ForgeAI running at http://localhost:${port}`);
    });
}
main().catch((error) => {
    logError("server.start_failed", {
        ...serializeError(error)
    });
    process.exit(1);
});
