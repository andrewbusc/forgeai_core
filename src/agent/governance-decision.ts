/**
 * Governance Decision JSON Contract
 * 
 * Clean external API with no internal vocabulary leakage.
 * 
 * No "kernel", "graph revision", "policy descriptor" exposed.
 */

import { z } from 'zod';

/**
 * Clean governance decision schema for external consumption
 */
export const governanceDecisionSchema = z.object({
  pass: z.boolean(),
  version: z.string(),
  timestamp: z.string(),
  artifacts: z.array(z.object({
    type: z.enum(['code', 'trace', 'validation']),
    path: z.string(),
    size: z.number(),
    checksum: z.string(),
  })),
  summary: z.object({
    backend_generated: z.boolean(),
    tests_passing: z.boolean(),
    security_validated: z.boolean(),
    deployment_ready: z.boolean(),
  }),
  metadata: z.object({
    execution_time_ms: z.number(),
    steps_completed: z.number(),
    corrections_applied: z.number(),
  }).optional(),
});

export type GovernanceDecision = z.infer<typeof governanceDecisionSchema>;

/**
 * Build clean governance decision from internal state
 */
export function buildGovernanceDecision(input: {
  runId: string;
  projectId: string;
  passed: boolean;
  executionTimeMs: number;
  stepsCompleted: number;
  correctionsApplied: number;
  artifacts: Array<{
    type: 'code' | 'trace' | 'validation';
    path: string;
    size: number;
    checksum: string;
  }>;
  backendGenerated: boolean;
  testsPassing: boolean;
  securityValidated: boolean;
  deploymentReady: boolean;
}): GovernanceDecision {
  return {
    pass: input.passed,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    artifacts: input.artifacts,
    summary: {
      backend_generated: input.backendGenerated,
      tests_passing: input.testsPassing,
      security_validated: input.securityValidated,
      deployment_ready: input.deploymentReady,
    },
    metadata: {
      execution_time_ms: input.executionTimeMs,
      steps_completed: input.stepsCompleted,
      corrections_applied: input.correctionsApplied,
    },
  };
}

/**
 * Validate governance decision JSON
 */
export function validateGovernanceDecision(data: unknown): GovernanceDecision {
  return governanceDecisionSchema.parse(data);
}