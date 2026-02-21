import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runModuleTestContractValidation } from "../test-contract-validator.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

test("test contract validator flags missing required module test cases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-test-contract-fail-"));

  try {
    await writeFixtureFiles(root, {
      "src/modules/orders/controller/orders-controller.ts": `
        import { requireAuth } from "../../../middleware/auth-middleware";
        export const ordersController = { requireAuth };
      `,
      "src/modules/orders/service/orders-service.ts": `
        import { NotFoundError } from "../../../errors/NotFoundError";
        export async function getOrderById(id: string) {
          throw new NotFoundError("Order not found.");
        }
      `,
      "src/modules/orders/tests/orders.service.test.ts": `
        import { getOrderById } from "../service/orders-service";
        describe("orders service", () => {
          it("service success", async () => {
            await Promise.resolve(getOrderById);
          });
        });
      `
    });

    const violations = await runModuleTestContractValidation(root);
    const ids = new Set(violations.map((entry) => entry.ruleId));

    assert.equal(ids.has("TEST.CONTRACT_SERVICE_FAILURE_REQUIRED"), true);
    assert.equal(ids.has("TEST.CONTRACT_VALIDATION_FAILURE_REQUIRED"), true);
    assert.equal(ids.has("TEST.CONTRACT_AUTH_BOUNDARY_REQUIRED"), true);
    assert.equal(ids.has("TEST.CONTRACT_NOTFOUND_CONFLICT_REQUIRED"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("test contract validator passes when required module test cases exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-test-contract-pass-"));

  try {
    await writeFixtureFiles(root, {
      "src/modules/users/controller/users-controller.ts": `
        import { requireAuth } from "../../../middleware/auth-middleware";
        export const usersController = { requireAuth };
      `,
      "src/modules/users/service/users-service.ts": `
        import { NotFoundError } from "../../../errors/NotFoundError";
        export async function getUserById(id: string) {
          if (!id) {
            throw new NotFoundError("User not found.");
          }
          return { id };
        }
      `,
      "src/modules/users/tests/users.service.test.ts": `
        import { getUserById } from "../service/users-service";
        describe("users service", () => {
          it("service success", async () => {
            const result = await getUserById("user-1");
            expect(result.id).toBe("user-1");
          });

          it("service failure", async () => {
            await expect(getUserById("")).rejects.toThrow("not found");
          });
        });
      `,
      "src/modules/users/tests/users.validation.test.ts": `
        describe("users validation", () => {
          it("validation failure for invalid payload", () => {
            expect(false).toBe(false);
          });
        });
      `,
      "src/modules/users/tests/users.auth-boundary.test.ts": `
        describe("users auth boundary", () => {
          it("requires auth and returns 401 when missing token", () => {
            expect(401).toBe(401);
          });
        });
      `,
      "src/modules/users/tests/users.not-found.test.ts": `
        describe("users not found", () => {
          it("returns not found", () => {
            expect("not found").toContain("not found");
          });
        });
      `
    });

    const violations = await runModuleTestContractValidation(root);
    assert.equal(violations.length, 0, JSON.stringify(violations, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
