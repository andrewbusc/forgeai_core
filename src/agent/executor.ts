import { serializeError } from "../lib/logging.js";
import { AgentContext, AgentStep, AgentStepExecution } from "./types.js";
import { AgentToolRegistry } from "./tools/index.js";

export class AgentExecutor {
  constructor(private readonly tools: AgentToolRegistry) {}

  async executeStep(step: AgentStep, context: AgentContext): Promise<AgentStepExecution> {
    const startedAt = new Date().toISOString();

    try {
      const output = await this.tools.execute(step.tool, step.input, context);
      const finishedAt = new Date().toISOString();

      return {
        stepId: step.id,
        tool: step.tool,
        type: step.type,
        status: "completed",
        input: step.input,
        output,
        startedAt,
        finishedAt
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const serialized = serializeError(error);

      return {
        stepId: step.id,
        tool: step.tool,
        type: step.type,
        status: "failed",
        input: step.input,
        error: String(serialized.message || "Tool execution failed."),
        output: serialized,
        startedAt,
        finishedAt
      };
    }
  }
}

