import { importResolutionFailure, passValidation, type ScenarioDefinition } from "../scenario-fixtures.js";

export function createPathologicalImportGraphScenario(occurrence: number): ScenarioDefinition {
  return {
    label: "pathological_import_graph",
    occurrence,
    goal: `Repair pathological import graph sample ${occurrence}`,
    initialPrompt: `Scenario ${occurrence}: introduce a missing-module import chain that should recover through the deterministic import recipe and debt paydown path.`,
    correctionPhase: "micro_targeted_repair",
    correctionPrompt: "Resolve the missing import deterministically, then retire any provisional stub debt cleanly.",
    correctionPath: `src/modules/project/service/pathological-import-fix-${occurrence}.ts`,
    correctionContent: `export const pathologicalImportRepair${occurrence} = "stabilized-import-graph";\n`,
    validationSequence: [importResolutionFailure(4), passValidation()]
  };
}
