import { architectureContractFailure, passValidation, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createLegalSlowConvergenceScenario(occurrence: number): ScenarioDefinition {
  const modules = occurrence % 2 === 0 ? ["project", "audit"] : ["task", "audit"];

  return {
    label: "legal_slow_convergence",
    occurrence,
    goal: `Exercise legal slow convergence sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce a broad architecture drift that should improve steadily over several bounded corrections without tripping reliability gates.`,
    correctionPhase: "feature_reintegration",
    correctionPrompt: "Reduce the remaining blockers gradually while preserving bounded, monotonic progress.",
    correctionPath: `src/modules/${modules[0]}/service/legal-slow-fix-${occurrence}.ts`,
    correctionContent: `export const legalSlowRepair${occurrence} = ${JSON.stringify({
      phase: "feature_reintegration",
      modules
    })};\n`,
    validationSequence: [
      architectureContractFailure(10, modules),
      architectureContractFailure(8, modules),
      architectureContractFailure(6, modules),
      architectureContractFailure(4, modules),
      passValidation()
    ]
  };
}
