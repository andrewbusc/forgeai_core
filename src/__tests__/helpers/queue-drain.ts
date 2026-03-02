import { AgentKernel } from "../../agent/kernel.js";
import type { AgentRunJob, AgentRunDetail } from "../../agent/types.js";
import { AppStore } from "../../lib/project-store.js";

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

export async function drainComputeQueue(input: {
  store: AppStore;
  kernel: AgentKernel;
  nodeId: string;
  maxJobs?: number;
  leaseSeconds?: number;
  runIds?: string[];
}): Promise<{ processedJobs: AgentRunJob[]; lastDetail: AgentRunDetail | null }> {
  const maxJobs = Math.max(1, Math.floor(Number(input.maxJobs) || 50));
  const leaseSeconds = Math.max(15, Math.floor(Number(input.leaseSeconds) || 60));
  const targetRunIds =
    Array.isArray(input.runIds) && input.runIds.length > 0
      ? new Set(input.runIds.map((value) => String(value)).filter(Boolean))
      : null;
  const processedJobs: AgentRunJob[] = [];
  let lastDetail: AgentRunDetail | null = null;

  await input.store.upsertWorkerNodeHeartbeat({
    nodeId: input.nodeId,
    role: "compute",
    status: "online",
    capabilities: {}
  });

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await input.store.claimNextRunJob({
      nodeId: input.nodeId,
      targetRole: "compute",
      workerCapabilities: {},
      leaseSeconds,
      runIds: targetRunIds ? Array.from(targetRunIds) : undefined
    });

    if (!job) {
      return {
        processedJobs,
        lastDetail
      };
    }

    const runningJob = await input.store.markRunJobRunning(job.id, input.nodeId, leaseSeconds);
    if (!runningJob) {
      continue;
    }

    await input.store.renewRunJobLease(job.id, input.nodeId, leaseSeconds);

    try {
      const run = await input.store.getAgentRun(job.runId);
      if (!run) {
        throw new Error(`Run not found: ${job.runId}`);
      }

      const project = await input.store.getProject(run.projectId);
      if (!project) {
        throw new Error(`Project not found for run: ${job.runId}`);
      }

      lastDetail = await input.kernel.executeRunJob({
        job,
        project,
        requestId: `test-worker:${input.nodeId}:${job.id}`
      });
      await input.store.completeRunJob(job.id, input.nodeId);
      processedJobs.push(job);
      if (targetRunIds) {
        targetRunIds.delete(job.runId);
        if (targetRunIds.size === 0) {
          return {
            processedJobs,
            lastDetail
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markRunFailedIfNeeded(input.store, job.runId, message).catch(() => undefined);
      await input.store.failRunJob(job.id, input.nodeId).catch(() => undefined);
      throw error;
    }
  }

  throw new Error(`drainComputeQueue exceeded maxJobs=${String(maxJobs)}`);
}
