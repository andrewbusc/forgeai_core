import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GraphBuilder } from "../graph-builder.js";

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

test("graph builder enforces cycle, layer matrix, module isolation, alias policy, and missing targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-graph-enforcement-"));

  try {
    await writeFixtureFiles(root, {
      "src/modules/users/service/users-service.ts": `
        import { repo } from "../repository/users-repository";
        import { billing } from "../../billing/service/billing-service";
        import { aliasThing } from "@/modules/users/service/alias-target";
        import { missing } from "./missing";
        export const users = { repo, billing, aliasThing, missing };
      `,
      "src/modules/users/repository/users-repository.ts": `
        import { users } from "../service/users-service";
        export const repo = users;
      `,
      "src/modules/users/service/alias-target.ts": `
        export const aliasThing = true;
      `,
      "src/modules/billing/service/billing-service.ts": `
        export const billing = true;
      `
    });

    const result = await new GraphBuilder({ projectRoot: root }).build();
    const ids = new Set(result.violations.map((entry) => entry.ruleId));

    assert.equal(ids.has("IMPORT.NON_RELATIVE"), true);
    assert.equal(ids.has("IMPORT.MISSING_TARGET"), true);
    assert.equal(ids.has("ARCH.LAYER_MATRIX"), true);
    assert.equal(ids.has("ARCH.MODULE_ISOLATION"), true);
    assert.equal(ids.has("GRAPH.CYCLE"), true);

    assert.equal(result.cycles.length > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("graph builder flags tsconfig path-alias/baseUrl configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-graph-tsconfig-"));

  try {
    await writeFixtureFiles(root, {
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            baseUrl: "src",
            paths: {
              "@core/*": ["src/modules/core/*"]
            }
          }
        },
        null,
        2
      ),
      "src/modules/core/service/core-service.ts": `
        export const coreService = true;
      `,
      "src/modules/users/service/users-service.ts": `
        import { coreService } from "@core/service/core-service";
        export const usersService = coreService;
      `
    });

    const result = await new GraphBuilder({ projectRoot: root }).build();
    const ids = new Set(result.violations.map((entry) => entry.ruleId));

    assert.equal(ids.has("IMPORT.PATH_ALIAS_CONFIG"), true);
    assert.equal(ids.has("IMPORT.NON_RELATIVE"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("graph builder output is deterministic across repeated builds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeprun-graph-deterministic-"));

  try {
    await writeFixtureFiles(root, {
      "src/modules/users/service/users-service.ts": `
        import { repo } from "../repository/users-repository";
        export const users = repo;
      `,
      "src/modules/users/repository/users-repository.ts": `
        export const repo = true;
      `,
      "src/modules/users/controller/users-controller.ts": `
        import { users } from "../service/users-service";
        export const controller = users;
      `
    });

    const first = await new GraphBuilder({ projectRoot: root }).build();
    const second = await new GraphBuilder({ projectRoot: root }).build();

    assert.equal(JSON.stringify(first), JSON.stringify(second));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
