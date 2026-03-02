import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";

class CookieJar {
  #cookies = new Map<string, string>();

  ingest(headers: Headers): void {
    const setCookie = headers.getSetCookie?.() || [];
    for (const entry of setCookie) {
      const [pair] = entry.split(";", 1);
      const [name, ...rest] = pair.split("=");
      if (!name) {
        continue;
      }
      this.#cookies.set(name.trim(), rest.join("=").trim());
    }
  }

  get headerValue(): string {
    return Array.from(this.#cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

interface JsonResponse<T> {
  status: number;
  body: T;
}

interface RunningServer {
  baseUrl: string;
  stop(): Promise<void>;
}

const requiredDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!requiredDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL must be set for canonical template validation test.");
}

async function acquireFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a free port."));
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

function appendBootLog(lines: string[], chunk: Buffer): void {
  const text = chunk.toString("utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) {
      continue;
    }
    lines.push(line);
    if (lines.length > 80) {
      lines.shift();
    }
  }
}

function formatBootLogTail(lines: string[]): string {
  if (!lines.length) {
    return "(no boot logs captured)";
  }
  return lines.slice(-20).join(" | ");
}

async function waitForHealthy(baseUrl: string, child: ReturnType<typeof spawn>, bootLogs: string[]): Promise<void> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming healthy. Logs: ${formatBootLogTail(bootLogs)}`);
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

  throw new Error(`Timed out waiting for server health endpoint. Logs: ${formatBootLogTail(bootLogs)}`);
}

async function startServer(envOverrides: Record<string, string | undefined> = {}): Promise<RunningServer> {
  const port = await acquireFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const bootLogs: string[] = [];

  const child = spawn(process.execPath, [tsxCliPath, "-r", "dotenv/config", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: requiredDatabaseUrl,
      PORT: String(port),
      NODE_ENV: "test",
      CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || "http://localhost",
      AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET || "test-auth-token-secret",
      RATE_LIMIT_LOGIN_MAX: process.env.RATE_LIMIT_LOGIN_MAX || "100",
      RATE_LIMIT_GENERATION_MAX: process.env.RATE_LIMIT_GENERATION_MAX || "100",
      AGENT_LIGHT_VALIDATION_MODE: "off",
      AGENT_HEAVY_VALIDATION_MODE: "off",
      AGENT_HEAVY_INSTALL_DEPS: "true",
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk: Buffer) => appendBootLog(bootLogs, chunk));
  child.stderr.on("data", (chunk: Buffer) => appendBootLog(bootLogs, chunk));

  await waitForHealthy(baseUrl, child, bootLogs);

  return {
    baseUrl,
    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 4_000))]);

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
  if (text.trim()) {
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
  const response = await requestJson<{ activeWorkspaceId?: string }>({
    baseUrl: input.baseUrl,
    jar: input.jar,
    method: "POST",
    path: "/api/auth/register",
    body: {
      name: `Template Validation Tester ${input.suffix}`,
      email: `template-validation-${input.suffix}@example.com`,
      password: "Password123!",
      organizationName: `Template Validation Org ${input.suffix}`,
      workspaceName: `Template Validation Workspace ${input.suffix}`
    }
  });

  assert.equal(response.status, 201);
  assert.ok(response.body.activeWorkspaceId);
  return { workspaceId: response.body.activeWorkspaceId as string };
}

test("canonical-backend scaffold validates successfully and persists passed status", async () => {
  const server = await startServer();
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);

  try {
    const { workspaceId } = await registerAndGetWorkspace({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const createProject = await requestJson<{
      project: {
        id: string;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: "/api/projects",
      body: {
        workspaceId,
        name: `Canonical Validation ${suffix}`,
        description: "Canonical template validation CI guard",
        templateId: "canonical-backend"
      }
    });

    assert.equal(createProject.status, 201);
    const projectId = createProject.body.project.id;
    assert.ok(projectId);

    const manualEdit = await requestJson<{ ok: boolean; commitHash: string | null }>({
      baseUrl: server.baseUrl,
      jar,
      method: "PUT",
      path: `/api/projects/${projectId}/file`,
      body: {
        path: `ci-validation-${suffix}.txt`,
        content: `canonical template validation smoke ${suffix}\n`
      }
    });
    assert.equal(manualEdit.status, 200);
    assert.equal(manualEdit.body.ok, true);
    assert.ok(manualEdit.body.commitHash);

    const runs = await requestJson<{
      runs: Array<{
        id: string;
        goal: string;
        status: string;
      }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/agent/runs`
    });
    assert.equal(runs.status, 200);

    const run = runs.body.runs.find((entry) => entry.goal === `Manual file edit: ci-validation-${suffix}.txt`);
    assert.ok(run);
    assert.equal(run?.status, "complete");

    const validated = await requestJson<{
      run: {
        id: string;
        status: string;
        validationStatus?: "passed" | "failed" | null;
        validationResult?: Record<string, unknown> | null;
        validatedAt?: string | null;
      };
      validation: {
        ok: boolean;
        blockingCount: number;
        warningCount: number;
        summary: string;
      };
      targetPath: string;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/agent/runs/${run?.id}/validate`,
      body: {}
    });

    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    assert.equal(validated.body.run.id, run?.id);
    assert.equal(validated.body.run.status, "complete");
    assert.equal(validated.body.validation.ok, true);
    assert.equal(validated.body.validation.blockingCount, 0);
    assert.equal(validated.body.run.validationStatus, "passed");
    assert.equal(typeof validated.body.run.validationResult, "object");
    assert.equal(typeof validated.body.run.validatedAt, "string");

    const afterValidate = await requestJson<{
      run: {
        id: string;
        status: string;
        validationStatus?: "passed" | "failed" | null;
        validationResult?: {
          validation?: {
            ok?: boolean;
            blockingCount?: number;
          };
        } | null;
        validatedAt?: string | null;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/agent/runs/${run?.id}`
    });

    assert.equal(afterValidate.status, 200);
    assert.equal(afterValidate.body.run.status, "complete");
    assert.equal(afterValidate.body.run.validationStatus, "passed");
    assert.equal(typeof afterValidate.body.run.validatedAt, "string");
    assert.equal(afterValidate.body.run.validationResult?.validation?.ok, true);
    assert.equal(afterValidate.body.run.validationResult?.validation?.blockingCount, 0);
  } finally {
    await server.stop();
  }
});
