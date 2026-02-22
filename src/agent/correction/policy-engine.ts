import { AgentStep, AgentStepExecutionStatus, PlannerCorrectionConstraint } from "../types.js";

export interface CorrectionPolicyViolation {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface CorrectionPolicyResult {
  ok: boolean;
  blockingCount: number;
  warningCount: number;
  summary: string;
  violations: CorrectionPolicyViolation[];
}

export interface EvaluateCorrectionPolicyInput {
  step: AgentStep;
  status: AgentStepExecutionStatus;
  errorMessage: string | null;
  commitHash: string | null;
  outputPayload: Record<string, unknown>;
  resolvedConstraint: PlannerCorrectionConstraint | null;
  maxFilesPerStep: number;
  maxTotalDiffBytes: number;
}

interface ParsedCorrectionMetadata {
  phase: string;
  attempt: number;
  failedStepId: string;
  classificationIntent: string;
  constraint: PlannerCorrectionConstraint | null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }

  return Array.from(deduped.values());
}

function normalizePathPrefix(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function normalizeIntent(value: unknown): string {
  const normalized = String(value || "").trim();
  switch (normalized) {
    case "runtime_boot":
    case "runtime_health":
    case "typescript_compile":
    case "test_failure":
    case "migration_failure":
    case "architecture_violation":
    case "security_baseline":
    case "unknown":
      return normalized;
    default:
      return "unknown";
  }
}

function parseConstraint(value: unknown): PlannerCorrectionConstraint | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const maxFiles = Number(record.maxFiles);
  const maxTotalDiffBytes = Number(record.maxTotalDiffBytes);
  const allowedPathPrefixes = toStringArray(record.allowedPathPrefixes)
    .map((entry) => normalizePathPrefix(entry))
    .filter(Boolean);

  return {
    intent: normalizeIntent(record.intent) as PlannerCorrectionConstraint["intent"],
    maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : 0,
    maxTotalDiffBytes: Number.isFinite(maxTotalDiffBytes) && maxTotalDiffBytes > 0 ? Math.floor(maxTotalDiffBytes) : 0,
    allowedPathPrefixes,
    guidance: toStringArray(record.guidance)
  };
}

function parseCorrectionAttemptFromStepId(stepId: string): number | null {
  const match = stepId.match(/^(?:runtime|validation)-correction-(\d+)$/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1] || "", 10);
}

function parseMetadata(step: AgentStep): ParsedCorrectionMetadata | null {
  const deep = toRecord(step.input?._deepCorrection);
  if (!deep) {
    return null;
  }

  const classification = toRecord(deep.classification);
  const attempt = Number(deep.attempt);
  const phase = typeof deep.phase === "string" ? deep.phase.trim() : "";
  const failedStepId = typeof deep.failedStepId === "string" ? deep.failedStepId.trim() : "";

  return {
    phase,
    attempt: Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0,
    failedStepId,
    classificationIntent: normalizeIntent(classification?.intent),
    constraint: parseConstraint(deep.constraint)
  };
}

function isPathAllowed(pathValue: string, allowedPathPrefixes: string[]): boolean {
  if (!allowedPathPrefixes.length) {
    return false;
  }

  const normalizedPath = normalizePathPrefix(pathValue);

  for (const prefixCandidate of allowedPathPrefixes) {
    const prefix = normalizePathPrefix(prefixCandidate);
    if (!prefix) {
      continue;
    }

    const isDirectoryPrefix = prefix.endsWith("/");
    if (isDirectoryPrefix) {
      if (normalizedPath.startsWith(prefix)) {
        return true;
      }
      continue;
    }

    if (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)) {
      return true;
    }
  }

  return false;
}

function addViolation(
  violations: CorrectionPolicyViolation[],
  ruleId: string,
  severity: "error" | "warning",
  message: string,
  details?: Record<string, unknown>
): void {
  violations.push({
    ruleId,
    severity,
    message,
    details
  });
}

function summarizeViolations(violations: CorrectionPolicyViolation[]): CorrectionPolicyResult {
  const blocking = violations.filter((entry) => entry.severity === "error");
  const warningCount = violations.length - blocking.length;
  const ruleIds = blocking.map((entry) => entry.ruleId);

  return {
    ok: blocking.length === 0,
    blockingCount: blocking.length,
    warningCount,
    summary:
      blocking.length === 0
        ? `correction policy passed; warnings=${warningCount}`
        : `failed rules: ${ruleIds.join(", ")}; blocking=${blocking.length}; warnings=${warningCount}`,
    violations
  };
}

function sortUniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function evaluateCorrectionPolicy(input: EvaluateCorrectionPolicyInput): CorrectionPolicyResult {
  const violations: CorrectionPolicyViolation[] = [];
  const metadata = parseMetadata(input.step);
  const expectedAttempt = parseCorrectionAttemptFromStepId(input.step.id);

  if (!metadata) {
    addViolation(
      violations,
      "correction_metadata_present",
      "error",
      `Correction step '${input.step.id}' is missing _deepCorrection metadata.`
    );
    return summarizeViolations(violations);
  }

  if (!metadata.phase) {
    addViolation(violations, "correction_phase_present", "error", "Correction metadata missing phase.");
  }

  if (metadata.attempt <= 0) {
    addViolation(violations, "correction_attempt_present", "error", "Correction metadata attempt must be >= 1.");
  }

  if (expectedAttempt !== null && metadata.attempt > 0 && metadata.attempt !== expectedAttempt) {
    addViolation(
      violations,
      "correction_attempt_suffix_match",
      "error",
      `Correction metadata attempt ${metadata.attempt} does not match step suffix ${expectedAttempt}.`,
      {
        stepId: input.step.id
      }
    );
  }

  if (!metadata.failedStepId) {
    addViolation(violations, "correction_failed_step_present", "error", "Correction metadata missing failedStepId.");
  }

  if (!metadata.constraint) {
    addViolation(violations, "correction_constraint_present", "error", "Correction metadata missing constraint object.");
  } else {
    if (metadata.constraint.maxFiles <= 0) {
      addViolation(violations, "correction_constraint_max_files", "error", "Constraint maxFiles must be >= 1.");
    }

    if (metadata.constraint.maxTotalDiffBytes <= 0) {
      addViolation(
        violations,
        "correction_constraint_max_diff_bytes",
        "error",
        "Constraint maxTotalDiffBytes must be >= 1."
      );
    }

    if (metadata.constraint.allowedPathPrefixes.length === 0) {
      addViolation(
        violations,
        "correction_constraint_allowed_prefixes",
        "error",
        "Constraint allowedPathPrefixes cannot be empty."
      );
    }

    if (metadata.constraint.maxFiles > input.maxFilesPerStep) {
      addViolation(
        violations,
        "correction_constraint_max_files_exceeds_global",
        "error",
        `Constraint maxFiles ${metadata.constraint.maxFiles} exceeds global cap ${input.maxFilesPerStep}.`
      );
    }

    if (metadata.constraint.maxTotalDiffBytes > input.maxTotalDiffBytes) {
      addViolation(
        violations,
        "correction_constraint_max_diff_exceeds_global",
        "error",
        `Constraint maxTotalDiffBytes ${metadata.constraint.maxTotalDiffBytes} exceeds global cap ${input.maxTotalDiffBytes}.`
      );
    }

    if (metadata.classificationIntent !== metadata.constraint.intent) {
      addViolation(
        violations,
        "correction_intent_constraint_match",
        "error",
        `Classification intent '${metadata.classificationIntent}' does not match constraint intent '${metadata.constraint.intent}'.`
      );
    }
  }

  if (input.resolvedConstraint && metadata.constraint) {
    const expectedPrefixes = sortUniqueStrings(input.resolvedConstraint.allowedPathPrefixes.map(normalizePathPrefix));
    const metadataPrefixes = sortUniqueStrings(metadata.constraint.allowedPathPrefixes.map(normalizePathPrefix));
    const prefixesMatch =
      expectedPrefixes.length === metadataPrefixes.length &&
      expectedPrefixes.every((entry, index) => entry === metadataPrefixes[index]);

    if (
      input.resolvedConstraint.intent !== metadata.constraint.intent ||
      input.resolvedConstraint.maxFiles !== metadata.constraint.maxFiles ||
      input.resolvedConstraint.maxTotalDiffBytes !== metadata.constraint.maxTotalDiffBytes ||
      !prefixesMatch
    ) {
      addViolation(
        violations,
        "correction_constraint_resolved_consistency",
        "error",
        "Resolved correction constraint does not match metadata constraint."
      );
    }
  }

  const stagedDiffRaw = Array.isArray(input.outputPayload.stagedDiffs) ? input.outputPayload.stagedDiffs : [];
  const stagedDiffs = stagedDiffRaw
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  if (input.status === "completed") {
    if (!input.commitHash) {
      addViolation(
        violations,
        "correction_commit_required",
        "error",
        `Correction step '${input.step.id}' completed without a commit hash.`
      );
    }

    if (stagedDiffs.length === 0) {
      addViolation(
        violations,
        "correction_staged_diffs_required",
        "error",
        `Correction step '${input.step.id}' completed without staged diffs.`
      );
    }
  }

  if (metadata.constraint && stagedDiffs.length > 0) {
    if (stagedDiffs.length > metadata.constraint.maxFiles) {
      addViolation(
        violations,
        "correction_staged_files_within_constraint",
        "error",
        `Staged diff count ${stagedDiffs.length} exceeds correction maxFiles ${metadata.constraint.maxFiles}.`
      );
    }

    const disallowedPaths: string[] = [];
    let approximateDiffBytes = 0;

    for (const entry of stagedDiffs) {
      const path = typeof entry.path === "string" ? entry.path : "";
      const diffPreview = typeof entry.diffPreview === "string" ? entry.diffPreview : "";
      approximateDiffBytes += diffPreview.length;
      if (path && !isPathAllowed(path, metadata.constraint.allowedPathPrefixes)) {
        disallowedPaths.push(path);
      }
    }

    if (disallowedPaths.length > 0) {
      addViolation(
        violations,
        "correction_staged_paths_within_constraint",
        "error",
        `Staged paths outside allowedPathPrefixes: ${disallowedPaths.slice(0, 5).join(", ")}.`
      );
    }

    if (approximateDiffBytes > metadata.constraint.maxTotalDiffBytes) {
      addViolation(
        violations,
        "correction_staged_diff_bytes_within_constraint",
        "error",
        `Approx staged diff bytes ${approximateDiffBytes} exceed maxTotalDiffBytes ${metadata.constraint.maxTotalDiffBytes}.`
      );
    }
  }

  if (input.status === "failed" && !input.errorMessage) {
    addViolation(
      violations,
      "correction_failed_error_message_present",
      "warning",
      `Correction step '${input.step.id}' failed without errorMessage.`
    );
  }

  return summarizeViolations(violations);
}
