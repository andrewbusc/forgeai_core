# External Tester Handoff Guide

**Target**: 2-3 platform engineers (not AI engineers)  
**Goal**: Install → Integrate → Run → Report issues  
**Success**: First successful run without support

## Tester Profile

### Ideal Candidates
- **Platform Engineers** with backend deployment experience
- **DevOps Engineers** familiar with CI/CD pipelines
- **Infrastructure Engineers** who manage containerized services
- **NOT AI Engineers** - we want to test real-world adoption

### Required Skills
- Basic Docker and PostgreSQL knowledge
- GitHub Actions or similar CI/CD experience
- Command line comfort (bash, curl, npm)
- 2-4 hours available for testing

## Testing Protocol

### Phase 1: Installation (Target: < 10 minutes)

**Task**: Get deeprun running from scratch

```bash
# Start timer
start_time=$(date +%s)

# One-line install
curl -fsSL https://install.deeprun.dev | bash

# Add API key (use provided test key)
echo "OPENAI_API_KEY=sk-test-key-provided" >> ~/deeprun/.env

# Restart and verify
cd ~/deeprun && npm start &
sleep 10
curl http://localhost:3000/api/health

# Record time
end_time=$(date +%s)
echo "Installation time: $((end_time - start_time)) seconds"
```

**Success Criteria**:
- [ ] Installation completes without errors
- [ ] Server starts and health check passes
- [ ] Time < 10 minutes
- [ ] No manual intervention required

**Report Issues**:
- Installation failures or unclear error messages
- Missing dependencies or setup steps
- Time exceeded 10 minutes
- Any step requiring external documentation

### Phase 2: CI Integration (Target: < 30 minutes)

**Task**: Set up GitHub Actions workflow

```bash
# Create test repository
gh repo create deeprun-test --private
cd deeprun-test

# Copy workflow from operator guide
mkdir -p .github/workflows
# Copy exact workflow from docs/operator-guide.md Page 3

# Configure secrets (use provided test values)
gh secret set DEEPRUN_API_URL --body "http://your-test-instance.com"
gh secret set DEEPRUN_TOKEN --body "test-token-provided"
gh secret set DEEPRUN_WORKSPACE_ID --body "test-workspace-id"

# Trigger workflow
git add . && git commit -m "Add deeprun workflow"
git push origin main
```

**Success Criteria**:
- [ ] Workflow runs without errors
- [ ] Backend generation completes
- [ ] Governance decision returns `pass: true`
- [ ] Artifacts uploaded successfully
- [ ] Time < 30 minutes total

**Report Issues**:
- Workflow syntax errors or failures
- API authentication problems
- Governance decision failures
- Missing documentation or unclear steps

### Phase 3: Local Generation (Target: < 5 minutes)

**Task**: Generate backend locally

```bash
# Register account
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com", 
    "password": "TestPassword123!"
  }'

# Extract token and workspace ID from response
# Use operator guide examples

# Generate backend
curl -X POST http://localhost:3000/api/projects/bootstrap/backend \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "$WORKSPACE_ID",
    "goal": "Build a simple task management API with user authentication",
    "name": "test-backend"
  }'

# Check governance decision
# Follow operator guide Page 4 examples
```

**Success Criteria**:
- [ ] Account registration works
- [ ] Backend generation completes
- [ ] Generated code is valid TypeScript
- [ ] Governance decision shows all criteria passed
- [ ] Time < 5 minutes

**Report Issues**:
- API errors or unclear responses
- Generated code quality issues
- Governance decision failures
- Performance problems

## Measurement Framework

### Time Tracking
```bash
# Provided timing script
./scripts/measure-tester-time.sh

# Tracks:
# - Installation start to health check
# - CI setup start to first successful run
# - Local generation start to governance pass
# - Total time to first success
```

### Issue Classification

#### **Blocker Issues** (Must fix before v1.0.0)
- Installation fails on clean Ubuntu/macOS
- Required dependencies not auto-installed
- Server won't start with default configuration
- CI workflow has syntax errors
- API returns 500 errors with valid requests
- Generated code doesn't compile
- Documentation missing critical steps

#### **Polish Issues** (Can defer to v1.1.0)
- Installation takes > 10 minutes but works
- Error messages could be clearer
- Documentation could be more detailed
- Performance slower than expected
- Minor UI/UX improvements

#### **Enhancement Requests** (Future versions)
- Additional features or capabilities
- Alternative installation methods
- Extended documentation
- Performance optimizations

### Success Metrics

#### **Primary Success**: Time to First Run
- **Target**: < 45 minutes total (10 + 30 + 5)
- **Measure**: From fresh machine to successful backend generation
- **Blocker**: > 60 minutes or requires support

#### **Secondary Success**: Self-Service Rate
- **Target**: 100% of testers complete without asking questions
- **Measure**: Zero support requests during testing
- **Blocker**: Any tester requires human assistance

#### **Quality Success**: Generated Backend Quality
- **Target**: Generated code compiles and runs
- **Measure**: Governance decision passes all criteria
- **Blocker**: Generated code has compilation errors

## Tester Feedback Template

```markdown
## deeprun v1.0.0 External Testing Report

**Tester**: [Name/Company]
**Date**: [Date]
**Environment**: [Ubuntu 22.04 / macOS 13 / etc]

### Phase 1: Installation
- **Time**: ___ minutes
- **Success**: [ ] Yes [ ] No
- **Issues**: 
- **Blockers**: 

### Phase 2: CI Integration  
- **Time**: ___ minutes
- **Success**: [ ] Yes [ ] No
- **Issues**:
- **Blockers**:

### Phase 3: Local Generation
- **Time**: ___ minutes  
- **Success**: [ ] Yes [ ] No
- **Issues**:
- **Blockers**:

### Overall Experience
- **Total Time**: ___ minutes
- **Would recommend**: [ ] Yes [ ] No
- **Production ready**: [ ] Yes [ ] No
- **Comments**:

### Generated Backend Quality
- **Compiles**: [ ] Yes [ ] No
- **Runs**: [ ] Yes [ ] No  
- **Tests pass**: [ ] Yes [ ] No
- **Governance pass**: [ ] Yes [ ] No
- **Comments**:
```

## Iteration Process

### Daily Standups During Testing
- Review tester feedback from previous day
- Identify blocker vs polish issues
- Prioritize fixes by impact on v1.0.0 readiness
- Update documentation based on common questions

### Fix Prioritization
1. **P0 Blockers**: Installation/CI failures, API errors
2. **P1 Polish**: Time goals exceeded, unclear docs
3. **P2 Enhancement**: Nice-to-have improvements

### Documentation Updates
- Update operator guide based on tester feedback
- Add FAQ section for common issues
- Improve error messages and troubleshooting
- Clarify configuration examples

## Success Criteria for V1.0.0 Release

### Must Have (Blockers)
- [ ] All 3 testers complete installation successfully
- [ ] All 3 testers complete CI integration successfully  
- [ ] All 3 testers generate working backend locally
- [ ] Zero support requests during testing
- [ ] Average time < 45 minutes total
- [ ] Generated backends pass governance criteria

### Should Have (Polish)
- [ ] Average installation time < 10 minutes
- [ ] Average CI integration time < 30 minutes
- [ ] Average local generation time < 5 minutes
- [ ] Positive feedback on documentation quality
- [ ] Testers would recommend to colleagues

### Nice to Have (Future)
- [ ] Testers request additional features
- [ ] Performance exceeds expectations
- [ ] Documentation praised as exceptional
- [ ] Testers become advocates/contributors

## Post-Testing Actions

### If All Tests Pass
1. Tag v1.0.0 release
2. Publish container image to ghcr.io
3. Announce "Production-ready deterministic AI orchestration kernel"
4. Begin external marketing and adoption

### If Tests Reveal Blockers
1. Fix all P0 blocker issues
2. Update documentation
3. Re-test with same or new testers
4. Repeat until all success criteria met
5. Then proceed to v1.0.0 release

The external tester handoff is the final gate before v1.0.0 - **no release until all testers succeed without support**.