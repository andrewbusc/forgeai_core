import { importResolutionFailure, terminalStopFailure, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createRegressionScenario(occurrence: number): ScenarioDefinition {
  return {
    label: "regression",
    occurrence,
    goal: `Exercise regression pressure via import-resolution churn sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce an import resolution failure likely to worsen after a bad correction.`,
    correctionPhase: "micro_targeted_repair",
    correctionPrompt: "Attempt a narrowly scoped import repair while preserving surrounding module behavior.",
    correctionPath: `src/modules/project/service/import-regression-fix-${occurrence}.ts`,
    correctionContent: `export const regressionRepairAttempt${occurrence} = "import-resolution-adjustment";\n`,
    validationSequence: [
      importResolutionFailure(4),
      terminalStopFailure(6, "Regression detected after import repair attempt")
    ]
  };
}
