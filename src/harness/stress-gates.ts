export interface StressEventRow {
  run_id: string;
  phase: string | null;
  outcome: string;
  delta: number | null;
  blocking_before?: number | null;
  blocking_after?: number | null;
  convergence_flag: boolean | null;
  regression_flag: boolean | null;
  clusters: unknown;
  metadata: unknown;
  created_at: string;
}

interface ClusterGateStats {
  runs: number;
  regressions: number;
  fallbacks: number;
}

interface PhaseGateStats {
  runs: number;
  stalled: number;
  converged: number;
}

export interface DebtPaydownStats {
  debtAttempts: number;
  paidDown: number;
  stubCreates: number;
  paydownRate: number;
}

export interface StressGateThresholds {
  gateWindow: number;
  debtWindow: number;
  clusterRegressionMax: number;
  convergenceMin: number;
  fallbackAlertMax: number;
  microStallRateMax: number;
  microStallMinRuns: number;
  debtMinAttempts: number;
  debtMinStubEvents: number;
  debtMinPaydownRate: number;
  legalSlowBlockingEpsilon: number;
}

export interface StressGateState {
  convergenceRate: number;
  clusters: Record<string, { runs: number; regressionRate: number; fallbackShare: number }>;
  phases: Record<string, { runs: number; stalledRate: number; convergenceRate: number }>;
}

export interface LegalSlowStats {
  eligible: boolean;
  accepted: boolean;
  paydownAccepted: boolean;
  boundedProgress: boolean;
  epsilon: number;
  blockingSeries: number[];
}

export interface StressGateStop {
  gate: "CONVERGENCE_FAILURE" | "CLUSTER_REGRESSION_SPIKE" | "MICRO_STALL_SPIRAL" | "DEBT_PAYDOWN_FAILURE";
  details: Record<string, unknown>;
  message: string;
}

export const DEFAULT_STRESS_GATE_THRESHOLDS: StressGateThresholds = {
  gateWindow: 20,
  debtWindow: 20,
  clusterRegressionMax: 0.4,
  convergenceMin: 0.5,
  fallbackAlertMax: 0.5,
  microStallRateMax: 0.6,
  microStallMinRuns: 8,
  debtMinAttempts: 6,
  debtMinStubEvents: 3,
  debtMinPaydownRate: 0.3,
  legalSlowBlockingEpsilon: 0
};

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
    }
  }

  return Array.from(labels);
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function resolutionStrategy(value: unknown): string {
  const metadata = metadataRecord(value);
  return typeof metadata?.resolutionStrategy === "string" && metadata.resolutionStrategy.trim()
    ? metadata.resolutionStrategy.trim()
    : "planner";
}

function isLegalSlowScenario(value: unknown): boolean {
  const metadata = metadataRecord(value);
  if (metadata?.legalSlow === true) {
    return true;
  }
  return metadata?.scenarioLabel === "legal_slow_convergence";
}

export function computeGateState(recent: StressEventRow[]): StressGateState {
  const clusterStats: Record<string, ClusterGateStats> = {};
  const phaseStats: Record<string, PhaseGateStats> = {};
  let converged = 0;

  for (const row of recent) {
    if (row.convergence_flag) {
      converged += 1;
    }

    const phase = typeof row.phase === "string" && row.phase.trim() ? row.phase.trim() : "single";
    phaseStats[phase] ??= {
      runs: 0,
      stalled: 0,
      converged: 0
    };
    phaseStats[phase].runs += 1;
    if (row.outcome === "stalled") {
      phaseStats[phase].stalled += 1;
    }
    if (row.outcome === "success" || row.outcome === "provisionally_fixed") {
      phaseStats[phase].converged += 1;
    }

    for (const cluster of clusterLabels(row.clusters)) {
      clusterStats[cluster] ??= {
        runs: 0,
        regressions: 0,
        fallbacks: 0
      };

      clusterStats[cluster].runs += 1;
      if (row.regression_flag) {
        clusterStats[cluster].regressions += 1;
      }
      if (resolutionStrategy(row.metadata) === "structural_reset_fallback") {
        clusterStats[cluster].fallbacks += 1;
      }
    }
  }

  return {
    convergenceRate: recent.length > 0 ? converged / recent.length : 0,
    clusters: Object.fromEntries(
      Object.entries(clusterStats).map(([cluster, stats]) => [
        cluster,
        {
          runs: stats.runs,
          regressionRate: stats.runs > 0 ? stats.regressions / stats.runs : 0,
          fallbackShare: stats.runs > 0 ? stats.fallbacks / stats.runs : 0
        }
      ])
    ),
    phases: Object.fromEntries(
      Object.entries(phaseStats).map(([phase, stats]) => [
        phase,
        {
          runs: stats.runs,
          stalledRate: stats.runs > 0 ? stats.stalled / stats.runs : 0,
          convergenceRate: stats.runs > 0 ? stats.converged / stats.runs : 0
        }
      ])
    )
  };
}

export function computeLegalSlowStats(input: {
  recent: StressEventRow[];
  debtStats: DebtPaydownStats;
  thresholds: StressGateThresholds;
}): LegalSlowStats {
  const ordered = input.recent.slice().reverse();
  const eligible = ordered.length > 0 && ordered.every((row) => isLegalSlowScenario(row.metadata));
  const blockingSeries = ordered.flatMap((row) =>
    typeof row.blocking_after === "number" && Number.isFinite(row.blocking_after) ? [row.blocking_after] : []
  );
  const noRegressions = ordered.every((row) => !row.regression_flag);
  const epsilon = input.thresholds.legalSlowBlockingEpsilon;
  const boundedProgress =
    eligible &&
    blockingSeries.length === ordered.length &&
    blockingSeries.every((value, index) => index === 0 || value <= blockingSeries[index - 1] + epsilon) &&
    (blockingSeries.length === 0 || blockingSeries[blockingSeries.length - 1] <= blockingSeries[0] + epsilon) &&
    noRegressions;
  const paydownAccepted = eligible && input.debtStats.paydownRate >= input.thresholds.debtMinPaydownRate;

  return {
    eligible,
    accepted: eligible && noRegressions && (paydownAccepted || boundedProgress),
    paydownAccepted,
    boundedProgress,
    epsilon,
    blockingSeries
  };
}

export function evaluateStressGate(input: {
  gateState: StressGateState;
  debtStats: DebtPaydownStats;
  thresholds: StressGateThresholds;
  legalSlowStats?: LegalSlowStats | null;
}): StressGateStop | null {
  const { gateState, debtStats, thresholds } = input;
  const failingCluster = Object.entries(gateState.clusters).find(
    ([, stats]) => stats.regressionRate > thresholds.clusterRegressionMax
  );
  const microPhase = gateState.phases.micro_targeted_repair;

  if (failingCluster) {
    return {
      gate: "CLUSTER_REGRESSION_SPIKE",
      details: {
        window: thresholds.gateWindow,
        cluster: failingCluster[0],
        regressionRate: Number(failingCluster[1].regressionRate.toFixed(3)),
        maximum: thresholds.clusterRegressionMax
      },
      message:
        `stress gate tripped: cluster=${failingCluster[0]} regressionRate=${failingCluster[1].regressionRate.toFixed(3)} ` +
        `above ${thresholds.clusterRegressionMax}`
    };
  }

  if (input.legalSlowStats?.accepted) {
    return null;
  }

  if (gateState.convergenceRate < thresholds.convergenceMin) {
    return {
      gate: "CONVERGENCE_FAILURE",
      details: {
        window: thresholds.gateWindow,
        convergenceRate: Number(gateState.convergenceRate.toFixed(3)),
        minimum: thresholds.convergenceMin
      },
      message: `stress gate tripped: convergenceRate=${gateState.convergenceRate.toFixed(3)} below ${thresholds.convergenceMin}`
    };
  }

  if (microPhase && microPhase.runs >= thresholds.microStallMinRuns && microPhase.stalledRate > thresholds.microStallRateMax) {
    return {
      gate: "MICRO_STALL_SPIRAL",
      details: {
        window: thresholds.gateWindow,
        phase: "micro_targeted_repair",
        runs: microPhase.runs,
        stalledRate: Number(microPhase.stalledRate.toFixed(3)),
        maximum: thresholds.microStallRateMax
      },
      message:
        `stress gate tripped: MICRO_STALL_SPIRAL stalledRate=${microPhase.stalledRate.toFixed(3)} ` +
        `runs=${microPhase.runs}`
    };
  }

  if (
    debtStats.stubCreates >= thresholds.debtMinStubEvents &&
    debtStats.debtAttempts >= thresholds.debtMinAttempts &&
    debtStats.paydownRate < thresholds.debtMinPaydownRate
  ) {
    return {
      gate: "DEBT_PAYDOWN_FAILURE",
      details: {
        window: thresholds.debtWindow,
        attempts: debtStats.debtAttempts,
        paidDown: debtStats.paidDown,
        stubCreates: debtStats.stubCreates,
        paydownRate: Number(debtStats.paydownRate.toFixed(3)),
        minimum: thresholds.debtMinPaydownRate
      },
      message:
        `stress gate tripped: DEBT_PAYDOWN_FAILURE paydownRate=${debtStats.paydownRate.toFixed(3)} ` +
        `attempts=${debtStats.debtAttempts} stubs=${debtStats.stubCreates}`
    };
  }

  return null;
}
