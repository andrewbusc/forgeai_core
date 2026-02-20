import { z } from "zod";
import { CanonicalAgentRunStatus, canonicalAgentRunStatusSchema } from "./run-status.js";

export const agentRunPhaseSchema = z.enum(["goal", "optimization"]);
export type AgentRunPhase = z.infer<typeof agentRunPhaseSchema>;

export const agentRunLifecycleStatusSchema = canonicalAgentRunStatusSchema;
export type AgentRunLifecycleStatus = CanonicalAgentRunStatus;

export const agentRunStepTypeSchema = z.enum(["goal", "correction", "optimization"]);
export type AgentRunStepType = z.infer<typeof agentRunStepTypeSchema>;

export const agentRunStepStatusSchema = z.enum(["pending", "running", "complete", "failed"]);
export type AgentRunStepStatus = z.infer<typeof agentRunStepStatusSchema>;

export interface AgentLifecycleRun {
  id: string;
  projectId: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  goal: string;
  phase: AgentRunPhase;
  status: AgentRunLifecycleStatus;
  stepIndex: number;
  correctionsUsed: number;
  optimizationStepsUsed: number;
  maxSteps: number;
  maxCorrections: number;
  maxOptimizations: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLifecycleStep {
  id: string;
  runId: string;
  projectId: string;
  stepIndex: number;
  type: AgentRunStepType;
  status: AgentRunStepStatus;
  summary: string;
  commitHash: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateLifecycleRunInput {
  runId?: string;
  projectId: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  goal: string;
  phase: AgentRunPhase;
  status: AgentRunLifecycleStatus;
  stepIndex: number;
  correctionsUsed: number;
  optimizationStepsUsed: number;
  maxSteps: number;
  maxCorrections: number;
  maxOptimizations: number;
  errorMessage?: string | null;
}

export interface LifecycleRunPatchInput {
  phase?: AgentRunPhase;
  status?: AgentRunLifecycleStatus;
  stepIndex?: number;
  correctionsUsed?: number;
  optimizationStepsUsed?: number;
  maxSteps?: number;
  maxCorrections?: number;
  maxOptimizations?: number;
  errorMessage?: string | null;
}

export interface CreateLifecycleStepInput {
  runId: string;
  projectId: string;
  stepIndex: number;
  type: AgentRunStepType;
  status: AgentRunStepStatus;
  summary: string;
  commitHash?: string | null;
  completedAt?: string | null;
}

export interface LifecycleStepPatchInput {
  status?: AgentRunStepStatus;
  summary?: string;
  commitHash?: string | null;
  completedAt?: string | null;
}
