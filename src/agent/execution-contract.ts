import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CORRECTION_RECIPE_VERSION,
  DETERMINISM_POLICY_VERSION,
  EXECUTION_CONTRACT_RANDOMNESS_SEED,
  PLANNER_POLICY_VERSION,
  SUPPORTED_EXECUTION_CONTRACT_RANGES,
  VALIDATION_POLICY_VERSION
} from "./contract-policy.js";
import {
  AgentRunExecutionContract,
  AgentRunExecutionConfig,
  AgentRunExecutionProfile,
  AgentRunExecutionValidationMode,
  agentRunExecutionProfileSchema,
  agentRunExecutionValidationModeSchema
} from "./types.js";

export const EXECUTION_CONFIG_SCHEMA_VERSION = 1 as const;

export const executionConfigSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONFIG_SCHEMA_VERSION),
  profile: agentRunExecutionProfileSchema,
  lightValidationMode: agentRunExecutionValidationModeSchema,
  heavyValidationMode: agentRunExecutionValidationModeSchema,
  maxRuntimeCorrectionAttempts: z.number().int().min(0).max(5),
  maxHeavyCorrectionAttempts: z.number().int().min(0).max(3),
  correctionPolicyMode: agentRunExecutionValidationModeSchema,
  correctionConvergenceMode: agentRunExecutionValidationModeSchema,
  plannerTimeoutMs: z.number().int().min(1_000).max(300_000),
  maxFilesPerStep: z.number().int().min(1).max(100),
  maxTotalDiffBytes: z.number().int().min(1_000).max(10_000_000),
  maxFileBytes: z.number().int().min(1_000).max(20_000_000),
  allowEnvMutation: z.boolean()
});

export const partialExecutionConfigSchema = executionConfigSchema.partial();

export interface ExecutionConfigEnvFallback {
  profile?: AgentRunExecutionProfile;
  lightValidationMode: AgentRunExecutionValidationMode;
  heavyValidationMode: AgentRunExecutionValidationMode;
  maxRuntimeCorrectionAttempts: number;
  maxHeavyCorrectionAttempts: number;
  correctionPolicyMode: AgentRunExecutionValidationMode;
  correctionConvergenceMode: AgentRunExecutionValidationMode;
  plannerTimeoutMs: number;
  maxFilesPerStep: number;
  maxTotalDiffBytes: number;
  maxFileBytes: number;
  allowEnvMutation: boolean;
}

export interface ExecutionConfigDiffEntry {
  field: keyof AgentRunExecutionConfig;
  persisted: AgentRunExecutionConfig[keyof AgentRunExecutionConfig];
  requested: AgentRunExecutionConfig[keyof AgentRunExecutionConfig];
}

export interface ResolvedExecutionConfigContract {
  persistedExecutionConfig: AgentRunExecutionConfig;
  requestedExecutionConfig: AgentRunExecutionConfig;
  persistedWasPresent: boolean;
  diff: ExecutionConfigDiffEntry[];
  persistedContract: AgentRunExecutionContract;
  requestedContract: AgentRunExecutionContract;
}

type ExecutionProfileMode = "default" | "builder";
type ExecutionConfigSource = "default" | "env" | "preset" | "raw" | "base";
type ExecutionConfigSourceMap = Record<keyof AgentRunExecutionConfig, ExecutionConfigSource>;

const EXECUTION_CONFIG_FIELDS: Array<keyof AgentRunExecutionConfig> = [
  "schemaVersion",
  "profile",
  "lightValidationMode",
  "heavyValidationMode",
  "maxRuntimeCorrectionAttempts",
  "maxHeavyCorrectionAttempts",
  "correctionPolicyMode",
  "correctionConvergenceMode",
  "plannerTimeoutMs",
  "maxFilesPerStep",
  "maxTotalDiffBytes",
  "maxFileBytes",
  "allowEnvMutation"
];

function toRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function executionConfigPreset(profile: AgentRunExecutionProfile): Partial<AgentRunExecutionConfig> {
  switch (profile) {
    case "ci":
      return {
        lightValidationMode: "off",
        heavyValidationMode: "off",
        maxRuntimeCorrectionAttempts: 0,
        maxHeavyCorrectionAttempts: 0,
        correctionPolicyMode: "warn",
        correctionConvergenceMode: "warn",
        plannerTimeoutMs: 5_000
      };
    case "smoke":
      return {
        lightValidationMode: "warn",
        heavyValidationMode: "warn",
        maxRuntimeCorrectionAttempts: 1,
        maxHeavyCorrectionAttempts: 1,
        correctionPolicyMode: "warn",
        correctionConvergenceMode: "warn",
        plannerTimeoutMs: 10_000
      };
    case "full":
    default:
      return {};
  }
}

function parseProfile(value: unknown): AgentRunExecutionProfile | null {
  const parsed = agentRunExecutionProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseValidationMode(value: unknown): AgentRunExecutionValidationMode | null {
  const parsed = agentRunExecutionValidationModeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseBoundedInt(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}

export interface ExecutionContractMaterial {
  executionContractSchemaVersion: number;
  normalizedExecutionConfig: AgentRunExecutionConfig;
  determinismPolicyVersion: number;
  plannerPolicyVersion: number;
  correctionRecipeVersion: number;
  validationPolicyVersion: number;
  randomnessSeed: string;
}

export interface ExecutionContractSupportResult {
  supported: boolean;
  code?: "UNSUPPORTED_CONTRACT";
  message?: string;
  details?: Record<string, unknown>;
}

export function stableExecutionContractJson(value: unknown): string {
  return stableJson(value);
}

export function buildExecutionContractMaterial(config: AgentRunExecutionConfig): ExecutionContractMaterial {
  return {
    executionContractSchemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    normalizedExecutionConfig: executionConfigSchema.parse(config),
    determinismPolicyVersion: DETERMINISM_POLICY_VERSION,
    plannerPolicyVersion: PLANNER_POLICY_VERSION,
    correctionRecipeVersion: CORRECTION_RECIPE_VERSION,
    validationPolicyVersion: VALIDATION_POLICY_VERSION,
    randomnessSeed: EXECUTION_CONTRACT_RANDOMNESS_SEED
  };
}

export function hashExecutionContractMaterial(material: ExecutionContractMaterial): string {
  return createHash("sha256")
    .update(stableJson(material))
    .digest("hex");
}

function buildContractSnapshot(
  config: AgentRunExecutionConfig,
  sourceMap: ExecutionConfigSourceMap
): AgentRunExecutionContract {
  const material = buildExecutionContractMaterial(config);
  return {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    hash: hashExecutionContractMaterial(material),
    material,
    effectiveConfig: config,
    fallbackUsed: EXECUTION_CONFIG_FIELDS.some((field) => sourceMap[field] === "env"),
    fallbackFields: EXECUTION_CONFIG_FIELDS.filter((field) => sourceMap[field] === "env")
  };
}

export function evaluateExecutionContractSupport(material: ExecutionContractMaterial): ExecutionContractSupportResult {
  const unsupportedFields: string[] = [];

  if (!SUPPORTED_EXECUTION_CONTRACT_RANGES.schemaVersions.includes(material.executionContractSchemaVersion)) {
    unsupportedFields.push(
      `executionContractSchemaVersion=${material.executionContractSchemaVersion}`
    );
  }
  if (!SUPPORTED_EXECUTION_CONTRACT_RANGES.determinismPolicyVersions.includes(material.determinismPolicyVersion)) {
    unsupportedFields.push(`determinismPolicyVersion=${material.determinismPolicyVersion}`);
  }
  if (!SUPPORTED_EXECUTION_CONTRACT_RANGES.plannerPolicyVersions.includes(material.plannerPolicyVersion)) {
    unsupportedFields.push(`plannerPolicyVersion=${material.plannerPolicyVersion}`);
  }
  if (!SUPPORTED_EXECUTION_CONTRACT_RANGES.correctionRecipeVersions.includes(material.correctionRecipeVersion)) {
    unsupportedFields.push(`correctionRecipeVersion=${material.correctionRecipeVersion}`);
  }
  if (!SUPPORTED_EXECUTION_CONTRACT_RANGES.validationPolicyVersions.includes(material.validationPolicyVersion)) {
    unsupportedFields.push(`validationPolicyVersion=${material.validationPolicyVersion}`);
  }
  if (!SUPPORTED_EXECUTION_CONTRACT_RANGES.randomnessSeeds.includes(material.randomnessSeed)) {
    unsupportedFields.push(`randomnessSeed=${material.randomnessSeed}`);
  }

  if (!unsupportedFields.length) {
    return {
      supported: true
    };
  }

  return {
    supported: false,
    code: "UNSUPPORTED_CONTRACT",
    message: `Unsupported execution contract material: ${unsupportedFields.join(", ")}`,
    details: {
      unsupportedFields,
      supportedRanges: SUPPORTED_EXECUTION_CONTRACT_RANGES
    }
  };
}

function normalizeExecutionConfig(
  rawInput: unknown,
  envFallback: ExecutionConfigEnvFallback,
  options?: {
    executionProfile?: ExecutionProfileMode;
    baseConfig?: AgentRunExecutionConfig;
    preserveBaseProfile?: boolean;
  }
): { config: AgentRunExecutionConfig; sourceMap: ExecutionConfigSourceMap } {
  const raw = toRecord(rawInput) || {};
  const profile =
    parseProfile(raw.profile) ||
    (options?.preserveBaseProfile ? options.baseConfig?.profile : null) ||
    envFallback.profile ||
    "full";
  const profileSource: ExecutionConfigSource =
    parseProfile(raw.profile) !== null
      ? "raw"
      : options?.preserveBaseProfile && options.baseConfig?.profile
        ? "base"
        : envFallback.profile
          ? "env"
          : "default";
  const base =
    options?.baseConfig && options?.preserveBaseProfile
      ? { ...options.baseConfig }
      : {
          schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
          profile,
          lightValidationMode: envFallback.lightValidationMode,
          heavyValidationMode: envFallback.heavyValidationMode,
          maxRuntimeCorrectionAttempts: envFallback.maxRuntimeCorrectionAttempts,
          maxHeavyCorrectionAttempts: envFallback.maxHeavyCorrectionAttempts,
          correctionPolicyMode: envFallback.correctionPolicyMode,
          correctionConvergenceMode: envFallback.correctionConvergenceMode,
          plannerTimeoutMs: envFallback.plannerTimeoutMs,
          maxFilesPerStep: envFallback.maxFilesPerStep,
          maxTotalDiffBytes: envFallback.maxTotalDiffBytes,
          maxFileBytes: envFallback.maxFileBytes,
          allowEnvMutation: envFallback.allowEnvMutation,
          ...executionConfigPreset(profile)
        };
  const sourceMap: ExecutionConfigSourceMap = options?.baseConfig && options?.preserveBaseProfile
    ? {
        schemaVersion: "base",
        profile: "base",
        lightValidationMode: "base",
        heavyValidationMode: "base",
        maxRuntimeCorrectionAttempts: "base",
        maxHeavyCorrectionAttempts: "base",
        correctionPolicyMode: "base",
        correctionConvergenceMode: "base",
        plannerTimeoutMs: "base",
        maxFilesPerStep: "base",
        maxTotalDiffBytes: "base",
        maxFileBytes: "base",
        allowEnvMutation: "base"
      }
    : {
        schemaVersion: "default",
        profile: profileSource,
        lightValidationMode: "env",
        heavyValidationMode: "env",
        maxRuntimeCorrectionAttempts: "env",
        maxHeavyCorrectionAttempts: "env",
        correctionPolicyMode: "env",
        correctionConvergenceMode: "env",
        plannerTimeoutMs: "env",
        maxFilesPerStep: "env",
        maxTotalDiffBytes: "env",
        maxFileBytes: "env",
        allowEnvMutation: "env"
      };
  const preset = executionConfigPreset(profile);
  for (const [field, value] of Object.entries(preset) as Array<[keyof AgentRunExecutionConfig, unknown]>) {
    if (value !== undefined) {
      sourceMap[field] = "preset";
    }
  }

  const normalized: AgentRunExecutionConfig = {
    ...base,
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile
  };

  const schemaVersion = parseBoundedInt(raw.schemaVersion, EXECUTION_CONFIG_SCHEMA_VERSION, EXECUTION_CONFIG_SCHEMA_VERSION);
  if (raw.schemaVersion !== undefined && schemaVersion !== EXECUTION_CONFIG_SCHEMA_VERSION) {
    throw new Error(`Unsupported execution config schemaVersion: ${String(raw.schemaVersion)}`);
  }

  const lightValidationMode = parseValidationMode(raw.lightValidationMode);
  if (lightValidationMode) {
    normalized.lightValidationMode = lightValidationMode;
    sourceMap.lightValidationMode = "raw";
  }

  const heavyValidationMode = parseValidationMode(raw.heavyValidationMode);
  if (heavyValidationMode) {
    normalized.heavyValidationMode = heavyValidationMode;
    sourceMap.heavyValidationMode = "raw";
  }

  const correctionPolicyMode = parseValidationMode(raw.correctionPolicyMode);
  if (correctionPolicyMode) {
    normalized.correctionPolicyMode = correctionPolicyMode;
    sourceMap.correctionPolicyMode = "raw";
  }

  const correctionConvergenceMode = parseValidationMode(raw.correctionConvergenceMode);
  if (correctionConvergenceMode) {
    normalized.correctionConvergenceMode = correctionConvergenceMode;
    sourceMap.correctionConvergenceMode = "raw";
  }

  const maxRuntimeCorrectionAttempts = parseBoundedInt(raw.maxRuntimeCorrectionAttempts, 0, 5);
  if (maxRuntimeCorrectionAttempts !== null) {
    normalized.maxRuntimeCorrectionAttempts = maxRuntimeCorrectionAttempts;
    sourceMap.maxRuntimeCorrectionAttempts = "raw";
  }

  const maxHeavyCorrectionAttempts = parseBoundedInt(raw.maxHeavyCorrectionAttempts, 0, 3);
  if (maxHeavyCorrectionAttempts !== null) {
    normalized.maxHeavyCorrectionAttempts = maxHeavyCorrectionAttempts;
    sourceMap.maxHeavyCorrectionAttempts = "raw";
  }

  const plannerTimeoutMs = parseBoundedInt(raw.plannerTimeoutMs, 1_000, 300_000);
  if (plannerTimeoutMs !== null) {
    normalized.plannerTimeoutMs = plannerTimeoutMs;
    sourceMap.plannerTimeoutMs = "raw";
  }

  const maxFilesPerStep = parseBoundedInt(raw.maxFilesPerStep, 1, 100);
  if (maxFilesPerStep !== null) {
    normalized.maxFilesPerStep = maxFilesPerStep;
    sourceMap.maxFilesPerStep = "raw";
  }

  const maxTotalDiffBytes = parseBoundedInt(raw.maxTotalDiffBytes, 1_000, 10_000_000);
  if (maxTotalDiffBytes !== null) {
    normalized.maxTotalDiffBytes = maxTotalDiffBytes;
    sourceMap.maxTotalDiffBytes = "raw";
  }

  const maxFileBytes = parseBoundedInt(raw.maxFileBytes, 1_000, 20_000_000);
  if (maxFileBytes !== null) {
    normalized.maxFileBytes = maxFileBytes;
    sourceMap.maxFileBytes = "raw";
  }

  if (typeof raw.allowEnvMutation === "boolean") {
    normalized.allowEnvMutation = raw.allowEnvMutation;
    sourceMap.allowEnvMutation = "raw";
  }

  if ((options?.executionProfile || "default") === "builder") {
    normalized.lightValidationMode = "off";
    normalized.heavyValidationMode = "off";
    sourceMap.lightValidationMode = "preset";
    sourceMap.heavyValidationMode = "preset";
  }

  return {
    config: executionConfigSchema.parse(normalized),
    sourceMap
  };
}

export function resolveExecutionConfig(
  persistedRaw: unknown,
  requestedRaw: unknown,
  envFallback: ExecutionConfigEnvFallback,
  options?: {
    executionProfile?: ExecutionProfileMode;
  }
): ResolvedExecutionConfigContract {
  const persistedRecord = toRecord(persistedRaw);
  const requestedRecord = toRecord(requestedRaw);
  const persistedWasPresent = persistedRecord !== null;
  const persistedNormalized = normalizeExecutionConfig(persistedRecord, envFallback, {
    executionProfile: options?.executionProfile
  });
  const persistedExecutionConfig = persistedNormalized.config;
  const persistedContract = buildContractSnapshot(persistedExecutionConfig, persistedNormalized.sourceMap);

  if (!requestedRecord || Object.keys(requestedRecord).length === 0) {
    return {
      persistedExecutionConfig,
      requestedExecutionConfig: persistedExecutionConfig,
      persistedWasPresent,
      diff: [],
      persistedContract,
      requestedContract: persistedContract
    };
  }

  const requestedProfile = parseProfile(requestedRecord.profile);
  const requestedNormalized = normalizeExecutionConfig(
    requestedRecord,
    envFallback,
    requestedProfile
      ? {
          executionProfile: options?.executionProfile
        }
      : {
          executionProfile: options?.executionProfile,
          baseConfig: persistedExecutionConfig,
          preserveBaseProfile: true
        }
  );
  const requestedExecutionConfig = requestedNormalized.config;

  return {
    persistedExecutionConfig,
    requestedExecutionConfig,
    persistedWasPresent,
    diff: diffExecutionConfigs(persistedExecutionConfig, requestedExecutionConfig),
    persistedContract,
    requestedContract: buildContractSnapshot(requestedExecutionConfig, requestedNormalized.sourceMap)
  };
}

export function diffExecutionConfigs(
  persisted: AgentRunExecutionConfig,
  requested: AgentRunExecutionConfig
): ExecutionConfigDiffEntry[] {
  return EXECUTION_CONFIG_FIELDS.filter((field) => persisted[field] !== requested[field]).map((field) => ({
    field,
    persisted: persisted[field],
    requested: requested[field]
  }));
}

export function executionConfigsEqual(left: AgentRunExecutionConfig, right: AgentRunExecutionConfig): boolean {
  return diffExecutionConfigs(left, right).length === 0;
}

export function persistedExecutionConfigNeedsNormalization(
  rawPersisted: unknown,
  resolved: AgentRunExecutionConfig,
  envFallback: ExecutionConfigEnvFallback,
  options?: {
    executionProfile?: ExecutionProfileMode;
  }
): boolean {
  const raw = toRecord(rawPersisted);
  if (!raw) {
    return true;
  }

  if (raw.schemaVersion !== EXECUTION_CONFIG_SCHEMA_VERSION) {
    return true;
  }

  const reparsed = normalizeExecutionConfig(raw, envFallback, {
    executionProfile: options?.executionProfile
  });
  return !executionConfigsEqual(reparsed.config, resolved);
}

export function buildExecutionContract(config: AgentRunExecutionConfig): AgentRunExecutionContract {
  const normalized = executionConfigSchema.parse(config);
  const sourceMap = EXECUTION_CONFIG_FIELDS.reduce<ExecutionConfigSourceMap>((accumulator, field) => {
    accumulator[field] = field === "schemaVersion" ? "default" : "raw";
    return accumulator;
  }, {} as ExecutionConfigSourceMap);

  return buildContractSnapshot(normalized, sourceMap);
}

export function formatExecutionConfigDiffSummary(diff: ExecutionConfigDiffEntry[]): string {
  if (!diff.length) {
    return "no differences";
  }

  return diff
    .map((entry) => `${entry.field}: ${String(entry.persisted)} -> ${String(entry.requested)}`)
    .join(", ");
}

export class ExecutionContractMismatchError extends Error {
  readonly persisted: AgentRunExecutionConfig;
  readonly requested: AgentRunExecutionConfig;
  readonly diff: ExecutionConfigDiffEntry[];

  constructor(input: {
    persisted: AgentRunExecutionConfig;
    requested: AgentRunExecutionConfig;
    diff: ExecutionConfigDiffEntry[];
  }) {
    super(
      `Execution config mismatch. Fields differ: ${formatExecutionConfigDiffSummary(input.diff)}. ` +
        "Use --override-execution-config to resume in place or --fork to create a new run with a different execution contract."
    );
    this.name = "ExecutionContractMismatchError";
    this.persisted = input.persisted;
    this.requested = input.requested;
    this.diff = input.diff;
  }
}
