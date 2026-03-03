/**
 * Documentation & Demo Tests
 * 
 * Tests Sprint 4 components for external tester onboarding goal.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';

test('operator guide exists with 5 pages', async () => {
  const operatorGuide = './docs/operator-guide.md';
  
  // Check file exists
  const stats = await fs.stat(operatorGuide);
  assert.ok(stats.isFile(), 'operator-guide.md should exist');
  
  // Check content structure
  const content = await fs.readFile(operatorGuide, 'utf8');
  
  // Page 1: What is deeprun (30 seconds)
  assert.ok(content.includes('Page 1: What is deeprun (30 seconds)'), 'Should have Page 1');
  assert.ok(content.includes('Zero-Edit Deployment'), 'Should explain key promise');
  assert.ok(content.includes('30 seconds to understand'), 'Should mention time investment');
  
  // Page 2: Installation (5 commands)
  assert.ok(content.includes('Page 2: Installation (5 commands)'), 'Should have Page 2');
  assert.ok(content.includes('curl -fsSL'), 'Should have one-line install');
  assert.ok(content.includes('< 10 minutes'), 'Should mention time goal');
  
  // Page 3: CI Integration (copy/paste workflow)
  assert.ok(content.includes('Page 3: CI Integration'), 'Should have Page 3');
  assert.ok(content.includes('github/workflows'), 'Should have GitHub Actions workflow');
  assert.ok(content.includes('< 30 minutes'), 'Should mention CI time goal');
  
  // Page 4: Governance Decision Contract
  assert.ok(content.includes('Page 4: Governance Decision Contract'), 'Should have Page 4');
  assert.ok(content.includes('"pass": true'), 'Should show JSON schema');
  assert.ok(content.includes('backend_generated'), 'Should show governance fields');
  
  // Page 5: Troubleshooting (5 common issues)
  assert.ok(content.includes('Page 5: Troubleshooting'), 'Should have Page 5');
  assert.ok(content.includes('Installation Failed'), 'Should have troubleshooting issues');
  assert.ok(content.includes('< 24 hours'), 'Should mention support response time');
});

test('demo backend exists with canonical structure', async () => {
  const demoPath = './examples/demo-backend';
  
  // Check directory exists
  const stats = await fs.stat(demoPath);
  assert.ok(stats.isDirectory(), 'demo-backend directory should exist');
  
  // Check required files
  const packageJson = await fs.stat(`${demoPath}/package.json`);
  assert.ok(packageJson.isFile(), 'package.json should exist');
  
  const serverTs = await fs.stat(`${demoPath}/src/server.ts`);
  assert.ok(serverTs.isFile(), 'src/server.ts should exist');
  
  const prismaSchema = await fs.stat(`${demoPath}/prisma/schema.prisma`);
  assert.ok(prismaSchema.isFile(), 'prisma/schema.prisma should exist');
  
  const readme = await fs.stat(`${demoPath}/README.md`);
  assert.ok(readme.isFile(), 'README.md should exist');
});

test('demo backend has canonical backend architecture', async () => {
  const demoPath = './examples/demo-backend';
  
  // Check package.json dependencies
  const packageContent = await fs.readFile(`${demoPath}/package.json`, 'utf8');
  const packageJson = JSON.parse(packageContent);
  
  // Required dependencies for canonical backend
  assert.ok(packageJson.dependencies.fastify, 'Should use Fastify');
  assert.ok(packageJson.dependencies.prisma, 'Should use Prisma');
  assert.ok(packageJson.dependencies['@prisma/client'], 'Should use Prisma client');
  assert.ok(packageJson.dependencies.zod, 'Should use Zod validation');
  assert.ok(packageJson.dependencies.jsonwebtoken, 'Should use JWT');
  assert.ok(packageJson.dependencies.bcryptjs, 'Should use bcrypt');
  
  // Check server.ts structure
  const serverContent = await fs.readFile(`${demoPath}/src/server.ts`, 'utf8');
  assert.ok(serverContent.includes('Fastify'), 'Should import Fastify');
  assert.ok(serverContent.includes('PrismaClient'), 'Should use Prisma client');
  assert.ok(serverContent.includes('jwt.verify'), 'Should implement JWT auth');
  assert.ok(serverContent.includes('/health'), 'Should have health endpoint');
  assert.ok(serverContent.includes('/api/auth'), 'Should have auth routes');
  assert.ok(serverContent.includes('/api/tasks'), 'Should have task routes');
  
  // Check Prisma schema
  const schemaContent = await fs.readFile(`${demoPath}/prisma/schema.prisma`, 'utf8');
  assert.ok(schemaContent.includes('model User'), 'Should have User model');
  assert.ok(schemaContent.includes('model Task'), 'Should have Task model');
  assert.ok(schemaContent.includes('postgresql'), 'Should use PostgreSQL');
});

test('demo backend README explains deeprun generation test', async () => {
  const readmeContent = await fs.readFile('./examples/demo-backend/README.md', 'utf8');
  
  // Should explain purpose
  assert.ok(readmeContent.includes('deeprun generation testing'), 'Should explain purpose');
  assert.ok(readmeContent.includes('reliability benchmark'), 'Should mention reliability');
  
  // Should have generation prompt
  assert.ok(readmeContent.includes('task management API'), 'Should have test prompt');
  assert.ok(readmeContent.includes('user authentication'), 'Should include auth requirement');
  
  // Should explain expected results
  assert.ok(readmeContent.includes('Should Generate'), 'Should list expected generation');
  assert.ok(readmeContent.includes('Should Pass Governance'), 'Should list governance criteria');
  
  // Should have testing instructions
  assert.ok(readmeContent.includes('Testing deeprun Generation'), 'Should have test instructions');
  assert.ok(readmeContent.includes('bootstrap/backend'), 'Should show API usage');
});

test('upgrade protocol documentation exists', async () => {
  const upgradeDoc = './docs/upgrade-protocol.md';
  
  // Check file exists
  const stats = await fs.stat(upgradeDoc);
  assert.ok(stats.isFile(), 'upgrade-protocol.md should exist');
  
  // Check content structure
  const content = await fs.readFile(upgradeDoc, 'utf8');
  
  // Schema versioning
  assert.ok(content.includes('Schema Version Semantics'), 'Should explain versioning');
  assert.ok(content.includes('MAJOR.MINOR.PATCH'), 'Should use semantic versioning');
  
  // Backward compatibility
  assert.ok(content.includes('Backward Compatibility Guarantees'), 'Should explain compatibility');
  assert.ok(content.includes('API Compatibility Matrix'), 'Should have compatibility matrix');
  
  // Upgrade procedures
  assert.ok(content.includes('Deployment Upgrade Procedure'), 'Should have upgrade procedures');
  assert.ok(content.includes('PATCH Upgrades'), 'Should explain patch upgrades');
  assert.ok(content.includes('MINOR Upgrades'), 'Should explain minor upgrades');
  assert.ok(content.includes('MAJOR Upgrades'), 'Should explain major upgrades');
  
  // Rollback procedures
  assert.ok(content.includes('Rollback'), 'Should explain rollback procedures');
  assert.ok(content.includes('database backup'), 'Should mention backup requirements');
});

test('documentation supports external tester onboarding', async () => {
  // Operator guide should be self-contained
  const operatorContent = await fs.readFile('./docs/operator-guide.md', 'utf8');
  
  // Should have complete installation instructions
  assert.ok(operatorContent.includes('One-line install'), 'Should have simple install');
  assert.ok(operatorContent.includes('Docker Install'), 'Should have Docker option');
  assert.ok(operatorContent.includes('Required Configuration'), 'Should list requirements');
  
  // Should have working examples
  assert.ok(operatorContent.includes('curl -X POST'), 'Should have API examples');
  assert.ok(operatorContent.includes('DEEPRUN_API_URL'), 'Should show configuration');
  
  // Should have troubleshooting
  assert.ok(operatorContent.includes('Installation Failed'), 'Should help with failures');
  assert.ok(operatorContent.includes('Server Won\'t Start'), 'Should help with startup');
  assert.ok(operatorContent.includes('Getting Help'), 'Should provide support info');
  
  // Demo should be runnable
  const demoReadme = await fs.readFile('./examples/demo-backend/README.md', 'utf8');
  assert.ok(demoReadme.includes('Quick Start'), 'Should have quick start');
  assert.ok(demoReadme.includes('npm install'), 'Should have setup commands');
  assert.ok(demoReadme.includes('Success Criteria'), 'Should define success');
});

test('documentation meets 5-page operator guide goal', async () => {
  const operatorContent = await fs.readFile('./docs/operator-guide.md', 'utf8');
  
  // Count pages (sections starting with "## Page")
  const pageMatches = operatorContent.match(/## Page \d:/g);
  assert.ok(pageMatches, 'Should have page markers');
  assert.equal(pageMatches.length, 5, 'Should have exactly 5 pages');
  
  // Each page should be concise (rough word count check)
  const pages = operatorContent.split(/## Page \d:/);
  
  // Skip first element (content before first page)
  for (let i = 1; i < pages.length; i++) {
    const wordCount = pages[i].split(/\s+/).length;
    assert.ok(wordCount < 1000, `Page ${i} should be concise (< 1000 words)`);
  }
  
  // Should be actionable (contains commands)
  assert.ok(operatorContent.includes('```bash'), 'Should have executable commands');
  assert.ok(operatorContent.includes('curl'), 'Should have API examples');
  assert.ok(operatorContent.includes('docker'), 'Should have Docker commands');
});