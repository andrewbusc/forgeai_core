/**
 * Resource Boundaries
 * 
 * Operational safety limits for v1 production readiness.
 * 
 * Not for performance optimization.
 * For preventing runaway executions.
 */

export interface ResourceBoundaries {
  runTimeoutMs: number;
  stepTimeoutMs: number;
  maxMemoryMb: number;
  maxRetries: number;
}

export const DEFAULT_RESOURCE_BOUNDARIES: ResourceBoundaries = {
  runTimeoutMs: parseInt(process.env.AGENT_RUN_TIMEOUT_MS || '3600000'), // 1 hour
  stepTimeoutMs: parseInt(process.env.AGENT_STEP_TIMEOUT_MS || '300000'), // 5 minutes
  maxMemoryMb: parseInt(process.env.AGENT_MAX_MEMORY_MB || '2048'), // 2GB
  maxRetries: parseInt(process.env.AGENT_MAX_RETRIES || '3'),
};

/**
 * Check if run has exceeded timeout
 */
export function isRunTimedOut(
  runCreatedAt: Date,
  boundaries: ResourceBoundaries = DEFAULT_RESOURCE_BOUNDARIES
): boolean {
  const elapsed = Date.now() - runCreatedAt.getTime();
  return elapsed > boundaries.runTimeoutMs;
}

/**
 * Check if step has exceeded timeout
 */
export function isStepTimedOut(
  stepStartedAt: Date,
  boundaries: ResourceBoundaries = DEFAULT_RESOURCE_BOUNDARIES
): boolean {
  const elapsed = Date.now() - stepStartedAt.getTime();
  return elapsed > boundaries.stepTimeoutMs;
}

/**
 * Check current memory usage against limit
 */
export function isMemoryExceeded(
  boundaries: ResourceBoundaries = DEFAULT_RESOURCE_BOUNDARIES
): boolean {
  const usage = process.memoryUsage();
  const usageMb = usage.heapUsed / 1024 / 1024;
  return usageMb > boundaries.maxMemoryMb;
}

/**
 * Resource boundary violation error
 */
export class ResourceBoundaryError extends Error {
  constructor(
    public readonly boundaryType: 'timeout' | 'memory' | 'retries',
    public readonly limit: number,
    public readonly actual: number,
    message: string
  ) {
    super(message);
    this.name = 'ResourceBoundaryError';
  }
}

/**
 * Validate resource boundaries on run start
 */
export function validateResourceBoundaries(boundaries: ResourceBoundaries): void {
  if (boundaries.runTimeoutMs <= 0) {
    throw new Error('Run timeout must be positive');
  }
  if (boundaries.stepTimeoutMs <= 0) {
    throw new Error('Step timeout must be positive');
  }
  if (boundaries.maxMemoryMb <= 0) {
    throw new Error('Max memory must be positive');
  }
  if (boundaries.maxRetries < 0) {
    throw new Error('Max retries cannot be negative');
  }
}

/**
 * Abort semantics for resource boundary violations
 */
export interface AbortReason {
  type: 'timeout' | 'memory' | 'retries';
  message: string;
  timestamp: string;
  runId: string;
  stepIndex?: number;
}

export function createAbortReason(
  type: 'timeout' | 'memory' | 'retries',
  runId: string,
  stepIndex?: number
): AbortReason {
  const messages = {
    timeout: 'Execution exceeded timeout limit',
    memory: 'Execution exceeded memory limit',
    retries: 'Execution exceeded retry limit',
  };

  return {
    type,
    message: messages[type],
    timestamp: new Date().toISOString(),
    runId,
    stepIndex,
  };
}