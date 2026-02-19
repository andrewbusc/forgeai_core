import path from "node:path";
import { pathExists } from "../../lib/fs-utils.js";
import { ValidationViolation } from "./types.js";

const requiredFiles = ["src/server.ts", "src/app.ts"];
const requiredDirectories = ["src/config", "src/modules", "src/middleware", "src/errors", "src/db"];

export async function runStructuralValidation(projectRoot: string): Promise<ValidationViolation[]> {
  const root = path.resolve(projectRoot);
  const violations: ValidationViolation[] = [];

  for (const relativePath of requiredFiles) {
    const absolute = path.join(root, relativePath);
    if (!(await pathExists(absolute))) {
      violations.push({
        ruleId: "STRUCTURE.REQUIRED_FILE",
        severity: "error",
        file: relativePath,
        message: `Required file '${relativePath}' is missing.`
      });
    }
  }

  for (const relativePath of requiredDirectories) {
    const absolute = path.join(root, relativePath);
    if (!(await pathExists(absolute))) {
      violations.push({
        ruleId: "STRUCTURE.REQUIRED_DIRECTORY",
        severity: "error",
        file: relativePath,
        message: `Required directory '${relativePath}' is missing.`
      });
    }
  }

  return violations;
}

