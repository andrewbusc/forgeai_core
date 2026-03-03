# deeprun v1.0.0 Scope Declaration

**Clear boundaries for production deployment**

## What v1.0.0 IS

### ✅ Single-Node Deterministic Execution
- **Single control-plane process**: One deeprun server instance
- **Serialized execution**: Runs execute sequentially per project
- **Deterministic governance**: Reproducible pass/fail decisions
- **Resource boundaries**: Timeout enforcement, memory caps, bounded retries

### ✅ Production-Ready CI Integration
- **< 10 minute installation**: Fresh machine to running server
- **< 30 minute CI integration**: GitHub Actions workflow ready
- **Clean governance API**: No internal vocabulary leakage
- **Artifact retrieval**: Generated code, traces, validation reports

### ✅ Zero-Edit Backend Generation
- **Canonical architecture**: Fastify + Prisma + PostgreSQL + TypeScript
- **Production structure**: Docker, tests, security, validation
- **Governance gating**: Pass/fail decision for deployment
- **Reliability measurement**: Benchmark for generation success rate

## What v1.0.0 IS NOT

### ❌ Distributed System
- **No multi-node execution**: Single server only
- **No distributed guarantees**: No consensus, no replication
- **No HA cluster mode**: No automatic failover
- **No horizontal scaling**: Vertical scaling only

### ❌ Multi-Tenant Platform
- **Single-tenant only**: One organization per instance
- **No tenant isolation**: Not designed for SaaS multi-tenancy
- **Internal auth only**: Basic JWT, not enterprise SSO
- **No usage metering**: No per-tenant billing/quotas

### ❌ Real-Time Orchestration
- **No agent concurrency**: Sequential execution per project
- **No parallel graph execution**: One run at a time per project
- **No streaming updates**: Polling-based status checks
- **No WebSocket support**: HTTP REST API only

### ❌ Advanced Policy Engine
- **Governance v1 only**: Simple pass/fail criteria
- **No custom policies**: Fixed governance contract
- **No policy branching**: Linear decision logic
- **No runtime optimization**: Fixed execution paths

### ❌ Production Monitoring
- **Basic metrics only**: Prometheus format, no dashboards
- **No distributed tracing**: Single-node only
- **No alerting**: External monitoring required
- **No log aggregation**: Local logs only

## Architecture Assumptions

### Database
- **PostgreSQL required**: No other databases supported
- **Single database**: No sharding, no read replicas
- **Local connection**: No connection pooling across nodes
- **Manual backups**: No automated backup system

### File System
- **Local disk required**: Git worktrees on local filesystem
- **No distributed storage**: No S3, no NFS
- **Manual cleanup**: No automatic artifact retention
- **Single workspace**: No workspace federation

### Authentication
- **JWT-based**: Simple token authentication
- **No SSO**: No SAML, no OAuth providers
- **No RBAC**: Basic role-based access (owner/admin/member)
- **No audit logs**: Basic request logging only

### Networking
- **HTTP REST only**: No gRPC, no WebSocket
- **Single origin CORS**: Explicit origin list required
- **No load balancer**: Direct server connection
- **No TLS termination**: External reverse proxy required

## Deployment Model

### Supported
- **Docker Compose**: Single-node with PostgreSQL
- **Kubernetes**: Single pod deployment (no StatefulSet)
- **VM deployment**: Ubuntu/macOS with PostgreSQL
- **Development**: Local npm start

### Not Supported
- **Kubernetes cluster**: Multi-pod with leader election
- **Cloud-native**: No AWS ECS/Fargate, no GCP Cloud Run
- **Serverless**: No Lambda, no Cloud Functions
- **Edge deployment**: No CDN, no edge workers

## Performance Characteristics

### Expected
- **Run latency**: 30-60 seconds for simple backends
- **Concurrent projects**: 5-10 active projects
- **Database size**: < 10GB for typical usage
- **Memory usage**: 2-4GB per server instance

### Not Guaranteed
- **Sub-second latency**: Not optimized for speed
- **High throughput**: Not designed for 1000s of runs/hour
- **Large codebases**: Not tested beyond 100 files
- **Long-running**: Runs timeout after 1 hour

## Upgrade Path

### v1.x Releases
- **PATCH**: Bug fixes, security updates (backward compatible)
- **MINOR**: New features, additive changes (backward compatible)
- **MAJOR**: Breaking changes (migration required)

### Future Versions
- **v2.0**: Multi-node execution, distributed semantics
- **v3.0**: Advanced policy engine, custom governance
- **v4.0**: Real-time orchestration, agent concurrency

## Support Boundaries

### Supported Use Cases
- **CI/CD integration**: Automated backend generation in pipelines
- **Development teams**: 5-50 developers per instance
- **Backend scaffolding**: Production-ready API generation
- **Architecture enforcement**: Consistent backend patterns

### Unsupported Use Cases
- **SaaS platform**: Multi-tenant backend generation service
- **Enterprise SSO**: SAML/OAuth integration
- **High-frequency**: 1000s of generations per hour
- **Mission-critical**: 99.99% uptime SLA

## Security Model

### Provided
- **JWT authentication**: Token-based API access
- **CORS enforcement**: Explicit origin whitelist
- **Input validation**: Zod schema validation
- **SQL injection protection**: Parameterized queries

### Not Provided
- **Rate limiting**: Basic limits only, no DDoS protection
- **Intrusion detection**: No WAF, no anomaly detection
- **Encryption at rest**: Database encryption not included
- **Secrets management**: No Vault, no KMS integration

## Operational Requirements

### Required
- **PostgreSQL 12+**: Managed or self-hosted
- **Node.js 20+**: LTS version
- **Git**: For worktree management
- **Docker**: For v1-ready validation (optional)

### Recommended
- **Reverse proxy**: nginx/Caddy for TLS termination
- **Monitoring**: Prometheus + Grafana
- **Backups**: Automated PostgreSQL backups
- **Log aggregation**: External logging service

## Clear Messaging

### Say This
- "Single-node deterministic governance layer for AI-assisted CI workflows"
- "Production-ready backend generation with zero-edit deployment"
- "Deterministic pass/fail decisions for CI gating"

### Don't Say This
- "Distributed AI orchestration platform"
- "Enterprise-grade multi-tenant SaaS"
- "Real-time agent coordination system"
- "Horizontally scalable cluster"

## Version Commitment

v1.0.0 commits to:
- **API stability**: No breaking changes in v1.x
- **Schema compatibility**: Forward-compatible migrations
- **Governance contract**: v1 decision format stable
- **12-month support**: Security updates for v1.x

v1.0.0 does NOT commit to:
- **Performance SLAs**: Best-effort only
- **Uptime guarantees**: No HA in v1
- **Feature requests**: v2+ roadmap
- **Custom integrations**: Standard API only

---

**Platform teams: Know what you're getting.**  
**v1 is production-ready within these boundaries.**  
**Ambiguity slows adoption more than limitation.**