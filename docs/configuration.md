# deeprun Configuration Reference

Complete reference for all configuration options.

## Environment Variables

### Required Configuration

#### Server
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `PORT` | Server port | `3000` | `8080` |
| `NODE_ENV` | Environment | `development` | `production` |

#### Database
| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ | `postgresql://user:pass@host:5432/db` |

#### Security
| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `JWT_SECRET` | JWT signing secret (32+ chars) | ✅ | `abc123...` (32+ chars) |
| `CORS_ALLOWED_ORIGINS` | Allowed CORS origins | ✅ | `http://localhost:3000,https://app.com` |

### AI Providers

At least one provider is required for generation:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `OPENAI_API_KEY` | OpenAI API key | One of | `sk-...` |
| `ANTHROPIC_API_KEY` | Anthropic API key | One of | `sk-ant-...` |
| `DEEPRUN_DEFAULT_PROVIDER` | Default provider | No | `openai`, `anthropic`, `mock` |

### Optional Configuration

#### Cookie Security
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `COOKIE_SECURE` | Require HTTPS for cookies | `false` | `true` |
| `COOKIE_SAMESITE` | SameSite cookie policy | `Lax` | `Strict`, `None` |
| `COOKIE_DOMAIN` | Cookie domain | None | `.yourdomain.com` |

#### Trust Proxy
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `TRUST_PROXY` | Trust proxy headers | `false` | `true`, `1`, `127.0.0.1` |

#### Rate Limiting
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `RATE_LIMIT_LOGIN_MAX` | Max login attempts | `8` | `10` |
| `RATE_LIMIT_LOGIN_WINDOW_SEC` | Login window (seconds) | `600` | `300` |
| `RATE_LIMIT_GENERATION_MAX` | Max generation requests | `30` | `50` |
| `RATE_LIMIT_GENERATION_WINDOW_SEC` | Generation window (seconds) | `300` | `600` |

#### Metrics
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `METRICS_ENABLED` | Enable Prometheus metrics | `false` | `true` |
| `METRICS_AUTH_TOKEN` | Metrics endpoint auth token | None | `secret123` |

#### Agent Configuration
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `AGENT_FS_MAX_FILES_PER_STEP` | Max files per step | `50` | `100` |
| `AGENT_FS_MAX_TOTAL_DIFF_BYTES` | Max diff size (bytes) | `1048576` | `2097152` |
| `AGENT_FS_MAX_FILE_BYTES` | Max file size (bytes) | `1572864` | `3145728` |
| `AGENT_LIGHT_VALIDATION_MODE` | Light validation mode | `warn` | `off`, `enforce` |
| `AGENT_HEAVY_VALIDATION_MODE` | Heavy validation mode | `warn` | `off`, `enforce` |
| `AGENT_CORRECTION_POLICY_MODE` | Correction policy mode | `warn` | `off`, `enforce` |

#### V1 Readiness
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `V1_DOCKER_BIN` | Docker binary path | `docker` | `/usr/bin/docker` |
| `V1_DOCKER_BUILD_TIMEOUT_MS` | Docker build timeout | `300000` | `600000` |
| `V1_DOCKER_BOOT_TIMEOUT_MS` | Docker boot timeout | `60000` | `120000` |

#### Deployment
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DEPLOY_DOCKER_BIN` | Docker binary for deployment | `docker` | `/usr/bin/docker` |
| `DEPLOY_REGISTRY` | Container registry | None | `ghcr.io/yourorg` |
| `DEPLOY_BASE_DOMAIN` | Base domain for deployments | `deeprun.app` | `yourdomain.com` |
| `DEPLOY_PUBLIC_URL_TEMPLATE` | URL template | None | `https://{{subdomain}}.{{baseDomain}}` |
| `DEPLOY_DOCKER_NETWORK` | Docker network | None | `deeprun-network` |
| `DEPLOY_CONTAINER_PORT` | Default container port | `3000` | `8080` |
| `DEPLOY_STOP_PREVIOUS` | Stop previous deployments | `true` | `false` |

## Configuration Examples

### Development
```bash
# .env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://deeprun:deeprun@localhost:5432/deeprun
JWT_SECRET=dev_secret_minimum_32_characters_long
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
OPENAI_API_KEY=sk-your-dev-key
METRICS_ENABLED=true
```

### Production
```bash
# .env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://deeprun:secure_password@db.internal:5432/deeprun
JWT_SECRET=production_secret_generated_with_openssl_rand
CORS_ALLOWED_ORIGINS=https://app.yourdomain.com,https://yourdomain.com
OPENAI_API_KEY=sk-your-production-key
ANTHROPIC_API_KEY=sk-ant-your-production-key
DEEPRUN_DEFAULT_PROVIDER=openai

# Security
COOKIE_SECURE=true
COOKIE_SAMESITE=Strict
COOKIE_DOMAIN=.yourdomain.com
TRUST_PROXY=true

# Metrics
METRICS_ENABLED=true
METRICS_AUTH_TOKEN=secure_metrics_token

# Deployment
DEPLOY_REGISTRY=ghcr.io/yourorg
DEPLOY_BASE_DOMAIN=yourdomain.com
DEPLOY_PUBLIC_URL_TEMPLATE=https://{{subdomain}}.{{baseDomain}}
```

### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'
services:
  deeprun:
    image: ghcr.io/deeprun/deeprun:latest
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://deeprun:${POSTGRES_PASSWORD}@postgres:5432/deeprun
      - JWT_SECRET=${JWT_SECRET}
      - CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - COOKIE_SECURE=true
      - TRUST_PROXY=true
      - METRICS_ENABLED=true
```

## Validation

deeprun validates all configuration on startup and fails fast with clear error messages:

```bash
❌ Environment configuration validation failed:
   DATABASE_URL: DATABASE_URL must be a valid PostgreSQL connection string
   JWT_SECRET: JWT_SECRET must be at least 32 characters
   CORS_ALLOWED_ORIGINS: CORS_ALLOWED_ORIGINS must be set to explicit origins

Please check your environment variables and try again.
See docs/configuration.md for details.
```

## Security Best Practices

### JWT Secret
```bash
# Generate secure JWT secret
openssl rand -hex 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### CORS Configuration
```bash
# ✅ Good - Explicit origins
CORS_ALLOWED_ORIGINS=https://app.yourdomain.com,https://yourdomain.com

# ❌ Bad - Wildcard (rejected)
CORS_ALLOWED_ORIGINS=*

# ❌ Bad - HTTP in production
CORS_ALLOWED_ORIGINS=http://yourdomain.com
```

### Database Security
```bash
# ✅ Good - Restricted access
DATABASE_URL=postgresql://deeprun:secure_password@localhost:5432/deeprun

# ❌ Bad - Default password
DATABASE_URL=postgresql://deeprun:deeprun@0.0.0.0:5432/deeprun
```

### Cookie Security
```bash
# Production settings
COOKIE_SECURE=true
COOKIE_SAMESITE=Strict
COOKIE_DOMAIN=.yourdomain.com

# Note: COOKIE_SAMESITE=None requires COOKIE_SECURE=true
```

## Environment-Specific Configs

### Development
- `NODE_ENV=development`
- `COOKIE_SECURE=false` (for localhost)
- `METRICS_ENABLED=true` (for debugging)
- Relaxed validation modes

### Production
- `NODE_ENV=production`
- `COOKIE_SECURE=true`
- `TRUST_PROXY=true` (behind load balancer)
- Strict validation modes
- Metrics with authentication

### Testing
- `NODE_ENV=test`
- `TEST_DATABASE_URL` (separate test database)
- Mock providers for CI

## Configuration Loading Order

1. Environment variables
2. `.env` file (if exists)
3. Default values
4. Validation and transformation
5. Fail fast on errors

## Troubleshooting

### Common Configuration Errors

**Invalid DATABASE_URL**
```bash
# Error: DATABASE_URL must be a valid PostgreSQL connection string
# Fix: Check connection string format
DATABASE_URL=postgresql://user:password@host:port/database
```

**JWT Secret Too Short**
```bash
# Error: JWT_SECRET must be at least 32 characters
# Fix: Generate longer secret
JWT_SECRET=$(openssl rand -hex 32)
```

**CORS Wildcard**
```bash
# Error: CORS_ALLOWED_ORIGINS cannot include "*"
# Fix: Use explicit origins
CORS_ALLOWED_ORIGINS=https://yourdomain.com
```

**Missing AI Provider**
```bash
# Warning: No AI provider API keys configured
# Fix: Add at least one provider
OPENAI_API_KEY=sk-your-key
```

### Configuration Validation
```bash
# Test configuration without starting server
npm run check:config

# Or check specific environment
NODE_ENV=production npm run check:config
```

## Advanced Configuration

### Custom Provider Configuration
```bash
# Multiple providers with fallback
OPENAI_API_KEY=sk-primary-key
ANTHROPIC_API_KEY=sk-backup-key
DEEPRUN_DEFAULT_PROVIDER=openai
```

### Load Balancer Configuration
```bash
# Behind nginx/haproxy
TRUST_PROXY=true
COOKIE_SECURE=true
COOKIE_SAMESITE=Strict
```

### High-Volume Configuration
```bash
# Increased limits for high-volume usage
RATE_LIMIT_GENERATION_MAX=100
RATE_LIMIT_GENERATION_WINDOW_SEC=60
AGENT_FS_MAX_FILES_PER_STEP=200
AGENT_FS_MAX_TOTAL_DIFF_BYTES=4194304
```