import { buildFailure, passValidation, terminalStopFailure, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createBuildFailureScenario(occurrence: number): ScenarioDefinition {
  const converges = occurrence <= 2;
  const correctionPhase = occurrence <= 2 ? null : "micro_targeted_repair";

  return {
    label: "build_failure",
    occurrence,
    goal: `Repair deterministic build pipeline failure sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce a build-only failure that should be recoverable through a constrained correction step.`,
    correctionPhase,
    correctionPrompt: "Repair the failing build import or config path without broad feature rewrites.",
    correctionPath: `src/config/build-fix-${occurrence}.ts`,
    correctionContent: `export const buildFix${occurrence} = "restored-build-path";\n`,
    validationSequence: converges
      ? [buildFailure(8), passValidation()]
      : [buildFailure(8), terminalStopFailure(3, "Build still has a residual blocker after repair")]
  };
}
