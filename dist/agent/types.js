import { z } from "zod";
export const agentStepTypeSchema = z.enum(["analyze", "modify", "verify"]);
export const agentToolNameSchema = z.enum([
    "read_file",
    "write_file",
    "apply_patch",
    "list_files",
    "run_preview_container",
    "fetch_runtime_logs"
]);
export const agentStepSchema = z.object({
    id: z.string().min(1).max(80),
    type: agentStepTypeSchema,
    tool: agentToolNameSchema,
    input: z.record(z.unknown()).default({})
});
export const agentPlanSchema = z.object({
    goal: z.string().min(1).max(8_000),
    steps: z.array(agentStepSchema).min(1).max(20)
});
export const agentRunStatusSchema = z.enum(["planned", "running", "paused", "failed", "completed"]);
export const agentStepExecutionStatusSchema = z.enum(["completed", "failed"]);
