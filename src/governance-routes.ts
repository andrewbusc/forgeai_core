/**
 * Governance Decision API Routes
 * 
 * Clean external API endpoints with no internal vocabulary.
 */

import { Router } from 'express';
import { AppStore } from './lib/project-store.js';
import { AgentRunService } from './agent/run-service.js';
import { buildGovernanceDecision } from './agent/governance-decision.js';

export function createGovernanceRoutes(store: AppStore, runService: AgentRunService): Router {
  const router = Router();

  /**
   * GET /api/projects/:projectId/runs/:runId/decision
   * 
   * Get governance decision for a run.
   * Clean external interface - no internal vocabulary.
   */
  router.get('/projects/:projectId/runs/:runId/decision', async (req, res) => {
    try {
      const { projectId, runId } = req.params;

      // Get run state
      const run = await runService.getRun(projectId, runId);
      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      // Calculate decision based on run state
      const passed = run.status === 'complete';
      const executionTimeMs = run.updatedAt 
        ? new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime()
        : 0;

      // Mock artifacts for now - in real implementation would come from run state
      const artifacts = [
        {
          type: 'code' as const,
          path: `/generated/${projectId}/${runId}/src`,
          size: 15420,
          checksum: 'sha256:abc123...',
        },
        {
          type: 'trace' as const,
          path: `/traces/${projectId}/${runId}.json`,
          size: 2340,
          checksum: 'sha256:def456...',
        },
        {
          type: 'validation' as const,
          path: `/validation/${projectId}/${runId}.json`,
          size: 890,
          checksum: 'sha256:ghi789...',
        },
      ];

      const decision = buildGovernanceDecision({
        runId,
        projectId,
        passed,
        executionTimeMs,
        stepsCompleted: run.stepIndex,
        correctionsApplied: run.correctionsUsed || 0,
        artifacts,
        backendGenerated: passed,
        testsPassing: passed,
        securityValidated: passed,
        deploymentReady: passed,
      });

      res.json(decision);
    } catch (error) {
      console.error('Error getting governance decision:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/projects/:projectId/runs/:runId/artifacts
   * 
   * Upload artifacts for a run.
   */
  router.post('/projects/:projectId/runs/:runId/artifacts', async (req, res) => {
    try {
      const { projectId, runId } = req.params;
      const { artifacts } = req.body;

      // Validate run exists
      const run = await runService.getRun(projectId, runId);
      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      // In real implementation, would store artifacts
      // For now, just acknowledge receipt
      res.json({
        success: true,
        artifacts_received: Array.isArray(artifacts) ? artifacts.length : 0,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error uploading artifacts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}