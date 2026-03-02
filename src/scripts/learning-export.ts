import "dotenv/config";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { AppStore } from "../lib/project-store.js";
import { workspacePath } from "../lib/workspace.js";

interface ParsedOptions {
  hydrated: boolean;
  successOnly: boolean;
  minDelta: number | null;
}

interface LearningEventRow extends Record<string, unknown> {
  run_id?: string;
  project_id?: string;
  step_index?: number | null;
  phase?: string | null;
  clusters?: unknown;
  delta?: number | null;
  convergence_flag?: boolean | null;
  regression_flag?: boolean | null;
  metadata?: unknown;
  outcome?: string | null;
}

interface LearningArtifactRow {
  stepIndex?: number;
  prompt?: unknown;
  correctionPrompt?: unknown;
  correctionProfile?: unknown;
  validationBefore?: unknown;
  validationAfter?: unknown;
  changedFiles?: unknown;
  invariantFailures?: unknown;
}

function parseOptions(args: string[]): ParsedOptions {
  const minDeltaArg = args.find((arg) => arg.startsWith("--min-delta="));
  const rawMinDelta = minDeltaArg ? Number.parseInt(minDeltaArg.split("=")[1] || "", 10) : null;

  if (minDeltaArg && Number.isNaN(rawMinDelta)) {
    throw new Error(`Invalid --min-delta value: ${minDeltaArg}`);
  }

  return {
    hydrated: args.includes("--hydrated"),
    successOnly: args.includes("--success-only"),
    minDelta: rawMinDelta
  };
}

function loadRunArtifacts(projectRoot: string, runId: string): LearningArtifactRow[] {
  const runFile = path.join(projectRoot, ".deeprun", "learning", "runs", `${runId}.jsonl`);

  if (!fs.existsSync(runFile)) {
    return [];
  }

  return fs
    .readFileSync(runFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LearningArtifactRow;
      } catch {
        return null;
      }
    })
    .filter((value): value is LearningArtifactRow => value !== null);
}

async function resolveProjectRoot(
  store: AppStore,
  projectId: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  if (cache.has(projectId)) {
    return cache.get(projectId) ?? null;
  }

  const project = await store.getProject(projectId);
  const projectRoot = project ? store.getProjectWorkspacePath(project) : null;
  cache.set(projectId, projectRoot);
  return projectRoot;
}

async function main(): Promise<void> {
  const store = new AppStore();

  try {
    await store.initialize();

    const options = parseOptions(process.argv.slice(2));
    const where: string[] = [];
    const values: unknown[] = [];

    if (options.successOnly) {
      where.push("convergence_flag = TRUE");
    }

    if (options.minDelta !== null) {
      values.push(options.minDelta);
      where.push(`delta >= $${values.length}`);
    }

    const sql = `
      SELECT *
      FROM learning_events
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at ASC
    `;
    const rows = await store.query<LearningEventRow>(sql, values);

    const outDir = workspacePath(".deeprun", "datasets");
    await fsp.mkdir(outDir, { recursive: true });

    const outFile = path.join(outDir, `learning_export_${Date.now()}.jsonl`);
    const projectRootCache = new Map<string, string | null>();
    const outputRows: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      if (!options.hydrated) {
        outputRows.push(row);
        continue;
      }

      if (typeof row.run_id !== "string" || row.run_id.length === 0) {
        continue;
      }

      if (typeof row.project_id !== "string" || row.project_id.length === 0) {
        continue;
      }

      if (typeof row.step_index !== "number") {
        continue;
      }

      const projectRoot = await resolveProjectRoot(store, row.project_id, projectRootCache);
      if (!projectRoot) {
        continue;
      }

      const artifacts = loadRunArtifacts(projectRoot, row.run_id);
      const match = artifacts.find((artifact) => artifact.stepIndex === row.step_index);
      if (!match) {
        continue;
      }

      outputRows.push({
        runId: row.run_id,
        stepIndex: row.step_index,
        phase: row.phase ?? null,
        clusters: row.clusters ?? null,
        delta: row.delta ?? null,
        convergence: row.convergence_flag ?? false,
        regression: row.regression_flag ?? false,
        outcome: row.outcome ?? null,
        metadata: row.metadata ?? {},
        prompt: match.prompt ?? null,
        correctionPrompt: match.correctionPrompt ?? null,
        correctionProfile: match.correctionProfile ?? null,
        validationBefore: match.validationBefore ?? null,
        validationAfter: match.validationAfter ?? null,
        changedFiles: match.changedFiles ?? null,
        invariantFailures: match.invariantFailures ?? null
      });
    }

    const contents = outputRows.map((row) => JSON.stringify(row)).join("\n");
    await fsp.writeFile(outFile, contents.length > 0 ? `${contents}\n` : "", "utf8");

    console.log(`Exported ${outputRows.length} events to ${outFile}`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
