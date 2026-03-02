import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { AgentKernel } from "../agent/kernel.js";
import { RunWaitTimeoutError, waitForRunTerminal, type RunWaitMode } from "../agent/queue/run-wait.js";
import { persistGovernanceDecision, type GovernanceDecisionPayload } from "../governance/decision.js";
import { AppStore } from "../lib/project-store.js";
import { ProviderRegistry } from "../lib/providers.js";
import { workspacePath } from "../lib/workspace.js";

type EngineMode = "state" | "kernel";
type HttpMethod = "GET" | "POST" | "PUT";
type RunProfile = "full" | "ci" | "smoke";
type ExecutionValidationMode = "off" | "warn" | "enforce";

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
  | "gate"
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

interface KernelCorrectionPolicyViolation {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

interface KernelCorrectionPolicyTelemetry {
  ok: boolean;
  mode?: "off" | "warn" | "enforce";
  blockingCount: number;
  warningCount: number;
  summary: string;
  violations: KernelCorrectionPolicyViolation[];
}

interface KernelRunDetail {
  run: {
    id: string;
    status: string;
    currentStepIndex: number;
    validationStatus?: "passed" | "failed" | null;
    validationResult?: Record<string, unknown> | null;
    runBranch?: string | null;
    worktreePath?: string | null;
    baseCommitHash?: string | null;
    currentCommitHash?: string | null;
    errorMessage?: string | null;
  };
  executionConfigSummary?: {
    schemaVersion: number;
    profile: string;
    lightValidationMode: string;
    heavyValidationMode: string;
    maxRuntimeCorrectionAttempts: number;
    maxHeavyCorrectionAttempts: number;
    correctionPolicyMode: string;
    correctionConvergenceMode: string;
    plannerTimeoutMs: number;
    maxFilesPerStep: number;
    maxTotalDiffBytes: number;
    maxFileBytes: number;
    allowEnvMutation: boolean;
  };
  contract?: {
    schemaVersion: number;
    hash: string;
    material: {
      determinismPolicyVersion: number;
      plannerPolicyVersion: number;
      correctionRecipeVersion: number;
      validationPolicyVersion: number;
      randomnessSeed: string;
    };
    fallbackUsed: boolean;
    fallbackFields: string[];
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
    correctionPolicy?: KernelCorrectionPolicyTelemetry | null;
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
      correctionPolicy?: KernelCorrectionPolicyTelemetry | null;
    }>;
    correctionPolicies: Array<{
      stepRecordId: string;
      stepId: string;
      stepIndex: number;
      stepAttempt: number;
      status: string;
      errorMessage: string | null;
      commitHash: string | null;
      createdAt: string;
      policy: KernelCorrectionPolicyTelemetry;
    }>;
  };
  stubDebt?: {
    markerCount: number;
    markerPaths: string[];
    openCount: number;
    openTargets: string[];
    lastStubPath: string | null;
    lastPaydownAction: string | null;
    lastPaydownStatus: "open" | "closed" | null;
    lastPaydownAt: string | null;
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

class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
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
      throw new ApiError(response.status, message, candidate?.details);
    }

    return response.body as T;
  }
}

function resolveConfigPath(): string {
  const override = String(process.env.DEEPRUN_CLI_CONFIG || "").trim();
  if (override) {
    return path.resolve(override);
  }

  return workspacePath(".deeprun", "cli.json");
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
    "gate",
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

function parseWaitMode(options: Record<string, string | boolean>): RunWaitMode {
  const raw = optionString(options, "wait-mode");
  if (!raw) {
    return "local";
  }

  if (raw === "local" || raw === "remote") {
    return raw;
  }

  throw new Error("Option --wait-mode must be either 'local' or 'remote'.");
}

function parseRunProfile(options: Record<string, string | boolean>): RunProfile {
  const raw = optionString(options, "profile");
  if (!raw) {
    return "full";
  }

  if (raw === "full" || raw === "ci" || raw === "smoke") {
    return raw;
  }

  throw new Error("Option --profile must be one of 'full', 'ci', or 'smoke'.");
}

function parseOptionalRunProfile(options: Record<string, string | boolean>): RunProfile | undefined {
  const raw = optionString(options, "profile");
  if (!raw) {
    return undefined;
  }

  if (raw === "full" || raw === "ci" || raw === "smoke") {
    return raw;
  }

  throw new Error("Option --profile must be one of 'full', 'ci', or 'smoke'.");
}

function parseExecutionValidationModeOption(
  options: Record<string, string | boolean>,
  key: string
): ExecutionValidationMode | undefined {
  const raw = optionString(options, key);
  if (!raw) {
    return undefined;
  }

  if (raw === "off" || raw === "warn" || raw === "enforce") {
    return raw;
  }

  throw new Error(`Option --${key} must be one of 'off', 'warn', or 'enforce'.`);
}

function buildExecutionConfigPayload(input: {
  profile?: RunProfile;
  options: Record<string, string | boolean>;
}): Record<string, unknown> {
  const lightValidationMode = parseExecutionValidationModeOption(input.options, "light-validation");
  const heavyValidationMode = parseExecutionValidationModeOption(input.options, "heavy-validation");
  const correctionPolicyMode = parseExecutionValidationModeOption(input.options, "correction-policy-mode");
  const correctionConvergenceMode = parseExecutionValidationModeOption(input.options, "correction-convergence-mode");
  const maxRuntimeCorrectionAttempts = optionInt(input.options, "max-runtime-corrections");
  const maxHeavyCorrectionAttempts = optionInt(input.options, "max-heavy-corrections");
  const plannerTimeoutMs = optionInt(input.options, "planner-timeout-ms");

  return {
    ...(input.profile ? { profile: input.profile } : {}),
    ...(lightValidationMode ? { lightValidationMode } : {}),
    ...(heavyValidationMode ? { heavyValidationMode } : {}),
    ...(typeof maxRuntimeCorrectionAttempts === "number" ? { maxRuntimeCorrectionAttempts } : {}),
    ...(typeof maxHeavyCorrectionAttempts === "number" ? { maxHeavyCorrectionAttempts } : {}),
    ...(correctionPolicyMode ? { correctionPolicyMode } : {}),
    ...(correctionConvergenceMode ? { correctionConvergenceMode } : {}),
    ...(typeof plannerTimeoutMs === "number" ? { plannerTimeoutMs } : {})
  };
}

function commandUsage(): string {
  return [
    "deeprun CLI",
    "",
    "Commands:",
    "  init --api <url> --email <email> --password <password> [--name <name>] [--org <name>] [--workspace <name>]",
    "  bootstrap <goal> [--workspace <workspaceId>] [--project-name <name>] [--description <text>] [--provider <id>] [--model <id>]",
    "  run <goal> [--engine state|kernel] [--project <projectId>] [--workspace <workspaceId>] [--project-name <name>] [--template <templateId>] [--provider <id>] [--model <id>] [--profile full|ci|smoke] [--light-validation off|warn|enforce] [--heavy-validation off|warn|enforce] [--max-runtime-corrections <n>] [--max-heavy-corrections <n>] [--correction-policy-mode off|warn|enforce] [--correction-convergence-mode off|warn|enforce] [--planner-timeout-ms <ms>] [--wait] [--wait-mode local|remote] [--wait-timeout-ms <ms>]",
    "  status [--engine state|kernel] [--project <projectId>] [--run <runId>] [--watch] [--timeout-ms <ms>] [--verbose]",
    "  logs [--engine state|kernel] [--project <projectId>] [--run <runId>] [--verbose]",
    "  continue [--engine state|kernel] [--project <projectId>] [--run <runId>] [--profile full|ci|smoke] [--light-validation off|warn|enforce] [--heavy-validation off|warn|enforce] [--max-runtime-corrections <n>] [--max-heavy-corrections <n>] [--correction-policy-mode off|warn|enforce] [--correction-convergence-mode off|warn|enforce] [--planner-timeout-ms <ms>] [--override-execution-config] [--fork]",
    "  validate [--project <projectId>] [--run <runId>] [--strict-v1-ready]",
    "  gate [--project <projectId>] [--run <runId>] [--strict-v1-ready] [--output <path>]",
    "  branch [--project <projectId>] [--run <runId>]",
    "  fork <stepId> [--project <projectId>] [--run <runId>]",
    "  promote [--project <projectId>] [--run <runId>] [--custom-domain <domain>] [--container-port <port>] [--strict-v1-ready]",
    "",
    "Notes:",
    "  - Session state is persisted in DEEPRUN_WORKSPACE_ROOT/.deeprun/cli.json (or DEEPRUN_CLI_CONFIG).",
    "  - If --provider is omitted, server-side default provider selection is used.",
    "  - Kernel run --wait defaults to local durable-queue execution and requires DATABASE_URL.",
    "  - Use --verbose to include request tracing and expanded step output."
  ].join("\n");
}

interface KernelRunValidationResult {
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
  v1Ready?: {
    target: string;
    verdict: "YES" | "NO";
    ok: boolean;
    generatedAt: string;
    checks: Array<{
      id: string;
      status: "pass" | "fail" | "skip";
      message: string;
    }>;
  };
}

function writeKernelRunProgress(detail: KernelRunDetail, verbose: boolean): void {
  const run = detail.run;
  const correctionCount = detail.telemetry?.corrections.length || 0;
  process.stdout.write(
    `kernel status=${run.status} stepIndex=${run.currentStepIndex} steps=${detail.steps.length} corrections=${correctionCount}\n`
  );

  if (!verbose || detail.steps.length === 0) {
    return;
  }

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

function writeKernelRunStatus(input: { projectId: string; runId: string; detail: KernelRunDetail }): void {
  const { projectId, runId, detail } = input;
  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  process.stdout.write(`RUN_ID=${runId}\n`);
  process.stdout.write(`ENGINE=kernel\n`);
  process.stdout.write(`RUN_STATUS=${detail.run.status}\n`);
  process.stdout.write(`STEP_INDEX=${detail.run.currentStepIndex}\n`);
  process.stdout.write(`STEP_COUNT=${detail.steps.length}\n`);
  const corrections = detail.telemetry?.corrections || [];
  const correctionPolicies = detail.telemetry?.correctionPolicies || [];
  const completedCorrections = corrections.filter((entry) => entry.status === "completed").length;
  const failedCorrections = corrections.filter((entry) => entry.status === "failed").length;
  const passedCorrectionPolicies = correctionPolicies.filter((entry) => entry.policy.ok).length;
  const failedCorrectionPolicies = correctionPolicies.length - passedCorrectionPolicies;
  process.stdout.write(`CORRECTION_ATTEMPTS=${corrections.length}\n`);
  process.stdout.write(`CORRECTION_COMPLETED=${completedCorrections}\n`);
  process.stdout.write(`CORRECTION_FAILED=${failedCorrections}\n`);
  process.stdout.write(`CORRECTION_POLICY_ATTEMPTS=${correctionPolicies.length}\n`);
  process.stdout.write(`CORRECTION_POLICY_PASSED=${passedCorrectionPolicies}\n`);
  process.stdout.write(`CORRECTION_POLICY_FAILED=${failedCorrectionPolicies}\n`);
  process.stdout.write(`OPEN_STUB_DEBT_COUNT=${detail.stubDebt?.openCount ?? 0}\n`);
  process.stdout.write(`STUB_MARKER_COUNT=${detail.stubDebt?.markerCount ?? 0}\n`);
  process.stdout.write(`LAST_STUB_PATH=${detail.stubDebt?.lastStubPath || ""}\n`);
  process.stdout.write(`LAST_STUB_PAYDOWN_ACTION=${detail.stubDebt?.lastPaydownAction || ""}\n`);
  process.stdout.write(`LAST_STUB_PAYDOWN_STATUS=${detail.stubDebt?.lastPaydownStatus || ""}\n`);
  process.stdout.write(`LAST_STUB_PAYDOWN_AT=${detail.stubDebt?.lastPaydownAt || ""}\n`);
  if (detail.executionConfigSummary) {
    process.stdout.write(`EXECUTION_PROFILE=${detail.executionConfigSummary.profile}\n`);
    process.stdout.write(`EXECUTION_SCHEMA_VERSION=${detail.executionConfigSummary.schemaVersion}\n`);
    process.stdout.write(`EXECUTION_LIGHT_VALIDATION_MODE=${detail.executionConfigSummary.lightValidationMode}\n`);
    process.stdout.write(`EXECUTION_HEAVY_VALIDATION_MODE=${detail.executionConfigSummary.heavyValidationMode}\n`);
    process.stdout.write(
      `EXECUTION_MAX_RUNTIME_CORRECTION_ATTEMPTS=${detail.executionConfigSummary.maxRuntimeCorrectionAttempts}\n`
    );
    process.stdout.write(
      `EXECUTION_MAX_HEAVY_CORRECTION_ATTEMPTS=${detail.executionConfigSummary.maxHeavyCorrectionAttempts}\n`
    );
    process.stdout.write(`EXECUTION_CORRECTION_POLICY_MODE=${detail.executionConfigSummary.correctionPolicyMode}\n`);
    process.stdout.write(
      `EXECUTION_CORRECTION_CONVERGENCE_MODE=${detail.executionConfigSummary.correctionConvergenceMode}\n`
    );
    process.stdout.write(`EXECUTION_PLANNER_TIMEOUT_MS=${detail.executionConfigSummary.plannerTimeoutMs}\n`);
    process.stdout.write(`EXECUTION_MAX_FILES_PER_STEP=${detail.executionConfigSummary.maxFilesPerStep}\n`);
    process.stdout.write(`EXECUTION_MAX_TOTAL_DIFF_BYTES=${detail.executionConfigSummary.maxTotalDiffBytes}\n`);
    process.stdout.write(`EXECUTION_MAX_FILE_BYTES=${detail.executionConfigSummary.maxFileBytes}\n`);
    process.stdout.write(`EXECUTION_ALLOW_ENV_MUTATION=${String(detail.executionConfigSummary.allowEnvMutation)}\n`);
  }
  if (detail.contract) {
    process.stdout.write(`EXECUTION_CONTRACT_SCHEMA_VERSION=${detail.contract.schemaVersion}\n`);
    process.stdout.write(`EXECUTION_CONTRACT_HASH=${detail.contract.hash}\n`);
    process.stdout.write(
      `EXECUTION_CONTRACT_DETERMINISM_POLICY_VERSION=${detail.contract.material.determinismPolicyVersion}\n`
    );
    process.stdout.write(`EXECUTION_CONTRACT_PLANNER_POLICY_VERSION=${detail.contract.material.plannerPolicyVersion}\n`);
    process.stdout.write(
      `EXECUTION_CONTRACT_CORRECTION_RECIPE_VERSION=${detail.contract.material.correctionRecipeVersion}\n`
    );
    process.stdout.write(
      `EXECUTION_CONTRACT_VALIDATION_POLICY_VERSION=${detail.contract.material.validationPolicyVersion}\n`
    );
    process.stdout.write(`EXECUTION_CONTRACT_RANDOMNESS_SEED=${detail.contract.material.randomnessSeed}\n`);
    process.stdout.write(`EXECUTION_CONTRACT_FALLBACK_USED=${String(detail.contract.fallbackUsed)}\n`);
    process.stdout.write(`EXECUTION_CONTRACT_FALLBACK_FIELDS=${detail.contract.fallbackFields.join(",")}\n`);
  }
  if (corrections.length > 0) {
    const last = corrections[corrections.length - 1];
    process.stdout.write(`LAST_CORRECTION_STEP_ID=${last.stepId}\n`);
    process.stdout.write(`LAST_CORRECTION_PHASE=${last.telemetry.phase}\n`);
    process.stdout.write(`LAST_CORRECTION_INTENT=${last.telemetry.classification.intent}\n`);
  }
  if (correctionPolicies.length > 0) {
    const lastPolicy = correctionPolicies[correctionPolicies.length - 1];
    process.stdout.write(`LAST_CORRECTION_POLICY_STEP_ID=${lastPolicy.stepId}\n`);
    process.stdout.write(`LAST_CORRECTION_POLICY_OK=${String(lastPolicy.policy.ok)}\n`);
    process.stdout.write(`LAST_CORRECTION_POLICY_SUMMARY=${lastPolicy.policy.summary}\n`);
  }

  if (detail.run.errorMessage) {
    process.stdout.write(`RUN_ERROR=${detail.run.errorMessage}\n`);
  }
}

function writeExecutionConfigMismatchSummary(details: unknown): boolean {
  if (!details || typeof details !== "object" || !("diff" in details) || !Array.isArray((details as { diff?: unknown }).diff)) {
    return false;
  }

  const diff = (details as { diff: Array<{ field?: unknown; persisted?: unknown; requested?: unknown }> }).diff;
  if (!diff.length) {
    return false;
  }

  process.stderr.write("Execution contract mismatch:\n");
  for (const entry of diff) {
    process.stderr.write(
      `  - ${String(entry.field || "unknown")}: persisted=${String(entry.persisted)} requested=${String(entry.requested)}\n`
    );
  }

  return true;
}

async function runKernelValidation(input: {
  client: ApiClient;
  projectId: string;
  runId: string;
  strictV1Ready: boolean;
}): Promise<KernelRunValidationResult> {
  return input.client.requestOk<KernelRunValidationResult>(
    "POST",
    `/api/projects/${input.projectId}/agent/runs/${input.runId}/validate`,
    {
      strictV1Ready: input.strictV1Ready
    }
  );
}

async function requestGovernanceDecision(input: {
  client: ApiClient;
  projectId: string;
  runId: string;
  strictV1Ready: boolean;
}): Promise<GovernanceDecisionPayload> {
  return input.client.requestOk<GovernanceDecisionPayload>(
    "POST",
    `/api/projects/${input.projectId}/governance/decision`,
    {
      runId: input.runId,
      strictV1Ready: input.strictV1Ready
    }
  );
}

function kernelRunHasStrictV1Ready(detail: KernelRunDetail): boolean {
  const validationResult =
    detail.run.validationResult && typeof detail.run.validationResult === "object" && !Array.isArray(detail.run.validationResult)
      ? detail.run.validationResult
      : null;
  const v1Ready =
    validationResult &&
    typeof validationResult.v1Ready === "object" &&
    validationResult.v1Ready !== null &&
    !Array.isArray(validationResult.v1Ready)
      ? (validationResult.v1Ready as Record<string, unknown>)
      : null;

  return typeof v1Ready?.ok === "boolean";
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
  const timeoutMs = typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? input.timeoutMs : 180_000;
  const startedAt = Date.now();
  let lastSignature = "";

  while (Date.now() - startedAt < timeoutMs) {
    const detail = await input.client.requestOk<KernelRunDetail>("GET", `/api/projects/${input.projectId}/agent/runs/${input.runId}`);

    const run = detail.run;
    const correctionCount = detail.telemetry?.corrections.length || 0;
    const signature = `${run.status}|${run.currentStepIndex}|${detail.steps.length}|${correctionCount}`;

    if (signature !== lastSignature) {
      writeKernelRunProgress(detail, input.verbose);
      lastSignature = signature;
    }

    if (run.status === "complete" || run.status === "failed" || run.status === "cancelled") {
      return detail;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new RunWaitTimeoutError(`Timed out waiting for kernel run ${input.runId} to reach terminal status.`, timeoutMs);
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
  const wait = optionFlag(input.options, "wait");
  const waitMode = parseWaitMode(input.options);
  const waitTimeoutMs = optionInt(input.options, "wait-timeout-ms");
  const waitNodeId = optionString(input.options, "wait-node-id");
  const profile = parseRunProfile(input.options);
  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);
  const provider = optionString(input.options, "provider");
  const model = optionString(input.options, "model");
  const executionConfigPayload = buildExecutionConfigPayload({
    profile,
    options: input.options
  });

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
    ...(model ? { model } : {}),
    ...executionConfigPayload
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

  if (!wait) {
    return started.run.status === "failed" || started.run.status === "cancelled" ? 1 : 0;
  }

  try {
    let finalDetail: KernelRunDetail;

    if (waitMode === "remote") {
      finalDetail = await pollKernelRun({
        client,
        projectId: projectContext.projectId,
        runId: started.run.id,
        verbose: input.verbose,
        timeoutMs: waitTimeoutMs
      });
    } else {
      if (!process.env.DATABASE_URL) {
        throw new Error("--wait-mode local requires DATABASE_URL. Set DATABASE_URL or use --wait-mode remote.");
      }

      const store = new AppStore();
      await store.initialize();

      try {
        const project = await store.getProject(projectContext.projectId);
        if (!project) {
          throw new Error(`Project not found: ${projectContext.projectId}`);
        }

        const kernel = new AgentKernel({
          store,
          providers: new ProviderRegistry()
        });

        const detail = await waitForRunTerminal({
          kernel,
          store,
          projectId: projectContext.projectId,
          runId: started.run.id,
          project,
          requestId: `cli-run-wait:${randomUUID().slice(0, 8)}`,
          mode: "local",
          nodeId: waitNodeId,
          timeoutMs: waitTimeoutMs,
          onUpdate: (nextDetail) => writeKernelRunProgress(nextDetail as KernelRunDetail, input.verbose)
        });
        finalDetail = detail as KernelRunDetail;
      } finally {
        await store.close();
      }
    }

    writeKernelRunStatus({
      projectId: projectContext.projectId,
      runId: started.run.id,
      detail: finalDetail
    });
    return finalDetail.run.status === "complete" ? 0 : 1;
  } catch (error) {
    if (error instanceof RunWaitTimeoutError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

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

  writeKernelRunStatus({ projectId, runId, detail });

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
  const correctionPolicies = detail.telemetry?.correctionPolicies || [];
  process.stdout.write(
    `KERNEL_RUN_LOGS run=${runId} status=${detail.run.status} corrections=${corrections.length} correctionPolicies=${correctionPolicies.length}\n`
  );

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

    if (step.correctionPolicy) {
      process.stdout.write(
        `  correction-policy ok=${String(step.correctionPolicy.ok)} blocking=${step.correctionPolicy.blockingCount}` +
          ` warning=${step.correctionPolicy.warningCount} summary=${step.correctionPolicy.summary}\n`
      );
    }

    if (input.verbose) {
      if (step.correctionTelemetry) {
        process.stdout.write(`${JSON.stringify(step.correctionTelemetry, null, 2)}\n`);
      }
      if (step.correctionPolicy) {
        process.stdout.write(`${JSON.stringify(step.correctionPolicy, null, 2)}\n`);
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

  const profile = parseOptionalRunProfile(input.options);
  const overrideExecutionConfig = optionFlag(input.options, "override-execution-config");
  const fork = optionFlag(input.options, "fork");
  const executionConfigPayload = buildExecutionConfigPayload({
    profile,
    options: input.options
  });

  const detail = await client.requestOk<KernelRunDetail>("POST", `/api/projects/${projectId}/agent/runs/${runId}/resume`, {
    ...executionConfigPayload,
    ...(overrideExecutionConfig ? { overrideExecutionConfig: true } : {}),
    ...(fork ? { fork: true } : {})
  });

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: detail.run.id
  });

  process.stdout.write(`PROJECT_ID=${projectId}\n`);
  if (fork && detail.run.id !== runId) {
    process.stdout.write(`SOURCE_RUN_ID=${runId}\n`);
  }
  process.stdout.write(`RUN_ID=${detail.run.id}\n`);
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
  const strictV1Ready = optionFlag(input.options, "strict-v1-ready");
  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine: "kernel"
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);
  const result = await runKernelValidation({
    client,
    projectId,
    runId,
    strictV1Ready
  });

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
  if (result.v1Ready) {
    process.stdout.write(`V1_READY_OK=${String(result.v1Ready.ok)}\n`);
    process.stdout.write(`V1_READY_VERDICT=${result.v1Ready.verdict}\n`);
    process.stdout.write(`V1_READY_TARGET=${result.v1Ready.target}\n`);
    process.stdout.write(`V1_READY_GENERATED_AT=${result.v1Ready.generatedAt}\n`);
  }

  if (input.verbose) {
    for (const check of result.validation.checks) {
      process.stdout.write(`check id=${check.id} status=${check.status} message=${check.message}\n`);
    }
    if (result.v1Ready) {
      for (const check of result.v1Ready.checks) {
        process.stdout.write(`v1-ready check id=${check.id} status=${check.status} message=${check.message}\n`);
      }
    }
  }

  if (!result.validation.ok) {
    return 1;
  }

  if (strictV1Ready) {
    return result.v1Ready?.ok ? 0 : 1;
  }

  return 0;
}

async function handleGate(input: {
  configPath: string;
  config: CliConfig;
  options: Record<string, string | boolean>;
  verbose: boolean;
}): Promise<number> {
  const strictV1Ready = optionFlag(input.options, "strict-v1-ready");
  const outputPath = optionString(input.options, "output");
  const { projectId, runId } = resolveProjectAndRunId({
    config: input.config,
    options: input.options,
    engine: "kernel"
  });

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);
  const currentDetail = await client.requestOk<KernelRunDetail>("GET", `/api/projects/${projectId}/agent/runs/${runId}`);

  const needsValidation =
    currentDetail.run.validationStatus !== "passed" || (strictV1Ready && !kernelRunHasStrictV1Ready(currentDetail));

  if (needsValidation) {
    try {
      await runKernelValidation({
        client,
        projectId,
        runId,
        strictV1Ready
      });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
    }
  }

  const decision = await requestGovernanceDecision({
    client,
    projectId,
    runId,
    strictV1Ready
  });
  await persistGovernanceDecision({
    decision
  });

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    lastKernelRunId: runId
  });

  const serialized = `${JSON.stringify(decision, null, 2)}\n`;
  process.stdout.write(serialized);

  if (outputPath) {
    const resolvedOutputPath = path.resolve(outputPath);
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, serialized, "utf8");
  }

  return decision.decision === "PASS" ? 0 : 1;
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
  const strictV1Ready = optionFlag(input.options, "strict-v1-ready");
  const runId = optionString(input.options, "run") || input.config.lastKernelRunId;

  if (!runId) {
    throw new Error("promote requires --run <runId> or a previously used kernel run.");
  }

  const jar = new CookieJar(input.config.cookies);
  const client = new ApiClient(input.config.apiBaseUrl, jar, input.verbose);

  if (strictV1Ready) {
    const validation = await runKernelValidation({
      client,
      projectId,
      runId,
      strictV1Ready: true
    });

    process.stdout.write(`PROMOTE_PREFLIGHT_PROJECT_ID=${projectId}\n`);
    process.stdout.write(`PROMOTE_PREFLIGHT_RUN_ID=${runId}\n`);
    process.stdout.write(`PROMOTE_PREFLIGHT_VALIDATION_OK=${String(validation.validation.ok)}\n`);
    process.stdout.write(`PROMOTE_PREFLIGHT_BLOCKING_COUNT=${validation.validation.blockingCount}\n`);
    process.stdout.write(`PROMOTE_PREFLIGHT_WARNING_COUNT=${validation.validation.warningCount}\n`);
    process.stdout.write(`PROMOTE_PREFLIGHT_VALIDATION_SUMMARY=${validation.validation.summary}\n`);
    process.stdout.write(`PROMOTE_PREFLIGHT_V1_READY_OK=${String(validation.v1Ready?.ok || false)}\n`);
    process.stdout.write(`PROMOTE_PREFLIGHT_V1_READY_VERDICT=${validation.v1Ready?.verdict || "NO"}\n`);

    if (input.verbose) {
      for (const check of validation.validation.checks) {
        process.stdout.write(`preflight check id=${check.id} status=${check.status} message=${check.message}\n`);
      }
      if (validation.v1Ready) {
        for (const check of validation.v1Ready.checks) {
          process.stdout.write(`preflight v1-ready check id=${check.id} status=${check.status} message=${check.message}\n`);
        }
      }
    }

    if (!validation.validation.ok || !validation.v1Ready?.ok) {
      process.stderr.write(
        `strict v1-ready preflight failed. Run 'deeprun validate --project ${projectId} --run ${runId} --strict-v1-ready' and resolve blockers before promote.\n`
      );
      return 1;
    }
  }

  const result = await client.requestOk<{
    deployment: {
      id: string;
      status: string;
      publicUrl: string;
      subdomain: string;
      customDomain: string | null;
    };
  }>("POST", `/api/projects/${projectId}/deployments`, {
    runId,
    customDomain,
    containerPort
  });

  await writeConfig(input.configPath, {
    ...input.config,
    cookies: jar.toObject(),
    lastProjectId: projectId,
    ...(runId ? { lastKernelRunId: runId } : {})
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
      case "gate": {
        const config = ensureConfig(existingConfig);
        process.exitCode = await handleGate({
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
    if (error instanceof ApiError && error.message.startsWith("Execution config mismatch.")) {
      const wroteSummary = writeExecutionConfigMismatchSummary(error.details);
      process.stderr.write(`${error.message}\n`);
      if (error.details && !wroteSummary) {
        process.stderr.write(`Details: ${JSON.stringify(error.details)}\n`);
      }
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
