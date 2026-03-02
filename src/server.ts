import "dotenv/config";
import cors from "cors";
import express from "express";
import type { Server as HttpServer } from "node:http";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { ZodError, z } from "zod";
import { FileSession } from "./agent/fs/file-session.js";
import { buildTree, ensureDir, pathExists, readTextFile, safeResolvePath } from "./lib/fs-utils.js";
import { AppStore } from "./lib/project-store.js";
import { ProviderRegistry } from "./lib/providers.js";
import { workspacePath } from "./lib/workspace.js";
import { AgentKernel } from "./agent/kernel.js";
import { AgentRunService } from "./agent/run-service.js";
import { AgentRunWorker } from "./agent/run-worker.js";
import { runV1ReadinessCheck, V1ReadinessReport } from "./agent/validation/check-v1-ready.js";
import { buildGovernanceDecision } from "./governance/decision.js";
import { getTemplate, listTemplates } from "./templates/catalog.js";
import { hashPassword, verifyPassword } from "./lib/auth.js";
import { slugify } from "./lib/strings.js";
import { createAutoCommit, listCommits, readCurrentCommitHash, readDiff } from "./lib/git-versioning.js";
import { Deployment, MembershipRole, Project, ProjectTemplateId, PublicUser } from "./types.js";
import {
  createAccessToken,
  createRefreshToken,
  getAccessTokenMaxAgeSeconds,
  getRefreshTokenMaxAgeSeconds,
  hashRefreshToken,
  verifyToken
} from "./lib/tokens.js";
import { parseCookies, serializeCookie } from "./lib/http-cookies.js";
import { logError, logInfo, logWarn, serializeError } from "./lib/logging.js";

const templateIdSchema = z.enum(["canonical-backend", "saas-web-app", "agent-workflow", "chatbot"]);

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
  templateId: templateIdSchema.default("canonical-backend")
});

const bootstrapBackendSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  goal: z.string().min(4).max(24_000),
  provider: z.string().optional(),
  model: z.string().max(100).optional()
});

const generateSchema = z.object({
  prompt: z.string().min(4).max(24_000),
  provider: z.string().optional(),
  model: z.string().max(100).optional()
});

const executionValidationModeSchema = z.enum(["off", "warn", "enforce"]);

const createAgentRunSchema = z.object({
  goal: z.string().min(4).max(24_000),
  provider: z.string().optional(),
  model: z.string().max(100).optional(),
  profile: z.enum(["full", "ci", "smoke"]).default("full"),
  lightValidationMode: executionValidationModeSchema.optional(),
  heavyValidationMode: executionValidationModeSchema.optional(),
  maxRuntimeCorrectionAttempts: z.number().int().min(0).max(5).optional(),
  maxHeavyCorrectionAttempts: z.number().int().min(0).max(3).optional(),
  correctionPolicyMode: executionValidationModeSchema.optional(),
  correctionConvergenceMode: executionValidationModeSchema.optional(),
  plannerTimeoutMs: z.number().int().min(1_000).max(300_000).optional()
});

const resumeAgentRunSchema = z.object({
  profile: z.enum(["full", "ci", "smoke"]).optional(),
  lightValidationMode: executionValidationModeSchema.optional(),
  heavyValidationMode: executionValidationModeSchema.optional(),
  maxRuntimeCorrectionAttempts: z.number().int().min(0).max(5).optional(),
  maxHeavyCorrectionAttempts: z.number().int().min(0).max(3).optional(),
  correctionPolicyMode: executionValidationModeSchema.optional(),
  correctionConvergenceMode: executionValidationModeSchema.optional(),
  plannerTimeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  overrideExecutionConfig: z.boolean().default(false),
  fork: z.boolean().default(false)
});

const validateAgentRunSchema = z.object({
  strictV1Ready: z.boolean().default(false)
});

const governanceDecisionRequestSchema = z.object({
  runId: z.string().uuid(),
  strictV1Ready: z.boolean().default(false)
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
  runId: z.string().uuid(),
  customDomain: z.string().trim().max(255).optional(),
  containerPort: z.number().int().min(1).max(65535).optional()
});

const app = express();
app.disable("x-powered-by");

const store = new AppStore();
const providers = new ProviderRegistry();
const agentKernel = new AgentKernel({ store, providers });
const agentRunService = new AgentRunService(store);
const agentRunWorker = new AgentRunWorker(agentRunService);
const serverStartedAtMs = Date.now();
let httpServer: HttpServer | null = null;
let storeClosed = false;
let serverLifecycleState: "starting" | "ready" | "draining" | "stopped" = "starting";
let shutdownPromise: Promise<void> | null = null;

function resolveProviderIdOrHttpError(provider: string | undefined | null): string {
  try {
    return providers.resolveProviderId(provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid provider.";
    throw new HttpError(400, message);
  }
}

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

function parseSameSite(value: string | undefined): "Lax" | "Strict" | "None" {
  if (value === "Strict" || value === "None") {
    return value;
  }
  return "Lax";
}

function parsePositiveIntEnv(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return fallback;
  }

  if (trimmed === "true" || trimmed === "1" || trimmed === "yes" || trimmed === "on") {
    return true;
  }

  if (trimmed === "false" || trimmed === "0" || trimmed === "no" || trimmed === "off") {
    return false;
  }

  return fallback;
}

function parseTrustProxy(value: string | undefined): boolean | number | string | string[] {
  const trimmed = value?.trim();

  if (!trimmed || trimmed === "false") {
    return false;
  }

  if (trimmed === "true") {
    return true;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return trimmed;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    timeout.unref();

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

const cookieSecure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const cookieSameSite = parseSameSite(process.env.COOKIE_SAMESITE);
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
const readinessDbTimeoutMs = parsePositiveIntEnv(process.env.READINESS_DB_TIMEOUT_MS, 2000, 250);
const shutdownGraceMs = parsePositiveIntEnv(process.env.SHUTDOWN_GRACE_MS, 15000, 1000);
const metricsEnabled = parseBooleanEnv(process.env.METRICS_ENABLED, false);
const metricsAuthToken = (process.env.METRICS_AUTH_TOKEN || "").trim();

app.set("trust proxy", trustProxy);

if (cookieSameSite === "None" && !cookieSecure) {
  throw new Error("COOKIE_SAMESITE=None requires COOKIE_SECURE=true.");
}

const ACCESS_COOKIE_NAME = "deeprun_at";
const REFRESH_COOKIE_NAME = "deeprun_rt";

const rateLimitConfig = {
  loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX || 8),
  loginWindowSec: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_SEC || 600),
  generationMax: Number(process.env.RATE_LIMIT_GENERATION_MAX || 30),
  generationWindowSec: Number(process.env.RATE_LIMIT_GENERATION_WINDOW_SEC || 300)
};

const deploymentConfig = {
  dockerBin: process.env.DEPLOY_DOCKER_BIN || "docker",
  registryHost: (process.env.DEPLOY_REGISTRY || "").trim(),
  baseDomain: (process.env.DEPLOY_BASE_DOMAIN || "deeprun.app").trim().toLowerCase(),
  publicUrlTemplate: (process.env.DEPLOY_PUBLIC_URL_TEMPLATE || "").trim(),
  dockerNetwork: (process.env.DEPLOY_DOCKER_NETWORK || "").trim(),
  containerPortDefault: Number(process.env.DEPLOY_CONTAINER_PORT || 3000),
  stopPrevious: process.env.DEPLOY_STOP_PREVIOUS !== "false"
};

const deploymentJobsByProject = new Set<string>();
const customDomainRegex = /^(?=.{3,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const metricsHistogramBucketBoundsMs = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;
const metricsHistogramBuckets = metricsHistogramBucketBoundsMs.map((upperBoundMs) => ({
  upperBoundMs,
  count: 0
}));
const metricsStatusCounts = new Map<string, number>();
const metricsMethodCounts = new Map<string, number>();
let metricsHttpRequestsTotal = 0;
let metricsHttpRequestsInFlight = 0;
let metricsHttpRequestDurationCount = 0;
let metricsHttpRequestDurationMsSum = 0;
let metricsReadinessChecksTotal = 0;
let metricsReadinessFailuresTotal = 0;
let metricsReadinessLastDurationMs = 0;
let metricsReadinessLastOk = false;
let metricsReadinessHasSample = false;

app.use(
  cors({
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
  })
);

app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

interface AuthState {
  user: PublicUser;
  sessionId: string;
}

type AppRequest = express.Request & {
  auth?: AuthState;
  requestId?: string;
};

interface BootstrapCertificationSummary {
  runId: string;
  stepId: string | null;
  targetPath: string;
  validatedAt: string;
  ok: boolean;
  blockingCount: number;
  warningCount: number;
  summary: string;
  checks: Array<{
    id: string;
    status: "pass" | "fail" | "skip";
    message: string;
    details?: Record<string, unknown>;
  }>;
  violations: Array<Record<string, unknown>>;
}

function buildValidationResultPayload(input: {
  targetPath: string;
  validation: ValidationSummaryLike;
  v1Ready?: V1ReadinessReport | null;
}): Record<string, unknown> {
  return {
    targetPath: input.targetPath,
    validation: input.validation,
    ...(input.v1Ready ? { v1Ready: input.v1Ready } : {})
  };
}

interface ValidationCheckResult {
  id: string;
  status: "pass" | "fail" | "skip";
  message: string;
  details?: Record<string, unknown>;
}

interface ValidationSummaryLike {
  ok: boolean;
  blockingCount: number;
  warningCount: number;
  summary: string;
  checks: ValidationCheckResult[];
}

class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function isPgUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: string }).code) === "23505"
  );
}

function appendCookie(res: express.Response, cookie: string): void {
  res.append("Set-Cookie", cookie);
}

function setAuthCookies(res: express.Response, accessToken: string, refreshToken: string): void {
  appendCookie(
    res,
    serializeCookie(ACCESS_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: "/",
      domain: cookieDomain,
      maxAgeSeconds: getAccessTokenMaxAgeSeconds()
    })
  );

  appendCookie(
    res,
    serializeCookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: "/",
      domain: cookieDomain,
      maxAgeSeconds: getRefreshTokenMaxAgeSeconds()
    })
  );
}

function clearAuthCookies(res: express.Response): void {
  appendCookie(
    res,
    serializeCookie(ACCESS_COOKIE_NAME, "", {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: "/",
      domain: cookieDomain,
      maxAgeSeconds: 0
    })
  );

  appendCookie(
    res,
    serializeCookie(REFRESH_COOKIE_NAME, "", {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: "/",
      domain: cookieDomain,
      maxAgeSeconds: 0
    })
  );
}

function getRequestId(req: express.Request): string {
  return (req as AppRequest).requestId || "unknown";
}

function incrementCounter(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

function recordHttpRequestMetric(method: string, statusCode: number, durationMs: number): void {
  metricsHttpRequestsTotal += 1;
  metricsHttpRequestDurationCount += 1;
  metricsHttpRequestDurationMsSum += durationMs;

  const statusClass = `${Math.floor(Math.max(100, statusCode) / 100)}xx`;
  incrementCounter(metricsStatusCounts, statusClass);
  incrementCounter(metricsMethodCounts, method.toUpperCase());

  for (const bucket of metricsHistogramBuckets) {
    if (durationMs <= bucket.upperBoundMs) {
      bucket.count += 1;
    }
  }
}

function recordReadinessProbeMetric(ok: boolean, durationMs: number): void {
  metricsReadinessChecksTotal += 1;
  if (!ok) {
    metricsReadinessFailuresTotal += 1;
  }

  metricsReadinessLastOk = ok;
  metricsReadinessLastDurationMs = durationMs;
  metricsReadinessHasSample = true;
}

function escapePrometheusLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatPrometheusMetricLine(
  metricName: string,
  value: string | number,
  labels?: Record<string, string>
): string {
  if (!labels || !Object.keys(labels).length) {
    return `${metricName} ${String(value)}`;
  }

  const rendered = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, raw]) => `${key}="${escapePrometheusLabelValue(raw)}"`)
    .join(",");

  return `${metricName}{${rendered}} ${String(value)}`;
}

function isMetricsAuthorized(req: express.Request): boolean {
  if (!metricsAuthToken) {
    return true;
  }

  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }

  const provided = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(metricsAuthToken, "utf8");

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

function renderPrometheusMetrics(): string {
  const lines: string[] = [];
  const memory = process.memoryUsage();
  const uptimeSeconds = (Date.now() - serverStartedAtMs) / 1000;
  const lifecycleStates: Array<"starting" | "ready" | "draining" | "stopped"> = [
    "starting",
    "ready",
    "draining",
    "stopped"
  ];

  lines.push("# HELP deeprun_process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE deeprun_process_uptime_seconds gauge");
  lines.push(formatPrometheusMetricLine("deeprun_process_uptime_seconds", uptimeSeconds.toFixed(3)));

  lines.push("# HELP deeprun_process_resident_memory_bytes Resident set size in bytes.");
  lines.push("# TYPE deeprun_process_resident_memory_bytes gauge");
  lines.push(formatPrometheusMetricLine("deeprun_process_resident_memory_bytes", memory.rss));

  lines.push("# HELP deeprun_process_heap_used_bytes V8 heap used in bytes.");
  lines.push("# TYPE deeprun_process_heap_used_bytes gauge");
  lines.push(formatPrometheusMetricLine("deeprun_process_heap_used_bytes", memory.heapUsed));

  lines.push("# HELP deeprun_server_lifecycle_state Current lifecycle state of the API process.");
  lines.push("# TYPE deeprun_server_lifecycle_state gauge");
  for (const state of lifecycleStates) {
    lines.push(
      formatPrometheusMetricLine("deeprun_server_lifecycle_state", serverLifecycleState === state ? 1 : 0, { state })
    );
  }

  lines.push("# HELP deeprun_http_requests_total Total HTTP requests handled (excluding /metrics).");
  lines.push("# TYPE deeprun_http_requests_total counter");
  lines.push(formatPrometheusMetricLine("deeprun_http_requests_total", metricsHttpRequestsTotal));

  lines.push("# HELP deeprun_http_requests_by_method_total HTTP requests by method (excluding /metrics).");
  lines.push("# TYPE deeprun_http_requests_by_method_total counter");
  for (const [method, count] of [...metricsMethodCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(formatPrometheusMetricLine("deeprun_http_requests_by_method_total", count, { method }));
  }

  lines.push("# HELP deeprun_http_requests_by_status_class_total HTTP requests by status class (excluding /metrics).");
  lines.push("# TYPE deeprun_http_requests_by_status_class_total counter");
  for (const [statusClass, count] of [...metricsStatusCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(formatPrometheusMetricLine("deeprun_http_requests_by_status_class_total", count, { status_class: statusClass }));
  }

  lines.push("# HELP deeprun_http_requests_in_flight Currently in-flight HTTP requests.");
  lines.push("# TYPE deeprun_http_requests_in_flight gauge");
  lines.push(formatPrometheusMetricLine("deeprun_http_requests_in_flight", metricsHttpRequestsInFlight));

  lines.push("# HELP deeprun_http_request_duration_ms Request duration histogram in milliseconds (excluding /metrics).");
  lines.push("# TYPE deeprun_http_request_duration_ms histogram");
  for (const bucket of metricsHistogramBuckets) {
    lines.push(
      formatPrometheusMetricLine("deeprun_http_request_duration_ms_bucket", bucket.count, {
        le: String(bucket.upperBoundMs)
      })
    );
  }
  lines.push(formatPrometheusMetricLine("deeprun_http_request_duration_ms_bucket", metricsHttpRequestDurationCount, { le: "+Inf" }));
  lines.push(formatPrometheusMetricLine("deeprun_http_request_duration_ms_sum", metricsHttpRequestDurationMsSum.toFixed(3)));
  lines.push(formatPrometheusMetricLine("deeprun_http_request_duration_ms_count", metricsHttpRequestDurationCount));

  lines.push("# HELP deeprun_readiness_checks_total Total readiness probe executions.");
  lines.push("# TYPE deeprun_readiness_checks_total counter");
  lines.push(formatPrometheusMetricLine("deeprun_readiness_checks_total", metricsReadinessChecksTotal));

  lines.push("# HELP deeprun_readiness_failures_total Total failed readiness probe executions.");
  lines.push("# TYPE deeprun_readiness_failures_total counter");
  lines.push(formatPrometheusMetricLine("deeprun_readiness_failures_total", metricsReadinessFailuresTotal));

  lines.push("# HELP deeprun_readiness_last_check_success Last readiness probe result (1=ok, 0=failed, -1=no samples).");
  lines.push("# TYPE deeprun_readiness_last_check_success gauge");
  lines.push(
    formatPrometheusMetricLine("deeprun_readiness_last_check_success", metricsReadinessHasSample ? (metricsReadinessLastOk ? 1 : 0) : -1)
  );

  lines.push("# HELP deeprun_readiness_last_check_duration_ms Last readiness probe duration in milliseconds.");
  lines.push("# TYPE deeprun_readiness_last_check_duration_ms gauge");
  lines.push(
    formatPrometheusMetricLine(
      "deeprun_readiness_last_check_duration_ms",
      metricsReadinessHasSample ? metricsReadinessLastDurationMs.toFixed(3) : 0
    )
  );

  lines.push("");
  return lines.join("\n");
}

app.use((req, res, next) => {
  const requestIdHeader = req.headers["x-request-id"];
  const requestId = typeof requestIdHeader === "string" && requestIdHeader ? requestIdHeader : randomUUID();

  (req as AppRequest).requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const startedAt = Date.now();
  metricsHttpRequestsInFlight += 1;

  res.once("close", () => {
    metricsHttpRequestsInFlight = Math.max(0, metricsHttpRequestsInFlight - 1);
  });

  logInfo("http.request", {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;

    if (req.path !== "/metrics") {
      recordHttpRequestMetric(req.method, res.statusCode, durationMs);
    }

    logInfo("http.response", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      userId: (req as AppRequest).auth?.user.id || null
    });
  });

  next();
});

function isOperationalProbePath(pathname: string): boolean {
  return pathname === "/api/health" || pathname === "/api/ready" || pathname === "/metrics";
}

app.use((req, res, next) => {
  if (serverLifecycleState !== "draining" || isOperationalProbePath(req.path)) {
    next();
    return;
  }

  res.setHeader("Connection", "close");
  res.status(503).json({ error: "Server is shutting down." });
});

app.use(express.static(publicDir));

async function enforceRateLimit(
  req: express.Request,
  res: express.Response,
  options: { key: string; limit: number; windowSec: number; reason: string }
): Promise<void> {
  const decision = await store.consumeRateLimit(options.key, options.limit, options.windowSec);

  res.setHeader("x-ratelimit-limit", String(options.limit));
  res.setHeader("x-ratelimit-remaining", String(decision.remaining));
  res.setHeader("x-ratelimit-reset", decision.resetAt);

  if (!decision.allowed) {
    res.setHeader("retry-after", String(decision.retryAfterSeconds));

    throw new HttpError(429, options.reason);
  }
}

const authRequired: express.RequestHandler = async (req, res, next) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const accessToken = cookies[ACCESS_COOKIE_NAME];

    if (!accessToken) {
      throw new HttpError(401, "Authentication required.");
    }

    let payload: { sid: string; uid: string };

    try {
      payload = verifyToken(accessToken, "access");
    } catch {
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

    (req as AppRequest).auth = {
      user: store.toPublicUser(user),
      sessionId: session.id
    };

    next();
  } catch (error) {
    next(error);
  }
};

function getAuth(req: express.Request): AuthState {
  const appReq = req as AppRequest;

  if (!appReq.auth) {
    throw new HttpError(401, "Authentication required.");
  }

  return appReq.auth;
}

function isOrgManager(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

async function createOrganizationWithUniqueSlug(name: string) {
  const baseSlug = slugify(name);
  let counter = 1;

  while (counter <= 60) {
    const candidate = counter === 1 ? baseSlug : `${baseSlug}-${counter}`;

    try {
      return await store.createOrganization({ name, slug: candidate });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        counter += 1;
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not allocate organization slug.");
}

async function requireWorkspaceAccess(userId: string, workspaceId: string) {
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

async function requireProjectAccess(userId: string, projectId: string): Promise<Project> {
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

async function assertNoActiveAgentRunMutation(projectId: string): Promise<void> {
  const locked = await store.hasActiveAgentRun(projectId);
  if (locked) {
    throw new HttpError(
      409,
      "Project branch mutation is blocked while an agent run is active. Complete, cancel, or fail the active run first."
    );
  }
}

function suggestProjectNameFromGoal(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return slug ? `deeprun-${slug}` : `deeprun-${randomUUID().slice(0, 8)}`;
}

async function scaffoldProjectTemplate(input: {
  project: Project;
  templateId: ProjectTemplateId;
}): Promise<{ commitHash: string | null; filesChanged: string[] }> {
  const template = getTemplate(input.templateId);
  const projectPath = store.getProjectWorkspacePath(input.project);
  const fileSession = await FileSession.create({
    projectId: input.project.id,
    projectRoot: projectPath,
    options: {
      maxFilesPerStep: Math.max(15, Object.keys(template.starterFiles).length),
      maxTotalDiffBytes: Number(process.env.AGENT_FS_MAX_TOTAL_DIFF_BYTES || 400_000),
      maxFileBytes: Number(process.env.AGENT_FS_MAX_FILE_BYTES || 1_500_000),
      allowEnvMutation: true
    }
  });

  const proposedChanges: Array<{
    path: string;
    type: "create" | "update";
    newContent: string;
    oldContentHash?: string;
  }> = [];

  for (const [relativePath, content] of Object.entries(template.starterFiles)) {
    const existing = await fileSession.read(relativePath);

    if (!existing.exists) {
      proposedChanges.push({
        path: relativePath,
        type: "create",
        newContent: content
      });
      continue;
    }

    if (existing.content === content) {
      continue;
    }

    if (!existing.contentHash) {
      throw new Error(`Could not resolve file hash for scaffold update '${relativePath}'.`);
    }

    proposedChanges.push({
      path: relativePath,
      type: "update",
      newContent: content,
      oldContentHash: existing.contentHash
    });
  }

  let commitHash: string | null = null;
  let filesChanged: string[] = [];

  if (proposedChanges.length > 0) {
    fileSession.beginStep("scaffold-template", 0);

    try {
      for (const change of proposedChanges) {
        await fileSession.stageChange(change);
      }

      fileSession.validateStep();
      await fileSession.applyStepChanges();
      commitHash = await fileSession.commitStep({
        agentRunId: `project-scaffold-${input.project.id}`,
        stepIndex: 0,
        stepId: "scaffold-template",
        summary: `Scaffold ${template.name} template`
      });
      filesChanged = fileSession.getLastCommittedDiffs().map((entry) => entry.path);
    } catch (error) {
      await fileSession.abortStep().catch(() => undefined);
      throw error;
    }
  }

  const now = new Date().toISOString();

  input.project.updatedAt = now;
  input.project.history.unshift({
    id: randomUUID(),
    kind: "generate",
    prompt: "Initial scaffold",
    summary: `Scaffolded ${template.name} template with ${filesChanged.length} files.`,
    provider: "system",
    model: "template",
    filesChanged,
    commands: ["npm install", "npm run dev"],
    commitHash: commitHash ?? undefined,
    createdAt: now
  });
  input.project.history = input.project.history.slice(0, 80);

  await store.updateProject(input.project);

  return {
    commitHash,
    filesChanged
  };
}

async function createProjectWithTemplate(input: {
  workspaceId: string;
  orgId: string;
  createdByUserId: string;
  name: string;
  description?: string;
  templateId: ProjectTemplateId;
}): Promise<Project> {
  const project = await store.createProject({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    createdByUserId: input.createdByUserId,
    name: input.name,
    description: input.description,
    templateId: input.templateId
  });

  await scaffoldProjectTemplate({
    project,
    templateId: input.templateId
  });

  return project;
}

function summarizeFailedChecks(
  checks: Array<{
    id: string;
    status: "pass" | "fail" | "skip";
  }>
): string {
  const failed = checks.filter((check) => check.status === "fail").map((check) => check.id);

  if (!failed.length) {
    return "All certification checks passed.";
  }

  return `Failed checks: ${failed.join(", ")}`;
}

function extractValidationViolations(
  checks: Array<{
    id: string;
    status: "pass" | "fail" | "skip";
    details?: Record<string, unknown>;
  }>
): Array<Record<string, unknown>> {
  const violations: Array<Record<string, unknown>> = [];

  for (const check of checks) {
    if (check.status !== "fail") {
      continue;
    }

    if (!check.details || typeof check.details !== "object") {
      continue;
    }

    const detailViolations = (check.details as { violations?: unknown }).violations;
    if (!Array.isArray(detailViolations)) {
      continue;
    }

    for (const entry of detailViolations) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      violations.push(entry as Record<string, unknown>);

      if (violations.length >= 100) {
        return violations;
      }
    }
  }

  return violations;
}

async function persistValidationHistoryEntry(input: {
  project: Project;
  runId: string;
  source: "bootstrap" | "agent_validate";
  targetPath: string;
  validatedAt: string;
  validation: ValidationSummaryLike;
  v1Ready?: V1ReadinessReport | null;
  runCommitHash: string | null | undefined;
}): Promise<Project> {
  const latestProject = (await store.getProject(input.project.id)) || input.project;
  const summaryPrefix = input.validation.ok ? "Validation passed" : "Validation failed";
  const violations = extractValidationViolations(input.validation.checks);

  latestProject.updatedAt = input.validatedAt;
  latestProject.history.unshift({
    id: randomUUID(),
    kind: "generate",
    prompt: `Validation report for run ${input.runId}`,
    summary: `${summaryPrefix}: ${input.validation.summary}`,
    provider: "system",
    model: "validation",
    filesChanged: [],
    commands: ["POST /api/projects/:projectId/agent/runs/:runId/validate"],
    commitHash: input.runCommitHash || undefined,
    metadata: {
      source: input.source,
      runId: input.runId,
      targetPath: input.targetPath,
      validatedAt: input.validatedAt,
      validation: {
        ok: input.validation.ok,
        blockingCount: input.validation.blockingCount,
        warningCount: input.validation.warningCount,
        summary: input.validation.summary,
        checks: input.validation.checks,
        violations
      },
      ...(input.v1Ready
        ? {
            v1Ready: {
              ok: input.v1Ready.ok,
              verdict: input.v1Ready.verdict,
              generatedAt: input.v1Ready.generatedAt,
              checks: input.v1Ready.checks
            }
          }
        : {})
    },
    createdAt: input.validatedAt
  });
  latestProject.history = latestProject.history.slice(0, 80);

  await store.updateProject(latestProject);
  return latestProject;
}

async function runBootstrapCertification(input: {
  project: Project;
  runId: string;
  requestId: string;
}): Promise<BootstrapCertificationSummary> {
  const startedAt = new Date().toISOString();

  try {
    const validated = await agentKernel.validateRunOutput({
      project: input.project,
      runId: input.runId,
      requestId: input.requestId
    });
    const validatedAt = new Date().toISOString();
    const summary = summarizeFailedChecks(validated.validation.checks);
    const violations = extractValidationViolations(validated.validation.checks);
    const stepIndex = Math.max(
      Number(validated.run.currentStepIndex || 0),
      Array.isArray(validated.run.plan?.steps) ? validated.run.plan.steps.length : 0
    );
    const validationResultPayload = buildValidationResultPayload({
      targetPath: validated.targetPath,
      validation: validated.validation
    });
    await store.updateAgentRun(validated.run.id, {
      validationStatus: validated.validation.ok ? "passed" : "failed",
      validationResult: validationResultPayload,
      validatedAt
    });
    const certificationStep = await store.createAgentStep({
      runId: validated.run.id,
      projectId: validated.run.projectId,
      stepIndex,
      stepId: "post-bootstrap-certification",
      type: "verify",
      tool: "fetch_runtime_logs",
      inputPayload: {
        source: "bootstrap",
        requestId: input.requestId
      },
      outputPayload: {
        targetPath: validated.targetPath,
        validation: validated.validation,
        violations
      },
      status: validated.validation.ok ? "completed" : "failed",
      errorMessage: validated.validation.ok ? null : summary,
      commitHash: validated.run.currentCommitHash || validated.run.baseCommitHash || null,
      runtimeStatus: validated.validation.ok ? "healthy" : "failed",
      startedAt,
      finishedAt: validatedAt
    });

    return {
      runId: validated.run.id,
      stepId: certificationStep.id,
      targetPath: validated.targetPath,
      validatedAt,
      ok: validated.validation.ok,
      blockingCount: validated.validation.blockingCount,
      warningCount: validated.validation.warningCount,
      summary: validated.validation.summary,
      checks: validated.validation.checks,
      violations
    };
  } catch (error) {
    const validatedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    let stepId: string | null = null;

    try {
      const run = await store.getAgentRunById(input.project.id, input.runId);

      if (run) {
        await store.updateAgentRun(run.id, {
          validationStatus: "failed",
          validationResult: buildValidationResultPayload({
            targetPath: store.getProjectWorkspacePath(input.project),
            validation: {
              ok: false,
              blockingCount: 1,
              warningCount: 0,
              summary: "Bootstrap certification execution failed.",
              checks: [
                {
                  id: "certification",
                  status: "fail",
                  message,
                  details: {
                    source: "bootstrap"
                  }
                }
              ]
            }
          }),
          validatedAt
        });
        const stepIndex = Math.max(
          Number(run.currentStepIndex || 0),
          Array.isArray(run.plan?.steps) ? run.plan.steps.length : 0
        );
        const certificationStep = await store.createAgentStep({
          runId: run.id,
          projectId: run.projectId,
          stepIndex,
          stepId: "post-bootstrap-certification",
          type: "verify",
          tool: "fetch_runtime_logs",
          inputPayload: {
            source: "bootstrap",
            requestId: input.requestId
          },
          outputPayload: {
            source: "bootstrap",
            error: message
          },
          status: "failed",
          errorMessage: message,
          commitHash: run.currentCommitHash || run.baseCommitHash || null,
          runtimeStatus: "failed",
          startedAt,
          finishedAt: validatedAt
        });
        stepId = certificationStep.id;
      }
    } catch (stepError) {
      logWarn("bootstrap.certification.step_persist_failed", {
        requestId: input.requestId,
        projectId: input.project.id,
        runId: input.runId,
        error: serializeError(stepError)
      });
    }

    logWarn("bootstrap.certification.failed", {
      requestId: input.requestId,
      projectId: input.project.id,
      runId: input.runId,
      error: serializeError(error)
    });

    return {
      runId: input.runId,
      stepId,
      targetPath: store.getProjectWorkspacePath(input.project),
      validatedAt,
      ok: false,
      blockingCount: 1,
      warningCount: 0,
      summary: "Bootstrap certification execution failed.",
      checks: [
        {
          id: "certification",
          status: "fail",
          message,
          details: {
            source: "bootstrap"
          }
        }
      ],
      violations: []
    };
  }
}

async function persistBootstrapCertificationHistory(input: {
  project: Project;
  runCommitHash: string | null | undefined;
  certification: BootstrapCertificationSummary;
}): Promise<Project> {
  const latestProject = (await store.getProject(input.project.id)) || input.project;
  const summaryPrefix = input.certification.ok ? "Certification passed" : "Certification failed";

  latestProject.updatedAt = input.certification.validatedAt;
  latestProject.history.unshift({
    id: randomUUID(),
    kind: "generate",
    prompt: `Post-bootstrap certification for run ${input.certification.runId}`,
    summary: `${summaryPrefix}: ${input.certification.summary}`,
    provider: "system",
    model: "validation",
    filesChanged: [],
    commands: ["POST /api/projects/:projectId/agent/runs/:runId/validate"],
    commitHash: input.runCommitHash || undefined,
    metadata: {
      source: "bootstrap",
      runId: input.certification.runId,
      stepId: input.certification.stepId,
      targetPath: input.certification.targetPath,
      validatedAt: input.certification.validatedAt,
      validation: {
        ok: input.certification.ok,
        blockingCount: input.certification.blockingCount,
        warningCount: input.certification.warningCount,
        summary: input.certification.summary,
        checks: input.certification.checks,
        violations: input.certification.violations
      }
    },
    createdAt: input.certification.validatedAt
  });
  latestProject.history = latestProject.history.slice(0, 80);

  await store.updateProject(latestProject);
  return latestProject;
}

function buildBuilderSyntheticPlan(input: {
  prompt: string;
  providerId: string;
  model?: string;
  mode: "generate" | "chat";
}): {
  goal: string;
  steps: Array<{
    id: string;
    type: "modify";
    tool: "ai_mutation";
    mutates: true;
    input: Record<string, unknown>;
  }>;
} {
  return {
    goal: input.prompt,
    steps: [
      {
        id: "step-1",
        type: "modify",
        tool: "ai_mutation",
        mutates: true,
        input: {
          prompt: input.prompt,
          provider: input.providerId,
          ...(input.model ? { model: input.model } : {}),
          mode: input.mode
        }
      }
    ]
  };
}

function buildManualFileWriteSyntheticPlan(input: {
  path: string;
  content: string;
}): {
  goal: string;
  steps: Array<{
    id: string;
    type: "modify";
    tool: "manual_file_write";
    mutates: true;
    input: Record<string, unknown>;
  }>;
} {
  return {
    goal: `Manual file edit: ${input.path}`,
    steps: [
      {
        id: "step-1",
        type: "modify",
        tool: "manual_file_write",
        mutates: true,
        input: {
          path: input.path,
          content: input.content
        }
      }
    ]
  };
}

function deriveManualFileWriteResultFromRun(input: {
  detail: Awaited<ReturnType<AgentKernel["startRunWithPlan"]>>;
  path: string;
}): {
  commitHash: string | null;
  filesChanged: string[];
  stepId: string;
} {
  const run = input.detail.run;
  const sortedSteps = [...input.detail.steps].sort(
    (left, right) => left.stepIndex - right.stepIndex || left.attempt - right.attempt || left.createdAt.localeCompare(right.createdAt)
  );
  const step = [...sortedSteps].reverse().find((entry) => entry.tool === "manual_file_write");

  if (!step) {
    throw new Error("Manual file save run completed without a manual_file_write step record.");
  }

  if (run.status !== "complete" || step.status !== "completed") {
    throw new Error(step.errorMessage || run.errorMessage || `Manual file save failed for '${input.path}'.`);
  }

  const output = step.outputPayload && typeof step.outputPayload === "object" ? step.outputPayload : {};
  const filesChanged = Array.isArray(output.stagedDiffs)
    ? output.stagedDiffs
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const path = (entry as { path?: unknown }).path;
          return typeof path === "string" ? path : null;
        })
        .filter((value): value is string => Boolean(value))
    : [];

  return {
    commitHash: step.commitHash || run.currentCommitHash || run.baseCommitHash || null,
    filesChanged,
    stepId: step.stepId
  };
}

function deriveBuilderResultFromRun(input: {
  detail: Awaited<ReturnType<AgentKernel["startRunWithPlan"]>>;
  fallbackMode: "generate" | "chat";
}): {
  summary: string;
  filesChanged: string[];
  commands: string[];
  commitHash: string | null;
  stepId: string;
  providerId: string;
  model: string;
} {
  const run = input.detail.run;
  const sortedSteps = [...input.detail.steps].sort(
    (left, right) => left.stepIndex - right.stepIndex || left.attempt - right.attempt || left.createdAt.localeCompare(right.createdAt)
  );
  const mutationStep = [...sortedSteps].reverse().find((step) => step.tool === "ai_mutation");

  if (!mutationStep) {
    throw new HttpError(500, "Builder run finished without an ai_mutation step record.");
  }

  if (run.status !== "complete" || mutationStep.status !== "completed") {
    const reason =
      mutationStep.errorMessage || run.errorMessage || `Builder ${input.fallbackMode} run did not complete successfully.`;
    throw new HttpError(409, `${reason} (runId=${run.id})`);
  }

  const output = mutationStep.outputPayload && typeof mutationStep.outputPayload === "object" ? mutationStep.outputPayload : {};
  const summary =
    typeof output.summary === "string" && output.summary.trim()
      ? output.summary.trim()
      : `Builder ${input.fallbackMode} completed.`;
  const commands = Array.isArray(output.runCommands)
    ? output.runCommands.filter((entry): entry is string => typeof entry === "string")
    : [];
  const filesChanged = Array.isArray(output.stagedDiffs)
    ? output.stagedDiffs
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const path = (entry as { path?: unknown }).path;
          return typeof path === "string" ? path : null;
        })
        .filter((value): value is string => Boolean(value))
    : [];
  const resolvedModel =
    typeof output.model === "string" && output.model.trim()
      ? output.model.trim()
      : run.model || "unknown";

  return {
    summary,
    filesChanged,
    commands,
    commitHash: mutationStep.commitHash || run.currentCommitHash || run.baseCommitHash || null,
    stepId: mutationStep.stepId,
    providerId: run.providerId,
    model: resolvedModel
  };
}

async function persistBuilderActivityMirror(input: {
  project: Project;
  prompt: string;
  mode: "generate" | "chat";
  result: {
    summary: string;
    filesChanged: string[];
    commands: string[];
    commitHash: string | null;
    stepId: string;
    providerId: string;
    model: string;
  };
  runId: string;
}): Promise<Project> {
  const latestProject = (await store.getProject(input.project.id)) || input.project;
  const createdAt = new Date().toISOString();

  latestProject.messages.push(
    {
      role: "user",
      content: input.prompt,
      createdAt
    },
    {
      role: "assistant",
      content: input.result.summary,
      createdAt
    }
  );

  latestProject.history.unshift({
    id: randomUUID(),
    kind: input.mode,
    prompt: input.prompt,
    summary: input.result.summary,
    provider: input.result.providerId,
    model: input.result.model,
    filesChanged: input.result.filesChanged,
    commands: input.result.commands,
    commitHash: input.result.commitHash || undefined,
    metadata: {
      source: "agent_run_builder",
      runId: input.runId,
      stepId: input.result.stepId
    },
    createdAt
  });

  latestProject.updatedAt = createdAt;
  latestProject.history = latestProject.history.slice(0, 80);
  latestProject.messages = latestProject.messages.slice(-80);

  await store.updateProject(latestProject);
  return latestProject;
}

async function buildAccountPayload(user: PublicUser) {
  const orgMemberships = await store.listOrganizationsForUser(user.id);

  const organizations = await Promise.all(
    orgMemberships.map(async (entry) => {
      const workspaces = await store.listWorkspacesByOrg(entry.organization.id);
      return {
        id: entry.organization.id,
        name: entry.organization.name,
        slug: entry.organization.slug,
        role: entry.role,
        workspaces
      };
    })
  );

  return {
    user,
    organizations
  };
}

async function createAndSetSession(req: express.Request, res: express.Response, userId: string) {
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

function sanitizeCustomDomain(value: string | undefined): string | undefined {
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

function getContainerPort(candidate: number | undefined): number {
  const fallback = Number.isInteger(deploymentConfig.containerPortDefault)
    ? deploymentConfig.containerPortDefault
    : 3000;
  const value = Number.isInteger(candidate) ? (candidate as number) : fallback;

  if (value < 1 || value > 65535) {
    throw new HttpError(400, "containerPort must be between 1 and 65535.");
  }

  return value;
}

function buildDeploymentSubdomain(project: Project, deploymentId: string): string {
  const base = slugify(project.name).replace(/^-+|-+$/g, "") || "app";
  const suffix = deploymentId.slice(0, 8);
  const truncatedBase = base.slice(0, Math.max(1, 63 - suffix.length - 1));
  return `${truncatedBase}-${suffix}`;
}

function resolveDeploymentPublicUrl(subdomain: string, customDomain?: string): string {
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

async function acquireFreePort(): Promise<number> {
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

function shellSafeCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => (/[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}

async function runCommandWithLogs(input: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onLog: (line: string) => void;
}): Promise<{ stdout: string; stderr: string }> {
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

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      input.onLog(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
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

function escapeDoubleQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function resolveDockerfileForDeployment(input: {
  projectPath: string;
  deploymentId: string;
  containerPort: number;
}): Promise<{ dockerfilePath: string; generated: boolean }> {
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

  const parsed = JSON.parse(await readTextFile(packageJsonPath)) as {
    scripts?: Record<string, string | undefined>;
  };

  const scripts = parsed.scripts || {};
  let startCommand = "node index.js";

  if (typeof scripts.start === "string" && scripts.start.trim()) {
    startCommand = "npm run start";
  } else if (typeof scripts.preview === "string" && scripts.preview.trim()) {
    startCommand = `npm run preview -- --host 0.0.0.0 --port ${input.containerPort}`;
  } else if (typeof scripts.dev === "string" && scripts.dev.trim()) {
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

  const generatedDir = workspacePath(".data", "deploy", "dockerfiles");
  await ensureDir(generatedDir);
  const generatedPath = path.join(generatedDir, `${input.deploymentId}.Dockerfile`);
  await fs.writeFile(generatedPath, generatedDockerfile, "utf8");

  return {
    dockerfilePath: generatedPath,
    generated: true
  };
}

function deploymentPublicShape(deployment: Deployment) {
  const { logs: _logs, ...rest } = deployment;
  return rest;
}

async function runDeploymentPipeline(input: {
  requestId: string;
  project: Project;
  deploymentId: string;
}): Promise<void> {
  const deployment = await store.getDeployment(input.deploymentId);

  if (!deployment) {
    deploymentJobsByProject.delete(input.project.id);
    return;
  }

  let logChain = Promise.resolve();

  const queueLog = (raw: string): void => {
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

  const updateDeployment = async (patch: Parameters<typeof store.updateDeployment>[1]): Promise<void> => {
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

    let imageDigest: string | null = null;
    try {
      const inspect = await runCommandWithLogs({
        command: deploymentConfig.dockerBin,
        args: ["image", "inspect", imageRef, "--format", "{{index .RepoDigests 0}}"],
        cwd: projectPath,
        onLog: queueLog
      });
      imageDigest = inspect.stdout || null;
    } catch (error) {
      queueLog(`Could not resolve pushed image digest: ${String((error as Error).message || error)}`);
    }

    await updateDeployment({
      status: "launching",
      imageDigest
    });
    queueLog("Launching production container...");

    const hostPort = await acquireFreePort();
    const containerName = `deeprun-${input.project.id.slice(0, 8)}-${input.deploymentId.slice(0, 8)}`;

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
        } catch (error) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    queueLog(`Deployment failed: ${message}`);

    try {
      await updateDeployment({
        status: "failed",
        errorMessage: message,
        finishedAt: new Date().toISOString(),
        isActive: false
      });
    } catch (updateError) {
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
  } finally {
    await logChain;
    deploymentJobsByProject.delete(input.project.id);
  }
}

app.get("/metrics", (req, res) => {
  if (!metricsEnabled) {
    res.status(404).type("text/plain; charset=utf-8").send("Not found\n");
    return;
  }

  if (!isMetricsAuthorized(req)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).type("text/plain; charset=utf-8").send("Unauthorized\n");
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusMetrics());
});

app.get("/internal/workers", async (req, res, next) => {
  try {
    if (!isMetricsAuthorized(req)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const workers = await store.listWorkerNodes();
    res.setHeader("Cache-Control", "no-store");
    res.json({ workers });
  } catch (error) {
    next(error);
  }
});

app.get("/internal/run-jobs", async (req, res, next) => {
  try {
    if (!isMetricsAuthorized(req)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const jobs = await store.listRunJobs();
    res.setHeader("Cache-Control", "no-store");
    res.json({ jobs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/ready", async (_req, res) => {
  const startedAt = Date.now();
  const now = new Date().toISOString();

  if (serverLifecycleState !== "ready") {
    recordReadinessProbeMetric(false, Date.now() - startedAt);
    res.status(503).json({
      ok: false,
      state: serverLifecycleState,
      db: "unknown",
      now
    });
    return;
  }

  try {
    await withTimeout(
      store.ping(),
      readinessDbTimeoutMs,
      `Database readiness check timed out after ${readinessDbTimeoutMs}ms.`
    );

    recordReadinessProbeMetric(true, Date.now() - startedAt);

    res.json({
      ok: true,
      state: serverLifecycleState,
      db: "ok",
      now
    });
  } catch (error) {
    recordReadinessProbeMetric(false, Date.now() - startedAt);
    logWarn("server.readiness_failed", {
      ...serializeError(error)
    });

    res.status(503).json({
      ok: false,
      state: serverLifecycleState,
      db: "error",
      error: error instanceof Error ? error.message : String(error),
      now
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    state: serverLifecycleState,
    draining: serverLifecycleState === "draining",
    uptimeSec: Math.floor((Date.now() - serverStartedAtMs) / 1000),
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
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new HttpError(409, "Email is already in use.");
      }
      throw error;
    }

    const organization = await createOrganizationWithUniqueSlug(
      parsed.organizationName || `${parsed.name}'s Organization`
    );

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
  } catch (error) {
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
  } catch (error) {
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

    let payload: { sid: string; uid: string };

    try {
      payload = verifyToken(refreshToken, "refresh");
    } catch {
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
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const payload = await buildAccountPayload(auth.user);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    await store.revokeSession(auth.sessionId);
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers", authRequired, (_req, res) => {
  res.json({
    providers: providers.list(),
    defaultProviderId: providers.getDefaultProviderId()
  });
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

    const payload = await Promise.all(
      organizations.map(async (entry) => ({
        id: entry.organization.id,
        name: entry.organization.name,
        slug: entry.organization.slug,
        role: entry.role,
        workspaces: await store.listWorkspacesByOrg(entry.organization.id)
      }))
    );

    res.json({ organizations: payload });
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const parsed = createProjectSchema.parse(req.body ?? {});
    const { workspace } = await requireWorkspaceAccess(auth.user.id, parsed.workspaceId);

    const project = await createProjectWithTemplate({
      workspaceId: workspace.id,
      orgId: workspace.orgId,
      createdByUserId: auth.user.id,
      name: parsed.name,
      description: parsed.description,
      templateId: parsed.templateId
    });

    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/bootstrap/backend", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const requestId = getRequestId(req);
    const parsed = bootstrapBackendSchema.parse(req.body ?? {});
    const providerId = resolveProviderIdOrHttpError(parsed.provider);
    const { workspace } = await requireWorkspaceAccess(auth.user.id, parsed.workspaceId);

    await enforceRateLimit(req, res, {
      key: `generate:${auth.user.id}`,
      limit: rateLimitConfig.generationMax,
      windowSec: rateLimitConfig.generationWindowSec,
      reason: "Generation rate limit reached. Try again shortly."
    });

    const projectName = parsed.name?.trim() || suggestProjectNameFromGoal(parsed.goal);
    const project = await createProjectWithTemplate({
      workspaceId: workspace.id,
      orgId: workspace.orgId,
      createdByUserId: auth.user.id,
      name: projectName,
      description: parsed.description,
      templateId: "canonical-backend"
    });

    const run = await agentKernel.startRun({
      project,
      createdByUserId: auth.user.id,
      goal: parsed.goal,
      providerId,
      model: parsed.model,
      requestId
    });

    const certification = await runBootstrapCertification({
      project,
      runId: run.run.id,
      requestId
    });
    const updatedProject = await persistBootstrapCertificationHistory({
      project,
      runCommitHash: run.run.currentCommitHash || run.run.baseCommitHash,
      certification
    });

    res.status(201).json({
      project: updatedProject,
      run,
      certification
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);

    const tree = await buildTree(store.getProjectWorkspacePath(project));
    res.json({ project, tree });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/tree", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);

    const tree = await buildTree(store.getProjectWorkspacePath(project));
    res.json({ tree });
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:projectId/file", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const requestId = getRequestId(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);
    await assertNoActiveAgentRunMutation(project.id);

    const parsed = updateFileSchema.parse(req.body ?? {});
    const plan = buildManualFileWriteSyntheticPlan({
      path: parsed.path,
      content: parsed.content
    });
    const detail = await agentKernel.startRunWithPlan({
      project,
      createdByUserId: auth.user.id,
      goal: plan.goal,
      providerId: "system",
      model: "manual",
      plan,
      requestId,
      executionMode: "project",
      executionProfile: "builder",
      metadata: {
        source: "manual_file_save",
        path: parsed.path
      }
    });
    const manualResult = deriveManualFileWriteResultFromRun({
      detail,
      path: parsed.path
    });
    const commitHash = manualResult.commitHash;
    const filesChanged = manualResult.filesChanged;

    const now = new Date().toISOString();
    const latestProject = (await store.getProject(project.id)) || project;

    latestProject.updatedAt = now;
    latestProject.history.unshift({
      id: randomUUID(),
      kind: "manual-edit",
      prompt: `Manual edit: ${parsed.path}`,
      summary: filesChanged.length > 0 ? `Updated ${parsed.path}` : `No-op manual edit for ${parsed.path}`,
      provider: "system",
      model: "manual",
      filesChanged,
      commands: [],
      commitHash: commitHash ?? undefined,
      metadata: {
        source: "agent_run_manual_edit",
        runId: detail.run.id,
        stepId: manualResult.stepId
      },
      createdAt: now
    });
    latestProject.history = latestProject.history.slice(0, 80);

    await store.updateProject(latestProject);

    res.json({ ok: true, commitHash });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/history", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);

    res.json({ history: project.history });
  } catch (error) {
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
    const providerId = resolveProviderIdOrHttpError(parsed.provider);

    await enforceRateLimit(req, res, {
      key: `generate:${auth.user.id}`,
      limit: rateLimitConfig.generationMax,
      windowSec: rateLimitConfig.generationWindowSec,
      reason: "Generation rate limit reached. Try again shortly."
    });

    const run = await agentKernel.queueRun({
      project,
      createdByUserId: auth.user.id,
      goal: parsed.goal,
      providerId,
      model: parsed.model,
      requestId,
      executionConfig: {
        profile: parsed.profile,
        ...(parsed.lightValidationMode ? { lightValidationMode: parsed.lightValidationMode } : {}),
        ...(parsed.heavyValidationMode ? { heavyValidationMode: parsed.heavyValidationMode } : {}),
        ...(typeof parsed.maxRuntimeCorrectionAttempts === "number"
          ? { maxRuntimeCorrectionAttempts: parsed.maxRuntimeCorrectionAttempts }
          : {}),
        ...(typeof parsed.maxHeavyCorrectionAttempts === "number"
          ? { maxHeavyCorrectionAttempts: parsed.maxHeavyCorrectionAttempts }
          : {}),
        ...(parsed.correctionPolicyMode ? { correctionPolicyMode: parsed.correctionPolicyMode } : {}),
        ...(parsed.correctionConvergenceMode ? { correctionConvergenceMode: parsed.correctionConvergenceMode } : {}),
        ...(typeof parsed.plannerTimeoutMs === "number" ? { plannerTimeoutMs: parsed.plannerTimeoutMs } : {})
      }
    });

    res.status(202).json(run);
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/agent/runs", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);
    const runs = await agentKernel.listRuns(project.id);

    res.json({ runs });
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/agent/runs/:runId/resume", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const requestId = getRequestId(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);
    const parsed = resumeAgentRunSchema.parse(req.body ?? {});

    await enforceRateLimit(req, res, {
      key: `generate:${auth.user.id}`,
      limit: rateLimitConfig.generationMax,
      windowSec: rateLimitConfig.generationWindowSec,
      reason: "Generation rate limit reached. Try again shortly."
    });

    let detail;
    try {
      detail = await agentKernel.queueResumeRun({
        project,
        runId: req.params.runId,
        requestId,
        createdByUserId: auth.user.id,
        executionConfig: {
          ...(parsed.profile ? { profile: parsed.profile } : {}),
          ...(parsed.lightValidationMode ? { lightValidationMode: parsed.lightValidationMode } : {}),
          ...(parsed.heavyValidationMode ? { heavyValidationMode: parsed.heavyValidationMode } : {}),
          ...(typeof parsed.maxRuntimeCorrectionAttempts === "number"
            ? { maxRuntimeCorrectionAttempts: parsed.maxRuntimeCorrectionAttempts }
            : {}),
          ...(typeof parsed.maxHeavyCorrectionAttempts === "number"
            ? { maxHeavyCorrectionAttempts: parsed.maxHeavyCorrectionAttempts }
            : {}),
          ...(parsed.correctionPolicyMode ? { correctionPolicyMode: parsed.correctionPolicyMode } : {}),
          ...(parsed.correctionConvergenceMode ? { correctionConvergenceMode: parsed.correctionConvergenceMode } : {}),
          ...(typeof parsed.plannerTimeoutMs === "number" ? { plannerTimeoutMs: parsed.plannerTimeoutMs } : {})
        },
        overrideExecutionConfig: parsed.overrideExecutionConfig,
        fork: parsed.fork
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Agent run not found.") {
        throw new HttpError(404, "Agent run not found.");
      }
      if (
        error instanceof Error &&
        error.message.startsWith("Execution config mismatch.")
      ) {
        throw new HttpError(
          409,
          error.message,
          error instanceof Error && "diff" in error
            ? {
                diff: (error as { diff?: unknown }).diff,
                persisted: (error as { persisted?: unknown }).persisted,
                requested: (error as { requested?: unknown }).requested
              }
            : undefined
        );
      }
      throw error;
    }
    res.status(parsed.fork ? 201 : detail.queuedJob ? 202 : 200).json(detail);
  } catch (error) {
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
  } catch (error) {
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
    const parsed = validateAgentRunSchema.parse(req.body ?? {});

    const result = await agentKernel.validateRunOutput({
      project,
      runId: req.params.runId,
      requestId
    });

    const validatedAt = new Date().toISOString();
    let v1Ready: V1ReadinessReport | null = null;

    if (parsed.strictV1Ready) {
      try {
        v1Ready = await runV1ReadinessCheck(result.targetPath);
      } catch (error) {
        v1Ready = {
          target: result.targetPath,
          verdict: "NO",
          ok: false,
          checks: [
            {
              id: "v1_ready_execution",
              status: "fail",
              message: error instanceof Error ? error.message : String(error)
            }
          ],
          generatedAt: new Date().toISOString()
        };
      }
    }

    const validationResultPayload = buildValidationResultPayload({
      targetPath: result.targetPath,
      validation: result.validation,
      v1Ready
    });

    const persistedRun =
      (await store.updateAgentRun(result.run.id, {
        validationStatus: result.validation.ok ? "passed" : "failed",
        validationResult: validationResultPayload,
        validatedAt
      })) || result.run;
    const persistedResult = {
      ...result,
      run: persistedRun
    };

    void persistValidationHistoryEntry({
      project,
      runId: persistedResult.run.id,
      source: "agent_validate",
      targetPath: persistedResult.targetPath,
      validatedAt,
      validation: persistedResult.validation,
      v1Ready,
      runCommitHash: persistedResult.run.currentCommitHash || persistedResult.run.baseCommitHash || null
    }).catch((error) => {
      logWarn("agent.validate.history_persist_failed", {
        requestId,
        projectId: project.id,
        runId: persistedResult.run.id,
        ...serializeError(error)
      });
    });

    res.json({
      ...persistedResult,
      ...(v1Ready ? { v1Ready } : {})
    });
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/agent/state-runs", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);
    const runs = await agentRunService.listRuns(project.id);

    res.json({ runs });
  } catch (error) {
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
  } catch (error) {
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
      run = await agentRunService.markRunCancelled(project.id, req.params.runId, requestId);
    } catch (error) {
      if (error instanceof Error && error.message === "Agent run not found.") {
        throw new HttpError(404, "Agent state run not found.");
      }
      throw error;
    }

    res.json({ run });
  } catch (error) {
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
    } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/governance/decision", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);
    const parsed = governanceDecisionRequestSchema.parse(req.body ?? {});
    const detail = await agentKernel.getRunWithSteps(project.id, parsed.runId);

    if (!detail) {
      throw new HttpError(404, "Agent run not found.");
    }

    res.json(
      buildGovernanceDecision({
        detail,
        strictV1Ready: parsed.strictV1Ready
      })
    );
  } catch (error) {
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
    const run = await store.getAgentRun(parsed.runId);
    const requireV1ReadyForPromote = process.env.DEEPRUN_PROMOTE_REQUIRE_V1_READY === "true";

    if (!run) {
      throw new HttpError(404, "Agent run not found.");
    }

    if (run.projectId !== project.id) {
      throw new HttpError(409, "Run does not belong to this project.");
    }

    if (run.status !== "complete") {
      throw new HttpError(409, "Run is not complete.");
    }

    if (!run.validationStatus) {
      throw new HttpError(409, "Run has not been validated.");
    }

    if (run.validationStatus !== "passed") {
      throw new HttpError(409, "Run validation failed.");
    }

    if (!run.currentCommitHash) {
      throw new HttpError(409, "Run does not have a pinned commit hash.");
    }

    const runValidationResult =
      run.validationResult && typeof run.validationResult === "object" && !Array.isArray(run.validationResult)
        ? run.validationResult
        : null;
    const v1ReadyRaw =
      runValidationResult &&
      typeof runValidationResult.v1Ready === "object" &&
      runValidationResult.v1Ready !== null &&
      !Array.isArray(runValidationResult.v1Ready)
        ? (runValidationResult.v1Ready as Record<string, unknown>)
        : null;
    const v1ReadyOk = typeof v1ReadyRaw?.ok === "boolean" ? v1ReadyRaw.ok : null;

    if (requireV1ReadyForPromote && v1ReadyOk !== true) {
      if (v1ReadyOk === false) {
        throw new HttpError(409, "Run v1-ready validation failed.");
      }
      throw new HttpError(409, "Run has not been strict v1-ready validated.");
    }

    const projectPath = store.getProjectWorkspacePath(project);
    const workspaceHead = await readCurrentCommitHash(projectPath);
    if (!workspaceHead || workspaceHead !== run.currentCommitHash) {
      throw new HttpError(409, "Workspace HEAD has drifted from run commit.");
    }

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
      runId: run.id,
      commitHash: run.currentCommitHash,
      status: "queued",
      subdomain,
      publicUrl,
      customDomain: customDomain ?? null,
      containerPort,
      metadata: {
        requestedBy: auth.user.id,
        requestId,
        runId: run.id,
        commitHash: run.currentCommitHash
      }
    });

    await store.appendDeploymentLog(
      deployment.id,
      `[${new Date().toISOString()}] Deployment queued for project ${project.id} by user ${auth.user.id}.\n`
    );

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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
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
    const providerId = resolveProviderIdOrHttpError(parsed.provider);

    logInfo("generation.started", {
      requestId,
      userId: auth.user.id,
      projectId: project.id,
      mode: "generate",
      provider: providerId,
      model: parsed.model || null
    });

    const startedAt = Date.now();

    const run = await agentKernel.startRunWithPlan({
      project,
      createdByUserId: auth.user.id,
      goal: parsed.prompt,
      providerId,
      model: parsed.model,
      requestId,
      executionMode: "project",
      executionProfile: "builder",
      metadata: {
        source: "builder_generate"
      },
      plan: buildBuilderSyntheticPlan({
        prompt: parsed.prompt,
        providerId,
        model: parsed.model,
        mode: "generate"
      })
    });
    const result = deriveBuilderResultFromRun({
      detail: run,
      fallbackMode: "generate"
    });
    await persistBuilderActivityMirror({
      project,
      prompt: parsed.prompt,
      mode: "generate",
      result,
      runId: run.run.id
    });

    logInfo("generation.completed", {
      requestId,
      userId: auth.user.id,
      projectId: project.id,
      mode: "generate",
      provider: providerId,
      model: parsed.model || null,
      filesChangedCount: result.filesChanged.length,
      durationMs: Date.now() - startedAt,
      commitHash: result.commitHash,
      runId: run.run.id
    });

    res.json({
      result
    });
  } catch (error) {
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
    const providerId = resolveProviderIdOrHttpError(parsed.provider);

    logInfo("generation.started", {
      requestId,
      userId: auth.user.id,
      projectId: project.id,
      mode: "chat",
      provider: providerId,
      model: parsed.model || null
    });

    const startedAt = Date.now();

    const run = await agentKernel.startRunWithPlan({
      project,
      createdByUserId: auth.user.id,
      goal: parsed.prompt,
      providerId,
      model: parsed.model,
      requestId,
      executionMode: "project",
      executionProfile: "builder",
      metadata: {
        source: "builder_chat"
      },
      plan: buildBuilderSyntheticPlan({
        prompt: parsed.prompt,
        providerId,
        model: parsed.model,
        mode: "chat"
      })
    });
    const result = deriveBuilderResultFromRun({
      detail: run,
      fallbackMode: "chat"
    });
    await persistBuilderActivityMirror({
      project,
      prompt: parsed.prompt,
      mode: "chat",
      result,
      runId: run.run.id
    });

    logInfo("generation.completed", {
      requestId,
      userId: auth.user.id,
      projectId: project.id,
      mode: "chat",
      provider: providerId,
      model: parsed.model || null,
      filesChangedCount: result.filesChanged.length,
      durationMs: Date.now() - startedAt,
      commitHash: result.commitHash,
      runId: run.run.id
    });

    res.json({
      result
    });
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/git/history", authRequired, async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const project = await requireProjectAccess(auth.user.id, req.params.projectId);

    const commits = await listCommits(store.getProjectWorkspacePath(project));
    res.json({ commits });
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }

  return res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
      details: error.details,
      ...serializeError(error)
    });

    return res.status(error.status).json({
      error: error.message,
      ...(error.details !== undefined ? { details: error.details } : {})
    });
  }

  logError("http.error.unhandled", {
    requestId,
    ...serializeError(error)
  });

  return res.status(500).json({ error: "Internal server error." });
});

async function main(): Promise<void> {
  await store.initialize();

  const port = Number(process.env.PORT || 3000);
  httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.once("error", reject);
  });

  serverLifecycleState = "ready";

  logInfo("server.started", {
    port,
    origins: corsAllowedOrigins,
    trustProxy
  });
  console.log(`deeprun running at http://localhost:${port}`);
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeStoreOnce(): Promise<void> {
  if (storeClosed) {
    return;
  }

  await store.close();
  storeClosed = true;
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  shutdownPromise = (async () => {
    const startedAt = Date.now();
    serverLifecycleState = "draining";

    logInfo("server.shutdown_started", {
      signal,
      graceMs: shutdownGraceMs
    });

    const forceExitTimer = setTimeout(() => {
      logError("server.shutdown_timeout", {
        signal,
        graceMs: shutdownGraceMs
      });
      process.exit(1);
    }, shutdownGraceMs);

    forceExitTimer.unref();

    try {
      if (httpServer) {
        httpServer.closeIdleConnections?.();
        await closeHttpServer(httpServer);
      }

      await closeStoreOnce();
      serverLifecycleState = "stopped";

      logInfo("server.shutdown_complete", {
        signal,
        durationMs: Date.now() - startedAt
      });
      process.exit(0);
    } catch (error) {
      logError("server.shutdown_failed", {
        signal,
        durationMs: Date.now() - startedAt,
        ...serializeError(error)
      });
      process.exit(1);
    } finally {
      clearTimeout(forceExitTimer);
    }
  })();

  await shutdownPromise;
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

main().catch(async (error) => {
  logError("server.start_failed", {
    ...serializeError(error)
  });

  try {
    await closeStoreOnce();
  } catch (closeError) {
    logError("server.start_failed_cleanup", {
      ...serializeError(closeError)
    });
  }

  process.exit(1);
});
