import { logError, logInfo } from "../lib/logging.js";
import { isActiveAgentRunStatus } from "./run-status.js";
const allowedTransitions = {
    queued: ["running", "cancelled", "failed"],
    running: ["correcting", "optimizing", "validating", "failed", "complete", "cancelled"],
    correcting: ["running", "validating", "failed", "cancelled"],
    optimizing: ["running", "validating", "failed", "complete", "cancelled"],
    validating: ["running", "optimizing", "failed", "complete", "cancelled"],
    cancelled: [],
    failed: [],
    complete: []
};
function normalizeLimit(value, fallback, min, max) {
    const candidate = Number(value);
    if (!Number.isFinite(candidate)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(candidate)));
}
function normalizeGoalStepsTarget(maxSteps) {
    const configured = Number(process.env.AGENT_FAKE_GOAL_STEPS || 5);
    const fallback = Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 5;
    return Math.min(maxSteps, fallback);
}
export class AgentRunService {
    store;
    constructor(store) {
        this.store = store;
    }
    assertTransition(currentStatus, nextStatus) {
        if (!allowedTransitions[currentStatus].includes(nextStatus)) {
            throw new Error(`Invalid transition: ${currentStatus} -> ${nextStatus}`);
        }
    }
    validateRunInvariants(run) {
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
    async transitionRunStatus(context, nextStatus, fields = {}) {
        const result = await this.store.withTransaction(async (client) => {
            const run = await this.store.lockLifecycleRunForUpdate(context.runId, client);
            if (!run || run.projectId !== context.projectId) {
                throw new Error("Agent run not found.");
            }
            this.assertTransition(run.status, nextStatus);
            const updated = (await this.store.updateLifecycleRun(run.id, {
                status: nextStatus,
                errorMessage: fields.errorMessage === undefined ? run.errorMessage : fields.errorMessage
            }, client)) || run;
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
    async createRun(input) {
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
    async markRunRunning(projectId, runId, requestId) {
        return this.transitionRunStatus({
            projectId,
            runId,
            requestId
        }, "running", {
            logEvent: "RUN_STARTED"
        });
    }
    async markRunCorrecting(projectId, runId, requestId) {
        return this.transitionRunStatus({
            projectId,
            runId,
            requestId
        }, "correcting", {
            logEvent: "RUN_CORRECTING"
        });
    }
    async markRunOptimizing(projectId, runId, requestId) {
        return this.transitionRunStatus({
            projectId,
            runId,
            requestId
        }, "optimizing", {
            logEvent: "RUN_OPTIMIZING"
        });
    }
    async markRunValidating(projectId, runId, requestId) {
        return this.transitionRunStatus({
            projectId,
            runId,
            requestId
        }, "validating", {
            logEvent: "RUN_VALIDATING"
        });
    }
    // Backward-compatible alias: cancellation is immediate in the unified state machine.
    async markRunCancelling(projectId, runId, requestId) {
        return this.markRunCancelled(projectId, runId, requestId);
    }
    async markRunCancelled(projectId, runId, requestId) {
        return this.transitionRunStatus({
            projectId,
            runId,
            requestId
        }, "cancelled", {
            logEvent: "RUN_CANCELLED"
        });
    }
    async markRunFailed(projectId, runId, requestId, reason) {
        return this.transitionRunStatus({
            projectId,
            runId,
            requestId
        }, "failed", {
            logEvent: "RUN_FAILED",
            errorMessage: reason,
            extra: { reason }
        });
    }
    async markRunComplete(projectId, runId, requestId) {
        return this.transitionRunStatus({
            projectId,
            runId,
            requestId
        }, "complete", {
            logEvent: "RUN_COMPLETED",
            errorMessage: null
        });
    }
    async incrementStepIndex(runId) {
        const run = await this.store.getLifecycleRun(runId);
        if (!run) {
            throw new Error("Agent run not found.");
        }
        return (await this.store.updateLifecycleRun(runId, { stepIndex: run.stepIndex + 1 })) || run;
    }
    async enterOptimizationPhase(runId) {
        const run = await this.store.getLifecycleRun(runId);
        if (!run) {
            throw new Error("Agent run not found.");
        }
        return (await this.store.updateLifecycleRun(runId, { phase: "optimization" })) || run;
    }
    async incrementCorrectionCount(runId) {
        const run = await this.store.getLifecycleRun(runId);
        if (!run) {
            throw new Error("Agent run not found.");
        }
        return (await this.store.updateLifecycleRun(runId, { correctionsUsed: run.correctionsUsed + 1 })) || run;
    }
    async incrementOptimizationCount(runId) {
        const run = await this.store.getLifecycleRun(runId);
        if (!run) {
            throw new Error("Agent run not found.");
        }
        return ((await this.store.updateLifecycleRun(runId, { optimizationStepsUsed: run.optimizationStepsUsed + 1 })) || run);
    }
    async resumeRun(projectId, runId, requestId) {
        const result = await this.store.withTransaction(async (client) => {
            const run = await this.store.lockLifecycleRunForUpdate(runId, client);
            if (!run || run.projectId !== projectId) {
                throw new Error("Agent run not found.");
            }
            if (run.status !== "cancelled" && run.status !== "failed") {
                throw new Error("Run can only be resumed from cancelled or failed.");
            }
            const resumed = (await this.store.updateLifecycleRun(run.id, {
                status: "queued",
                errorMessage: null
            }, client)) || run;
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
    goalConditionsSatisfied(run) {
        if (run.phase !== "goal") {
            return false;
        }
        const target = normalizeGoalStepsTarget(run.maxSteps);
        return run.stepIndex >= target;
    }
    async executeNextStep(input) {
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
                if (run.status === "queued") {
                    this.assertTransition(run.status, "running");
                    run = (await this.store.updateLifecycleRun(run.id, { status: "running" }, client)) || run;
                    logInfo("RUN_STARTED", {
                        requestId: input.requestId,
                        runId: run.id,
                        projectId: run.projectId
                    });
                }
                if (run.status === "cancelled") {
                    return {
                        outcome: "skipped",
                        run,
                        shouldReenqueue: false,
                        reason: "Run is cancelled."
                    };
                }
                const runnable = run.status === "running" || run.status === "correcting" || run.status === "optimizing";
                if (!runnable) {
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
                        shouldReenqueue: isActiveAgentRunStatus(run.status),
                        reason: `Stale worker payload. Expected step ${input.expectedStepIndex}, found ${run.stepIndex}.`
                    };
                }
                const invariant = this.validateRunInvariants(run);
                if (!invariant.ok) {
                    if (invariant.nextStatus === "complete") {
                        this.assertTransition(run.status, "complete");
                        run =
                            (await this.store.updateLifecycleRun(run.id, {
                                status: "complete",
                                errorMessage: null
                            }, client)) || run;
                        logInfo("RUN_COMPLETED", {
                            requestId: input.requestId,
                            runId: run.id,
                            projectId: run.projectId,
                            reason: invariant.reason || "Invariant complete."
                        });
                    }
                    else {
                        this.assertTransition(run.status, "failed");
                        run =
                            (await this.store.updateLifecycleRun(run.id, {
                                status: "failed",
                                errorMessage: invariant.reason || "Invariant failure."
                            }, client)) || run;
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
                const stepType = run.phase === "optimization" ? "optimization" : "goal";
                const stepSummary = `Fake ${stepType} step ${run.stepIndex + 1}`;
                let step = await this.store.createLifecycleStep({
                    runId: run.id,
                    projectId: run.projectId,
                    stepIndex: run.stepIndex,
                    type: stepType,
                    status: "running",
                    summary: stepSummary
                }, client);
                logInfo("STEP_STARTED", {
                    requestId: input.requestId,
                    runId: run.id,
                    projectId: run.projectId,
                    stepId: step.id,
                    stepIndex: step.stepIndex,
                    stepType: step.type
                });
                step =
                    (await this.store.updateLifecycleStep(step.id, {
                        status: "complete",
                        summary: `${stepSummary} complete`,
                        completedAt: new Date().toISOString()
                    }, client)) || step;
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
                        (await this.store.updateLifecycleRun(run.id, { optimizationStepsUsed: run.optimizationStepsUsed + 1 }, client)) || run;
                }
                if (run.phase === "goal" && this.goalConditionsSatisfied(run)) {
                    const nextPhase = "optimization";
                    run = (await this.store.updateLifecycleRun(run.id, { phase: nextPhase, status: "optimizing" }, client)) || run;
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
                        (await this.store.updateLifecycleRun(run.id, {
                            status: "complete",
                            errorMessage: null
                        }, client)) || run;
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
                    shouldReenqueue: isActiveAgentRunStatus(run.status)
                };
            });
        }
        catch (error) {
            logError("RUN_EXECUTE_ERROR", {
                requestId: input.requestId,
                runId: input.runId,
                projectId: input.projectId,
                message: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async getRunWithSteps(projectId, runId) {
        const run = await this.store.getLifecycleRunById(projectId, runId);
        if (!run) {
            return undefined;
        }
        const steps = await this.store.listLifecycleStepsByRun(run.id);
        return { run, steps };
    }
    async listRuns(projectId) {
        return this.store.listLifecycleRunsByProject(projectId);
    }
}
