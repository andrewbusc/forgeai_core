import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { AppStore } from "../lib/project-store.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Agent kernel route integration tests require DATABASE_URL or TEST_DATABASE_URL."
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
      AGENT_LIGHT_VALIDATION_MODE: "off",
      AGENT_HEAVY_VALIDATION_MODE: "off",
      AGENT_HEAVY_INSTALL_DEPS: "false",
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

test("kernel run endpoints support start/list/detail/resume/validate", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);

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
        goal: `Kernel route run ${suffix}`,
        provider: "mock"
      }
    });

    assert.equal(started.status, 201);
    assert.ok(started.body.run.id);
    assert.equal(started.body.run.status, "complete");
    assert.ok(started.body.steps.length >= 1);

    const runId = started.body.run.id;

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

    const detail = await requestJson<{
      run: { id: string; status: string };
      steps: Array<{ id: string }>;
      telemetry?: { corrections?: unknown[] };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${project.id}/agent/runs/${runId}`
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.run.id, runId);
    assert.equal(detail.body.run.status, "complete");
    assert.ok(detail.body.steps.length >= 1);
    assert.ok(Array.isArray(detail.body.telemetry?.corrections || []));

    const resumed = await requestJson<{
      run: { id: string; status: string };
      steps: Array<{ id: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs/${runId}/resume`
    });

    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.run.id, runId);
    assert.equal(resumed.body.run.status, "complete");

    const validated = await requestJson<{
      run: { id: string };
      targetPath: string;
      validation: {
        ok: boolean;
        blockingCount: number;
        warningCount: number;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${project.id}/agent/runs/${runId}/validate`
    });

    assert.equal(validated.status, 200);
    assert.equal(validated.body.run.id, runId);
    assert.ok(typeof validated.body.targetPath === "string" && validated.body.targetPath.length > 0);
    assert.equal(typeof validated.body.validation.ok, "boolean");
    assert.equal(typeof validated.body.validation.blockingCount, "number");
    assert.equal(typeof validated.body.validation.warningCount, "number");
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
  } finally {
    await server.stop();
  }
});

test("fork endpoint works from committed step and branch lock blocks project mutations", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const store = new AppStore(process.cwd());
  await store.initialize();

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
