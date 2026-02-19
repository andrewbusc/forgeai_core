import path from "node:path";
import { runLightProjectValidation } from "./project-validator.js";

async function main(): Promise<void> {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const result = await runLightProjectValidation(target);

  const payload = {
    target,
    ok: result.ok,
    blockingCount: result.blockingCount,
    warningCount: result.warningCount,
    violations: result.violations
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});

