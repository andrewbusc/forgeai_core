import {
  PlannerCorrectionConstraint,
  PlannerCorrectionIntent,
  PlannerFailureDiagnostic,
  PlannerFailureReport
} from "../types.js";

type CorrectionPhase = "goal" | "optimization";

interface CorrectionLimitConfig {
  maxFilesPerStep: number;
  maxTotalDiffBytes: number;
}

export interface CorrectionFailureClassificationInput {
  phase: CorrectionPhase;
  failedStepId: string;
  attempt: number;
  runtimeLogs: string;
  failureReport?: PlannerFailureReport;
  limits?: Partial<CorrectionLimitConfig>;
}

export interface CorrectionFailureClassification {
  intent: PlannerCorrectionIntent;
  constraint: PlannerCorrectionConstraint;
  failureKinds: PlannerFailureDiagnostic["kind"][];
  failedChecks: string[];
  rationale: string;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizePathPrefix(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    values.reduce((set, value) => {
      if (value) {
        set.add(value);
      }
      return set;
    }, new Set<string>())
  );
}

function parseFailedChecks(summary: string | undefined): string[] {
  const raw = String(summary || "");
  const match = raw.match(/failed checks:\s*([^;]+)/i);
  if (!match) {
    return [];
  }

  return uniqueStrings(
    match[1]
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveLimits(input?: Partial<CorrectionLimitConfig>): CorrectionLimitConfig {
  const defaultMaxFiles = 15;
  const defaultMaxBytes = 400_000;

  return {
    maxFilesPerStep: clampInt(Number(input?.maxFilesPerStep || defaultMaxFiles), 1, 100),
    maxTotalDiffBytes: clampInt(Number(input?.maxTotalDiffBytes || defaultMaxBytes), 1_000, 5_000_000)
  };
}

function hasRuntimeBootSignal(logs: string): boolean {
  return /startup|health|listen|eaddrinuse|auth_token_secret|boot|runtime|preview/i.test(logs);
}

function hasRuntimeHealthSignal(logs: string): boolean {
  return /health|\/health|status=5\d\d|unhealthy|readiness|liveness/i.test(logs);
}

function chooseIntent(input: {
  phase: CorrectionPhase;
  failureKinds: PlannerFailureDiagnostic["kind"][];
  failedChecks: string[];
  runtimeLogs: string;
}): PlannerCorrectionIntent {
  const kinds = new Set(input.failureKinds);
  const checks = new Set(input.failedChecks);

  if (input.phase === "optimization") {
    if (checks.has("architecture")) {
      return "architecture_violation";
    }

    if (checks.has("production_config") || checks.has("security")) {
      return "security_baseline";
    }
  }

  if (kinds.has("migration")) {
    return "migration_failure";
  }

  if (kinds.has("typescript")) {
    return "typescript_compile";
  }

  if (kinds.has("test")) {
    return "test_failure";
  }

  if (kinds.has("boot")) {
    return hasRuntimeHealthSignal(input.runtimeLogs) ? "runtime_health" : "runtime_boot";
  }

  if (hasRuntimeHealthSignal(input.runtimeLogs)) {
    return "runtime_health";
  }

  if (hasRuntimeBootSignal(input.runtimeLogs)) {
    return "runtime_boot";
  }

  return "unknown";
}

function minWithin(base: number, next: number): number {
  return Math.max(1, Math.min(base, next));
}

function buildConstraint(
  intent: PlannerCorrectionIntent,
  limits: CorrectionLimitConfig
): PlannerCorrectionConstraint {
  const baseMaxFiles = limits.maxFilesPerStep;
  const baseMaxBytes = limits.maxTotalDiffBytes;

  const map: Record<PlannerCorrectionIntent, PlannerCorrectionConstraint> = {
    runtime_boot: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 6),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 120_000),
      allowedPathPrefixes: [
        "src/",
        "src/config/",
        "src/errors/",
        "src/middleware/",
        "src/app.ts",
        "src/server.ts",
        "prisma/",
        "package.json",
        ".env.example",
        "Dockerfile"
      ],
      guidance: [
        "Fix startup/runtime boot blockers only.",
        "Prefer minimal config or entrypoint corrections.",
        "Do not refactor unrelated modules."
      ]
    },
    runtime_health: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 6),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 120_000),
      allowedPathPrefixes: [
        "src/",
        "src/app.ts",
        "src/server.ts",
        "src/middleware/",
        "src/config/",
        "tests/integration/",
        "package.json"
      ],
      guidance: [
        "Fix health/readiness behavior only.",
        "Do not broaden correction beyond runtime verification path."
      ]
    },
    typescript_compile: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 8),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 160_000),
      allowedPathPrefixes: ["src/", "tests/", "prisma/", "package.json", "tsconfig.json"],
      guidance: [
        "Address compile/type errors directly.",
        "Avoid broad rewrites unrelated to diagnostics."
      ]
    },
    test_failure: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 8),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 160_000),
      allowedPathPrefixes: ["src/", "tests/", "package.json"],
      guidance: [
        "Fix failing behavior and tests deterministically.",
        "Keep test contract invariants intact."
      ]
    },
    migration_failure: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 6),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 140_000),
      allowedPathPrefixes: ["prisma/", "src/db/", "src/config/", "package.json", ".env.example"],
      guidance: [
        "Fix migration/seed consistency and database config paths.",
        "Do not alter unrelated controller/service logic."
      ]
    },
    architecture_violation: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 12),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 220_000),
      allowedPathPrefixes: [
        "src/modules/",
        "src/middleware/",
        "src/errors/",
        "src/config/",
        "src/db/",
        "src/app.ts",
        "src/server.ts",
        "tests/"
      ],
      guidance: [
        "Prioritize layer contract and module-boundary fixes.",
        "Do not introduce new architecture drift."
      ]
    },
    security_baseline: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 10),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 180_000),
      allowedPathPrefixes: [
        "src/config/",
        "src/middleware/",
        "src/errors/",
        "src/modules/",
        "src/app.ts",
        "src/server.ts",
        ".env.example",
        "Dockerfile",
        ".dockerignore",
        "tests/"
      ],
      guidance: [
        "Fix security baseline gaps with explicit runtime guards.",
        "Preserve deterministic production-safe defaults."
      ]
    },
    unknown: {
      intent,
      maxFiles: minWithin(baseMaxFiles, 5),
      maxTotalDiffBytes: minWithin(baseMaxBytes, 100_000),
      allowedPathPrefixes: ["src/", "tests/", "prisma/", "package.json"],
      guidance: ["Apply a minimal correction scoped to diagnosed failures."]
    }
  };

  const selected = map[intent];

  return {
    ...selected,
    allowedPathPrefixes: uniqueStrings(selected.allowedPathPrefixes.map(normalizePathPrefix))
  };
}

export function classifyFailureForCorrection(
  input: CorrectionFailureClassificationInput
): CorrectionFailureClassification {
  const report = input.failureReport;
  const limits = resolveLimits(input.limits);
  const failedChecks = parseFailedChecks(report?.summary);
  const failureKinds = uniqueStrings((report?.failures || []).map((entry) => entry.kind)) as PlannerFailureDiagnostic["kind"][];
  const intent = chooseIntent({
    phase: input.phase,
    failureKinds,
    failedChecks,
    runtimeLogs: input.runtimeLogs || ""
  });
  const constraint = buildConstraint(intent, limits);
  const rationale = [
    `phase=${input.phase}`,
    `intent=${intent}`,
    `attempt=${input.attempt}`,
    failedChecks.length ? `checks=${failedChecks.join(",")}` : "checks=none",
    failureKinds.length ? `kinds=${failureKinds.join(",")}` : "kinds=none"
  ].join(" ");

  return {
    intent,
    constraint,
    failureKinds,
    failedChecks,
    rationale
  };
}
