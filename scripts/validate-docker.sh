#!/bin/bash
set -euo pipefail

# Docker Installation Validation Script
# Tests < 2 minute docker run to running server goal

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    echo "[ERROR] $*" >&2
    exit 1
}

cleanup() {
    log "Cleaning up test containers..."
    docker-compose -f docker-compose.test.yml down -v --remove-orphans 2>/dev/null || true
    docker rmi deeprun-test 2>/dev/null || true
}

trap cleanup EXIT

main() {
    log "Starting Docker validation test..."
    
    # Check Docker is available
    if ! command -v docker >/dev/null 2>&1; then
        error "Docker is not installed"
    fi
    
    if ! command -v docker-compose >/dev/null 2>&1; then
        error "Docker Compose is not installed"
    fi
    
    # Create test compose file
    cat > docker-compose.test.yml << EOF
version: '3.8'
services:
  deeprun-test:
    build: .
    ports:
      - "3001:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://deeprun:testpass@postgres-test:5432/deeprun
      - JWT_SECRET=test_jwt_secret_minimum_32_characters_long
      - CORS_ALLOWED_ORIGINS=http://localhost:3001
      - DEEPRUN_DEFAULT_PROVIDER=mock
    depends_on:
      postgres-test:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s

  postgres-test:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=deeprun
      - POSTGRES_USER=deeprun
      - POSTGRES_PASSWORD=testpass
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U deeprun -d deeprun"]
      interval: 5s
      timeout: 3s
      retries: 5
EOF
    
    log "Building Docker image..."
    start_time=$(date +%s)
    
    # Build and start services
    docker-compose -f docker-compose.test.yml up -d --build
    
    # Wait for health check
    log "Waiting for services to be healthy..."
    max_attempts=60
    attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if docker-compose -f docker-compose.test.yml ps | grep -q "healthy"; then
            if curl -f "http://localhost:3001/api/health" >/dev/null 2>&1; then
                end_time=$(date +%s)
                duration=$((end_time - start_time))
                
                log "✅ Docker validation successful!"
                log "✅ Time to running server: ${duration}s"
                
                if [[ $duration -le 120 ]]; then
                    log "✅ Met < 2 minute goal!"
                else
                    log "⚠️  Exceeded 2 minute goal (${duration}s)"
                fi
                
                # Test API endpoints
                log "Testing API endpoints..."
                curl -f "http://localhost:3001/api/health" | grep -q '"ok":true' || error "Health check failed"
                curl -f "http://localhost:3001/api/ready" | grep -q '"ok":true' || error "Ready check failed"
                
                log "✅ All API endpoints working"
                return 0
            fi
        fi
        
        log "Attempt $attempt/$max_attempts - waiting for services..."
        sleep 2
        ((attempt++))
    done
    
    error "Docker validation failed - services did not become healthy"
}

main "$@"