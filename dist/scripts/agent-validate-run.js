import { randomUUID } from "node:crypto";
import { AgentKernel } from "../agent/kernel.js";
import { AppStore } from "../lib/project-store.js";
async function main() {
    const projectId = process.argv[2];
    const runId = process.argv[3];
    if (!projectId || !runId) {
        process.stderr.write("Usage: npm run agent:validate-run -- <projectId> <runId>\n");
        process.exitCode = 1;
        return;
    }
    const store = new AppStore();
    await store.initialize();
    try {
        const project = await store.getProject(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        const kernel = new AgentKernel({ store });
        const result = await kernel.validateRunOutput({
            project,
            runId,
            requestId: `cli-validate-${randomUUID().slice(0, 8)}`
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    finally {
        await store.close();
    }
}
main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
