import fs from "node:fs/promises";
import path from "node:path";

export async function appendLearningJsonl(projectRoot: string, runId: string, payload: unknown): Promise<void> {
  const dir = path.join(projectRoot, ".deeprun", "learning", "runs");
  await fs.mkdir(dir, { recursive: true });

  const file = path.join(dir, `${runId}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function writeSnapshot(
  projectRoot: string,
  runId: string,
  stepIndex: number,
  attempt: number,
  payload: unknown
): Promise<void> {
  const dir = path.join(projectRoot, ".deeprun", "learning", "snapshots");
  await fs.mkdir(dir, { recursive: true });

  const file = path.join(dir, `${runId}_${stepIndex}_${attempt}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    flag: "wx"
  });
}

export async function writeStubDebtArtifact(
  projectRoot: string,
  runId: string,
  stepIndex: number,
  attempt: number,
  payload: unknown
): Promise<string> {
  const dir = path.join(projectRoot, ".deeprun", "learning", "stub-debt");
  await fs.mkdir(dir, { recursive: true });

  const file = path.join(dir, `${runId}_${stepIndex}_${attempt}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    flag: "wx"
  });

  return file;
}
