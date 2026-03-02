import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGateState,
  computeLegalSlowStats,
  DEFAULT_STRESS_GATE_THRESHOLDS,
  evaluateStressGate,
  type DebtPaydownStats,
  type StressEventRow
} from "../stress-gates.js";

function makeRow(input: Partial<StressEventRow> = {}): StressEventRow {
  return {
    run_id: input.run_id || "run-1",
    phase: input.phase ?? "single",
    outcome: input.outcome || "success",
    delta: input.delta ?? 1,
    blocking_before: input.blocking_before ?? 1,
    blocking_after: input.blocking_after ?? 0,
    convergence_flag: input.convergence_flag ?? true,
    regression_flag: input.regression_flag ?? false,
    clusters: input.clusters ?? [],
    metadata: input.metadata ?? {},
    created_at: input.created_at || "2026-03-01T00:00:00.000Z"
  };
}

function baseDebt(input: Partial<DebtPaydownStats> = {}): DebtPaydownStats {
  return {
    debtAttempts: input.debtAttempts ?? 0,
    paidDown: input.paidDown ?? 0,
    stubCreates: input.stubCreates ?? 0,
    paydownRate: input.paydownRate ?? 1
  };
}

test("computeGateState aggregates phase stall and cluster fallback rates", () => {
  const state = computeGateState([
    makeRow({
      phase: "micro_targeted_repair",
      outcome: "stalled",
      convergence_flag: false,
      clusters: [{ type: "import_resolution_error" }],
      metadata: { resolutionStrategy: "structural_reset_fallback" }
    }),
    makeRow({
      phase: "micro_targeted_repair",
      outcome: "success",
      convergence_flag: true,
      clusters: [{ type: "import_resolution_error" }]
    })
  ]);

  assert.equal(state.convergenceRate, 0.5);
  assert.deepEqual(state.phases.micro_targeted_repair, {
    runs: 2,
    stalledRate: 0.5,
    convergenceRate: 0.5
  });
  assert.deepEqual(state.clusters.import_resolution_error, {
    runs: 2,
    regressionRate: 0,
    fallbackShare: 0.5
  });
});

test("evaluateStressGate returns convergence failure first", () => {
  const gate = evaluateStressGate({
    gateState: {
      convergenceRate: 0.45,
      clusters: {},
      phases: {}
    },
    debtStats: baseDebt(),
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS
  });

  assert.deepEqual(gate, {
    gate: "CONVERGENCE_FAILURE",
    details: {
      window: 20,
      convergenceRate: 0.45,
      minimum: 0.5
    },
    message: "stress gate tripped: convergenceRate=0.450 below 0.5"
  });
});

test("evaluateStressGate returns cluster regression spike details", () => {
  const gate = evaluateStressGate({
    gateState: {
      convergenceRate: 0.9,
      clusters: {
        import_resolution_error: {
          runs: 7,
          regressionRate: 0.5714285714285714,
          fallbackShare: 0
        }
      },
      phases: {}
    },
    debtStats: baseDebt(),
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS
  });

  assert.deepEqual(gate, {
    gate: "CLUSTER_REGRESSION_SPIKE",
    details: {
      window: 20,
      cluster: "import_resolution_error",
      regressionRate: 0.571,
      maximum: 0.4
    },
    message: "stress gate tripped: cluster=import_resolution_error regressionRate=0.571 above 0.4"
  });
});

test("evaluateStressGate returns micro stall spiral details", () => {
  const gate = evaluateStressGate({
    gateState: {
      convergenceRate: 0.9,
      clusters: {},
      phases: {
        micro_targeted_repair: {
          runs: 9,
          stalledRate: 0.778,
          convergenceRate: 0
        }
      }
    },
    debtStats: baseDebt(),
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS
  });

  assert.deepEqual(gate, {
    gate: "MICRO_STALL_SPIRAL",
    details: {
      window: 20,
      phase: "micro_targeted_repair",
      runs: 9,
      stalledRate: 0.778,
      maximum: 0.6
    },
    message: "stress gate tripped: MICRO_STALL_SPIRAL stalledRate=0.778 runs=9"
  });
});

test("evaluateStressGate returns debt paydown failure details", () => {
  const gate = evaluateStressGate({
    gateState: {
      convergenceRate: 0.95,
      clusters: {},
      phases: {}
    },
    debtStats: baseDebt({
      debtAttempts: 8,
      paidDown: 0,
      stubCreates: 8,
      paydownRate: 0
    }),
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS
  });

  assert.deepEqual(gate, {
    gate: "DEBT_PAYDOWN_FAILURE",
    details: {
      window: 20,
      attempts: 8,
      paidDown: 0,
      stubCreates: 8,
      paydownRate: 0,
      minimum: 0.3
    },
    message: "stress gate tripped: DEBT_PAYDOWN_FAILURE paydownRate=0.000 attempts=8 stubs=8"
  });
});

test("evaluateStressGate stays quiet below debt sample thresholds", () => {
  const gate = evaluateStressGate({
    gateState: {
      convergenceRate: 0.95,
      clusters: {},
      phases: {}
    },
    debtStats: baseDebt({
      debtAttempts: 5,
      paidDown: 0,
      stubCreates: 5,
      paydownRate: 0
    }),
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS
  });

  assert.equal(gate, null);
});

test("computeLegalSlowStats accepts bounded monotonic legal slow windows", () => {
  const debt = baseDebt({
    debtAttempts: 0,
    paidDown: 0,
    stubCreates: 0,
    paydownRate: 0
  });
  const recent = [
    makeRow({
      phase: "feature_reintegration",
      outcome: "improved",
      convergence_flag: false,
      blocking_before: 8,
      blocking_after: 6,
      metadata: { scenarioLabel: "legal_slow_convergence" },
      created_at: "2026-03-01T00:00:03.000Z"
    }),
    makeRow({
      phase: "feature_reintegration",
      outcome: "improved",
      convergence_flag: false,
      blocking_before: 10,
      blocking_after: 8,
      metadata: { scenarioLabel: "legal_slow_convergence" },
      created_at: "2026-03-01T00:00:02.000Z"
    }),
    makeRow({
      phase: "feature_reintegration",
      outcome: "improved",
      convergence_flag: false,
      blocking_before: 12,
      blocking_after: 10,
      metadata: { scenarioLabel: "legal_slow_convergence" },
      created_at: "2026-03-01T00:00:01.000Z"
    })
  ];

  const legalSlow = computeLegalSlowStats({
    recent,
    debtStats: debt,
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS
  });

  assert.deepEqual(legalSlow, {
    eligible: true,
    accepted: true,
    paydownAccepted: false,
    boundedProgress: true,
    epsilon: 0,
    blockingSeries: [10, 8, 6]
  });

  const gate = evaluateStressGate({
    gateState: {
      convergenceRate: 0,
      clusters: {},
      phases: {}
    },
    debtStats: debt,
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS,
    legalSlowStats: legalSlow
  });

  assert.equal(gate, null);
});

test("computeLegalSlowStats rejects regressing legal slow windows", () => {
  const debt = baseDebt({
    debtAttempts: 0,
    paidDown: 0,
    stubCreates: 0,
    paydownRate: 0
  });
  const recent = [
    makeRow({
      phase: "feature_reintegration",
      outcome: "regressed",
      convergence_flag: false,
      regression_flag: true,
      blocking_before: 6,
      blocking_after: 7,
      metadata: { scenarioLabel: "legal_slow_convergence" },
      created_at: "2026-03-01T00:00:02.000Z"
    }),
    makeRow({
      phase: "feature_reintegration",
      outcome: "improved",
      convergence_flag: false,
      blocking_before: 8,
      blocking_after: 6,
      metadata: { scenarioLabel: "legal_slow_convergence" },
      created_at: "2026-03-01T00:00:01.000Z"
    })
  ];

  const legalSlow = computeLegalSlowStats({
    recent,
    debtStats: debt,
    thresholds: DEFAULT_STRESS_GATE_THRESHOLDS
  });

  assert.equal(legalSlow.eligible, true);
  assert.equal(legalSlow.accepted, false);
  assert.equal(legalSlow.boundedProgress, false);
});
