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
    "Project mutation route integration tests require DATABASE_URL or TEST_DATABASE_URL."
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

function appendBootLog(logLines: string[], chunk: Buffer): void {
  const lines = chunk.toString("utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    logLines.push(trimmed);
    if (logLines.length > 40) {
      logLines.shift();
    }
  }
}

function formatBootLogTail(logLines: string[]): string {
  if (logLines.length === 0) {
    return "no server logs captured";
  }

  return logLines.slice(-12).join(" | ");
}

async function waitForHealthy(
  baseUrl: string,
  child: ReturnType<typeof spawn>,
  bootLogs: string[]
): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 20_000;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server process exited early with code ${String(child.exitCode)}. Logs: ${formatBootLogTail(bootLogs)}`
      );
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
      name: `Mutation Tester ${input.suffix}`,
      email: `mutation-routes-${input.suffix}@example.com`,
      password: "Password123!",
      organizationName: `Mutation Org ${input.suffix}`,
      workspaceName: `Mutation Workspace ${input.suffix}`
    }
  });

  assert.equal(response.status, 201);
  assert.ok(response.body.activeWorkspaceId);

  return {
    workspaceId: response.body.activeWorkspaceId as string
  };
}

function expectCommitSubjectContains(commits: Array<{ subject?: string }>, fragment: string): void {
  const matched = commits.some((entry) => typeof entry.subject === "string" && entry.subject.includes(fragment));
  assert.equal(
    matched,
    true,
    `Expected commit history to include '${fragment}', but it was missing.`
  );
}

test("project scaffold + manual edit + generate + chat use transactional mutation flow", async () => {
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
        history: Array<{
          commitHash?: string;
          filesChanged?: string[];
        }>;
      };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: "/api/projects",
      body: {
        workspaceId,
        name: `Mutation Project ${suffix}`,
        description: "Route integration test project",
        templateId: "agent-workflow"
      }
    });

    assert.equal(createProject.status, 201);
    const projectId = createProject.body.project.id;
    assert.ok(projectId);
    const scaffoldHistory = createProject.body.project.history[0];
    assert.ok(scaffoldHistory?.commitHash);
    assert.ok((scaffoldHistory?.filesChanged || []).length > 0);

    const gitAfterScaffold = await requestJson<{ commits: Array<{ subject: string }> }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/git/history`
    });
    assert.equal(gitAfterScaffold.status, 200);
    expectCommitSubjectContains(gitAfterScaffold.body.commits, `agentRunId=project-scaffold-${projectId}`);

    const scaffoldPath = (scaffoldHistory.filesChanged || [])[0] as string;
    assert.ok(scaffoldPath);
    const scaffoldFile = await requestJson<{ content: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/file?path=${encodeURIComponent(scaffoldPath)}`
    });
    assert.equal(scaffoldFile.status, 200);
    const editedContent = `${scaffoldFile.body.content}\n# mutation route test ${suffix}\n`;

    const manualEdit = await requestJson<{ ok: boolean; commitHash: string | null }>({
      baseUrl: server.baseUrl,
      jar,
      method: "PUT",
      path: `/api/projects/${projectId}/file`,
      body: {
        path: scaffoldPath,
        content: editedContent
      }
    });
    assert.equal(manualEdit.status, 200);
    assert.equal(manualEdit.body.ok, true);
    assert.ok(manualEdit.body.commitHash);

    const historyAfterManual = await requestJson<{
      history: Array<{ kind: string; filesChanged: string[]; commitHash?: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/history`
    });
    assert.equal(historyAfterManual.status, 200);
    assert.equal(historyAfterManual.body.history[0]?.kind, "manual-edit");
    assert.deepEqual(historyAfterManual.body.history[0]?.filesChanged, [scaffoldPath]);
    assert.ok(historyAfterManual.body.history[0]?.commitHash);

    const gitAfterManual = await requestJson<{ commits: Array<{ subject: string }> }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/git/history`
    });
    assert.equal(gitAfterManual.status, 200);
    expectCommitSubjectContains(gitAfterManual.body.commits, `agentRunId=manual-edit-${projectId}`);

    const fileAfterManual = await requestJson<{ content: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/file?path=${encodeURIComponent(scaffoldPath)}`
    });
    assert.equal(fileAfterManual.status, 200);
    assert.equal(fileAfterManual.body.content, editedContent);

    const generatePrompt = `Write summary note ${suffix} ${randomUUID().slice(0, 6)}`;
    const generateResponse = await requestJson<{
      result: { commitHash: string | null; filesChanged: string[] };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/generate`,
      body: {
        prompt: generatePrompt,
        provider: "mock"
      }
    });
    assert.equal(generateResponse.status, 200);
    assert.ok(generateResponse.body.result.commitHash);
    assert.ok(generateResponse.body.result.filesChanged.length > 0);

    const generatedPath = generateResponse.body.result.filesChanged[0] as string;
    const generatedFile = await requestJson<{ content: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/file?path=${encodeURIComponent(generatedPath)}`
    });
    assert.equal(generatedFile.status, 200);
    assert.match(generatedFile.body.content, /Builder Request/i);

    const gitAfterGenerate = await requestJson<{ commits: Array<{ subject: string }> }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/git/history`
    });
    assert.equal(gitAfterGenerate.status, 200);
    expectCommitSubjectContains(gitAfterGenerate.body.commits, `agentRunId=legacy-${projectId}-generate`);

    const chatPrompt = `Chat follow-up ${suffix} ${randomUUID().slice(0, 6)}`;
    const chatResponse = await requestJson<{
      result: { commitHash: string | null; filesChanged: string[] };
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: `/api/projects/${projectId}/chat`,
      body: {
        message: chatPrompt,
        provider: "mock"
      }
    });
    assert.equal(chatResponse.status, 200);
    assert.ok(chatResponse.body.result.commitHash);
    assert.ok(chatResponse.body.result.filesChanged.length > 0);

    const gitAfterChat = await requestJson<{ commits: Array<{ subject: string }> }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${projectId}/git/history`
    });
    assert.equal(gitAfterChat.status, 200);
    expectCommitSubjectContains(gitAfterChat.body.commits, `agentRunId=legacy-${projectId}-chat`);
  } finally {
    await server.stop();
  }
});

test("scaffold failure is atomic with no partial writes", async () => {
  const server = await startServer({
    AGENT_FS_MAX_FILE_BYTES: "10"
  });
  const jar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const projectName = `Atomic Failure Project ${suffix}`;

  try {
    const { workspaceId } = await registerAndGetWorkspace({
      baseUrl: server.baseUrl,
      jar,
      suffix
    });

    const failedCreate = await requestJson<{ error?: string }>({
      baseUrl: server.baseUrl,
      jar,
      method: "POST",
      path: "/api/projects",
      body: {
        workspaceId,
        name: projectName,
        description: "Should fail scaffold write",
        templateId: "agent-workflow"
      }
    });

    assert.equal(failedCreate.status, 500);

    const projects = await requestJson<{
      projects: Array<{ id: string; name: string }>;
    }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: "/api/projects"
    });
    assert.equal(projects.status, 200);
    const created = projects.body.projects.find((entry) => entry.name === projectName);
    assert.ok(created);

    const tree = await requestJson<{ tree: unknown[] }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${created?.id}/tree`
    });
    assert.equal(tree.status, 200);
    assert.equal(Array.isArray(tree.body.tree), true);
    assert.equal(tree.body.tree.length, 0);

    const history = await requestJson<{ history: unknown[] }>({
      baseUrl: server.baseUrl,
      jar,
      method: "GET",
      path: `/api/projects/${created?.id}/history`
    });
    assert.equal(history.status, 200);
    assert.equal(Array.isArray(history.body.history), true);
    assert.equal(history.body.history.length, 0);
  } finally {
    await server.stop();
  }
});
