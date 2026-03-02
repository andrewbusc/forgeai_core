import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isAllowedStateTransition, runJobGraph } from "../../agent/lifecycle-graph.js";
import { AppStore } from "../project-store.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Project-store run-job tests require DATABASE_URL or TEST_DATABASE_URL. Example: postgres://postgres:postgres@localhost:5432/deeprun_test"
  );
}
const requiredDatabaseUrl: string = databaseUrl;

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function createHarness() {
  process.env.DATABASE_URL = requiredDatabaseUrl;
  if (!process.env.DATABASE_SSL && !isLocalDatabaseUrl(requiredDatabaseUrl)) {
    process.env.DATABASE_SSL = "require";
  }

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "deeprun-store-run-jobs-"));
  const store = new AppStore(tmpRoot);
  await store.initialize();

  const suffix = randomUUID().slice(0, 8);
  const user = await store.createUser({
    email: `store-run-jobs-${suffix}@example.com`,
    name: `Store Run Jobs ${suffix}`,
    passwordHash: "hash"
  });
  const org = await store.createOrganization({
    name: `Store Run Jobs Org ${suffix}`,
    slug: `store-run-jobs-org-${suffix}`
  });
  await store.createMembership({
    orgId: org.id,
    userId: user.id,
    role: "owner"
  });
  const workspace = await store.createWorkspace({
    orgId: org.id,
    name: `Workspace ${suffix}`
  });
  const project = await store.createProject({
    orgId: org.id,
    workspaceId: workspace.id,
    createdByUserId: user.id,
    name: `Project ${suffix}`,
    description: "run jobs regression test",
    templateId: "agent-workflow"
  });

  return {
    tmpRoot,
    store,
    project,
    userId: user.id
  };
}

async function destroyHarness(harness: Awaited<ReturnType<typeof createHarness>>): Promise<void> {
  await harness.store.close();
  await rm(harness.tmpRoot, { recursive: true, force: true });
}

test("enqueueRunJob stores null required capabilities as SQL NULL and claims cleanly", async () => {
  const harness = await createHarness();
  const workerNodeId = `store-regression-worker-${randomUUID().slice(0, 8)}`;

  try {
    const run = await harness.store.createAgentRun({
      projectId: harness.project.id,
      orgId: harness.project.orgId,
      workspaceId: harness.project.workspaceId,
      createdByUserId: harness.userId,
      goal: "queue regression",
      providerId: "mock",
      status: "queued",
      currentStepIndex: 0,
      plan: {
        goal: "queue regression",
        steps: [
          {
            id: "step-1",
            type: "analyze",
            tool: "list_files",
            input: {
              path: "."
            }
          }
        ]
      },
      metadata: {}
    });

    const job = await harness.store.enqueueRunJob({
      runId: run.id,
      jobType: "kernel",
      targetRole: "compute",
      requiredCapabilities: null
    });

    const [raw] = await harness.store.query<{ is_null: boolean }>(
      `SELECT required_capabilities IS NULL AS is_null
       FROM run_jobs
       WHERE id = $1`,
      [job.id]
    );
    assert.equal(raw?.is_null, true);

    await harness.store.upsertWorkerNodeHeartbeat({
      nodeId: workerNodeId,
      role: "compute",
      status: "online",
      capabilities: {}
    });

    const claimed = await harness.store.claimNextRunJob({
      nodeId: workerNodeId,
      targetRole: "compute",
      workerCapabilities: {},
      leaseSeconds: 60,
      runId: run.id
    });

    assert.ok(claimed);
    assert.equal(claimed?.id, job.id);
    assert.equal(claimed?.requiredCapabilities, null);
  } finally {
    await destroyHarness(harness);
  }
});

test("observed run job transitions conform to the canonical graph", async () => {
  const harness = await createHarness();
  const workerNodeIdA = `store-run-job-worker-a-${randomUUID().slice(0, 8)}`;
  const workerNodeIdB = `store-run-job-worker-b-${randomUUID().slice(0, 8)}`;

  try {
    await harness.store.upsertWorkerNodeHeartbeat({
      nodeId: workerNodeIdA,
      role: "compute",
      status: "online",
      capabilities: {}
    });
    await harness.store.upsertWorkerNodeHeartbeat({
      nodeId: workerNodeIdB,
      role: "compute",
      status: "online",
      capabilities: {}
    });

    const observed: Array<[string, string]> = [];
    const track = (fromStatus: string | undefined, toStatus: string | undefined) => {
      if (fromStatus && toStatus && fromStatus !== toStatus) {
        observed.push([fromStatus, toStatus]);
      }
    };

    const runOne = await harness.store.createAgentRun({
      projectId: harness.project.id,
      orgId: harness.project.orgId,
      workspaceId: harness.project.workspaceId,
      createdByUserId: harness.userId,
      goal: "job complete transition",
      providerId: "mock",
      status: "queued",
      currentStepIndex: 0,
      plan: {
        goal: "job complete transition",
        steps: [{ id: "step-1", type: "analyze", tool: "list_files", input: { path: "." } }]
      },
      metadata: {}
    });
    const jobOne = await harness.store.enqueueRunJob({
      runId: runOne.id,
      jobType: "kernel",
      targetRole: "compute",
      requiredCapabilities: null
    });
    const claimedOne = await harness.store.claimNextRunJob({
      nodeId: workerNodeIdA,
      targetRole: "compute",
      workerCapabilities: {},
      leaseSeconds: 60,
      runId: runOne.id
    });
    assert.ok(claimedOne);
    track(jobOne.status, claimedOne?.status);
    const runningOne = await harness.store.markRunJobRunning(jobOne.id, workerNodeIdA, 60);
    assert.ok(runningOne);
    track(claimedOne?.status, runningOne?.status);
    const completeOne = await harness.store.completeRunJob(jobOne.id, workerNodeIdA);
    assert.ok(completeOne);
    track(runningOne?.status, completeOne?.status);

    const runTwo = await harness.store.createAgentRun({
      projectId: harness.project.id,
      orgId: harness.project.orgId,
      workspaceId: harness.project.workspaceId,
      createdByUserId: harness.userId,
      goal: "job fail transition",
      providerId: "mock",
      status: "queued",
      currentStepIndex: 0,
      plan: {
        goal: "job fail transition",
        steps: [{ id: "step-1", type: "analyze", tool: "list_files", input: { path: "." } }]
      },
      metadata: {}
    });
    const jobTwo = await harness.store.enqueueRunJob({
      runId: runTwo.id,
      jobType: "kernel",
      targetRole: "compute",
      requiredCapabilities: null
    });
    const claimedTwo = await harness.store.claimNextRunJob({
      nodeId: workerNodeIdA,
      targetRole: "compute",
      workerCapabilities: {},
      leaseSeconds: 60,
      runId: runTwo.id
    });
    assert.ok(claimedTwo);
    track(jobTwo.status, claimedTwo?.status);
    const failedTwo = await harness.store.failRunJob(jobTwo.id, workerNodeIdA);
    assert.ok(failedTwo);
    track(claimedTwo?.status, failedTwo?.status);

    const runThree = await harness.store.createAgentRun({
      projectId: harness.project.id,
      orgId: harness.project.orgId,
      workspaceId: harness.project.workspaceId,
      createdByUserId: harness.userId,
      goal: "job reclaim transition",
      providerId: "mock",
      status: "queued",
      currentStepIndex: 0,
      plan: {
        goal: "job reclaim transition",
        steps: [{ id: "step-1", type: "analyze", tool: "list_files", input: { path: "." } }]
      },
      metadata: {}
    });
    const jobThree = await harness.store.enqueueRunJob({
      runId: runThree.id,
      jobType: "kernel",
      targetRole: "compute",
      requiredCapabilities: null
    });
    const claimedThree = await harness.store.claimNextRunJob({
      nodeId: workerNodeIdA,
      targetRole: "compute",
      workerCapabilities: {},
      leaseSeconds: 15,
      runId: runThree.id
    });
    assert.ok(claimedThree);
    track(jobThree.status, claimedThree?.status);
    const runningThree = await harness.store.markRunJobRunning(jobThree.id, workerNodeIdA, 15);
    assert.ok(runningThree);
    track(claimedThree?.status, runningThree?.status);
    await harness.store.query(
      `UPDATE run_jobs
       SET lease_expires_at = NOW() - interval '5 seconds'
       WHERE id = $1`,
      [jobThree.id]
    );
    const reclaimedThree = await harness.store.claimNextRunJob({
      nodeId: workerNodeIdB,
      targetRole: "compute",
      workerCapabilities: {},
      leaseSeconds: 60,
      runId: runThree.id
    });
    assert.ok(reclaimedThree);
    track(runningThree?.status, reclaimedThree?.status);

    assert.ok(observed.length > 0);
    for (const [fromStatus, toStatus] of observed) {
      assert.equal(
        isAllowedStateTransition(runJobGraph, fromStatus as never, toStatus as never),
        true,
        `Observed job transition ${fromStatus} -> ${toStatus} is not in the canonical graph.`
      );
    }
  } finally {
    await destroyHarness(harness);
  }
});
