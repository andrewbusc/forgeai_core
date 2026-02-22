import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIterationScopedMigrationDatabaseUrl,
  isExistingUserRegisterConflict,
  parseReliabilityBenchmarkOptions,
  summarizeReliabilityRuns,
  type ReliabilityBenchmarkOptions,
  type ReliabilityIteration
} from "../reliability-benchmark.js";

function baseOptions(): ReliabilityBenchmarkOptions {
  return {
    apiBaseUrl: "http://127.0.0.1:3000",
    email: "bench@example.com",
    password: "Password123!",
    name: "Bench",
    organizationName: "Bench Org",
    workspaceName: "Bench Workspace",
    iterations: 3,
    goal: "Build SaaS backend",
    strictV1Ready: true
  };
}

function makeIteration(input: { index: number; ok: boolean }): ReliabilityIteration {
  return {
    index: input.index,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    projectId: `project-${input.index}`,
    runId: `run-${input.index}`,
    runStatus: "complete",
    certification: {
      ok: input.ok,
      blockingCount: input.ok ? 0 : 1,
      warningCount: 0,
      summary: input.ok ? "ok" : "failed",
      targetPath: "/tmp/project"
    },
    ok: input.ok,
    ...(input.ok ? {} : { failureReason: "failed" })
  };
}

test("parseReliabilityBenchmarkOptions supports env fallback and explicit flags", () => {
  const parsed = parseReliabilityBenchmarkOptions(
    [
      "--iterations",
      "5",
      "--strict-v1-ready=false",
      "--min-pass-rate",
      "0.95",
      "--provider",
      "openai"
    ],
    {
      DEEPRUN_BENCHMARK_EMAIL: "env@example.com",
      DEEPRUN_BENCHMARK_PASSWORD: "Password123!",
      DEEPRUN_BENCHMARK_API: "http://localhost:9999"
    }
  );

  assert.equal(parsed.apiBaseUrl, "http://localhost:9999");
  assert.equal(parsed.email, "env@example.com");
  assert.equal(parsed.password, "Password123!");
  assert.equal(parsed.iterations, 5);
  assert.equal(parsed.strictV1Ready, false);
  assert.equal(parsed.minPassRate, 0.95);
  assert.equal(parsed.provider, "openai");
});

test("parseReliabilityBenchmarkOptions requires credentials", () => {
  assert.throws(
    () => parseReliabilityBenchmarkOptions([], {}),
    /Both --email and --password are required/
  );
});

test("summarizeReliabilityRuns computes pass rate and threshold status", () => {
  const report = summarizeReliabilityRuns({
    generatedAt: "2026-01-01T00:00:00.000Z",
    options: {
      ...baseOptions(),
      minPassRate: 0.8
    },
    runs: [makeIteration({ index: 1, ok: true }), makeIteration({ index: 2, ok: true }), makeIteration({ index: 3, ok: false })]
  });

  assert.equal(report.iterationsCompleted, 3);
  assert.equal(report.passCount, 2);
  assert.equal(report.failCount, 1);
  assert.equal(report.passRate, 2 / 3);
  assert.equal(report.thresholdMet, false);
});

test("summarizeReliabilityRuns leaves thresholdMet null when no threshold is set", () => {
  const report = summarizeReliabilityRuns({
    generatedAt: "2026-01-01T00:00:00.000Z",
    options: baseOptions(),
    runs: [makeIteration({ index: 1, ok: true })]
  });

  assert.equal(report.thresholdMet, null);
});

test("isExistingUserRegisterConflict accepts duplicate-user conflict and duplicate-key fallback", () => {
  assert.equal(isExistingUserRegisterConflict(409, { error: "User already exists." }), true);
  assert.equal(isExistingUserRegisterConflict(500, { error: 'duplicate key value violates unique constraint "users_email_key"' }), true);
  assert.equal(isExistingUserRegisterConflict(500, { error: "internal error" }), false);
  assert.equal(isExistingUserRegisterConflict(401, { error: "unauthorized" }), false);
});

test("buildIterationScopedMigrationDatabaseUrl isolates postgres schema per iteration", () => {
  const base =
    "postgresql://postgres:postgres@127.0.0.1:5432/deeprun_test?schema=public&connection_limit=1";
  const scoped = buildIterationScopedMigrationDatabaseUrl(base, 3, "abc-123");

  assert.ok(scoped);
  const parsed = new URL(scoped as string);
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(parsed.pathname, "/deeprun_test");
  assert.equal(parsed.searchParams.get("connection_limit"), "1");
  assert.equal(parsed.searchParams.get("schema"), "deeprun_bench_3_abc123");
});
