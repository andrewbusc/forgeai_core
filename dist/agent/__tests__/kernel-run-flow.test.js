import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AppStore } from "../../lib/project-store.js";
import { AgentKernel } from "../kernel.js";
import { AgentPlanner } from "../planner.js";
const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("Kernel flow tests require DATABASE_URL or TEST_DATABASE_URL. Example: postgres://postgres:postgres@localhost:5432/forgeai_test");
}
const requiredDatabaseUrl = databaseUrl;
function isLocalDatabaseUrl(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "::1";
    }
    catch {
        return false;
    }
}
class DeterministicPlanner extends AgentPlanner {
    async plan(input) {
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
    async planRuntimeCorrection(_input) {
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
async function createHarness() {
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
async function destroyHarness(harness) {
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
        assert.equal(started.run.status, "completed");
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
        assert.equal(forked.run.status, "planned");
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
        assert.equal(resumed.run.status, "completed");
        assert.equal(resumed.run.currentStepIndex, resumed.run.plan.steps.length);
        const resumedStep = resumed.steps.find((step) => step.stepId === "step-2");
        assert.ok(resumedStep);
        assert.equal(resumedStep?.status, "completed");
    }
    finally {
        if (previousLightValidation === undefined) {
            delete process.env.AGENT_LIGHT_VALIDATION_MODE;
        }
        else {
            process.env.AGENT_LIGHT_VALIDATION_MODE = previousLightValidation;
        }
        if (previousHeavyValidation === undefined) {
            delete process.env.AGENT_HEAVY_VALIDATION_MODE;
        }
        else {
            process.env.AGENT_HEAVY_VALIDATION_MODE = previousHeavyValidation;
        }
        if (previousHeavyInstall === undefined) {
            delete process.env.AGENT_HEAVY_INSTALL_DEPS;
        }
        else {
            process.env.AGENT_HEAVY_INSTALL_DEPS = previousHeavyInstall;
        }
        await destroyHarness(harness);
    }
});
