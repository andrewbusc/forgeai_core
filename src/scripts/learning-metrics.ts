import "dotenv/config";

import process from "node:process";
import { AppStore } from "../lib/project-store.js";

interface LearningMetricsRow {
  phase: string | null;
  runs: string;
  avg_delta: string | null;
  convergence_rate: string | null;
  regression_rate: string | null;
}

interface StubDebtRow {
  import_recipe_runs: string;
  stub_runs: string;
  provisional_runs: string;
}

interface RecentLearningEventRow {
  run_id: string;
  phase: string | null;
  clusters: unknown;
  delta: number | null;
  convergence_flag: boolean | null;
  regression_flag: boolean | null;
  metadata: unknown;
  outcome: string;
  created_at: string | Date;
}

interface AggregatedStats {
  runs: number;
  deltaSum: number;
  convergence: number;
  regression: number;
}

function clusterLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const labels = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string") {
      const normalized = entry.trim();
      if (normalized) {
        labels.add(normalized);
      }
      continue;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawType = typeof record.type === "string" ? record.type.trim() : "";
    if (rawType) {
      labels.add(rawType);
      continue;
    }

    const fallback = JSON.stringify(record);
    if (fallback && fallback !== "{}") {
      labels.add(fallback);
    }
  }

  return Array.from(labels);
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function sortableTimestamp(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function scenarioLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const label = (value as Record<string, unknown>).scenarioLabel;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function resolutionStrategy(value: unknown): string | null {
  const metadata = metadataRecord(value);
  return typeof metadata?.resolutionStrategy === "string" && metadata.resolutionStrategy.trim()
    ? metadata.resolutionStrategy.trim()
    : null;
}

function isStubMaterialization(value: unknown): boolean {
  const metadata = metadataRecord(value);
  return metadata?.importRecipeAction === "materialize_missing_module";
}

async function main(): Promise<void> {
  const store = new AppStore();

  try {
    await store.initialize();

    const rows = await store.query<LearningMetricsRow>(`
      SELECT
        phase,
        COUNT(*)::text AS runs,
        AVG(delta)::text AS avg_delta,
        (
          SUM(CASE WHEN convergence_flag THEN 1 ELSE 0 END)::float
          / NULLIF(COUNT(*), 0)
        )::text AS convergence_rate,
        (
          SUM(CASE WHEN regression_flag THEN 1 ELSE 0 END)::float
          / NULLIF(COUNT(*), 0)
        )::text AS regression_rate
      FROM learning_events
      GROUP BY phase
      ORDER BY COUNT(*) DESC, phase ASC NULLS FIRST
    `);

    console.table(
      rows.map((row) => ({
        phase: row.phase ?? "(null)",
        runs: Number(row.runs),
        avgDelta: row.avg_delta === null ? null : Number(row.avg_delta),
        convergenceRate: row.convergence_rate === null ? null : Number(row.convergence_rate),
        regressionRate: row.regression_rate === null ? null : Number(row.regression_rate)
      }))
    );

    const stubDebt = await store.query<StubDebtRow>(`
      SELECT
        SUM(CASE WHEN metadata->>'resolutionStrategy' = 'import_recipe' THEN 1 ELSE 0 END)::text AS import_recipe_runs,
        SUM(CASE WHEN metadata->>'importRecipeAction' = 'materialize_missing_module' THEN 1 ELSE 0 END)::text AS stub_runs,
        SUM(CASE WHEN outcome = 'provisionally_fixed' THEN 1 ELSE 0 END)::text AS provisional_runs
      FROM learning_events
    `);

    const overallImportRecipeRuns = Number(stubDebt[0]?.import_recipe_runs || 0);
    const overallStubRuns = Number(stubDebt[0]?.stub_runs || 0);
    const overallProvisionalRuns = Number(stubDebt[0]?.provisional_runs || 0);

    printSection("Stub Debt (Overall)");
    console.table([
      {
        importRecipeRuns: overallImportRecipeRuns,
        stubRuns: overallStubRuns,
        stubRate: overallImportRecipeRuns > 0 ? overallStubRuns / overallImportRecipeRuns : 0,
        provisionalRuns: overallProvisionalRuns
      }
    ]);

    const recent = await store.query<RecentLearningEventRow>(`
      SELECT run_id, phase, clusters, delta, convergence_flag, regression_flag, metadata, outcome, created_at
      FROM learning_events
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const phaseStats: Record<string, AggregatedStats> = {};
    const clusterStats: Record<string, AggregatedStats> = {};
    const scenarioStats: Record<string, AggregatedStats> = {};
    const runEvents = new Map<string, RecentLearningEventRow[]>();

    for (const row of recent) {
      const phaseKey = row.phase ?? "(null)";
      phaseStats[phaseKey] ??= {
        runs: 0,
        deltaSum: 0,
        convergence: 0,
        regression: 0
      };

      phaseStats[phaseKey].runs += 1;
      phaseStats[phaseKey].deltaSum += row.delta ?? 0;
      if (row.convergence_flag) {
        phaseStats[phaseKey].convergence += 1;
      }
      if (row.regression_flag) {
        phaseStats[phaseKey].regression += 1;
      }

      for (const label of clusterLabels(row.clusters)) {
        clusterStats[label] ??= {
          runs: 0,
          deltaSum: 0,
          convergence: 0,
          regression: 0
        };

        clusterStats[label].runs += 1;
        clusterStats[label].deltaSum += row.delta ?? 0;
        if (row.convergence_flag) {
          clusterStats[label].convergence += 1;
        }
        if (row.regression_flag) {
          clusterStats[label].regression += 1;
        }
      }

      const recentScenarioLabel = scenarioLabel(row.metadata) ?? "(unattributed)";
      scenarioStats[recentScenarioLabel] ??= {
        runs: 0,
        deltaSum: 0,
        convergence: 0,
        regression: 0
      };
      scenarioStats[recentScenarioLabel].runs += 1;
      scenarioStats[recentScenarioLabel].deltaSum += row.delta ?? 0;
      if (row.convergence_flag) {
        scenarioStats[recentScenarioLabel].convergence += 1;
      }
      if (row.regression_flag) {
        scenarioStats[recentScenarioLabel].regression += 1;
      }

      const events = runEvents.get(row.run_id) ?? [];
      events.push(row);
      runEvents.set(row.run_id, events);
    }

    printSection("Phase (Last 20)");
    console.table(
      Object.entries(phaseStats)
        .map(([phase, stats]) => ({
          phase,
          runs: stats.runs,
          avgDelta: stats.runs > 0 ? stats.deltaSum / stats.runs : 0,
          convergenceRate: stats.runs > 0 ? stats.convergence / stats.runs : 0,
          regressionRate: stats.runs > 0 ? stats.regression / stats.runs : 0
        }))
        .sort((left, right) => right.runs - left.runs || String(left.phase).localeCompare(String(right.phase)))
    );

    printSection("Cluster (Last 20)");
    console.table(
      Object.entries(clusterStats)
        .map(([cluster, stats]) => ({
          cluster,
          runs: stats.runs,
          avgDelta: stats.runs > 0 ? stats.deltaSum / stats.runs : 0,
          regressionRate: stats.runs > 0 ? stats.regression / stats.runs : 0
        }))
        .sort((left, right) => right.runs - left.runs || String(left.cluster).localeCompare(String(right.cluster)))
    );

    printSection("Scenario (Last 20)");
    console.table(
      Object.entries(scenarioStats)
        .map(([scenario, stats]) => ({
          scenario,
          runs: stats.runs,
          avgDelta: stats.runs > 0 ? stats.deltaSum / stats.runs : 0,
          convergenceRate: stats.runs > 0 ? stats.convergence / stats.runs : 0,
          regressionRate: stats.runs > 0 ? stats.regression / stats.runs : 0
        }))
        .sort((left, right) => right.runs - left.runs || String(left.scenario).localeCompare(String(right.scenario)))
    );

    const recentImportRecipeRuns = recent.filter((row) => resolutionStrategy(row.metadata) === "import_recipe").length;
    const recentStubRuns = recent.filter((row) => isStubMaterialization(row.metadata)).length;
    const recentProvisionalRuns = recent.filter((row) => row.outcome === "provisionally_fixed").length;

    printSection("Stub Debt (Last 20)");
    console.table([
      {
        importRecipeRuns: recentImportRecipeRuns,
        stubRuns: recentStubRuns,
        stubRate: recentImportRecipeRuns > 0 ? recentStubRuns / recentImportRecipeRuns : 0,
        provisionalRuns: recentProvisionalRuns
      }
    ]);

    const oscillations = Array.from(runEvents.entries())
      .map(([runId, events]) => {
        const sorted = [...events].sort(
          (left, right) => sortableTimestamp(left.created_at) - sortableTimestamp(right.created_at)
        );
        let samePhaseNoImprovementCount = 0;

        for (let index = 1; index < sorted.length; index += 1) {
          const previous = sorted[index - 1];
          const current = sorted[index];
          if (previous?.phase && previous.phase === current?.phase && (current.delta ?? 0) <= 0) {
            samePhaseNoImprovementCount += 1;
          }
        }

        return {
          runId,
          scenarioLabel: scenarioLabel(sorted[0]?.metadata) ?? "(unattributed)",
          events: sorted.length,
          samePhaseNoImprovementCount
        };
      })
      .filter((entry) => entry.samePhaseNoImprovementCount > 0)
      .sort((left, right) => right.samePhaseNoImprovementCount - left.samePhaseNoImprovementCount);

    printSection("Oscillation (Last 20)");
    if (oscillations.length === 0) {
      console.log("No same-phase, non-improving repetitions detected in the last 20 events.");
    } else {
      console.table(oscillations);
    }
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
