# deeprun Production Checklist

Use this before promoting the deeprun control-plane service to public production.

## Configuration and Secrets

- [ ] Set a strong `AUTH_TOKEN_SECRET` (32+ random bytes).
- [ ] Set `COOKIE_SECURE=true` in production.
- [ ] Set `CORS_ALLOWED_ORIGINS` to explicit frontend origin(s) only.
- [ ] Configure `TRUST_PROXY` correctly for your ingress/load balancer.
- [ ] Decide whether to expose `/metrics`; if yes, set `METRICS_ENABLED=true` and `METRICS_AUTH_TOKEN`.
- [ ] Set `DATABASE_URL` to production Postgres and enable `DATABASE_SSL=require` when applicable.
- [ ] Set `DEPLOY_REGISTRY`, `DEPLOY_BASE_DOMAIN`, and any Docker network settings used by your host.

## Runtime and Infra

- [ ] Run behind TLS termination (reverse proxy or load balancer).
- [ ] Wire liveness probe to `GET /api/health`.
- [ ] Wire readiness probe to `GET /api/ready`.
- [ ] Follow `docs/runtime-probes-metrics.md` for K8s/Nginx proxy/probe wiring.
- [ ] Confirm SIGTERM graceful shutdown window matches orchestrator timeout (`SHUTDOWN_GRACE_MS`).
- [ ] Persist and monitor Postgres backups (and test restore).
- [ ] Restrict Docker daemon access on the host running deployments.

## Observability and Operations

- [ ] Ship JSON logs to centralized logging.
- [ ] Alert on 5xx rate, readiness failures, and deployment failures.
- [ ] Add dashboard panels for request latency, error rate, and deployment queue depth.
- [ ] Document on-call runbook for DB outage, deployment rollback, and stuck job recovery.

## Release Gates

- [ ] `npm run check`
- [ ] `npm run test:ci`
- [ ] `npm run test:deployment-dry-run`
- [ ] Review `.env` values and deployment permissions before cutover.

## Post-Deploy Smoke

- [ ] `/api/health` returns 200.
- [ ] `/api/ready` returns 200 and `db: "ok"`.
- [ ] Register/login flow works with secure cookies in the real frontend origin.
- [ ] Create project -> run generation -> validate -> promote works end-to-end.
