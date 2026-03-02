import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AppStore } from "../lib/project-store.js";
import { resolveWorkspaceRoot } from "../lib/workspace.js";
import { type ScenarioLabel } from "./scenario-fixtures.js";
import {
  computeGateState,
  computeLegalSlowStats,
  DEFAULT_STRESS_GATE_THRESHOLDS,
  evaluateStressGate,
  type DebtPaydownStats,
  type LegalSlowStats,
  type StressEventRow,
  type StressGateThresholds
} from "./stress-gates.js";
import { createHarnessRuntime, runScenario } from "./utils.js";

const DEFAULT_SCENARIOS: ScenarioLabel[] = [
  ...Array(5).fill("architecture_contract"),
  ...Array(4).fill("typecheck_failure"),
  ...Array(4).fill("build_failure"),
  ...Array(2).fill("regression"),
  ...Array(2).fill("oscillation")
];

const DEBT_HEAVY_SCENARIOS: ScenarioLabel[] = [
  ...Array(2).fill("architecture_contract"),
  ...Array(2).fill("typecheck_failure"),
  ...Array(2).fill("build_failure"),
  ...Array(6).fill("regression"),
  ...Array(5).fill("oscillation")
];

const LEGAL_SLOW_SCENARIOS: ScenarioLabel[] = Array(20).fill("legal_slow_convergence");

function readFlagValue(args: string[], name: string): string | null {
  const exact = `--${name}`;
  const withEquals = args.find((arg) => arg.startsWith(`${exact}=`));
  if (withEquals) {
    return withEquals.slice(exact.length + 1);
  }

  const index = args.indexOf(exact);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1] ?? null;
  }

  return null;
}

function numberArg(args: string[], name: string, fallback: number): number {
  const value = readFlagValue(args, name);
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function stringArg(args: string[], name: string, fallback: string): string {
  const value = readFlagValue(args, name);
  return value && value.trim() ? value.trim() : fallback;
}

function numberSetting(args: string[], envKey: string, flag: string, fallback: number, minimum = 0): number {
  const cliValue = readFlagValue(args, flag);
  const raw = cliValue ?? process.env[envKey] ?? "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > minimum ? parsed : fallback;
}

function loadGateThresholds(args: string[]): StressGateThresholds {
  return {
    gateWindow: numberSetting(args, "DEEPRUN_STRESS_GATE_WINDOW", "gateWindow", DEFAULT_STRESS_GATE_THRESHOLDS.gateWindow),
    debtWindow: numberSetting(args, "DEEPRUN_STRESS_DEBT_WINDOW", "debtWindow", DEFAULT_STRESS_GATE_THRESHOLDS.debtWindow),
    clusterRegressionMax: numberSetting(
      args,
      "DEEPRUN_STRESS_CLUSTER_REGRESSION_MAX",
      "clusterRegressionMax",
      DEFAULT_STRESS_GATE_THRESHOLDS.clusterRegressionMax
    ),
    convergenceMin: numberSetting(
      args,
      "DEEPRUN_STRESS_CONVERGENCE_MIN",
      "convergenceMin",
      DEFAULT_STRESS_GATE_THRESHOLDS.convergenceMin
    ),
    fallbackAlertMax: numberSetting(
      args,
      "DEEPRUN_STRESS_FALLBACK_ALERT_MAX",
      "fallbackAlertMax",
      DEFAULT_STRESS_GATE_THRESHOLDS.fallbackAlertMax
    ),
    microStallRateMax: numberSetting(
      args,
      "DEEPRUN_STRESS_MICRO_STALL_RATE_MAX",
      "microStallRateMax",
      DEFAULT_STRESS_GATE_THRESHOLDS.microStallRateMax
    ),
    microStallMinRuns: numberSetting(
      args,
      "DEEPRUN_STRESS_MICRO_STALL_MIN_RUNS",
      "microStallMinRuns",
      DEFAULT_STRESS_GATE_THRESHOLDS.microStallMinRuns
    ),
    debtMinAttempts: numberSetting(
      args,
      "DEEPRUN_STRESS_DEBT_MIN_ATTEMPTS",
      "debtMinAttempts",
      DEFAULT_STRESS_GATE_THRESHOLDS.debtMinAttempts
    ),
    debtMinStubEvents: numberSetting(
      args,
      "DEEPRUN_STRESS_DEBT_MIN_STUB_EVENTS",
      "debtMinStubEvents",
      DEFAULT_STRESS_GATE_THRESHOLDS.debtMinStubEvents
    ),
    debtMinPaydownRate: numberSetting(
      args,
      "DEEPRUN_STRESS_DEBT_MIN_PAYDOWN_RATE",
      "debtMinPaydownRate",
      DEFAULT_STRESS_GATE_THRESHOLDS.debtMinPaydownRate
    ),
    legalSlowBlockingEpsilon: numberSetting(
      args,
      "DEEPRUN_STRESS_LEGAL_SLOW_EPSILON",
      "legalSlowEpsilon",
      DEFAULT_STRESS_GATE_THRESHOLDS.legalSlowBlockingEpsilon,
      -1
    )
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function scenarioPoolForSeed(seed: string): { profile: "default" | "debt-heavy" | "legal-slow"; scenarios: ScenarioLabel[] } {
  if (seed.startsWith("debt-heavy") || seed.startsWith("debt-negative")) {
    return {
      profile: "debt-heavy",
      scenarios: DEBT_HEAVY_SCENARIOS
    };
  }

  if (seed.startsWith("legal-slow")) {
    return {
      profile: "legal-slow",
      scenarios: LEGAL_SLOW_SCENARIOS
    };
  }

  return {
    profile: "default",
    scenarios: DEFAULT_SCENARIOS
  };
}

function pickScenario(rng: () => number, scenarios: ScenarioLabel[]): ScenarioLabel {
  const index = Math.floor(rng() * scenarios.length);
  return scenarios[Math.max(0, Math.min(index, scenarios.length - 1))];
}

async function loadSessionEvents(store: AppStore, sessionId: string, limit?: number): Promise<StressEventRow[]> {
  const limitClause = typeof limit === "number" ? `LIMIT ${Math.max(1, limit)}` : "";

  return store.query<StressEventRow>(
    `
      SELECT run_id, phase, outcome, delta, convergence_flag, regression_flag, clusters, metadata, created_at
             , blocking_before, blocking_after
      FROM learning_events
      WHERE metadata->>'stressSessionId' = $1
      ORDER BY created_at DESC
      ${limitClause}
    `,
    [sessionId]
  );
}

async function queryDebtPaydownStats(
  store: AppStore,
  sessionId: string,
  windowSize: number
): Promise<DebtPaydownStats> {
  const rows = await store.query<{
    debt_attempts: string;
    paid_down: string;
    stub_creates: string;
  }>(
    `
      WITH recent AS (
        SELECT phase, outcome, metadata
        FROM learning_events
        WHERE metadata->>'stressSessionId' = $1
        ORDER BY created_at DESC
        LIMIT $2
      )
      SELECT
        COUNT(*) FILTER (WHERE phase = 'debt_resolution')::text AS debt_attempts,
        COUNT(*) FILTER (
          WHERE phase = 'debt_resolution'
            AND COALESCE(metadata->>'stressNegativeControl', '') <> 'debt_paydown_failure'
            AND COALESCE(metadata->>'debtPaidDown', 'false') = 'true'
        )::text AS paid_down,
        COUNT(*) FILTER (WHERE outcome = 'provisionally_fixed')::text AS stub_creates
      FROM recent
    `,
    [sessionId, windowSize]
  );

  const row = rows[0] ?? {
    debt_attempts: "0",
    paid_down: "0",
    stub_creates: "0"
  };
  const debtAttempts = Number(row.debt_attempts || 0);
  const paidDown = Number(row.paid_down || 0);
  const stubCreates = Number(row.stub_creates || 0);

  return {
    debtAttempts,
    paidDown,
    stubCreates,
    paydownRate: debtAttempts > 0 ? paidDown / debtAttempts : 1
  };
}

async function writeStressSnapshot(input: {
  sessionId: string;
  rootDir: string;
  runCount: number;
  seed: string;
  allRows: StressEventRow[];
  recentRows: StressEventRow[];
  gateState: ReturnType<typeof computeGateState>;
  debtStats: DebtPaydownStats;
  legalSlowStats: LegalSlowStats;
  gateStop?: {
    gate: string;
    details: Record<string, unknown>;
  } | null;
}): Promise<void> {
  const sessionDir = path.join(input.rootDir, ".deeprun", "stress", input.sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  const snapshotPath = path.join(sessionDir, `window-${String(input.runCount).padStart(3, "0")}.json`);
  await fs.writeFile(
    snapshotPath,
    JSON.stringify(
      {
        sessionId: input.sessionId,
        seed: input.seed,
        runCount: input.runCount,
        totalEvents: input.allRows.length,
        recentWindowSize: input.recentRows.length,
        gateState: input.gateState,
        debt: {
          attempts: input.debtStats.debtAttempts,
          paidDown: input.debtStats.paidDown,
          stubCreates: input.debtStats.stubCreates,
          paydownRate: Number(input.debtStats.paydownRate.toFixed(3))
        },
        legalSlow: {
          eligible: input.legalSlowStats.eligible,
          accepted: input.legalSlowStats.accepted,
          paydownAccepted: input.legalSlowStats.paydownAccepted,
          boundedProgress: input.legalSlowStats.boundedProgress,
          epsilon: input.legalSlowStats.epsilon,
          blockingSeries: input.legalSlowStats.blockingSeries
        },
        gateStop: input.gateStop ?? null,
        createdAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );

  const exportPath = path.join(sessionDir, `learning_export_${String(input.runCount).padStart(3, "0")}.jsonl`);
  const content = input.allRows
    .slice()
    .reverse()
    .map((row) => JSON.stringify(row))
    .join("\n");
  await fs.writeFile(exportPath, content ? `${content}\n` : "", "utf8");
}

async function writeGateStop(input: {
  sessionId: string;
  rootDir: string;
  runCount: number;
  seed: string;
  gate: string;
  details: Record<string, unknown>;
}): Promise<void> {
  const sessionDir = path.join(input.rootDir, ".deeprun", "stress", input.sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  const artifactPath = path.join(sessionDir, `gate-stop-${String(input.runCount).padStart(3, "0")}.json`);
  await fs.writeFile(
    artifactPath,
    JSON.stringify(
      {
        sessionId: input.sessionId,
        seed: input.seed,
        runCount: input.runCount,
        gate: input.gate,
        details: input.details,
        createdAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seed = stringArg(args, "seed", "stress-default-seed");
  const maxRuns = numberArg(args, "maxRuns", 100);
  const snapshotEvery = numberArg(args, "snapshotEvery", 20);
  const thresholds = loadGateThresholds(args);
  const sessionId = randomUUID();
  const rng = createRng(seed);
  const scenarioPool = scenarioPoolForSeed(seed);
  const counts = new Map<ScenarioLabel, number>();
  const runtimeRoot = resolveWorkspaceRoot();
  const store = new AppStore();

  await store.initialize();

  try {
    const runtime = await createHarnessRuntime(store);
    console.log(
      JSON.stringify({
        sessionId,
        seed,
        maxRuns,
        snapshotEvery,
        profile: scenarioPool.profile,
        thresholds
      })
    );

    for (let runIndex = 1; runIndex <= maxRuns; runIndex += 1) {
      const label = pickScenario(rng, scenarioPool.scenarios);
      const occurrence = (counts.get(label) ?? 0) + 1;
      counts.set(label, occurrence);

      const result = await runScenario(runtime, label, occurrence, {
        metadata: {
          stressSessionId: sessionId,
          stressSeed: seed,
          stressOrdinal: runIndex,
          ...(seed.startsWith("debt-negative")
            ? {
                stressNegativeControl: "debt_paydown_failure"
              }
            : {})
        }
      });

      console.log(
        JSON.stringify({
          runIndex,
          label: result.label,
          occurrence: result.occurrence,
          runId: result.runId,
          projectId: result.projectId,
          status: result.status,
          validationStatus: result.validationStatus,
          correctionAttempts: result.correctionAttempts,
          learningEventCount: result.learningEventCount
        })
      );

      const recent = await loadSessionEvents(store, sessionId, thresholds.gateWindow);
      if (recent.length >= thresholds.gateWindow) {
        const gateState = computeGateState(recent);
        const debtStats = await queryDebtPaydownStats(store, sessionId, thresholds.debtWindow);
        const legalSlowStats = computeLegalSlowStats({
          recent,
          debtStats,
          thresholds
        });
        const gateStop = evaluateStressGate({
          gateState,
          debtStats,
          thresholds,
          legalSlowStats
        });

        if (gateStop) {
          const allRows = await loadSessionEvents(store, sessionId);
          await writeStressSnapshot({
            sessionId,
            rootDir: runtimeRoot,
            runCount: runIndex,
            seed,
            allRows,
            recentRows: recent,
            gateState,
            debtStats,
            legalSlowStats,
            gateStop: {
              gate: gateStop.gate,
              details: gateStop.details
            }
          });
          await writeGateStop({
            sessionId,
            rootDir: runtimeRoot,
            runCount: runIndex,
            seed,
            gate: gateStop.gate,
            details: gateStop.details
          });
          throw new Error(gateStop.message);
        }

        const fallbackAlert = Object.entries(gateState.clusters).find(
          ([, stats]) => stats.fallbackShare > thresholds.fallbackAlertMax
        );
        if (fallbackAlert) {
          console.warn(
            `stress alert: cluster=${fallbackAlert[0]} fallbackShare=${fallbackAlert[1].fallbackShare.toFixed(3)}`
          );
        }

        if (runIndex % snapshotEvery === 0) {
          const allRows = await loadSessionEvents(store, sessionId);
          await writeStressSnapshot({
            sessionId,
            rootDir: runtimeRoot,
            runCount: runIndex,
            seed,
            allRows,
            recentRows: recent,
            gateState,
            debtStats,
            legalSlowStats,
            gateStop: null
          });
        }
      }
    }
  } finally {
    await store.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
