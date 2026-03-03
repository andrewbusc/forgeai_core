# deeprun Operator Guide

**Get production-ready API backends in < 10 minutes**

---

## Page 1: What is deeprun (30 seconds)

deeprun is an AI-powered backend code generation platform that produces **production-ready, single-tenant API backends** that boot without manual edits.

### Key Promise
- **Zero-Edit Deployment**: Generated backends boot successfully without manual intervention
- **Production-Ready**: Dockerized, fully typed, security-hardened, test-enforced
- **Reliability Benchmark**: Measures % of backends that deploy in clean environments

### Technology Stack (Frozen v1)
- Node 20+ + TypeScript (strict mode)
- Fastify + Prisma + PostgreSQL
- Zod validation + Vitest testing + Pino logging
- JWT authentication + Docker deployment

### Use Cases
1. **Rapid Backend Scaffolding**: Bootstrap production backends in minutes
2. **CI/CD Integration**: Automated backend generation in pipelines
3. **Architecture Enforcement**: Consistent backend patterns across teams

**Time Investment**: 30 seconds to understand, 10 minutes to running backend

---

## Page 2: Installation (5 commands)

### Quick Install (Ubuntu/macOS)
```bash
# 1. One-line install
curl -fsSL https://install.deeprun.dev | bash

# 2. Add your API key
echo "OPENAI_API_KEY=sk-your-key" >> ~/deeprun/.env

# 3. Restart server
cd ~/deeprun && npm start

# 4. Verify health
curl http://localhost:3000/api/health

# 5. Create account
open http://localhost:3000
```

### Docker Install (Production)
```bash
# 1. Clone and configure
git clone https://github.com/deeprun/deeprun.git && cd deeprun
cp .env.example .env && nano .env  # Add your API keys

# 2. Start services
docker-compose up -d

# 3. Verify health
curl http://localhost:3000/api/health

# 4. Check logs
docker-compose logs -f

# 5. Access UI
open http://localhost:3000
```

### Required Configuration
```bash
# .env (minimum required)
DATABASE_URL=postgresql://deeprun:deeprun@localhost:5432/deeprun
JWT_SECRET=$(openssl rand -hex 32)
CORS_ALLOWED_ORIGINS=http://localhost:3000
OPENAI_API_KEY=sk-your-openai-key
```

**Time**: < 10 minutes from fresh machine to running server

---

## Page 3: CI Integration (copy/paste workflow)

### GitHub Actions Workflow
```yaml
# .github/workflows/deeprun.yml
name: Backend Generation
on: [push, pull_request]

jobs:
  generate-backend:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Generate Backend
      run: |
        curl -X POST "${{ secrets.DEEPRUN_API_URL }}/api/projects/bootstrap/backend" \
          -H "Authorization: Bearer ${{ secrets.DEEPRUN_TOKEN }}" \
          -H "Content-Type: application/json" \
          -d '{
            "workspaceId": "${{ secrets.DEEPRUN_WORKSPACE_ID }}",
            "goal": "Build production-ready API backend with auth",
            "name": "ci-generated-backend"
          }' > result.json
          
    - name: Get Governance Decision
      run: |
        PROJECT_ID=$(jq -r '.project.id' result.json)
        RUN_ID=$(jq -r '.run.id' result.json)
        
        curl "${{ secrets.DEEPRUN_API_URL }}/api/projects/$PROJECT_ID/runs/$RUN_ID/decision" \
          -H "Authorization: Bearer ${{ secrets.DEEPRUN_TOKEN }}" > decision.json
          
        # Gate on governance decision
        PASS=$(jq -r '.pass' decision.json)
        if [ "$PASS" != "true" ]; then
          echo "❌ Backend generation failed governance"
          exit 1
        fi
        echo "✅ Backend generation passed governance"
        
    - name: Upload Artifacts
      uses: actions/upload-artifact@v4
      with:
        name: generated-backend
        path: |
          result.json
          decision.json
```

### Required Secrets
```bash
DEEPRUN_API_URL=https://your-deeprun-instance.com
DEEPRUN_TOKEN=your-api-token
DEEPRUN_WORKSPACE_ID=your-workspace-uuid
```

### Local CLI Integration
```bash
# Install CLI
npm install -g @deeprun/cli

# Configure
deeprun config set api-url https://your-instance.com
deeprun auth login --token your-token

# Generate backend
deeprun bootstrap "Build SaaS backend with auth" --output ./generated

# Check governance decision
deeprun decision --project-id <id> --run-id <id>
```

**Time**: < 30 minutes to working CI integration

---

## Page 4: Governance Decision Contract (JSON schema)

### Decision Response Format
```json
{
  "pass": true,
  "version": "1.0.0",
  "timestamp": "2024-01-01T00:00:00Z",
  "artifacts": [
    {
      "type": "code",
      "path": "/generated/project-123/run-456/src",
      "size": 15420,
      "checksum": "sha256:abc123..."
    },
    {
      "type": "trace",
      "path": "/traces/project-123/run-456.json", 
      "size": 2340,
      "checksum": "sha256:def456..."
    },
    {
      "type": "validation",
      "path": "/validation/project-123/run-456.json",
      "size": 890,
      "checksum": "sha256:ghi789..."
    }
  ],
  "summary": {
    "backend_generated": true,
    "tests_passing": true,
    "security_validated": true,
    "deployment_ready": true
  },
  "metadata": {
    "execution_time_ms": 45000,
    "steps_completed": 12,
    "corrections_applied": 2
  }
}
```

### Decision Logic
- **`pass: true`**: All governance criteria met, safe to deploy
- **`pass: false`**: Failed governance, do not deploy

### Summary Fields
- **`backend_generated`**: Code generation completed successfully
- **`tests_passing`**: All generated tests pass
- **`security_validated`**: Security checks passed
- **`deployment_ready`**: Ready for production deployment

### API Endpoints
```bash
# Get decision for run
GET /api/projects/{projectId}/runs/{runId}/decision

# Upload artifacts
POST /api/projects/{projectId}/runs/{runId}/artifacts
```

### Integration Pattern
```bash
# 1. Generate backend
POST /api/projects/bootstrap/backend

# 2. Get governance decision  
GET /api/projects/{projectId}/runs/{runId}/decision

# 3. Gate deployment on decision.pass === true
if [ "$(jq -r '.pass' decision.json)" = "true" ]; then
  echo "✅ Deploy approved"
else
  echo "❌ Deploy blocked"
  exit 1
fi
```

---

## Page 5: Troubleshooting (5 common issues)

### 1. Installation Failed
**Symptom**: `install.sh` exits with error
```bash
# Check prerequisites
node --version  # Should be 20+
psql --version  # Should be 12+

# Manual database setup
sudo -u postgres createdb deeprun
sudo -u postgres psql -c "CREATE USER deeprun WITH PASSWORD 'deeprun';"

# Check logs
tail -f ~/deeprun/deeprun.log
```

### 2. Server Won't Start
**Symptom**: `npm start` fails or exits immediately
```bash
# Check configuration
cd ~/deeprun && npm run check:config

# Common fixes
export JWT_SECRET=$(openssl rand -hex 32)
export DATABASE_URL="postgresql://deeprun:deeprun@localhost:5432/deeprun"
export CORS_ALLOWED_ORIGINS="http://localhost:3000"

# Test database connection
psql $DATABASE_URL -c "SELECT 1;"
```

### 3. API Returns 500 Errors
**Symptom**: `/api/health` returns 500 or connection refused
```bash
# Check server status
curl -v http://localhost:3000/api/health

# Check database connection
curl http://localhost:3000/api/ready

# View server logs
tail -f ~/deeprun/deeprun.log

# Restart server
cd ~/deeprun && npm start
```

### 4. Generation Fails
**Symptom**: Backend generation returns errors or incomplete results
```bash
# Check API keys
echo $OPENAI_API_KEY  # Should start with sk-
echo $ANTHROPIC_API_KEY  # Should start with sk-ant-

# Test provider connection
curl -X POST http://localhost:3000/api/projects/bootstrap/backend \
  -H "Content-Type: application/json" \
  -d '{"goal":"test","workspaceId":"your-workspace-id"}'

# Check generation logs
curl http://localhost:3000/api/projects/{projectId}/agent/runs/{runId}
```

### 5. Docker Container Issues
**Symptom**: `docker-compose up` fails or containers exit
```bash
# Check Docker status
docker --version && docker-compose --version

# View container logs
docker-compose logs deeprun
docker-compose logs postgres

# Restart services
docker-compose down && docker-compose up -d

# Check health
docker-compose ps
curl http://localhost:3000/api/health
```

### Getting Help
- **Logs**: Always check `~/deeprun/deeprun.log` first
- **Health**: Use `/api/health` and `/api/ready` endpoints
- **Issues**: https://github.com/deeprun/deeprun/issues
- **Docs**: https://docs.deeprun.dev

**Support Response Time**: < 24 hours for installation issues