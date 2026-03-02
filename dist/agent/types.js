import { z } from "zod";
import { canonicalAgentRunStatusSchema } from "./run-status.js";
export const agentStepTypeSchema = z.enum(["analyze", "modify", "verify"]);
export const agentToolNameSchema = z.enum([
    "ai_mutation",
    "manual_file_write",
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
    mutates: z.boolean().optional(),
    input: z.record(z.unknown()).default({})
});
export const agentPlanSchema = z.object({
    goal: z.string().min(1).max(8_000),
    steps: z.array(agentStepSchema).min(1).max(20)
});
export const agentRunStatusSchema = canonicalAgentRunStatusSchema;
export const agentRunValidationStatusSchema = z.enum(["failed", "passed"]);
export const agentStepExecutionStatusSchema = z.enum(["completed", "failed"]);
export const agentRunJobTypeSchema = z.enum(["kernel", "validation", "evaluation"]);
export const agentRunJobStatusSchema = z.enum(["queued", "claimed", "running", "complete", "failed"]);
export const workerNodeRoleSchema = z.enum(["compute", "eval"]);
export const workerNodeStatusSchema = z.enum(["online", "offline"]);
export const agentRunExecutionValidationModeSchema = z.enum(["off", "warn", "enforce"]);
export const agentRunExecutionProfileSchema = z.enum(["full", "ci", "smoke"]);
export function withAgentStepCapabilities(step) {
    if (typeof step.mutates === "boolean") {
        return step;
    }
    return {
        ...step,
        mutates: step.type === "modify"
    };
}
export function withAgentPlanCapabilities(plan) {
    return {
        ...plan,
        steps: plan.steps.map((step) => withAgentStepCapabilities(step))
    };
}
