import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { AppStore } from "../../lib/project-store.js";
import { type AiProvider, ProviderRegistry } from "../../lib/providers.js";
import { pathExists, readTextFile, writeTextFile } from "../../lib/fs-utils.js";
import { Project } from "../../types.js";
import { AgentKernel } from "../kernel.js";
import { AgentPlanner, type PlanCorrectionInput } from "../planner.js";
import { AgentPlan, PlannerInput, ValidateAgentRunInput, ValidateAgentRunOutput } from "../types.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Kernel correction flow tests require DATABASE_URL or TEST_DATABASE_URL. Example: postgres://postgres:postgres@localhost:5432/deeprun_test"
  );
}
const requiredDatabaseUrl: string = databaseUrl;

interface Harness {
  tmpRoot: string;
  store: AppStore;
  project: Project;
  userId: string;
}

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function createHarness(): Promise<Harness> {
  process.env.DATABASE_URL = requiredDatabaseUrl;
  if (!process.env.DATABASE_SSL && !isLocalDatabaseUrl(requiredDatabaseUrl)) {
    process.env.DATABASE_SSL = "require";
  }

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "deeprun-kernel-correction-flow-"));
  const store = new AppStore(tmpRoot);
  await store.initialize();

  const suffix = randomUUID().slice(0, 8);
  const user = await store.createUser({
    email: `kernel-correction-${suffix}@example.com`,
    name: `Kernel Correction ${suffix}`,
    passwordHash: "hash"
  });

  const org = await store.createOrganization({
    name: `Kernel Correction Org ${suffix}`,
    slug: `kernel-correction-org-${suffix}`
  });

  await store.createMembership({
    orgId: org.id,
    userId: user.id,
    role: "owner"
  });

  const workspace = await store.createWorkspace({
    orgId: org.id,
    name: `Workspace ${suffix}`,
    description: "Kernel correction flow test workspace"
  });

  const project = await store.createProject({
    orgId: org.id,
    workspaceId: workspace.id,
    createdByUserId: user.id,
    name: `Project ${suffix}`,
    description: "Kernel correction flow test project",
    templateId: "canonical-backend"
  });

  return { tmpRoot, store, project, userId: user.id };
}

async function destroyHarness(harness: Harness): Promise<void> {
  await harness.store.close();
  await rm(harness.tmpRoot, { recursive: true, force: true });
}

function withValidationModesOff<T>(fn: () => Promise<T>): Promise<T> {
  const previousLight = process.env.AGENT_LIGHT_VALIDATION_MODE;
  const previousHeavy = process.env.AGENT_HEAVY_VALIDATION_MODE;
  const previousHeavyInstall = process.env.AGENT_HEAVY_INSTALL_DEPS;

  process.env.AGENT_LIGHT_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_INSTALL_DEPS = "false";

  return fn().finally(() => {
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
  });
}

class MockCorrectionPlanner extends AgentPlanner {
  readonly correctionCalls: PlanCorrectionInput[] = [];

  override async plan(input: PlannerInput): Promise<AgentPlan> {
    return {
      goal: input.goal,
      steps: [
        {
          id: "step-1",
          type: "modify",
          tool: "write_file",
          input: {
            path: "src/feature.ts",
            content: "export const featureChange = true;\n"
          }
        }
      ]
    };
  }

  override async planCorrection(input: PlanCorrectionInput): Promise<AgentPlan> {
    this.correctionCalls.push(input);
    const attempt = this.correctionCalls.length;

    return {
      goal: input.originalIntent,
      steps: [
        {
          id: `auto-correction-${attempt}`,
          type: "modify",
          tool: "write_file",
          mutates: true,
          input: {
            mode: "correction",
            path: `src/auto-correction-${attempt}.ts`,
            content: `export const autoCorrectionAttempt = ${attempt};\n`,
            originalIntent: input.originalIntent,
            validationSummary: input.validationSummary,
            correctionProfile: input.correctionProfile
          }
        }
      ]
    };
  }
}

class SequencedValidationKernel extends AgentKernel {
  private validationIndex = 0;

  constructor(
    input: ConstructorParameters<typeof AgentKernel>[0],
    private readonly validationSequence: Array<ValidateAgentRunOutput["validation"]>
  ) {
    super(input);
  }

  get validationCallCount(): number {
    return this.validationIndex;
  }

  override async validateRunOutput(input: ValidateAgentRunInput): Promise<ValidateAgentRunOutput> {
    const run = await this.getRun(input.project.id, input.runId);
    if (!run) {
      throw new Error("Agent run not found.");
    }

    const current =
      this.validationSequence[Math.min(this.validationIndex, Math.max(0, this.validationSequence.length - 1))];
    this.validationIndex += 1;

    if (!current) {
      throw new Error("No validation result scripted for test.");
    }

    return {
      run,
      targetPath: `/mock/${run.id}`,
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

class ScriptedInvariantProvider implements AiProvider {
  descriptor = {
    id: "scripted-invariant",
    name: "Scripted Invariant Provider",
    defaultModel: "scripted-v1",
    configured: true
  };

  async generate() {
    return {
      summary: "Create a service file that references a missing dto file.",
      files: [
        {
          action: "create" as const,
          path: "src/modules/project/service/project-service.ts",
          content:
            "import { ProjectDto } from \"../dto/project-dto.js\";\n\nexport const projectService = {\n  create(input: ProjectDto) {\n    return input;\n  }\n};\n"
        }
      ],
      runCommands: []
    };
  }
}

function registerProvider(registry: ProviderRegistry, provider: AiProvider): void {
  (registry as unknown as { providers: Map<string, AiProvider> }).providers.set(provider.descriptor.id, provider);
}

function validationPass(): ValidateAgentRunOutput["validation"] {
  return {
    ok: true,
    blockingCount: 0,
    warningCount: 0,
    summary: "all checks passed; blocking=0; warnings=0",
    checks: [{ id: "architecture", status: "pass", message: "ok" }]
  };
}

function validationArchitectureFail(): ValidateAgentRunOutput["validation"] {
  return {
    ok: false,
    blockingCount: 24,
    warningCount: 0,
    summary: "failed checks: architecture, typecheck, build; blocking=24; warnings=0",
    checks: [
      {
        id: "architecture",
        status: "fail",
        message: "Light architecture validation failed.",
        details: {
          blockingCount: 22,
          warningCount: 0,
          violations: [
            {
              file: "src/modules/project/service/project-service.ts",
              target: "src/modules/audit/service/audit-service.ts",
              message: "Cross-module import from 'project' to 'audit' is not allowed.",
              ruleId: "ARCH.MODULE_ISOLATION",
              severity: "error"
            },
            {
              file: "src/modules/task/tests",
              message: "Module 'task' must define tests under 'src/modules/task/tests'.",
              ruleId: "TEST.CONTRACT_TEST_DIR_REQUIRED",
              severity: "error"
            }
          ]
        }
      },
      { id: "typecheck", status: "fail", message: "Typecheck command failed.", details: { exitCode: 2 } },
      { id: "build", status: "fail", message: "Build command failed.", details: { exitCode: 2 } }
    ]
  };
}

function validationTypecheckFail(blockingCount = 2): ValidateAgentRunOutput["validation"] {
  return {
    ok: false,
    blockingCount,
    warningCount: 0,
    summary: `failed checks: typecheck; blocking=${blockingCount}; warnings=0`,
    checks: [
      { id: "architecture", status: "pass", message: "Light architecture validation passed." },
      { id: "typecheck", status: "fail", message: "Typecheck command failed.", details: { exitCode: 2 } }
    ]
  };
}

function validationImportResolutionFail(): ValidateAgentRunOutput["validation"] {
  return {
    ok: false,
    blockingCount: 4,
    warningCount: 0,
    summary: "failed checks: typecheck; blocking=4; warnings=0",
    checks: [
      { id: "architecture", status: "pass", message: "Light architecture validation passed." },
      {
        id: "typecheck",
        status: "fail",
        message: "Typecheck command failed.",
        details: {
          exitCode: 2,
          stderr:
            "src/modules/project/service/project-service.ts(1,28): error TS2307: Cannot find module '../dto/project-dto.js' or its corresponding type declarations."
        }
      }
    ]
  };
}

test("auto-correction appends one correction step and re-validates to pass in the same run", async () =>
  withValidationModesOff(async () => {
    const harness = await createHarness();

    try {
      const planner = new MockCorrectionPlanner();
      const kernel = new SequencedValidationKernel(
        {
          store: harness.store,
          planner,
          providers: new ProviderRegistry()
        },
        [validationArchitectureFail(), validationPass()]
      );

      const started = await kernel.startRunWithPlan({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Add audit logging for project and task create/update/delete actions with tests",
        providerId: "mock",
        plan: {
          goal: "Add audit logging for project and task create/update/delete actions with tests",
          steps: [
            {
              id: "step-1",
              type: "modify",
              tool: "ai_mutation",
              mutates: true,
              input: {
                mode: "generate",
                prompt: "Add audit logging for project and task create/update/delete actions with tests",
                provider: "mock"
              }
            }
          ]
        },
        requestId: "kernel-correction-flow-pass",
        executionProfile: "builder"
      });

      assert.equal(started.run.status, "complete");
      assert.equal(started.run.validationStatus, "passed");
      assert.equal(started.run.correctionAttempts, 1);
      assert.equal(started.run.lastCorrectionReason, "architecture");
      assert.equal(kernel.validationCallCount, 2);
      assert.equal(planner.correctionCalls.length, 1);
      assert.equal(planner.correctionCalls[0]?.correctionProfile.reason, "architecture");
      assert.deepEqual(planner.correctionCalls[0]?.correctionProfile.architectureModules, ["audit", "project", "task"]);

      const completedSteps = started.steps.filter((step) => step.status === "completed");
      assert.equal(completedSteps.length, 2);
      assert.equal(completedSteps[0]?.stepId, "step-1");
      assert.equal(completedSteps[1]?.stepId, "auto-correction-1");
      assert.ok(completedSteps[0]?.commitHash);
      assert.ok(completedSteps[1]?.commitHash);

      const runs = await harness.store.listAgentRunsByProject(harness.project.id);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.id, started.run.id);
    } finally {
      await destroyHarness(harness);
    }
  }));

test("auto-correction stops after max attempts and keeps same run complete with failed validation", async () =>
  withValidationModesOff(async () => {
    const harness = await createHarness();

    try {
      const planner = new MockCorrectionPlanner();
      const kernel = new SequencedValidationKernel(
        {
          store: harness.store,
          planner,
          providers: new ProviderRegistry()
        },
        [validationTypecheckFail(2), validationTypecheckFail(2), validationTypecheckFail(2)]
      );

      const started = await kernel.startRunWithPlan({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Add audit logging for project and task create/update/delete actions with tests",
        providerId: "mock",
        plan: {
          goal: "Add audit logging for project and task create/update/delete actions with tests",
          steps: [
            {
              id: "step-1",
              type: "modify",
              tool: "ai_mutation",
              mutates: true,
              input: {
                mode: "generate",
                prompt: "Add audit logging for project and task create/update/delete actions with tests",
                provider: "mock"
              }
            }
          ]
        },
        requestId: "kernel-correction-flow-limit",
        executionProfile: "builder"
      });

      assert.equal(started.run.status, "complete");
      assert.equal(started.run.validationStatus, "failed");
      assert.equal(started.run.correctionAttempts, 2);
      assert.equal(started.run.lastCorrectionReason, "typecheck");
      assert.equal(kernel.validationCallCount, 3);
      assert.equal(planner.correctionCalls.length, 2);

      const completedSteps = started.steps.filter((step) => step.status === "completed");
      assert.equal(completedSteps.length, 3);
      assert.equal(completedSteps[0]?.stepId, "step-1");
      assert.equal(completedSteps[1]?.stepId, "auto-correction-1");
      assert.equal(completedSteps[2]?.stepId, "auto-correction-2");
      assert.ok(completedSteps.every((step) => Boolean(step.commitHash)));
    } finally {
      await destroyHarness(harness);
    }
  }));

test("project-mode auto-correction preserves latest run commit pointers across correction resumes", async () =>
  withValidationModesOff(async () => {
    const harness = await createHarness();

    try {
      const planner = new MockCorrectionPlanner();
      const kernel = new SequencedValidationKernel(
        {
          store: harness.store,
          planner,
          providers: new ProviderRegistry()
        },
        [validationTypecheckFail(2), validationTypecheckFail(2), validationTypecheckFail(2)]
      );

      const started = await kernel.startRunWithPlan({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Add audit logging for project and task create/update/delete actions with tests",
        providerId: "mock",
        plan: {
          goal: "Add audit logging for project and task create/update/delete actions with tests",
          steps: [
            {
              id: "step-1",
              type: "modify",
              tool: "ai_mutation",
              mutates: true,
              input: {
                mode: "generate",
                prompt: "Add audit logging for project and task create/update/delete actions with tests",
                provider: "mock"
              }
            }
          ]
        },
        requestId: "kernel-correction-flow-project-mode-commit-pointers",
        executionMode: "project",
        executionProfile: "builder"
      });

      assert.equal(started.run.status, "complete");
      assert.equal(started.run.validationStatus, "failed");
      assert.equal(started.run.correctionAttempts, 2);

      const completedSteps = started.steps
        .filter((step) => step.status === "completed")
        .sort((a, b) => a.stepIndex - b.stepIndex || a.attempt - b.attempt);
      assert.equal(completedSteps.length, 3);
      assert.ok(completedSteps.every((step) => Boolean(step.commitHash)));

      const lastStepCommit = completedSteps[completedSteps.length - 1]?.commitHash || null;
      assert.ok(lastStepCommit);
      assert.equal(started.run.currentCommitHash, lastStepCommit);
      assert.equal(started.run.lastValidCommitHash, lastStepCommit);
    } finally {
      await destroyHarness(harness);
    }
  }));

test("builder auto-corrects an initial precommit invariant failure without consuming correctionAttempts", async () =>
  withValidationModesOff(async () => {
    const harness = await createHarness();

    try {
      const planner = new MockCorrectionPlanner();
      const providers = new ProviderRegistry();
      registerProvider(providers, new ScriptedInvariantProvider());
      const kernel = new SequencedValidationKernel(
        {
          store: harness.store,
          planner,
          providers
        },
        [validationPass()]
      );

      const started = await kernel.startRunWithPlan({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Add audit logging for project and task create/update/delete actions with tests",
        providerId: "scripted-invariant",
        plan: {
          goal: "Add audit logging for project and task create/update/delete actions with tests",
          steps: [
            {
              id: "step-1",
              type: "modify",
              tool: "ai_mutation",
              mutates: true,
              input: {
                mode: "generate",
                prompt: "Add audit logging for project and task create/update/delete actions with tests",
                provider: "scripted-invariant"
              }
            }
          ]
        },
        requestId: "kernel-correction-flow-initial-invariant",
        executionProfile: "builder"
      });

      assert.equal(started.run.status, "complete");
      assert.equal(started.run.validationStatus, "passed");
      assert.equal(started.run.correctionAttempts, 0);
      assert.equal(kernel.validationCallCount, 1);
      assert.equal(planner.correctionCalls.length, 1);
      assert.equal(planner.correctionCalls[0]?.correctionProfile.reason, "architecture");

      const failedStep = started.steps.find((step) => step.stepId === "step-1");
      assert.ok(failedStep);
      assert.equal(failedStep?.status, "failed");

      const correctionStep = started.steps.find((step) => step.stepId === "auto-correction-1");
      assert.ok(correctionStep);
      assert.equal(correctionStep?.status, "completed");
      assert.ok(correctionStep?.commitHash);
    } finally {
      await destroyHarness(harness);
    }
  }));

test("debt_resolution records debtPaidDown only after replacing a marked stub", async () =>
  withValidationModesOff(async () => {
    const harness = await createHarness();

    try {
      const providers = new ProviderRegistry();
      registerProvider(providers, new ScriptedInvariantProvider());
      const kernel = new SequencedValidationKernel(
        {
          store: harness.store,
          providers
        },
        [validationImportResolutionFail(), validationPass(), validationPass()]
      );

      const started = await kernel.startRunWithPlan({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Create project dto imports and retire provisional stubs",
        providerId: "scripted-invariant",
        plan: {
          goal: "Create project dto imports and retire provisional stubs",
          steps: [
            {
              id: "step-1",
              type: "modify",
              tool: "ai_mutation",
              mutates: true,
              input: {
                mode: "generate",
                prompt: "Create project dto imports and retire provisional stubs",
                provider: "scripted-invariant"
              }
            }
          ]
        },
        requestId: "kernel-correction-flow-debt-paid-down",
        executionProfile: "builder"
      });

      assert.equal(started.run.status, "complete");
      assert.equal(started.run.validationStatus, "passed");
      assert.equal(started.run.correctionAttempts, 2);

      const rows = await harness.store.query<{
        phase: string | null;
        outcome: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT phase, outcome, metadata
         FROM learning_events
         WHERE run_id = $1
         ORDER BY created_at ASC`,
        [started.run.id]
      );

      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.phase, "import_resolution_recipe");
      assert.equal(rows[0]?.outcome, "provisionally_fixed");
      assert.equal(rows[1]?.phase, "debt_resolution");
      assert.equal(rows[1]?.outcome, "success");
      assert.equal(rows[1]?.metadata?.debtPaidDown, true);
      assert.ok(
        rows[1]?.metadata?.debtPaydownAction === "replaced_stub" ||
          rows[1]?.metadata?.debtPaydownAction === "removed_stub"
      );

      const stubPath = path.join(started.run.worktreePath || "", "src/modules/project/dto/project-dto.ts");
      if (await pathExists(stubPath)) {
        const stubContents = await readTextFile(stubPath);
        assert.ok(!stubContents.includes("@deeprun-stub"));
      }
    } finally {
      await destroyHarness(harness);
    }
  }));

test("debt_resolution marks rewired_import paid down when referrers stop resolving to the stub", async () =>
  withValidationModesOff(async () => {
    const harness = await createHarness();

    try {
      const kernel = new AgentKernel({
        store: harness.store,
        providers: new ProviderRegistry()
      });

      const projectRoot = path.join(harness.tmpRoot, "rewired-import-project");
      const stubPath = path.join(projectRoot, "src/modules/project/dto/project-dto.ts");
      const realModulePath = path.join(projectRoot, "src/modules/shared/project-dto.ts");
      const referrerPath = path.join(projectRoot, "src/modules/project/service/project-service.ts");
      const stubContent =
        '// @deeprun-stub {"createdByRunId":"run-1","stubPath":"src/modules/project/dto/project-dto.ts"}\n' +
        "export const ProjectDto: any = undefined as any;\n";

      await writeTextFile(
        path.join(projectRoot, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              module: "NodeNext",
              moduleResolution: "NodeNext",
              target: "ES2022",
              allowJs: true
            }
          },
          null,
          2
        )
      );
      await writeTextFile(stubPath, stubContent);
      await writeTextFile(realModulePath, 'export const ProjectDto = { kind: "real" } as const;\n');
      await writeTextFile(
        referrerPath,
        'import { ProjectDto } from "../../shared/project-dto.js";\n\nexport const projectService = ProjectDto;\n'
      );

      const result = await (kernel as any).evaluateDebtResolution({
        projectRoot,
        phase: "debt_resolution",
        targets: [
          {
            path: "src/modules/project/dto/project-dto.ts",
            exportsSummary: { named: ["ProjectDto"] },
            referrers: [
              {
                containingFile: "src/modules/project/service/project-service.ts",
                specifier: "../dto/project-dto.js"
              }
            ],
            stubHashBefore: createHash("sha256").update(stubContent).digest("hex"),
            markerPresentBefore: true
          }
        ]
      });

      assert.equal(result?.debtPaidDown, true);
      assert.equal(result?.action, "rewired_import");
      assert.equal(result?.targets[0]?.paidDown, true);
      assert.equal(result?.targets[0]?.rewiredImport?.referrersChecked, 1);
      assert.deepEqual(result?.targets[0]?.rewiredImport?.stillReferring, []);

      const persistedStub = await readTextFile(stubPath);
      assert.ok(persistedStub.includes("@deeprun-stub"));
    } finally {
      await destroyHarness(harness);
    }
  }));
