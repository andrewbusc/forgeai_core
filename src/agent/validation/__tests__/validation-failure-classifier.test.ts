import assert from "node:assert/strict";
import test from "node:test";
import { classifyPrecommitInvariantFailure, classifyValidationFailure } from "../validation-failure-classifier.js";

test("classifies architecture failures and extracts module names", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: false,
      blockingCount: 24,
      checks: [
        {
          id: "architecture",
          status: "fail",
          details: {
            violations: [
              {
                file: "src/modules/project/service/project-service.ts",
                target: "src/modules/audit/service/audit-service.ts",
                message: "Cross-module import from 'project' to 'audit' is not allowed.",
                ruleId: "ARCH.MODULE_ISOLATION"
              },
              {
                file: "src/modules/task/tests",
                message: "Module 'task' must define tests under 'src/modules/task/tests'.",
                ruleId: "TEST.CONTRACT_TEST_DIR_REQUIRED"
              }
            ]
          }
        },
        { id: "typecheck", status: "fail" }
      ]
    }
  });

  assert.deepEqual(profile, {
    shouldAutoCorrect: true,
    clusters: [
      {
        type: "architecture_contract",
        modules: ["audit", "project", "task"]
      },
      {
        type: "typecheck_failure"
      }
    ],
    architectureCollapse: false,
    reason: "architecture",
    blockingCount: 24,
    architectureModules: ["audit", "project", "task"]
  });
});

test("classifies typecheck failure when architecture passes", () => {
  const profile = classifyValidationFailure({
    ok: false,
    blockingCount: 2,
    checks: [
      { id: "architecture", status: "pass" },
      { id: "typecheck", status: "fail", details: { exitCode: 2 } },
      { id: "build", status: "fail", details: { exitCode: 2 } }
    ]
  });

  assert.deepEqual(profile, {
    shouldAutoCorrect: true,
    clusters: [{ type: "typecheck_failure" }, { type: "build_failure" }],
    architectureCollapse: false,
    reason: "typecheck",
    blockingCount: 2
  });
});

test("classifies build failure when architecture and typecheck do not fail", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: false,
      blockingCount: 1,
      checks: [
        { id: "architecture", status: "pass" },
        { id: "typecheck", status: "pass" },
        { id: "build", status: "fail", details: { exitCode: 2 } }
      ]
    }
  });

  assert.deepEqual(profile, {
    shouldAutoCorrect: true,
    clusters: [{ type: "build_failure" }],
    architectureCollapse: false,
    reason: "build",
    blockingCount: 1
  });
});

test("classifies precommit invariant import failures for module-local dto repair", () => {
  const profile = classifyPrecommitInvariantFailure({
    blockingCount: 1,
    violations: [
      {
        ruleId: "INVARIANT.IMPORT_MISSING_TARGET",
        file: "src/modules/project/service/project-service.ts",
        target: "../dto/project-dto.js",
        message:
          "Import target '../dto/project-dto.js' could not be resolved. If you import a module-local dto/ or schema/ file, create or repair that canonical file in the same module."
      }
    ]
  });

  assert.deepEqual(profile, {
    shouldAutoCorrect: true,
    clusters: [
      {
        type: "architecture_contract",
        modules: ["project"]
      },
      {
        type: "import_resolution_error",
        files: ["src/modules/project/service/project-service.ts"],
        imports: ["../dto/project-dto.js"]
      }
    ],
    architectureCollapse: false,
    reason: "architecture",
    blockingCount: 1,
    architectureModules: ["project"]
  });
});

test("classifies multi-cluster runtime middleware failures alongside architecture and tests", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: false,
      blockingCount: 14,
      checks: [
        {
          id: "architecture",
          status: "fail",
          message: "Light architecture validation failed.",
          details: {
            violations: [
              {
                file: "src/modules/audit/prisma-middleware.ts",
                ruleId: "ARCH.UNKNOWN_LAYER",
                message: "Unknown layer folder 'prisma-middleware.ts'."
              },
              {
                file: "src/db/prisma.ts",
                ruleId: "GRAPH.CYCLE",
                message:
                  "Circular dependency detected: src/db/prisma.ts -> src/modules/audit/prisma-middleware.ts -> src/modules/audit/repository/audit-repository.ts -> src/db/prisma.ts"
              },
              {
                file: "src/modules/audit/controller",
                ruleId: "STRUCTURE.MODULE_LAYER_REQUIRED",
                message: "Module 'audit' is missing required layer directory 'controller'."
              }
            ]
          }
        },
        { id: "typecheck", status: "fail", details: { exitCode: 2 } },
        { id: "build", status: "fail", details: { exitCode: 2 } },
        {
          id: "tests",
          status: "fail",
          details: {
            exitCode: 1,
            stderr: "TypeError: prisma.$use is not a function\n at src/db/prisma.ts:20:8"
          }
        }
      ]
    }
  });

  assert.equal(profile.shouldAutoCorrect, true);
  assert.equal(profile.reason, "architecture");
  assert.equal(profile.blockingCount, 14);
  assert.equal(profile.architectureCollapse, true);
  assert.deepEqual(profile.architectureModules, ["audit"]);
  assert.deepEqual(profile.clusters, [
    {
      type: "architecture_contract",
      modules: ["audit"],
      missingLayers: ["controller"],
      unknownLayerFiles: ["prisma-middleware.ts"]
    },
    {
      type: "dependency_cycle",
      cycles: [
        "Circular dependency detected: src/db/prisma.ts -> src/modules/audit/prisma-middleware.ts -> src/modules/audit/repository/audit-repository.ts -> src/db/prisma.ts"
      ]
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
  ]);
});

test("classifies micro-scoped architecture repair clusters and file scope", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: false,
      blockingCount: 10,
      checks: [
        {
          id: "architecture",
          status: "fail",
          details: {
            violations: [
              {
                file: "src/db/prisma.ts",
                target: "src/modules/audit/middleware/audit-middleware.ts",
                ruleId: "ARCH.LAYER_MATRIX",
                message: "Layer 'db' cannot import layer 'middleware'."
              },
              {
                file: "src/modules/audit/middleware/audit-middleware.ts",
                target: "src/modules/audit/repository/audit-repository.ts",
                ruleId: "ARCH.LAYER_MATRIX",
                message: "Layer 'middleware' cannot import layer 'repository'."
              },
              {
                file: "src/modules/audit/repository/audit-repository.ts",
                target: "../../db/prisma.js",
                ruleId: "IMPORT.MISSING_TARGET",
                message: "Missing import target for '../../db/prisma.js'."
              },
              {
                file: "src/modules/audit/tests",
                ruleId: "TEST.CONTRACT_SERVICE_FAILURE_REQUIRED",
                message: "Module 'audit' is missing a service failure test case."
              },
              {
                file: "src/modules/audit/tests",
                ruleId: "TEST.CONTRACT_VALIDATION_FAILURE_REQUIRED",
                message: "Module 'audit' is missing a validation failure test case."
              }
            ]
          }
        },
        { id: "typecheck", status: "fail", details: { exitCode: 2 } },
        { id: "build", status: "fail", details: { exitCode: 2 } },
        {
          id: "tests",
          status: "fail",
          details: {
            exitCode: 1,
            stderr:
              "Error: Cannot find module '../../db/prisma.js' imported from '/tmp/src/modules/audit/repository/audit-repository.ts'"
          }
        },
        {
          id: "boot",
          status: "fail",
          details: {
            logs:
              "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/dist/src/modules/db/prisma.js' imported from /tmp/dist/src/modules/audit/repository/audit-repository.js"
          }
        }
      ]
    }
  });

  assert.equal(profile.shouldAutoCorrect, true);
  assert.equal(profile.reason, "architecture");
  assert.equal(profile.blockingCount, 10);
  assert.equal(profile.architectureCollapse, false);
  assert.deepEqual(profile.architectureModules, ["audit"]);
  assert.deepEqual(profile.clusters, [
    {
      type: "architecture_contract",
      modules: ["audit"]
    },
    {
      type: "layer_boundary_violation",
      files: ["src/db/prisma.ts", "src/modules/audit/middleware/audit-middleware.ts"],
      edges: [
        {
          file: "src/db/prisma.ts",
          sourceLayer: "db",
          targetLayer: "middleware",
          target: "src/modules/audit/middleware/audit-middleware.ts"
        },
        {
          file: "src/modules/audit/middleware/audit-middleware.ts",
          sourceLayer: "middleware",
          targetLayer: "repository",
          target: "src/modules/audit/repository/audit-repository.ts"
        }
      ]
    },
    {
      type: "import_resolution_error",
      files: [
        "/tmp/src/modules/audit/repository/audit-repository.ts",
        "src/modules/audit/repository/audit-repository.ts"
      ],
      imports: ["../../db/prisma.js", "/tmp/dist/src/modules/db/prisma.js"]
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
});

test("does not trigger architecture collapse from architecture blocking count alone", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: false,
      blockingCount: 12,
      checks: [
        {
          id: "architecture",
          status: "fail",
          details: {
            blockingCount: 12,
            violations: [
              {
                file: "src/modules/audit/controller",
                ruleId: "STRUCTURE.MODULE_LAYER_REQUIRED",
                message: "Module 'audit' is missing required layer directory 'controller'."
              }
            ]
          }
        }
      ]
    }
  });

  assert.equal(profile.reason, "architecture");
  assert.equal(profile.architectureCollapse, false);
});

test("triggers architecture collapse when multiple structural signals combine", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: false,
      blockingCount: 4,
      checks: [
        {
          id: "architecture",
          status: "fail",
          details: {
            blockingCount: 4,
            violations: [
              {
                file: "src/modules/audit/controller",
                ruleId: "STRUCTURE.MODULE_LAYER_REQUIRED",
                message: "Module 'audit' is missing required layer directory 'controller'."
              },
              {
                file: "src/modules/audit/service",
                ruleId: "STRUCTURE.MODULE_LAYER_REQUIRED",
                message: "Module 'audit' is missing required layer directory 'service'."
              },
              {
                file: "src/modules/audit/prisma-middleware.ts",
                ruleId: "ARCH.UNKNOWN_LAYER",
                message: "Unknown layer folder 'prisma-middleware.ts'."
              },
              {
                file: "src/modules/audit/custom-pipeline.ts",
                ruleId: "ARCH.UNKNOWN_LAYER",
                message: "Unknown layer folder 'custom-pipeline.ts'."
              }
            ]
          }
        }
      ]
    }
  });

  assert.equal(profile.reason, "architecture");
  assert.equal(profile.architectureCollapse, true);
});

test("does not auto-correct when validation passes", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: true,
      blockingCount: 0,
      checks: [{ id: "architecture", status: "pass" }]
    }
  });

  assert.deepEqual(profile, {
    shouldAutoCorrect: false,
    clusters: [],
    architectureCollapse: false,
    reason: null,
    blockingCount: 0
  });
});

test("ignores unsupported failed checks for v1", () => {
  const profile = classifyValidationFailure({
    validation: {
      ok: false,
      blockingCount: 3,
      checks: [
        { id: "install", status: "fail" },
        { id: "boot", status: "fail" },
        { id: "seed", status: "fail" }
      ]
    }
  });

  assert.deepEqual(profile, {
    shouldAutoCorrect: false,
    clusters: [],
    architectureCollapse: false,
    reason: null,
    blockingCount: 3
  });
});
