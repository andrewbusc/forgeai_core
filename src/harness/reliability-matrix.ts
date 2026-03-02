import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { AgentKernel } from "../agent/kernel.js";
import {
  type AgentRunExecutionConfig
} from "../agent/types.js";
import { EXECUTION_CONFIG_SCHEMA_VERSION } from "../agent/execution-contract.js";
import { buildGovernanceDecision, persistGovernanceDecision } from "../governance/decision.js";
import { AppStore } from "../lib/project-store.js";
import { workspacePath } from "../lib/workspace.js";
import {
  computeGateState,
  computeLegalSlowStats,
  DEFAULT_STRESS_GATE_THRESHOLDS,
  evaluateStressGate,
  type DebtPaydownStats,
  type LegalSlowStats,
  type StressEventRow,
  type StressGateState,
  type StressGateStop,
  type StressGateThresholds
} from "./stress-gates.js";
import { createHarnessRuntime, runScenario, type HarnessRuntime, type ScenarioRunSummary } from "./utils.js";

type MatrixControl = "positive" | "negative";

interface MatrixCaseSummary {
  name: string;
  category: string;
  control: MatrixControl;
  pass: boolean;
  expected: {
    gate: string | null;
    decision: "PASS" | "FAIL" | null;
  };
  actual: {
    gate: string | null;
    decision: "PASS" | "FAIL" | null;
    falsePositiveRate: number | null;
  };
  reasonCodes: string[];
  decisionHashes: string[];
  artifacts: string[];
}

interface SessionEvaluation {
  gate: StressGateStop | null;
  gateState: StressGateState;
  debtStats: DebtPaydownStats;
  legalSlowStats: LegalSlowStats;
  recentRows: StressEventRow[];
  allRows: StressEventRow[];
}

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

function executionConfigProfile(profile: "full" | "ci" | "smoke"): AgentRunExecutionConfig {
  if (profile === "ci") {
    return {
      schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
      profile: "ci",
      lightValidationMode: "off",
      heavyValidationMode: "off",
      maxRuntimeCorrectionAttempts: 0,
      maxHeavyCorrectionAttempts: 0,
      correctionPolicyMode: "warn",
      correctionConvergenceMode: "warn",
      plannerTimeoutMs: 5_000,
      maxFilesPerStep: 15,
      maxTotalDiffBytes: 400_000,
      maxFileBytes: 1_500_000,
      allowEnvMutation: false
    };
  }

  if (profile === "smoke") {
    return {
      schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
      profile: "smoke",
      lightValidationMode: "warn",
      heavyValidationMode: "warn",
      maxRuntimeCorrectionAttempts: 1,
      maxHeavyCorrectionAttempts: 1,
      correctionPolicyMode: "warn",
      correctionConvergenceMode: "warn",
      plannerTimeoutMs: 10_000,
      maxFilesPerStep: 15,
      maxTotalDiffBytes: 400_000,
      maxFileBytes: 1_500_000,
      allowEnvMutation: false
    };
  }

  return {
    schemaVersion: EXECUTION_CONFIG_SCHEMA_VERSION,
    profile: "full",
    lightValidationMode: "enforce",
    heavyValidationMode: "enforce",
    maxRuntimeCorrectionAttempts: 5,
    maxHeavyCorrectionAttempts: 3,
    correctionPolicyMode: "enforce",
    correctionConvergenceMode: "enforce",
    plannerTimeoutMs: 120_000,
    maxFilesPerStep: 15,
    maxTotalDiffBytes: 400_000,
    maxFileBytes: 1_500_000,
    allowEnvMutation: false
  };
}

async function loadSessionEvents(store: AppStore, sessionId: string, limit?: number): Promise<StressEventRow[]> {
  const limitClause = typeof limit === "number" ? `LIMIT ${Math.max(1, limit)}` : "";

  return store.query<StressEventRow>(
    `
      SELECT run_id, phase, outcome, delta, blocking_before, blocking_after,
             convergence_flag, regression_flag, clusters, metadata, created_at
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

async function evaluateSession(input: {
  store: AppStore;
  sessionId: string;
  thresholds: StressGateThresholds;
}): Promise<SessionEvaluation> {
  const allRows = await loadSessionEvents(input.store, input.sessionId);
  const recentRows = await loadSessionEvents(input.store, input.sessionId, input.thresholds.gateWindow);
  const gateState = computeGateState(recentRows);
  const debtStats = await queryDebtPaydownStats(input.store, input.sessionId, input.thresholds.debtWindow);
  const legalSlowStats = computeLegalSlowStats({
    recent: recentRows,
    debtStats,
    thresholds: input.thresholds
  });
  const gate = evaluateStressGate({
    gateState,
    debtStats,
    thresholds: input.thresholds,
    legalSlowStats
  });

  return {
    gate,
    gateState,
    debtStats,
    legalSlowStats,
    recentRows,
    allRows
  };
}

async function executeQueuedRunOnce(input: {
  store: AppStore;
  kernel: AgentKernel;
  runId: string;
  nodeId: string;
}): Promise<void> {
  await input.store.upsertWorkerNodeHeartbeat({
    nodeId: input.nodeId,
    role: "compute",
    status: "online",
    capabilities: {}
  });

  const job = await input.store.claimNextRunJob({
    nodeId: input.nodeId,
    targetRole: "compute",
    workerCapabilities: {},
    leaseSeconds: 60,
    runId: input.runId
  });

  if (!job) {
    throw new Error(`Queued run job not found for run ${input.runId}`);
  }

  await input.store.markRunJobRunning(job.id, input.nodeId, 60);
  const run = await input.store.getAgentRun(job.runId);
  if (!run) {
    throw new Error(`Run not found: ${job.runId}`);
  }
  const project = await input.store.getProject(run.projectId);
  if (!project) {
    throw new Error(`Project not found for run: ${job.runId}`);
  }

  try {
    await input.kernel.executeRunJob({
      job,
      project,
      requestId: `matrix:${input.nodeId}:${job.id}`
    });
    await input.store.completeRunJob(job.id, input.nodeId);
  } catch (error) {
    await input.store.failRunJob(job.id, input.nodeId).catch(() => undefined);
    throw error;
  }
}

async function persistDecisionForRun(input: {
  kernel: AgentKernel;
  projectId: string;
  runId: string;
  caseRoot: string;
}): Promise<{ decisionHash: string; decision: "PASS" | "FAIL"; reasonCodes: string[] }> {
  const detail = await input.kernel.getRunWithSteps(input.projectId, input.runId);
  if (!detail) {
    throw new Error(`Run detail not found: ${input.runId}`);
  }

  const decision = buildGovernanceDecision({
    detail,
    strictV1Ready: false
  });
  await persistGovernanceDecision({
    decision,
    rootDir: input.caseRoot
  });

  return {
    decisionHash: decision.decisionHash,
    decision: decision.decision,
    reasonCodes: decision.reasonCodes
  };
}

async function writeCaseArtifact(caseRoot: string, name: string, payload: unknown): Promise<string> {
  await fs.mkdir(caseRoot, { recursive: true });
  const target = path.join(caseRoot, `${name}.json`);
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return target;
}

async function runScenarioBatchCase(input: {
  name: string;
  category: string;
  control: MatrixControl;
  label:
    | "pathological_import_graph"
    | "legal_slow_convergence"
    | "artificial_regression_spike"
    | "long_correction_loop";
  runCount: number;
  expectedGate: string | null;
  expectedDecision: "PASS" | "FAIL" | null;
  thresholds: StressGateThresholds;
  matrixRoot: string;
  metadata?: Record<string, unknown>;
}): Promise<MatrixCaseSummary> {
  const store = new AppStore();
  const caseRoot = path.join(input.matrixRoot, input.name);
  const sessionId = randomUUID();
  const decisionHashes: string[] = [];
  const reasonCodes = new Set<string>();
  const artifacts: string[] = [];

  await store.initialize();

  try {
    const runtime = await createHarnessRuntime(store);
    const kernel = new AgentKernel({ store });
    let latestEvaluation: SessionEvaluation | null = null;
    let latestSummary: ScenarioRunSummary | null = null;
    let latestDecision: "PASS" | "FAIL" | null = null;

    for (let occurrence = 1; occurrence <= input.runCount; occurrence += 1) {
      latestSummary = await runScenario(runtime, input.label, occurrence, {
        metadata: {
          stressSessionId: sessionId,
          stressSeed: input.name,
          stressOrdinal: occurrence,
          ...(input.label === "legal_slow_convergence" ? { legalSlow: true } : {}),
          ...(input.metadata ?? {})
        }
      });

      const decision = await persistDecisionForRun({
        kernel,
        projectId: latestSummary.projectId,
        runId: latestSummary.runId,
        caseRoot
      });
      decisionHashes.push(decision.decisionHash);
      decision.reasonCodes.forEach((code) => reasonCodes.add(code));
      latestDecision = decision.decision;

      latestEvaluation = await evaluateSession({
        store,
        sessionId,
        thresholds: input.thresholds
      });

      if (latestEvaluation.gate) {
        reasonCodes.add(latestEvaluation.gate.gate);
        artifacts.push(
          await writeCaseArtifact(caseRoot, `${input.name}-gate-stop`, {
            sessionId,
            gate: latestEvaluation.gate.gate,
            details: latestEvaluation.gate.details
          })
        );
        break;
      }
    }

    if (!latestEvaluation) {
      latestEvaluation = await evaluateSession({
        store,
        sessionId,
        thresholds: input.thresholds
      });
    }

    artifacts.push(
      await writeCaseArtifact(caseRoot, `${input.name}-summary`, {
        sessionId,
        gateState: latestEvaluation.gateState,
        debt: latestEvaluation.debtStats,
        legalSlow: latestEvaluation.legalSlowStats,
        totalEvents: latestEvaluation.allRows.length,
        latestDecision
      })
    );

    const actualDecision = latestEvaluation.gate ? "FAIL" : latestDecision;
    const pass =
      latestEvaluation.gate?.gate === input.expectedGate &&
      (input.expectedDecision === null || actualDecision === input.expectedDecision);

    return {
      name: input.name,
      category: input.category,
      control: input.control,
      pass,
      expected: {
        gate: input.expectedGate,
        decision: input.expectedDecision
      },
      actual: {
        gate: latestEvaluation.gate?.gate ?? null,
        decision: actualDecision,
        falsePositiveRate: null
      },
      reasonCodes: Array.from(reasonCodes).sort(),
      decisionHashes,
      artifacts: artifacts.map((entry) => path.relative(input.matrixRoot, entry))
    };
  } finally {
    await store.close();
  }
}

async function runExecutionContractInjectionCase(input: {
  matrixRoot: string;
}): Promise<MatrixCaseSummary[]> {
  const store = new AppStore();
  const negativeCaseRoot = path.join(input.matrixRoot, "execution-config-injection-negative");
  const positiveCaseRoot = path.join(input.matrixRoot, "execution-config-injection-positive");
  await store.initialize();

  try {
    const runtime = await createHarnessRuntime(store);
    const kernel = new AgentKernel({ store });
    const project = await store.createProject({
      orgId: runtime.identity.orgId,
      workspaceId: runtime.identity.workspaceId,
      createdByUserId: runtime.identity.userId,
      name: `execution-config-injection-${randomUUID().slice(0, 8)}`,
      description: "Execution contract matrix project",
      templateId: "agent-workflow"
    });
    const started = await kernel.startRunWithPlan({
      project,
      createdByUserId: runtime.identity.userId,
      goal: "Execution config injection matrix baseline",
      providerId: "mock",
      model: "mock-v1",
      requestId: "matrix:execution-config:start",
      executionConfig: executionConfigProfile("full"),
      plan: {
        goal: "Execution config injection matrix baseline",
        steps: [
          {
            id: "step-1",
            type: "modify",
            tool: "write_file",
            input: {
              path: "src/execution-contract-matrix.ts",
              content: "export const executionContractMatrix = true;\n"
            }
          }
        ]
      }
    });

    const baselineDecision = await persistDecisionForRun({
      kernel,
      projectId: project.id,
      runId: started.run.id,
      caseRoot: positiveCaseRoot
    });

    let mismatchMessage = "CONTRACT_MISMATCH";
    try {
      await kernel.queueResumeRun({
        project,
        runId: started.run.id,
        requestId: "matrix:execution-config:mismatch",
        executionConfig: executionConfigProfile("ci")
      });
    } catch (error) {
      mismatchMessage = error instanceof Error ? error.message : String(error);
    }

    const forked = await kernel.queueResumeRun({
      project,
      runId: started.run.id,
      requestId: "matrix:execution-config:fork",
      createdByUserId: runtime.identity.userId,
      executionConfig: executionConfigProfile("ci"),
      fork: true
    });

    await executeQueuedRunOnce({
      store,
      kernel,
      runId: forked.run.id,
      nodeId: "matrix-contract-fork"
    });

    const forkDecision = await persistDecisionForRun({
      kernel,
      projectId: project.id,
      runId: forked.run.id,
      caseRoot: positiveCaseRoot
    });

    const negativeArtifact = await writeCaseArtifact(negativeCaseRoot, "execution-config-injection-negative", {
      sourceRunId: started.run.id,
      message: mismatchMessage
    });
    const positiveArtifact = await writeCaseArtifact(positiveCaseRoot, "execution-config-injection-positive", {
      sourceRunId: started.run.id,
      forkedRunId: forked.run.id
    });

    return [
      {
        name: "execution-config-injection-negative",
        category: "execution_config_injection",
        control: "negative",
        pass: /contract mismatch/i.test(mismatchMessage),
        expected: {
          gate: null,
          decision: "FAIL"
        },
        actual: {
          gate: null,
          decision: /contract mismatch/i.test(mismatchMessage) ? "FAIL" : "PASS",
          falsePositiveRate: null
        },
        reasonCodes: [/contract mismatch/i.test(mismatchMessage) ? "CONTRACT_MISMATCH" : "UNEXPECTED_RESUME_ACCEPTED"],
        decisionHashes: [baselineDecision.decisionHash],
        artifacts: [path.relative(input.matrixRoot, negativeArtifact)]
      },
      {
        name: "execution-config-injection-positive",
        category: "execution_config_injection",
        control: "positive",
        pass: forked.run.id !== started.run.id && forkDecision.decision === "PASS",
        expected: {
          gate: null,
          decision: "PASS"
        },
        actual: {
          gate: null,
          decision: forkDecision.decision,
          falsePositiveRate: null
        },
        reasonCodes: forkDecision.reasonCodes,
        decisionHashes: [baselineDecision.decisionHash, forkDecision.decisionHash],
        artifacts: [path.relative(input.matrixRoot, positiveArtifact)]
      }
    ];
  } finally {
    await store.close();
  }
}

async function runLegalSlowFalsePositiveCase(input: {
  matrixRoot: string;
  thresholds: StressGateThresholds;
  sessionCount: number;
  runCount: number;
}): Promise<MatrixCaseSummary> {
  let trips = 0;
  const decisionHashes: string[] = [];
  const artifacts: string[] = [];
  const caseRoot = path.join(input.matrixRoot, "legal-slow-convergence-positive");

  for (let index = 1; index <= input.sessionCount; index += 1) {
    const result = await runScenarioBatchCase({
      name: `legal-slow-session-${index}`,
      category: "legal_slow_convergence",
      control: "positive",
      label: "legal_slow_convergence",
      runCount: input.runCount,
      expectedGate: null,
      expectedDecision: "PASS",
      thresholds: input.thresholds,
      matrixRoot: caseRoot
    });
    if (result.actual.gate) {
      trips += 1;
    }
    decisionHashes.push(...result.decisionHashes);
    artifacts.push(...result.artifacts.map((entry) => path.join("legal-slow-convergence-positive", entry)));
  }

  const falsePositiveRate = input.sessionCount > 0 ? trips / input.sessionCount : 0;

  return {
    name: "legal-slow-convergence-positive",
    category: "legal_slow_convergence",
    control: "positive",
    pass: falsePositiveRate === 0,
    expected: {
      gate: null,
      decision: "PASS"
    },
    actual: {
      gate: falsePositiveRate === 0 ? null : "FALSE_POSITIVE_GATE",
      decision: falsePositiveRate === 0 ? "PASS" : "FAIL",
      falsePositiveRate
    },
    reasonCodes: falsePositiveRate === 0 ? [] : ["LEGAL_SLOW_FALSE_POSITIVE"],
    decisionHashes,
    artifacts
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const thresholds = { ...DEFAULT_STRESS_GATE_THRESHOLDS };
  const runCount = numberArg(args, "runs", 20);
  const legalSlowSessions = numberArg(args, "legalSlowSessions", 3);
  const outputPath = stringArg(
    args,
    "output",
    workspacePath(".deeprun", "reliability-matrix", "proof-pack.json")
  );
  const matrixRoot = path.dirname(outputPath);
  const sessionId = randomUUID();
  const results: MatrixCaseSummary[] = [];

  await fs.mkdir(matrixRoot, { recursive: true });

  results.push(
    await runScenarioBatchCase({
      name: "pathological-import-graph-positive",
      category: "pathological_import_graphs",
      control: "positive",
      label: "pathological_import_graph",
      runCount,
      expectedGate: null,
      expectedDecision: "PASS",
      thresholds,
      matrixRoot
    })
  );

  results.push(
    await runScenarioBatchCase({
      name: "pathological-import-graph-negative",
      category: "pathological_import_graphs",
      control: "negative",
      label: "pathological_import_graph",
      runCount,
      expectedGate: "DEBT_PAYDOWN_FAILURE",
      expectedDecision: "FAIL",
      thresholds,
      matrixRoot,
      metadata: {
        stressNegativeControl: "debt_paydown_failure"
      }
    })
  );

  results.push(
    await runScenarioBatchCase({
      name: "long-correction-loop-negative",
      category: "long_correction_loops",
      control: "negative",
      label: "long_correction_loop",
      runCount,
      expectedGate: "MICRO_STALL_SPIRAL",
      expectedDecision: "FAIL",
      thresholds,
      matrixRoot
    })
  );

  results.push(
    await runScenarioBatchCase({
      name: "artificial-regression-spike-negative",
      category: "artificial_regression_spikes",
      control: "negative",
      label: "artificial_regression_spike",
      runCount,
      expectedGate: "CLUSTER_REGRESSION_SPIKE",
      expectedDecision: "FAIL",
      thresholds,
      matrixRoot
    })
  );

  results.push(
    await runLegalSlowFalsePositiveCase({
      matrixRoot,
      thresholds,
      sessionCount: legalSlowSessions,
      runCount
    })
  );

  results.push(...(await runExecutionContractInjectionCase({ matrixRoot })));

  const payload = {
    proofPackSchemaVersion: 1,
    sessionId,
    createdAt: new Date().toISOString(),
    thresholds,
    results,
    summary: {
      totalCases: results.length,
      passedCases: results.filter((entry) => entry.pass).length,
      failedCases: results.filter((entry) => !entry.pass).length
    }
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const failed = results.filter((entry) => !entry.pass);
  console.log(JSON.stringify(payload, null, 2));
  if (failed.length > 0) {
    throw new Error(`Reliability matrix failed: ${failed.map((entry) => entry.name).join(", ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
