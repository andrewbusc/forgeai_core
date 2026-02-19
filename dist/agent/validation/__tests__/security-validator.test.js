import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSecurityBaselineValidation } from "../security-validator.js";
async function createProject(files) {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeai-security-validation-"));
    for (const [relativePath, content] of Object.entries(files)) {
        const absolute = path.join(root, relativePath);
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, content, "utf8");
    }
    return root;
}
test("missing security controls are flagged", async () => {
    const root = await createProject({
        "src/server.ts": `
      import express from "express";
      const app = express();
      app.get("/health", (_req, res) => res.json({ ok: true }));
    `
    });
    try {
        const violations = await runSecurityBaselineValidation(root);
        const ids = new Set(violations.map((entry) => entry.ruleId));
        assert.equal(ids.has("SEC.HELMET_REQUIRED"), true);
        assert.equal(ids.has("SEC.RATE_LIMIT_REQUIRED"), true);
        assert.equal(ids.has("SEC.INPUT_VALIDATION_REQUIRED"), true);
        assert.equal(ids.has("SEC.ENV_VALIDATION_REQUIRED"), true);
        assert.equal(ids.has("SEC.PASSWORD_HASHING_REQUIRED"), true);
        assert.equal(ids.has("SEC.JWT_SECRET_VALIDATION_REQUIRED"), true);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("security baseline passes when required controls exist", async () => {
    const root = await createProject({
        "src/server.ts": `
      import helmet from "helmet";
      import cors from "cors";
      import { z } from "zod";

      const loginSchema = z.object({ email: z.string().email() });
      loginSchema.parse({ email: "test@example.com" });

      function enforceRateLimit(): void {}
      enforceRateLimit();
      cors({ origin: ["https://example.com"], credentials: true });
      helmet();
    `,
        "src/config/env.ts": `
      const token = process.env.AUTH_TOKEN_SECRET;
      if (!token) {
        throw new Error("AUTH_TOKEN_SECRET is required.");
      }
    `,
        "src/lib/auth.ts": `
      import { scrypt } from "node:crypto";
      export function hashPassword(): typeof scrypt {
        return scrypt;
      }
    `,
        "src/lib/tokens.ts": `
      const tokenSecret = process.env.AUTH_TOKEN_SECRET;
      if (!tokenSecret) {
        throw new Error("AUTH_TOKEN_SECRET is required.");
      }
      export const jwt = tokenSecret;
    `
    });
    try {
        const violations = await runSecurityBaselineValidation(root);
        assert.equal(violations.length, 0);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
