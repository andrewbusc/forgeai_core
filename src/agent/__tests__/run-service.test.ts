import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AgentRunService } from "../run-service.js";
import { AppStore } from "../../lib/project-store.js";
import { Project } from "../../types.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Agent state tests require DATABASE_URL or TEST_DATABASE_URL. Example: postgres://postgres:postgres@localhost:5432/deeprun_test"
  );
}
const requiredDatabaseUrl: string = databaseUrl;

interface Harness {
  tmpRoot: string;
  store: AppStore;
  service: AgentRunService;
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
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "deeprun-agent-state-"));
  const store = new AppStore(tmpRoot);
  await store.initialize();

  const suffix = randomUUID().slice(0, 8);
  const user = await store.createUser({
    email: `agent-state-${suffix}@example.com`,
    name: `Agent State ${suffix}`,
    passwordHash: "hash"
  });

  const org = await store.createOrganization({
    name: `Agent Org ${suffix}`,
    slug: `agent-org-${suffix}`
  });

  await store.createMembership({
    orgId: org.id,
    userId: user.id,
    role: "owner"
  });

  const workspace = await store.createWorkspace({
    orgId: org.id,
    name: `Workspace ${suffix}`,
    description: "Agent state test workspace"
  });

  const project = await store.createProject({
    orgId: org.id,
    workspaceId: workspace.id,
    createdByUserId: user.id,
    name: `Project ${suffix}`,
    description: "Agent state test project",
    templateId: "agent-workflow"
  });

  const service = new AgentRunService(store);

  return {
    tmpRoot,
    store,
    service,
    project,
    userId: user.id
  };
}

async function destroyHarness(harness: Harness): Promise<void> {
  await harness.store.close();
  await rm(harness.tmpRoot, { recursive: true, force: true });
}

  test("valid transitions: queued -> running -> cancelled", async () => {
    const harness = await createHarness();

    try {
      const run = await harness.service.createRun({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Transition test",
        requestId: "test-transition"
      });

      const running = await harness.service.markRunRunning(harness.project.id, run.id, "test-transition");
      assert.equal(running.status, "running");

      const cancelled = await harness.service.markRunCancelled(harness.project.id, run.id, "test-transition");
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.stepIndex, 0);
    } finally {
      await destroyHarness(harness);
    }
  });

  test("invalid transition: complete -> running is rejected", async () => {
    const harness = await createHarness();

    try {
      const run = await harness.service.createRun({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Invalid transition test",
        requestId: "test-invalid"
      });

      await harness.service.markRunRunning(harness.project.id, run.id, "test-invalid");
      await harness.service.markRunComplete(harness.project.id, run.id, "test-invalid");

      await assert.rejects(
        harness.service.markRunRunning(harness.project.id, run.id, "test-invalid"),
        /Invalid transition/
      );
    } finally {
      await destroyHarness(harness);
    }
  });

  test("invariant enforcement: step cap fails run before next step", async () => {
    const harness = await createHarness();

    try {
      const run = await harness.service.createRun({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Step cap test",
        maxSteps: 1,
        maxOptimizations: 10,
        requestId: "test-step-cap"
      });

      const first = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-step-cap",
        expectedStepIndex: 0
      });
      assert.equal(first.outcome, "processed");

      const second = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-step-cap",
        expectedStepIndex: 1
      });
      assert.equal(second.outcome, "skipped");
      assert.equal(second.run?.status, "failed");
    } finally {
      await destroyHarness(harness);
    }
  });

  test("cancellation flow: running -> cancelled on worker tick", async () => {
    const harness = await createHarness();

    try {
      const run = await harness.service.createRun({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Cancel test",
        requestId: "test-cancel"
      });

      await harness.service.markRunRunning(harness.project.id, run.id, "test-cancel");
      await harness.service.markRunCancelled(harness.project.id, run.id, "test-cancel");

      const result = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-cancel"
      });

      assert.equal(result.outcome, "skipped");
      assert.equal(result.run?.status, "cancelled");
      assert.equal(result.run?.stepIndex, 0);
    } finally {
      await destroyHarness(harness);
    }
  });

  test("resume flow: cancelled/failed -> queued without resetting counters", async () => {
    const harness = await createHarness();

    try {
      const run = await harness.service.createRun({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Resume test",
        requestId: "test-resume"
      });

      await harness.service.markRunRunning(harness.project.id, run.id, "test-resume");
      await harness.service.incrementStepIndex(run.id);
      await harness.service.markRunFailed(harness.project.id, run.id, "test-resume", "simulated failure");

      const resumed = await harness.service.resumeRun(harness.project.id, run.id, "test-resume");

      assert.equal(resumed.status, "queued");
      assert.equal(resumed.stepIndex, 1);
    } finally {
      await destroyHarness(harness);
    }
  });

  test("idempotency guard: stale expected step index is skipped", async () => {
    const harness = await createHarness();

    try {
      const run = await harness.service.createRun({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Idempotency test",
        requestId: "test-idempotency"
      });

      const first = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-idempotency",
        expectedStepIndex: 0
      });
      assert.equal(first.outcome, "processed");
      assert.equal(first.run?.stepIndex, 1);

      const stale = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-idempotency",
        expectedStepIndex: 0
      });
      assert.equal(stale.outcome, "skipped");
      assert.match(stale.reason || "", /Stale worker payload/);
    } finally {
      await destroyHarness(harness);
    }
  });

  test("optimization phase switch and completion", async () => {
    const previous = process.env.AGENT_FAKE_GOAL_STEPS;
    process.env.AGENT_FAKE_GOAL_STEPS = "1";

    const harness = await createHarness();

    try {
      const run = await harness.service.createRun({
        project: harness.project,
        createdByUserId: harness.userId,
        goal: "Optimization test",
        maxSteps: 20,
        maxOptimizations: 2,
        requestId: "test-optimization"
      });

      const step1 = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-optimization",
        expectedStepIndex: 0
      });
      assert.equal(step1.outcome, "processed");
      assert.equal(step1.run?.phase, "optimization");
      assert.equal(step1.run?.status, "optimizing");

      const step2 = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-optimization",
        expectedStepIndex: 1
      });
      assert.equal(step2.outcome, "processed");
      assert.equal(step2.run?.optimizationStepsUsed, 1);

      const step3 = await harness.service.executeNextStep({
        projectId: harness.project.id,
        runId: run.id,
        requestId: "test-optimization",
        expectedStepIndex: 2
      });
      assert.equal(step3.outcome, "processed");
      assert.equal(step3.run?.status, "complete");
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_FAKE_GOAL_STEPS;
      } else {
        process.env.AGENT_FAKE_GOAL_STEPS = previous;
      }

      await destroyHarness(harness);
    }
  });
