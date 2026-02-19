import { GraphBuilder } from "./graph-builder.js";
import { runStructuralValidation } from "./structural-validator.js";
import { runAstValidation } from "./ast-validator.js";
import { runSecurityBaselineValidation } from "./security-validator.js";
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
    return toValidationPassResult([...structuralViolations, ...graph.violations, ...astViolations, ...securityViolations]);
}
