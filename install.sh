#!/bin/bash
set -euo pipefail

# deeprun Installation Script
# Usage: curl -fsSL https://install.deeprun.dev | bash
# Or: wget -qO- https://install.deeprun.dev | bash

DEEPRUN_VERSION="${DEEPRUN_VERSION:-latest}"
DEEPRUN_PORT="${DEEPRUN_PORT:-3000}"
DEEPRUN_DB_NAME="${DEEPRUN_DB_NAME:-deeprun}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/deeprun}"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    echo "[ERROR] $*" >&2
    exit 1
}

check_requirements() {
    log "Checking system requirements..."
    
    # Check OS
    if [[ "$OSTYPE" != "linux-gnu"* ]] && [[ "$OSTYPE" != "darwin"* ]]; then
        error "Unsupported OS: $OSTYPE. Linux and macOS are supported."
    fi
    
    # Check Node.js
    if ! command -v node >/dev/null 2>&1; then
        log "Installing Node.js 20..."
        if command -v apt-get >/dev/null 2>&1; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v brew >/dev/null 2>&1; then
            brew install node@20
        else
            error "Please install Node.js 20+ manually"
        fi
    fi
    
    # Check PostgreSQL
    if ! command -v psql >/dev/null 2>&1; then
        log "Installing PostgreSQL..."
        if command -v apt-get >/dev/null 2>&1; then
            sudo apt-get update
            sudo apt-get install -y postgresql postgresql-contrib
            sudo systemctl start postgresql
            sudo systemctl enable postgresql
        elif command -v brew >/dev/null 2>&1; then
            brew install postgresql@15
            brew services start postgresql@15
        else
            error "Please install PostgreSQL manually"
        fi
    fi
    
    # Check Git
    if ! command -v git >/dev/null 2>&1; then
        log "Installing Git..."
        if command -v apt-get >/dev/null 2>&1; then
            sudo apt-get install -y git
        elif command -v brew >/dev/null 2>&1; then
            brew install git
        else
            error "Please install Git manually"
        fi
    fi
}

setup_database() {
    log "Setting up PostgreSQL database..."
    
    # Create database and user
    if command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
        sudo -u postgres createdb "$DEEPRUN_DB_NAME" 2>/dev/null || true
        sudo -u postgres psql -c "CREATE USER deeprun WITH PASSWORD 'deeprun';" 2>/dev/null || true
        sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DEEPRUN_DB_NAME TO deeprun;" 2>/dev/null || true
    else
        createdb "$DEEPRUN_DB_NAME" 2>/dev/null || true
        psql -d postgres -c "CREATE USER deeprun WITH PASSWORD 'deeprun';" 2>/dev/null || true
        psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DEEPRUN_DB_NAME TO deeprun;" 2>/dev/null || true
    fi
    
    export DATABASE_URL="postgresql://deeprun:deeprun@localhost:5432/$DEEPRUN_DB_NAME"
}

install_deeprun() {
    log "Installing deeprun to $INSTALL_DIR..."
    
    # Clone repository
    if [[ -d "$INSTALL_DIR" ]]; then
        log "Directory exists, updating..."
        cd "$INSTALL_DIR"
        git pull origin main
    else
        git clone https://github.com/deeprun/deeprun.git "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    # Install dependencies
    log "Installing dependencies..."
    npm ci
    
    # Build application
    log "Building application..."
    npm run build
}

create_config() {
    log "Creating configuration..."
    
    cat > "$INSTALL_DIR/.env" << EOF
# deeprun Configuration
PORT=$DEEPRUN_PORT
DATABASE_URL=postgresql://deeprun:deeprun@localhost:5432/$DEEPRUN_DB_NAME

# Security
JWT_SECRET=$(openssl rand -hex 32)
CORS_ALLOWED_ORIGINS=http://localhost:$DEEPRUN_PORT,http://127.0.0.1:$DEEPRUN_PORT

# Providers (configure at least one)
# OPENAI_API_KEY=your_openai_key_here
# ANTHROPIC_API_KEY=your_anthropic_key_here

# Optional: Default provider
# DEEPRUN_DEFAULT_PROVIDER=openai

# Optional: Metrics
METRICS_ENABLED=true
# METRICS_AUTH_TOKEN=$(openssl rand -hex 16)
EOF
    
    log "Configuration created at $INSTALL_DIR/.env"
    log "Please edit .env to add your API keys"
}

start_server() {
    log "Starting deeprun server..."
    cd "$INSTALL_DIR"
    
    # Initialize database
    npm run build
    
    # Start server in background
    nohup npm start > deeprun.log 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID > deeprun.pid
    
    log "Server starting with PID $SERVER_PID"
    log "Logs: tail -f $INSTALL_DIR/deeprun.log"
}

health_check() {
    log "Performing health check..."
    
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f "http://localhost:$DEEPRUN_PORT/api/health" >/dev/null 2>&1; then
            log "✅ deeprun is running at http://localhost:$DEEPRUN_PORT"
            log "✅ API health check passed"
            return 0
        fi
        
        log "Attempt $attempt/$max_attempts - waiting for server..."
        sleep 2
        ((attempt++))
    done
    
    error "Health check failed after $max_attempts attempts"
}

create_systemd_service() {
    if command -v systemctl >/dev/null 2>&1 && [[ -w /etc/systemd/system ]]; then
        log "Creating systemd service..."
        
        sudo tee /etc/systemd/system/deeprun.service > /dev/null << EOF
[Unit]
Description=deeprun AI Backend Generator
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
        
        sudo systemctl daemon-reload
        sudo systemctl enable deeprun
        log "Systemd service created. Use: sudo systemctl start deeprun"
    fi
}

main() {
    log "Starting deeprun installation..."
    log "Version: $DEEPRUN_VERSION"
    log "Install directory: $INSTALL_DIR"
    log "Port: $DEEPRUN_PORT"
    
    check_requirements
    setup_database
    install_deeprun
    create_config
    start_server
    health_check
    create_systemd_service
    
    log ""
    log "🎉 deeprun installation complete!"
    log ""
    log "Next steps:"
    log "1. Edit $INSTALL_DIR/.env to add your API keys"
    log "2. Restart: cd $INSTALL_DIR && npm start"
    log "3. Visit: http://localhost:$DEEPRUN_PORT"
    log ""
    log "Documentation: https://docs.deeprun.dev"
    log "Support: https://github.com/deeprun/deeprun/issues"
}

main "$@"