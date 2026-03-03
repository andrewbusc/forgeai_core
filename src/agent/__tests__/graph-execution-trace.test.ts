/**
 * Graph Execution Trace - Replay Tests
 * 
 * Proves:
 * - Deterministic sequence ordering
 * - Append-only semantics
 * - Trace diff correctness
 * - No ephemeral state leakage
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {
  buildTraceEventMaterial,
  hashTraceEventMaterial,
  validateTraceOrdering,
  buildGraphExecutionTraceDiff,
  type GraphExecutionEvent,
} from '../graph-execution-trace.js';
import { GraphExecutionTraceStore } from '../../lib/graph-execution-trace-store.js';

const { Pool } = pg;

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Trace tests require DATABASE_URL or TEST_DATABASE_URL');
}

let pool: pg.Pool;
let store: GraphExecutionTraceStore;

test.before(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  store = new GraphExecutionTraceStore(pool);
  await store.initialize();
});

test.after(async () => {
  await pool.query('DROP TABLE IF EXISTS graph_execution_events CASCADE');
  await pool.end();
});

test('produces deterministic hash for same event', () => {
      const event = {
        graphRevisionId: 'rev_001',
        nodeExecutionIdentityHash: 'exec_abc',
        transitionType: 'NODE_RUNNING' as const,
        previousState: 'queued',
        newState: 'running',
        policyIdentityHash: 'policy_xyz',
        deterministicSequenceNumber: 1,
      };

      const material1 = buildTraceEventMaterial(event);
      const material2 = buildTraceEventMaterial(event);
      const hash1 = hashTraceEventMaterial(material1);
      const hash2 = hashTraceEventMaterial(material2);

  assert.equal(hash1, hash2);
});

test('produces different hash for different events', () => {
      const event1 = {
        graphRevisionId: 'rev_001',
        nodeExecutionIdentityHash: 'exec_abc',
        transitionType: 'NODE_RUNNING' as const,
        previousState: 'queued',
        newState: 'running',
        policyIdentityHash: 'policy_xyz',
        deterministicSequenceNumber: 1,
      };

      const event2 = {
        ...event1,
        transitionType: 'NODE_COMPLETE' as const,
        newState: 'complete',
      };

      const hash1 = hashTraceEventMaterial(buildTraceEventMaterial(event1));
      const hash2 = hashTraceEventMaterial(buildTraceEventMaterial(event2));

  assert.notEqual(hash1, hash2);
});

test('excludes timestamp from material (metadata only)', () => {
      const event = {
        graphRevisionId: 'rev_001',
        nodeExecutionIdentityHash: 'exec_abc',
        transitionType: 'NODE_RUNNING' as const,
        previousState: 'queued',
        newState: 'running',
        policyIdentityHash: 'policy_xyz',
        deterministicSequenceNumber: 1,
      };

      const material = buildTraceEventMaterial(event);
  assert.ok(!material.includes('timestamp'));
});

test('validates empty trace', () => {
      const result = validateTraceOrdering([]);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validates correct sequence', () => {
      const events: GraphExecutionEvent[] = [
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_QUEUED',
          previousState: null,
          newState: 'queued',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:00:00Z',
          deterministicSequenceNumber: 1,
        },
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_RUNNING',
          previousState: 'queued',
          newState: 'running',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:01:00Z',
          deterministicSequenceNumber: 2,
        },
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_COMPLETE',
          previousState: 'running',
          newState: 'complete',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:02:00Z',
          deterministicSequenceNumber: 3,
        },
      ];

      const result = validateTraceOrdering(events);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('detects sequence gap', () => {
      const events: GraphExecutionEvent[] = [
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_QUEUED',
          previousState: null,
          newState: 'queued',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:00:00Z',
          deterministicSequenceNumber: 1,
        },
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_COMPLETE',
          previousState: 'running',
          newState: 'complete',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:02:00Z',
          deterministicSequenceNumber: 3, // Gap: missing 2
        },
      ];

      const result = validateTraceOrdering(events);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors[0].includes('gap'));
});

test('detects duplicate sequence number', () => {
      const events: GraphExecutionEvent[] = [
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_QUEUED',
          previousState: null,
          newState: 'queued',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:00:00Z',
          deterministicSequenceNumber: 1,
        },
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_RUNNING',
          previousState: 'queued',
          newState: 'running',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:01:00Z',
          deterministicSequenceNumber: 1, // Duplicate
        },
      ];

      const result = validateTraceOrdering(events);
  assert.equal(result.valid, false);
});

test('detects mixed revision IDs', () => {
      const events: GraphExecutionEvent[] = [
        {
          graphRevisionId: 'rev_001',
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_QUEUED',
          previousState: null,
          newState: 'queued',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:00:00Z',
          deterministicSequenceNumber: 1,
        },
        {
          graphRevisionId: 'rev_002', // Different revision
          nodeExecutionIdentityHash: 'exec_abc',
          transitionType: 'NODE_RUNNING',
          previousState: 'queued',
          newState: 'running',
          policyIdentityHash: 'policy_xyz',
          timestamp: '2024-01-01T00:01:00Z',
          deterministicSequenceNumber: 2,
        },
      ];

      const result = validateTraceOrdering(events);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('Multiple revision IDs')));
});

test('appends events with deterministic sequence', async () => {
      const revisionId = `rev_test_${Date.now()}`;

      const event1 = {
        graphRevisionId: revisionId,
        nodeExecutionIdentityHash: 'exec_test_1',
        transitionType: 'NODE_QUEUED' as const,
        previousState: null,
        newState: 'queued',
        policyIdentityHash: 'policy_test',
        deterministicSequenceNumber: 1,
      };

      const event2 = {
        graphRevisionId: revisionId,
        nodeExecutionIdentityHash: 'exec_test_1',
        transitionType: 'NODE_RUNNING' as const,
        previousState: 'queued',
        newState: 'running',
        policyIdentityHash: 'policy_test',
        deterministicSequenceNumber: 2,
      };

      await store.appendEvent(event1);
      await store.appendEvent(event2);

      const trace = await store.getTrace(revisionId);
  assert.equal(trace.totalEvents, 2);
  assert.equal(trace.events[0].deterministicSequenceNumber, 1);
  assert.equal(trace.events[1].deterministicSequenceNumber, 2);
});

test('enforces unique sequence numbers per revision', async () => {
      const revisionId = `rev_unique_${Date.now()}`;

      const event = {
        graphRevisionId: revisionId,
        nodeExecutionIdentityHash: 'exec_unique',
        transitionType: 'NODE_QUEUED' as const,
        previousState: null,
        newState: 'queued',
        policyIdentityHash: 'policy_test',
        deterministicSequenceNumber: 1,
      };

      await store.appendEvent(event);

      // Attempt duplicate sequence number
  await assert.rejects(store.appendEvent(event));
});

test('calculates next sequence number correctly', async () => {
      const revisionId = `rev_seq_${Date.now()}`;

      const nextSeq1 = await store.getNextSequenceNumber(revisionId);
  assert.equal(nextSeq1, 1);

  await store.appendEvent({
    graphRevisionId: revisionId,
    nodeExecutionIdentityHash: 'exec_seq',
    transitionType: 'NODE_QUEUED' as const,
    previousState: null,
    newState: 'queued',
    policyIdentityHash: 'policy_test',
    deterministicSequenceNumber: 1,
  });

  const nextSeq2 = await store.getNextSequenceNumber(revisionId);
  assert.equal(nextSeq2, 2);
});

test('computes diff between revisions', () => {
      const fromTrace = {
        revisionId: 'rev_001',
        events: [
          {
            graphRevisionId: 'rev_001',
            nodeExecutionIdentityHash: 'exec_abc',
            transitionType: 'NODE_QUEUED' as const,
            previousState: null,
            newState: 'queued',
            policyIdentityHash: 'policy_xyz',
            timestamp: '2024-01-01T00:00:00Z',
            deterministicSequenceNumber: 1,
          },
        ],
        totalEvents: 1,
      };

      const toTrace = {
        revisionId: 'rev_002',
        events: [
          ...fromTrace.events,
          {
            graphRevisionId: 'rev_002',
            nodeExecutionIdentityHash: 'exec_abc',
            transitionType: 'NODE_RUNNING' as const,
            previousState: 'queued',
            newState: 'running',
            policyIdentityHash: 'policy_xyz',
            timestamp: '2024-01-01T00:01:00Z',
            deterministicSequenceNumber: 2,
          },
          {
            graphRevisionId: 'rev_002',
            nodeExecutionIdentityHash: 'exec_abc',
            transitionType: 'NODE_COMPLETE' as const,
            previousState: 'running',
            newState: 'complete',
            policyIdentityHash: 'policy_xyz',
            timestamp: '2024-01-01T00:02:00Z',
            deterministicSequenceNumber: 3,
          },
        ],
        totalEvents: 3,
      };

      const diff = buildGraphExecutionTraceDiff(fromTrace, toTrace);

  assert.equal(diff.fromRevisionId, 'rev_001');
  assert.equal(diff.toRevisionId, 'rev_002');
  assert.equal(diff.eventsAdded.length, 2);
  assert.equal(diff.eventsAdded[0].transitionType, 'NODE_RUNNING');
  assert.equal(diff.eventsAdded[1].transitionType, 'NODE_COMPLETE');
  assert.equal(diff.totalEventsFrom, 1);
  assert.equal(diff.totalEventsTo, 3);
});

test('handles empty diff when no new events', () => {
      const trace = {
        revisionId: 'rev_001',
        events: [
          {
            graphRevisionId: 'rev_001',
            nodeExecutionIdentityHash: 'exec_abc',
            transitionType: 'NODE_QUEUED' as const,
            previousState: null,
            newState: 'queued',
            policyIdentityHash: 'policy_xyz',
            timestamp: '2024-01-01T00:00:00Z',
            deterministicSequenceNumber: 1,
          },
        ],
        totalEvents: 1,
      };

      const diff = buildGraphExecutionTraceDiff(trace, trace);

  assert.equal(diff.eventsAdded.length, 0);
  assert.equal(diff.totalEventsFrom, diff.totalEventsTo);
});

test('produces identical trace for same event sequence (100 iterations)', async () => {
      const revisionId = `rev_replay_${Date.now()}`;
      const events = [
        {
          graphRevisionId: revisionId,
          nodeExecutionIdentityHash: 'exec_replay',
          transitionType: 'NODE_QUEUED' as const,
          previousState: null,
          newState: 'queued',
          policyIdentityHash: 'policy_replay',
          deterministicSequenceNumber: 1,
        },
        {
          graphRevisionId: revisionId,
          nodeExecutionIdentityHash: 'exec_replay',
          transitionType: 'NODE_RUNNING' as const,
          previousState: 'queued',
          newState: 'running',
          policyIdentityHash: 'policy_replay',
          deterministicSequenceNumber: 2,
        },
        {
          graphRevisionId: revisionId,
          nodeExecutionIdentityHash: 'exec_replay',
          transitionType: 'NODE_COMPLETE' as const,
          previousState: 'running',
          newState: 'complete',
          policyIdentityHash: 'policy_replay',
          deterministicSequenceNumber: 3,
        },
      ];

      for (const event of events) {
        await store.appendEvent(event);
      }

      const hashes = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const trace = await store.getTrace(revisionId);
        const material = JSON.stringify(
          trace.events.map(e => ({
            seq: e.deterministicSequenceNumber,
            type: e.transitionType,
            state: e.newState,
          }))
        );
        const hash = hashTraceEventMaterial(material);
        hashes.add(hash);
      }

  assert.equal(hashes.size, 1); // All replays produce same hash
});
