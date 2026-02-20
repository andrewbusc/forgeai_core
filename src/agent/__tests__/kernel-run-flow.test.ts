import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AppStore } from "../../lib/project-store.js";
import { Project } from "../../types.js";
import { AgentExecutor } from "../executor.js";
import { AgentKernel } from "../kernel.js";
import { AgentPlanner } from "../planner.js";
import { createDefaultAgentToolRegistry } from "../tools/index.js";
import {
  AgentContext,
  AgentPlan,
  AgentStep,
  AgentStepExecution,
  PlannerInput,
  PlannerRuntimeCorrectionInput
} from "../types.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Kernel flow tests require DATABASE_URL or TEST_DATABASE_URL. Example: postgres://postgres:postgres@localhost:5432/forgeai_test"
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

class DeterministicPlanner extends AgentPlanner {
  override async plan(input: PlannerInput): Promise<AgentPlan> {
    return {
      goal: input.goal,
      steps: [
        {
          id: "step-1",
          type: "modify",
          tool: "write_file",
          input: {
            path: "src/generated.ts",
            content: `export const generatedAt = "${new Date().toISOString()}";\n`
          }
        },
        {
          id: "step-2",
          type: "analyze",
          tool: "list_files",
          input: {
            path: "src",
            maxEntries: 50
          }
        }
      ]
    };
  }

  override async planRuntimeCorrection(_input: PlannerRuntimeCorrectionInput): Promise<AgentStep> {
    return {
      id: "runtime-correction-1",
      type: "modify",
      tool: "write_file",
      input: {
        path: "src/runtime-correction.txt",
        content: "runtime correction\n"
      }
    };
  }
}

class RuntimeCorrectionPlanner extends AgentPlanner {
  override async plan(input: PlannerInput): Promise<AgentPlan> {
    return {
      goal: input.goal,
      steps: [
        {
          id: "step-verify-runtime",
          type: "verify",
          tool: "run_preview_container",
          input: {
            mode: "healthcheck"
          }
        }
      ]
    };
  }

  override async planRuntimeCorrection(_input: PlannerRuntimeCorrectionInput): Promise<AgentStep> {
    return {
      id: "runtime-correction-1",
      type: "modify",
      tool: "write_file",
      input: {
        path: "src/runtime-correction.ts",
        content: "export const corrected = true;\n"
      }
    };
  }
}

class HeavyValidationCorrectionPlanner extends AgentPlanner {
  override async plan(input: PlannerInput): Promise<AgentPlan> {
    return {
      goal: input.goal,
      steps: [
        {
          id: "step-seed-heavy-failure",
          type: "modify",
          tool: "write_file",
          input: {
            path: "src/illegal-layer/seed.ts",
            content: "export const seedHeavyFailure = true;\n"
          }
        }
      ]
    };
  }

  override async planRuntimeCorrection(input: PlannerRuntimeCorrectionInput): Promise<AgentStep> {
    return {
      id: `runtime-correction-${input.attempt}`,
      type: "modify",
      tool: "write_file",
      input: {
        path: `src/illegal-layer/validation-correction-${input.attempt}.ts`,
        content: `export const heavyValidationCorrectionAttempt = ${input.attempt};\n`
      }
    };
  }
}

class ScriptedExecutor extends AgentExecutor {
  constructor(
    private readonly executeFn: (step: AgentStep) => Promise<AgentStepExecution> | AgentStepExecution
  ) {
    super(createDefaultAgentToolRegistry());
  }

  override async executeStep(step: AgentStep, _context: AgentContext): Promise<AgentStepExecution> {
    return this.executeFn(step);
  }
}

function buildExecution(input: {
  step: AgentStep;
  status: AgentStepExecution["status"];
  output?: Record<string, unknown>;
  error?: string;
}): AgentStepExecution {
  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();

  return {
    stepId: input.step.id,
    tool: input.step.tool,
    type: input.step.type,
    status: input.status,
    input: input.step.input,
    output: input.output,
    error: input.error,
    startedAt,
    finishedAt
  };
}

async function createHarness(): Promise<Harness> {
  process.env.DATABASE_URL = requiredDatabaseUrl;
  if (!process.env.DATABASE_SSL && !isLocalDatabaseUrl(requiredDatabaseUrl)) {
    process.env.DATABASE_SSL = "require";
  }
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "forgeai-agent-kernel-"));
  const store = new AppStore(tmpRoot);
  await store.initialize();

  const suffix = randomUUID().slice(0, 8);
  const user = await store.createUser({
    email: `agent-kernel-${suffix}@example.com`,
    name: `Agent Kernel ${suffix}`,
    passwordHash: "hash"
  });

  const org = await store.createOrganization({
    name: `Kernel Org ${suffix}`,
    slug: `kernel-org-${suffix}`
  });

  await store.createMembership({
    orgId: org.id,
    userId: user.id,
    role: "owner"
  });

  const workspace = await store.createWorkspace({
    orgId: org.id,
    name: `Workspace ${suffix}`,
    description: "Kernel flow test workspace"
  });

  const project = await store.createProject({
    orgId: org.id,
    workspaceId: workspace.id,
    createdByUserId: user.id,
    name: `Project ${suffix}`,
    description: "Kernel flow test project",
    templateId: "agent-workflow"
  });

  return {
    tmpRoot,
    store,
    project,
    userId: user.id
  };
}

async function destroyHarness(harness: Harness): Promise<void> {
  await harness.store.close();
  await rm(harness.tmpRoot, { recursive: true, force: true });
}

test("fork -> validate -> resume flow", async () => {
  const previousLightValidation = process.env.AGENT_LIGHT_VALIDATION_MODE;
  const previousHeavyValidation = process.env.AGENT_HEAVY_VALIDATION_MODE;
  const previousHeavyInstall = process.env.AGENT_HEAVY_INSTALL_DEPS;

  process.env.AGENT_LIGHT_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_INSTALL_DEPS = "false";

  const harness = await createHarness();

  try {
    const kernel = new AgentKernel({
      store: harness.store,
      planner: new DeterministicPlanner()
    });

    const started = await kernel.startRun({
      project: harness.project,
      createdByUserId: harness.userId,
      goal: "Generate and verify fork flow",
      providerId: "mock",
      requestId: "kernel-flow-start"
    });

    assert.equal(started.run.status, "complete");
    const stepOne = started.steps.find((step) => step.stepId === "step-1");
    assert.ok(stepOne);
    assert.ok(stepOne?.commitHash);

    const forked = await kernel.forkRun({
      project: harness.project,
      runId: started.run.id,
      stepId: "step-1",
      createdByUserId: harness.userId,
      requestId: "kernel-flow-fork"
    });

    assert.equal(forked.run.currentStepIndex, 1);
    assert.equal(forked.run.status, "queued");

    const validation = await kernel.validateRunOutput({
      project: harness.project,
      runId: forked.run.id,
      requestId: "kernel-flow-validate"
    });

    assert.equal(validation.run.id, forked.run.id);
    assert.match(validation.targetPath, /\.forgeai\/worktrees\//);
    assert.ok(Array.isArray(validation.validation.checks));

    const resumed = await kernel.resumeRun({
      project: harness.project,
      runId: forked.run.id,
      requestId: "kernel-flow-resume"
    });

    assert.equal(resumed.run.status, "complete");
    assert.equal(resumed.run.currentStepIndex, resumed.run.plan.steps.length);
    const resumedStep = resumed.steps.find((step) => step.stepId === "step-2");
    assert.ok(resumedStep);
    assert.equal(resumedStep?.status, "completed");
  } finally {
    if (previousLightValidation === undefined) {
      delete process.env.AGENT_LIGHT_VALIDATION_MODE;
    } else {
      process.env.AGENT_LIGHT_VALIDATION_MODE = previousLightValidation;
    }

    if (previousHeavyValidation === undefined) {
      delete process.env.AGENT_HEAVY_VALIDATION_MODE;
    } else {
      process.env.AGENT_HEAVY_VALIDATION_MODE = previousHeavyValidation;
    }

    if (previousHeavyInstall === undefined) {
      delete process.env.AGENT_HEAVY_INSTALL_DEPS;
    } else {
      process.env.AGENT_HEAVY_INSTALL_DEPS = previousHeavyInstall;
    }

    await destroyHarness(harness);
  }
});

test("runtime correction step cannot silently no-op", async () => {
  const previousLightValidation = process.env.AGENT_LIGHT_VALIDATION_MODE;
  const previousHeavyValidation = process.env.AGENT_HEAVY_VALIDATION_MODE;
  const previousHeavyInstall = process.env.AGENT_HEAVY_INSTALL_DEPS;
  const previousGoalCorrections = process.env.AGENT_GOAL_MAX_CORRECTIONS;

  process.env.AGENT_LIGHT_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_INSTALL_DEPS = "false";
  process.env.AGENT_GOAL_MAX_CORRECTIONS = "1";

  const harness = await createHarness();

  try {
    const executor = new ScriptedExecutor((step) => {
      if (step.tool === "run_preview_container") {
        return buildExecution({
          step,
          status: "completed",
          output: {
            runtimeStatus: "failed",
            errorMessage: "runtime unhealthy",
            logs: "startup error"
          }
        });
      }

      if (step.id.startsWith("runtime-correction-")) {
        return buildExecution({
          step,
          status: "completed",
          output: {
            proposedChanges: []
          }
        });
      }

      return buildExecution({
        step,
        status: "completed",
        output: {}
      });
    });

    const kernel = new AgentKernel({
      store: harness.store,
      planner: new RuntimeCorrectionPlanner(),
      executor
    });

    const started = await kernel.startRun({
      project: harness.project,
      createdByUserId: harness.userId,
      goal: "Repair runtime startup",
      providerId: "mock",
      requestId: "kernel-runtime-correction-noop"
    });

    assert.equal(started.run.status, "failed");
    assert.match(started.run.errorMessage || "", /Correction step 'runtime-correction-1' produced no proposed changes/);
    const correctionStep = started.steps.find((entry) => entry.stepId === "runtime-correction-1");
    assert.ok(correctionStep);
    assert.equal(correctionStep?.status, "failed");
    assert.equal(correctionStep?.commitHash, null);
  } finally {
    if (previousLightValidation === undefined) {
      delete process.env.AGENT_LIGHT_VALIDATION_MODE;
    } else {
      process.env.AGENT_LIGHT_VALIDATION_MODE = previousLightValidation;
    }

    if (previousHeavyValidation === undefined) {
      delete process.env.AGENT_HEAVY_VALIDATION_MODE;
    } else {
      process.env.AGENT_HEAVY_VALIDATION_MODE = previousHeavyValidation;
    }

    if (previousHeavyInstall === undefined) {
      delete process.env.AGENT_HEAVY_INSTALL_DEPS;
    } else {
      process.env.AGENT_HEAVY_INSTALL_DEPS = previousHeavyInstall;
    }

    if (previousGoalCorrections === undefined) {
      delete process.env.AGENT_GOAL_MAX_CORRECTIONS;
    } else {
      process.env.AGENT_GOAL_MAX_CORRECTIONS = previousGoalCorrections;
    }

    await destroyHarness(harness);
  }
});

test("runtime correction loop stops at configured goal-phase limit", async () => {
  const previousLightValidation = process.env.AGENT_LIGHT_VALIDATION_MODE;
  const previousHeavyValidation = process.env.AGENT_HEAVY_VALIDATION_MODE;
  const previousHeavyInstall = process.env.AGENT_HEAVY_INSTALL_DEPS;
  const previousGoalCorrections = process.env.AGENT_GOAL_MAX_CORRECTIONS;

  process.env.AGENT_LIGHT_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_INSTALL_DEPS = "false";
  process.env.AGENT_GOAL_MAX_CORRECTIONS = "2";

  const harness = await createHarness();

  try {
    const executor = new ScriptedExecutor((step) => {
      if (step.id.startsWith("runtime-correction-")) {
        const suffix = step.id.replace("runtime-correction-", "") || "0";
        return buildExecution({
          step,
          status: "completed",
          output: {
            proposedChanges: [
              {
                path: `src/runtime-correction-${suffix}.txt`,
                type: "create",
                newContent: `runtime correction ${suffix}\n`
              }
            ]
          }
        });
      }

      if (step.tool === "run_preview_container") {
        return buildExecution({
          step,
          status: "completed",
          output: {
            runtimeStatus: "failed",
            errorMessage: "runtime unhealthy",
            logs: "startup error"
          }
        });
      }

      return buildExecution({
        step,
        status: "completed",
        output: {}
      });
    });

    const kernel = new AgentKernel({
      store: harness.store,
      planner: new RuntimeCorrectionPlanner(),
      executor
    });

    const started = await kernel.startRun({
      project: harness.project,
      createdByUserId: harness.userId,
      goal: "Repair runtime startup",
      providerId: "mock",
      requestId: "kernel-runtime-correction-limit"
    });

    assert.equal(started.run.status, "failed");
    assert.equal(started.run.errorMessage, "Runtime correction limit reached (2/2).");
    const correctionSteps = started.steps.filter((entry) => entry.stepId.startsWith("runtime-correction-"));
    assert.equal(correctionSteps.length, 2);
    for (const step of correctionSteps) {
      assert.equal(step.status, "completed");
      assert.ok(step.commitHash);
    }
  } finally {
    if (previousLightValidation === undefined) {
      delete process.env.AGENT_LIGHT_VALIDATION_MODE;
    } else {
      process.env.AGENT_LIGHT_VALIDATION_MODE = previousLightValidation;
    }

    if (previousHeavyValidation === undefined) {
      delete process.env.AGENT_HEAVY_VALIDATION_MODE;
    } else {
      process.env.AGENT_HEAVY_VALIDATION_MODE = previousHeavyValidation;
    }

    if (previousHeavyInstall === undefined) {
      delete process.env.AGENT_HEAVY_INSTALL_DEPS;
    } else {
      process.env.AGENT_HEAVY_INSTALL_DEPS = previousHeavyInstall;
    }

    if (previousGoalCorrections === undefined) {
      delete process.env.AGENT_GOAL_MAX_CORRECTIONS;
    } else {
      process.env.AGENT_GOAL_MAX_CORRECTIONS = previousGoalCorrections;
    }

    await destroyHarness(harness);
  }
});

test("heavy validation correction loop stops at configured optimization-phase limit", async () => {
  const previousLightValidation = process.env.AGENT_LIGHT_VALIDATION_MODE;
  const previousHeavyValidation = process.env.AGENT_HEAVY_VALIDATION_MODE;
  const previousHeavyInstall = process.env.AGENT_HEAVY_INSTALL_DEPS;
  const previousOptimizationCorrections = process.env.AGENT_OPTIMIZATION_MAX_CORRECTIONS;

  process.env.AGENT_LIGHT_VALIDATION_MODE = "off";
  process.env.AGENT_HEAVY_VALIDATION_MODE = "enforce";
  process.env.AGENT_HEAVY_INSTALL_DEPS = "false";
  process.env.AGENT_OPTIMIZATION_MAX_CORRECTIONS = "3";

  const harness = await createHarness();

  try {
    const kernel = new AgentKernel({
      store: harness.store,
      planner: new HeavyValidationCorrectionPlanner()
    });

    const started = await kernel.startRun({
      project: harness.project,
      createdByUserId: harness.userId,
      goal: "Exercise heavy validation correction loop",
      providerId: "mock",
      requestId: "kernel-heavy-correction-limit"
    });

    assert.equal(started.run.status, "failed");
    assert.equal(started.run.errorMessage, "Heavy validation failed after 3/3 correction attempts.");

    const correctionSteps = started.steps.filter((entry) => entry.stepId.startsWith("validation-correction-"));
    assert.equal(correctionSteps.length, 3);
    assert.ok(correctionSteps.every((entry) => Boolean(entry.commitHash)));
    assert.equal(correctionSteps[2]?.status, "failed");
  } finally {
    if (previousLightValidation === undefined) {
      delete process.env.AGENT_LIGHT_VALIDATION_MODE;
    } else {
      process.env.AGENT_LIGHT_VALIDATION_MODE = previousLightValidation;
    }

    if (previousHeavyValidation === undefined) {
      delete process.env.AGENT_HEAVY_VALIDATION_MODE;
    } else {
      process.env.AGENT_HEAVY_VALIDATION_MODE = previousHeavyValidation;
    }

    if (previousHeavyInstall === undefined) {
      delete process.env.AGENT_HEAVY_INSTALL_DEPS;
    } else {
      process.env.AGENT_HEAVY_INSTALL_DEPS = previousHeavyInstall;
    }

    if (previousOptimizationCorrections === undefined) {
      delete process.env.AGENT_OPTIMIZATION_MAX_CORRECTIONS;
    } else {
      process.env.AGENT_OPTIMIZATION_MAX_CORRECTIONS = previousOptimizationCorrections;
    }

    await destroyHarness(harness);
  }
});
