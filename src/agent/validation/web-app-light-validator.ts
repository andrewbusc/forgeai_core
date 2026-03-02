import type { HeavyValidationCheck, HeavyValidationResult } from "./heavy-validator.js";

export async function runWebAppLightValidation(): Promise<HeavyValidationResult> {
  const checks: HeavyValidationCheck[] = [
    {
      id: "architecture",
      status: "skip",
      message: "Backend architecture checks are skipped for web-app templates."
    },
    {
      id: "boot",
      status: "skip",
      message: "Boot check is not yet implemented for web-app templates in the lightweight validation profile."
    }
  ];

  return {
    ok: true,
    blockingCount: 0,
    warningCount: 0,
    checks,
    failures: [],
    summary: "web-app lightweight checks skipped; blocking=0; warnings=0",
    logs: ""
  };
}
