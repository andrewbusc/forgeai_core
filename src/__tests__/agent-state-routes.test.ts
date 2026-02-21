import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Agent state route integration tests require DATABASE_URL or TEST_DATABASE_URL."
  );
}

const requiredDatabaseUrl: string = databaseUrl;

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
  const timeoutMs = 20_000;

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

async function startServer(envOverrides: Record<string, string | undefined> = {}): Promise<RunningServer> {
  const port = await acquireFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

  const child = spawn(process.execPath, [tsxCliPath, "-r", "dotenv/config", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: requiredDatabaseUrl,
      PORT: String(port),
      NODE_ENV: "test",
      CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || "http://localhost",
      RATE_LIMIT_LOGIN_MAX: process.env.RATE_LIMIT_LOGIN_MAX || "100",
      RATE_LIMIT_GENERATION_MAX: process.env.RATE_LIMIT_GENERATION_MAX || "100",
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);

  await waitForHealthy(baseUrl, child);

  return {
    baseUrl,
    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 4_000))
      ]);

      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit").catch(() => undefined);
      }
    }
  };
}

async function requestJson<T = unknown>(input: {
  baseUrl: string;
  jar: CookieJar;
  method: "GET" | "POST";
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

async function registerAndGetWorkspace(input: {
  baseUrl: string;
  jar: CookieJar;
  suffix: string;
}): Promise<{ workspaceId: string }> {
  const response = await requestJson<{
    activeWorkspaceId?: string;
  }>({
    baseUrl: input.baseUrl,
    jar: input.jar,
    method: "POST",
    path: "/api/auth/register",
    body: {
      name: `State Route Tester ${input.suffix}`,
      email: `state-routes-${input.suffix}@example.com`,
      password: "Password123!",
      organizationName: `State Route Org ${input.suffix}`,
      workspaceName: `State Route Workspace ${input.suffix}`
    }
  });

  assert.equal(response.status, 201);
  assert.ok(response.body.activeWorkspaceId);

  return {
    workspaceId: response.body.activeWorkspaceId as string
  };
}

async function createProject(input: {
  baseUrl: string;
  jar: CookieJar;
  workspaceId: string;
  suffix: string;
}): Promise<{ projectId: string }> {
  const response = await requestJson<{
    project: {
      id: string;
    };
  }>({
    baseUrl: input.baseUrl,
    jar: input.jar,
    method: "POST",
    path: "/api/projects",
    body: {
      workspaceId: input.workspaceId,
      name: `State Route Project ${input.suffix}`,
      description: "Agent state route integration test project",
      templateId: "agent-workflow"
    }
  });

  assert.equal(response.status, 201);
  assert.ok(response.body.project.id);

  return {
    projectId: response.body.project.id
  };
}

async function waitForStepAdvance(input: {
  baseUrl: string;
  jar: CookieJar;
  projectId: string;
  runId: string;
  minStepIndex: number;
}): Promise<{
  run: {
    status: string;
    stepIndex: number;
  };
  steps: Array<{ id: string }>;
}> {
  const startedAt = Date.now();
  const timeoutMs = 8_000;

  while (Date.now() - startedAt < timeoutMs) {
    const detail = await requestJson<{
      run: {
        status: string;
        stepIndex: number;
      };
      steps: Array<{ id: string }>;
    }>({
      baseUrl: input.baseUrl,
      jar: input.jar,
      method: "GET",
      path: `/api/projects/${input.projectId}/agent/state-runs/${input.runId}`
    });

    if (detail.status === 200 && detail.body.run.stepIndex >= input.minStepIndex) {
      return detail.body;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for run ${input.runId} to reach step index ${input.minStepIndex}.`);
}

test("agent state route lifecycle supports deterministic tick and cancellation", async () => {
  const server = await startServer({
    AGENT_FAKE_GOAL_STEPS: "1"
  });
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);

  try {
    const { workspaceId } = await registerAndGetWorkspace({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const { projectId } = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId,
      suffix
    });

    const createRun = await requestJson<{
      run: {
        id: string;
        status: string;
        phase: string;
        stepIndex: number;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs`,
      body: {
        goal: `Lifecycle coverage ${suffix}`,
        maxSteps: 10,
        maxCorrections: 2,
        maxOptimizations: 1,
        autoStart: false
      }
    });

    assert.equal(createRun.status, 201);
    assert.equal(createRun.body.run.status, "queued");
    assert.equal(createRun.body.run.phase, "goal");
    assert.equal(createRun.body.run.stepIndex, 0);

    const runId = createRun.body.run.id;

    const listRuns = await requestJson<{
      runs: Array<{ id: string; status: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/agent/state-runs`
    });

    assert.equal(listRuns.status, 200);
    assert.equal(listRuns.body.runs.some((entry) => entry.id === runId), true);

    const detailBefore = await requestJson<{
      run: {
        id: string;
      };
      steps: unknown[];
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}`
    });

    assert.equal(detailBefore.status, 200);
    assert.equal(detailBefore.body.run.id, runId);
    assert.equal(detailBefore.body.steps.length, 0);

    const firstTick = await requestJson<{
      outcome: string;
      shouldReenqueue: boolean;
      reason?: string;
      run?: {
        status: string;
        phase: string;
        stepIndex: number;
      };
      step?: {
        type: string;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}/tick`,
      body: {
        expectedStepIndex: 0
      }
    });

    assert.equal(firstTick.status, 200);
    assert.equal(firstTick.body.outcome, "processed");
    assert.equal(firstTick.body.run?.stepIndex, 1);
    assert.equal(firstTick.body.run?.phase, "optimization");
    assert.equal(firstTick.body.run?.status, "optimizing");
    assert.equal(firstTick.body.step?.type, "goal");
    assert.equal(firstTick.body.shouldReenqueue, true);

    const staleTick = await requestJson<{
      outcome: string;
      shouldReenqueue: boolean;
      reason?: string;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}/tick`,
      body: {
        expectedStepIndex: 0
      }
    });

    assert.equal(staleTick.status, 200);
    assert.equal(staleTick.body.outcome, "skipped");
    assert.match(staleTick.body.reason || "", /Stale worker payload/);
    assert.equal(staleTick.body.shouldReenqueue, true);

    const cancelRun = await requestJson<{
      run: {
        status: string;
        stepIndex: number;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}/cancel`
    });

    assert.equal(cancelRun.status, 200);
    assert.equal(cancelRun.body.run.status, "cancelled");
    assert.equal(cancelRun.body.run.stepIndex, 1);

    const tickAfterCancel = await requestJson<{
      outcome: string;
      reason?: string;
      run?: {
        status: string;
      };
      shouldReenqueue: boolean;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}/tick`,
      body: {
        expectedStepIndex: 1
      }
    });

    assert.equal(tickAfterCancel.status, 200);
    assert.equal(tickAfterCancel.body.outcome, "skipped");
    assert.equal(tickAfterCancel.body.run?.status, "cancelled");
    assert.match(tickAfterCancel.body.reason || "", /cancelled/i);
    assert.equal(tickAfterCancel.body.shouldReenqueue, false);

    const detailAfter = await requestJson<{
      steps: unknown[];
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}`
    });

    assert.equal(detailAfter.status, 200);
    assert.equal(detailAfter.body.steps.length, 1);
  } finally {
    await server.stop();
  }
});

test("resume endpoint re-enqueues queued execution and advances step index", async () => {
  const server = await startServer({
    AGENT_FAKE_GOAL_STEPS: "3"
  });
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);

  try {
    const { workspaceId } = await registerAndGetWorkspace({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const { projectId } = await createProject({
      baseUrl: server.baseUrl,
      jar,
      workspaceId,
      suffix
    });

    const createRun = await requestJson<{
      run: {
        id: string;
        status: string;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs`,
      body: {
        goal: `Resume queue coverage ${suffix}`,
        autoStart: false
      }
    });

    assert.equal(createRun.status, 201);
    const runId = createRun.body.run.id;

    const cancelRun = await requestJson<{
      run: {
        status: string;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}/cancel`
    });

    assert.equal(cancelRun.status, 200);
    assert.equal(cancelRun.body.run.status, "cancelled");

    const resumeRun = await requestJson<{
      run: {
        status: string;
        stepIndex: number;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/state-runs/${runId}/resume`
    });

    assert.equal(resumeRun.status, 200);
    assert.equal(resumeRun.body.run.status, "queued");
    assert.equal(resumeRun.body.run.stepIndex, 0);

    const progressed = await waitForStepAdvance({
      baseUrl: server.baseUrl,
      jar,
      projectId,
      runId,
      minStepIndex: 1
    });

    assert.ok(progressed.run.stepIndex >= 1);
    assert.ok(progressed.steps.length >= 1);
    assert.notEqual(progressed.run.status, "cancelled");
  } finally {
    await server.stop();
  }
});
