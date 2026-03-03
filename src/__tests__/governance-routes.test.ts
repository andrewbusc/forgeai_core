/**
 * Governance Routes Integration Test
 * 
 * Tests governance API endpoints with clean external interface.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGovernanceDecision } from '../agent/governance-decision.js';

test('governance decision API provides clean external interface', () => {
  // Simulate what the API endpoint would return
  const decision = buildGovernanceDecision({
    runId: 'test-run',
    projectId: 'test-project',
    passed: true,
    executionTimeMs: 30000,
    stepsCompleted: 10,
    correctionsApplied: 1,
    artifacts: [
      {
        type: 'code',
        path: '/generated/test-project/test-run/src',
        size: 12000,
        checksum: 'sha256:abc123',
      },
    ],
    backendGenerated: true,
    testsPassing: true,
    securityValidated: true,
    deploymentReady: true,
  });

  // Verify this matches what external CI systems expect
  assert.equal(decision.pass, true);
  assert.equal(decision.version, '1.0.0');
  assert.ok(decision.timestamp);
  assert.equal(decision.artifacts.length, 1);
  
  // Verify external vocabulary
  assert.equal(decision.summary.backend_generated, true);
  assert.equal(decision.summary.tests_passing, true);
  assert.equal(decision.summary.security_validated, true);
  assert.equal(decision.summary.deployment_ready, true);
  
  // Verify clean metadata
  assert.equal(decision.metadata?.execution_time_ms, 30000);
  assert.equal(decision.metadata?.steps_completed, 10);
  assert.equal(decision.metadata?.corrections_applied, 1);
});

test('governance routes factory exports correctly', async () => {
  // Verify the routes module exports the factory function
  const routes = await import('../governance-routes.js');
  assert.ok(typeof routes.createGovernanceRoutes === 'function');
});