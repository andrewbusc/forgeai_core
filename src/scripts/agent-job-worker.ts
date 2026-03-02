import "dotenv/config";
import { AgentKernel } from "../agent/kernel.js";
import { readBasEnv } from "../agent/bas-env.js";
import type { WorkerNodeRole } from "../agent/types.js";
import { AppStore } from "../lib/project-store.js";
import { logError, logInfo, logWarn, serializeError } from "../lib/logging.js";
import { ProviderRegistry } from "../lib/providers.js";

function parsePositiveInt(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseWorkerRole(value: string | undefined): WorkerNodeRole {
  const raw = String(value || "compute").trim().toLowerCase();
  if (raw === "compute" || raw === "eval") {
    return raw;
  }

  throw new Error(`NODE_ROLE must be 'compute' or 'eval'; received '${raw}'.`);
}

function parseCapabilities(value: string | undefined): Record<string, unknown> {
  if (!value || !value.trim()) {
    return {};
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WORKER_CAPABILITIES must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const nodeId = String(readBasEnv({ key: "NODE_ID", file: "src/scripts/agent-job-worker.ts" }) || "").trim();
if (!nodeId) {
  throw new Error("NODE_ID is required for agent-job-worker.");
}

const nodeRole = parseWorkerRole(readBasEnv({ key: "NODE_ROLE", file: "src/scripts/agent-job-worker.ts" }));
const workerCapabilities = parseCapabilities(
  readBasEnv({ key: "WORKER_CAPABILITIES", file: "src/scripts/agent-job-worker.ts" })
);
const heartbeatMs = parsePositiveInt(
  readBasEnv({ key: "WORKER_HEARTBEAT_MS", file: "src/scripts/agent-job-worker.ts" }),
  10_000,
  1_000
);
const pollMs = parsePositiveInt(
  readBasEnv({ key: "WORKER_POLL_MS", file: "src/scripts/agent-job-worker.ts" }),
  1_000,
  100
);
const leaseSeconds = parsePositiveInt(
  readBasEnv({ key: "WORKER_JOB_LEASE_SECONDS", file: "src/scripts/agent-job-worker.ts" }),
  60,
  15
);
const leaseRenewMs = Math.max(1_000, Math.floor((leaseSeconds * 1_000) / 2));

const store = new AppStore();
const providers = new ProviderRegistry();
const kernel = new AgentKernel({ store, providers });

let stopping = false;
let heartbeatTimer: NodeJS.Timeout | null = null;

async function upsertHeartbeat(status: "online" | "offline" = "online"): Promise<void> {
  await store.upsertWorkerNodeHeartbeat({
    nodeId,
    role: nodeRole,
    capabilities: workerCapabilities,
    status
  });
}

async function markRunFailedIfNeeded(runId: string, message: string): Promise<void> {
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

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  logInfo("worker.shutdown_requested", {
    nodeId,
    role: nodeRole,
    signal
  });

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  await store.markWorkerNodeOffline(nodeId).catch(() => undefined);
  await store.close().catch(() => undefined);
}

async function main(): Promise<void> {
  await store.initialize();
  await upsertHeartbeat("online");

  heartbeatTimer = setInterval(() => {
    void upsertHeartbeat("online").catch((error) => {
      logWarn("worker.heartbeat_failed", {
        nodeId,
        role: nodeRole,
        ...serializeError(error)
      });
    });
  }, heartbeatMs);

  logInfo("worker.started", {
    nodeId,
    role: nodeRole,
    heartbeatMs,
    pollMs,
    leaseSeconds,
    capabilities: workerCapabilities
  });

  while (!stopping) {
    const job = await store.claimNextRunJob({
      nodeId,
      targetRole: nodeRole,
      workerCapabilities,
      leaseSeconds
    });

    if (!job) {
      await sleep(pollMs);
      continue;
    }

    logInfo("worker.job.claimed", {
      nodeId,
      role: nodeRole,
      jobId: job.id,
      runId: job.runId,
      jobType: job.jobType,
      attemptCount: job.attemptCount
    });

    const runningJob = await store.markRunJobRunning(job.id, nodeId, leaseSeconds);
    if (!runningJob) {
      logWarn("worker.job.claim_lost", {
        nodeId,
        role: nodeRole,
        jobId: job.id,
        runId: job.runId
      });
      continue;
    }

    const leaseTimer = setInterval(() => {
      void store.renewRunJobLease(job.id, nodeId, leaseSeconds).catch((error) => {
        logWarn("worker.job.lease_renewal_failed", {
          nodeId,
          role: nodeRole,
          jobId: job.id,
          runId: job.runId,
          ...serializeError(error)
        });
      });
    }, leaseRenewMs);

    try {
      if (job.jobType !== "kernel") {
        throw new Error(`Unsupported run job type '${job.jobType}'.`);
      }

      const run = await store.getAgentRun(job.runId);
      if (!run) {
        throw new Error(`Run not found: ${job.runId}`);
      }
      const project = await store.getProject(run.projectId);
      if (!project) {
        throw new Error(`Project not found for run: ${job.runId}`);
      }

      await kernel.executeRunJob({
        job,
        project,
        requestId: `worker:${nodeId}:${job.id}`
      });
      await store.completeRunJob(job.id, nodeId);

      logInfo("worker.job.completed", {
        nodeId,
        role: nodeRole,
        jobId: job.id,
        runId: job.runId,
        jobType: job.jobType
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logError("worker.job.failed", {
        nodeId,
        role: nodeRole,
        jobId: job.id,
        runId: job.runId,
        jobType: job.jobType,
        ...serializeError(error)
      });

      await markRunFailedIfNeeded(job.runId, message).catch((updateError) => {
        logWarn("worker.job.run_fail_mark_failed", {
          nodeId,
          role: nodeRole,
          jobId: job.id,
          runId: job.runId,
          ...serializeError(updateError)
        });
      });
      await store.failRunJob(job.id, nodeId).catch((jobError) => {
        logWarn("worker.job.fail_transition_failed", {
          nodeId,
          role: nodeRole,
          jobId: job.id,
          runId: job.runId,
          ...serializeError(jobError)
        });
      });
    } finally {
      clearInterval(leaseTimer);
    }
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});

void main().catch(async (error) => {
  logError("worker.fatal", {
    nodeId,
    role: nodeRole,
    ...serializeError(error)
  });
  await shutdown("fatal").catch(() => undefined);
  process.exit(1);
});
