import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import { GOVERNANCE_DECISION_SCHEMA_VERSION, buildGovernanceDecisionHash, governanceDecisionSchema } from "../../governance/decision.js";
import {
  PROOF_PACK_SCHEMA_VERSION,
  finalizeProofPack,
  persistProofPack,
  type ProofPackPayloadWithoutHash,
  type ProofPackStep
} from "./proof-pack-contract.js";
import { workspacePath } from "../../lib/workspace.js";

type StepResult = ProofPackStep;

type ProofPack = ProofPackPayloadWithoutHash;

type CommandResult = StepResult & {
  stdoutPath: string;
  stderrPath: string;
};

type StressArtifacts = {
  sessionId: string;
  sessionDir: string;
  latestWindowPath: string | null;
  gateStopPath: string | null;
};

function isoNow(): string {
  return new Date().toISOString();
}

function readScale(): number {
  const parsed = Number(process.env.DEEPRUN_BENCHMARK_SCALE ?? "1");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function strictEnv(): NodeJS.ProcessEnv {
  return {
    DEEPRUN_STRICT_BAS: "1"
  };
}

async function runCommand(input: {
  name: string;
  cwd: string;
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  outDir: string;
  allowExitCodes?: number[];
}): Promise<CommandResult> {
  const startedAt = isoNow();
  await fs.mkdir(input.outDir, { recursive: true });

  const stdoutPath = path.join(input.outDir, `${input.name}.stdout.log`);
  const stderrPath = path.join(input.outDir, `${input.name}.stderr.log`);
  const allowed = new Set(input.allowExitCodes ?? [0]);

  return new Promise((resolve, reject) => {
    const child = spawn(input.cmd, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk));
    });

    child.on("error", reject);
    child.on("close", async (code) => {
      const exitCode = typeof code === "number" ? code : 1;
      await fs.writeFile(stdoutPath, Buffer.concat(stdoutChunks));
      await fs.writeFile(stderrPath, Buffer.concat(stderrChunks));

      resolve({
        name: input.name,
        ok: allowed.has(exitCode),
        exitCode,
        startedAt,
        finishedAt: isoNow(),
        artifacts: [stdoutPath, stderrPath],
        stdoutPath,
        stderrPath
      });
    });
  });
}

async function readGitSha(repoRoot: string): Promise<string | undefined> {
  const result = await runCommand({
    name: "git-rev-parse",
    cwd: repoRoot,
    cmd: "git",
    args: ["rev-parse", "HEAD"],
    outDir: path.join(repoRoot, ".deeprun", "benchmarks", "_tmp"),
    allowExitCodes: [0, 128]
  });

  if (!result.ok) {
    return undefined;
  }

  const stdout = await fs.readFile(result.stdoutPath, "utf8");
  const sha = stdout.trim();
  return sha || undefined;
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`API did not become healthy within ${timeoutMs}ms.`);
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const deadline = Date.now() + 5_000;

  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

async function startServer(input: {
  repoRoot: string;
  outDir: string;
  port: number;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  child: ChildProcess;
  baseUrl: string;
  stdoutPath: string;
  stderrPath: string;
}> {
  const stdoutPath = path.join(input.outDir, "server.stdout.log");
  const stderrPath = path.join(input.outDir, "server.stderr.log");
  await fs.mkdir(input.outDir, { recursive: true });
  await fs.writeFile(stdoutPath, "", "utf8");
  await fs.writeFile(stderrPath, "", "utf8");

  const child = spawn("npx", ["tsx", "-r", "dotenv/config", "src/server.ts"], {
    cwd: input.repoRoot,
    env: {
      ...process.env,
      ...strictEnv(),
      PORT: String(input.port),
      NODE_ENV: "test",
      AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET || "proof-pack-benchmark-secret",
      CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${input.port}`,
      RATE_LIMIT_LOGIN_MAX: "500",
      RATE_LIMIT_GENERATION_MAX: "500",
      AGENT_LIGHT_VALIDATION_MODE: "off",
      AGENT_HEAVY_VALIDATION_MODE: "off",
      AGENT_HEAVY_INSTALL_DEPS: "true",
      ...input.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk: Buffer) => {
    void fs.appendFile(stdoutPath, chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    void fs.appendFile(stderrPath, chunk);
  });

  const baseUrl = `http://127.0.0.1:${input.port}`;

  try {
    await waitForHealth(baseUrl, 90_000);
    return {
      child,
      baseUrl,
      stdoutPath,
      stderrPath
    };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function recordStepValidation(input: {
  proof: ProofPack;
  name: string;
  ok: boolean;
  artifacts: string[];
  details?: Record<string, unknown>;
}): Promise<void> {
  input.proof.steps.push({
    name: input.name,
    ok: input.ok,
    exitCode: input.ok ? 0 : 1,
    startedAt: isoNow(),
    finishedAt: isoNow(),
    artifacts: input.artifacts,
    details: input.details
  });
}

async function validateDecisionArtifact(input: {
  proof: ProofPack;
  name: string;
  decisionPath: string;
  expectedDecision: "PASS" | "FAIL";
  expectedReasonCode?: string;
}): Promise<void> {
  try {
    const raw = await fs.readFile(input.decisionPath, "utf8");
    const decision = governanceDecisionSchema.parse(JSON.parse(raw));
    const withoutHash = {
      decisionSchemaVersion: decision.decisionSchemaVersion,
      decision: decision.decision,
      reasonCodes: decision.reasonCodes,
      reasons: decision.reasons,
      runId: decision.runId,
      contract: decision.contract,
      artifactRefs: decision.artifactRefs
    };
    const expectedHash = buildGovernanceDecisionHash(withoutHash);

    if (decision.decisionSchemaVersion !== GOVERNANCE_DECISION_SCHEMA_VERSION) {
      throw new Error(`Unexpected decision schema version ${decision.decisionSchemaVersion}`);
    }
    if (decision.decision !== input.expectedDecision) {
      throw new Error(`Expected decision ${input.expectedDecision}, got ${decision.decision}`);
    }
    if (decision.decisionHash !== expectedHash) {
      throw new Error(`decisionHash mismatch: expected=${expectedHash} actual=${decision.decisionHash}`);
    }
    if (!decision.contract.hash) {
      throw new Error("Missing contract hash.");
    }
    if (input.expectedReasonCode && !decision.reasonCodes.includes(input.expectedReasonCode)) {
      throw new Error(`Missing reason code ${input.expectedReasonCode}`);
    }

    await recordStepValidation({
      proof: input.proof,
      name: input.name,
      ok: true,
      artifacts: [input.decisionPath],
      details: {
        decision: decision.decision,
        decisionHash: decision.decisionHash,
        contractHash: decision.contract.hash,
        reasonCodes: decision.reasonCodes
      }
    });
  } catch (error) {
    await recordStepValidation({
      proof: input.proof,
      name: input.name,
      ok: false,
      artifacts: [input.decisionPath],
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

async function parseStressArtifacts(repoRoot: string, stdoutPath: string): Promise<StressArtifacts> {
  const stdout = await fs.readFile(stdoutPath, "utf8");
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let sessionId = "";
  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as Record<string, unknown>;
      if (typeof payload.sessionId === "string" && payload.sessionId.trim()) {
        sessionId = payload.sessionId.trim();
        break;
      }
    } catch {
      // ignore non-json lines
    }
  }

  if (!sessionId) {
    throw new Error("Could not extract stress sessionId from stdout.");
  }

  const sessionDir = workspacePath(".deeprun", "stress", sessionId);
  const entries = await fs.readdir(sessionDir);

  const windows = entries
    .filter((entry) => /^window-\d+\.json$/.test(entry))
    .sort((left, right) => left.localeCompare(right));
  const gateStops = entries
    .filter((entry) => /^gate-stop-\d+\.json$/.test(entry))
    .sort((left, right) => left.localeCompare(right));

  return {
    sessionId,
    sessionDir,
    latestWindowPath: windows.length > 0 ? path.join(sessionDir, windows[windows.length - 1]!) : null,
    gateStopPath: gateStops.length > 0 ? path.join(sessionDir, gateStops[gateStops.length - 1]!) : null
  };
}

async function validateStressSuccess(input: {
  proof: ProofPack;
  name: string;
  command: CommandResult;
  repoRoot: string;
}): Promise<void> {
  const artifacts = await parseStressArtifacts(input.repoRoot, input.command.stdoutPath);
  const stepArtifacts = [...input.command.artifacts, artifacts.sessionDir];

  if (artifacts.gateStopPath) {
    await recordStepValidation({
      proof: input.proof,
      name: input.name,
      ok: false,
      artifacts: [...stepArtifacts, artifacts.gateStopPath],
      details: {
        sessionId: artifacts.sessionId,
        gateStopPath: artifacts.gateStopPath
      }
    });
    return;
  }

  await recordStepValidation({
    proof: input.proof,
    name: input.name,
    ok: true,
    artifacts: artifacts.latestWindowPath ? [...stepArtifacts, artifacts.latestWindowPath] : stepArtifacts,
    details: {
      sessionId: artifacts.sessionId,
      latestWindowPath: artifacts.latestWindowPath
    }
  });
}

async function validateStressFailure(input: {
  proof: ProofPack;
  name: string;
  command: CommandResult;
  repoRoot: string;
  expectedGate: string;
}): Promise<void> {
  try {
    const artifacts = await parseStressArtifacts(input.repoRoot, input.command.stdoutPath);
    if (!artifacts.gateStopPath) {
      throw new Error("Expected gate-stop artifact but none was created.");
    }

    const gateStop = JSON.parse(await fs.readFile(artifacts.gateStopPath, "utf8")) as Record<string, unknown>;
    if (gateStop.gate !== input.expectedGate) {
      throw new Error(`Expected gate ${input.expectedGate}, got ${String(gateStop.gate)}`);
    }

    await recordStepValidation({
      proof: input.proof,
      name: input.name,
      ok: true,
      artifacts: [...input.command.artifacts, artifacts.sessionDir, artifacts.gateStopPath],
      details: {
        sessionId: artifacts.sessionId,
        gate: gateStop.gate
      }
    });
  } catch (error) {
    await recordStepValidation({
      proof: input.proof,
      name: input.name,
      ok: false,
      artifacts: input.command.artifacts,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("benchmark:proof-pack requires DATABASE_URL.");
  }

  const repoRoot = process.cwd();
  const scale = readScale();
  const sha = await readGitSha(repoRoot);
  const outRoot = path.join(
    workspacePath(".deeprun", "benchmarks"),
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha?.slice(0, 8) ?? "nogit"}`
  );
  await fs.mkdir(outRoot, { recursive: true });

  const config = {
    scale,
    normalSoakRuns: 300 * scale,
    normalSnapshotEvery: 25,
    negativeRepeats: 4 * scale,
    negativeMaxRuns: 80,
    legalSlowSessions: 5 * scale,
    legalSlowRuns: 80,
    workerDeathIterations: 5 * scale,
    serverPort: 3214
  };

  const proof: ProofPack = {
    proofPackSchemaVersion: PROOF_PACK_SCHEMA_VERSION,
    startedAt: isoNow(),
    git: { sha },
    config,
    steps: []
  };

  const env = strictEnv();

  let serverChild: ChildProcess | null = null;
  let serverArtifacts: string[] = [];

  try {
    proof.steps.push(
      await runCommand({
        name: "phase1-typecheck",
        cwd: repoRoot,
        cmd: "npm",
        args: ["run", "check"],
        env,
        outDir: path.join(outRoot, "phase1")
      })
    );

    proof.steps.push(
      await runCommand({
        name: "phase1-contract-bas-tests",
        cwd: repoRoot,
        cmd: "npx",
        args: [
          "tsx",
          "--test",
          "src/agent/__tests__/execution-contract.test.ts",
          "src/agent/__tests__/behavior-affecting-surface.test.ts"
        ],
        env,
        outDir: path.join(outRoot, "phase1")
      })
    );

    const server = await startServer({
      repoRoot,
      outDir: path.join(outRoot, "phase2"),
      port: config.serverPort
    });
    serverChild = server.child;
    serverArtifacts = [server.stdoutPath, server.stderrPath];

    await recordStepValidation({
      proof,
      name: "phase2-api-start",
      ok: true,
      artifacts: serverArtifacts,
      details: {
        baseUrl: server.baseUrl
      }
    });

    const passDecisionPath = path.join(outRoot, "phase2", "governance-decision.pass.json");
    const passIntegration = await runCommand({
      name: "phase2-public-pass",
      cwd: repoRoot,
      cmd: "npm",
      args: [
        "run",
        "integration:fresh-gate",
        "--",
        "--api",
        server.baseUrl,
        "--mode",
        "pass",
        "--output",
        passDecisionPath
      ],
      env,
      outDir: path.join(outRoot, "phase2")
    });
    proof.steps.push(passIntegration);
    await validateDecisionArtifact({
      proof,
      name: "phase2-public-pass-decision",
      decisionPath: passDecisionPath,
      expectedDecision: "PASS"
    });

    await stopChild(serverChild);
    serverChild = null;

    const failServer = await startServer({
      repoRoot,
      outDir: path.join(outRoot, "phase2-fail"),
      port: config.serverPort + 1,
      env: {
        V1_DOCKER_BIN: "__missing_docker_binary__"
      }
    });
    serverChild = failServer.child;
    serverArtifacts = [failServer.stdoutPath, failServer.stderrPath];

    await recordStepValidation({
      proof,
      name: "phase2-fail-api-start",
      ok: true,
      artifacts: serverArtifacts,
      details: {
        baseUrl: failServer.baseUrl,
        V1_DOCKER_BIN: "__missing_docker_binary__"
      }
    });

    const failDecisionPath = path.join(outRoot, "phase2", "governance-decision.fail.json");
    const failIntegration = await runCommand({
      name: "phase2-public-fail",
      cwd: repoRoot,
      cmd: "npm",
      args: [
        "run",
        "integration:fresh-gate",
        "--",
        "--api",
        failServer.baseUrl,
        "--mode",
        "fail",
        "--output",
        failDecisionPath
      ],
      env,
      outDir: path.join(outRoot, "phase2"),
      allowExitCodes: [0]
    });
    proof.steps.push(failIntegration);
    await validateDecisionArtifact({
      proof,
      name: "phase2-public-fail-decision",
      decisionPath: failDecisionPath,
      expectedDecision: "FAIL",
      expectedReasonCode: "RUN_V1_READY_FAILED"
    });

    const normalSoak = await runCommand({
      name: "phase3-normal-soak",
      cwd: repoRoot,
      cmd: "npm",
      args: [
        "run",
        "stress",
        "--",
        "--seed",
        "debt-heavy-benchmark-long",
        "--maxRuns",
        String(config.normalSoakRuns),
        "--snapshotEvery",
        String(config.normalSnapshotEvery)
      ],
      env,
      outDir: path.join(outRoot, "phase3")
    });
    proof.steps.push(normalSoak);
    await validateStressSuccess({
      proof,
      name: "phase3-normal-soak-artifacts",
      command: normalSoak,
      repoRoot
    });

    for (let index = 0; index < config.negativeRepeats; index += 1) {
      const negative = await runCommand({
        name: `phase3-negative-control-${String(index + 1).padStart(2, "0")}`,
        cwd: repoRoot,
        cmd: "npm",
        args: [
          "run",
          "stress",
          "--",
          "--seed",
          `debt-negative-benchmark-${index + 1}`,
          "--maxRuns",
          String(config.negativeMaxRuns),
          "--snapshotEvery",
          "20"
        ],
        env,
        outDir: path.join(outRoot, "phase3"),
        allowExitCodes: [1]
      });
      proof.steps.push(negative);
      await validateStressFailure({
        proof,
        name: `phase3-negative-control-${String(index + 1).padStart(2, "0")}-artifacts`,
        command: negative,
        repoRoot,
        expectedGate: "DEBT_PAYDOWN_FAILURE"
      });
    }

    let legalSlowFalsePositives = 0;
    const legalSlowArtifacts: string[] = [];
    for (let index = 0; index < config.legalSlowSessions; index += 1) {
      const legalSlow = await runCommand({
        name: `phase3-legal-slow-${String(index + 1).padStart(2, "0")}`,
        cwd: repoRoot,
        cmd: "npm",
        args: [
          "run",
          "stress",
          "--",
          "--seed",
          `legal-slow-benchmark-${index + 1}`,
          "--maxRuns",
          String(config.legalSlowRuns),
          "--snapshotEvery",
          "20"
        ],
        env,
        outDir: path.join(outRoot, "phase3")
      });
      proof.steps.push(legalSlow);
      legalSlowArtifacts.push(...legalSlow.artifacts);

      try {
        const stressArtifacts = await parseStressArtifacts(repoRoot, legalSlow.stdoutPath);
        if (stressArtifacts.gateStopPath) {
          legalSlowFalsePositives += 1;
          legalSlowArtifacts.push(stressArtifacts.gateStopPath);
        } else if (stressArtifacts.latestWindowPath) {
          legalSlowArtifacts.push(stressArtifacts.latestWindowPath);
        }
      } catch {
        legalSlowFalsePositives += 1;
      }
    }

    await recordStepValidation({
      proof,
      name: "phase3-legal-slow-false-positive-rate",
      ok: legalSlowFalsePositives === 0,
      artifacts: legalSlowArtifacts,
      details: {
        sessionCount: config.legalSlowSessions,
        falsePositiveRate:
          config.legalSlowSessions > 0 ? legalSlowFalsePositives / config.legalSlowSessions : 0,
        falsePositives: legalSlowFalsePositives
      }
    });

    const workerDeathArtifacts: string[] = [];
    let workerDeathFailures = 0;
    for (let index = 0; index < config.workerDeathIterations; index += 1) {
      const workerDeath = await runCommand({
        name: `phase3-worker-death-${String(index + 1).padStart(2, "0")}`,
        cwd: repoRoot,
        cmd: "npx",
        args: [
          "tsx",
          "-r",
          "dotenv/config",
          "--test",
          "--test-name-pattern",
          "worker lease reclaim completes terminal jobs without duplicating side effects",
          "src/agent/__tests__/kernel-run-flow.test.ts"
        ],
        env,
        outDir: path.join(outRoot, "phase3")
      });
      proof.steps.push(workerDeath);
      workerDeathArtifacts.push(...workerDeath.artifacts);
      if (!workerDeath.ok) {
        workerDeathFailures += 1;
      }
    }

    await recordStepValidation({
      proof,
      name: "phase3-worker-death-summary",
      ok: workerDeathFailures === 0,
      artifacts: workerDeathArtifacts,
      details: {
        iterations: config.workerDeathIterations,
        failures: workerDeathFailures
      }
    });

    proof.steps.push(
      await runCommand({
        name: "phase4-state-machine-docs",
        cwd: repoRoot,
        cmd: "npm",
        args: ["run", "test:agent-state"],
        env,
        outDir: path.join(outRoot, "phase4")
      })
    );

    proof.steps.push(
      await runCommand({
        name: "phase4-artifact-contract-docs",
        cwd: repoRoot,
        cmd: "npm",
        args: ["run", "test:contracts"],
        env,
        outDir: path.join(outRoot, "phase4")
      })
    );

    proof.steps.push(
      await runCommand({
        name: "phase4-artifact-retention",
        cwd: repoRoot,
        cmd: "npx",
        args: [
          "tsx",
          "-r",
          "dotenv/config",
          "--test",
          "--test-name-pattern",
          "terminal runs retain worktree artifacts at terminal state",
          "src/agent/__tests__/kernel-run-flow.test.ts"
        ],
        env,
        outDir: path.join(outRoot, "phase4")
      })
    );
  } finally {
    await stopChild(serverChild);
  }

  proof.finishedAt = isoNow();
  const failedSteps = proof.steps.filter((step) => !step.ok).map((step) => step.name);
  proof.summary = {
    ok: failedSteps.length === 0,
    failedSteps
  };

  const finalizedProofPack = finalizeProofPack(proof);
  const persisted = await persistProofPack({
    proofPack: finalizedProofPack,
    benchmarkDir: outRoot
  });

  if (failedSteps.length > 0) {
    console.error(`Proof pack failed: ${failedSteps.join(", ")}`);
    console.error(`Proof pack artifact: ${persisted.proofPackPath}`);
    console.error(`Proof pack hash: ${finalizedProofPack.proofPackHash}`);
    process.exit(1);
  }

  console.log(`Proof pack OK: ${persisted.proofPackPath}`);
  console.log(`PROOF_PACK_HASH=${finalizedProofPack.proofPackHash}`);
  console.log(`PROOF_PACK_CONTENT_PATH=${persisted.contentAddressedPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
