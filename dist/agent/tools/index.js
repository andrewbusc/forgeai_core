import { applyPatchTool } from "./apply-patch.js";
import { fetchRuntimeLogsTool } from "./fetch-runtime-logs.js";
import { listFilesTool } from "./list-files.js";
import { readFileTool } from "./read-file.js";
import { runPreviewContainerTool } from "./run-preview-container.js";
import { writeFileTool } from "./write-file.js";
export class AgentToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    list() {
        return Array.from(this.tools.values()).map((tool) => ({
            name: tool.name,
            description: tool.description
        }));
    }
    get(toolName) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            throw new Error(`Unknown tool: ${toolName}`);
        }
        return tool;
    }
    async execute(toolName, input, context) {
        const tool = this.get(toolName);
        const parsed = tool.inputSchema.parse(input ?? {});
        return tool.execute(parsed, context);
    }
}
export function createDefaultAgentToolRegistry() {
    const registry = new AgentToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);
    registry.register(applyPatchTool);
    registry.register(listFilesTool);
    registry.register(runPreviewContainerTool);
    registry.register(fetchRuntimeLogsTool);
    return registry;
}
