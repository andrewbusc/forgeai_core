import assert from "node:assert/strict";
import test from "node:test";
import { AgentPlanner } from "../planner.js";

test("planCorrection returns a two-step structured correction plan when architecture collapse is detected", async () => {
  const planner = new AgentPlanner();

  const plan = await planner.planCorrection({
    originalIntent: "Add audit logging for project and task create/update/delete actions with tests",
    validationSummary: "failed checks: architecture, typecheck, build; blocking=24; warnings=0",
    correctionProfile: {
      shouldAutoCorrect: true,
      architectureCollapse: true,
      clusters: [
        {
          type: "architecture_contract",
          modules: ["audit", "project", "task"],
          missingLayers: ["controller", "dto"],
          unknownLayerFiles: ["prisma-middleware.ts"]
        },
        {
          type: "dependency_cycle",
          cycles: ["src/db/prisma.ts -> src/modules/audit/prisma-middleware.ts -> src/db/prisma.ts"]
        },
        {
          type: "runtime_middleware_api",
          message: "TypeError: prisma.$use is not a function"
        },
        {
          type: "typecheck_failure"
        },
        {
          type: "build_failure"
        },
        {
          type: "test_failure"
        }
      ],
      reason: "architecture",
      blockingCount: 24,
      architectureModules: ["audit", "project", "task"]
    }
  });

  assert.equal(plan.goal, "Add audit logging for project and task create/update/delete actions with tests");
  assert.equal(plan.steps.length, 2);

  const [phase1, phase2] = plan.steps;
  assert.ok(phase1);
  assert.ok(phase2);
  for (const step of [phase1, phase2]) {
    assert.equal(step?.type, "modify");
    assert.equal(step?.tool, "ai_mutation");
    assert.equal(step?.mutates, true);
    assert.equal(typeof step?.id, "string");
    assert.equal((step?.id || "").length > 0, true);
    assert.equal(step?.input.mode, "correction");
  }

  assert.equal(phase1?.input.phase, "structural_reset");
  assert.equal(phase2?.input.phase, "feature_reintegration");
  assert.equal(
    phase1?.input.originalIntent,
    "Add audit logging for project and task create/update/delete actions with tests"
  );
  assert.equal(phase1?.input.validationSummary, "failed checks: architecture, typecheck, build; blocking=24; warnings=0");
  assert.deepEqual(phase1?.input.correctionProfile, {
    shouldAutoCorrect: true,
    architectureCollapse: true,
    clusters: [
      {
        type: "architecture_contract",
        modules: ["audit", "project", "task"],
        missingLayers: ["controller", "dto"],
        unknownLayerFiles: ["prisma-middleware.ts"]
      },
      {
        type: "dependency_cycle",
        cycles: ["src/db/prisma.ts -> src/modules/audit/prisma-middleware.ts -> src/db/prisma.ts"]
      },
      {
        type: "runtime_middleware_api",
        message: "TypeError: prisma.$use is not a function"
      },
      {
        type: "typecheck_failure"
      },
      {
        type: "build_failure"
      },
      {
        type: "test_failure"
      }
    ],
    reason: "architecture",
    blockingCount: 24,
    architectureModules: ["audit", "project", "task"]
  });

  assert.equal(typeof phase1?.input.prompt, "string");
  assert.equal(typeof phase2?.input.prompt, "string");
  const phase1Prompt = String(phase1?.input.prompt || "");
  const phase2Prompt = String(phase2?.input.prompt || "");

  assert.equal(phase1Prompt.includes("Phase 1"), true);
  assert.equal(phase1Prompt.includes("structural_reset"), true);
  assert.equal(phase1Prompt.includes("controller/, service/, repository/, schema/, dto/, tests/"), true);
  assert.equal(phase1Prompt.includes("Do NOT implement full audit logging logic yet"), true);
  assert.equal(phase1Prompt.includes("dependency_cycle"), true);

  assert.equal(phase2Prompt.includes("Phase 2"), true);
  assert.equal(phase2Prompt.includes("feature_reintegration"), true);
  assert.equal(phase2Prompt.includes("Do NOT modify module structure created in phase 1"), true);
  assert.equal(phase2Prompt.includes("If code imports a module-local dto/ or schema/ file"), true);
  assert.equal(phase2Prompt.includes("Do NOT satisfy service-layer test requirements by importing another module's service"), true);
  assert.equal(phase2Prompt.includes("Ensure typecheck, build, Vitest tests, and /health boot succeed"), true);
});

test("planCorrection falls back to single-step correction when collapse condition is not present", async () => {
  const planner = new AgentPlanner();

  const plan = await planner.planCorrection({
    originalIntent: "Fix TypeScript errors",
    validationSummary: "failed checks: typecheck, build; blocking=2; warnings=0",
    correctionProfile: {
      shouldAutoCorrect: true,
      architectureCollapse: false,
      clusters: [{ type: "typecheck_failure" }, { type: "build_failure" }],
      reason: "typecheck",
      blockingCount: 2
    }
  });

  assert.equal(plan.steps.length, 1);
  const step = plan.steps[0];
  assert.equal(step?.tool, "ai_mutation");
  assert.equal(step?.input.mode, "correction");
  assert.equal(step?.input.phase, undefined);
  const prompt = String(step?.input.prompt || "");
  assert.equal(prompt.includes("resolve ALL of these in one correction pass"), true);
});

test("planCorrection emits micro-targeted repair when remaining failures are scoped", async () => {
  const planner = new AgentPlanner();

  const plan = await planner.planCorrection({
    originalIntent: "Add audit logging",
    validationSummary: "failed checks: architecture, typecheck, build, tests, boot; blocking=9; warnings=0",
    correctionProfile: {
      shouldAutoCorrect: true,
      architectureCollapse: false,
      clusters: [
        {
          type: "architecture_contract",
          modules: ["audit"]
        },
        {
          type: "layer_boundary_violation",
          files: ["src/db/prisma.ts", "src/modules/audit/middleware/audit-middleware.ts"]
        },
        {
          type: "import_resolution_error",
          files: [
            "src/modules/audit/repository/audit-repository.ts",
            "/app/worktrees/foo/.deeprun/validation/heavy-abc/src/modules/audit/repository/audit-repository.ts",
            "/tmp/src/modules/auth/repository/auth-repository.ts",
            "/tmp/dist/src/modules/db/prisma.js",
            "/tmp/node_modules/pkg/index.js"
          ],
          imports: ["../../db/prisma.js"]
        },
        {
          type: "test_contract_gap",
          modules: ["audit"]
        },
        {
          type: "runtime_middleware_api",
          message: "Failed Suites 4"
        },
        {
          type: "typecheck_failure"
        },
        {
          type: "build_failure"
        },
        {
          type: "test_failure"
        }
      ],
      reason: "architecture",
      blockingCount: 9,
      architectureModules: ["audit"]
    }
  });

  assert.equal(plan.steps.length, 1);
  const step = plan.steps[0];
  assert.equal(step?.tool, "ai_mutation");
  assert.equal(step?.type, "modify");
  assert.equal(step?.mutates, true);
  assert.equal(step?.input.mode, "correction");
  assert.equal(step?.input.phase, "micro_targeted_repair");
  assert.deepEqual(step?.input.allowedFiles, [
    "src/db/prisma.ts",
    "src/modules/audit/controller",
    "src/modules/audit/dto",
    "src/modules/audit/middleware/audit-middleware.ts",
    "src/modules/audit/repository",
    "src/modules/audit/repository/audit-repository.ts",
    "src/modules/audit/schema",
    "src/modules/audit/service",
    "src/modules/audit/tests",
    "src/modules/auth/repository/auth-repository.ts"
  ]);
  assert.deepEqual(step?.input.repairScope, [
    {
      type: "layer_boundary_violation",
      files: ["src/db/prisma.ts", "src/modules/audit/middleware/audit-middleware.ts"]
    },
    {
      type: "import_resolution_error",
      files: [
        "src/modules/audit/repository/audit-repository.ts",
        "/app/worktrees/foo/.deeprun/validation/heavy-abc/src/modules/audit/repository/audit-repository.ts",
        "/tmp/src/modules/auth/repository/auth-repository.ts",
        "/tmp/dist/src/modules/db/prisma.js",
        "/tmp/node_modules/pkg/index.js"
      ],
      imports: ["../../db/prisma.js"]
    },
    {
      type: "test_contract_gap",
      modules: ["audit"]
    },
    {
      type: "typecheck_failure"
    },
    {
      type: "build_failure"
    },
    {
      type: "test_failure"
    }
  ]);

  const prompt = String(step?.input.prompt || "");
  assert.equal(prompt.includes("micro_targeted_repair"), true);
  assert.equal(prompt.includes("You may only modify these files/paths:"), true);
  assert.equal(prompt.includes("src/modules/audit/repository/audit-repository.ts"), true);
  assert.equal(prompt.includes("create or repair that missing file"), true);
  assert.equal(prompt.includes("Do NOT satisfy service-layer test requirements by importing another module's service"), true);
  assert.equal(prompt.includes("Do NOT introduce malformed import specifiers"), true);
});
