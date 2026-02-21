import { ProjectTemplate, ProjectTemplateId } from "../types.js";

const canonicalBackendStarter = {
  "README.md": `# deeprun Canonical Backend

This project is scaffolded to satisfy the deeprun v1 backend contract.

## Stack

- Node 20+
- TypeScript strict mode
- Fastify + Pino logging
- Prisma + PostgreSQL
- Zod validation
- Vitest tests
- JWT auth

## Commands

- npm install
- npm run prisma:generate
- npm run prisma:migrate
- npm run prisma:seed
- npm run dev
`,
  "package.json": `{
  "name": "deeprun-canonical-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/server.js",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/helmet": "^13.0.0",
    "@fastify/jwt": "^9.1.0",
    "@fastify/rate-limit": "^10.2.0",
    "@prisma/client": "^6.3.1",
    "dotenv": "^16.4.7",
    "fastify": "^5.2.1",
    "pino": "^9.6.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.13.4",
    "prisma": "^6.3.1",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.5"
  }
}
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "prisma/**/*.ts", "tests/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
`,
  ".env.example": `NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/deeprun
JWT_SECRET=replace-this-with-a-secure-jwt-secret-value
CORS_ALLOWED_ORIGINS=http://localhost:3000
`,
  ".env": `NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/deeprun
JWT_SECRET=replace-this-with-a-secure-jwt-secret-value
CORS_ALLOWED_ORIGINS=http://localhost:3000
`,
  "Dockerfile": `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY tests ./tests
RUN npm run prisma:generate
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start"]
`,
  ".dockerignore": `node_modules
dist
.git
.deeprun
.workspace
.data
.env
`,
  "prisma/schema.prisma": `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         String   @default("admin")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
`,
  "prisma/seed.ts": `import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: {},
    create: {
      email: "owner@example.com",
      passwordHash: hashPassword("Password123!"),
      role: "admin"
    }
  });
}

void main()
  .catch((error) => {
    process.stderr.write(String(error) + "\\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
`,
  "prisma/migrations/20250101000000_init/migration.sql": `CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
`,
  "src/config/env.ts": `import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/deeprun"),
  JWT_SECRET: z.string().min(32).default("replace-this-with-a-secure-jwt-secret-value"),
  CORS_ALLOWED_ORIGINS: z.string().min(1).default("http://localhost:3000")
});

export const env = envSchema.parse(process.env);

export const allowedCorsOrigins = env.CORS_ALLOWED_ORIGINS.split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
`,
  "src/config/logger.ts": `import pino from "pino";
import { env } from "./env.js";

const level = env.NODE_ENV === "production" ? "info" : "debug";

export const logger = pino({
  level,
  base: undefined
});
`,
  "src/db/prisma.ts": `import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL
      }
    }
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
`,
  "src/errors/BaseAppError.ts": `export interface ErrorMetadata {
  [key: string]: unknown;
}

export class BaseAppError extends Error {
  name: string;
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;
  readonly metadata?: ErrorMetadata;

  constructor(input: {
    message: string;
    code: string;
    statusCode: number;
    expose?: boolean;
    metadata?: ErrorMetadata;
    cause?: unknown;
  }) {
    super(input.message, input.cause !== undefined ? { cause: input.cause } : undefined);
    this.name = "BaseAppError";
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.expose = input.expose ?? true;
    this.metadata = input.metadata;
  }
}
`,
  "src/errors/DomainError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class DomainError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "DOMAIN_ERROR",
      statusCode: 400,
      metadata
    });
    this.name = "DomainError";
  }
}
`,
  "src/errors/ValidationError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class ValidationError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "VALIDATION_ERROR",
      statusCode: 422,
      metadata
    });
    this.name = "ValidationError";
  }
}
`,
  "src/errors/NotFoundError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class NotFoundError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "NOT_FOUND",
      statusCode: 404,
      metadata
    });
    this.name = "NotFoundError";
  }
}
`,
  "src/errors/UnauthorizedError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class UnauthorizedError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "UNAUTHORIZED",
      statusCode: 401,
      metadata
    });
    this.name = "UnauthorizedError";
  }
}
`,
  "src/errors/ConflictError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class ConflictError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "CONFLICT",
      statusCode: 409,
      metadata
    });
    this.name = "ConflictError";
  }
}
`,
  "src/errors/InfrastructureError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class InfrastructureError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "INFRASTRUCTURE_ERROR",
      statusCode: 500,
      expose: false,
      metadata
    });
    this.name = "InfrastructureError";
  }
}
`,
  "src/errors/errorHandler.ts": `import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { BaseAppError } from "./BaseAppError.js";
import { InfrastructureError } from "./InfrastructureError.js";

function normalizeError(error: unknown): BaseAppError {
  if (error instanceof BaseAppError) {
    return error;
  }

  return new InfrastructureError("Internal server error.", {
    reason: error instanceof Error ? error.message : String(error)
  });
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  const appError = normalizeError(error);

  request.log.error(
    {
      err: error,
      code: appError.code,
      statusCode: appError.statusCode
    },
    "Request failed"
  );

  const payload: Record<string, unknown> = {
    error: appError.code,
    message: appError.expose ? appError.message : "Internal server error"
  };

  if (appError.expose && appError.metadata) {
    payload.metadata = appError.metadata;
  }

  if (env.NODE_ENV !== "production") {
    payload.stack = error.stack;
  }

  reply.status(appError.statusCode).send(payload);
}
`,
  "src/middleware/auth-middleware.ts": `import { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../errors/UnauthorizedError.js";

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (error) {
    throw new UnauthorizedError("Authentication is required.", {
      reason: error instanceof Error ? error.message : "invalid-token"
    });
  }
}
`,
  "src/modules/auth/entity/auth-entity.ts": `export type AuthRole = "admin" | "member";

export interface AuthEntity {
  id: string;
  email: string;
  passwordHash: string;
  role: AuthRole;
}
`,
  "src/modules/auth/dto/auth-dto.ts": `import { AuthRole } from "../entity/auth-entity.js";

export interface LoginInputDto {
  email: string;
  password: string;
}

export interface LoginOutputDto {
  token: string;
  user: {
    id: string;
    email: string;
    role: AuthRole;
  };
}
`,
  "src/modules/auth/schema/auth-schema.ts": `import { z } from "zod";

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});
`,
  "src/modules/auth/repository/auth-repository.ts": `import { prisma } from "../../../db/prisma.js";
import { InfrastructureError } from "../../../errors/InfrastructureError.js";
import { AuthEntity, AuthRole } from "../entity/auth-entity.js";

function toAuthRole(value: string): AuthRole {
  return value === "admin" ? "admin" : "member";
}

export const authRepository = {
  async findByEmail(email: string): Promise<AuthEntity | null> {
    try {
      const record = await prisma.user.findUnique({
        where: {
          email: email.toLowerCase()
        }
      });

      if (!record) {
        return null;
      }

      return {
        id: record.id,
        email: record.email,
        passwordHash: record.passwordHash,
        role: toAuthRole(record.role)
      };
    } catch (error) {
      throw new InfrastructureError("Failed to query auth repository.", {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
};
`,
  "src/modules/auth/service/auth-service.ts": `import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../errors/UnauthorizedError.js";
import { LoginInputDto } from "../dto/auth-dto.js";
import { AuthEntity } from "../entity/auth-entity.js";
import { authRepository } from "../repository/auth-repository.js";

const jwtSecret = env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new UnauthorizedError("JWT_SECRET is required and must be at least 32 characters.");
}

function hashWithSalt(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64);
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const digest = hashWithSalt(password, salt).toString("hex");
  return salt + ":" + digest;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) {
    return false;
  }

  const actual = hashWithSalt(password, salt);
  const expected = Buffer.from(expectedHex, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export const authService = {
  async authenticate(input: LoginInputDto): Promise<AuthEntity> {
    const user = await authRepository.findByEmail(input.email);

    if (!user) {
      throw new UnauthorizedError("Invalid credentials.");
    }

    if (!verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedError("Invalid credentials.");
    }

    return user;
  }
};
`,
  "src/modules/auth/controller/auth-controller.ts": `import { FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../errors/ValidationError.js";
import { LoginInputDto, LoginOutputDto } from "../dto/auth-dto.js";
import { loginInputSchema } from "../schema/auth-schema.js";
import { authService } from "../service/auth-service.js";

export async function loginController(
  request: FastifyRequest<{ Body: LoginInputDto }>,
  reply: FastifyReply
): Promise<void> {
  const parsed = loginInputSchema.safeParse(request.body);

  if (!parsed.success) {
    throw new ValidationError("Invalid login payload.", parsed.error.flatten());
  }

  const user = await authService.authenticate(parsed.data);
  const token = await request.server.jwt.sign({
    sub: user.id,
    role: user.role
  });

  const response: LoginOutputDto = {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  };

  reply.status(200).send(response);
}
`,
  "src/modules/auth/tests/auth.service.test.ts": `import { afterEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../../errors/UnauthorizedError.js";
import { AuthEntity } from "../entity/auth-entity.js";
import { authRepository } from "../repository/auth-repository.js";
import { authService, hashPassword } from "../service/auth-service.js";

describe("authService.authenticate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the user when credentials are valid", async () => {
    const user: AuthEntity = {
      id: "user-1",
      email: "owner@example.com",
      passwordHash: hashPassword("Password123!", "testsalttestsalt"),
      role: "admin"
    };

    vi.spyOn(authRepository, "findByEmail").mockResolvedValue(user);

    const result = await authService.authenticate({
      email: "owner@example.com",
      password: "Password123!"
    });

    expect(result.id).toBe("user-1");
    expect(result.role).toBe("admin");
  });

  it("throws unauthorized when credentials are invalid", async () => {
    vi.spyOn(authRepository, "findByEmail").mockResolvedValue(null);

    await expect(
      authService.authenticate({
        email: "owner@example.com",
        password: "bad-password"
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
`,
  "src/modules/auth/tests/auth.validation.test.ts": `import { describe, expect, it } from "vitest";
import { loginInputSchema } from "../schema/auth-schema.js";

describe("auth validation", () => {
  it("rejects invalid login payloads", () => {
    const parsed = loginInputSchema.safeParse({
      email: "not-an-email",
      password: "short"
    });

    expect(parsed.success).toBe(false);
  });
});
`,
  "src/app.ts": `import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { allowedCorsOrigins, env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler } from "./errors/errorHandler.js";
import { requireAuth } from "./middleware/auth-middleware.js";
import { loginController } from "./modules/auth/controller/auth-controller.js";

export function buildApp() {
  const app = Fastify({
    loggerInstance: logger
  });

  app.register(helmet);
  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });
  app.register(cors, {
    origin: allowedCorsOrigins,
    credentials: true
  });
  app.register(jwt, {
    secret: env.JWT_SECRET
  });

  app.setErrorHandler(errorHandler);

  app.get("/health", async () => {
    return {
      ok: true,
      environment: env.NODE_ENV
    };
  });

  app.post("/auth/login", loginController);
  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const payload = await request.jwtVerify<{
      sub: string;
      role: string;
    }>();

    return {
      id: payload.sub,
      role: payload.role
    };
  });

  return app;
}

export const app = buildApp();
`,
  "src/server.ts": `import { app } from "./app.js";
import { env } from "./config/env.js";

async function start(): Promise<void> {
  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0"
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
    process.exit();
  }
}

void start();
`,
  "tests/integration/health.test.ts": `import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

let app = buildApp();

describe("health endpoint", () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
  });
});
`
};

const saasStarter = {
  "README.md": `# SaaS Starter\n\nGenerated by deeprun.\n\n## Scripts\n- npm install\n- npm run dev\n\n## Notes\nThis scaffold is intentionally minimal and ready for iterative AI edits.\n`,
  "package.json": `{
  "name": "saas-starter",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.2",
    "vite": "^6.2.0",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3"
  }
}
`,
  "src/main.tsx": `import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", margin: "2rem" }}>
      <h1>SaaS Starter</h1>
      <p>Start shaping your product with the builder chat.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SaaS Starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
};

const agentStarter = {
  "README.md": `# Agent Workflow Starter\n\nA baseline structure for multi-step AI workflows.\n`,
  "src/agent.ts": `export interface AgentTask {
  id: string;
  goal: string;
  steps: string[];
}

export async function runTask(task: AgentTask) {
  const startedAt = new Date().toISOString();
  return {
    task,
    startedAt,
    status: "pending-llm-integration"
  };
}
`,
  "src/index.ts": `import { runTask } from "./agent";

async function main() {
  const result = await runTask({
    id: "demo",
    goal: "Draft user onboarding",
    steps: ["Gather requirements", "Produce implementation plan"]
  });
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`
};

const chatbotStarter = {
  "README.md": `# Chatbot Starter\n\nAn API-first chatbot scaffold that can be extended by the builder.\n`,
  "src/server.ts": `import express from "express";

const app = express();
app.use(express.json());

app.post("/chat", (req, res) => {
  const message = String(req.body?.message ?? "");
  res.json({ reply: "Echo: " + message });
});

app.listen(4001, () => {
  console.log("Chatbot starter listening on http://localhost:4001");
});
`
};

export const templateCatalog: Record<ProjectTemplateId, ProjectTemplate> = {
  "canonical-backend": {
    id: "canonical-backend",
    name: "Canonical Backend",
    description: "Deterministic deeprun backend contract scaffold with strict layers and security baseline.",
    recommendedPrompt:
      "Build a production backend module with strict layering, typed errors, tests, and no architecture violations.",
    starterFiles: canonicalBackendStarter
  },
  "saas-web-app": {
    id: "saas-web-app",
    name: "SaaS Web App",
    description: "Frontend + API product skeleton for fast feature shipping.",
    recommendedPrompt:
      "Build a multi-tenant SaaS with auth, billing placeholder, dashboard analytics, and clean component architecture.",
    starterFiles: saasStarter
  },
  "agent-workflow": {
    id: "agent-workflow",
    name: "Agent Workflow",
    description: "Task-oriented orchestration skeleton for autonomous jobs.",
    recommendedPrompt:
      "Create a workflow engine with queueing, retries, and tool execution logs for each agent step.",
    starterFiles: agentStarter
  },
  chatbot: {
    id: "chatbot",
    name: "Chatbot API",
    description: "A minimal conversational API designed for iterative expansion.",
    recommendedPrompt:
      "Turn this into a retrieval-augmented chatbot with chat memory, moderation, and observability.",
    starterFiles: chatbotStarter
  }
};

export function listTemplates(): ProjectTemplate[] {
  return Object.values(templateCatalog);
}

export function getTemplate(templateId: ProjectTemplateId): ProjectTemplate {
  return templateCatalog[templateId];
}
