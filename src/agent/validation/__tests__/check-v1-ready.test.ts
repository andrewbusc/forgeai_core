import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { runV1ReadinessCheck } from "../check-v1-ready.js";

test("v1 readiness returns YES when heavy and docker checks pass", async () => {
  const report = await runV1ReadinessCheck("/tmp/deeprun-v1-pass", {
    runHeavyCheck: async () => ({
      id: "heavy_validation",
      status: "pass",
      message: "Heavy validation passed."
    }),
    runDockerChecks: async () => [
      {
        id: "docker_build",
        status: "pass",
        message: "Docker build passed."
      },
      {
        id: "docker_boot",
        status: "pass",
        message: "Docker boot passed."
      }
    ],
    now: () => new Date("2026-02-21T00:00:00.000Z")
  });

  assert.equal(report.ok, true);
  assert.equal(report.verdict, "YES");
  assert.deepEqual(
    report.checks.map((entry) => entry.id),
    ["heavy_validation", "stub_markers", "stub_debt", "docker_build", "docker_boot"]
  );
  assert.equal(report.generatedAt, "2026-02-21T00:00:00.000Z");
});

test("v1 readiness returns NO when heavy validation fails", async () => {
  const report = await runV1ReadinessCheck("/tmp/deeprun-v1-fail-heavy", {
    runHeavyCheck: async () => ({
      id: "heavy_validation",
      status: "fail",
      message: "Heavy validation failed."
    }),
    runDockerChecks: async () => [
      {
        id: "docker_build",
        status: "pass",
        message: "Docker build passed."
      },
      {
        id: "docker_boot",
        status: "pass",
        message: "Docker boot passed."
      }
    ],
    now: () => new Date("2026-02-21T00:00:00.000Z")
  });

  assert.equal(report.ok, false);
  assert.equal(report.verdict, "NO");
  assert.equal(report.checks[0]?.id, "heavy_validation");
  assert.equal(report.checks[0]?.status, "fail");
});

test("v1 readiness converts thrown runner errors into structured failure checks", async () => {
  const report = await runV1ReadinessCheck("/tmp/deeprun-v1-fail-errors", {
    runHeavyCheck: async () => {
      throw new Error("heavy exploded");
    },
    runDockerChecks: async () => {
      throw new Error("docker exploded");
    },
    now: () => new Date("2026-02-21T00:00:00.000Z")
  });

  assert.equal(report.ok, false);
  assert.equal(report.verdict, "NO");
  assert.deepEqual(
    report.checks.map((entry) => entry.id),
    ["heavy_validation", "stub_markers", "stub_debt", "docker_build", "docker_migration", "docker_boot"]
  );
  assert.equal(report.checks[0]?.status, "fail");
  assert.equal(report.checks[1]?.status, "pass");
  assert.equal(report.checks[2]?.status, "pass");
  assert.equal(report.checks[3]?.status, "fail");
  assert.equal(report.checks[4]?.status, "skip");
  assert.equal(report.checks[5]?.status, "skip");
  assert.match(String(report.checks[0]?.details?.error || ""), /heavy exploded/);
  assert.match(String(report.checks[3]?.details?.error || ""), /docker exploded/);
});

test("v1 readiness returns NO when docker migration check fails", async () => {
  const report = await runV1ReadinessCheck("/tmp/deeprun-v1-fail-docker-migration", {
    runHeavyCheck: async () => ({
      id: "heavy_validation",
      status: "pass",
      message: "Heavy validation passed."
    }),
    runDockerChecks: async () => [
      {
        id: "docker_build",
        status: "pass",
        message: "Docker build passed."
      },
      {
        id: "docker_migration",
        status: "fail",
        message: "Containerized migration dry run failed."
      },
      {
        id: "docker_boot",
        status: "skip",
        message: "Docker boot check skipped."
      }
    ],
    now: () => new Date("2026-02-21T00:00:00.000Z")
  });

  assert.equal(report.ok, false);
  assert.equal(report.verdict, "NO");
  assert.equal(report.checks.some((entry) => entry.id === "docker_migration" && entry.status === "fail"), true);
});

test("v1 readiness fails when stub markers remain in the target", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "deeprun-v1-stub-marker-"));

  try {
    await mkdir(path.join(target, "src"), { recursive: true });
    await writeFile(
      path.join(target, "src", "stub.ts"),
      '// @deeprun-stub {"createdByRunId":"run-1"}\nexport const broken: any = undefined as any;\n',
      "utf8"
    );

    const report = await runV1ReadinessCheck(target, {
      runHeavyCheck: async () => ({
        id: "heavy_validation",
        status: "pass",
        message: "Heavy validation passed."
      }),
      runDockerChecks: async () => [],
      now: () => new Date("2026-03-01T00:00:00.000Z")
    });

    assert.equal(report.ok, false);
    const stubMarkerCheck = report.checks.find((entry) => entry.id === "stub_markers");
    assert.equal(stubMarkerCheck?.status, "fail");
    assert.match(String(stubMarkerCheck?.message || ""), /stub markers/i);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("v1 readiness fails when open stub-debt artifacts remain", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "deeprun-v1-stub-debt-"));

  try {
    const debtDir = path.join(target, ".deeprun", "learning", "stub-debt");
    await mkdir(debtDir, { recursive: true });
    await writeFile(
      path.join(debtDir, "run-1_1_1.json"),
      JSON.stringify(
        {
          status: "open",
          createdAt: "2026-03-01T00:00:00.000Z",
          stubPath: "src/generated/provisional.ts"
        },
        null,
        2
      ),
      "utf8"
    );

    const report = await runV1ReadinessCheck(target, {
      runHeavyCheck: async () => ({
        id: "heavy_validation",
        status: "pass",
        message: "Heavy validation passed."
      }),
      runDockerChecks: async () => [],
      now: () => new Date("2026-03-01T00:00:00.000Z")
    });

    assert.equal(report.ok, false);
    const stubDebtCheck = report.checks.find((entry) => entry.id === "stub_debt");
    assert.equal(stubDebtCheck?.status, "fail");
    assert.equal(stubDebtCheck?.details?.count, 1);
    assert.deepEqual(stubDebtCheck?.details?.targets, ["src/generated/provisional.ts"]);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
