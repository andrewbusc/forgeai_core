import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLightProjectValidation } from "./project-validator.js";
import { architectureContractV1 } from "./contract.js";
import { summarizeViolationsByRule } from "./violation-utils.js";
export async function runArchitectureCheck(targetPath) {
    const target = targetPath ? path.resolve(targetPath) : process.cwd();
    const result = await runLightProjectValidation(target);
    return {
        target,
        ok: result.ok,
        blockingCount: result.blockingCount,
        warningCount: result.warningCount,
        totalViolations: result.violations.length,
        contractVersion: architectureContractV1.version,
        deterministicOrdering: true,
        noMutation: true,
        byRule: summarizeViolationsByRule(result.violations),
        violations: result.violations
    };
}
async function main() {
    const payload = await runArchitectureCheck(process.argv[2]);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (!payload.ok) {
        process.exitCode = 1;
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        const payload = {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        process.exitCode = 1;
    });
}
