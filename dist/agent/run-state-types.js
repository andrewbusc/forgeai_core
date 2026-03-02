import { z } from "zod";
import { canonicalAgentRunStatusSchema } from "./run-status.js";
export const agentRunPhaseSchema = z.enum(["goal", "optimization"]);
export const agentRunLifecycleStatusSchema = canonicalAgentRunStatusSchema;
export const agentRunStepTypeSchema = z.enum(["goal", "correction", "optimization"]);
export const agentRunStepStatusSchema = z.enum(["pending", "running", "complete", "failed"]);
