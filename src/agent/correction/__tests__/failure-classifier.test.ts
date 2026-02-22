import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailureForCorrection } from "../failure-classifier.js";

test("classifies architecture-heavy failures with strict module-layer scope", () => {
  const classified = classifyFailureForCorrection({
    phase: "optimization",
    failedStepId: "heavy-validation-1",
    attempt: 1,
    runtimeLogs: "architecture failure",
    failureReport: {
      summary: "failed checks: architecture, production_config; blocking=35; warnings=0",
      failures: [
        {
          sourceCheckId: "architecture",
          kind: "typescript",
          message: "controller imported prisma"
        }
      ]
    }
  });

  assert.equal(classified.intent, "architecture_violation");
  assert.equal(classified.constraint.intent, "architecture_violation");
  assert.equal(classified.constraint.maxFiles <= 12, true);
  assert.equal(classified.constraint.allowedPathPrefixes.includes("src/modules/"), true);
});

test("classifies migration failures from structured diagnostics", () => {
  const classified = classifyFailureForCorrection({
    phase: "optimization",
    failedStepId: "heavy-validation-2",
    attempt: 2,
    runtimeLogs: "prisma migrate failed",
    failureReport: {
      summary: "failed checks: migration, seed; blocking=2; warnings=0",
      failures: [
        {
          sourceCheckId: "migration",
          kind: "migration",
          code: "P3009",
          message: "migration failed"
        }
      ]
    }
  });

  assert.equal(classified.intent, "migration_failure");
  assert.equal(classified.constraint.allowedPathPrefixes.includes("prisma/"), true);
  assert.equal(classified.constraint.maxFiles <= 6, true);
});

test("classifies goal-phase runtime health failures from logs when report is absent", () => {
  const classified = classifyFailureForCorrection({
    phase: "goal",
    failedStepId: "step-verify-runtime",
    attempt: 1,
    runtimeLogs: "GET /health returned 503 - runtime unhealthy"
  });

  assert.equal(classified.intent, "runtime_health");
  assert.equal(classified.constraint.allowedPathPrefixes.includes("src/server.ts"), true);
});

test("falls back to unknown classification when no diagnostics are available", () => {
  const classified = classifyFailureForCorrection({
    phase: "goal",
    failedStepId: "step-x",
    attempt: 1,
    runtimeLogs: ""
  });

  assert.equal(classified.intent, "unknown");
  assert.equal(classified.constraint.maxFiles <= 5, true);
});
