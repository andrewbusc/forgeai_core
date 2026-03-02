import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import {
  buildExecutionContract,
  buildExecutionContractMaterial,
  EXECUTION_CONFIG_SCHEMA_VERSION,
  hashExecutionContractMaterial
} from "../agent/execution-contract.js";
import { AgentKernel } from "../agent/kernel.js";
import { drainComputeQueue } from "./helpers/queue-drain.js";
import { AppStore } from "../lib/project-store.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Agent kernel route integration tests require DATABASE_URL or TEST_DATABASE_URL."
  );
}

const requiredDatabaseUrl: string = databaseUrl;

function governanceExecutionConfig(profile: "full" | "ci" | "smoke" = "ci") {
  if (profile === "ci") {
    return {
      schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
      profile: "ci" as const,
      lightValidationMode: "off" as const,
      heavyValidationMode: "off" as const,
      maxRuntimeCorrectionAttempts: 0,
      maxHeavyCorrectionAttempts: 0,
      correctionPolicyMode: "warn" as const,
      correctionConvergenceMode: "warn" as const,
      plannerTimeoutMs: 5_000,
      maxFilesPerStep: 15,
      maxTotalDiffBytes: 400_000,
      maxFileBytes: 1_500_000,
      allowEnvMutation: false
    };
  }

  return {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "full" as const,
    lightValidationMode: "enforce" as const,
    heavyValidationMode: "enforce" as const,
    maxRuntimeCorrectionAttempts: 5,
    maxHeavyCorrectionAttempts: 3,
    correctionPolicyMode: "enforce" as const,
    correctionConvergenceMode: "enforce" as const,
    plannerTimeoutMs: 120_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  };
}

interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

interface JsonResponse<T = unknown> {
  status: number;
  body: T;
}

class CookieJar {
  private readonly values = new Map<string, string>();

  get headerValue(): string | undefined {
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

      const index = first.indexOf("=");
      if (index <= 0) {
        continue;
      }

      const name = first.slice(0, index).trim();
      const value = first.slice(index + 1).trim();

      if (!value) {
        this.values.delete(name);
      } else {
        this.values.set(name, value);
      }
    }
  }
}

async function acquireFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate free port for server test."));
        return;
      }

      const selected = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(selected);
      });
    });
  });
}

async function waitForHealthy(baseUrl: string, child: ReturnType<typeof spawn>): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 45_000;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Server process exited early with code ${String(child.exitCode)}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Continue polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for server health endpoint.");
}

async function startServer(
  envOverrides: Record<string, string | undefined> = {},
  options: { spawnWorker?: boolean } = {}
): Promise<RunningServer> {
  const port = await acquireFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const spawnWorker = options.spawnWorker !== false;
  const sharedEnv = {
    ...process.env,
    DATABASE_URL: requiredDatabaseUrl,
    NODE_ENV: "test",
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || "http://localhost",
    RATE_LIMIT_LOGIN_MAX: process.env.RATE_LIMIT_LOGIN_MAX || "100",
    RATE_LIMIT_GENERATION_MAX: process.env.RATE_LIMIT_GENERATION_MAX || "100",
    AGENT_LIGHT_VALIDATION_MODE: "off",
    AGENT_HEAVY_VALIDATION_MODE: "off",
    AGENT_HEAVY_INSTALL_DEPS: "false",
    ...envOverrides
  };

  const child = spawn(process.execPath, [tsxCliPath, "-r", "dotenv/config", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...sharedEnv,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let worker: ReturnType<typeof spawn> | null = null;

  if (process.env.TEST_DEBUG_SERVER_LOGS === "1") {
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  } else {
    child.stdout.on("data", () => undefined);
    child.stderr.on("data", () => undefined);
  }

  await waitForHealthy(baseUrl, child);

  if (spawnWorker) {
    worker = spawn(process.execPath, [tsxCliPath, "-r", "dotenv/config", "src/scripts/agent-job-worker.ts"], {
      cwd: process.cwd(),
      env: {
        ...sharedEnv,
        NODE_ID: `test-worker-${port}`,
        NODE_ROLE: "compute",
        WORKER_HEARTBEAT_MS: "1000",
        WORKER_POLL_MS: "100"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (process.env.TEST_DEBUG_SERVER_LOGS === "1") {
      worker.stdout?.on("data", (chunk) => process.stdout.write(chunk));
      worker.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    } else {
      worker.stdout?.on("data", () => undefined);
      worker.stderr?.on("data", () => undefined);
    }
  }

  return {
    baseUrl,
    async stop() {
      for (const processChild of [worker, child]) {
        if (!processChild) {
          continue;
        }
        if (processChild.exitCode !== null) {
          continue;
        }

        processChild.kill("SIGTERM");
        await Promise.race([
          once(processChild, "exit"),
          new Promise((resolve) => setTimeout(resolve, 4_000))
        ]);

        if (processChild.exitCode === null) {
          processChild.kill("SIGKILL");
          await once(processChild, "exit").catch(() => undefined);
        }
      }
    }
  };
}

async function waitForRunTerminal(input: {
  baseUrl: string;
  jar: CookieJar;
  projectId: string;
  runId: string;
}): Promise<{
  run: { id: string; status: string };
  steps: Array<{ id: string }>;
  telemetry?: { corrections?: unknown[] };
}> {
  const startedAt = Date.now();
  const timeoutMs = 20_000;
  const activeStatuses = new Set(["queued", "running", "correcting", "optimizing", "validating"]);

  while (Date.now() - startedAt < timeoutMs) {
    const detail = await requestJson<{
      run: { id: string; status: string };
      steps: Array<{ id: string }>;
      telemetry?: { corrections?: unknown[] };
    }>({
      baseUrl: input.baseUrl,
      jar: input.jar,
      method: "GET",
      path: `/api/projects/${input.projectId}/agent/runs/${input.runId}`
    });

    if (detail.status === 200 && !activeStatuses.has(detail.body.run.status)) {
      return detail.body;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for run ${input.runId} to reach a terminal status.`);
}

async function requestJson<T = unknown>(input: {
  baseUrl: string;
  jar: CookieJar;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
}): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = {};
  if (input.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const cookieHeader = input.jar.headerValue;
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });

  input.jar.ingest(response.headers);
  const text = await response.text();

  let body: unknown = {};
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return {
    status: response.status,
    body: body as T
  };
}

async function registerUser(input: {
  baseUrl: string;
  jar: CookieJar;
  suffix: string;
}): Promise<{ userId: string; workspaceId: string }> {
  const response = await requestJson<{
    user?: { id: string };
    activeWorkspaceId?: string;
  }>({
    baseUrl: input.baseUrl,
    jar: input.jar,
    method: "POST",
    path: "/api/auth/register",
    body: {
      name: `Kernel Route Tester ${input.suffix}`,
      email: `kernel-routes-${input.suffix}@example.com`,
      password: "Password123!",
      organizationName: `Kernel Route Org ${input.suffix}`,
      workspaceName: `Kernel Route Workspace ${input.suffix}`
    }
  });

  assert.equal(response.status, 201);
  assert.ok(response.body.user?.id);
  assert.ok(response.body.activeWorkspaceId);

  return {
    userId: response.body.user?.id as string,
    workspaceId: response.body.activeWorkspaceId as string
  };
}

async function createProject(input: {
  baseUrl: string;
  jar: CookieJar;
  workspaceId: string;
  suffix: string;
}): Promise<{
  id: string;
  orgId: string;
  workspaceId: string;
  initialCommitHash: string | null;
}> {
  const response = await requestJson<{
    project: {
      id: string;
      orgId: string;
      workspaceId: string;
      history: Array<{ commitHash?: string }>;
    };
  }>({
    baseUrl: input.baseUrl,
    jar: input.jar,
    method: "POST",
    path: "/api/projects",
    body: {
      workspaceId: input.workspaceId,
      name: `Kernel Route Project ${input.suffix}`,
      description: "Kernel route integration test project",
      templateId: "agent-workflow"
    }
  });

  assert.equal(response.status, 201);
  assert.ok(response.body.project.id);

  return {
    id: response.body.project.id,
    orgId: response.body.project.orgId,
    workspaceId: response.body.project.workspaceId,
    initialCommitHash: response.body.project.history[0]?.commitHash || null
  };
}

test("kernel run endpoints support start/list/detail", async () => {
  const server = await startServer({}, { spawnWorker: false });
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });

    const started = await requestJson<{
      run: { id: string; status: string };
      executionConfigSummary?: { profile?: string; schemaVersion?: number };
      steps: Array<{ id: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs`,
      body: {
        goal: `Kernel route run ${suffix}`,
        provider: "mock",
        profile: "ci"
      }
    });

    assert.equal(started.status, 202);
    assert.ok(started.body.run.id);
    assert.equal(started.body.run.status, "queued");
    assert.equal(started.body.executionConfigSummary?.profile, "ci");
    assert.equal(started.body.executionConfigSummary?.schemaVersion, 1);

    const runId = started.body.run.id;

    const kernel = new AgentKernel({ store });
    const drainedStart = await drainComputeQueue({
      store,
      kernel,
      nodeId: `route-drain-start-${suffix}`,
      maxJobs: 20,
      leaseSeconds: 60,
      runIds: [runId]
    });
    assert.ok(drainedStart.processedJobs.some((entry) => entry.runId === runId));

    const terminal = await waitForRunTerminal({
      baseUrl: server.baseUrl,
      jar,
      projectId: project.id,
      runId
    });
    assert.ok(terminal.run.status === "complete" || terminal.run.status === "failed");
    assert.ok(terminal.steps.length >= 1);

    const listed = await requestJson<{
      runs: Array<{ id: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${project.id}/agent/runs`
    });

    assert.equal(listed.status, 200);
    assert.equal(listed.body.runs.some((run) => run.id === runId), true);

    assert.equal(terminal.run.id, runId);
    assert.ok(Array.isArray(terminal.telemetry?.corrections || []));

    const detailAfterValidate = await requestJson<{
      run: {
        id: string;
      };
      executionConfigSummary?: { profile?: string; schemaVersion?: number };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${project.id}/agent/runs/${runId}`
    });
    assert.equal(detailAfterValidate.status, 200);
    assert.equal(detailAfterValidate.body.run.id, runId);
    assert.equal(detailAfterValidate.body.executionConfigSummary?.profile, "ci");
    assert.equal(detailAfterValidate.body.executionConfigSummary?.schemaVersion, 1);
  } finally {
    await store.close();
    await server.stop();
  }
});

test("kernel resume route rejects execution config drift unless explicitly forked", async () => {
  const server = await startServer({}, { spawnWorker: false });
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });

    const started = await requestJson<{
      run: { id: string; status: string };
      steps: Array<{ id: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs`,
      body: {
        goal: `Kernel resume contract ${suffix}`,
        provider: "mock"
      }
    });

    assert.equal(started.status, 202);
    const runId = started.body.run.id;

    const kernel = new AgentKernel({ store });
    const drainedStart = await drainComputeQueue({
      store,
      kernel,
      nodeId: `route-contract-drain-${suffix}`,
      maxJobs: 20,
      leaseSeconds: 60,
      runIds: [runId]
    });
    assert.ok(drainedStart.processedJobs.some((entry) => entry.runId === runId));

    const replayReady = await store.updateAgentRun(runId, {
      status: "failed",
      currentStepIndex: 1,
      lastStepId: null,
      errorMessage: "resume contract seed",
      finishedAt: null
    });
    assert.equal(replayReady?.status, "failed");

    const mismatch = await requestJson<{ error: string; details?: { diff?: Array<{ field: string }> } }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs/${runId}/resume`,
      body: {
        profile: "ci"
      }
    });

    assert.equal(mismatch.status, 409);
    assert.match(mismatch.body.error, /Execution config mismatch/);
    assert.deepEqual(
      mismatch.body.details?.diff?.map((entry) => entry.field),
      [
        "profile",
        "maxRuntimeCorrectionAttempts",
        "maxHeavyCorrectionAttempts",
        "correctionPolicyMode",
        "correctionConvergenceMode",
        "plannerTimeoutMs"
      ]
    );

    const forked = await requestJson<{
      run: { id: string; status: string };
      queuedJob?: { id: string };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs/${runId}/resume`,
      body: {
        profile: "ci",
        fork: true
      }
    });

    assert.equal(forked.status, 201);
    assert.notEqual(forked.body.run.id, runId);
    assert.equal(forked.body.run.status, "queued");
    assert.ok(forked.body.queuedJob?.id);

    const sourceRun = await store.getAgentRun(runId);
    const forkRun = await store.getAgentRun(forked.body.run.id);
    const sourceProfile = (sourceRun?.metadata as { executionConfig?: { profile?: string } }).executionConfig?.profile;
    const forkProfile = (forkRun?.metadata as { executionConfig?: { profile?: string } }).executionConfig?.profile;

    assert.equal(sourceProfile, "full");
    assert.equal(forkProfile, "ci");
  } finally {
    await store.close();
    await server.stop();
  }
});

test("kernel queue contract requires worker heartbeat and completes claimed run jobs through drain helper", async () => {
  const server = await startServer({}, { spawnWorker: false });
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });

    const started = await requestJson<{
      run: { id: string; status: string };
      queuedJob?: { id: string; status: string; assignedNode?: string | null };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs`,
      body: {
        goal: `Kernel queue contract run ${suffix}`,
        provider: "mock"
      }
    });

    assert.equal(started.status, 202);
    assert.equal(started.body.run.status, "queued");
    assert.ok(started.body.queuedJob?.id);

    const runId = started.body.run.id;
    const queuedJob = (await store.listRunJobs(20)).find((entry) => entry.runId === runId);
    assert.ok(queuedJob);
    assert.equal(queuedJob?.status, "queued");

    const unclaimed = await store.claimNextRunJob({
      nodeId: `queue-contract-pre-${suffix}`,
      targetRole: "compute",
      workerCapabilities: {},
      leaseSeconds: 60
    });
    assert.equal(unclaimed, undefined);

    const kernel = new AgentKernel({ store });
    const drained = await drainComputeQueue({
      store,
      kernel,
      nodeId: `queue-contract-worker-${suffix}`,
      maxJobs: 20,
      leaseSeconds: 60,
      runIds: [runId]
    });

    assert.ok(drained.processedJobs.some((entry) => entry.runId === runId));

    const workers = await store.listWorkerNodes(10);
    const worker = workers.find((entry) => entry.nodeId === `queue-contract-worker-${suffix}`);
    assert.ok(worker);
    assert.equal(worker?.role, "compute");
    assert.equal(worker?.status, "online");

    const completedJob = (await store.listRunJobs(20)).find((entry) => entry.runId === runId);
    assert.ok(completedJob);
    assert.equal(completedJob?.assignedNode, `queue-contract-worker-${suffix}`);
    assert.ok(completedJob?.status === "complete" || completedJob?.status === "failed");
    assert.equal(typeof completedJob?.leaseExpiresAt === "string" || completedJob?.leaseExpiresAt === null, true);

    const detail = await requestJson<{
      run: { id: string; status: string };
      stubDebt?: {
        markerCount: number;
        openCount: number;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${project.id}/agent/runs/${runId}`
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.run.id, runId);
    assert.ok(detail.body.run.status === "complete" || detail.body.run.status === "failed");
    assert.equal(typeof detail.body.stubDebt?.markerCount, "number");
    assert.equal(typeof detail.body.stubDebt?.openCount, "number");
  } finally {
    await store.close();
    await server.stop();
  }
});

test("kernel run detail exposes correction policy telemetry contract", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });

    const now = new Date().toISOString();
    const seededRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Synthetic correction policy telemetry run",
      providerId: "mock",
      status: "failed",
      currentStepIndex: 1,
      plan: {
        goal: "Synthetic correction policy telemetry run",
        steps: [
          {
            id: "runtime-correction-1",
            type: "modify",
            tool: "write_file",
            input: {
              _deepCorrection: {
                phase: "goal",
                attempt: 1,
                failedStepId: "step-verify-runtime",
                classification: {
                  intent: "runtime_boot",
                  failedChecks: [],
                  failureKinds: ["runtime"],
                  rationale: "synthetic test fixture"
                },
                constraint: {
                  intent: "runtime_boot",
                  maxFiles: 6,
                  maxTotalDiffBytes: 120000,
                  allowedPathPrefixes: ["src/"],
                  guidance: ["Fix startup only"]
                },
                createdAt: now
              }
            }
          }
        ]
      },
      errorMessage: "Correction policy violation: synthetic fixture",
      finishedAt: now
    });

    await store.createAgentStep({
      runId: seededRun.id,
      projectId: project.id,
      stepIndex: 0,
      stepId: "runtime-correction-1",
      type: "modify",
      tool: "write_file",
      inputPayload: {
        path: "src/server.ts",
        content: "// synthetic correction\n",
        _deepCorrection: {
          phase: "goal",
          attempt: 1,
          failedStepId: "step-verify-runtime",
          classification: {
            intent: "runtime_boot",
            failedChecks: [],
            failureKinds: ["runtime"],
            rationale: "synthetic test fixture"
          },
          constraint: {
            intent: "runtime_boot",
            maxFiles: 6,
            maxTotalDiffBytes: 120000,
            allowedPathPrefixes: ["src/"],
            guidance: ["Fix startup only"]
          },
          createdAt: now
        }
      },
      outputPayload: {
        proposedChanges: [
          {
            path: "src/server.ts",
            type: "update"
          }
        ],
        correctionPolicy: {
          ok: false,
          mode: "enforce",
          blockingCount: 1,
          warningCount: 0,
          summary: "failed rules: correction_attempt_suffix_match; blocking=1; warnings=0",
          violations: [
            {
              ruleId: "correction_attempt_suffix_match",
              severity: "error",
              message: "attempt mismatch"
            }
          ]
        }
      },
      status: "failed",
      errorMessage: "Correction policy violation: synthetic fixture",
      commitHash: null,
      runtimeStatus: "failed",
      startedAt: now,
      finishedAt: now
    });

    const detail = await requestJson<{
      run: { id: string };
      steps: Array<{
        stepId: string;
        correctionPolicy?: {
          ok: boolean;
          mode?: string;
          blockingCount: number;
          warningCount: number;
          summary: string;
          violations: Array<{ ruleId: string; severity: string; message: string }>;
        };
      }>;
      telemetry: {
        corrections: Array<{
          stepId: string;
          correctionPolicy?: {
            ok: boolean;
            summary: string;
          };
        }>;
        correctionPolicies: Array<{
          stepId: string;
          policy: {
            ok: boolean;
            mode?: string;
            blockingCount: number;
            warningCount: number;
            summary: string;
          };
        }>;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${project.id}/agent/runs/${seededRun.id}`
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.run.id, seededRun.id);
    assert.equal(detail.body.steps.length, 1);
    assert.equal(detail.body.steps[0]?.stepId, "runtime-correction-1");
    assert.equal(detail.body.steps[0]?.correctionPolicy?.ok, false);
    assert.equal(detail.body.steps[0]?.correctionPolicy?.mode, "enforce");
    assert.equal(detail.body.steps[0]?.correctionPolicy?.blockingCount, 1);
    assert.equal(detail.body.steps[0]?.correctionPolicy?.violations[0]?.ruleId, "correction_attempt_suffix_match");
    assert.equal(Array.isArray(detail.body.telemetry.correctionPolicies), true);
    assert.equal(detail.body.telemetry.correctionPolicies.length, 1);
    assert.equal(detail.body.telemetry.correctionPolicies[0]?.stepId, "runtime-correction-1");
    assert.equal(detail.body.telemetry.correctionPolicies[0]?.policy.ok, false);
    assert.equal(detail.body.telemetry.corrections[0]?.correctionPolicy?.ok, false);
  } finally {
    await server.stop();
  }
});

test("backend bootstrap endpoint creates canonical project and starts kernel run", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const bootstrapped = await requestJson<{
      project: {
        id: string;
        templateId: string;
        workspaceId: string;
        history: Array<{
          commitHash?: string;
          model?: string;
          metadata?: {
            source?: string;
            runId?: string;
            validation?: {
              ok?: boolean;
              blockingCount?: number;
              warningCount?: number;
              summary?: string;
            };
          };
        }>;
      };
      run: {
        run: {
          id: string;
          status: string;
        };
        steps: Array<{ id: string }>;
      };
      certification: {
        runId: string;
        stepId: string | null;
        targetPath: string;
        validatedAt: string;
        ok: boolean;
        blockingCount: number;
        warningCount: number;
        summary: string;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: "/api/projects/bootstrap/backend",
      body: {
        workspaceId: identity.workspaceId,
        name: `Bootstrap Route Project ${suffix}`,
        description: "bootstrap route integration test project",
        goal: `Build backend ${suffix}`,
        provider: "mock"
      }
    });

    assert.equal(bootstrapped.status, 201);
    assert.ok(bootstrapped.body.project.id);
    assert.equal(bootstrapped.body.project.workspaceId, identity.workspaceId);
    assert.equal(bootstrapped.body.project.templateId, "canonical-backend");
    assert.equal(
      bootstrapped.body.project.history.some((entry) => typeof entry.commitHash === "string" && entry.commitHash.length > 0),
      true
    );
    assert.equal(bootstrapped.body.project.history[0]?.model, "validation");
    assert.equal(bootstrapped.body.project.history[0]?.metadata?.source, "bootstrap");
    assert.equal(bootstrapped.body.project.history[0]?.metadata?.runId, bootstrapped.body.run.run.id);
    assert.ok(bootstrapped.body.run.run.id);
    assert.equal(bootstrapped.body.run.run.status, "complete");
    assert.ok(bootstrapped.body.run.steps.length >= 1);
    assert.equal(bootstrapped.body.certification.runId, bootstrapped.body.run.run.id);
    assert.equal(typeof bootstrapped.body.certification.ok, "boolean");
    assert.equal(typeof bootstrapped.body.certification.blockingCount, "number");
    assert.equal(typeof bootstrapped.body.certification.warningCount, "number");
    assert.ok(bootstrapped.body.certification.summary.length > 0);
    assert.ok(bootstrapped.body.certification.targetPath.length > 0);
    assert.equal(bootstrapped.body.project.history[0]?.metadata?.validation?.ok, bootstrapped.body.certification.ok);
    assert.equal(
      bootstrapped.body.project.history[0]?.metadata?.validation?.blockingCount,
      bootstrapped.body.certification.blockingCount
    );

    const hydratedRun = await requestJson<{
      run: {
        id: string;
        validationStatus?: string | null;
        validationResult?: {
          targetPath?: string;
          validation?: {
            ok?: boolean;
            blockingCount?: number;
          };
        } | null;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${bootstrapped.body.project.id}/agent/runs/${bootstrapped.body.run.run.id}`
    });

    assert.equal(hydratedRun.status, 200);
    assert.equal(hydratedRun.body.run.validationStatus, bootstrapped.body.certification.ok ? "passed" : "failed");
    assert.equal(
      hydratedRun.body.run.validationResult?.validation?.ok,
      bootstrapped.body.certification.ok
    );
    assert.equal(
      hydratedRun.body.run.validationResult?.validation?.blockingCount,
      bootstrapped.body.certification.blockingCount
    );
    assert.equal(
      hydratedRun.body.run.validationResult?.targetPath,
      bootstrapped.body.certification.targetPath
    );
  } finally {
    await server.stop();
  }
});

test("deployment route requires passing validation before promotion", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });
    const storedProject = await store.getProject(project.id);
    assert.ok(storedProject, "Expected persisted project record for deployment gating test.");

    assert.ok(project.initialCommitHash, "Expected scaffold commit hash for deployment gating test.");
    const commitHash = project.initialCommitHash as string;
    const seededRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Seeded deploy candidate run",
      providerId: "mock",
      status: "complete",
      currentStepIndex: 0,
      plan: {
        goal: "Seeded deploy candidate run",
        steps: []
      },
      baseCommitHash: commitHash,
      currentCommitHash: commitHash,
      lastValidCommitHash: commitHash
    });

    const missingRunId = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/deployments`,
      body: {}
    });

    assert.equal(missingRunId.status, 400);
    assert.ok((missingRunId.body.error || "").length > 0);

    const blocked = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/deployments`,
      body: {
        runId: seededRun.id
      }
    });

    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error || "", /not been validated/i);

    const validatedAt = new Date().toISOString();
    await store.updateAgentRun(seededRun.id, {
      validationStatus: "passed",
      validationResult: {
        targetPath: store.getProjectWorkspacePath(storedProject),
        validation: {
          ok: true,
          blockingCount: 0,
          warningCount: 0,
          summary: "all checks passed",
          checks: []
        }
      },
      validatedAt
    });

    const allowed = await requestJson<{
      deployment: {
        id: string;
        projectId: string;
        runId?: string | null;
        commitHash?: string | null;
        status: string;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/deployments`,
      body: {
        runId: seededRun.id
      }
    });

    assert.equal(allowed.status, 202);
    assert.ok(allowed.body.deployment.id);
    assert.equal(allowed.body.deployment.projectId, project.id);
    assert.equal(allowed.body.deployment.runId, seededRun.id);
    assert.equal(allowed.body.deployment.commitHash, commitHash);
  } finally {
    await server.stop();
  }
});

test("governance decision endpoint returns PASS payload for promotable validated run", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });
    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });
    const storedProject = await store.getProject(project.id);
    assert.ok(storedProject);
    const executionConfig = governanceExecutionConfig("ci");
    const contract = buildExecutionContract(executionConfig);
    const commitHash = project.initialCommitHash as string;
    const seededRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Governance decision pass candidate",
      providerId: "mock",
      model: "mock-v1",
      status: "complete",
      currentStepIndex: 0,
      plan: {
        goal: "Governance decision pass candidate",
        steps: []
      },
      baseCommitHash: commitHash,
      currentCommitHash: commitHash,
      lastValidCommitHash: commitHash,
      metadata: {
        executionConfig,
        executionContractSchemaVersion: contract.schemaVersion,
        executionContractHash: contract.hash,
        executionContractMaterial: contract.material,
        effectiveExecutionConfig: contract.effectiveConfig,
        executionContractFallbackUsed: false,
        executionContractFallbackFields: []
      },
    });
    const run =
      (await store.updateAgentRun(seededRun.id, {
        validationStatus: "passed",
        validationResult: {
          targetPath: store.getProjectWorkspacePath(storedProject),
          validation: {
            ok: true,
            blockingCount: 0,
            warningCount: 0,
            summary: "all checks passed",
            checks: []
          }
        },
        validatedAt: new Date().toISOString()
      })) || seededRun;

    const decision = await requestJson<{
      decisionSchemaVersion: number;
      decisionHash: string;
      decision: string;
      reasonCodes: string[];
      runId: string;
      contract: {
        schemaVersion: number;
        hash: string;
        determinismPolicyVersion: number;
        plannerPolicyVersion: number;
        correctionRecipeVersion: number;
        validationPolicyVersion: number;
        randomnessSeed: string;
      };
      reasons: Array<{ code: string }>;
      artifactRefs: Array<{ kind: string; path: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/governance/decision`,
      body: {
        runId: run.id
      }
    });

    assert.equal(decision.status, 200);
    assert.equal(decision.body.decisionSchemaVersion, 2);
    assert.equal(decision.body.decisionHash.length, 64);
    assert.equal(decision.body.decision, "PASS");
    assert.equal(decision.body.runId, run.id);
    assert.equal(decision.body.contract.schemaVersion, contract.schemaVersion);
    assert.equal(decision.body.contract.hash, contract.hash);
    assert.equal(decision.body.contract.determinismPolicyVersion >= 1, true);
    assert.deepEqual(decision.body.reasonCodes, []);
    assert.deepEqual(decision.body.reasons, []);
    assert.equal(decision.body.artifactRefs.some((entry) => entry.kind === "validation_target"), true);
  } finally {
    await server.stop();
  }
});

test("governance decision endpoint returns FAIL payload with strict machine-readable reason codes", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });
    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });
    const storedProject = await store.getProject(project.id);
    assert.ok(storedProject);
    const executionConfig = governanceExecutionConfig("ci");
    const contract = buildExecutionContract(executionConfig);
    const commitHash = project.initialCommitHash as string;
    const seededRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Governance decision fail candidate",
      providerId: "mock",
      model: "mock-v1",
      status: "complete",
      currentStepIndex: 0,
      plan: {
        goal: "Governance decision fail candidate",
        steps: []
      },
      baseCommitHash: commitHash,
      currentCommitHash: commitHash,
      lastValidCommitHash: commitHash,
      metadata: {
        executionConfig,
        executionContractSchemaVersion: contract.schemaVersion,
        executionContractHash: contract.hash,
        executionContractMaterial: contract.material,
        effectiveExecutionConfig: contract.effectiveConfig,
        executionContractFallbackUsed: false,
        executionContractFallbackFields: []
      },
    });
    const run =
      (await store.updateAgentRun(seededRun.id, {
        validationStatus: "passed",
        validationResult: {
          targetPath: store.getProjectWorkspacePath(storedProject),
          validation: {
            ok: true,
            blockingCount: 0,
            warningCount: 0,
            summary: "all checks passed",
            checks: []
          },
          v1Ready: {
            ok: false,
            verdict: "NO",
            generatedAt: new Date().toISOString(),
            checks: [
              {
                id: "docker_boot",
                status: "fail",
                message: "container failed to boot"
              }
            ]
          }
        },
        validatedAt: new Date().toISOString()
      })) || seededRun;

    const decision = await requestJson<{
      decisionSchemaVersion: number;
      decisionHash: string;
      decision: string;
      reasonCodes: string[];
      reasons: Array<{ code: string; details?: Record<string, unknown> }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/governance/decision`,
      body: {
        runId: run.id,
        strictV1Ready: true
      }
    });

    assert.equal(decision.status, 200);
    assert.equal(decision.body.decisionSchemaVersion, 2);
    assert.equal(decision.body.decisionHash.length, 64);
    assert.equal(decision.body.decision, "FAIL");
    assert.equal(decision.body.reasonCodes.includes("RUN_V1_READY_FAILED"), true);
    assert.equal(decision.body.reasons.some((entry) => entry.code === "RUN_V1_READY_FAILED"), true);
  } finally {
    await server.stop();
  }
});

test("governance decision endpoint returns FAIL with UNSUPPORTED_CONTRACT for future contract material", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });
    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });
    const executionConfig = governanceExecutionConfig("ci");
    const unsupportedMaterial = {
      ...buildExecutionContractMaterial(executionConfig),
      correctionRecipeVersion: 999
    };
    const seededRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Governance unsupported contract candidate",
      providerId: "mock",
      model: "mock-v1",
      status: "failed",
      currentStepIndex: 0,
      plan: {
        goal: "Governance unsupported contract candidate",
        steps: []
      },
      errorMessage: "UNSUPPORTED_CONTRACT: Unsupported execution contract material: correctionRecipeVersion=999",
      metadata: {
        executionConfig,
        executionContractSchemaVersion: unsupportedMaterial.executionContractSchemaVersion,
        executionContractHash: hashExecutionContractMaterial(unsupportedMaterial),
        executionContractMaterial: unsupportedMaterial,
        effectiveExecutionConfig: executionConfig,
        executionContractFallbackUsed: false,
        executionContractFallbackFields: []
      }
    });

    const decision = await requestJson<{
      decisionSchemaVersion: number;
      decisionHash: string;
      decision: string;
      reasonCodes: string[];
      reasons: Array<{ code: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/governance/decision`,
      body: {
        runId: seededRun.id
      }
    });

    assert.equal(decision.status, 200);
    assert.equal(decision.body.decision, "FAIL");
    assert.equal(decision.body.decisionHash.length, 64);
    assert.equal(decision.body.reasonCodes.includes("UNSUPPORTED_CONTRACT"), true);
    assert.equal(decision.body.reasons.some((entry) => entry.code === "UNSUPPORTED_CONTRACT"), true);
  } finally {
    await server.stop();
  }
});

test("deployment route requires v1-ready report when strict promote gate is enabled", async () => {
  const server = await startServer({
    DEEPRUN_PROMOTE_REQUIRE_V1_READY: "true"
  });
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });
    const storedProject = await store.getProject(project.id);
    assert.ok(storedProject, "Expected persisted project record for strict deploy gating test.");
    assert.ok(project.initialCommitHash, "Expected scaffold commit hash for strict deploy gating test.");
    const commitHash = project.initialCommitHash as string;
    const strictRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Strict deploy candidate run",
      providerId: "mock",
      status: "complete",
      currentStepIndex: 0,
      plan: {
        goal: "Strict deploy candidate run",
        steps: []
      },
      baseCommitHash: commitHash,
      currentCommitHash: commitHash,
      lastValidCommitHash: commitHash
    });

    const validatedAt = new Date().toISOString();
    await store.updateAgentRun(strictRun.id, {
      validationStatus: "passed",
      validationResult: {
        targetPath: store.getProjectWorkspacePath(storedProject),
        validation: {
          ok: true,
          blockingCount: 0,
          warningCount: 0,
          summary: "all checks passed",
          checks: []
        }
      },
      validatedAt
    });

    const blocked = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/deployments`,
      body: {
        runId: strictRun.id
      }
    });

    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error || "", /v1-ready/i);
    await store.updateAgentRun(strictRun.id, {
      validationResult: {
        targetPath: store.getProjectWorkspacePath(storedProject),
        validation: {
          ok: true,
          blockingCount: 0,
          warningCount: 0,
          summary: "all checks passed",
          checks: []
        },
        v1Ready: {
          ok: true,
          verdict: "YES",
          generatedAt: new Date().toISOString(),
          checks: []
        }
      }
    });

    const allowed = await requestJson<{
      deployment: {
        id: string;
        projectId: string;
        status: string;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/deployments`,
      body: {
        runId: strictRun.id
      }
    });

    assert.equal(allowed.status, 202);
    assert.ok(allowed.body.deployment.id);
    assert.equal(allowed.body.deployment.projectId, project.id);
  } finally {
    await server.stop();
  }
});

test("fork endpoint works from committed step and branch lock blocks project mutations", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore();

  try {
    const identity = await registerUser({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const project = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId: identity.workspaceId,
      suffix
    });

    assert.ok(project.initialCommitHash, "Expected scaffold commit hash for fork seed test.");
    const commitHash = project.initialCommitHash as string;

    const sourceRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Synthetic fork source run",
      providerId: "mock",
      status: "complete",
      currentStepIndex: 1,
      plan: {
        goal: "Synthetic fork source run",
        steps: [
          {
            id: "seed-step-1",
            type: "modify",
            tool: "write_file",
            input: {
              path: "notes/seed.md",
              content: "seed"
            }
          },
          {
            id: "seed-step-2",
            type: "analyze",
            tool: "list_files",
            input: {
              path: "."
            }
          }
        ]
      },
      finishedAt: new Date().toISOString()
    });

    await store.createAgentStep({
      runId: sourceRun.id,
      projectId: project.id,
      stepIndex: 0,
      stepId: "seed-step-1",
      type: "modify",
      tool: "write_file",
      inputPayload: {
        path: "notes/seed.md",
        content: "seed"
      },
      outputPayload: {
        stagedFileCount: 1
      },
      status: "completed",
      commitHash,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    });

    const forked = await requestJson<{
      run: {
        id: string;
        currentStepIndex: number;
        status: string;
      };
      steps: unknown[];
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs/${sourceRun.id}/fork/seed-step-1`
    });

    assert.equal(forked.status, 201);
    assert.notEqual(forked.body.run.id, sourceRun.id);
    assert.equal(forked.body.run.currentStepIndex, 1);
    assert.equal(forked.body.run.status, "queued");
    assert.equal(Array.isArray(forked.body.steps), true);

    const activeRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Active run lock seed",
      providerId: "mock",
      status: "queued",
      currentStepIndex: 0,
      plan: {
        goal: "Active run lock seed",
        steps: [
          {
            id: "lock-step-1",
            type: "analyze",
            tool: "list_files",
            input: {
              path: "."
            }
          }
        ]
      }
    });

    const blockedFileEdit = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "PUT",
      path: `/api/projects/${project.id}/file`,
      body: {
        path: "README.md",
        content: "blocked"
      }
    });

    assert.equal(blockedFileEdit.status, 409);
    assert.match(blockedFileEdit.body.error || "", /blocked while an agent run is active/i);

    const blockedGenerate = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/generate`,
      body: {
        prompt: "blocked",
        provider: "mock"
      }
    });

    assert.equal(blockedGenerate.status, 409);
    assert.match(blockedGenerate.body.error || "", /blocked while an agent run is active/i);

    const blockedStart = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs`,
      body: {
        goal: "blocked",
        provider: "mock"
      }
    });

    assert.equal(blockedStart.status, 409);
    assert.match(blockedStart.body.error || "", /blocked while an agent run is active/i);

    const blockedFork = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs/${activeRun.id}/fork/lock-step-1`
    });

    assert.equal(blockedFork.status, 409);
    assert.match(blockedFork.body.error || "", /blocked while an agent run is active/i);

    const runningRun = await store.createAgentRun({
      projectId: project.id,
      orgId: project.orgId,
      workspaceId: project.workspaceId,
      createdByUserId: identity.userId,
      goal: "Running validation conflict",
      providerId: "mock",
      status: "running",
      currentStepIndex: 0,
      plan: {
        goal: "Running validation conflict",
        steps: [
          {
            id: "running-step-1",
            type: "analyze",
            tool: "list_files",
            input: {
              path: "."
            }
          }
        ]
      }
    });

    const validateConflict = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs/${runningRun.id}/validate`
    });

    assert.equal(validateConflict.status, 409);
    assert.match(validateConflict.body.error || "", /still running/i);
  } finally {
    await store.close();
    await server.stop();
  }
});
