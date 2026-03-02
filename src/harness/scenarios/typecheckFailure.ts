import { passValidation, terminalStopFailure, type ScenarioDefinition, typecheckFailure } from "../scenario-fixtures.js";

export function createTypecheckFailureScenario(occurrence: number): ScenarioDefinition {
  const converges = occurrence <= 2;

  return {
    label: "typecheck_failure",
    occurrence,
    goal: `Repair deterministic typecheck failure sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce a narrow typecheck error without destabilizing the rest of the project.`,
    correctionPhase: "micro_targeted_repair",
    correctionPrompt: "Apply a micro-targeted repair that resolves TypeScript mismatches without architectural rewrites.",
    correctionPath: `src/modules/project/dto/typecheck-fix-${occurrence}.ts`,
    correctionContent: `export const typecheckFix${occurrence}: { id: string } = { id: "fixed-${occurrence}" };\n`,
    validationSequence: converges
      ? [typecheckFailure(6), passValidation()]
      : [typecheckFailure(6), terminalStopFailure(2, "Residual manual review required after typecheck repair")]
  };
}
