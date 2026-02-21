import { ValidationViolation } from "./types.js";

export interface ViolationRuleSummary {
  ruleId: string;
  errors: number;
  warnings: number;
  total: number;
}

export function compareValidationViolation(a: ValidationViolation, b: ValidationViolation): number {
  return (
    a.ruleId.localeCompare(b.ruleId) ||
    a.severity.localeCompare(b.severity) ||
    a.file.localeCompare(b.file) ||
    (a.target || "").localeCompare(b.target || "") ||
    a.message.localeCompare(b.message)
  );
}

export function sortValidationViolations(violations: ValidationViolation[]): ValidationViolation[] {
  return [...violations].sort(compareValidationViolation);
}

export function summarizeViolationsByRule(violations: ValidationViolation[]): ViolationRuleSummary[] {
  const byRule = new Map<string, { errors: number; warnings: number }>();

  for (const entry of violations) {
    const current = byRule.get(entry.ruleId) || { errors: 0, warnings: 0 };
    if (entry.severity === "error") {
      current.errors += 1;
    } else {
      current.warnings += 1;
    }
    byRule.set(entry.ruleId, current);
  }

  return Array.from(byRule.entries())
    .map(([ruleId, counts]) => ({
      ruleId,
      errors: counts.errors,
      warnings: counts.warnings,
      total: counts.errors + counts.warnings
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
