import { z } from "zod";
export const agentRunPhaseSchema = z.enum(["goal", "optimization"]);
export const agentRunLifecycleStatusSchema = z.enum([
    "queued",
    "running",
    "cancelling",
    "cancelled",
    "failed",
    "complete"
]);
export const agentRunStepTypeSchema = z.enum(["goal", "correction", "optimization"]);
export const agentRunStepStatusSchema = z.enum(["pending", "running", "complete", "failed"]);
