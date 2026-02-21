import { Dirent, promises as fs } from "node:fs";
import path from "node:path";
import { pathExists } from "../../lib/fs-utils.js";
import { ValidationViolation } from "./types.js";

const codeFilePattern = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const testDeclarationPattern = /\b(it|test|describe)\s*\(/i;
const serviceImportPattern =
  /\bfrom\s+["'`][^"'`]*(\/service\/|service\/|-service(?:\.[a-z]+)?["'`])|(\b[a-z0-9]+service\b)/i;
const successCasePattern =
  /(service success|happy path|returns|creates|updates|deletes|succeeds|valid credentials|successful)/i;
const failureCasePattern =
  /(service failure|throws|rejects|invalid|error|unauthorized|forbidden|fails|denied)/i;
const validationFailurePattern = /(validation failure|invalid payload|schema|safeparse|parse.*invalid|validation.*error)/i;
const authBoundaryPattern =
  /(auth boundary|requires auth|missing token|unauthorized|forbidden|401|403|jwt)/i;
const notFoundOrConflictPattern = /(not found|conflict|404|409|notfounderror|conflicterror)/i;

interface SourceFileSnapshot {
  path: string;
  content: string;
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function pushViolation(
  violations: ValidationViolation[],
  input: {
    ruleId: string;
    file: string;
    message: string;
    target?: string;
  }
): void {
  violations.push({
    ruleId: input.ruleId,
    severity: "error",
    file: toPosix(input.file),
    target: input.target,
    message: input.message
  });
}

async function collectCodeFilesRecursive(root: string, base = root): Promise<SourceFileSnapshot[]> {
  const snapshots: SourceFileSnapshot[] = [];
  let entries: Dirent[] = [];

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError && maybeError.code === "ENOENT") {
      return snapshots;
    }
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      snapshots.push(...(await collectCodeFilesRecursive(absolute, base)));
      continue;
    }

    if (!codeFilePattern.test(entry.name)) {
      continue;
    }

    const content = await fs.readFile(absolute, "utf8");
    snapshots.push({
      path: toPosix(path.relative(base, absolute)),
      content
    });
  }

  return snapshots;
}

async function listModuleNames(modulesRoot: string): Promise<string[]> {
  if (!(await pathExists(modulesRoot))) {
    return [];
  }

  const entries = await fs.readdir(modulesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function hasPatternInAny(files: SourceFileSnapshot[], pattern: RegExp): boolean {
  return files.some((entry) => pattern.test(entry.content));
}

function hasPatternInCombinedText(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function moduleRequiresAuthBoundary(moduleSource: SourceFileSnapshot[]): boolean {
  const sourceText = moduleSource.map((entry) => entry.content).join("\n").toLowerCase();
  return (
    sourceText.includes("requireauth") ||
    sourceText.includes("jwtverify") ||
    sourceText.includes("authorization") ||
    (sourceText.includes("prehandler") && sourceText.includes("auth"))
  );
}

function moduleRequiresNotFoundOrConflictCase(moduleSource: SourceFileSnapshot[]): boolean {
  const sourceText = moduleSource.map((entry) => entry.content).join("\n").toLowerCase();
  return sourceText.includes("notfounderror") || sourceText.includes("conflicterror");
}

export async function runModuleTestContractValidation(projectRoot: string): Promise<ValidationViolation[]> {
  const root = path.resolve(projectRoot);
  const modulesRoot = path.join(root, "src", "modules");
  const moduleNames = await listModuleNames(modulesRoot);
  const violations: ValidationViolation[] = [];

  for (const moduleName of moduleNames) {
    const moduleRoot = path.join(modulesRoot, moduleName);
    const testsRoot = path.join(moduleRoot, "tests");
    const testsRelative = toPosix(path.relative(root, testsRoot));

    const moduleSource = (await collectCodeFilesRecursive(moduleRoot)).filter(
      (entry) => !entry.path.toLowerCase().startsWith("tests/")
    );

    if (!(await pathExists(testsRoot))) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_TEST_DIR_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' must define tests under '${testsRelative}'.`
      });
      continue;
    }

    const testFiles = await collectCodeFilesRecursive(testsRoot, root);
    if (!testFiles.length) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_TEST_CASES_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' tests directory is empty.`
      });
      continue;
    }

    const hasAnyTestDeclaration = hasPatternInAny(testFiles, testDeclarationPattern);
    if (!hasAnyTestDeclaration) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_TEST_CASES_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' tests must contain executable test cases (it/test/describe).`
      });
    }

    const combinedTestText = testFiles.map((entry) => entry.content).join("\n");
    const hasServiceLayerExecution = hasPatternInCombinedText(combinedTestText, serviceImportPattern);
    const hasServiceSuccess = hasPatternInCombinedText(combinedTestText, successCasePattern);
    const hasServiceFailure = hasPatternInCombinedText(combinedTestText, failureCasePattern);
    const hasValidationFailure = hasPatternInCombinedText(combinedTestText, validationFailurePattern);
    const requiresAuthBoundary = moduleRequiresAuthBoundary(moduleSource);
    const requiresNotFoundOrConflict = moduleRequiresNotFoundOrConflictCase(moduleSource);
    const hasAuthBoundary = hasPatternInCombinedText(combinedTestText, authBoundaryPattern);
    const hasNotFoundOrConflict = hasPatternInCombinedText(combinedTestText, notFoundOrConflictPattern);

    if (!hasServiceLayerExecution) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_SERVICE_LAYER_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' tests must execute the service layer (service import/reference required).`
      });
    }

    if (!hasServiceSuccess) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_SERVICE_SUCCESS_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' is missing a service success test case.`
      });
    }

    if (!hasServiceFailure) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_SERVICE_FAILURE_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' is missing a service failure test case.`
      });
    }

    if (!hasValidationFailure) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_VALIDATION_FAILURE_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' is missing a validation failure test case.`
      });
    }

    if (requiresAuthBoundary && !hasAuthBoundary) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_AUTH_BOUNDARY_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' requires an auth boundary test case (401/403 or equivalent).`
      });
    }

    if (requiresNotFoundOrConflict && !hasNotFoundOrConflict) {
      pushViolation(violations, {
        ruleId: "TEST.CONTRACT_NOTFOUND_CONFLICT_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' requires a not-found or conflict test case.`
      });
    }
  }

  return violations;
}
