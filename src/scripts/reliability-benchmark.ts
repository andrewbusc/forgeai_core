import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runV1ReadinessCheck } from "../agent/validation/check-v1-ready.js";

type HttpMethod = "GET" | "POST";
type OptionMap = Record<string, string | boolean>;

interface ParsedArgs {
  options: OptionMap;
}

interface AuthPayload {
  activeWorkspaceId?: string;
  activeOrganizationId?: string;
  organizations?: Array<{ id: string; workspaces?: Array<{ id: string }> }>;
}

interface BootstrapResponse {
  project?: { id?: string };
  run?: {
    run?: {
      id?: string;
      status?: string;
    };
  };
  certification?: {
    ok?: boolean;
    blockingCount?: number;
    warningCount?: number;
    summary?: string;
    targetPath?: string;
  };
}

export interface ReliabilityBenchmarkOptions {
  apiBaseUrl: string;
  email: string;
  password: string;
  name: string;
  organizationName: string;
  workspaceName: string;
  iterations: number;
  goal: string;
  provider?: string;
  model?: string;
  strictV1Ready: boolean;
  minPassRate?: number;
  outputPath?: string;
}

export interface ReliabilityIteration {
  index: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  projectId: string | null;
  runId: string | null;
  runStatus: string | null;
  certification: {
    ok: boolean;
    blockingCount: number;
    warningCount: number;
    summary: string;
    targetPath: string | null;
  };
  v1Ready?: {
    ok: boolean;
    verdict: "YES" | "NO";
    generatedAt: string;
    failedChecks?: string[];
  };
  ok: boolean;
  failureReason?: string;
}

export interface ReliabilityBenchmarkReport {
  generatedAt: string;
  apiBaseUrl: string;
  goal: string;
  provider: string | null;
  model: string | null;
  strictV1Ready: boolean;
  minPassRate: number | null;
  iterationsRequested: number;
  iterationsCompleted: number;
  passCount: number;
  failCount: number;
  passRate: number;
  thresholdMet: boolean | null;
  runs: ReliabilityIteration[];
}

class CookieJar {
  private readonly values = new Map<string, string>();

  headerValue(): string | undefined {
    if (this.values.size === 0) {
      return undefined;
    }
    return Array.from(this.values.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  ingest(headers: Headers): void {
    const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
    const cookieLines =
      typeof anyHeaders.getSetCookie === "function"
        ? anyHeaders.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie") as string]
          : [];

    for (const line of cookieLines) {
      const first = line.split(";")[0]?.trim();
      if (!first) {
        continue;
      }

      const separator = first.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();

      if (!name) {
        continue;
      }

      if (!value) {
        this.values.delete(name);
      } else {
        this.values.set(name, value);
      }
    }
  }
}

class ApiClient {
  private readonly baseUrl: string;
  private readonly jar: CookieJar;

  constructor(baseUrl: string, jar: CookieJar) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.jar = jar;
  }

  async request<T>(method: HttpMethod, endpoint: string, body?: unknown): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const cookieHeader = this.jar.headerValue();
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    this.jar.ingest(response.headers);

    const text = await response.text();
    let payload: unknown = {};

    if (text.trim().length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    return {
      status: response.status,
      body: payload as T
    };
  }
}

function apiErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }

  const candidate = (body as { error?: unknown }).error;
  return typeof candidate === "string" ? candidate : "";
}

function summarizeFailedV1Checks(v1Report: Awaited<ReturnType<typeof runV1ReadinessCheck>>): string[] {
  if (!v1Report || !Array.isArray(v1Report.checks)) {
    return [];
  }

  return v1Report.checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.message}`);
}

export function isExistingUserRegisterConflict(status: number, body: unknown): boolean {
  if (status === 409) {
    return true;
  }

  if (status < 500) {
    return false;
  }

  const message = apiErrorMessage(body).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("already exists") ||
    message.includes("duplicate key") ||
    message.includes("users_email_key")
  );
}

export function buildIterationScopedMigrationDatabaseUrl(
  baseUrl: string | undefined,
  iteration: number,
  uniqueToken: string = randomUUID()
): string | undefined {
  const raw = (baseUrl || "").trim();
  if (!raw) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return raw;
  }

  const token = uniqueToken.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 16) || "bench";
  const schemaName = `deeprun_bench_${iteration}_${token}`.slice(0, 63);
  parsed.searchParams.set("schema", schemaName);
  return parsed.toString();
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: OptionMap = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > 2) {
      options[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
      continue;
    }

    options[key] = true;
  }

  return {
    options
  };
}

function optionString(options: OptionMap, key: string, envValue?: string): string | undefined {
  const value = options[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (envValue) {
    const trimmed = envValue.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}

function parseBooleanValue(raw: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw !== "string") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function parseIntOption(raw: string | undefined, fallback: number, key: string): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Option --${key} must be a number.`);
  }

  return Math.floor(parsed);
}

function parseRateOption(raw: string | undefined, key: string): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Option --${key} must be a number between 0 and 1.`);
  }

  if (parsed < 0 || parsed > 1) {
    throw new Error(`Option --${key} must be between 0 and 1.`);
  }

  return parsed;
}

function resolveWorkspaceId(payload: AuthPayload): string | undefined {
  return payload.activeWorkspaceId || payload.organizations?.[0]?.workspaces?.[0]?.id;
}

function benchmarkUsage(): string {
  return [
    "deeprun Reliability Benchmark",
    "",
    "Usage:",
    "  npm run benchmark:reliability -- --email <email> --password <password> [options]",
    "",
    "Options:",
    "  --api <url>                 API base URL (default: http://127.0.0.1:3000)",
    "  --email <email>             Auth email (required if DEEPRUN_BENCHMARK_EMAIL is unset)",
    "  --password <password>       Auth password (required if DEEPRUN_BENCHMARK_PASSWORD is unset)",
    "  --name <name>               Display name for registration fallback",
    "  --org <name>                Organization name for registration fallback",
    "  --workspace <name>          Workspace name for registration fallback",
    "  --iterations <n>            Number of bootstrap runs (default: 10)",
    "  --goal <text>               Goal prompt for each run",
    "  --provider <id>             Provider override",
    "  --model <id>                Model override",
    "  --strict-v1-ready <bool>    Run full check:v1-ready per sample (default: true)",
    "  --min-pass-rate <0..1>      Fail process if passRate is below this threshold",
    "  --output <path>             Write JSON report to file",
    "  --help                      Show this help",
    "",
    "Environment fallbacks:",
    "  DEEPRUN_BENCHMARK_API",
    "  DEEPRUN_BENCHMARK_EMAIL",
    "  DEEPRUN_BENCHMARK_PASSWORD",
    "  DEEPRUN_BENCHMARK_ITERATIONS",
    "  DEEPRUN_BENCHMARK_GOAL",
    "  DEEPRUN_BENCHMARK_STRICT_V1_READY",
    "  DEEPRUN_BENCHMARK_MIN_PASS_RATE"
  ].join("\n");
}

export function parseReliabilityBenchmarkOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ReliabilityBenchmarkOptions {
  const parsed = parseArgs(argv);
  const options = parsed.options;
  const email = optionString(options, "email", env.DEEPRUN_BENCHMARK_EMAIL);
  const password = optionString(options, "password", env.DEEPRUN_BENCHMARK_PASSWORD);

  if (!email || !password) {
    throw new Error("Both --email and --password are required (or set DEEPRUN_BENCHMARK_EMAIL/DEEPRUN_BENCHMARK_PASSWORD).");
  }

  const iterations = parseIntOption(
    optionString(options, "iterations", env.DEEPRUN_BENCHMARK_ITERATIONS),
    10,
    "iterations"
  );

  if (iterations < 1 || iterations > 500) {
    throw new Error("Option --iterations must be between 1 and 500.");
  }

  return {
    apiBaseUrl: optionString(options, "api", env.DEEPRUN_BENCHMARK_API) || "http://127.0.0.1:3000",
    email,
    password,
    name: optionString(options, "name") || "deeprun Reliability Bot",
    organizationName: optionString(options, "org") || "deeprun Reliability",
    workspaceName: optionString(options, "workspace") || "Reliability Workspace",
    iterations,
    goal:
      optionString(options, "goal", env.DEEPRUN_BENCHMARK_GOAL) ||
      "Build SaaS backend with auth, validation, tests, and deployment readiness.",
    provider: optionString(options, "provider"),
    model: optionString(options, "model"),
    strictV1Ready: parseBooleanValue(options["strict-v1-ready"] ?? env.DEEPRUN_BENCHMARK_STRICT_V1_READY, true),
    minPassRate: parseRateOption(optionString(options, "min-pass-rate", env.DEEPRUN_BENCHMARK_MIN_PASS_RATE), "min-pass-rate"),
    outputPath: optionString(options, "output")
  };
}

export function summarizeReliabilityRuns(
  input: {
    generatedAt: string;
    options: ReliabilityBenchmarkOptions;
    runs: ReliabilityIteration[];
  }
): ReliabilityBenchmarkReport {
  const passCount = input.runs.filter((run) => run.ok).length;
  const failCount = input.runs.length - passCount;
  const passRate = input.runs.length > 0 ? passCount / input.runs.length : 0;
  const thresholdMet = input.options.minPassRate === undefined ? null : passRate >= input.options.minPassRate;

  return {
    generatedAt: input.generatedAt,
    apiBaseUrl: input.options.apiBaseUrl,
    goal: input.options.goal,
    provider: input.options.provider || null,
    model: input.options.model || null,
    strictV1Ready: input.options.strictV1Ready,
    minPassRate: input.options.minPassRate ?? null,
    iterationsRequested: input.options.iterations,
    iterationsCompleted: input.runs.length,
    passCount,
    failCount,
    passRate,
    thresholdMet,
    runs: input.runs
  };
}

async function authenticate(client: ApiClient, options: ReliabilityBenchmarkOptions): Promise<{ workspaceId: string }> {
  const login = await client.request<AuthPayload & { error?: string }>("POST", "/api/auth/login", {
    email: options.email,
    password: options.password
  });

  if (login.status === 200) {
    const workspaceId = resolveWorkspaceId(login.body);
    if (!workspaceId) {
      throw new Error("Login succeeded but no workspace id was returned.");
    }

    return { workspaceId };
  }

  if (login.status !== 401) {
    const message = apiErrorMessage(login.body) || `Auth login failed with HTTP ${login.status}.`;
    throw new Error(message);
  }

  const register = await client.request<AuthPayload & { error?: string }>("POST", "/api/auth/register", {
    name: options.name,
    email: options.email,
    password: options.password,
    organizationName: options.organizationName,
    workspaceName: options.workspaceName
  });

  if (register.status === 201) {
    const workspaceId = resolveWorkspaceId(register.body);
    if (!workspaceId) {
      throw new Error("Registration succeeded but no workspace id was returned.");
    }

    return { workspaceId };
  }

  if (!isExistingUserRegisterConflict(register.status, register.body)) {
    const message = apiErrorMessage(register.body) || `Auth register failed with HTTP ${register.status}.`;
    throw new Error(message);
  }

  const loginAfterRegisterConflict = await client.request<AuthPayload & { error?: string }>("POST", "/api/auth/login", {
    email: options.email,
    password: options.password
  });

  if (loginAfterRegisterConflict.status !== 200) {
    const message =
      apiErrorMessage(loginAfterRegisterConflict.body) || `Auth login failed with HTTP ${loginAfterRegisterConflict.status}.`;
    throw new Error(message);
  }

  const workspaceId = resolveWorkspaceId(loginAfterRegisterConflict.body);
  if (!workspaceId) {
    throw new Error("Login succeeded but no workspace id was returned.");
  }

  return { workspaceId };
}

async function runSingleIteration(
  client: ApiClient,
  options: ReliabilityBenchmarkOptions,
  workspaceId: string,
  index: number
): Promise<ReliabilityIteration> {
  const started = new Date();
  const projectName = `reliability-${index}-${randomUUID().slice(0, 8)}`;

  try {
    const response = await client.request<BootstrapResponse & { error?: string }>("POST", "/api/projects/bootstrap/backend", {
      workspaceId,
      name: projectName,
      description: `Reliability benchmark run ${index} for ${options.goal}`,
      goal: options.goal,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {})
    });

    if (response.status !== 201) {
      const message = response.body.error || `Bootstrap endpoint failed with HTTP ${response.status}.`;
      return {
        index,
        startedAt: started.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started.getTime(),
        projectId: null,
        runId: null,
        runStatus: null,
        certification: {
          ok: false,
          blockingCount: 1,
          warningCount: 0,
          summary: message,
          targetPath: null
        },
        ok: false,
        failureReason: message
      };
    }

    const certification = response.body.certification;
    const projectId = response.body.project?.id || null;
    const runId = response.body.run?.run?.id || null;
    const runStatus = response.body.run?.run?.status || null;
    const certificationOk = certification?.ok === true;
    const targetPath = certification?.targetPath || null;

    let v1Ready:
      | {
          ok: boolean;
          verdict: "YES" | "NO";
          generatedAt: string;
        }
      | undefined;

    let failureReason: string | undefined;

    if (!certificationOk) {
      failureReason = `Bootstrap certification failed: ${certification?.summary || "unknown"}`;
    }

    if (options.strictV1Ready) {
      if (!targetPath) {
        failureReason = failureReason || "Bootstrap response did not include certification targetPath.";
      } else {
        const previousV1DockerMigrationDatabaseUrl = process.env.V1_DOCKER_MIGRATION_DATABASE_URL;
        const previousV1DockerBootDatabaseUrl = process.env.V1_DOCKER_BOOT_DATABASE_URL;
        const iterationScopedMigrationDatabaseUrl = buildIterationScopedMigrationDatabaseUrl(
          previousV1DockerMigrationDatabaseUrl || process.env.DATABASE_URL,
          index
        );

        try {
          if (iterationScopedMigrationDatabaseUrl) {
            // Prevent generated-backend migration dry-run from colliding with the control-plane API DB schema.
            process.env.V1_DOCKER_MIGRATION_DATABASE_URL = iterationScopedMigrationDatabaseUrl;
            process.env.V1_DOCKER_BOOT_DATABASE_URL = iterationScopedMigrationDatabaseUrl;
          }

          const v1Report = await runV1ReadinessCheck(targetPath);
          const failedChecks = summarizeFailedV1Checks(v1Report);
          v1Ready = {
            ok: v1Report.ok,
            verdict: v1Report.verdict,
            generatedAt: v1Report.generatedAt,
            ...(failedChecks.length ? { failedChecks } : {})
          };

          if (!v1Report.ok) {
            const failureSuffix = failedChecks.length ? ` (${failedChecks.join("; ")})` : "";
            failureReason = failureReason || `Full v1-ready check failed.${failureSuffix}`;
          }
        } finally {
          if (previousV1DockerMigrationDatabaseUrl === undefined) {
            delete process.env.V1_DOCKER_MIGRATION_DATABASE_URL;
          } else {
            process.env.V1_DOCKER_MIGRATION_DATABASE_URL = previousV1DockerMigrationDatabaseUrl;
          }
          if (previousV1DockerBootDatabaseUrl === undefined) {
            delete process.env.V1_DOCKER_BOOT_DATABASE_URL;
          } else {
            process.env.V1_DOCKER_BOOT_DATABASE_URL = previousV1DockerBootDatabaseUrl;
          }
        }
      }
    }

    const ok = certificationOk && runStatus === "complete" && (!options.strictV1Ready || v1Ready?.ok === true);

    return {
      index,
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started.getTime(),
      projectId,
      runId,
      runStatus,
      certification: {
        ok: certificationOk,
        blockingCount: Number(certification?.blockingCount || 0),
        warningCount: Number(certification?.warningCount || 0),
        summary: certification?.summary || "",
        targetPath
      },
      ...(v1Ready ? { v1Ready } : {}),
      ok,
      ...(ok ? {} : { failureReason: failureReason || "Run did not reach required success criteria." })
    };
  } catch (error) {
    return {
      index,
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started.getTime(),
      projectId: null,
      runId: null,
      runStatus: null,
      certification: {
        ok: false,
        blockingCount: 1,
        warningCount: 0,
        summary: error instanceof Error ? error.message : String(error),
        targetPath: null
      },
      ok: false,
      failureReason: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runReliabilityBenchmark(
  options: ReliabilityBenchmarkOptions
): Promise<ReliabilityBenchmarkReport> {
  const jar = new CookieJar();
  const client = new ApiClient(options.apiBaseUrl, jar);
  const auth = await authenticate(client, options);

  const runs: ReliabilityIteration[] = [];

  for (let index = 1; index <= options.iterations; index += 1) {
    const entry = await runSingleIteration(client, options, auth.workspaceId, index);
    runs.push(entry);
    process.stdout.write(
      `run ${index}/${options.iterations}: ok=${String(entry.ok)} project=${entry.projectId || "-"} run=${entry.runId || "-"}\n`
    );
  }

  return summarizeReliabilityRuns({
    generatedAt: new Date().toISOString(),
    options,
    runs
  });
}

async function writeReportIfRequested(report: ReliabilityBenchmarkReport, outputPath?: string): Promise<void> {
  if (!outputPath) {
    return;
  }

  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${benchmarkUsage()}\n`);
    return;
  }

  const options = parseReliabilityBenchmarkOptions(process.argv.slice(2));
  const report = await runReliabilityBenchmark(options);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await writeReportIfRequested(report, options.outputPath);

  if (report.thresholdMet === false) {
    process.stderr.write(
      `Reliability benchmark failed threshold: passRate=${report.passRate.toFixed(4)} min=${String(options.minPassRate)}\n`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
