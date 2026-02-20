import { z } from "zod";

export const canonicalAgentRunStatusSchema = z.enum([
  "queued",
  "running",
  "correcting",
  "optimizing",
  "validating",
  "complete",
  "failed",
  "cancelled"
]);

export type CanonicalAgentRunStatus = z.infer<typeof canonicalAgentRunStatusSchema>;

export const activeAgentRunStatuses: CanonicalAgentRunStatus[] = [
  "queued",
  "running",
  "correcting",
  "optimizing",
  "validating"
];

export function isActiveAgentRunStatus(status: CanonicalAgentRunStatus): boolean {
  return activeAgentRunStatuses.includes(status);
}

export function isExecutingAgentRunStatus(status: CanonicalAgentRunStatus): boolean {
  return status === "running" || status === "correcting" || status === "optimizing" || status === "validating";
}
