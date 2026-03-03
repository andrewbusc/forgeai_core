/**
 * Runtime Compatibility Validation
 * 
 * Enforces schema version compatibility at boot.
 * Fails fast if runtime/database mismatch is unsafe.
 */

import { Pool } from 'pg';
import { GRAPH_SCHEMA_VERSION } from '../agent/graph-identity.js';

export const RUNTIME_VERSION = '1.0.0';
export const DATABASE_SCHEMA_VERSION = 1;
export const EXECUTION_CONTRACT_SCHEMA_VERSION = 2;
export const CONTROL_PLANE_SCHEMA_VERSION = 1;
export const DECISION_SCHEMA_VERSION = 3;

export interface CompatibilityReport {
  compatible: boolean;
  runtimeVersion: string;
  databaseSchemaVersion: number;
  executionContractSchemaVersion: number;
  controlPlaneSchemaVersion: number;
  decisionSchemaVersion: number;
  graphSchemaVersion: number;
  issues: string[];
}

export async function validateRuntimeCompatibility(pool: Pool): Promise<CompatibilityReport> {
  const issues: string[] = [];
  
  try {
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('users', 'projects', 'agent_runs', 'execution_graphs')
    `);
    
    const tables = new Set(tableCheck.rows.map(r => r.table_name));
    
    if (!tables.has('users') || !tables.has('projects')) {
      issues.push('Core tables missing - database not initialized');
    }
    
    if (!tables.has('agent_runs')) {
      issues.push('agent_runs table missing - schema migration required');
    }
    
    if (!tables.has('execution_graphs')) {
      issues.push('execution_graphs table missing - schema migration required');
    }
    
    if (tables.has('agent_runs')) {
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'agent_runs' 
          AND column_name IN ('graph_id', 'phase', 'step_index')
      `);
      
      const columns = new Set(columnCheck.rows.map(r => r.column_name));
      
      if (!columns.has('graph_id')) {
        issues.push('agent_runs.graph_id column missing - schema migration required');
      }
      
      if (!columns.has('phase')) {
        issues.push('agent_runs.phase column missing - state machine migration required');
      }
      
      if (!columns.has('step_index')) {
        issues.push('agent_runs.step_index column missing - state machine migration required');
      }
    }
    
  } catch (error) {
    issues.push(`Compatibility check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return {
    compatible: issues.length === 0,
    runtimeVersion: RUNTIME_VERSION,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    executionContractSchemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
    controlPlaneSchemaVersion: CONTROL_PLANE_SCHEMA_VERSION,
    decisionSchemaVersion: DECISION_SCHEMA_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    issues,
  };
}

export async function enforceRuntimeCompatibility(pool: Pool): Promise<void> {
  const report = await validateRuntimeCompatibility(pool);
  
  if (!report.compatible) {
    console.error('❌ Runtime compatibility check failed:');
    console.error(`   Runtime: v${report.runtimeVersion}`);
    console.error(`   Database Schema: v${report.databaseSchemaVersion}`);
    console.error(`   Execution Contract: v${report.executionContractSchemaVersion}`);
    console.error(`   Control Plane: v${report.controlPlaneSchemaVersion}`);
    console.error(`   Decision Schema: v${report.decisionSchemaVersion}`);
    console.error(`   Graph Schema: v${report.graphSchemaVersion}`);
    console.error('');
    console.error('Issues:');
    for (const issue of report.issues) {
      console.error(`   - ${issue}`);
    }
    console.error('');
    console.error('Cannot start server with incompatible runtime/database versions.');
    console.error('See docs/upgrade-protocol.md for migration procedures.');
    
    process.exit(1);
  }
}