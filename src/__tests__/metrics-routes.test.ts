import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Metrics route integration tests require DATABASE_URL or TEST_DATABASE_URL.");
}

const requiredDatabaseUrl: string = databaseUrl;

interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
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

async function acquireFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate free port for metrics route test."));
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

test("metrics route is disabled by default", async () => {
  const server = await startServer({
    METRICS_ENABLED: "false",
    METRICS_AUTH_TOKEN: ""
  });

  try {
    const response = await fetch(`${server.baseUrl}/metrics`);
    assert.equal(response.status, 404);
    const body = await response.text();
    assert.match(body, /Not found/i);
  } finally {
    await server.stop();
  }
});

test("metrics route enforces bearer auth and exports Prometheus metrics", async () => {
  const metricsToken = "metrics-test-token";
  const server = await startServer({
    METRICS_ENABLED: "true",
    METRICS_AUTH_TOKEN: metricsToken
  });

  try {
    const unauthorized = await fetch(`${server.baseUrl}/metrics`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const ready = await fetch(`${server.baseUrl}/api/ready`);
    assert.equal(ready.status, 200);

    const metrics = await fetch(`${server.baseUrl}/metrics`, {
      headers: {
        Authorization: `Bearer ${metricsToken}`
      }
    });

    assert.equal(metrics.status, 200);
    assert.match(metrics.headers.get("content-type") || "", /text\/plain/i);

    const body = await metrics.text();
    assert.match(body, /# TYPE deeprun_http_request_duration_ms histogram/);
    assert.match(body, /deeprun_process_uptime_seconds /);
    assert.match(body, /deeprun_server_lifecycle_state\{state="ready"\} 1/);
    assert.match(body, /deeprun_readiness_checks_total /);
    assert.match(body, /deeprun_http_requests_total /);
  } finally {
    await server.stop();
  }
});
