import { z } from "zod";
import { AgentContext, AgentToolName } from "../types.js";
import { applyPatchTool } from "./apply-patch.js";
import { fetchRuntimeLogsTool } from "./fetch-runtime-logs.js";
import { listFilesTool } from "./list-files.js";
import { readFileTool } from "./read-file.js";
import { runPreviewContainerTool } from "./run-preview-container.js";
import { writeFileTool } from "./write-file.js";

export interface AgentTool<Input = unknown> {
  name: AgentToolName;
  description: string;
  inputSchema: z.ZodType<Input, z.ZodTypeDef, unknown>;
  execute(input: Input, context: AgentContext): Promise<Record<string, unknown>>;
}

export class AgentToolRegistry {
  private readonly tools = new Map<AgentToolName, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  list(): Array<{ name: AgentToolName; description: string }> {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description
    }));
  }

  get(toolName: AgentToolName): AgentTool {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return tool;
  }

  async execute(toolName: AgentToolName, input: Record<string, unknown>, context: AgentContext): Promise<Record<string, unknown>> {
    const tool = this.get(toolName);
    const parsed = tool.inputSchema.parse(input ?? {});
    return tool.execute(parsed, context);
  }
}

export function createDefaultAgentToolRegistry(): AgentToolRegistry {
  const registry = new AgentToolRegistry();

  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(applyPatchTool);
  registry.register(listFilesTool);
  registry.register(runPreviewContainerTool);
  registry.register(fetchRuntimeLogsTool);

  return registry;
}
