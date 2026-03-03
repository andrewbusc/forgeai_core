#!/usr/bin/env node
import { Pool } from 'pg';
import { existsSync, accessSync, constants, mkdirSync } from 'fs';
import { 
  validateRuntimeCompatibility,
  EXECUTION_CONTRACT_SCHEMA_VERSION,
  DECISION_SCHEMA_VERSION
} from '../lib/runtime-compatibility.js';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

async function checkDatabaseConnectivity(): Promise<CheckResult> {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    return {
      name: 'Database Connectivity',
      status: 'fail',
      message: 'DATABASE_URL not set'
    };
  }
  
  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    await pool.query('SELECT 1');
    await pool.end();
    return {
      name: 'Database Connectivity',
      status: 'pass',
      message: 'Connected successfully'
    };
  } catch (error) {
    return {
      name: 'Database Connectivity',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkSchemaCompatibility(): Promise<CheckResult> {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    return {
      name: 'Schema Compatibility',
      status: 'fail',
      message: 'DATABASE_URL not set'
    };
  }
  
  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    const report = await validateRuntimeCompatibility(pool);
    await pool.end();
    
    if (report.compatible) {
      return {
        name: 'Schema Compatibility',
        status: 'pass',
        message: `Runtime v${report.runtimeVersion}, Schema v${report.databaseSchemaVersion}`
      };
    } else {
      return {
        name: 'Schema Compatibility',
        status: 'fail',
        message: report.issues.join('; ')
      };
    }
  } catch (error) {
    return {
      name: 'Schema Compatibility',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkRequiredEnvVars(): CheckResult {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length === 0) {
    return {
      name: 'Required Environment Variables',
      status: 'pass',
      message: 'All required variables set'
    };
  }
  
  return {
    name: 'Required Environment Variables',
    status: 'fail',
    message: `Missing: ${missing.join(', ')}`
  };
}

function checkArtifactDirectory(): CheckResult {
  const workspaceRoot = process.env.DEEPRUN_WORKSPACE_ROOT || process.cwd();
  const artifactDir = `${workspaceRoot}/.deeprun`;
  
  try {
    if (!existsSync(artifactDir)) {
      mkdirSync(artifactDir, { recursive: true });
    }
    
    accessSync(artifactDir, constants.W_OK);
    
    return {
      name: 'Artifact Directory',
      status: 'pass',
      message: `Writable at ${artifactDir}`
    };
  } catch (error) {
    return {
      name: 'Artifact Directory',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkPolicyVersionSupport(): CheckResult {
  return {
    name: 'Policy Version Support',
    status: 'pass',
    message: `Execution Contract v${EXECUTION_CONTRACT_SCHEMA_VERSION}, Decision Schema v${DECISION_SCHEMA_VERSION}`
  };
}

async function runDoctor(): Promise<void> {
  console.log('deeprun doctor - System Health Check\n');
  
  const checks: CheckResult[] = [];
  
  checks.push(checkRequiredEnvVars());
  checks.push(await checkDatabaseConnectivity());
  checks.push(await checkSchemaCompatibility());
  checks.push(checkPolicyVersionSupport());
  checks.push(checkArtifactDirectory());
  
  let hasFailures = false;
  
  for (const check of checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    const color = check.status === 'pass' ? '\x1b[32m' : check.status === 'warn' ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';
    
    console.log(`${color}${icon}${reset} ${check.name}`);
    console.log(`  ${check.message}\n`);
    
    if (check.status === 'fail') {
      hasFailures = true;
    }
  }
  
  if (hasFailures) {
    console.log('\x1b[31m✗ System not ready\x1b[0m');
    console.log('Fix the issues above before starting the server.\n');
    process.exit(1);
  } else {
    console.log('\x1b[32m✓ System ready\x1b[0m\n');
    process.exit(0);
  }
}

runDoctor();
