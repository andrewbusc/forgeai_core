import { AgentKernel } from "../kernel.js";
import type { AgentRunDetail } from "../types.js";
import { AppStore } from "../../lib/project-store.js";
import type { Project } from "../../types.js";

export type RunWaitMode = "local" | "remote";

export class RunWaitTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly detail: AgentRunDetail | undefined;

  constructor(message: string, timeoutMs: number, detail?: AgentRunDetail) {
    super(message);
    this.name = "RunWaitTimeoutError";
    this.timeoutMs = timeoutMs;
    this.detail = detail;
  }
}

function isTerminal(status: string): boolean {
  return status === "complete" || status === "failed" || status === "cancelled";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function markRunFailedIfNeeded(store: AppStore, runId: string, message: string): Promise<void> {
  const run = await store.getAgentRun(runId);
  if (!run) {
    return;
  }

  if (run.status === "complete" || run.status === "failed" || run.status === "cancelled") {
    return;
  }

  await store.updateAgentRun(run.id, {
    status: "failed",
    errorMessage: message,
    finishedAt: new Date().toISOString()
  });
}

export async function waitForRunTerminal(input: {
  kernel: AgentKernel;
  store: AppStore;
  projectId: string;
  runId: string;
  project: Project;
  requestId: string;
  mode: RunWaitMode;
  nodeId?: string;
  leaseSeconds?: number;
  pollMs?: number;
  timeoutMs?: number;
  onUpdate?: (detail: AgentRunDetail) => void;
}): Promise<AgentRunDetail> {
  const nodeId = input.nodeId || `cli-compute:${process.pid}`;
  const leaseSeconds = Math.max(15, Math.floor(Number(input.leaseSeconds) || 60));
  const renewMs = Math.max(5_000, Math.floor((leaseSeconds * 1_000) / 3));
  const pollMs = Math.max(100, Math.floor(Number(input.pollMs) || 250));
  const deadline = typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? Date.now() + input.timeoutMs : null;
  let lastSignature = "";
  let backoff = pollMs;

  if (input.mode === "local") {
    await input.store.upsertWorkerNodeHeartbeat({
      nodeId,
      role: "compute",
      status: "online",
      capabilities: {}
    });
  }

  try {
    for (;;) {
      const detail = await input.kernel.getRunWithSteps(input.projectId, input.runId);
      if (!detail) {
        throw new Error(`Run not found: ${input.runId}`);
      }

      const signature = `${detail.run.status}:${detail.run.currentStepIndex}:${detail.run.lastStepId || ""}:${detail.steps.length}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        input.onUpdate?.(detail);
      }

      if (isTerminal(detail.run.status)) {
        return detail;
      }

      if (deadline !== null && Date.now() > deadline) {
        throw new RunWaitTimeoutError(
          `run --wait timed out after ${String(input.timeoutMs)}ms (status=${detail.run.status})`,
          input.timeoutMs || 0,
          detail
        );
      }

      if (input.mode === "local") {
        const job = await input.store.claimNextRunJob({
          nodeId,
          targetRole: "compute",
          workerCapabilities: {},
          leaseSeconds,
          runId: input.runId
        });

        if (job) {
          const runningJob = await input.store.markRunJobRunning(job.id, nodeId, leaseSeconds);
          if (!runningJob) {
            continue;
          }

          const renewTimer = setInterval(() => {
            void input.store.renewRunJobLease(job.id, nodeId, leaseSeconds).catch(() => undefined);
          }, renewMs);

          try {
            await input.kernel.executeRunJob({
              job,
              project: input.project,
              requestId: `${input.requestId}:wait:${job.id}`
            });
            await input.store.completeRunJob(job.id, nodeId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await markRunFailedIfNeeded(input.store, job.runId, message).catch(() => undefined);
            await input.store.failRunJob(job.id, nodeId).catch(() => undefined);
            throw error;
          } finally {
            clearInterval(renewTimer);
          }

          backoff = pollMs;
          continue;
        }
      }

      await sleep(backoff);
      backoff = Math.min(Math.floor(backoff * 1.4), 2_000);
    }
  } finally {
    if (input.mode === "local") {
      await input.store.markWorkerNodeOffline(nodeId).catch(() => undefined);
    }
  }
}
