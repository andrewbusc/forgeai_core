import { promises as fs } from "node:fs";
import path from "node:path";
import { ArchitectureContract, architectureContractV1 } from "./contract.js";
import { collectProductionFiles } from "./collect-files.js";
import { ValidationViolation } from "./types.js";

function testAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function detectJwtSecretValidation(content: string): boolean {
  if (!/AUTH_TOKEN_SECRET|JWT_SECRET|JWT_SECRET_KEY/.test(content)) {
    return false;
  }

  if (
    /if\s*\(\s*!\s*[A-Za-z0-9_]+\s*\)\s*\{[\s\S]{0,220}throw new Error\([^)]*required[^)]*\)/i.test(content) ||
    /(AUTH_TOKEN_SECRET|JWT_SECRET|JWT_SECRET_KEY)[\s\S]{0,220}required/i.test(content)
  ) {
    return true;
  }

  return false;
}

export async function runSecurityBaselineValidation(
  projectRoot: string,
  contract: ArchitectureContract = architectureContractV1
): Promise<ValidationViolation[]> {
  const root = path.resolve(projectRoot);
  const files = await collectProductionFiles(root);
  const violations: ValidationViolation[] = [];
  const contentByPath = new Map<string, string>();

  for (const file of files) {
    try {
      const content = await fs.readFile(file.absolutePath, "utf8");
      contentByPath.set(file.relativePath, content);
    } catch (error) {
      violations.push({
        ruleId: "SEC.READ_ERROR",
        severity: "error",
        file: file.relativePath,
        message: `Could not read source file: ${String((error as Error).message || error)}`
      });
    }
  }

  const allSource = Array.from(contentByPath.values()).join("\n");
  const byPath = (relativePath: string): string => contentByPath.get(relativePath) || "";

  const hasHelmet = testAny(allSource, [
    /\bfrom\s+["']helmet["']/,
    /\bfrom\s+["']@fastify\/helmet["']/,
    /\brequire\s*\(\s*["']helmet["']\s*\)/,
    /\bhelmet\s*\(/,
    /\bregister\s*\(\s*helmet\b/
  ]);

  if (contract.rules.securityHelmet.enabled && !hasHelmet) {
    violations.push({
      ruleId: contract.rules.securityHelmet.id,
      severity: contract.rules.securityHelmet.severity,
      file: "src/server.ts",
      message: "Helmet middleware is required but was not detected."
    });
  }

  const hasRateLimiting = testAny(allSource, [
    /\bfrom\s+["']@fastify\/rate-limit["']/,
    /\benforceRateLimit\b/,
    /\brateLimit\b/i,
    /rate[-_ ]limit/i
  ]);
  if (contract.rules.securityRateLimit.enabled && !hasRateLimiting) {
    violations.push({
      ruleId: contract.rules.securityRateLimit.id,
      severity: contract.rules.securityRateLimit.severity,
      file: "src/server.ts",
      message: "Rate limiting was not detected."
    });
  }

  const hasWildcardCors = testAny(allSource, [
    /cors\s*\(\s*\{[\s\S]*?origin\s*:\s*["'`]\*["'`]/i,
    /Access-Control-Allow-Origin["'`]\s*,\s*["'`]\*["'`]/i,
    /setHeader\s*\(\s*["'`]access-control-allow-origin["'`]\s*,\s*["'`]\*["'`]/i
  ]);
  if (contract.rules.securityCorsWildcard.enabled && hasWildcardCors) {
    violations.push({
      ruleId: contract.rules.securityCorsWildcard.id,
      severity: contract.rules.securityCorsWildcard.severity,
      file: "src/server.ts",
      message: "Wildcard CORS ('*') is forbidden."
    });
  }

  const hasInputValidation = testAny(allSource, [
    /\bfrom\s+["']zod["']/,
    /\brequire\s*\(\s*["']zod["']\s*\)/,
    /\b\w+Schema\.(parse|safeParse)\s*\(/,
    /\bz\.(object|string|number|boolean|enum|array|record|union)\s*\(/
  ]);
  if (contract.rules.securityInputValidation.enabled && !hasInputValidation) {
    violations.push({
      ruleId: contract.rules.securityInputValidation.id,
      severity: contract.rules.securityInputValidation.severity,
      file: "src/server.ts",
      message: "Input validation (for example via Zod) was not detected."
    });
  }

  const explicitEnvValidationDetected =
    byPath("src/config/env.ts").length > 0 ||
    /process\.env\.[A-Z0-9_]+[\s\S]{0,260}throw new Error\([^)]*required[^)]*\)/i.test(allSource);
  if (contract.rules.securityEnvValidation.enabled && !explicitEnvValidationDetected) {
    violations.push({
      ruleId: contract.rules.securityEnvValidation.id,
      severity: contract.rules.securityEnvValidation.severity,
      file: "src/config/env.ts",
      message: "Environment variable validation was not detected."
    });
  }

  const hasSecurePasswordHashing = testAny(allSource, [/\bscrypt(?:sync)?\b/i, /\bbcrypt\b/i, /\bargon2\b/i]);
  if (contract.rules.securityPasswordHashing.enabled && !hasSecurePasswordHashing) {
    violations.push({
      ruleId: contract.rules.securityPasswordHashing.id,
      severity: contract.rules.securityPasswordHashing.severity,
      file: "src/lib/auth.ts",
      message: "Secure password hashing (scrypt/bcrypt/argon2) was not detected."
    });
  }

  const hasJwtValidation = Array.from(contentByPath.entries()).some(([relativePath, content]) => {
    if (!relativePath.toLowerCase().includes("token") && !relativePath.toLowerCase().includes("auth")) {
      return false;
    }
    return detectJwtSecretValidation(content);
  });

  if (contract.rules.securityJwtSecretValidation.enabled && !hasJwtValidation) {
    violations.push({
      ruleId: contract.rules.securityJwtSecretValidation.id,
      severity: contract.rules.securityJwtSecretValidation.severity,
      file: "src/lib/tokens.ts",
      message: "JWT secret validation was not detected."
    });
  }

  return violations;
}
