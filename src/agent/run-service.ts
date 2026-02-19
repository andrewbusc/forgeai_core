import { logError, logInfo } from "../lib/logging.js";
import { AppStore } from "../lib/project-store.js";
import { Project } from "../types.js";
import {
  AgentLifecycleRun,
  AgentLifecycleStep,
  AgentRunLifecycleStatus,
  AgentRunPhase,
  AgentRunStepType
} from "./run-state-types.js";

const allowedTransitions: Record<AgentRunLifecycleStatus, AgentRunLifecycleStatus[]> = {
  queued: ["running"],
  running: ["cancelling", "failed", "complete"],
  cancelling: ["cancelled"],
  cancelled: [],
  failed: [],
  complete: []
};

interface TransitionContext {
  runId: string;
  projectId: string;
  requestId: string;
}

interface InvariantResult {
  ok: boolean;
  reason?: string;
  nextStatus?: "failed" | "complete";
}

export interface CreateStateRunInput {
  project: Project;
  createdByUserId: string;
  goal: string;
  maxSteps?: number;
  maxCorrections?: number;
  maxOptimizations?: number;
  requestId: string;
}

export interface ExecuteStepInput {
  projectId: string;
  runId: string;
  requestId: string;
  expectedStepIndex?: number;
}

export interface ExecuteStepOutput {
  outcome: "processed" | "skipped" | "missing";
  run?: AgentLifecycleRun;
  step?: AgentLifecycleStep;
  shouldReenqueue: boolean;
  reason?: string;
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(candidate)));
}

function normalizeGoalStepsTarget(maxSteps: number): number {
  const configured = Number(process.env.AGENT_FAKE_GOAL_STEPS || 5);
  const fallback = Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 5;
  return Math.min(maxSteps, fallback);
}

export class AgentRunService {
  constructor(private readonly store: AppStore) {}

  private assertTransition(currentStatus: AgentRunLifecycleStatus, nextStatus: AgentRunLifecycleStatus): void {
    if (!allowedTransitions[currentStatus].includes(nextStatus)) {
      throw new Error(`Invalid transition: ${currentStatus} -> ${nextStatus}`);
    }
  }

  private validateRunInvariants(run: AgentLifecycleRun): InvariantResult {
    if (run.stepIndex >= run.maxSteps) {
      return {
        ok: false,
        nextStatus: "failed",
        reason: `step_index limit reached (${run.stepIndex}/${run.maxSteps}).`
      };
    }

    if (run.correctionsUsed >= run.maxCorrections) {
      return {
        ok: false,
        nextStatus: "failed",
        reason: `corrections limit reached (${run.correctionsUsed}/${run.maxCorrections}).`
      };
    }

    if (run.phase === "optimization" && run.optimizationStepsUsed >= run.maxOptimizations) {
      return {
        ok: false,
        nextStatus: "complete",
        reason: `optimization limit reached (${run.optimizationStepsUsed}/${run.maxOptimizations}).`
      };
    }

    if (run.phase !== "goal" && run.phase !== "optimization") {
      return {
        ok: false,
        nextStatus: "failed",
        reason: `invalid run phase '${run.phase}'.`
      };
    }

    return { ok: true };
  }

  private async transitionRunStatus(
    context: TransitionContext,
    nextStatus: AgentRunLifecycleStatus,
    fields: {
      errorMessage?: string | null;
      logEvent?: string;
      extra?: Record<string, unknown>;
    } = {}
  ): Promise<AgentLifecycleRun> {
    const result = await this.store.withTransaction(async (client) => {
      const run = await this.store.lockLifecycleRunForUpdate(context.runId, client);

      if (!run || run.projectId !== context.projectId) {
        throw new Error("Agent run not found.");
      }

      this.assertTransition(run.status, nextStatus);

      const updated =
        (await this.store.updateLifecycleRun(
          run.id,
          {
            status: nextStatus,
            errorMessage: fields.errorMessage === undefined ? run.errorMessage : fields.errorMessage
          },
          client
        )) || run;

      return updated;
    });

    const eventName = fields.logEvent || "RUN_TRANSITION";
    logInfo(eventName, {
      requestId: context.requestId,
      runId: context.runId,
      projectId: context.projectId,
      status: result.status,
      ...(fields.extra || {})
    });

    return result;
  }

  async createRun(input: CreateStateRunInput): Promise<AgentLifecycleRun> {
    const maxSteps = normalizeLimit(input.maxSteps, 20, 1, 1_000);
    const maxCorrections = normalizeLimit(input.maxCorrections, 2, 0, 100);
    const maxOptimizations = normalizeLimit(input.maxOptimizations, 2, 0, 100);

    const run = await this.store.createLifecycleRun({
      projectId: input.project.id,
      orgId: input.project.orgId,
      workspaceId: input.project.workspaceId,
      createdByUserId: input.createdByUserId,
      goal: input.goal,
      phase: "goal",
      status: "queued",
      stepIndex: 0,
      correctionsUsed: 0,
      optimizationStepsUsed: 0,
      maxSteps,
      maxCorrections,
      maxOptimizations,
      errorMessage: null
    });

    logInfo("RUN_CREATED", {
      requestId: input.requestId,
      runId: run.id,
      projectId: run.projectId,
      phase: run.phase,
      status: run.status,
      maxSteps: run.maxSteps,
      maxCorrections: run.maxCorrections,
      maxOptimizations: run.maxOptimizations
    });

    return run;
  }

  async markRunRunning(projectId: string, runId: string, requestId: string): Promise<AgentLifecycleRun> {
    return this.transitionRunStatus(
      {
        projectId,
        runId,
        requestId
      },
      "running",
      {
        logEvent: "RUN_STARTED"
      }
    );
  }

  async markRunCancelling(projectId: string, runId: string, requestId: string): Promise<AgentLifecycleRun> {
    return this.transitionRunStatus(
      {
        projectId,
        runId,
        requestId
      },
      "cancelling",
      {
        logEvent: "RUN_CANCELLING"
      }
    );
  }

  async markRunCancelled(projectId: string, runId: string, requestId: string): Promise<AgentLifecycleRun> {
    return this.transitionRunStatus(
      {
        projectId,
        runId,
        requestId
      },
      "cancelled",
      {
        logEvent: "RUN_CANCELLED"
      }
    );
  }

  async markRunFailed(projectId: string, runId: string, requestId: string, reason: string): Promise<AgentLifecycleRun> {
    return this.transitionRunStatus(
      {
        projectId,
        runId,
        requestId
      },
      "failed",
      {
        logEvent: "RUN_FAILED",
        errorMessage: reason,
        extra: { reason }
      }
    );
  }

  async markRunComplete(projectId: string, runId: string, requestId: string): Promise<AgentLifecycleRun> {
    return this.transitionRunStatus(
      {
        projectId,
        runId,
        requestId
      },
      "complete",
      {
        logEvent: "RUN_COMPLETED",
        errorMessage: null
      }
    );
  }

  async incrementStepIndex(runId: string): Promise<AgentLifecycleRun> {
    const run = await this.store.getLifecycleRun(runId);
    if (!run) {
      throw new Error("Agent run not found.");
    }

    return (await this.store.updateLifecycleRun(runId, { stepIndex: run.stepIndex + 1 })) || run;
  }

  async enterOptimizationPhase(runId: string): Promise<AgentLifecycleRun> {
    const run = await this.store.getLifecycleRun(runId);
    if (!run) {
      throw new Error("Agent run not found.");
    }

    return (await this.store.updateLifecycleRun(runId, { phase: "optimization" })) || run;
  }

  async incrementCorrectionCount(runId: string): Promise<AgentLifecycleRun> {
    const run = await this.store.getLifecycleRun(runId);
    if (!run) {
      throw new Error("Agent run not found.");
    }

    return (await this.store.updateLifecycleRun(runId, { correctionsUsed: run.correctionsUsed + 1 })) || run;
  }

  async incrementOptimizationCount(runId: string): Promise<AgentLifecycleRun> {
    const run = await this.store.getLifecycleRun(runId);
    if (!run) {
      throw new Error("Agent run not found.");
    }

    return (
      (await this.store.updateLifecycleRun(runId, { optimizationStepsUsed: run.optimizationStepsUsed + 1 })) || run
    );
  }

  async resumeRun(projectId: string, runId: string, requestId: string): Promise<AgentLifecycleRun> {
    const result = await this.store.withTransaction(async (client) => {
      const run = await this.store.lockLifecycleRunForUpdate(runId, client);

      if (!run || run.projectId !== projectId) {
        throw new Error("Agent run not found.");
      }

      if (run.status !== "cancelled" && run.status !== "failed") {
        throw new Error("Run can only be resumed from cancelled or failed.");
      }

      const resumed =
        (await this.store.updateLifecycleRun(
          run.id,
          {
            status: "queued",
            errorMessage: null
          },
          client
        )) || run;

      return resumed;
    });

    logInfo("RUN_RESUMED", {
      requestId,
      runId,
      projectId,
      status: result.status,
      stepIndex: result.stepIndex
    });

    return result;
  }

  private goalConditionsSatisfied(run: AgentLifecycleRun): boolean {
    if (run.phase !== "goal") {
      return false;
    }

    const target = normalizeGoalStepsTarget(run.maxSteps);
    return run.stepIndex >= target;
  }

  async executeNextStep(input: ExecuteStepInput): Promise<ExecuteStepOutput> {
    try {
      return await this.store.withTransaction(async (client) => {
        let run = await this.store.lockLifecycleRunForUpdate(input.runId, client);

        if (!run || run.projectId !== input.projectId) {
          return {
            outcome: "missing",
            shouldReenqueue: false,
            reason: "Run not found."
          };
        }

        if (run.status === "cancelling") {
          this.assertTransition(run.status, "cancelled");
          run = (await this.store.updateLifecycleRun(run.id, { status: "cancelled" }, client)) || run;

          logInfo("RUN_CANCELLED", {
            requestId: input.requestId,
            runId: run.id,
            projectId: run.projectId
          });

          return {
            outcome: "skipped",
            run,
            shouldReenqueue: false,
            reason: "Run was cancelling and is now cancelled."
          };
        }

        if (run.status === "queued") {
          this.assertTransition(run.status, "running");
          run = (await this.store.updateLifecycleRun(run.id, { status: "running" }, client)) || run;

          logInfo("RUN_STARTED", {
            requestId: input.requestId,
            runId: run.id,
            projectId: run.projectId
          });
        }

        if (run.status !== "running") {
          return {
            outcome: "skipped",
            run,
            shouldReenqueue: false,
            reason: `Run not runnable from status '${run.status}'.`
          };
        }

        if (typeof input.expectedStepIndex === "number" && run.stepIndex !== input.expectedStepIndex) {
          return {
            outcome: "skipped",
            run,
            shouldReenqueue: run.status === "running",
            reason: `Stale worker payload. Expected step ${input.expectedStepIndex}, found ${run.stepIndex}.`
          };
        }

        const invariant = this.validateRunInvariants(run);
        if (!invariant.ok) {
          if (invariant.nextStatus === "complete") {
            this.assertTransition(run.status, "complete");
            run =
              (await this.store.updateLifecycleRun(
                run.id,
                {
                  status: "complete",
                  errorMessage: null
                },
                client
              )) || run;

            logInfo("RUN_COMPLETED", {
              requestId: input.requestId,
              runId: run.id,
              projectId: run.projectId,
              reason: invariant.reason || "Invariant complete."
            });
          } else {
            this.assertTransition(run.status, "failed");
            run =
              (await this.store.updateLifecycleRun(
                run.id,
                {
                  status: "failed",
                  errorMessage: invariant.reason || "Invariant failure."
                },
                client
              )) || run;

            logInfo("RUN_FAILED", {
              requestId: input.requestId,
              runId: run.id,
              projectId: run.projectId,
              reason: invariant.reason || "Invariant failure."
            });
          }

          return {
            outcome: "skipped",
            run,
            shouldReenqueue: false,
            reason: invariant.reason
          };
        }

        const stepType: AgentRunStepType = run.phase === "optimization" ? "optimization" : "goal";
        const stepSummary = `Fake ${stepType} step ${run.stepIndex + 1}`;

        let step = await this.store.createLifecycleStep(
          {
            runId: run.id,
            projectId: run.projectId,
            stepIndex: run.stepIndex,
            type: stepType,
            status: "running",
            summary: stepSummary
          },
          client
        );

        logInfo("STEP_STARTED", {
          requestId: input.requestId,
          runId: run.id,
          projectId: run.projectId,
          stepId: step.id,
          stepIndex: step.stepIndex,
          stepType: step.type
        });

        step =
          (await this.store.updateLifecycleStep(
            step.id,
            {
              status: "complete",
              summary: `${stepSummary} complete`,
              completedAt: new Date().toISOString()
            },
            client
          )) || step;

        logInfo("STEP_COMPLETED", {
          requestId: input.requestId,
          runId: run.id,
          projectId: run.projectId,
          stepId: step.id,
          stepIndex: step.stepIndex,
          stepType: step.type
        });

        run = (await this.store.updateLifecycleRun(run.id, { stepIndex: run.stepIndex + 1 }, client)) || run;

        if (stepType === "optimization") {
          run =
            (await this.store.updateLifecycleRun(
              run.id,
              { optimizationStepsUsed: run.optimizationStepsUsed + 1 },
              client
            )) || run;
        }

        if (run.phase === "goal" && this.goalConditionsSatisfied(run)) {
          const nextPhase: AgentRunPhase = "optimization";
          run = (await this.store.updateLifecycleRun(run.id, { phase: nextPhase }, client)) || run;

          logInfo("RUN_PHASE_SWITCH", {
            requestId: input.requestId,
            runId: run.id,
            projectId: run.projectId,
            phase: run.phase
          });
        }

        if (run.phase === "optimization" && run.optimizationStepsUsed >= run.maxOptimizations) {
          this.assertTransition(run.status, "complete");
          run =
            (await this.store.updateLifecycleRun(
              run.id,
              {
                status: "complete",
                errorMessage: null
              },
              client
            )) || run;

          logInfo("RUN_COMPLETED", {
            requestId: input.requestId,
            runId: run.id,
            projectId: run.projectId,
            reason: "Optimization steps exhausted."
          });
        }

        return {
          outcome: "processed",
          run,
          step,
          shouldReenqueue: run.status === "running"
        };
      });
    } catch (error) {
      logError("RUN_EXECUTE_ERROR", {
        requestId: input.requestId,
        runId: input.runId,
        projectId: input.projectId,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getRunWithSteps(projectId: string, runId: string): Promise<{ run: AgentLifecycleRun; steps: AgentLifecycleStep[] } | undefined> {
    const run = await this.store.getLifecycleRunById(projectId, runId);
    if (!run) {
      return undefined;
    }

    const steps = await this.store.listLifecycleStepsByRun(run.id);
    return { run, steps };
  }

  async listRuns(projectId: string): Promise<AgentLifecycleRun[]> {
    return this.store.listLifecycleRunsByProject(projectId);
  }
}

