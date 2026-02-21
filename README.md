deeprun Canonical Backend – v1 Architecture Contract
Purpose

This repository defines the canonical backend architecture used by deeprun v1.

All generated backends must conform to this contract.

This document is not optional guidance.
It is the enforced architectural specification.

deeprun’s “ships v1 ready” claim depends on adherence to these rules.

Run Lifecycle Contract

All deeprun run engines use the same canonical status machine:

queued
running
correcting
optimizing
validating
complete
failed
cancelled

Legacy statuses (planned, paused, completed, cancelling) are migrated to canonical values.

Scope

deeprun v1 generates:

Single-tenant API backends

Production-ready

Dockerized

Fully typed

Security-hardened

Test-enforced

It does not generate:

Frontend applications

Multi-tenant systems

Event-driven architectures

Plugin systems

Multiple framework variants

Stack is frozen for v1.

Technology Stack (Immutable for v1)

Node 20+

TypeScript (strict mode enabled)

Fastify

Prisma

PostgreSQL

Zod

Vitest

Pino

JWT-based authentication

Explicit Prisma migrations

Explicit seed script

Dockerized deployment

No framework variation is allowed in v1.

Project Structure
src/
  server.ts
  app.ts

  config/
    env.ts
    logger.ts

  db/
    prisma.ts

  errors/
    BaseAppError.ts
    DomainError.ts
    ValidationError.ts
    NotFoundError.ts
    UnauthorizedError.ts
    ConflictError.ts
    InfrastructureError.ts
    errorHandler.ts

  middleware/

  modules/
    <module>/
      <module>.entity.ts
      <module>.dto.ts
      <module>.schema.ts
      <module>.repository.ts
      <module>.service.ts
      <module>.controller.ts
      <module>.routes.ts
      <module>.test.ts

tests/
  integration/

prisma/
Dockerfile
.env.example


Structure must not drift.

Architectural Layers
Controller Layer

Responsibilities:

Parse request

Validate input using Zod

Call service

Map domain entity to response DTO

Return response

Controllers must not:

Access Prisma

Contain business logic

Perform authorization decisions

Throw raw Error

Service Layer

Responsibilities:

Business logic

Authorization enforcement

Domain rule validation

Throw typed DomainError subclasses

Return domain entities

Services must not:

Import Prisma

Import Fastify types

Access request/response objects

Return HTTP DTOs

Repository Layer

Responsibilities:

Database access via Prisma

Map DB records to domain entities

Throw InfrastructureError on DB failures

Repositories must not:

Contain business logic

Perform authorization

Return Prisma models directly

Domain Entities

Plain TypeScript interfaces

No methods

No constructors

No embedded logic

All behavior belongs in services.

Dependency Rules

No circular dependencies

No cross-module imports without explicit injection

Services use constructor injection

No IoC containers

No hidden singletons (except prisma and logger)

Dependency graph must remain acyclic.

Authentication & Authorization

JWT-based stateless authentication

Roles stored in database

Role included in JWT payload

Auth middleware validates JWT

Authorization enforced in service layer

Dynamic roles supported

Single-tenant only

Validation

Zod schemas per module

Shared across layers

Validate structure only

Business validation belongs in service layer

Error System

Error hierarchy:

BaseAppError

DomainError

ValidationError

NotFoundError

UnauthorizedError

ConflictError

InfrastructureError

Central error handler:

Maps errors to HTTP codes

Sanitizes output

Logs structured metadata

Hides stack trace in production

Raw Error must never reach client.

Security Baseline

Mandatory:

Helmet

Rate limiting

Explicit CORS configuration

Environment variable validation on boot

Strong password hashing

JWT secret validation

No wildcard CORS

No stack traces in production

No sensitive data in logs

Logging

Structured JSON logs (Pino)

Request-scoped IDs

No console.log

Environment-aware formatting

Error type classification

Logging is mandatory and must be structured.

Database Discipline

Explicit migration command required

No auto-migration at server boot

Explicit, idempotent seed script

Prisma schema must align with domain entities

Testing Requirements

Each module must include:

Service success test

Validation failure test

Authorization test

NotFound or conflict test

Integration test must:

Boot application

Validate /health endpoint

No module exists without tests.

Type Safety

TypeScript strict mode enabled

noImplicitAny enabled

No implicit any allowed

Explicit any allowed only when intentional

Production Readiness Criteria

A generated backend is considered v1 ready only if:

Compiles without type errors

Passes all tests

Boots successfully

Health endpoint returns 200

Security invariants are satisfied

Docker image builds successfully

Prohibited Patterns

The following are not allowed in v1:

Event bus architecture

Multi-tenant logic

Circular dependencies

Cross-module direct imports

Rich domain classes

Auto-migrate on boot

Raw Error throws

Wildcard CORS

Hidden runtime configuration

Definition of Done

deeprun v1 must generate backends that:

Require zero manual edits to boot

Pass validation and tests

Conform to this contract

Are production deployable

Anything less does not meet the v1 standard.

Runtime Enforcement Anchors (deeprun Engine)

Contract and graph validation are implemented in:

src/agent/validation/contract.ts
src/agent/validation/path-utils.ts
src/agent/validation/collect-files.ts
src/agent/validation/graph-builder.ts
src/agent/validation/failure-parser.ts
src/agent/validation/structural-validator.ts
src/agent/validation/ast-validator.ts
src/agent/validation/security-validator.ts
src/agent/validation/project-validator.ts

Mutation boundary and transactional step application are implemented in:

src/agent/fs/types.ts
src/agent/fs/diff-engine.ts
src/agent/fs/validator.ts
src/agent/fs/file-session.ts

Non-agent project mutation routes also use this boundary:
`POST /api/projects` (scaffold), `PUT /api/projects/:projectId/file`, and generation/chat flows via `src/lib/generator.ts`.

Agent runtime integration points:

Mutating tools propose changes (no direct writes):
src/agent/tools/write-file.ts
src/agent/tools/apply-patch.ts

Kernel transaction + light validation before commit:
src/agent/kernel.ts

Canonical status definitions:
src/agent/run-status.ts

Step log discipline:

Agent step records are append-only.
Retries/replays at the same `step_index` are recorded as incrementing `attempt` entries.
No existing step record is overwritten.

Correction safety:

Correction steps must produce real staged diffs and a commit; no-op/silent patch corrections are rejected.

Environment knobs:

AGENT_FS_MAX_FILES_PER_STEP
AGENT_FS_MAX_TOTAL_DIFF_BYTES
AGENT_FS_MAX_FILE_BYTES
AGENT_FS_ALLOW_ENV_MUTATION
AGENT_LIGHT_VALIDATION_MODE (off | warn | enforce)
AGENT_RUN_LOCK_STALE_SECONDS
AGENT_HEAVY_VALIDATION_MODE (off | warn | enforce)
AGENT_GOAL_MAX_CORRECTIONS
AGENT_OPTIMIZATION_MAX_CORRECTIONS
AGENT_RUNTIME_MAX_CORRECTIONS (legacy alias for goal max)
AGENT_HEAVY_MAX_CORRECTIONS
AGENT_HEAVY_INSTALL_DEPS
AGENT_HEAVY_BUILD_TIMEOUT_MS

V1 readiness gate knobs:

V1_DOCKER_BIN
V1_DOCKER_BUILD_TIMEOUT_MS
V1_DOCKER_BOOT_TIMEOUT_MS
V1_DOCKER_CONTAINER_PORT
V1_DOCKER_HEALTH_PATH
V1_DOCKER_KEEP_IMAGE
V1_DOCKER_RUN_MIGRATION
V1_DOCKER_MIGRATION_SCRIPT
V1_DOCKER_MIGRATION_DATABASE_URL
V1_DOCKER_MIGRATION_TIMEOUT_MS

Run execution isolation:

Each run is executed in `run/<runId>` branch worktree under:
`<projectRoot>/.deeprun/worktrees/<runId>`

Fork endpoint (step commit-based):

`POST /api/projects/:projectId/agent/runs/:runId/fork/:stepId`

Validate run output endpoint (isolated heavy validation):

`POST /api/projects/:projectId/agent/runs/:runId/validate`

Backend bootstrap endpoint (canonical template + immediate kernel run):

`POST /api/projects/bootstrap/backend`

CLI wrapper:

`npm run agent:validate-run -- <projectId> <runId>`

Local architecture check command:

npm run check:architecture -- /path/to/project

Binary YES/NO readiness gate:

npm run check:v1-ready -- /path/to/project

`check:v1-ready` runs:
heavy validation (architecture + production config checks + install + typecheck + build + tests + boot),
then Docker image build + optional containerized migration dry run + container `/health` boot check.

Server Integration Test Commands

npm run test:providers
npm run test:server-routes
npm run test:server-agent-state
npm run test:server-agent-kernel
npm run test:server-all
npm run test:bootstrap

`test:server-all` runs all server route integration suites as a single regression gate.
`test:bootstrap` runs the backend bootstrap API + CLI integration suites.

CI Gate

GitHub Actions workflow: `.github/workflows/ci.yml`

It runs on push to `main` and pull requests with a PostgreSQL service, then executes:

npm run test:ci

`test:ci` includes bootstrap coverage through:

- `src/__tests__/agent-kernel-routes.test.ts` (`/api/projects/bootstrap/backend`)
- `src/__tests__/deeprun-cli.test.ts` (`deeprun bootstrap`)

Local equivalent:

npm run test:ci

Reliability CI Gate

GitHub Actions workflow: `.github/workflows/reliability.yml`

Triggers:

- `pull_request`: reliability PR gate
- nightly schedule (`0 6 * * *` UTC)
- manual dispatch (`workflow_dispatch`)

Behavior:

- Starts deeprun API against PostgreSQL service.
- Runs `npm run benchmark:reliability`.
- Uploads `.deeprun/reliability-report.json` and server logs as workflow artifacts.
- PR mode uses strict thresholds:
  - `iterations=3`
  - `min_pass_rate=1.0`
- Nightly/manual defaults:
  - `iterations=10`
  - `min_pass_rate=0.95`

Reliability Benchmark (North Star Metric)

Run repeated canonical bootstrap generations and calculate pass rate:

npm run benchmark:reliability -- --email you@example.com --password 'Password123!' --iterations 10 --strict-v1-ready=true --min-pass-rate 0.95 --output .deeprun/reliability-report.json

What this does:

- Authenticates (register-or-login).
- Runs `POST /api/projects/bootstrap/backend` for each sample.
- Uses bootstrap certification as the base pass/fail gate.
- Optionally runs full `check:v1-ready` per sample when `--strict-v1-ready=true`.
- Emits structured JSON with `passRate`, `passCount`, `failCount`, and per-run diagnostics.
- Heavy validation uses an isolated PostgreSQL schema per run by default (or `AGENT_HEAVY_DATABASE_URL` if provided) to avoid control-plane table collisions.

This is the direct measurement for:

`% of generated backends that deploy and boot in a clean environment without human edits`

V1 Readiness Workflow

Manual GitHub Actions gate: `.github/workflows/v1-ready.yml`

Run from Actions with optional `target_path` input. It executes:

npm run check:v1-ready -- <target_path>

Local equivalent for current repo root:

npm run test:v1-ready

Note: this repository can fail v1 readiness by design if it is not shaped like the canonical generated backend contract.

CLI Commands (deeprun)

Run via npm script:

npm run deeprun -- <command> [args]

Core commands:

npm run deeprun -- init --api http://127.0.0.1:3000 --email you@example.com --password 'Password123!'
npm run deeprun -- bootstrap "Build SaaS backend with auth"
npm run deeprun -- run "Build SaaS backend with auth"
npm run deeprun -- status
npm run deeprun -- status --watch --verbose
npm run deeprun -- logs
npm run deeprun -- continue
npm run deeprun -- branch --engine kernel
npm run deeprun -- fork <stepId>
npm run deeprun -- validate
npm run deeprun -- promote

Notes:

- Session/config persists at `.deeprun/cli.json` (override with `DEEPRUN_CLI_CONFIG`).
- `bootstrap` always creates a new `canonical-backend` project and starts a kernel run in one call.
- `bootstrap` is strict: it exits non-zero if post-bootstrap certification reports `CERTIFICATION_OK=false`.
- If `--provider` is omitted, deeprun uses server-side default provider selection (`DEEPRUN_DEFAULT_PROVIDER` override, otherwise first configured real provider, else `mock`).
- Default output is concise; add `--verbose` for expanded request and step details.

CLI integration test:

npm run test:cli
