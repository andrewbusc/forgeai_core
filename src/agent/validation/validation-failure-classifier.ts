export type CorrectionProfileReason = "architecture" | "typecheck" | "build" | null;

export interface ArchitectureContractCluster {
  type: "architecture_contract";
  modules?: string[];
  missingLayers?: string[];
  unknownLayerFiles?: string[];
}

export interface DependencyCycleCluster {
  type: "dependency_cycle";
  cycles?: string[];
}

export interface RuntimeMiddlewareApiCluster {
  type: "runtime_middleware_api";
  message?: string;
}

export interface LayerBoundaryViolationCluster {
  type: "layer_boundary_violation";
  files?: string[];
  edges?: Array<{
    file: string;
    sourceLayer?: string;
    targetLayer?: string;
    target?: string;
  }>;
}

export interface ImportResolutionErrorCluster {
  type: "import_resolution_error";
  files?: string[];
  imports?: string[];
}

export interface TestContractGapCluster {
  type: "test_contract_gap";
  modules?: string[];
}

export interface TypecheckFailureCluster {
  type: "typecheck_failure";
}

export interface BuildFailureCluster {
  type: "build_failure";
}

export interface TestFailureCluster {
  type: "test_failure";
}

export type CorrectionCluster =
  | ArchitectureContractCluster
  | DependencyCycleCluster
  | RuntimeMiddlewareApiCluster
  | LayerBoundaryViolationCluster
  | ImportResolutionErrorCluster
  | TestContractGapCluster
  | TypecheckFailureCluster
  | BuildFailureCluster
  | TestFailureCluster;

export interface CorrectionProfile {
  shouldAutoCorrect: boolean;
  clusters: CorrectionCluster[];
  architectureCollapse?: boolean;
  plannerModeOverride?: "feature_reintegration" | "architecture_reconstruction" | "debt_resolution";
  debtTargets?: Array<{
    path: string;
    exportsSummary?: Record<string, unknown> | null;
  }>;
  reason: CorrectionProfileReason;
  blockingCount: number;
  architectureModules?: string[];
}

interface ValidationCheckLike {
  id?: unknown;
  status?: unknown;
  message?: unknown;
  details?: unknown;
}

interface ValidationPayloadLike {
  ok?: unknown;
  blockingCount?: unknown;
  checks?: unknown;
}

interface PrecommitInvariantPayloadLike {
  blockingCount?: unknown;
  violations?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeBlockingCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeChecks(value: unknown): ValidationCheckLike[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is ValidationCheckLike => Boolean(asRecord(entry)));
}

function normalizeCheckId(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeCheckStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function findFailedCheck(checks: ValidationCheckLike[], checkId: string): ValidationCheckLike | undefined {
  return checks.find(
    (check) => normalizeCheckId(check.id) === checkId && normalizeCheckStatus(check.status) === "fail"
  );
}

function extractValidationPayload(input: unknown): ValidationPayloadLike | null {
  const root = asRecord(input);
  if (!root) {
    return null;
  }

  const nestedValidation = asRecord(root.validation);
  if (nestedValidation && Array.isArray(nestedValidation.checks)) {
    return nestedValidation as ValidationPayloadLike;
  }

  if (Array.isArray(root.checks)) {
    return root as ValidationPayloadLike;
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractModuleNamesFromText(value: string): string[] {
  const modules = new Set<string>();

  const normalized = value.replaceAll("\\", "/");
  for (const match of normalized.matchAll(/(?:^|\/)src\/modules\/([^/]+)/g)) {
    const moduleName = String(match[1] || "").trim();
    if (moduleName) {
      modules.add(moduleName);
    }
  }

  const messageModuleMatch = normalized.match(/Module '([^']+)'/i);
  if (messageModuleMatch?.[1]) {
    modules.add(messageModuleMatch[1].trim());
  }

  const crossModuleMatch = normalized.match(/from '([^']+)'\s+to '([^']+)'/i);
  if (crossModuleMatch?.[1]) {
    modules.add(crossModuleMatch[1].trim());
  }
  if (crossModuleMatch?.[2]) {
    modules.add(crossModuleMatch[2].trim());
  }

  return Array.from(modules);
}

interface ArchitectureViolationSummary {
  modules: string[];
  missingLayers: string[];
  unknownLayerFiles: string[];
  cycles: string[];
  architectureBlockingCount: number;
  hasArchitectureContractViolation: boolean;
  layerBoundaryViolations: Array<{
    file: string;
    target?: string;
    sourceLayer?: string;
    targetLayer?: string;
  }>;
  importResolutionViolations: Array<{
    file: string;
    importTarget: string;
  }>;
  testContractGapModules: string[];
}

function basenameLike(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

function extractArchitectureViolationSummary(details: unknown): ArchitectureViolationSummary {
  const detailRecord = asRecord(details);
  if (!detailRecord || !Array.isArray(detailRecord.violations)) {
    return {
      modules: [],
      missingLayers: [],
      unknownLayerFiles: [],
      cycles: [],
      architectureBlockingCount: 0,
      hasArchitectureContractViolation: false,
      layerBoundaryViolations: [],
      importResolutionViolations: [],
      testContractGapModules: []
    };
  }

  const modules = new Set<string>();
  const missingLayers = new Set<string>();
  const unknownLayerFiles = new Set<string>();
  const cycles = new Set<string>();
  const layerBoundaryViolations: Array<{
    file: string;
    target?: string;
    sourceLayer?: string;
    targetLayer?: string;
  }> = [];
  const importResolutionViolations: Array<{
    file: string;
    importTarget: string;
  }> = [];
  const testContractGapModules = new Set<string>();
  let hasArchitectureContractViolation = false;

  for (const violation of detailRecord.violations) {
    const violationRecord = asRecord(violation);
    if (!violationRecord) {
      continue;
    }

    const candidates = [violationRecord.file, violationRecord.target, violationRecord.message];
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        continue;
      }

      for (const moduleName of extractModuleNamesFromText(candidate)) {
        if (moduleName) {
          modules.add(moduleName);
        }
      }
    }

    const ruleId = asString(violationRecord.ruleId) || "";
    const message = asString(violationRecord.message) || "";
    const file = asString(violationRecord.file) || "";

    if (ruleId === "GRAPH.CYCLE") {
      if (message) {
        cycles.add(message);
      }
      continue;
    }

    if (
      ruleId.startsWith("ARCH.") ||
      ruleId.startsWith("STRUCTURE.") ||
      ruleId.startsWith("TEST.CONTRACT_")
    ) {
      hasArchitectureContractViolation = true;
    }

    if (ruleId === "STRUCTURE.MODULE_LAYER_REQUIRED") {
      const layerMatch = message.match(/layer directory '([^']+)'/i);
      if (layerMatch?.[1]) {
        missingLayers.add(layerMatch[1].trim());
      }
    }

    if (ruleId === "ARCH.UNKNOWN_LAYER" && file) {
      unknownLayerFiles.add(basenameLike(file));
    }

    if (ruleId === "ARCH.LAYER_MATRIX" && file) {
      const layerMatch = message.match(/Layer '([^']+)' cannot import layer '([^']+)'/i);
      layerBoundaryViolations.push({
        file,
        ...(asString(violationRecord.target) ? { target: asString(violationRecord.target) || undefined } : {}),
        ...(layerMatch?.[1] ? { sourceLayer: layerMatch[1].trim() } : {}),
        ...(layerMatch?.[2] ? { targetLayer: layerMatch[2].trim() } : {})
      });
    }

    if (ruleId === "IMPORT.MISSING_TARGET") {
      const importTarget = asString(violationRecord.target);
      if (file && importTarget) {
        importResolutionViolations.push({
          file,
          importTarget
        });
      }
    }

    if (ruleId === "TEST.CONTRACT_VALIDATION_FAILURE_REQUIRED" || /^TEST\.CONTRACT_SERVICE_/.test(ruleId)) {
      for (const moduleName of extractModuleNamesFromText([file, message].filter(Boolean).join(" "))) {
        if (moduleName) {
          testContractGapModules.add(moduleName);
        }
      }
    }
  }

  return {
    modules: Array.from(modules).sort(),
    missingLayers: Array.from(missingLayers).sort(),
    unknownLayerFiles: Array.from(unknownLayerFiles).sort(),
    cycles: Array.from(cycles),
    architectureBlockingCount: normalizeBlockingCount(detailRecord.blockingCount),
    hasArchitectureContractViolation,
    layerBoundaryViolations,
    importResolutionViolations,
    testContractGapModules: Array.from(testContractGapModules).sort()
  };
}

function collectCheckTextFragments(check: ValidationCheckLike): string[] {
  const fragments: string[] = [];
  const message = asString(check.message);
  if (message) {
    fragments.push(message);
  }

  const details = asRecord(check.details);
  if (!details) {
    return fragments;
  }

  const directStrings = [details.stderr, details.logs, details.lastProbeError];
  for (const candidate of directStrings) {
    const text = asString(candidate);
    if (text) {
      fragments.push(text);
    }
  }

  return fragments;
}

function extractPrecommitInvariantPayload(input: unknown): PrecommitInvariantPayloadLike | null {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  if (Array.isArray(record.violations)) {
    return record as PrecommitInvariantPayloadLike;
  }

  const nestedInvariant = asRecord(record.invariantViolation);
  if (nestedInvariant && Array.isArray(nestedInvariant.violations)) {
    return nestedInvariant as PrecommitInvariantPayloadLike;
  }

  return null;
}

function detectLayerFromSrcPath(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/");
  const match = normalized.match(/^src\/modules\/[^/]+\/(controller|service|repository|schema|dto|tests)\//);
  if (match?.[1]) {
    return match[1];
  }

  if (normalized.startsWith("src/db/")) {
    return "db";
  }

  return undefined;
}

function detectRuntimeMiddlewareApiIssue(checks: ValidationCheckLike[]): RuntimeMiddlewareApiCluster | null {
  const patterns = [/\$use\s+is not a function/i, /TypeError:\s*prisma\.\$use/i, /prisma\.\$use\(/i];

  for (const check of checks) {
    if (normalizeCheckStatus(check.status) !== "fail") {
      continue;
    }

    for (const fragment of collectCheckTextFragments(check)) {
      if (patterns.some((pattern) => pattern.test(fragment))) {
        const message = fragment.split("\n").find((line) => line.trim())?.trim() || "prisma.$use is not a function";
        return {
          type: "runtime_middleware_api",
          message
        };
      }
    }
  }

  return null;
}

function parseImportResolutionSignalsFromText(text: string): {
  files: string[];
  imports: string[];
} {
  const files = new Set<string>();
  const imports = new Set<string>();
  const normalized = text.replaceAll("\\", "/");

  for (const match of normalized.matchAll(/Cannot find module ['"]([^'"]+)['"]/gi)) {
    const importTarget = String(match[1] || "").trim();
    if (importTarget) {
      imports.add(importTarget);
    }
  }

  for (const match of normalized.matchAll(/ERR_MODULE_NOT_FOUND[\s\S]{0,500}?file:\/\/[^\n]*?(\/(?:src|dist)\/[^\s'"]+)/gi)) {
    const filePath = String(match[1] || "").trim();
    if (filePath) {
      files.add(filePath);
    }
  }

  for (const match of normalized.matchAll(/(?:imported from|in)\s+['"]([^'"]+)['"]/gi)) {
    const filePath = String(match[1] || "").trim();
    if (filePath.includes("/src/") || filePath.includes("/dist/")) {
      files.add(filePath);
    }
  }

  for (const match of normalized.matchAll(/[❯>]\s+(src\/[^\s:]+):\d+:\d+/g)) {
    const filePath = String(match[1] || "").trim();
    if (filePath) {
      files.add(filePath);
    }
  }

  return {
    files: Array.from(files),
    imports: Array.from(imports)
  };
}

function detectImportResolutionIssues(checks: ValidationCheckLike[]): ImportResolutionErrorCluster | null {
  const fileSet = new Set<string>();
  const importSet = new Set<string>();
  const patterns = [/ERR_MODULE_NOT_FOUND/i, /Cannot find module/i, /\.js'/, /\.ts'/];
  let matched = false;

  for (const check of checks) {
    if (normalizeCheckStatus(check.status) !== "fail") {
      continue;
    }

    for (const fragment of collectCheckTextFragments(check)) {
      if (!patterns.some((pattern) => pattern.test(fragment))) {
        continue;
      }
      matched = true;
      const extracted = parseImportResolutionSignalsFromText(fragment);
      for (const file of extracted.files) {
        fileSet.add(file);
      }
      for (const importTarget of extracted.imports) {
        importSet.add(importTarget);
      }
    }
  }

  if (!matched) {
    return null;
  }

  return {
    type: "import_resolution_error",
    ...(fileSet.size ? { files: Array.from(fileSet).sort() } : {}),
    ...(importSet.size ? { imports: Array.from(importSet).sort() } : {})
  };
}

function hasFailedCheck(checks: ValidationCheckLike[], checkId: string): boolean {
  return Boolean(findFailedCheck(checks, checkId));
}

function deriveLegacyReason(input: {
  architectureContract: boolean;
  typecheckFail: boolean;
  buildFail: boolean;
}): CorrectionProfileReason {
  if (input.architectureContract) {
    return "architecture";
  }
  if (input.typecheckFail) {
    return "typecheck";
  }
  if (input.buildFail) {
    return "build";
  }
  return null;
}

const ARCHITECTURE_COLLAPSE_MISSING_LAYER_THRESHOLD = 2;
const ARCHITECTURE_COLLAPSE_UNKNOWN_LAYER_FILE_THRESHOLD = 2;
const ARCHITECTURE_COLLAPSE_ARCH_BLOCKING_THRESHOLD = 8;
const ARCHITECTURE_COLLAPSE_SCORE_THRESHOLD = 3;

function computeArchitectureCollapseScore(input: {
  missingLayers: string[];
  unknownLayerFiles: string[];
  cycles: string[];
  architectureBlockingCount: number;
}): number {
  let collapseScore = 0;

  if (input.missingLayers.length >= ARCHITECTURE_COLLAPSE_MISSING_LAYER_THRESHOLD) {
    collapseScore += 2;
  }

  if (input.unknownLayerFiles.length >= ARCHITECTURE_COLLAPSE_UNKNOWN_LAYER_FILE_THRESHOLD) {
    collapseScore += 2;
  }

  if (input.cycles.length > 0) {
    collapseScore += 3;
  }

  if (input.architectureBlockingCount >= ARCHITECTURE_COLLAPSE_ARCH_BLOCKING_THRESHOLD) {
    collapseScore += 2;
  }

  return collapseScore;
}

export function classifyValidationFailure(input: unknown): CorrectionProfile {
  const validation = extractValidationPayload(input);
  const blockingCount = normalizeBlockingCount(validation?.blockingCount);

  if (!validation) {
    return {
      shouldAutoCorrect: false,
      clusters: [],
      architectureCollapse: false,
      reason: null,
      blockingCount
    };
  }

  if (validation.ok === true) {
    return {
      shouldAutoCorrect: false,
      clusters: [],
      architectureCollapse: false,
      reason: null,
      blockingCount
    };
  }

  const checks = normalizeChecks(validation.checks);
  const clusters: CorrectionCluster[] = [];
  const architectureCheck = findFailedCheck(checks, "architecture");
  let architectureModules: string[] | undefined;
  let hasArchitectureContractViolation = false;
  let architectureCollapseScore = 0;

  if (architectureCheck) {
    const summary = extractArchitectureViolationSummary(architectureCheck.details);
    architectureModules = summary.modules;
    hasArchitectureContractViolation = summary.hasArchitectureContractViolation;
    architectureCollapseScore = computeArchitectureCollapseScore({
      missingLayers: summary.missingLayers,
      unknownLayerFiles: summary.unknownLayerFiles,
      cycles: summary.cycles,
      architectureBlockingCount: summary.architectureBlockingCount
    });

    if (summary.hasArchitectureContractViolation) {
      clusters.push({
        type: "architecture_contract",
        ...(summary.modules.length ? { modules: summary.modules } : {}),
        ...(summary.missingLayers.length ? { missingLayers: summary.missingLayers } : {}),
        ...(summary.unknownLayerFiles.length ? { unknownLayerFiles: summary.unknownLayerFiles } : {})
      });
    }

    if (summary.cycles.length) {
      clusters.push({
        type: "dependency_cycle",
        cycles: summary.cycles
      });
    }

    if (summary.layerBoundaryViolations.length) {
      const edges = summary.layerBoundaryViolations.map((violation) => ({
        file: violation.file,
        ...(violation.sourceLayer ? { sourceLayer: violation.sourceLayer } : {}),
        ...(violation.targetLayer ? { targetLayer: violation.targetLayer } : {}),
        ...(violation.target ? { target: violation.target } : {})
      }));
      const files = Array.from(new Set(summary.layerBoundaryViolations.map((violation) => violation.file))).sort();
      clusters.push({
        type: "layer_boundary_violation",
        ...(files.length ? { files } : {}),
        ...(edges.length ? { edges } : {})
      });
    }

    if (summary.importResolutionViolations.length) {
      const files = Array.from(new Set(summary.importResolutionViolations.map((violation) => violation.file))).sort();
      const imports = Array.from(
        new Set(summary.importResolutionViolations.map((violation) => violation.importTarget))
      ).sort();
      clusters.push({
        type: "import_resolution_error",
        ...(files.length ? { files } : {}),
        ...(imports.length ? { imports } : {})
      });
    }

    if (summary.testContractGapModules.length) {
      clusters.push({
        type: "test_contract_gap",
        modules: summary.testContractGapModules
      });
    }
  }

  const runtimeMiddlewareApiCluster = detectRuntimeMiddlewareApiIssue(checks);
  if (runtimeMiddlewareApiCluster) {
    clusters.push(runtimeMiddlewareApiCluster);
  }

  const stderrImportResolutionCluster = detectImportResolutionIssues(checks);
  if (stderrImportResolutionCluster) {
    const existing = clusters.find((cluster): cluster is ImportResolutionErrorCluster => cluster.type === "import_resolution_error");
    if (existing) {
      const files = new Set<string>(Array.isArray(existing.files) ? existing.files : []);
      const imports = new Set<string>(Array.isArray(existing.imports) ? existing.imports : []);
      for (const file of stderrImportResolutionCluster.files || []) {
        files.add(file);
      }
      for (const importTarget of stderrImportResolutionCluster.imports || []) {
        imports.add(importTarget);
      }
      if (files.size) {
        existing.files = Array.from(files).sort();
      }
      if (imports.size) {
        existing.imports = Array.from(imports).sort();
      }
    } else {
      clusters.push(stderrImportResolutionCluster);
    }
  }

  const typecheckFail = hasFailedCheck(checks, "typecheck");
  const buildFail = hasFailedCheck(checks, "build");
  const testsFail = hasFailedCheck(checks, "tests");

  if (typecheckFail) {
    clusters.push({ type: "typecheck_failure" });
  }

  if (buildFail) {
    clusters.push({ type: "build_failure" });
  }

  if (testsFail) {
    clusters.push({ type: "test_failure" });
  }

  const reason = deriveLegacyReason({
    architectureContract: hasArchitectureContractViolation,
    typecheckFail,
    buildFail
  });
  const shouldAutoCorrect = Boolean(reason) || clusters.some((cluster) => cluster.type === "runtime_middleware_api");
  const architectureCollapse =
    hasArchitectureContractViolation && architectureCollapseScore >= ARCHITECTURE_COLLAPSE_SCORE_THRESHOLD;

  return {
    shouldAutoCorrect,
    clusters,
    architectureCollapse,
    reason,
    blockingCount,
    ...(architectureModules?.length ? { architectureModules } : {})
  };
}

export function classifyPrecommitInvariantFailure(input: unknown): CorrectionProfile {
  const invariant = extractPrecommitInvariantPayload(input);
  const blockingCount = normalizeBlockingCount(invariant?.blockingCount);

  if (!invariant || !Array.isArray(invariant.violations) || invariant.violations.length === 0) {
    return {
      shouldAutoCorrect: false,
      clusters: [],
      architectureCollapse: false,
      reason: null,
      blockingCount
    };
  }

  const modules = new Set<string>();
  const layerViolationFiles = new Set<string>();
  const importResolutionFiles = new Set<string>();
  const importResolutionTargets = new Set<string>();
  const testContractGapModules = new Set<string>();
  const layerEdges: Array<{
    file: string;
    sourceLayer?: string;
    targetLayer?: string;
    target?: string;
  }> = [];

  for (const violation of invariant.violations) {
    const violationRecord = asRecord(violation);
    if (!violationRecord) {
      continue;
    }

    const file = asString(violationRecord.file) || "";
    const target = asString(violationRecord.target) || "";
    const message = asString(violationRecord.message) || "";
    const ruleId = asString(violationRecord.ruleId) || "";

    for (const moduleName of extractModuleNamesFromText([file, target, message].filter(Boolean).join(" "))) {
      if (moduleName) {
        modules.add(moduleName);
      }
    }

    if (
      ruleId.startsWith("INVARIANT.LAYER_") ||
      ruleId === "INVARIANT.CROSS_MODULE_DIRECT_SERVICE_IMPORT"
    ) {
      if (file) {
        layerViolationFiles.add(file);
      }

      layerEdges.push({
        file,
        ...(target ? { target } : {}),
        ...(detectLayerFromSrcPath(file) ? { sourceLayer: detectLayerFromSrcPath(file) } : {}),
        ...(detectLayerFromSrcPath(target) ? { targetLayer: detectLayerFromSrcPath(target) } : {})
      });
      continue;
    }

    if (ruleId.startsWith("INVARIANT.IMPORT_")) {
      if (file) {
        importResolutionFiles.add(file);
      }
      if (target) {
        importResolutionTargets.add(target);
      }
      continue;
    }

    if (ruleId === "INVARIANT.TEST_MISSING_VITEST_IMPORT") {
      for (const moduleName of extractModuleNamesFromText([file, message].filter(Boolean).join(" "))) {
        if (moduleName) {
          testContractGapModules.add(moduleName);
        }
      }
    }
  }

  const clusters: CorrectionCluster[] = [];

  if (modules.size) {
    clusters.push({
      type: "architecture_contract",
      modules: Array.from(modules).sort()
    });
  }

  if (layerViolationFiles.size) {
    clusters.push({
      type: "layer_boundary_violation",
      files: Array.from(layerViolationFiles).sort(),
      edges: layerEdges.filter((edge) => edge.file)
    });
  }

  if (importResolutionFiles.size || importResolutionTargets.size) {
    clusters.push({
      type: "import_resolution_error",
      ...(importResolutionFiles.size ? { files: Array.from(importResolutionFiles).sort() } : {}),
      ...(importResolutionTargets.size ? { imports: Array.from(importResolutionTargets).sort() } : {})
    });
  }

  if (testContractGapModules.size) {
    clusters.push({
      type: "test_contract_gap",
      modules: Array.from(testContractGapModules).sort()
    });
  }

  return {
    shouldAutoCorrect: clusters.length > 0,
    clusters,
    architectureCollapse: false,
    reason: clusters.length ? "architecture" : null,
    blockingCount,
    ...(modules.size ? { architectureModules: Array.from(modules).sort() } : {})
  };
}
