import { z } from "zod";
import { AgentTool } from "./index.js";
import { readRuntimeLog } from "./runtime-log-store.js";

const fetchRuntimeLogsInputSchema = z.object({
  maxChars: z.number().int().min(200).max(200_000).default(24_000),
  includeMetadata: z.boolean().default(true)
});

export const fetchRuntimeLogsTool: AgentTool<z.infer<typeof fetchRuntimeLogsInputSchema>> = {
  name: "fetch_runtime_logs",
  description: "Fetch the most recent runtime verification logs for this project.",
  inputSchema: fetchRuntimeLogsInputSchema,
  async execute(input, context) {
    const record = await readRuntimeLog(context.project.id);

    if (!record) {
      return {
        available: false,
        runtimeStatus: "unknown",
        updatedAt: null,
        logs: "",
        metadata: input.includeMetadata ? {} : undefined
      };
    }

    const logs =
      record.logs.length > input.maxChars
        ? record.logs.slice(record.logs.length - input.maxChars)
        : record.logs;

    return {
      available: true,
      runtimeStatus: record.status,
      updatedAt: record.updatedAt,
      logs,
      metadata: input.includeMetadata ? record.metadata : undefined
    };
  }
};
