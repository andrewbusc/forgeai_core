import { GraphBuilder } from "./graph-builder.js";
import { runStructuralValidation } from "./structural-validator.js";
import { runAstValidation } from "./ast-validator.js";
import { runSecurityBaselineValidation } from "./security-validator.js";
import { runModuleTestContractValidation } from "./test-contract-validator.js";
import { sortValidationViolations } from "./violation-utils.js";
function toValidationPassResult(violations) {
    let blockingCount = 0;
    let warningCount = 0;
    for (const violation of violations) {
        if (violation.severity === "error") {
            blockingCount += 1;
        }
        else {
            warningCount += 1;
        }
    }
    return {
        ok: blockingCount === 0,
        blockingCount,
        warningCount,
        violations
    };
}
export async function runLightProjectValidation(projectRoot) {
    const graph = await new GraphBuilder({ projectRoot }).build();
    const structuralViolations = await runStructuralValidation(projectRoot);
    const astViolations = await runAstValidation(projectRoot);
    const securityViolations = await runSecurityBaselineValidation(projectRoot);
    const testContractViolations = await runModuleTestContractValidation(projectRoot);
    const merged = sortValidationViolations([
        ...structuralViolations,
        ...graph.violations,
        ...astViolations,
        ...securityViolations,
        ...testContractViolations
    ]);
    return toValidationPassResult(merged);
}
