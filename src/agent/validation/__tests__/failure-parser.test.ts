import assert from "node:assert/strict";
import test from "node:test";
import { parseCommandFailures } from "../failure-parser.js";

test("parses TypeScript diagnostics", () => {
  const combined = `
src/server.ts(42,17): error TS2322: Type 'number' is not assignable to type 'string'.
src/app.ts(10,5): error TS2304: Cannot find name 'foo'.
`;

  const failures = parseCommandFailures({
    sourceCheckId: "typecheck",
    combined
  });

  assert.equal(failures.length >= 2, true);
  assert.equal(failures[0]?.kind, "typescript");
  assert.equal(failures[0]?.code, "TS2322");
  assert.equal(failures[0]?.file, "src/server.ts");
  assert.equal(failures[0]?.line, 42);
  assert.equal(failures[0]?.column, 17);
});

test("parses test failures with location", () => {
  const combined = `
✖ failing tests:
test at src/agent/__tests__/kernel-run-flow.test.ts:2:1375
✖ fork -> validate -> resume flow (3215.761372ms)
AssertionError [ERR_ASSERTION]: expected true to equal false
`;

  const failures = parseCommandFailures({
    sourceCheckId: "tests",
    combined
  });

  assert.equal(failures.length > 0, true);
  assert.equal(failures[0]?.kind, "test");
  assert.equal(failures.some((entry) => entry.file === "src/agent/__tests__/kernel-run-flow.test.ts"), true);
});

test("parses boot failures", () => {
  const combined = `
Error: AUTH_TOKEN_SECRET is required.
    at file:///repo/dist/lib/tokens.js:4:11
`;

  const failures = parseCommandFailures({
    sourceCheckId: "boot",
    combined
  });

  assert.equal(failures.length > 0, true);
  assert.equal(failures[0]?.kind, "boot");
  assert.equal(failures[0]?.message.includes("AUTH_TOKEN_SECRET"), true);
  assert.equal(failures[0]?.file, "file:///repo/dist/lib/tokens.js");
});

test("parses migration failures", () => {
  const combined = `
Prisma schema loaded from prisma/schema.prisma
Error: P3009
migrate found failed migrations in the target database.
`;

  const failures = parseCommandFailures({
    sourceCheckId: "migration",
    combined
  });

  assert.equal(failures.length > 0, true);
  assert.equal(failures[0]?.kind, "migration");
  assert.equal(failures[0]?.code, "P3009");
});
