import { importResolutionFailure, terminalStopFailure, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createOscillationScenario(occurrence: number): ScenarioDefinition {
  return {
    label: "oscillation",
    occurrence,
    goal: `Exercise oscillation pressure via repeated import-resolution failure sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce an import resolution failure that repeats without improvement across correction attempts.`,
    correctionPhase: "micro_targeted_repair",
    correctionPrompt: "Retry the same narrow import repair path without expanding into a broader rewrite.",
    correctionPath: `src/modules/project/service/oscillation-fix-${occurrence}.ts`,
    correctionContent: `export const oscillationRepairAttempt${occurrence} = "repeat-import-normalization";\n`,
    validationSequence: [
      importResolutionFailure(4),
      importResolutionFailure(4),
      terminalStopFailure(4, "Oscillation detected after repeated import repair attempts")
    ]
  };
}
