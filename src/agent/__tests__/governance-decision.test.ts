/**
 * Governance Decision API Tests
 * 
 * Tests clean external interface with no internal vocabulary.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGovernanceDecision, validateGovernanceDecision } from '../governance-decision.js';

test('builds clean governance decision with no internal vocabulary', () => {
  const decision = buildGovernanceDecision({
    runId: 'run_123',
    projectId: 'proj_456',
    passed: true,
    executionTimeMs: 45000,
    stepsCompleted: 12,
    correctionsApplied: 2,
    artifacts: [
      {
        type: 'code',
        path: '/generated/proj_456/run_123/src',
        size: 15420,
        checksum: 'sha256:abc123...',
      },
      {
        type: 'trace',
        path: '/traces/proj_456/run_123.json',
        size: 2340,
        checksum: 'sha256:def456...',
      },
      {
        type: 'validation',
        path: '/validation/proj_456/run_123.json',
        size: 890,
        checksum: 'sha256:ghi789...',
      },
    ],
    backendGenerated: true,
    testsPassing: true,
    securityValidated: true,
    deploymentReady: true,
  });

  // Verify clean external interface
  assert.equal(decision.pass, true);
  assert.equal(decision.version, '1.0.0');
  assert.ok(decision.timestamp);
  assert.equal(decision.artifacts.length, 3);
  
  // Verify summary uses external vocabulary
  assert.equal(decision.summary.backend_generated, true);
  assert.equal(decision.summary.tests_passing, true);
  assert.equal(decision.summary.security_validated, true);
  assert.equal(decision.summary.deployment_ready, true);
  
  // Verify metadata is optional and clean
  assert.equal(decision.metadata?.execution_time_ms, 45000);
  assert.equal(decision.metadata?.steps_completed, 12);
  assert.equal(decision.metadata?.corrections_applied, 2);
  
  // Verify no internal vocabulary leaked
  const decisionStr = JSON.stringify(decision);
  assert.ok(!decisionStr.includes('kernel'));
  assert.ok(!decisionStr.includes('graph'));
  assert.ok(!decisionStr.includes('revision'));
  assert.ok(!decisionStr.includes('policy'));
  assert.ok(!decisionStr.includes('correction_telemetry'));
  assert.ok(!decisionStr.includes('lifecycle'));
});

test('validates governance decision schema correctly', () => {
  const validDecision = {
    pass: true,
    version: '1.0.0',
    timestamp: '2024-01-01T00:00:00Z',
    artifacts: [
      {
        type: 'code',
        path: '/generated/test',
        size: 1000,
        checksum: 'sha256:test',
      },
    ],
    summary: {
      backend_generated: true,
      tests_passing: true,
      security_validated: true,
      deployment_ready: true,
    },
  };

  const validated = validateGovernanceDecision(validDecision);
  assert.equal(validated.pass, true);
  assert.equal(validated.version, '1.0.0');
});

test('rejects invalid governance decision schema', () => {
  const invalidDecision = {
    pass: 'not-boolean',
    version: '1.0.0',
    timestamp: '2024-01-01T00:00:00Z',
    artifacts: [],
    summary: {
      backend_generated: true,
      tests_passing: true,
      security_validated: true,
      deployment_ready: true,
    },
  };

  assert.throws(() => {
    validateGovernanceDecision(invalidDecision);
  });
});

test('handles failed decision correctly', () => {
  const decision = buildGovernanceDecision({
    runId: 'run_123',
    projectId: 'proj_456',
    passed: false,
    executionTimeMs: 30000,
    stepsCompleted: 8,
    correctionsApplied: 5,
    artifacts: [
      {
        type: 'trace',
        path: '/traces/proj_456/run_123.json',
        size: 1200,
        checksum: 'sha256:failed...',
      },
    ],
    backendGenerated: false,
    testsPassing: false,
    securityValidated: false,
    deploymentReady: false,
  });

  assert.equal(decision.pass, false);
  assert.equal(decision.summary.backend_generated, false);
  assert.equal(decision.summary.tests_passing, false);
  assert.equal(decision.summary.security_validated, false);
  assert.equal(decision.summary.deployment_ready, false);
});