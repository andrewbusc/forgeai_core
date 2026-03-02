import type { ValidateAgentRunOutput } from "../agent/types.js";

export type ScenarioLabel =
  | "architecture_contract"
  | "typecheck_failure"
  | "build_failure"
  | "pathological_import_graph"
  | "legal_slow_convergence"
  | "artificial_regression_spike"
  | "long_correction_loop"
  | "regression"
  | "oscillation";

export interface ScenarioDefinition {
  label: ScenarioLabel;
  occurrence: number;
  goal: string;
  initialPrompt: string;
  correctionPhase?: string | null;
  correctionPrompt: string;
  correctionPath: string;
  correctionContent: string;
  validationSequence: Array<ValidateAgentRunOutput["validation"]>;
}

export function passValidation(): ValidateAgentRunOutput["validation"] {
  return {
    ok: true,
    blockingCount: 0,
    warningCount: 0,
    summary: "all checks passed; blocking=0; warnings=0",
    checks: [{ id: "architecture", status: "pass", message: "ok" }]
  };
}

export function architectureContractFailure(
  blockingCount: number,
  modules: string[],
  missingLayer = "dto"
): ValidateAgentRunOutput["validation"] {
  const primaryModule = modules[0] || "project";
  const secondaryModule = modules[1] || "audit";

  return {
    ok: false,
    blockingCount,
    warningCount: 0,
    summary: `failed checks: architecture; blocking=${blockingCount}; warnings=0`,
    checks: [
      {
        id: "architecture",
        status: "fail",
        message: "Light architecture validation failed.",
        details: {
          blockingCount,
          warningCount: 0,
          violations: [
            {
              file: `src/modules/${primaryModule}/service/${primaryModule}-service.ts`,
              target: `src/modules/${secondaryModule}/service/${secondaryModule}-service.ts`,
              message: `Cross-module import from '${primaryModule}' to '${secondaryModule}' is not allowed.`,
              ruleId: "ARCH.MODULE_ISOLATION",
              severity: "error"
            },
            {
              file: `src/modules/${primaryModule}/${missingLayer}`,
              message: `Module '${primaryModule}' must define layer directory '${missingLayer}'.`,
              ruleId: "STRUCTURE.MODULE_LAYER_REQUIRED",
              severity: "error"
            }
          ]
        }
      }
    ]
  };
}

export function typecheckFailure(
  blockingCount: number,
  summary = "Typecheck command failed.",
  details: Record<string, unknown> = { exitCode: 2 }
): ValidateAgentRunOutput["validation"] {
  return {
    ok: false,
    blockingCount,
    warningCount: 0,
    summary: `failed checks: typecheck; blocking=${blockingCount}; warnings=0`,
    checks: [{ id: "typecheck", status: "fail", message: summary, details }]
  };
}

export function buildFailure(
  blockingCount: number,
  summary = "Build command failed.",
  details: Record<string, unknown> = { exitCode: 2 }
): ValidateAgentRunOutput["validation"] {
  return {
    ok: false,
    blockingCount,
    warningCount: 0,
    summary: `failed checks: build; blocking=${blockingCount}; warnings=0`,
    checks: [{ id: "build", status: "fail", message: summary, details }]
  };
}

export function importResolutionFailure(blockingCount: number): ValidateAgentRunOutput["validation"] {
  return {
    ok: false,
    blockingCount,
    warningCount: 0,
    summary: `failed checks: typecheck; blocking=${blockingCount}; warnings=0`,
    checks: [
      {
        id: "typecheck",
        status: "fail",
        message: "Typecheck command failed.",
        details: {
          exitCode: 2,
          stderr:
            "Error: Cannot find module '../dto/missing-contract.js' imported from 'src/modules/project/service/project-service.ts'"
        }
      }
    ]
  };
}

export function terminalStopFailure(
  blockingCount: number,
  summary: string
): ValidateAgentRunOutput["validation"] {
  return {
    ok: false,
    blockingCount,
    warningCount: 0,
    summary: `${summary}; blocking=${blockingCount}; warnings=0`,
    checks: [
      {
        id: "manual_review",
        status: "fail",
        message: summary,
        details: {
          reason: "harness_terminal_stop"
        }
      }
    ]
  };
}
