import { architectureContractFailure, passValidation, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createArchitectureContractScenario(occurrence: number): ScenarioDefinition {
  const modules = occurrence % 2 === 0 ? ["task", "audit"] : ["project", "audit"];
  const correctionPhase = occurrence <= 3 ? "structural_reset" : "feature_reintegration";

  return {
    label: "architecture_contract",
    occurrence,
    goal: `Repair canonical backend architecture contract drift sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce an architecture contract violation in a canonical backend module.`,
    correctionPhase,
    correctionPrompt: `Execute ${correctionPhase} to restore canonical module boundaries and required layers.`,
    correctionPath: `src/modules/${modules[0]}/service/architecture-contract-fix-${occurrence}.ts`,
    correctionContent: `export const architectureContractFix${occurrence} = ${JSON.stringify({
      phase: correctionPhase,
      modules
    })};\n`,
    validationSequence: [architectureContractFailure(24, modules), passValidation()]
  };
}
