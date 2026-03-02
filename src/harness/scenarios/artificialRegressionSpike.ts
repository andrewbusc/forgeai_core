import { architectureContractFailure, terminalStopFailure, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createArtificialRegressionSpikeScenario(occurrence: number): ScenarioDefinition {
  const modules = occurrence % 2 === 0 ? ["project", "audit"] : ["task", "audit"];

  return {
    label: "artificial_regression_spike",
    occurrence,
    goal: `Exercise artificial regression spike sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce a repair path that gets measurably worse after correction so the regression gate should trip deterministically.`,
    correctionPhase: "feature_reintegration",
    correctionPrompt: "Attempt a bounded repair, even though the scenario is scripted to regress after the first correction.",
    correctionPath: `src/modules/${modules[0]}/service/artificial-regression-fix-${occurrence}.ts`,
    correctionContent: `export const artificialRegressionRepair${occurrence} = ${JSON.stringify({
      phase: "feature_reintegration",
      modules
    })};\n`,
    validationSequence: [
      architectureContractFailure(4, modules),
      architectureContractFailure(7, modules),
      terminalStopFailure(7, "Regression spike remains unresolved after repair")
    ]
  };
}
