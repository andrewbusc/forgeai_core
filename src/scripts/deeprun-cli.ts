import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type EngineMode = "state" | "kernel";
type HttpMethod = "GET" | "POST" | "PUT";

type CliCommand =
  | "init"
  | "bootstrap"
  | "run"
  | "status"
  | "logs"
  | "branch"
  | "fork"
  | "continue"
  | "validate"
  | "promote"
  | "help";

interface CliConfig {
  apiBaseUrl: string;
  cookies: Record<string, string>;
  activeWorkspaceId?: string;
  activeOrganizationId?: string;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  lastProjectId?: string;
  lastStateRunId?: string;
  lastKernelRunId?: string;
}

interface ParsedArgs {
  command: CliCommand;
  args: string[];
  options: Record<string, string | boolean>;
  verbose: boolean;
}

interface HttpResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

interface StateRunDetail {
  run: {
    id: string;
    status: string;
    phase: string;
    stepIndex: number;
    errorMessage?: string | null;
    correctionsUsed?: number;
    optimizationStepsUsed?: number;
  };
  steps: Array<{
    id: string;
    stepIndex: number;
    type: string;
    status: string;
    summary: string;
    commitHash: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
}

interface KernelCorrectionConstraint {
  intent: string;
  maxFiles: number;
  maxTotalDiffBytes: number;
  allowedPathPrefixes: string[];
  guidance: string[];
}

interface KernelCorrectionClassification {
  intent: string;
  failedChecks: string[];
  failureKinds: string[];
  rationale: string;
}

interface KernelCorrectionTelemetry {
  phase: string;
  attempt: number;
  failedStepId: string;
  reason?: string;
  summary?: string;
  runtimeLogTail?: string;
  classification: KernelCorrectionClassification;
  constraint: KernelCorrectionConstraint;
  createdAt: string;
}

interface KernelRunDetail {
  run: {
    id: string;
    status: string;
    currentStepIndex: number;
    runBranch?: string | null;
    worktreePath?: string | null;
    baseCommitHash?: string | null;
    currentCommitHash?: string | null;
    errorMessage?: string | null;
  };
  steps: Array<{
    id: string;
    stepIndex: number;
    attempt: number;
    stepId: string;
    status: string;
    type: string;
    tool: string;
    errorMessage: string | null;
    commitHash: string | null;
    createdAt: string;
    startedAt: string;
    finishedAt: string;
    outputPayload: Record<string, unknown>;
    correctionTelemetry?: KernelCorrectionTelemetry | null;
  }>;
  telemetry?: {
    corrections: Array<{
      stepRecordId: string;
      stepId: string;
      stepIndex: number;
      stepAttempt: number;
      status: string;
      errorMessage: string | null;
      commitHash: string | null;
      createdAt: string;
      telemetry: KernelCorrectionTelemetry;
    }>;
  };
}

interface CertificationDetail {
  runId: string;
  stepId: string | null;
  targetPath: string;
  validatedAt: string;
  ok: boolean;
  blockingCount: number;
  warningCount: number;
  summary: string;
}

class CookieJar {
  private readonly values = new Map<string, string>();

  constructor(seed?: Record<string, string>) {
    for (const [key, value] of Object.entries(seed || {})) {
      if (key.trim() && value.trim()) {
        this.values.set(key.trim(), value.trim());
      }
    }
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.values.entries());
  }

  headerValue(): string | undefined {
    if (this.values.size === 0) {
      return undefined;
    }

    return Array.from(this.values.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  ingest(headers: Headers): void {
    const anyHeaders = headers as Headers & {
      getSetCookie?: () => string[];
    };

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
  private readonly verbose: boolean;

  constructor(baseUrl: string, jar: CookieJar, verbose: boolean) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.jar = jar;
    this.verbose = verbose;
  }

  async request<T>(method: HttpMethod, endpoint: string, body?: unknown): Promise<HttpResponse<T>> {
    const headers: Record<string, string> = {};

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const cookieHeader = this.jar.headerValue();
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const url = `${this.baseUrl}${endpoint}`;

    if (this.verbose) {
      process.stdout.write(`[http] ${method} ${url}\n`);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    this.jar.ingest(response.headers);

    const text = await response.text();
    let parsed: unknown = {};

    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (this.verbose) {
      process.stdout.write(`[http] -> ${response.status}\n`);
    }

    return {
      status: response.status,
      body: parsed as T,
      headers: response.headers
    };
  }

  async requestOk<T>(method: HttpMethod, endpoint: string, body?: unknown): Promise<T> {
    const response = await this.request<T & { error?: string; details?: unknown }>(method, endpoint, body);

    if (response.status < 200 || response.status >= 300) {
      const candidate = response.body as { error?: string; details?: unknown };
      const message =
        typeof candidate?.error === "string" && candidate.error.trim()
          ? candidate.error
          : `Request failed with HTTP ${response.status}.`;

      const details = candidate?.details ? ` Details: ${JSON.stringify(candidate.details)}` : "";
      throw new Error(`${message}${details}`);
    }

    return response.body as T;
  }
}

function resolveConfigPath(): string {
  const override = String(process.env.DEEPRUN_CLI_CONFIG || "").trim();
  if (override) {
    return path.resolve(override);
  }

  return path.resolve(process.cwd(), ".deeprun", "cli.json");
}

async function readConfig(configPath: string): Promise<CliConfig | undefined> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;

    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    const base = String(parsed.apiBaseUrl || "").trim();

    return {
      apiBaseUrl: base || "http://127.0.0.1:3000",
      cookies: typeof parsed.cookies === "object" && parsed.cookies ? (parsed.cookies as Record<string, string>) : {},
      activeWorkspaceId: parsed.activeWorkspaceId,
      activeOrganizationId: parsed.activeOrganizationId,
      user: parsed.user,
      lastProjectId: parsed.lastProjectId,
      lastStateRunId: parsed.lastStateRunId,
      lastKernelRunId: parsed.lastKernelRunId
    };
  } catch {
    return undefined;
  }
}

async function writeConfig(configPath: string, config: CliConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = (argv[0] || "help") as CliCommand;
  const options: Record<string, string | boolean> = {};
  const args: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("-")) {
      args.push(token);
      continue;
    }

    if (token === "-v" || token === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex > 2) {
        const key = token.slice(2, eqIndex);
        const value = token.slice(eqIndex + 1);
        options[key] = value;
      } else {
        const key = token.slice(2);
        const next = argv[index + 1];

        if (next && !next.startsWith("-")) {
          options[key] = next;
          index += 1;
        } else {
          options[key] = true;
        }
      }
    }
  }

  const knownCommands: CliCommand[] = [
    "init",
    "bootstrap",
    "run",
    "status",
    "logs",
    "branch",
    "fork",
    "continue",
    "validate",
    "promote",
    "help"
  ];

  return {
    command: knownCommands.includes(command) ? command : "help",
    args,
    options,
    verbose: options.verbose === true
  };
}

function optionString(options: Record<string, string | boolean>, key: string): string | undefined {
  const value = options[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function optionInt(options: Record<string, string | boolean>, key: string): number | undefined {
  const raw = optionString(options, key);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Option --${key} must be a number.`);
  }

  return Math.floor(parsed);
}

function optionFlag(options: Record<string, string | boolean>, key: string): boolean {
  const value = options[key];
  if (value === true) {
    return true;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
  }

  return false;
}

function commandUsage(): string {
  return [
    "deeprun CLI",
    "",
    "Commands:",
    "  init --api <url> --email <email> --password <password> [--name <name>] [--org <name>] [--workspace <name>]",
    "  bootstrap <goal> [--workspace <workspaceId>] [--project-name <name>] [--description <text>] [--provider <id>] [--model <id>]",
    "  run <goal> [--engine state|kernel] [--project <projectId>] [--workspace <workspaceId>] [--project-name <name>] [--template <templateId>] [--provider <id>] [--model <id>]",
    "  status [--engine state|kernel] [--project <projectId>] [--run <runId>] [--watch] [--timeout-ms <ms>] [--verbose]",
    "  logs [--engine state|kernel] [--project <projectId>] [--run <runId>] [--verbose]",
    "  continue [--engine state|kernel] [--project <projectId>] [--run <runId>]",
    "  validate [--project <projectId>] [--run <runId>]",
    "  branch [--project <projectId>] [--run <runId>]",
    "  fork <stepId> [--project <projectId>] [--run <runId>]",
    "  promote [--project <projectId>] [--custom-domain <domain>] [--container-port <port>]",
    "",
    "Notes:",
    "  - Session state is persisted in .deeprun/cli.json (or DEEPRUN_CLI_CONFIG).",
    "  - If --provider is omitted, server-side default provider selection is used.",
    "  - Use --verbose to include request tracing and expanded step output."
  ].join("\n");
}

function ensureConfig(config: CliConfig | undefined): CliConfig {
  if (!config) {
    throw new Error("CLI is not initialized. Run: deeprun init --api <url> --email <email> --password <password>");
  }
  return config;
}

function resolveEngine(options: Record<string, string | boolean>, fallback: EngineMode = "state"): EngineMode {
  const raw = optionString(options, "engine") || fallback;
  if (raw !== "state" && raw !== "kernel") {
    throw new Error("Option --engine must be either 'state' or 'kernel'.");
  }
  return raw;
}

function suggestProjectName(goal: string): string {
  const normalized = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `deeprun-${normalized || randomUUID().slice(0, 8)}`;
}

async function createProjectIfNeeded(input: {
  client: ApiClient;
  config: CliConfig;
  options: Record<string, string | boolean>;
  goal: string;
}): Promise<{ projectId: string; workspaceId: string }> {
  const explicitProjectId = optionString(input.options, "project");
  if (explicitProjectId) {
    return {
      projectId: explicitProjectId,
      workspaceId: optionString(input.options, "workspace") || input.config.activeWorkspaceId || ""
    };
  }

  if (input.config.lastProjectId) {
    return {
      projectId: input.config.lastProjectId,
      workspaceId: optionString(input.options, "workspace") || input.config.activeWorkspaceId || ""
    };
  }

  const workspaceId = optionString(input.options, "workspace") || input.config.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error("No workspace available. Pass --workspace <workspaceId> or run init to store an active workspace.");
  }

  const suggestedName = optionString(input.options, "project-name") || suggestProjectName(input.goal);

  const selectedTemplate = optionString(input.options, "template") || "canonical-backend";

  const created = await input.client.requestOk<{
    project: { id: string };
  }>("POST", "/api/projects", {
    workspaceId,
    name: suggestedName,
    description: `Created by deeprun CLI for goal: ${input.goal}`,
    templateId: selectedTemplate
  });

  return {
    projectId: created.project.id,
    workspaceId
  };
}

async function pollStateRun(input: {
  client: ApiClient;
  projectId: string;
  runId: string;
  verbose: boolean;
  timeoutMs?: number;
}): Promise<StateRunDetail> {
  const timeoutMs = input.timeoutMs || 180_000;
  const startedAt = Date.now();
  let lastSignature = "";

  while (Date.now() - startedAt < timeoutMs) {
    const detail = await input.client.requestOk<StateRunDetail>(
      "GET",
      `/api/projects/${input.projectId}/agent/state-runs/${input.runId}`
    );

    const run = detail.run;
    const signature = `${run.status}|${run.phase}|${run.stepIndex}|${detail.steps.length}|${run.correctionsUsed || 0}|${run.optimizationStepsUsed || 0}`;

    if (signature !== lastSignature) {
      process.stdout.write(
        `state status=${run.status} phase=${run.phase} stepIndex=${run.stepIndex} steps=${detail.steps.length}` +
          `${typeof run.correctionsUsed === "number" ? ` corrections=${run.correctionsUsed}` : ""}` +
          `${typeof run.optimizationStepsUsed === "number" ? ` optimizations=${run.optimizationStepsUsed}` : ""}` +
          "\n"
      );

      if (input.verbose && detail.steps.length > 0) {
        const lastStep = detail.steps[detail.steps.length - 1];
        process.stdout.write(
          `  last-step id=${lastStep.id} idx=${lastStep.stepIndex} type=${lastStep.type} status=${lastStep.status} summary=${lastStep.summary}\n`
        );
      }

      lastSignature = signature;
    }

    if (run.status === "complete" || run.status === "failed" || run.status === "cancelled") {
      return detail;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(`Timed out waiting for state run ${input.runId} to reach terminal status.`);
}

async function pollKernelRun(input: {
  client: ApiClient;
  projectId: string;
  runId: string;
  verbose: boolean;
  timeoutMs?: number;
}): Promise<KernelRunDetail> {
  const timeoutMs = input.timeoutMs || 180_000;
  const startedAt = Date.now();
  let lastSignature = "";

  while (Date.now() - startedAt < timeoutMs) {
    const detail = await input.client.requestOk<KernelRunDetail>("GET", `/api/projects/${input.projectId}/agent/runs/${input.runId}`);

    const run = detail.run;
    const correctionCount = detail.telemetry?.corrections.length || 0;
    const signature = `${run.status}|${run.currentStepIndex}|${detail.steps.length}|${correctionCount}`;

    if (signature !== lastSignature) {
      process.stdout.write(
        `kernel status=${run.status} stepIndex=${run.currentStepIndex} steps=${detail.steps.length} corrections=${correctionCount}\n`
      );

      if (input.verbose && detail.steps.length > 0) {
        const lastStep = detail.steps[detail.steps.length - 1];
        process.stdout.write(
          `  last-step id=${lastStep.stepId} idx=${lastStep.stepIndex} attempt=${lastStep.attempt} status=${lastStep.status} tool=${lastStep.tool}\n`
        );

        const lastCorrection = correctionCount ? detail.telemetry?.corrections[correctionCount - 1] : null;
        if (lastCorrection) {
          process.stdout.write(
            `  correction intent=${lastCorrection.telemetry.classification.intent} phase=${lastCorrection.telemetry.phase} step=${lastCorrection.stepId} status=${lastCorrection.status}\n`
          );
        }
      }

      lastSignature = signature;
    }

    if (run.status === "complete" || run.status === "failed" || run.status === "cancelled") {
      return detail;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(`Timed out waiting for kernel run ${input.runId} to reach terminal status.`);
}

function resolveProjectAndRunId(input: {
  config: CliConfig;
  options: Record<string, string | boolean>;
  engine: EngineMode;
}): { projectId: string; runId: string } {
  const projectId = optionString(input.options, "project") || input.config.lastProjectId;
  if (!projectId) {
    throw new Error("Project id is required. Pass --project <projectId> or run a command that sets last project.");
  }

  const runId =
    optionString(input.options, "run") ||
    (input.engine === "state" ? input.config.lastStateRunId : input.config.lastKernelRunId);

  if (!runId) {
    throw new Error(
      `Run id is required for ${input.engine} engine. Pass --run <runId> or run 'deeprun run --engine ${input.engine}'.`
    );
  }

  return { projectId, runId };
}

async function handleInit(input: {
  configPath: string;
  config: CliConfig | undefined;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<void> {
  const apiBaseUrl = optionString(input.options, "api") || input.config?.apiBaseUrl || "http://127.0.0.1:3000";
  const email = optionString(input.options, "email");
  const password = optionString(input.options, "password");

  if (!email || !password) {
    throw new Error("init requires --email and --password.");
  }

  const name = optionString(input.options, "name") || "deeprun User";
  const organizationName = optionString(input.options, "org") || `${name} Organization`;
  const workspaceName = optionString(input.options, "workspace") || "Primary Workspace";

  const jar = new CookieJar(input.config?.cookies || {});
  const client = new ApiClient(apiBaseUrl, jar, input.verbose);

  let payload: {
    user?: { id: string; email: string; name: string };
    activeWorkspaceId?: string;
    activeOrganizationId?: string;
    organizations?: Array<{ id: string; workspaces?: Array<{ id: string }> }>;
  };

  const register = await client.request<{
    user?: { id: string; email: string; name: string };
    activeWorkspaceId?: string;
    activeOrganizationId?: string;
    error?: string;
  }>("POST", "/api/auth/register", {
    name,
    email,
    password,
    organizationName,
    workspaceName
  });

  if (register.status === 201) {
    payload = register.body;
  } else if (register.status === 409) {
    const login = await client.requestOk<{
      user: { id: string; email: string; name: string };
      activeWorkspaceId?: string;
      activeOrganizationId?: string;
      organizations: Array<{ id: string; workspaces?: Array<{ id: string }> }>;
    }>("POST", "/api/auth/login", {
      email,
      password
    });

    payload = login;
  } else {
    const error = register.body as { error?: string };
    throw new Error(error.error || `Initialization failed with HTTP ${register.status}.`);
  }

  const workspaceId =
    payload.activeWorkspaceId || payload.organizations?.[0]?.workspaces?.[0]?.id || input.config?.activeWorkspaceId;

  if (!workspaceId) {
    throw new Error("Could not resolve active workspace from auth response.");
  }

  const next: CliConfig = {
    apiBaseUrl,
    cookies: jar.toObject(),
    activeWorkspaceId: workspaceId,
    activeOrganizationId: payload.activeOrganizationId || payload.organizations?.[0]?.id,
    user: payload.user || input.config?.user,
    lastProjectId: input.config?.lastProjectId,
    lastStateRunId: input.config?.lastStateRunId,
    lastKernelRunId: input.config?.lastKernelRunId
  };

  await writeConfig(input.configPath, next);

  process.stdout.write("Initialized deeprun CLI session.\n");
  process.stdout.write(`API_BASE_URL=${next.apiBaseUrl}\n`);
  process.stdout.write(`WORKSPACE_ID=${next.activeWorkspaceId}\n`);
  if (next.user?.id) {
    process.stdout.write(`USER_ID=${next.user.id}\n`);
  }
  process.stdout.write(`CONFIG_PATH=${input.configPath}\n`);
}

async function handleBootstrap(input: {
  configPath: string;
  config: CliConfig;
  args: string[];
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<number> {
  const goal = input.args.join(" ").trim() || optionString(input.options, "goal");
  if (!goal) {
    throw new Error("bootstrap requires a goal. Example: deeprun bootstrap \"Build SaaS backend with auth\"");
  }

  const workspaceId = optionString(input.options, "workspace") || input.config.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error("No workspace available. Pass --workspace <workspaceId> or run init to store an active workspace.");
  }

  const projectName = optionString(input.options, "project-name") || suggestProjectName(goal);
  const description = optionString(input.options, "description") || `Created by deeprun CLI for goal: ${goal}`;
  const provider = optionString(input.options, "provider");
  const model = optionString(input.options, "model");

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  const started = await client.requestOk<{
    project: { id: string };
    run: KernelRunDetail;
    certification?: CertificationDetail;
  }>("POST", "/api/projects/bootstrap/backend", {
    workspaceId,
    name: projectName,
    description,
    goal,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {})
  });

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    activeWorkspaceId: workspaceId,
    lastProjectId: started.project.id,
    lastKernelRunId: started.run.run.id
  });

  process.stdout.write(`PROJECT_ID=${started.project.id}\n`);
  process.stdout.write(`RUN_ID=${started.run.run.id}\n`);
  process.stdout.write("ENGINE=kernel\n");
  process.stdout.write(`RUN_STATUS=${started.run.run.status}\n`);
  process.stdout.write(`STEP_COUNT=${started.run.steps.length}\n`);
  if (!started.certification) {
    process.stderr.write("Bootstrap did not return certification data.\n");
    return 2;
  }

  process.stdout.write(`CERTIFICATION_OK=${String(started.certification.ok)}\n`);
  process.stdout.write(`CERTIFICATION_BLOCKING_COUNT=${started.certification.blockingCount}\n`);
  process.stdout.write(`CERTIFICATION_WARNING_COUNT=${started.certification.warningCount}\n`);
  process.stdout.write(`CERTIFICATION_SUMMARY=${started.certification.summary}\n`);
  process.stdout.write(`CERTIFICATION_TARGET_PATH=${started.certification.targetPath}\n`);

  if (!started.certification.ok) {
    process.stderr.write(
      `Bootstrap certification failed: blocking=${started.certification.blockingCount} summary=${started.certification.summary}\n`
    );
    return 2;
  }

  return started.run.run.status === "complete" ? 0 : 1;
}

async function handleRun(input: {
  configPath: string;
  config: CliConfig;
  args: string[];
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<number> {
  const goal = input.args.join(" ").trim() || optionString(input.options, "goal");
  if (!goal) {
    throw new Error("run requires a goal. Example: deeprun run \"Build SaaS backend with auth\"");
  }

  const engine = resolveEngine(input.options, "state");
  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);
  const provider = optionString(input.options, "provider");
  const model = optionString(input.options, "model");

  const projectContext = await createProjectIfNeeded({
    client,
    config: input.config,
    options: input.options,
    goal
  });

  const nextConfig: CliConfig = {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectContext.projectId
  };

  if (engine === "state") {
    const created = await client.requestOk<{
      run: {
        id: string;
      };
    }>("POST", `/api/projects/${projectContext.projectId}/agent/state-runs`, {
      goal,
      autoStart: true
    });

    nextConfig.lastStateRunId = created.run.id;
    await writeConfig(input.configPath, nextConfig);

    process.stdout.write(`PROJECT_ID=${projectContext.projectId}\n`);
    process.stdout.write(`RUN_ID=${created.run.id}\n`);
    process.stdout.write(`ENGINE=state\n`);

    const finalDetail = await pollStateRun({
      client,
      projectId: projectContext.projectId,
      runId: created.run.id,
      verbose: input.verbose
    });

    nextConfig.cookies = jar.toObject();
    await writeConfig(input.configPath, nextConfig);

    process.stdout.write(`RUN_STATUS=${finalDetail.run.status}\n`);
    if (finalDetail.run.errorMessage) {
      process.stdout.write(`RUN_ERROR=${finalDetail.run.errorMessage}\n`);
    }

    return finalDetail.run.status === "complete" ? 0 : 1;
  }

  const started = await client.requestOk<KernelRunDetail>("POST", `/api/projects/${projectContext.projectId}/agent/runs`, {
    goal,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {})
  });

  nextConfig.lastKernelRunId = started.run.id;
  nextConfig.cookies = jar.toObject();
  await writeConfig(input.configPath, nextConfig);

  process.stdout.write(`PROJECT_ID=${projectContext.projectId}\n`);
  process.stdout.write(`RUN_ID=${started.run.id}\n`);
  process.stdout.write(`ENGINE=kernel\n`);
  process.stdout.write(`RUN_STATUS=${started.run.status}\n`);
  process.stdout.write(`STEP_COUNT=${started.steps.length}\n`);

  if (input.verbose && started.steps.length > 0) {
    for (const step of started.steps) {
      process.stdout.write(
        `step idx=${step.stepIndex} attempt=${step.attempt} id=${step.stepId} tool=${step.tool} status=${step.status}\n`
      );
    }
  }

  return started.run.status === "complete" ? 0 : 1;
}

async function handleStatus(input: {
  configPath: string;
  config: CliConfig;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<number> {
  const engine = resolveEngine(input.options, "state");
  const watch = optionFlag(input.options, "watch");
  const timeoutMs = optionInt(input.options, "timeout-ms");
  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  if (engine === "state") {
    const detail = watch
      ? await pollStateRun({
          client,
          projectId,
          runId,
          verbose: input.verbose,
          timeoutMs
        })
      : await client.requestOk<StateRunDetail>("GET", `/api/projects/${projectId}/agent/state-runs/${runId}`);

    const nextConfig: CliConfig = {
      ...input.config,
      cookies: jar.toObject(),
      lastProjectId: projectId,
      lastStateRunId: runId
    };
    await writeConfig(input.configPath, nextConfig);

    process.stdout.write(`PROJECT_ID=${projectId}\n`);
    process.stdout.write(`RUN_ID=${runId}\n`);
    process.stdout.write(`ENGINE=state\n`);
    process.stdout.write(`RUN_STATUS=${detail.run.status}\n`);
    process.stdout.write(`PHASE=${detail.run.phase}\n`);
    process.stdout.write(`STEP_INDEX=${detail.run.stepIndex}\n`);
    process.stdout.write(`STEP_COUNT=${detail.steps.length}\n`);

    if (detail.run.errorMessage) {
      process.stdout.write(`RUN_ERROR=${detail.run.errorMessage}\n`);
    }

    return detail.run.status === "complete" ? 0 : detail.run.status === "failed" ? 1 : 0;
  }

  const detail = watch
    ? await pollKernelRun({
        client,
        projectId,
        runId,
        verbose: input.verbose,
        timeoutMs
      })
    : await client.requestOk<KernelRunDetail>("GET", `/api/projects/${projectId}/agent/runs/${runId}`);

  const nextConfig: CliConfig = {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: runId
  };
  await writeConfig(input.configPath, nextConfig);

  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  process.stdout.write(`RUN_ID=${runId}\n`);
  process.stdout.write(`ENGINE=kernel\n`);
  process.stdout.write(`RUN_STATUS=${detail.run.status}\n`);
  process.stdout.write(`STEP_INDEX=${detail.run.currentStepIndex}\n`);
  process.stdout.write(`STEP_COUNT=${detail.steps.length}\n`);
  const corrections = detail.telemetry?.corrections || [];
  const completedCorrections = corrections.filter((entry) => entry.status === "completed").length;
  const failedCorrections = corrections.filter((entry) => entry.status === "failed").length;
  process.stdout.write(`CORRECTION_ATTEMPTS=${corrections.length}\n`);
  process.stdout.write(`CORRECTION_COMPLETED=${completedCorrections}\n`);
  process.stdout.write(`CORRECTION_FAILED=${failedCorrections}\n`);
  if (corrections.length > 0) {
    const last = corrections[corrections.length - 1];
    process.stdout.write(`LAST_CORRECTION_STEP_ID=${last.stepId}\n`);
    process.stdout.write(`LAST_CORRECTION_PHASE=${last.telemetry.phase}\n`);
    process.stdout.write(`LAST_CORRECTION_INTENT=${last.telemetry.classification.intent}\n`);
  }

  if (detail.run.errorMessage) {
    process.stdout.write(`RUN_ERROR=${detail.run.errorMessage}\n`);
  }

  return detail.run.status === "complete" ? 0 : detail.run.status === "failed" ? 1 : 0;
}

async function handleLogs(input: {
  configPath: string;
  config: CliConfig;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<void> {
  const engine = resolveEngine(input.options, "state");
  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  if (engine === "state") {
    const detail = await client.requestOk<StateRunDetail>(
      "GET",
      `/api/projects/${projectId}/agent/state-runs/${runId}`
    );

    process.stdout.write(`STATE_RUN_LOGS run=${runId} status=${detail.run.status} phase=${detail.run.phase}\n`);

    for (const step of detail.steps) {
      process.stdout.write(
        `[${step.stepIndex}] type=${step.type} status=${step.status} commit=${step.commitHash || "-"} summary=${step.summary}\n`
      );
    }

    if (input.verbose) {
      process.stdout.write(`${JSON.stringify(detail, null, 2)}\n`);
    }

    await writeConfig(input.configPath, {
      ...input.config,
      cookies: jar.toObject(),
      lastProjectId: projectId,
      lastStateRunId: runId
    });

    return;
  }

  const detail = await client.requestOk<KernelRunDetail>("GET", `/api/projects/${projectId}/agent/runs/${runId}`);

  const corrections = detail.telemetry?.corrections || [];
  process.stdout.write(`KERNEL_RUN_LOGS run=${runId} status=${detail.run.status} corrections=${corrections.length}\n`);

  for (const step of detail.steps) {
    const line =
      `[idx=${step.stepIndex} attempt=${step.attempt}] id=${step.stepId} type=${step.type} tool=${step.tool} status=${step.status}` +
      `${step.commitHash ? ` commit=${step.commitHash}` : ""}` +
      `${step.errorMessage ? ` error=${step.errorMessage}` : ""}`;
    process.stdout.write(`${line}\n`);

    if (step.correctionTelemetry) {
      process.stdout.write(
        `  correction phase=${step.correctionTelemetry.phase} intent=${step.correctionTelemetry.classification.intent}` +
          ` correctionAttempt=${step.correctionTelemetry.attempt} failedStep=${step.correctionTelemetry.failedStepId}` +
          ` files<=${step.correctionTelemetry.constraint.maxFiles} diffBytes<=${step.correctionTelemetry.constraint.maxTotalDiffBytes}\n`
      );
    }

    if (input.verbose) {
      if (step.correctionTelemetry) {
        process.stdout.write(`${JSON.stringify(step.correctionTelemetry, null, 2)}\n`);
      }
      process.stdout.write(`${JSON.stringify(step.outputPayload || {}, null, 2)}\n`);
    }
  }

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: runId
  });
}

async function handleContinue(input: {
  configPath: string;
  config: CliConfig;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<number> {
  const engine = resolveEngine(input.options, "state");
  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  if (engine === "state") {
    const resumed = await client.requestOk<{
      run: {
        id: string;
        status: string;
      };
    }>("POST", `/api/projects/${projectId}/agent/state-runs/${runId}/resume`);

    process.stdout.write(`PROJECT_ID=${projectId}\n`);
    process.stdout.write(`RUN_ID=${resumed.run.id}\n`);
    process.stdout.write(`ENGINE=state\n`);

    const finalDetail = await pollStateRun({
      client,
      projectId,
      runId,
      verbose: input.verbose
    });

    await writeConfig(input.configPath, {
      ...input.config,
      cookies: jar.toObject(),
      lastProjectId: projectId,
      lastStateRunId: runId
    });

    process.stdout.write(`RUN_STATUS=${finalDetail.run.status}\n`);
    if (finalDetail.run.errorMessage) {
      process.stdout.write(`RUN_ERROR=${finalDetail.run.errorMessage}\n`);
    }

    return finalDetail.run.status === "complete" ? 0 : 1;
  }

  const detail = await client.requestOk<KernelRunDetail>("POST", `/api/projects/${projectId}/agent/runs/${runId}/resume`);

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: runId
  });

  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  process.stdout.write(`RUN_ID=${runId}\n`);
  process.stdout.write(`ENGINE=kernel\n`);
  process.stdout.write(`RUN_STATUS=${detail.run.status}\n`);
  process.stdout.write(`STEP_COUNT=${detail.steps.length}\n`);

  return detail.run.status === "complete" ? 0 : 1;
}

async function handleValidate(input: {
  configPath: string;
  config: CliConfig;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<number> {
  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine: "kernel"
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  const result = await client.requestOk<{
    run: { id: string };
    targetPath: string;
    validation: {
      ok: boolean;
      blockingCount: number;
      warningCount: number;
      summary: string;
      checks: Array<{
        id: string;
        status: "pass" | "fail" | "skip";
        message: string;
      }>;
    };
  }>("POST", `/api/projects/${projectId}/agent/runs/${runId}/validate`);

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: runId
  });

  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  process.stdout.write(`RUN_ID=${runId}\n`);
  process.stdout.write(`VALIDATION_OK=${String(result.validation.ok)}\n`);
  process.stdout.write(`BLOCKING_COUNT=${result.validation.blockingCount}\n`);
  process.stdout.write(`WARNING_COUNT=${result.validation.warningCount}\n`);
  process.stdout.write(`VALIDATION_SUMMARY=${result.validation.summary}\n`);

  if (input.verbose) {
    for (const check of result.validation.checks) {
      process.stdout.write(`check id=${check.id} status=${check.status} message=${check.message}\n`);
    }
  }

  return result.validation.ok ? 0 : 1;
}

async function handleBranch(input: {
  configPath: string;
  config: CliConfig;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<void> {
  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine: "kernel"
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  const detail = await client.requestOk<KernelRunDetail>("GET", `/api/projects/${projectId}/agent/runs/${runId}`);

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: runId
  });

  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  process.stdout.write(`RUN_ID=${runId}\n`);
  process.stdout.write(`RUN_BRANCH=${detail.run.runBranch || ""}\n`);
  process.stdout.write(`WORKTREE_PATH=${detail.run.worktreePath || ""}\n`);
  process.stdout.write(`BASE_COMMIT=${detail.run.baseCommitHash || ""}\n`);
  process.stdout.write(`CURRENT_COMMIT=${detail.run.currentCommitHash || ""}\n`);
}

async function handleFork(input: {
  configPath: string;
  config: CliConfig;
  args: string[];
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<void> {
  const stepId = input.args[0] || optionString(input.options, "step");
  if (!stepId) {
    throw new Error("fork requires a step id. Example: deeprun fork <stepId>");
  }

  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine: "kernel"
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  const result = await client.requestOk<KernelRunDetail>(
    "POST",
    `/api/projects/${projectId}/agent/runs/${runId}/fork/${encodeURIComponent(stepId)}`
  );

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: result.run.id
  });

  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  process.stdout.write(`SOURCE_RUN_ID=${runId}\n`);
  process.stdout.write(`FORK_RUN_ID=${result.run.id}\n`);
  process.stdout.write(`FORK_STATUS=${result.run.status}\n`);
  process.stdout.write(`FORK_STEP_INDEX=${result.run.currentStepIndex}\n`);
}

async function handlePromote(input: {
  configPath: string;
  config: CliConfig;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<number> {
  const projectId = optionString(input.options, "project") || input.config.lastProjectId;

  if (!projectId) {
    throw new Error("promote requires --project <projectId> or a previously used project.");
  }

  const customDomain = optionString(input.options, "custom-domain");
  const containerPort = optionInt(input.options, "container-port");

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  const result = await client.requestOk<{
    deployment: {
      id: string;
      status: string;
      publicUrl: string;
      subdomain: string;
      customDomain: string | null;
    };
  }>("POST", `/api/projects/${projectId}/deployments`, {
    customDomain,
    containerPort
  });

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId
  });

  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  process.stdout.write(`DEPLOYMENT_ID=${result.deployment.id}\n`);
  process.stdout.write(`DEPLOYMENT_STATUS=${result.deployment.status}\n`);
  process.stdout.write(`DEPLOYMENT_URL=${result.deployment.publicUrl}\n`);

  return 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === "help") {
    process.stdout.write(`${commandUsage()}\n`);
    return;
  }

  const configPath = resolveConfigPath();
  const existingConfig = await readConfig(configPath);

  try {
    switch (parsed.command) {
      case "init":
        await handleInit({
          configPath,
          config: existingConfig,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      case "bootstrap": {
        const config = ensureConfig(existingConfig);
        process.exitCode = await handleBootstrap({
          configPath,
          config,
          args: parsed.args,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "run": {
        const config = ensureConfig(existingConfig);
        process.exitCode = await handleRun({
          configPath,
          config,
          args: parsed.args,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "status": {
        const config = ensureConfig(existingConfig);
        process.exitCode = await handleStatus({
          configPath,
          config,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "logs": {
        const config = ensureConfig(existingConfig);
        await handleLogs({
          configPath,
          config,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "continue": {
        const config = ensureConfig(existingConfig);
        process.exitCode = await handleContinue({
          configPath,
          config,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "validate": {
        const config = ensureConfig(existingConfig);
        process.exitCode = await handleValidate({
          configPath,
          config,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "branch": {
        const config = ensureConfig(existingConfig);
        await handleBranch({
          configPath,
          config,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "fork": {
        const config = ensureConfig(existingConfig);
        await handleFork({
          configPath,
          config,
          args: parsed.args,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      case "promote": {
        const config = ensureConfig(existingConfig);
        process.exitCode = await handlePromote({
          configPath,
          config,
          options: parsed.options,
          verbose: parsed.verbose
        });
        return;
      }
      default:
        process.stdout.write(`${commandUsage()}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
