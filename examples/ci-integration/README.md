# CI Integration Example

Clean external integration with no internal vocabulary leakage.

## GitHub Actions Workflow

```yaml
name: DeepRun Backend Generation

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  generate-backend:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        
    - name: Install DeepRun
      run: |
        npm install -g @deeprun/cli
        
    - name: Configure DeepRun
      run: |
        deeprun config set api-url ${{ secrets.DEEPRUN_API_URL }}
        deeprun auth login --token ${{ secrets.DEEPRUN_TOKEN }}
        
    - name: Generate Backend
      id: generate
      run: |
        deeprun generate \
          --goal "Build production-ready API backend" \
          --workspace-id ${{ secrets.DEEPRUN_WORKSPACE_ID }} \
          --output ./generated \
          --format json > result.json
          
    - name: Get Decision
      id: decision
      run: |
        PROJECT_ID=$(jq -r '.project.id' result.json)
        RUN_ID=$(jq -r '.run.id' result.json)
        
        deeprun decision \
          --project-id $PROJECT_ID \
          --run-id $RUN_ID \
          --format json > decision.json
          
        echo "decision=$(cat decision.json)" >> $GITHUB_OUTPUT
        
    - name: Check Decision
      run: |
        PASS=$(jq -r '.pass' decision.json)
        if [ "$PASS" != "true" ]; then
          echo "❌ Backend generation failed governance decision"
          jq '.summary' decision.json
          exit 1
        fi
        echo "✅ Backend generation passed governance decision"
        
    - name: Upload Artifacts
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: deeprun-artifacts
        path: |
          ./generated/
          result.json
          decision.json
          
    - name: Deploy to Staging
      if: success() && github.ref == 'refs/heads/main'
      run: |
        PROJECT_ID=$(jq -r '.project.id' result.json)
        RUN_ID=$(jq -r '.run.id' result.json)
        
        deeprun deploy \
          --project-id $PROJECT_ID \
          --run-id $RUN_ID \
          --environment staging
```

## Key Features

### Clean External Interface
- No "kernel", "graph revision", "policy descriptor" exposed
- Simple commands: `generate`, `decision`, `deploy`
- JSON output format for CI parsing

### Governance Decision Contract
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

### Integration Path
1. **Install**: `npm install -g @deeprun/cli`
2. **Configure**: Set API URL and auth token
3. **Generate**: Run backend generation with goal
4. **Gate Decision**: Get pass/fail governance decision
5. **Retrieve Artifacts**: Download generated code and traces

### Time to Integration
- **Install**: < 2 minutes
- **Configure**: < 3 minutes  
- **First Run**: < 5 minutes
- **Total**: < 10 minutes to working CI integration

### No Internal Vocabulary
- ❌ "kernel execution"
- ❌ "graph revision diff"
- ❌ "policy descriptor hash"
- ❌ "correction telemetry"
- ❌ "lifecycle transitions"

- ✅ "backend generation"
- ✅ "governance decision"
- ✅ "artifacts"
- ✅ "validation"
- ✅ "deployment ready"