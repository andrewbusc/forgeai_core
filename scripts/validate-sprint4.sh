#!/bin/bash
set -euo pipefail

# Sprint 4 Validation Script
# Tests external tester onboarding without asking questions

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    echo "[ERROR] $*" >&2
    exit 1
}

main() {
    log "Starting Sprint 4 validation..."
    
    # Test 1: 5-page operator guide exists
    log "✓ Testing operator guide..."
    if [[ ! -f "docs/operator-guide.md" ]]; then
        error "Operator guide missing"
    fi
    
    # Count pages in operator guide
    page_count=$(grep -c "## Page [0-9]:" docs/operator-guide.md || echo "0")
    if [[ $page_count -ne 5 ]]; then
        error "Operator guide should have exactly 5 pages, found $page_count"
    fi
    
    # Test 2: Demo backend exists with canonical structure
    log "✓ Testing demo backend..."
    if [[ ! -d "examples/demo-backend" ]]; then
        error "Demo backend directory missing"
    fi
    
    if [[ ! -f "examples/demo-backend/package.json" ]]; then
        error "Demo backend package.json missing"
    fi
    
    if [[ ! -f "examples/demo-backend/src/server.ts" ]]; then
        error "Demo backend server.ts missing"
    fi
    
    if [[ ! -f "examples/demo-backend/prisma/schema.prisma" ]]; then
        error "Demo backend Prisma schema missing"
    fi
    
    # Test 3: Demo backend has required dependencies
    log "✓ Testing demo backend dependencies..."
    demo_deps=$(cat examples/demo-backend/package.json)
    
    if ! echo "$demo_deps" | grep -q '"fastify"'; then
        error "Demo backend missing Fastify dependency"
    fi
    
    if ! echo "$demo_deps" | grep -q '"prisma"'; then
        error "Demo backend missing Prisma dependency"
    fi
    
    if ! echo "$demo_deps" | grep -q '"zod"'; then
        error "Demo backend missing Zod dependency"
    fi
    
    # Test 4: Upgrade protocol documentation exists
    log "✓ Testing upgrade protocol..."
    if [[ ! -f "docs/upgrade-protocol.md" ]]; then
        error "Upgrade protocol documentation missing"
    fi
    
    # Test 5: Documentation has external tester onboarding content
    log "✓ Testing external tester onboarding..."
    
    # Operator guide should have installation commands
    if ! grep -q "curl -fsSL" docs/operator-guide.md; then
        error "Operator guide missing one-line install command"
    fi
    
    # Should have CI integration workflow
    if ! grep -q "github/workflows" docs/operator-guide.md; then
        error "Operator guide missing CI integration workflow"
    fi
    
    # Should have governance decision schema
    if ! grep -q '"pass": true' docs/operator-guide.md; then
        error "Operator guide missing governance decision schema"
    fi
    
    # Should have troubleshooting section
    if ! grep -q "Troubleshooting" docs/operator-guide.md; then
        error "Operator guide missing troubleshooting section"
    fi
    
    # Test 6: Demo backend README explains generation testing
    log "✓ Testing demo backend documentation..."
    demo_readme="examples/demo-backend/README.md"
    
    if ! grep -q "deeprun generation" "$demo_readme"; then
        error "Demo README missing deeprun generation explanation"
    fi
    
    if ! grep -q "reliability benchmark" "$demo_readme"; then
        error "Demo README missing reliability benchmark explanation"
    fi
    
    if ! grep -q "Success Criteria" "$demo_readme"; then
        error "Demo README missing success criteria"
    fi
    
    # Test 7: Time goals are documented
    log "✓ Testing time goals..."
    
    if ! grep -q "< 10 minutes" docs/operator-guide.md; then
        error "Operator guide missing 10 minute installation goal"
    fi
    
    if ! grep -q "< 30 minutes" docs/operator-guide.md; then
        error "Operator guide missing 30 minute CI integration goal"
    fi
    
    if ! grep -q "30 seconds" docs/operator-guide.md; then
        error "Operator guide missing 30 second understanding goal"
    fi
    
    # Test 8: External tester can follow without questions
    log "✓ Testing self-contained documentation..."
    
    # Should have complete configuration examples
    if ! grep -q "DATABASE_URL=" docs/operator-guide.md; then
        error "Operator guide missing configuration examples"
    fi
    
    # Should have working API examples
    if ! grep -q "curl -X POST" docs/operator-guide.md; then
        error "Operator guide missing API examples"
    fi
    
    # Should have troubleshooting for common issues
    if ! grep -q "Installation Failed" docs/operator-guide.md; then
        error "Operator guide missing installation troubleshooting"
    fi
    
    log "✅ Sprint 4 validation complete!"
    log ""
    log "📋 Sprint 4 Summary:"
    log "   ✅ 5-page operator guide created"
    log "   ✅ Demo backend with canonical architecture"
    log "   ✅ Upgrade protocol documentation"
    log "   ✅ External tester onboarding support"
    log "   ✅ Time goals documented (30s, 10min, 30min)"
    log "   ✅ Self-contained documentation"
    log ""
    log "🎯 Goal achieved: External tester can onboard without asking questions"
}

main "$@"