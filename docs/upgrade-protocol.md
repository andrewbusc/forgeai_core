# deeprun Upgrade Protocol

**Schema versioning, backward compatibility, and deployment upgrade procedures.**

## Schema Version Semantics

deeprun uses **semantic versioning** for schema changes with strict compatibility guarantees.

### Version Format: `MAJOR.MINOR.PATCH`

#### MAJOR Version (Breaking Changes)
- **Incompatible API changes**
- **Database schema breaking changes**
- **Configuration format changes**
- **Governance decision contract changes**

**Example**: `1.0.0` → `2.0.0`
- New governance decision schema
- Database migration required
- Configuration update required

#### MINOR Version (Backward Compatible)
- **New features and endpoints**
- **Optional configuration parameters**
- **Additive database schema changes**
- **Enhanced governance criteria**

**Example**: `1.0.0` → `1.1.0`
- New API endpoints added
- Optional environment variables
- New database columns (nullable)

#### PATCH Version (Bug Fixes)
- **Bug fixes and security patches**
- **Performance improvements**
- **Documentation updates**
- **No schema or API changes**

**Example**: `1.0.0` → `1.0.1`
- Security vulnerability fixes
- Performance optimizations
- Bug fixes

## Backward Compatibility Guarantees

### API Compatibility Matrix

| Version Change | API Compatibility | Database Compatibility | Config Compatibility |
|----------------|-------------------|------------------------|---------------------|
| PATCH (1.0.0 → 1.0.1) | ✅ Full | ✅ Full | ✅ Full |
| MINOR (1.0.0 → 1.1.0) | ✅ Backward | ✅ Additive | ✅ Additive |
| MAJOR (1.0.0 → 2.0.0) | ❌ Breaking | ❌ Breaking | ❌ Breaking |

### Compatibility Guarantees

#### ✅ GUARANTEED (Within Major Version)
- **API Endpoints**: Existing endpoints remain functional
- **Request/Response Format**: Existing fields preserved
- **Database Schema**: Existing tables/columns preserved
- **Configuration**: Existing environment variables work
- **Governance Contract**: Decision schema remains stable

#### ⚠️ ADDITIVE (Minor Versions)
- **New API Endpoints**: Additional functionality
- **New Response Fields**: Optional additional data
- **New Database Columns**: Nullable or with defaults
- **New Configuration**: Optional environment variables
- **Enhanced Governance**: Additional validation criteria

#### ❌ BREAKING (Major Versions Only)
- **Removed API Endpoints**: Deprecated endpoints removed
- **Changed Response Format**: Field renames or removals
- **Database Schema Changes**: Column renames, type changes
- **Configuration Changes**: Required new variables
- **Governance Changes**: New decision schema format

## Deployment Upgrade Procedure

### PATCH Upgrades (1.0.0 → 1.0.1)

**Zero-downtime deployment** - No special procedures required.

```bash
# 1. Pull latest image
docker pull ghcr.io/deeprun/deeprun:1.0.1

# 2. Rolling update
docker-compose up -d

# 3. Verify health
curl http://localhost:3000/api/health
```

**Rollback**: Instant - revert to previous image.

### MINOR Upgrades (1.0.0 → 1.1.0)

**Low-risk deployment** - Additive changes only.

```bash
# 1. Backup database (recommended)
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# 2. Update image version
docker pull ghcr.io/deeprun/deeprun:1.1.0

# 3. Deploy with health checks
docker-compose up -d
sleep 30

# 4. Verify new features (optional)
curl http://localhost:3000/api/health
curl http://localhost:3000/api/version

# 5. Run database migrations (if any)
docker-compose exec deeprun npm run prisma:migrate
```

**Rollback**: Database restore may be required if migrations ran.

### MAJOR Upgrades (1.0.0 → 2.0.0)

**High-risk deployment** - Breaking changes require planning.

#### Pre-Upgrade Checklist
- [ ] **Full database backup**
- [ ] **Configuration audit** (check new required variables)
- [ ] **API client compatibility** (test breaking changes)
- [ ] **Governance integration** (update CI workflows)
- [ ] **Rollback plan** (database restore procedure)
- [ ] **Maintenance window** (plan for downtime)

#### Upgrade Steps
```bash
# 1. Enter maintenance mode
echo "MAINTENANCE_MODE=true" >> .env
docker-compose restart

# 2. Full database backup
pg_dump $DATABASE_URL > backup-v1-$(date +%Y%m%d-%H%M).sql

# 3. Update configuration
cp .env .env.v1.backup
# Edit .env with new required variables

# 4. Update docker-compose.yml
# Change image version to 2.0.0

# 5. Deploy new version
docker-compose down
docker-compose up -d

# 6. Run database migrations
docker-compose exec deeprun npm run prisma:migrate

# 7. Verify upgrade
curl http://localhost:3000/api/health
curl http://localhost:3000/api/version

# 8. Exit maintenance mode
sed -i '/MAINTENANCE_MODE/d' .env
docker-compose restart

# 9. Update CI/CD workflows
# Update governance decision schema in CI
```

#### Rollback Procedure (Major)
```bash
# 1. Stop current version
docker-compose down

# 2. Restore database
psql $DATABASE_URL < backup-v1-$(date +%Y%m%d-%H%M).sql

# 3. Restore configuration
cp .env.v1.backup .env

# 4. Deploy previous version
# Change docker-compose.yml back to 1.0.0
docker-compose up -d

# 5. Verify rollback
curl http://localhost:3000/api/health
```

## Version Detection

### Runtime Version Check
```bash
# Get current version
curl http://localhost:3000/api/version

# Response
{
  "version": "1.0.0",
  "schema": "1.0.0",
  "governance": "1.0.0",
  "build": "2024-01-01T00:00:00Z"
}
```

### Database Schema Version
```sql
-- Check schema version
SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;
```

### Configuration Version
```bash
# Check config compatibility
npm run check:config:version
```

## Migration Strategies

### Database Migrations

#### Additive Migrations (Minor)
```sql
-- Safe: Add nullable column
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- Safe: Add new table
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  theme TEXT DEFAULT 'light'
);
```

#### Breaking Migrations (Major)
```sql
-- Breaking: Rename column (requires major version)
ALTER TABLE users RENAME COLUMN name TO full_name;

-- Breaking: Change column type
ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ;
```

### API Migrations

#### Backward Compatible (Minor)
```typescript
// Add optional field to response
interface UserResponse {
  id: string;
  email: string;
  name: string;
  avatar?: string; // New optional field
}
```

#### Breaking Changes (Major)
```typescript
// Rename field (breaking change)
interface UserResponse {
  id: string;
  email: string;
  fullName: string; // Renamed from 'name'
}
```

## Governance Schema Evolution

### Decision Schema Versioning

#### v1.0.0 Schema
```json
{
  "pass": true,
  "version": "1.0.0",
  "summary": {
    "backend_generated": true,
    "tests_passing": true,
    "security_validated": true,
    "deployment_ready": true
  }
}
```

#### v2.0.0 Schema (Hypothetical)
```json
{
  "pass": true,
  "version": "2.0.0",
  "criteria": {
    "generation": { "status": "pass", "score": 0.95 },
    "testing": { "status": "pass", "coverage": 0.85 },
    "security": { "status": "pass", "vulnerabilities": 0 },
    "deployment": { "status": "pass", "readiness": true }
  }
}
```

### CI Integration Updates

#### Major Version CI Update
```yaml
# Update governance decision parsing
- name: Check Governance Decision
  run: |
    # v2.0.0 schema
    PASS=$(jq -r '.criteria.generation.status == "pass" and .criteria.testing.status == "pass"' decision.json)
    if [ "$PASS" != "true" ]; then
      exit 1
    fi
```

## Upgrade Notifications

### Version Compatibility Warnings
```bash
# Server startup warnings
⚠️  Configuration schema v1.0.0 detected, v1.1.0 available
⚠️  Database schema v1.0.0 detected, migrations available
⚠️  Governance decision schema v1.0.0, CI may need updates
```

### Deprecation Notices
```bash
# 6 months before major version
⚠️  API endpoint /api/v1/users deprecated, use /api/v2/users
⚠️  Configuration LEGACY_JWT_SECRET deprecated, use JWT_SECRET
⚠️  Governance field 'tests_passing' deprecated, use 'testing.status'
```

## Support Policy

### Version Support Matrix

| Version | Status | Security Updates | Bug Fixes | New Features |
|---------|--------|------------------|-----------|--------------|
| 2.0.x | Current | ✅ | ✅ | ✅ |
| 1.1.x | Maintenance | ✅ | ✅ | ❌ |
| 1.0.x | Security Only | ✅ | ❌ | ❌ |
| 0.x.x | End of Life | ❌ | ❌ | ❌ |

### Upgrade Timeline
- **Major versions**: 12 months support overlap
- **Minor versions**: 6 months maintenance period
- **Patch versions**: Immediate supersession

### Emergency Upgrades
Critical security vulnerabilities trigger immediate patch releases across all supported major versions.

```bash
# Emergency security patch
deeprun-1.0.5  # Security fix for 1.0.x
deeprun-1.1.3  # Security fix for 1.1.x  
deeprun-2.0.1  # Security fix for 2.0.x
```