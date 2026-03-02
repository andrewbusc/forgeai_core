import { architectureContractFailure, terminalStopFailure, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createLongCorrectionLoopScenario(occurrence: number): ScenarioDefinition {
  const modules = occurrence % 2 === 0 ? ["project", "audit"] : ["task", "audit"];

  return {
    label: "long_correction_loop",
    occurrence,
    goal: `Exercise long correction loop sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: keep the same architecture blocker alive across repeated micro-targeted attempts so the stall guard should trigger.`,
    correctionPhase: "micro_targeted_repair",
    correctionPrompt: "Retry a narrow repair without broadening scope, even though the blocker is scripted to remain unchanged.",
    correctionPath: `src/modules/${modules[0]}/service/long-loop-fix-${occurrence}.ts`,
    correctionContent: `export const longCorrectionLoopRepair${occurrence} = ${JSON.stringify({
      phase: "micro_targeted_repair",
      modules
    })};\n`,
    validationSequence: [
      architectureContractFailure(4, modules),
      architectureContractFailure(4, modules),
      architectureContractFailure(4, modules),
      terminalStopFailure(4, "Long correction loop remained stalled after repeated micro repairs")
    ]
  };
}
