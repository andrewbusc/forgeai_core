import assert from "node:assert/strict";
import test from "node:test";
import { AgentStep } from "../../types.js";
import { evaluateCorrectionPolicy } from "../policy-engine.js";

function buildCorrectionStep(input?: {
  id?: string;
  attempt?: number;
  classificationIntent?: string;
  constraintIntent?: string;
  allowedPathPrefixes?: string[];
}): AgentStep {
  const id = input?.id || "runtime-correction-1";
  const attempt = input?.attempt || 1;
  const classificationIntent = input?.classificationIntent || "runtime_boot";
  const constraintIntent = input?.constraintIntent || classificationIntent;
  const allowedPathPrefixes = input?.allowedPathPrefixes || ["src/"];

  return {
    id,
    type: "modify",
    tool: "write_file",
    input: {
      path: "src/runtime-correction.ts",
      content: "export const corrected = true;\n",
      _deepCorrection: {
        phase: "goal",
        attempt,
        failedStepId: "step-verify-runtime",
        classification: {
          intent: classificationIntent,
          failedChecks: [],
          failureKinds: [],
          rationale: "test fixture"
        },
        constraint: {
          intent: constraintIntent,
          maxFiles: 6,
          maxTotalDiffBytes: 120000,
          allowedPathPrefixes,
          guidance: ["Fix runtime boot only."]
        },
        createdAt: new Date().toISOString()
      }
    }
  };
}

test("policy passes for well-formed correction metadata and staged diffs", () => {
  const step = buildCorrectionStep();
  const result = evaluateCorrectionPolicy({
    step,
    status: "completed",
    errorMessage: null,
    commitHash: "abc1234",
    outputPayload: {
      stagedDiffs: [
        {
          path: "src/runtime-correction.ts",
          diffPreview: "@@ -1 +1 @@\n+export const corrected = true;\n"
        }
      ]
    },
    resolvedConstraint: {
      intent: "runtime_boot",
      maxFiles: 6,
      maxTotalDiffBytes: 120000,
      allowedPathPrefixes: ["src/"],
      guidance: ["Fix runtime boot only."]
    },
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400000
  });

  assert.equal(result.ok, true);
  assert.equal(result.blockingCount, 0);
});

test("policy fails when correction metadata is missing", () => {
  const step: AgentStep = {
    id: "runtime-correction-1",
    type: "modify",
    tool: "write_file",
    input: {
      path: "src/runtime-correction.ts",
      content: "export const corrected = true;\n"
    }
  };

  const result = evaluateCorrectionPolicy({
    step,
    status: "completed",
    errorMessage: null,
    commitHash: "abc1234",
    outputPayload: {
      stagedDiffs: []
    },
    resolvedConstraint: null,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400000
  });

  assert.equal(result.ok, false);
  assert.equal(result.violations.some((entry) => entry.ruleId === "correction_metadata_present"), true);
});

test("policy fails when metadata attempt does not match correction step suffix", () => {
  const step = buildCorrectionStep({
    id: "runtime-correction-1",
    attempt: 2
  });

  const result = evaluateCorrectionPolicy({
    step,
    status: "completed",
    errorMessage: null,
    commitHash: "abc1234",
    outputPayload: {
      stagedDiffs: [
        {
          path: "src/runtime-correction.ts",
          diffPreview: "+fix\n"
        }
      ]
    },
    resolvedConstraint: {
      intent: "runtime_boot",
      maxFiles: 6,
      maxTotalDiffBytes: 120000,
      allowedPathPrefixes: ["src/"],
      guidance: ["Fix runtime boot only."]
    },
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400000
  });

  assert.equal(result.ok, false);
  assert.equal(result.violations.some((entry) => entry.ruleId === "correction_attempt_suffix_match"), true);
});

test("policy fails when staged paths escape allowed path prefixes", () => {
  const step = buildCorrectionStep({
    allowedPathPrefixes: ["src/"]
  });

  const result = evaluateCorrectionPolicy({
    step,
    status: "completed",
    errorMessage: null,
    commitHash: "abc1234",
    outputPayload: {
      stagedDiffs: [
        {
          path: ".env",
          diffPreview: "+SECRET=1\n"
        }
      ]
    },
    resolvedConstraint: {
      intent: "runtime_boot",
      maxFiles: 6,
      maxTotalDiffBytes: 120000,
      allowedPathPrefixes: ["src/"],
      guidance: ["Fix runtime boot only."]
    },
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400000
  });

  assert.equal(result.ok, false);
  assert.equal(result.violations.some((entry) => entry.ruleId === "correction_staged_paths_within_constraint"), true);
});
