# Runtime Probes and Metrics

This document shows basic probe and proxy wiring for running the deeprun control-plane service in production.

## Endpoints

- `GET /api/health`: liveness (process is up)
- `GET /api/ready`: readiness (process is ready and DB ping succeeds)
- `GET /metrics`: Prometheus text metrics (disabled by default)

## Required Environment

- `TRUST_PROXY=true` (or a specific proxy setting) when running behind ingress/load balancers
- `SHUTDOWN_GRACE_MS` aligned with platform termination timeout
- `METRICS_ENABLED=true` to expose `/metrics`
- `METRICS_AUTH_TOKEN=<token>` to require `Authorization: Bearer <token>` on `/metrics`

## Kubernetes (Deployment Probes)

Use liveness/readiness probes and set a termination grace period greater than `SHUTDOWN_GRACE_MS`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: deeprun
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 20
      containers:
        - name: api
          image: your-registry/deeprun:latest
          ports:
            - containerPort: 3000
          env:
            - name: PORT
              value: "3000"
            - name: TRUST_PROXY
              value: "true"
            - name: SHUTDOWN_GRACE_MS
              value: "15000"
            - name: METRICS_ENABLED
              value: "true"
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 2
          readinessProbe:
            httpGet:
              path: /api/ready
              port: 3000
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
```

Notes:

- `terminationGracePeriodSeconds` should be at least `ceil(SHUTDOWN_GRACE_MS / 1000)` plus buffer.
- Keep `/metrics` private (cluster-only Service/NetworkPolicy) and/or protect with `METRICS_AUTH_TOKEN`.

## Nginx (Reverse Proxy)

Forward proxy headers so `req.secure` and client IPs are correct (with `TRUST_PROXY` configured in deeprun).

```nginx
server {
  listen 443 ssl http2;
  server_name deeprun.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location = /metrics {
    allow 10.0.0.0/8;
    deny all;
    proxy_pass http://127.0.0.1:3000/metrics;
    proxy_set_header Authorization "Bearer REPLACE_ME";
  }
}
```

## Quick Validation

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
curl -fsS -H "Authorization: Bearer $METRICS_AUTH_TOKEN" http://127.0.0.1:3000/metrics
```

## Local Compose Smoke (Production-Like)

The repository includes `docker-compose.yml` with:

- `db` (PostgreSQL 16 with healthcheck)
- `api` (built from the production `Dockerfile`, wired to `/api/ready` and `/metrics`)

Run:

```bash
docker compose up --build
```

Smoke checks (in another terminal):

```bash
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/ready
curl -fsS -H "Authorization: Bearer local-metrics-token" http://127.0.0.1:3010/metrics | head
```
