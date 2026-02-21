import { Dirent, promises as fs } from "node:fs";
import path from "node:path";
import { pathExists, readTextFile } from "../../lib/fs-utils.js";
import { ValidationViolation } from "./types.js";

const requiredFiles = [
  "package.json",
  "tsconfig.json",
  ".env.example",
  "Dockerfile",
  ".dockerignore",
  "src/server.ts",
  "src/app.ts",
  "src/config/env.ts",
  "src/config/logger.ts",
  "src/db/prisma.ts",
  "src/errors/BaseAppError.ts",
  "src/errors/DomainError.ts",
  "src/errors/ValidationError.ts",
  "src/errors/NotFoundError.ts",
  "src/errors/UnauthorizedError.ts",
  "src/errors/ConflictError.ts",
  "src/errors/InfrastructureError.ts",
  "src/errors/errorHandler.ts",
  "prisma/schema.prisma",
  "prisma/seed.ts"
];

const requiredDirectories = [
  "src/config",
  "src/modules",
  "src/middleware",
  "src/errors",
  "src/db",
  "prisma",
  "tests/integration"
];

const requiredModuleLayers = ["controller", "service", "repository", "schema", "dto", "entity"];

const requiredScripts = [
  "dev",
  "build",
  "start",
  "check",
  "test",
  "prisma:generate",
  "prisma:migrate",
  "prisma:seed"
];

const requiredDependencies = [
  "fastify",
  "@fastify/helmet",
  "@fastify/cors",
  "@fastify/rate-limit",
  "@fastify/jwt",
  "@prisma/client",
  "zod",
  "dotenv",
  "pino"
];

const requiredDevDependencies = ["typescript", "tsx", "vitest", "prisma"];
const forbiddenDependencies = ["express"];

interface PackageJsonShape {
  type?: unknown;
  engines?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

function asPosixPath(value: string): string {
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
    file: asPosixPath(input.file),
    target: input.target,
    message: input.message
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      result[key] = entry;
    }
  }

  return result;
}

function hasNode20Constraint(raw: string): boolean {
  const compact = raw.replace(/\s+/g, "");
  if (!compact) {
    return false;
  }

  if (compact.startsWith("<20")) {
    return false;
  }

  if (
    /(^|[|])(>=?20(\.x|\.\d+){0,2})/.test(compact) ||
    /\^20(\.x|\.\d+){0,2}/.test(compact) ||
    /~20(\.x|\.\d+){0,2}/.test(compact) ||
    /\b20\.x\b/.test(compact)
  ) {
    return true;
  }

  const numbers = compact.match(/\d+/g) || [];
  if (!numbers.length) {
    return false;
  }

  const max = Math.max(...numbers.map((entry) => Number.parseInt(entry, 10)));
  if (!Number.isFinite(max)) {
    return false;
  }

  if (/<20/.test(compact) && max === 20) {
    return false;
  }

  return max >= 20;
}

async function directoryContainsMatchingFile(directory: string, pattern: RegExp): Promise<boolean> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError && maybeError.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContainsMatchingFile(absolute, pattern)) {
        return true;
      }
      continue;
    }

    if (pattern.test(entry.name)) {
      return true;
    }
  }

  return false;
}

async function hasPrismaMigrationSql(projectRoot: string): Promise<boolean> {
  const migrationsDir = path.join(projectRoot, "prisma", "migrations");
  return directoryContainsMatchingFile(migrationsDir, /^migration\.sql$/i);
}

function parseDockerignoreEntries(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"))
    .map((entry) => entry.replace(/^\.?\//, "").replace(/\/+$/, ""));
}

function hasDockerignoreTarget(entries: string[], target: "node_modules" | ".env" | ".git"): boolean {
  if (target === "node_modules") {
    return entries.some(
      (entry) =>
        entry === "node_modules" ||
        entry.endsWith("/node_modules") ||
        entry === "**/node_modules" ||
        entry.includes("node_modules")
    );
  }

  if (target === ".env") {
    return entries.some((entry) => entry === ".env" || entry.startsWith(".env"));
  }

  return entries.some((entry) => entry === ".git" || entry.startsWith(".git"));
}

async function enforceDockerContract(root: string, violations: ValidationViolation[]): Promise<void> {
  const dockerfilePath = path.join(root, "Dockerfile");
  if (await pathExists(dockerfilePath)) {
    let dockerfile = "";
    try {
      dockerfile = await readTextFile(dockerfilePath);
    } catch (error) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.READ_ERROR",
        file: "Dockerfile",
        message: `Could not read Dockerfile. ${String((error as Error).message || error)}`
      });
    }

    if (dockerfile.length > 0) {
      const hasProductionNodeEnv =
        /\bENV\s+NODE_ENV\s*=\s*production\b/i.test(dockerfile) || /\bNODE_ENV\s*=\s*production\b/i.test(dockerfile);
      if (!hasProductionNodeEnv) {
        pushViolation(violations, {
          ruleId: "STRUCTURE.DOCKER_NODE_ENV_PRODUCTION_REQUIRED",
          file: "Dockerfile",
          message: "Dockerfile must enforce production mode (NODE_ENV=production)."
        });
      }

      const hasProductionStartCommand =
        /CMD\s*\[\s*["']npm["']\s*,\s*["']run["']\s*,\s*["']start["']\s*\]/i.test(dockerfile) ||
        /CMD\s+npm\s+run\s+start\b/i.test(dockerfile);
      if (!hasProductionStartCommand) {
        pushViolation(violations, {
          ruleId: "STRUCTURE.DOCKER_START_COMMAND_REQUIRED",
          file: "Dockerfile",
          message: "Dockerfile must define a production start command (npm run start)."
        });
      }
    }
  }

  const dockerignorePath = path.join(root, ".dockerignore");
  if (await pathExists(dockerignorePath)) {
    let dockerignore = "";
    try {
      dockerignore = await readTextFile(dockerignorePath);
    } catch (error) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.READ_ERROR",
        file: ".dockerignore",
        message: `Could not read .dockerignore. ${String((error as Error).message || error)}`
      });
    }

    if (dockerignore.length > 0) {
      const entries = parseDockerignoreEntries(dockerignore);
      for (const target of ["node_modules", ".env", ".git"] as const) {
        if (!hasDockerignoreTarget(entries, target)) {
          pushViolation(violations, {
            ruleId: "STRUCTURE.DOCKERIGNORE_REQUIRED_ENTRY",
            file: ".dockerignore",
            target,
            message: `.dockerignore must include '${target}' to prevent deployment leakage.`
          });
        }
      }
    }
  }
}

async function enforcePackageJsonContract(root: string, violations: ValidationViolation[]): Promise<void> {
  const packageJsonPath = path.join(root, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return;
  }

  let parsed: PackageJsonShape;
  try {
    parsed = JSON.parse(await readTextFile(packageJsonPath)) as PackageJsonShape;
  } catch (error) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.PACKAGE_JSON_INVALID",
      file: "package.json",
      message: `package.json must be valid JSON. ${String((error as Error).message || error)}`
    });
    return;
  }

  if (parsed.type !== "module") {
    pushViolation(violations, {
      ruleId: "STRUCTURE.PACKAGE_TYPE_MODULE_REQUIRED",
      file: "package.json",
      message: "package.json must set type to 'module'."
    });
  }

  const scripts = toStringRecord(parsed.scripts);
  for (const scriptName of requiredScripts) {
    if (!scripts[scriptName]) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.REQUIRED_SCRIPT",
        file: "package.json",
        target: scriptName,
        message: `Required npm script '${scriptName}' is missing.`
      });
    }
  }

  const dependencies = toStringRecord(parsed.dependencies);
  const devDependencies = toStringRecord(parsed.devDependencies);

  for (const dependency of requiredDependencies) {
    if (!dependencies[dependency]) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.REQUIRED_DEPENDENCY",
        file: "package.json",
        target: dependency,
        message: `Required dependency '${dependency}' is missing from dependencies.`
      });
    }
  }

  for (const dependency of requiredDevDependencies) {
    if (!devDependencies[dependency]) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.REQUIRED_DEV_DEPENDENCY",
        file: "package.json",
        target: dependency,
        message: `Required dependency '${dependency}' is missing from devDependencies.`
      });
    }
  }

  for (const forbiddenDependency of forbiddenDependencies) {
    if (dependencies[forbiddenDependency] || devDependencies[forbiddenDependency]) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.FORBIDDEN_DEPENDENCY",
        file: "package.json",
        target: forbiddenDependency,
        message: `Forbidden dependency '${forbiddenDependency}' is not allowed in the canonical backend stack.`
      });
    }
  }

  const engines = isObjectRecord(parsed.engines) ? parsed.engines : {};
  const nodeConstraint = typeof engines.node === "string" ? engines.node : "";
  if (!nodeConstraint) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.NODE_ENGINE_REQUIRED",
      file: "package.json",
      target: "engines.node",
      message: "package.json must define engines.node with Node 20+."
    });
    return;
  }

  if (!hasNode20Constraint(nodeConstraint)) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.NODE_ENGINE_INVALID",
      file: "package.json",
      target: nodeConstraint,
      message: "engines.node must allow Node 20 or newer."
    });
  }
}

async function enforceModuleStructure(root: string, violations: ValidationViolation[]): Promise<void> {
  const modulesRoot = path.join(root, "src", "modules");
  if (!(await pathExists(modulesRoot))) {
    return;
  }

  let moduleNames: string[] = [];
  try {
    const entries = await fs.readdir(modulesRoot, { withFileTypes: true });
    moduleNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.READ_ERROR",
      file: "src/modules",
      message: `Could not inspect modules directory. ${String((error as Error).message || error)}`
    });
    return;
  }

  if (!moduleNames.length) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.MODULE_REQUIRED",
      file: "src/modules",
      message: "At least one module directory is required under src/modules."
    });
    return;
  }

  for (const moduleName of moduleNames) {
    const moduleRelative = path.posix.join("src", "modules", moduleName);

    for (const layer of requiredModuleLayers) {
      const layerRelative = path.posix.join(moduleRelative, layer);
      const layerAbsolute = path.join(root, layerRelative);

      if (!(await pathExists(layerAbsolute))) {
        pushViolation(violations, {
          ruleId: "STRUCTURE.MODULE_LAYER_REQUIRED",
          file: layerRelative,
          message: `Module '${moduleName}' is missing required layer directory '${layer}'.`
        });
        continue;
      }

      let hasLayerCode = false;
      try {
        hasLayerCode = await directoryContainsMatchingFile(layerAbsolute, /\.(ts|tsx|js|jsx|mjs|cjs)$/i);
      } catch (error) {
        pushViolation(violations, {
          ruleId: "STRUCTURE.READ_ERROR",
          file: layerRelative,
          message: `Could not inspect module layer '${layerRelative}'. ${String((error as Error).message || error)}`
        });
        continue;
      }

      if (!hasLayerCode) {
        pushViolation(violations, {
          ruleId: "STRUCTURE.MODULE_LAYER_EMPTY",
          file: layerRelative,
          message: `Module layer '${layerRelative}' must contain at least one code file.`
        });
      }
    }

    const testsRelative = path.posix.join(moduleRelative, "tests");
    const testsAbsolute = path.join(root, testsRelative);
    if (!(await pathExists(testsAbsolute))) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.MODULE_TEST_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' must include tests under '${testsRelative}'.`
      });
      continue;
    }

    let hasModuleTests = false;
    try {
      hasModuleTests = await directoryContainsMatchingFile(
        testsAbsolute,
        /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i
      );
    } catch (error) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.READ_ERROR",
        file: testsRelative,
        message: `Could not inspect test directory '${testsRelative}'. ${String((error as Error).message || error)}`
      });
      continue;
    }

    if (!hasModuleTests) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.MODULE_TEST_REQUIRED",
        file: testsRelative,
        message: `Module '${moduleName}' tests directory must contain at least one test file.`
      });
    }
  }
}

async function enforceTestAndMigrationArtifacts(root: string, violations: ValidationViolation[]): Promise<void> {
  const integrationTestsDir = path.join(root, "tests", "integration");
  if (await pathExists(integrationTestsDir)) {
    let hasIntegrationTests = false;
    try {
      hasIntegrationTests = await directoryContainsMatchingFile(
        integrationTestsDir,
        /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i
      );
    } catch (error) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.READ_ERROR",
        file: "tests/integration",
        message: `Could not inspect integration tests directory. ${String((error as Error).message || error)}`
      });
      return;
    }

    if (!hasIntegrationTests) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.TEST_SUITE_REQUIRED",
        file: "tests/integration",
        message: "tests/integration must contain at least one test file."
      });
    }
  }

  const migrationsDir = path.join(root, "prisma", "migrations");
  if (!(await pathExists(migrationsDir))) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.PRISMA_MIGRATION_REQUIRED",
      file: "prisma/migrations",
      message: "prisma/migrations directory is required."
    });
    return;
  }

  let hasMigrationSql = false;
  try {
    hasMigrationSql = await hasPrismaMigrationSql(root);
  } catch (error) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.READ_ERROR",
      file: "prisma/migrations",
      message: `Could not inspect Prisma migrations. ${String((error as Error).message || error)}`
    });
    return;
  }

  if (!hasMigrationSql) {
    pushViolation(violations, {
      ruleId: "STRUCTURE.PRISMA_MIGRATION_REQUIRED",
      file: "prisma/migrations",
      message: "At least one Prisma migration.sql file is required."
    });
  }
}

export async function runStructuralValidation(projectRoot: string): Promise<ValidationViolation[]> {
  const root = path.resolve(projectRoot);
  const violations: ValidationViolation[] = [];

  for (const relativePath of requiredFiles) {
    const absolute = path.join(root, relativePath);
    if (!(await pathExists(absolute))) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.REQUIRED_FILE",
        file: relativePath,
        message: `Required file '${relativePath}' is missing.`
      });
    }
  }

  for (const relativePath of requiredDirectories) {
    const absolute = path.join(root, relativePath);
    if (!(await pathExists(absolute))) {
      pushViolation(violations, {
        ruleId: "STRUCTURE.REQUIRED_DIRECTORY",
        file: relativePath,
        message: `Required directory '${relativePath}' is missing.`
      });
    }
  }

  await enforcePackageJsonContract(root, violations);
  await enforceDockerContract(root, violations);
  await enforceModuleStructure(root, violations);
  await enforceTestAndMigrationArtifacts(root, violations);

  return violations;
}
