import { promises as fs } from "node:fs";
import path from "node:path";
import type { StagedFileChange } from "../fs/types.js";

const importRegex = /\bimport\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g;
const exportFromRegex = /\bexport\s+[^"'`]+?\s+from\s+["'`]([^"'`]+)["'`]/g;
const vitestImportRegex = /from\s+["']vitest["']/;
const malformedJsQuoteRegex = /(?:import|export)\s+[^;\n]*\sfrom\s+["`][^"`\n]*\.js'["`]/g;

type LayerName = "controller" | "service" | "repository" | "schema" | "dto" | "tests" | "db";

interface LayerRef {
  moduleName: string | null;
  layer: LayerName | null;
}

interface MatrixContext {
  source: LayerRef;
  sourceFile: string;
  importPath: string;
  target: LayerRef;
  targetFile: string;
}

export interface PrecommitInvariantViolation {
  ruleId: string;
  severity: "error";
  file: string;
  target?: string;
  message: string;
}

export interface PrecommitInvariantResult {
  ok: boolean;
  blockingCount: number;
  warningCount: number;
  summary: string;
  violations: PrecommitInvariantViolation[];
}

export interface PrecommitInvariantInput {
  projectRoot: string;
  stagedChanges: StagedFileChange[];
}

function normalizeToPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function toProjectRelative(projectRoot: string, absolutePath: string): string {
  return normalizeToPosix(path.relative(path.resolve(projectRoot), path.resolve(absolutePath)));
}

function isWithinPath(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function detectLayer(relativePath: string): LayerRef {
  const normalized = normalizeToPosix(relativePath);
  const parts = normalized.split("/").filter(Boolean);

  if (parts[0] === "src" && parts[1] === "modules") {
    const moduleName = parts[2] || null;
    const maybeLayer = parts[3] || null;

    if (
      maybeLayer === "controller" ||
      maybeLayer === "service" ||
      maybeLayer === "repository" ||
      maybeLayer === "schema" ||
      maybeLayer === "dto" ||
      maybeLayer === "tests"
    ) {
      return {
        moduleName,
        layer: maybeLayer
      };
    }
  }

  if (parts[0] === "src" && parts[1] === "db") {
    return {
      moduleName: null,
      layer: "db"
    };
  }

  return {
    moduleName: null,
    layer: null
  };
}

function collectImportSpecifiers(source: string): string[] {
  const values: string[] = [];

  for (const regex of [importRegex, exportFromRegex]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while (true) {
      match = regex.exec(source);
      if (!match) {
        break;
      }

      const specifier = (match[1] || "").trim();
      if (specifier.length > 0) {
        values.push(specifier);
      }
    }
  }

  return values;
}

function resolveCandidatePaths(basePath: string): string[] {
  const resolvedBase = path.resolve(basePath);
  const ext = path.extname(resolvedBase).toLowerCase();
  const candidates = new Set<string>();

  if (ext) {
    candidates.add(resolvedBase);

    if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") {
      const baseWithoutExt = resolvedBase.slice(0, -ext.length);
      for (const candidateExt of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
        candidates.add(`${baseWithoutExt}${candidateExt}`);
      }
    }

    return Array.from(candidates.values());
  }

  for (const candidateExt of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    candidates.add(`${resolvedBase}${candidateExt}`);
    candidates.add(path.join(resolvedBase, `index${candidateExt}`));
  }

  return Array.from(candidates.values());
}

async function fileExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalImportTarget(input: {
  projectRoot: string;
  sourceRelativePath: string;
  importPath: string;
}): Promise<string | null> {
  const projectRoot = path.resolve(input.projectRoot);
  const sourceAbsolutePath = path.resolve(projectRoot, input.sourceRelativePath);
  const srcRoot = path.resolve(projectRoot, "src");
  const specifier = input.importPath.replace(/[?#].*$/, "");
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const isAbsolute = specifier.startsWith("/");
  const isSrcRootRelative = specifier.startsWith("src/");
  let base: string | null = null;

  if (isRelative) {
    base = path.resolve(path.dirname(sourceAbsolutePath), specifier);
  } else if (isAbsolute) {
    base = path.resolve(specifier);
  } else if (isSrcRootRelative) {
    base = path.resolve(projectRoot, specifier);
  }

  if (!base) {
    return null;
  }

  for (const candidate of resolveCandidatePaths(base)) {
    const exists = await fileExists(candidate);
    if (!exists) {
      continue;
    }

    if (!isWithinPath(candidate, srcRoot)) {
      continue;
    }

    return path.resolve(candidate);
  }

  return null;
}

function createViolation(
  ruleId: string,
  file: string,
  message: string,
  target?: string
): PrecommitInvariantViolation {
  return {
    ruleId,
    severity: "error",
    file,
    target,
    message
  };
}

function buildImportMissingTargetMessage(sourceRelativePath: string, importPath: string): string {
  const normalizedImport = normalizeToPosix(importPath.replace(/[?#].*$/, ""));

  if (sourceRelativePath.startsWith("src/") && /(^|\/)src\//.test(normalizedImport)) {
    const suggested = normalizedImport.replace(/(^|\/)src\//, "$1");
    if (suggested && suggested !== normalizedImport) {
      return `Import target '${importPath}' could not be resolved. If source file is already under src/, remove the extra 'src/' segment (e.g. '${suggested}').`;
    }
  }

  if (
    sourceRelativePath.startsWith("src/modules/") &&
    normalizedImport.includes("/db/") &&
    !/\/db\/prisma(?:\.[a-z]+)?$/i.test(normalizedImport)
  ) {
    return `Import target '${importPath}' could not be resolved. Do not invent domain files under src/db; use module-local files for domain logic, or use the real db entrypoint '../../../db/prisma.js' when Prisma is required.`;
  }

  if (
    sourceRelativePath.startsWith("src/modules/") &&
    (normalizedImport.startsWith("../dto/") ||
      normalizedImport.startsWith("./dto/") ||
      normalizedImport.startsWith("../schema/") ||
      normalizedImport.startsWith("./schema/"))
  ) {
    return `Import target '${importPath}' could not be resolved. If you import a module-local dto/ or schema/ file, create or repair that canonical file in the same module. Example: '../dto/project-dto.js' requires 'src/modules/<module>/dto/project-dto.ts'.`;
  }

  return `Import target '${importPath}' could not be resolved.`;
}

function collectDependencyViolations(context: MatrixContext): PrecommitInvariantViolation[] {
  const violations: PrecommitInvariantViolation[] = [];
  const source = context.source;
  const target = context.target;

  if (!source.layer || !target.layer) {
    return violations;
  }

  if (source.layer === "db" && target.layer === "service") {
    violations.push(
      createViolation(
        "INVARIANT.LAYER_DB_TO_SERVICE",
        context.sourceFile,
        "db layer cannot import service layer.",
        context.targetFile
      )
    );
  }

  if (source.layer === "repository" && target.layer === "service") {
    violations.push(
      createViolation(
        "INVARIANT.LAYER_REPOSITORY_TO_SERVICE",
        context.sourceFile,
        "repository layer cannot import service layer.",
        context.targetFile
      )
    );
  }

  if (source.layer === "controller" && target.layer === "db") {
    violations.push(
      createViolation(
        "INVARIANT.LAYER_CONTROLLER_TO_DB",
        context.sourceFile,
        "controller layer cannot import db layer directly.",
        context.targetFile
      )
    );
  }

  if (source.layer === "db" && target.moduleName && target.layer !== "tests") {
    violations.push(
      createViolation(
        "INVARIANT.LAYER_DB_TO_MODULE",
        context.sourceFile,
        "db layer may not import module layers.",
        context.targetFile
      )
    );
  }

  if (source.moduleName && target.moduleName && source.moduleName !== target.moduleName && target.layer === "service") {
    if (source.layer === "service") {
      violations.push(
        createViolation(
          "INVARIANT.LAYER_SERVICE_TO_SERVICE_CROSS_MODULE",
          context.sourceFile,
          "service layer cannot import another module's service layer.",
          context.targetFile
        )
      );
    } else if (source.layer === "tests") {
      violations.push(
        createViolation(
          "INVARIANT.CROSS_MODULE_DIRECT_SERVICE_IMPORT",
          context.sourceFile,
          "Module tests must import their own module's service layer only. Do not satisfy test contracts by importing another module's service.",
          context.targetFile
        )
      );
    } else {
      violations.push(
        createViolation(
          "INVARIANT.CROSS_MODULE_DIRECT_SERVICE_IMPORT",
          context.sourceFile,
          "Cross-module direct service imports are forbidden.",
          context.targetFile
        )
      );
    }
  }

  return violations;
}

function normalizeSummary(violations: PrecommitInvariantViolation[]): string {
  if (!violations.length) {
    return "Pre-commit invariant guard passed.";
  }

  const first = violations[0];
  if (!first) {
    return "Pre-commit invariant guard failed.";
  }

  return `Pre-commit invariant violation: ${first.ruleId} @ ${first.file}: ${first.message}`;
}

function sortViolations(violations: PrecommitInvariantViolation[]): PrecommitInvariantViolation[] {
  return [...violations].sort((a, b) => {
    return (
      a.ruleId.localeCompare(b.ruleId) ||
      a.file.localeCompare(b.file) ||
      (a.target || "").localeCompare(b.target || "") ||
      a.message.localeCompare(b.message)
    );
  });
}

function dedupeViolations(violations: PrecommitInvariantViolation[]): PrecommitInvariantViolation[] {
  const seen = new Set<string>();
  const result: PrecommitInvariantViolation[] = [];

  for (const entry of violations) {
    const key = `${entry.ruleId}|${entry.file}|${entry.target || ""}|${entry.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
}

export async function runPrecommitInvariantGuard(input: PrecommitInvariantInput): Promise<PrecommitInvariantResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const srcRoot = path.resolve(projectRoot, "src");
  const violations: PrecommitInvariantViolation[] = [];
  const sortedChanges = [...input.stagedChanges].sort((a, b) => a.path.localeCompare(b.path));

  for (const change of sortedChanges) {
    if (change.type === "delete") {
      continue;
    }

    const sourceRelativePath = normalizeToPosix(change.path).replace(/^\/+/, "");
    const sourceContent = change.newContent || "";

    malformedJsQuoteRegex.lastIndex = 0;
    if (malformedJsQuoteRegex.test(sourceContent)) {
      violations.push(
        createViolation(
          "INVARIANT.IMPORT_MALFORMED_JS_SUFFIX",
          sourceRelativePath,
          "Import specifier has an invalid .js' suffix."
        )
      );
    }

    if (
      (sourceRelativePath.includes("/tests/") || sourceRelativePath.startsWith("tests/")) &&
      !vitestImportRegex.test(sourceContent)
    ) {
      violations.push(
        createViolation(
          "INVARIANT.TEST_MISSING_VITEST_IMPORT",
          sourceRelativePath,
          "Test files under /tests/ must import from 'vitest'."
        )
      );
    }

    const sourceLayer = detectLayer(sourceRelativePath);
    const importSpecifiers = collectImportSpecifiers(sourceContent);

    for (const specifier of importSpecifiers) {
      if (specifier.endsWith("'") || specifier.endsWith('"')) {
        violations.push(
          createViolation(
            "INVARIANT.IMPORT_MALFORMED_SPECIFIER",
            sourceRelativePath,
            `Import specifier '${specifier}' appears malformed.`
          )
        );
        continue;
      }

      if (/\.js'$/.test(specifier)) {
        violations.push(
          createViolation(
            "INVARIANT.IMPORT_MALFORMED_JS_SUFFIX",
            sourceRelativePath,
            `Import specifier '${specifier}' has an invalid .js' suffix.`
          )
        );
        continue;
      }

      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const isAbsolute = specifier.startsWith("/");
      const isSrcRootRelative = specifier.startsWith("src/");
      const isLocalImport = isRelative || isAbsolute || isSrcRootRelative;

      if (isAbsolute) {
        const absoluteImportPath = path.resolve(specifier.replace(/[?#].*$/, ""));
        if (!isWithinPath(absoluteImportPath, srcRoot)) {
          violations.push(
            createViolation(
              "INVARIANT.IMPORT_ABSOLUTE_OUTSIDE_SRC",
              sourceRelativePath,
              `Absolute import '${specifier}' must resolve inside src/.`
            )
          );
          continue;
        }
      }

      if (!isLocalImport) {
        continue;
      }

      const resolvedTarget = await resolveLocalImportTarget({
        projectRoot,
        sourceRelativePath,
        importPath: specifier
      });

      if (!resolvedTarget) {
        violations.push(
          createViolation(
            "INVARIANT.IMPORT_MISSING_TARGET",
            sourceRelativePath,
            buildImportMissingTargetMessage(sourceRelativePath, specifier),
            specifier
          )
        );
        continue;
      }

      const targetRelativePath = toProjectRelative(projectRoot, resolvedTarget);
      const targetLayer = detectLayer(targetRelativePath);

      violations.push(
        ...collectDependencyViolations({
          source: sourceLayer,
          sourceFile: sourceRelativePath,
          importPath: specifier,
          target: targetLayer,
          targetFile: targetRelativePath
        })
      );
    }
  }

  const normalizedViolations = sortViolations(dedupeViolations(violations));

  return {
    ok: normalizedViolations.length === 0,
    blockingCount: normalizedViolations.length,
    warningCount: 0,
    summary: normalizeSummary(normalizedViolations),
    violations: normalizedViolations
  };
}

export function isPrecommitInvariantResult(value: unknown): value is PrecommitInvariantResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.ok === "boolean" &&
    Number.isFinite(Number(record.blockingCount)) &&
    Number.isFinite(Number(record.warningCount)) &&
    typeof record.summary === "string" &&
    Array.isArray(record.violations)
  );
}
