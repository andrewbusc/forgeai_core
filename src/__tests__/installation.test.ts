/**
 * Installation & Packaging Tests
 * 
 * Tests Sprint 3 components for < 10 minute install goal.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import { validateEnvironment } from '../lib/env-config.js';

test('installation script exists and is executable', async () => {
  const installScript = './install.sh';
  
  // Check file exists
  const stats = await fs.stat(installScript);
  assert.ok(stats.isFile(), 'install.sh should be a file');
  
  // Check executable permission
  const mode = stats.mode & parseInt('777', 8);
  assert.ok(mode & parseInt('100', 8), 'install.sh should be executable');
  
  // Check script content
  const content = await fs.readFile(installScript, 'utf8');
  assert.ok(content.includes('deeprun Installation Script'), 'Script should have proper header');
  assert.ok(content.includes('check_requirements'), 'Script should check requirements');
  assert.ok(content.includes('setup_database'), 'Script should setup database');
  assert.ok(content.includes('health_check'), 'Script should perform health check');
});

test('Dockerfile exists with production configuration', async () => {
  const dockerfile = './Dockerfile';
  
  // Check file exists
  const stats = await fs.stat(dockerfile);
  assert.ok(stats.isFile(), 'Dockerfile should exist');
  
  // Check content
  const content = await fs.readFile(dockerfile, 'utf8');
  assert.ok(content.includes('FROM node:20-alpine'), 'Should use Node 20 Alpine');
  assert.ok(content.includes('HEALTHCHECK'), 'Should include health check');
  assert.ok(content.includes('USER deeprun'), 'Should run as non-root user');
  assert.ok(content.includes('EXPOSE 3000'), 'Should expose port 3000');
});

test('docker-compose.yml exists with PostgreSQL', async () => {
  const composeFile = './docker-compose.yml';
  
  // Check file exists
  const stats = await fs.stat(composeFile);
  assert.ok(stats.isFile(), 'docker-compose.yml should exist');
  
  // Check content
  const content = await fs.readFile(composeFile, 'utf8');
  assert.ok(content.includes('postgres:15-alpine'), 'Should use PostgreSQL 15');
  assert.ok(content.includes('healthcheck:'), 'Should include health checks');
  assert.ok(content.includes('volumes:'), 'Should persist data');
  assert.ok(content.includes('restart: unless-stopped'), 'Should auto-restart');
});

test('.env.example exists with required variables', async () => {
  const envExample = './.env.example';
  
  // Check file exists
  const stats = await fs.stat(envExample);
  assert.ok(stats.isFile(), '.env.example should exist');
  
  // Check content
  const content = await fs.readFile(envExample, 'utf8');
  assert.ok(content.includes('DATABASE_URL='), 'Should include DATABASE_URL');
  assert.ok(content.includes('JWT_SECRET='), 'Should include JWT_SECRET');
  assert.ok(content.includes('CORS_ALLOWED_ORIGINS='), 'Should include CORS_ALLOWED_ORIGINS');
  assert.ok(content.includes('OPENAI_API_KEY='), 'Should include OPENAI_API_KEY');
  assert.ok(content.includes('ANTHROPIC_API_KEY='), 'Should include ANTHROPIC_API_KEY');
});

test('environment validation works correctly', () => {
  // Save original env
  const originalEnv = { ...process.env };
  
  try {
    // Test with missing required vars (should throw)
    process.env = {
      NODE_ENV: 'test', // Prevent exit in test environment
    };
    
    let threwError = false;
    try {
      validateEnvironment();
    } catch (error) {
      threwError = true;
      assert.ok(error instanceof Error, 'Should throw Error');
    }
    assert.ok(threwError, 'Should throw when required vars are missing');
    
    // Test with valid minimal config
    process.env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'test_secret_minimum_32_characters_long',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    };
    
    const config = validateEnvironment();
    assert.equal(config.port, 3000, 'Should default to port 3000');
    assert.equal(config.nodeEnv, 'test', 'Should use test environment');
    assert.equal(config.corsAllowedOrigins.length, 1, 'Should parse CORS origins');
    
  } finally {
    // Restore original env
    process.env = originalEnv;
  }
});

test('documentation files exist', async () => {
  // Check installation docs
  const installDocs = './docs/installation.md';
  const installStats = await fs.stat(installDocs);
  assert.ok(installStats.isFile(), 'installation.md should exist');
  
  const installContent = await fs.readFile(installDocs, 'utf8');
  assert.ok(installContent.includes('< 10 minutes'), 'Should mention 10 minute goal');
  assert.ok(installContent.includes('curl -fsSL'), 'Should include one-line install');
  
  // Check configuration docs
  const configDocs = './docs/configuration.md';
  const configStats = await fs.stat(configDocs);
  assert.ok(configStats.isFile(), 'configuration.md should exist');
  
  const configContent = await fs.readFile(configDocs, 'utf8');
  assert.ok(configContent.includes('DATABASE_URL'), 'Should document DATABASE_URL');
  assert.ok(configContent.includes('JWT_SECRET'), 'Should document JWT_SECRET');
});

test('installation components support < 10 minute goal', async () => {
  // Verify install script has optimizations for speed
  const installContent = await fs.readFile('./install.sh', 'utf8');
  
  // Should check requirements first (fail fast)
  assert.ok(installContent.includes('check_requirements'), 'Should check requirements first');
  
  // Should use npm ci (faster than npm install)
  assert.ok(installContent.includes('npm ci'), 'Should use npm ci for speed');
  
  // Should have health check with timeout
  assert.ok(installContent.includes('health_check'), 'Should include health check');
  assert.ok(installContent.includes('max_attempts'), 'Should have timeout for health check');
  
  // Verify Docker setup is optimized
  const dockerContent = await fs.readFile('./Dockerfile', 'utf8');
  
  // Should use Alpine (smaller image)
  assert.ok(dockerContent.includes('alpine'), 'Should use Alpine for smaller image');
  
  // Should have multi-stage build (faster)
  assert.ok(dockerContent.includes('AS base'), 'Should use multi-stage build');
  
  // Should clean up to reduce image size
  assert.ok(dockerContent.includes('npm cache clean'), 'Should clean npm cache');
});