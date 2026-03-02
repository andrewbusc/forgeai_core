import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionContractMaterial,
  buildExecutionContract,
  EXECUTION_CONFIG_SCHEMA_VERSION,
  evaluateExecutionContractSupport,
  executionConfigSchema,
  formatExecutionConfigDiffSummary,
  hashExecutionContractMaterial,
  resolveExecutionConfig
} from "../execution-contract.js";

const envFallback = {
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

test("execution config schema validates versioned contracts", () => {
  const parsed = executionConfigSchema.parse({
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "ci",
    lightValidationMode: "off",
    heavyValidationMode: "off",
    maxRuntimeCorrectionAttempts: 0,
    maxHeavyCorrectionAttempts: 0,
    correctionPolicyMode: "warn",
    correctionConvergenceMode: "warn",
    plannerTimeoutMs: 5_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  });

  assert.equal(parsed.schemaVersion, EXECUTION_CONFIG_SCHEMA_VERSION);
  assert.throws(
    () =>
      executionConfigSchema.parse({
        ...parsed,
        schemaVersion: 999
      }),
    /Invalid literal value/
  );
});

test("resolveExecutionConfig attaches a deterministic contract to legacy runs", () => {
  const resolved = resolveExecutionConfig(null, null, envFallback);

  assert.equal(resolved.persistedWasPresent, false);
  assert.equal(resolved.persistedExecutionConfig.schemaVersion, EXECUTION_CONFIG_SCHEMA_VERSION);
  assert.equal(resolved.persistedExecutionConfig.profile, "full");
  assert.deepEqual(resolved.requestedExecutionConfig, resolved.persistedExecutionConfig);
  assert.deepEqual(resolved.diff, []);
  assert.equal(resolved.persistedContract.fallbackUsed, true);
  assert.ok(resolved.persistedContract.fallbackFields.includes("plannerTimeoutMs"));
  assert.ok(resolved.persistedContract.hash.length > 10);
});

test("resolveExecutionConfig keeps persisted config stable when no overrides are requested", () => {
  const persisted = {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "smoke",
    lightValidationMode: "warn",
    heavyValidationMode: "warn",
    maxRuntimeCorrectionAttempts: 1,
    maxHeavyCorrectionAttempts: 1,
    correctionPolicyMode: "warn",
    correctionConvergenceMode: "warn",
    plannerTimeoutMs: 10_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  };

  const resolved = resolveExecutionConfig(persisted, null, {
    ...envFallback,
    heavyValidationMode: "off",
    plannerTimeoutMs: 3_000
  });

  assert.deepEqual(resolved.persistedExecutionConfig, persisted);
  assert.deepEqual(resolved.requestedExecutionConfig, persisted);
  assert.equal(resolved.diff.length, 0);
});

test("resolveExecutionConfig treats requested profile as a fresh contract, not a mutation of persisted knobs", () => {
  const persisted = {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "full",
    lightValidationMode: "enforce",
    heavyValidationMode: "enforce",
    maxRuntimeCorrectionAttempts: 5,
    maxHeavyCorrectionAttempts: 3,
    correctionPolicyMode: "enforce",
    correctionConvergenceMode: "enforce",
    plannerTimeoutMs: 120_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  };

  const resolved = resolveExecutionConfig(
    persisted,
    {
      profile: "ci"
    },
    envFallback
  );

  assert.equal(resolved.requestedExecutionConfig.profile, "ci");
  assert.equal(resolved.requestedExecutionConfig.lightValidationMode, "off");
  assert.equal(resolved.requestedExecutionConfig.heavyValidationMode, "off");
  assert.equal(resolved.requestedExecutionConfig.maxRuntimeCorrectionAttempts, 0);
  assert.equal(resolved.requestedExecutionConfig.plannerTimeoutMs, 5_000);
  assert.equal(
    formatExecutionConfigDiffSummary(resolved.diff),
    "profile: full -> ci, lightValidationMode: enforce -> off, heavyValidationMode: enforce -> off, maxRuntimeCorrectionAttempts: 5 -> 0, maxHeavyCorrectionAttempts: 3 -> 0, correctionPolicyMode: enforce -> warn, correctionConvergenceMode: enforce -> warn, plannerTimeoutMs: 120000 -> 5000"
  );
});

test("resolveExecutionConfig preserves persisted profile when only field overrides are requested", () => {
  const persisted = {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "smoke",
    lightValidationMode: "warn",
    heavyValidationMode: "warn",
    maxRuntimeCorrectionAttempts: 1,
    maxHeavyCorrectionAttempts: 1,
    correctionPolicyMode: "warn",
    correctionConvergenceMode: "warn",
    plannerTimeoutMs: 10_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  };

  const resolved = resolveExecutionConfig(
    persisted,
    {
      plannerTimeoutMs: 30_000
    },
    envFallback
  );

  assert.equal(resolved.requestedExecutionConfig.profile, "smoke");
  assert.equal(resolved.requestedExecutionConfig.plannerTimeoutMs, 30_000);
  assert.deepEqual(
    resolved.diff.map((entry) => entry.field),
    ["plannerTimeoutMs"]
  );
});

test("resolveExecutionConfig emits stable contract hashes for normalized profiles", () => {
  const full = resolveExecutionConfig(null, { profile: "full" }, envFallback).requestedContract;
  const ci = resolveExecutionConfig(null, { profile: "ci" }, envFallback).requestedContract;
  const smoke = resolveExecutionConfig(null, { profile: "smoke" }, envFallback).requestedContract;

  assert.deepEqual(full.effectiveConfig, {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "full",
    lightValidationMode: "enforce",
    heavyValidationMode: "enforce",
    maxRuntimeCorrectionAttempts: 5,
    maxHeavyCorrectionAttempts: 3,
    correctionPolicyMode: "enforce",
    correctionConvergenceMode: "enforce",
    plannerTimeoutMs: 120_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  });
  assert.deepEqual(ci.effectiveConfig, {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "ci",
    lightValidationMode: "off",
    heavyValidationMode: "off",
    maxRuntimeCorrectionAttempts: 0,
    maxHeavyCorrectionAttempts: 0,
    correctionPolicyMode: "warn",
    correctionConvergenceMode: "warn",
    plannerTimeoutMs: 5_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  });
  assert.deepEqual(smoke.effectiveConfig, {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "smoke",
    lightValidationMode: "warn",
    heavyValidationMode: "warn",
    maxRuntimeCorrectionAttempts: 1,
    maxHeavyCorrectionAttempts: 1,
    correctionPolicyMode: "warn",
    correctionConvergenceMode: "warn",
    plannerTimeoutMs: 10_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  });
  assert.equal(buildExecutionContract(full.effectiveConfig).hash, full.hash);
  assert.notEqual(full.hash, ci.hash);
  assert.notEqual(ci.hash, smoke.hash);
});

test("execution contract material canonicalization is stable for identical inputs", () => {
  const config = resolveExecutionConfig(null, { profile: "smoke" }, envFallback).requestedExecutionConfig;
  const left = buildExecutionContractMaterial(config);
  const right = buildExecutionContractMaterial({
    ...config
  });

  assert.equal(hashExecutionContractMaterial(left), hashExecutionContractMaterial(right));
});

test("execution contract hash changes when policy versions change", () => {
  const config = resolveExecutionConfig(null, { profile: "full" }, envFallback).requestedExecutionConfig;
  const material = buildExecutionContractMaterial(config);
  const futurePlannerMaterial = {
    ...material,
    plannerPolicyVersion: material.plannerPolicyVersion + 1
  };

  assert.notEqual(hashExecutionContractMaterial(material), hashExecutionContractMaterial(futurePlannerMaterial));
});

test("execution contract support rejects unsupported future policy versions", () => {
  const config = resolveExecutionConfig(null, { profile: "full" }, envFallback).requestedExecutionConfig;
  const material = buildExecutionContractMaterial(config);
  const support = evaluateExecutionContractSupport({
    ...material,
    validationPolicyVersion: material.validationPolicyVersion + 1
  });

  assert.equal(support.supported, false);
  assert.equal(support.code, "UNSUPPORTED_CONTRACT");
});
