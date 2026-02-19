ForgeAI Canonical Backend – v1 Architecture Contract
Purpose

This repository defines the canonical backend architecture used by ForgeAI v1.

All generated backends must conform to this contract.

This document is not optional guidance.
It is the enforced architectural specification.

ForgeAI’s “ships v1 ready” claim depends on adherence to these rules.

Scope

ForgeAI v1 generates:

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

ForgeAI v1 must generate backends that:

Require zero manual edits to boot

Pass validation and tests

Conform to this contract

Are production deployable

Anything less does not meet the v1 standard.

Runtime Enforcement Anchors (ForgeAI Engine)

Contract and graph validation are implemented in:

src/agent/validation/contract.ts
src/agent/validation/path-utils.ts
src/agent/validation/collect-files.ts
src/agent/validation/graph-builder.ts
src/agent/validation/structural-validator.ts
src/agent/validation/ast-validator.ts
src/agent/validation/security-validator.ts
src/agent/validation/project-validator.ts

Mutation boundary and transactional step application are implemented in:

src/agent/fs/types.ts
src/agent/fs/diff-engine.ts
src/agent/fs/validator.ts
src/agent/fs/file-session.ts

Agent runtime integration points:

Mutating tools propose changes (no direct writes):
src/agent/tools/write-file.ts
src/agent/tools/apply-patch.ts

Kernel transaction + light validation before commit:
src/agent/kernel.ts

Environment knobs:

AGENT_FS_MAX_FILES_PER_STEP
AGENT_FS_MAX_TOTAL_DIFF_BYTES
AGENT_FS_MAX_FILE_BYTES
AGENT_FS_ALLOW_ENV_MUTATION
AGENT_LIGHT_VALIDATION_MODE (off | warn | enforce)
AGENT_RUN_LOCK_STALE_SECONDS
AGENT_HEAVY_VALIDATION_MODE (off | warn | enforce)
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

Run execution isolation:

Each run is executed in `run/<runId>` branch worktree under:
`<projectRoot>/.forgeai/worktrees/<runId>`

Fork endpoint (step commit-based):

`POST /api/projects/:projectId/agent/runs/:runId/fork/:stepId`

Validate run output endpoint (isolated heavy validation):

`POST /api/projects/:projectId/agent/runs/:runId/validate`

CLI wrapper:

`npm run agent:validate-run -- <projectId> <runId>`

Local architecture check command:

npm run check:architecture -- /path/to/project

Binary YES/NO readiness gate:

npm run check:v1-ready -- /path/to/project

`check:v1-ready` runs:
heavy validation (architecture + install + typecheck + build + tests + boot),
then Docker image build + container `/health` boot check.
