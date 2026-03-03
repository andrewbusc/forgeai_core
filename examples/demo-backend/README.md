# Demo Backend

**Simple Task Management API** - Reference implementation for deeprun generation testing.

## Overview

This is a canonical backend that demonstrates what deeprun should generate:
- **Fastify** web framework
- **Prisma** ORM with PostgreSQL
- **JWT** authentication
- **Zod** validation
- **TypeScript** strict mode
- **Production-ready** structure

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login

### Tasks (Authenticated)
- `GET /api/tasks` - List user's tasks
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Health
- `GET /health` - Health check

## Quick Start

```bash
# Install dependencies
npm install

# Set up database
export DATABASE_URL="postgresql://user:pass@localhost:5432/demo"
export JWT_SECRET="your-secret-key-minimum-32-characters"

# Run migrations
npx prisma migrate dev

# Start server
npm run dev
```

## deeprun Generation Test

This backend serves as a **reliability benchmark target**. deeprun should be able to generate equivalent functionality with this prompt:

```
Build a task management API with user authentication. 
Users can register, login, and manage their personal tasks.
Include CRUD operations for tasks with title, description, and completion status.
Use JWT authentication and PostgreSQL database.
```

### Expected Generation Results

**✅ Should Generate:**
- Fastify server with proper middleware
- Prisma schema with User and Task models
- JWT authentication middleware
- Zod validation schemas
- CRUD endpoints with proper error handling
- Health check endpoint
- TypeScript types and interfaces
- Production-ready configuration

**✅ Should Pass Governance:**
- `backend_generated: true`
- `tests_passing: true`
- `security_validated: true`
- `deployment_ready: true`

## Architecture Validation

This demo follows deeprun's canonical backend contract:

### ✅ Required Structure
```
src/
  server.ts           # Fastify server entry point
  middleware/         # Auth middleware
  routes/            # API routes
  schemas/           # Zod validation schemas
prisma/
  schema.prisma      # Database schema
package.json         # Dependencies
tsconfig.json        # TypeScript config
Dockerfile           # Container definition
```

### ✅ Required Dependencies
- `fastify` - Web framework
- `@prisma/client` + `prisma` - Database ORM
- `zod` - Schema validation
- `jsonwebtoken` - JWT handling
- `bcryptjs` - Password hashing
- `pino` - Structured logging

### ✅ Security Requirements
- JWT-based authentication
- Password hashing with bcrypt
- Input validation with Zod
- Proper error handling
- No sensitive data in logs

## Testing deeprun Generation

### 1. Generate Backend
```bash
curl -X POST "http://localhost:3000/api/projects/bootstrap/backend" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "your-workspace-id",
    "goal": "Build a task management API with user authentication. Users can register, login, and manage their personal tasks. Include CRUD operations for tasks with title, description, and completion status. Use JWT authentication and PostgreSQL database.",
    "name": "generated-task-api"
  }'
```

### 2. Compare Results
- **Structure**: Generated files match canonical structure
- **Dependencies**: All required packages included
- **Functionality**: All endpoints work correctly
- **Security**: Authentication and validation implemented
- **Tests**: Generated tests pass
- **Docker**: Container builds and runs

### 3. Reliability Benchmark
```bash
# Run reliability test with this demo as target
npm run benchmark:reliability -- \
  --target-prompt "Build a task management API with user authentication" \
  --reference-path ./examples/demo-backend \
  --iterations 10 \
  --min-pass-rate 0.95
```

## Success Criteria

For deeprun to pass the demo backend test:

1. **Generation Success**: Backend generates without errors
2. **Structural Match**: Generated structure matches canonical layout
3. **Functional Equivalence**: All API endpoints work correctly
4. **Security Compliance**: Authentication and validation implemented
5. **Test Coverage**: Generated tests pass
6. **Docker Ready**: Container builds and health checks pass
7. **Governance Pass**: All governance criteria met

## Common Generation Issues

### ❌ Typical Failures
- Missing authentication middleware
- Incorrect Prisma schema relationships
- Missing input validation
- Improper error handling
- Security vulnerabilities
- Missing health check endpoint

### ✅ Quality Indicators
- Clean TypeScript with strict mode
- Proper async/await usage
- Structured error responses
- Consistent naming conventions
- Production-ready configuration
- Comprehensive input validation

This demo backend represents the **minimum viable complexity** that deeprun must handle reliably to meet its "ships v1 ready" promise.