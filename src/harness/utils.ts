import { randomUUID } from "node:crypto";
import { AppStore } from "../lib/project-store.js";
import { ProviderRegistry } from "../lib/providers.js";
import { safeResolvePath, writeTextFile } from "../lib/fs-utils.js";
import { Project } from "../types.js";
import { AgentKernel } from "../agent/kernel.js";
import { AgentPlanner, type PlanCorrectionInput } from "../agent/planner.js";
import { EXECUTION_CONFIG_SCHEMA_VERSION } from "../agent/execution-contract.js";
import { type AgentPlan, type ValidateAgentRunInput, type ValidateAgentRunOutput } from "../agent/types.js";
import { type ScenarioDefinition, type ScenarioLabel } from "./scenario-fixtures.js";
import { passValidation } from "./scenario-fixtures.js";
import { createArchitectureContractScenario } from "./scenarios/architectureContract.js";
import { createTypecheckFailureScenario } from "./scenarios/typecheckFailure.js";
import { createBuildFailureScenario } from "./scenarios/buildFailure.js";
import { createPathologicalImportGraphScenario } from "./scenarios/pathologicalImportGraph.js";
import { createLegalSlowConvergenceScenario } from "./scenarios/legalSlowConvergence.js";
import { createArtificialRegressionSpikeScenario } from "./scenarios/artificialRegressionSpike.js";
import { createLongCorrectionLoopScenario } from "./scenarios/longCorrectionLoop.js";
import { createRegressionScenario } from "./scenarios/regressionScenario.js";
import { createOscillationScenario } from "./scenarios/oscillationScenario.js";

interface HarnessIdentity {
  userId: string;
  orgId: string;
  workspaceId: string;
}

export interface HarnessRuntime {
  store: AppStore;
  identity: HarnessIdentity;
}

export interface ScenarioRunSummary {
  label: ScenarioLabel;
  occurrence: number;
  scenarioRunId: string;
  runId: string;
  projectId: string;
  projectRoot: string;
  status: string;
  validationStatus: string | null;
  correctionAttempts: number;
  learningEventCount: number;
}

export async function createHarnessRuntime(store: AppStore): Promise<HarnessRuntime> {
  const suffix = randomUUID().slice(0, 8);
  const user = await store.createUser({
    email: `pressure-harness-${suffix}@example.com`,
    name: `Pressure Harness ${suffix}`,
    passwordHash: "hash"
  });

  const org = await store.createOrganization({
    name: `Pressure Harness Org ${suffix}`,
    slug: `pressure-harness-org-${suffix}`
  });

  await store.createMembership({
    orgId: org.id,
    userId: user.id,
    role: "owner"
  });

  const workspace = await store.createWorkspace({
    orgId: org.id,
    name: `Pressure Harness Workspace ${suffix}`,
    description: "Deterministic correction pressure harness workspace"
  });

  return {
    store,
    identity: {
      userId: user.id,
      orgId: org.id,
      workspaceId: workspace.id
    }
  };
}

function buildScenario(label: ScenarioLabel, occurrence: number): ScenarioDefinition {
  switch (label) {
    case "architecture_contract":
      return createArchitectureContractScenario(occurrence);
    case "typecheck_failure":
      return createTypecheckFailureScenario(occurrence);
    case "build_failure":
      return createBuildFailureScenario(occurrence);
    case "pathological_import_graph":
      return createPathologicalImportGraphScenario(occurrence);
    case "legal_slow_convergence":
      return createLegalSlowConvergenceScenario(occurrence);
    case "artificial_regression_spike":
      return createArtificialRegressionSpikeScenario(occurrence);
    case "long_correction_loop":
      return createLongCorrectionLoopScenario(occurrence);
    case "regression":
      return createRegressionScenario(occurrence);
    case "oscillation":
      return createOscillationScenario(occurrence);
    default:
      throw new Error(`Unsupported scenario label: ${String(label)}`);
  }
}

function harnessExecutionConfig() {
  return {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "full" as const,
    lightValidationMode: "off" as const,
    heavyValidationMode: "off" as const,
    maxRuntimeCorrectionAttempts: 5,
    maxHeavyCorrectionAttempts: 3,
    correctionPolicyMode: "enforce" as const,
    correctionConvergenceMode: "enforce" as const,
    plannerTimeoutMs: 120_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  };
}

async function createScenarioProject(runtime: HarnessRuntime, scenario: ScenarioDefinition): Promise<Project> {
  const suffix = randomUUID().slice(0, 8);

  // Each scenario gets a fresh project baseline so we never have to mutate or restore a shared workspace.
  return runtime.store.createProject({
    orgId: runtime.identity.orgId,
    workspaceId: runtime.identity.workspaceId,
    createdByUserId: runtime.identity.userId,
    name: `${scenario.label}-${scenario.occurrence}-${suffix}`,
    description: `Correction pressure harness scenario ${scenario.label} #${scenario.occurrence}`,
    templateId: "canonical-backend"
  });
}

class ScenarioPlanner extends AgentPlanner {
  private correctionAttemptCount = 0;

  constructor(private readonly scenario: ScenarioDefinition) {
    super();
  }

  private resolveRecipePhase(input: PlanCorrectionInput): string | null {
    if (input.correctionProfile.clusters.some((cluster) => cluster.type === "typecheck_failure")) {
      return "typecheck_recipe";
    }
    if (input.correctionProfile.clusters.some((cluster) => cluster.type === "build_failure")) {
      return "build_recipe";
    }
    if (input.correctionProfile.clusters.some((cluster) => cluster.type === "test_failure")) {
      return "test_recipe";
    }
    return this.scenario.correctionPhase ?? null;
  }

  override async planCorrection(input: PlanCorrectionInput): Promise<AgentPlan> {
    this.correctionAttemptCount += 1;
    const forcedPhase =
      input.correctionProfile.plannerModeOverride === "debt_resolution"
        ? "debt_resolution"
        : input.correctionProfile.plannerModeOverride === "feature_reintegration"
          ? "feature_reintegration"
          : input.correctionProfile.plannerModeOverride === "architecture_reconstruction" ||
              input.correctionProfile.architectureCollapse
            ? "structural_reset"
            : this.resolveRecipePhase(input);

    return {
      goal: input.originalIntent,
      steps: [
        {
          id: `${this.scenario.label}-correction-${this.scenario.occurrence}-${this.correctionAttemptCount}`,
          type: "modify",
          tool: "write_file",
          mutates: true,
          input: {
            mode: "correction",
            ...(forcedPhase ? { phase: forcedPhase } : {}),
            path: this.scenario.correctionPath.replace(
              /\.ts$/,
              `-attempt-${this.correctionAttemptCount}.ts`
            ),
            prompt: `${this.scenario.correctionPrompt} Attempt ${this.correctionAttemptCount}.`,
            originalIntent: input.originalIntent,
            validationSummary: input.validationSummary,
            correctionProfile: input.correctionProfile,
            content: `${this.scenario.correctionContent.trimEnd()}\n`
          }
        }
      ]
    };
  }
}

class ScenarioKernel extends AgentKernel {
  private validationIndex = 0;

  constructor(
    input: ConstructorParameters<typeof AgentKernel>[0],
    private readonly scenario: ScenarioDefinition,
    private readonly resolveProjectRoot: (project: Project) => string
  ) {
    super(input);
  }

  private isImportResolutionValidationFailure(validation: ValidateAgentRunOutput["validation"]): boolean {
    return validation.checks.some((check) => {
      const details =
        check.details && typeof check.details === "object" && !Array.isArray(check.details)
          ? (check.details as Record<string, unknown>)
          : null;
      return typeof details?.stderr === "string" && details.stderr.includes("Cannot find module");
    });
  }

  private isHarnessTerminalStop(validation: ValidateAgentRunOutput["validation"]): boolean {
    return validation.checks.some((check) => {
      const details =
        check.details && typeof check.details === "object" && !Array.isArray(check.details)
          ? (check.details as Record<string, unknown>)
          : null;
      return check.id === "manual_review" && details?.reason === "harness_terminal_stop";
    });
  }

  private hasFailedCheck(validation: ValidateAgentRunOutput["validation"], checkId: string): boolean {
    return validation.checks.some((check) => check.id === checkId && check.status === "fail");
  }

  private async resolveScriptedValidation(
    input: ValidateAgentRunInput,
    validation: ValidateAgentRunOutput["validation"]
  ): Promise<ValidateAgentRunOutput["validation"]> {
    const detail = await this.getRunWithSteps(input.project.id, input.runId);
    const latestCorrectionStep = [...(detail?.steps || [])].reverse().find((step) => {
      const payload =
        step.inputPayload && typeof step.inputPayload === "object" && !Array.isArray(step.inputPayload)
          ? (step.inputPayload as Record<string, unknown>)
          : null;
      return payload?.mode === "correction";
    });
    const correctionPayload =
      latestCorrectionStep?.inputPayload &&
      typeof latestCorrectionStep.inputPayload === "object" &&
      !Array.isArray(latestCorrectionStep.inputPayload)
        ? (latestCorrectionStep.inputPayload as Record<string, unknown>)
        : null;
    const phase = typeof correctionPayload?.phase === "string" ? correctionPayload.phase.trim() : "";
    const run = detail?.run ?? null;
    const runMetadata =
      run && run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
        ? (run.metadata as Record<string, unknown>)
        : null;
    const shouldForceDebtPaydownFailure = runMetadata?.stressNegativeControl === "debt_paydown_failure";

    if (shouldForceDebtPaydownFailure && phase === "debt_resolution") {
      const projectRoots = Array.from(
        new Set(
          [
            typeof run?.worktreePath === "string" && run.worktreePath.trim() ? run.worktreePath : null,
            this.resolveProjectRoot(input.project)
          ].filter((entry): entry is string => Boolean(entry && entry.trim()))
        )
      );
      if (!projectRoots.length) {
        return validation;
      }
      const files = Array.isArray(correctionPayload?.files)
        ? correctionPayload.files.filter(
            (entry): entry is { path: string } =>
              Boolean(entry) &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              typeof (entry as Record<string, unknown>).path === "string"
          )
        : [];

      for (const file of files) {
        for (const projectRoot of projectRoots) {
          const absolutePath = safeResolvePath(projectRoot, file.path);
          const stubContent = `// @deeprun-stub ${JSON.stringify({
            negativeControl: true,
            runId: run?.id ?? null,
            scenarioLabel: this.scenario.label
          })}\nexport const deepRunNegativeStub: any = undefined as any;\n`;
          await writeTextFile(absolutePath, stubContent);
        }
      }
    }

    const forcedImportRecovery =
      phase === "import_resolution_recipe" || phase === "structural_reset" || phase === "debt_resolution";
    if (forcedImportRecovery && this.isImportResolutionValidationFailure(validation)) {
      return passValidation();
    }

    if (phase === "typecheck_recipe" && (this.hasFailedCheck(validation, "typecheck") || this.isHarnessTerminalStop(validation))) {
      return passValidation();
    }

    if (phase === "build_recipe" && (this.hasFailedCheck(validation, "build") || this.isHarnessTerminalStop(validation))) {
      return passValidation();
    }

    if (phase === "test_recipe" && (this.hasFailedCheck(validation, "test") || this.isHarnessTerminalStop(validation))) {
      return passValidation();
    }

    if (
      forcedImportRecovery &&
      (this.scenario.label === "regression" || this.scenario.label === "oscillation") &&
      this.isHarnessTerminalStop(validation)
    ) {
      return passValidation();
    }

    return validation;
  }

  override async validateRunOutput(input: ValidateAgentRunInput): Promise<ValidateAgentRunOutput> {
    const run = await this.getRun(input.project.id, input.runId);
    if (!run) {
      throw new Error("Agent run not found.");
    }

    const scripted =
      this.scenario.validationSequence[
        Math.min(this.validationIndex, Math.max(0, this.scenario.validationSequence.length - 1))
      ];
    this.validationIndex += 1;

    if (!scripted) {
      throw new Error("No validation result scripted for scenario.");
    }

    const current = await this.resolveScriptedValidation(input, scripted);

    return {
      run,
      targetPath: `/harness/${run.id}`,
      validation: {
        ok: current.ok,
        blockingCount: current.blockingCount,
        warningCount: current.warningCount,
        summary: current.summary,
        checks: current.checks.map((check) => ({ ...check }))
      }
    };
  }
}

function initialPlanForScenario(scenario: ScenarioDefinition): AgentPlan {
  return {
    goal: scenario.goal,
    steps: [
      {
        id: `${scenario.label}-generate-${scenario.occurrence}`,
        type: "modify",
        tool: "ai_mutation",
        mutates: true,
        input: {
          mode: "generate",
          prompt: scenario.initialPrompt,
          provider: "mock"
        }
      }
    ]
  };
}

async function countLearningEventsForRun(store: AppStore, runId: string): Promise<number> {
  const rows = await store.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM learning_events WHERE run_id = $1`, [runId]);
  return Number(rows[0]?.count || 0);
}

export async function runScenario(
  runtime: HarnessRuntime,
  label: ScenarioLabel,
  occurrence: number,
  options?: {
    metadata?: Record<string, unknown>;
  }
): Promise<ScenarioRunSummary> {
  const scenario = buildScenario(label, occurrence);
  const scenarioRunId = randomUUID();
  const project = await createScenarioProject(runtime, scenario);
  const planner = new ScenarioPlanner(scenario);
  const kernel = new ScenarioKernel(
    {
      store: runtime.store,
      planner,
      providers: new ProviderRegistry()
    },
    scenario,
    (currentProject) => runtime.store.getProjectWorkspacePath(currentProject)
  );

  const previousLight = process.env.AGENT_LIGHT_VALIDATION_MODE;
  const previousHeavy = process.env.AGENT_HEAVY_VALIDATION_MODE;
  const previousHeavyInstall = process.env.AGENT_HEAVY_INSTALL_DEPS;

  process.env.AGENT_LIGHT_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_INSTALL_DEPS = "false";

  try {
    const started = await kernel.startRunWithPlan({
      project,
      createdByUserId: runtime.identity.userId,
      goal: scenario.goal,
      providerId: "mock",
      plan: initialPlanForScenario(scenario),
      requestId: `pressure-harness:${label}:${occurrence}`,
      executionProfile: "builder",
      executionConfig: harnessExecutionConfig(),
      metadata: {
        stress: true,
        scenarioLabel: label,
        scenarioRunId,
        ...(options?.metadata ?? {})
      }
    });

    return {
      label,
      occurrence,
      scenarioRunId,
      runId: started.run.id,
      projectId: project.id,
      projectRoot: runtime.store.getProjectWorkspacePath(project),
      status: started.run.status,
      validationStatus: started.run.validationStatus ?? null,
      correctionAttempts: started.run.correctionAttempts,
      learningEventCount: await countLearningEventsForRun(runtime.store, started.run.id)
    };
  } finally {
    if (previousLight === undefined) {
      delete process.env.AGENT_LIGHT_VALIDATION_MODE;
    } else {
      process.env.AGENT_LIGHT_VALIDATION_MODE = previousLight;
    }

    if (previousHeavy === undefined) {
      delete process.env.AGENT_HEAVY_VALIDATION_MODE;
    } else {
      process.env.AGENT_HEAVY_VALIDATION_MODE = previousHeavy;
    }

    if (previousHeavyInstall === undefined) {
      delete process.env.AGENT_HEAVY_INSTALL_DEPS;
    } else {
      process.env.AGENT_HEAVY_INSTALL_DEPS = previousHeavyInstall;
    }
  }
}
