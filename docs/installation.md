# deeprun Installation Guide

Get deeprun running in < 10 minutes on a fresh machine.

## Quick Install (Recommended)

### One-Line Install
```bash
curl -fsSL https://install.deeprun.dev | bash
```

Or with wget:
```bash
wget -qO- https://install.deeprun.dev | bash
```

This will:
1. Install Node.js 20, PostgreSQL, and Git (if missing)
2. Clone deeprun repository
3. Install dependencies and build
4. Set up PostgreSQL database
5. Create configuration file
6. Start the server
7. Run health checks

**Time: < 10 minutes on fresh Ubuntu/macOS**

### Custom Install Directory
```bash
INSTALL_DIR=/opt/deeprun curl -fsSL https://install.deeprun.dev | bash
```

### Custom Port
```bash
DEEPRUN_PORT=8080 curl -fsSL https://install.deeprun.dev | bash
```

## Docker Install (Production)

### Quick Start
```bash
# Clone repository
git clone https://github.com/deeprun/deeprun.git
cd deeprun

# Copy environment template
cp .env.example .env

# Edit configuration (add your API keys)
nano .env

# Start with Docker Compose
docker-compose up -d
```

**Time: < 2 minutes to running server**

### Docker Run
```bash
docker run -d \
  --name deeprun \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/deeprun \
  -e JWT_SECRET=your_jwt_secret_here \
  -e CORS_ALLOWED_ORIGINS=http://localhost:3000 \
  -e OPENAI_API_KEY=your_openai_key \
  ghcr.io/deeprun/deeprun:latest
```

## Manual Installation

### Prerequisites
- Node.js 20+
- PostgreSQL 12+
- Git

### Ubuntu/Debian
```bash
# Install prerequisites
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql postgresql-contrib git

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database
sudo -u postgres createdb deeprun
sudo -u postgres psql -c "CREATE USER deeprun WITH PASSWORD 'deeprun';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE deeprun TO deeprun;"
```

### macOS
```bash
# Install prerequisites
brew install node@20 postgresql@15 git

# Start PostgreSQL
brew services start postgresql@15

# Create database
createdb deeprun
psql -d postgres -c "CREATE USER deeprun WITH PASSWORD 'deeprun';"
psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE deeprun TO deeprun;"
```

### Install deeprun
```bash
# Clone repository
git clone https://github.com/deeprun/deeprun.git
cd deeprun

# Install dependencies
npm ci

# Build application
npm run build

# Copy configuration
cp .env.example .env

# Edit configuration (required)
nano .env

# Start server
npm start
```

## Configuration

### Required Environment Variables
```bash
# Database connection
DATABASE_URL=postgresql://deeprun:deeprun@localhost:5432/deeprun

# Security (generate with: openssl rand -hex 32)
JWT_SECRET=your_jwt_secret_minimum_32_characters

# CORS origins (no wildcards allowed)
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# At least one AI provider
OPENAI_API_KEY=sk-your-openai-key
# OR
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
```

### Generate JWT Secret
```bash
openssl rand -hex 32
```

### Test Installation
```bash
# Health check
curl http://localhost:3000/api/health

# Expected response:
# {"ok":true,"state":"ready","draining":false,"uptimeSec":123,"now":"2024-01-01T00:00:00.000Z"}
```

## System Service (Linux)

The installer automatically creates a systemd service:

```bash
# Start service
sudo systemctl start deeprun

# Enable auto-start
sudo systemctl enable deeprun

# Check status
sudo systemctl status deeprun

# View logs
sudo journalctl -u deeprun -f
```

## Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql postgresql://deeprun:deeprun@localhost:5432/deeprun -c "SELECT 1;"
```

**Port Already in Use**
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>

# Or use different port
PORT=8080 npm start
```

**Permission Denied**
```bash
# Fix ownership
sudo chown -R $USER:$USER ~/deeprun

# Fix permissions
chmod +x ~/deeprun/install.sh
```

**Missing API Keys**
- Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env
- Restart server: `npm start`

### Health Checks

```bash
# API health
curl http://localhost:3000/api/health

# Database health
curl http://localhost:3000/api/ready

# Metrics (if enabled)
curl http://localhost:3000/metrics
```

### Log Files

```bash
# Application logs
tail -f ~/deeprun/deeprun.log

# System service logs
sudo journalctl -u deeprun -f

# Docker logs
docker logs deeprun -f
```

## Next Steps

1. **Configure AI Providers**: Add your OpenAI or Anthropic API keys
2. **Create Account**: Visit http://localhost:3000 and register
3. **Generate Backend**: Try the bootstrap API or web interface
4. **Set up CI**: See [CI Integration Guide](../examples/ci-integration/README.md)

## Support

- **Documentation**: https://docs.deeprun.dev
- **Issues**: https://github.com/deeprun/deeprun/issues
- **Discussions**: https://github.com/deeprun/deeprun/discussions

## Security Notes

- Change default database password in production
- Use strong JWT_SECRET (32+ characters)
- Configure CORS_ALLOWED_ORIGINS for your domain
- Enable HTTPS in production (set COOKIE_SECURE=true)
- Restrict database access to localhost only