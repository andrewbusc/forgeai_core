import fs from "node:fs/promises";
import path from "node:path";

const STUB_MARKER_PREFIX = "// @deeprun-stub ";

interface ParsedStubDebtArtifact {
  status: "open" | "closed";
  timestamp: string;
  targetPaths: string[];
  payload: Record<string, unknown>;
}

export interface StubDebtSummary {
  markerCount: number;
  markerPaths: string[];
  artifactCount: number;
  openCount: number;
  openTargets: string[];
  lastStubPath: string | null;
  lastPaydownAction: string | null;
  lastPaydownStatus: "open" | "closed" | null;
  lastPaydownAt: string | null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(rootDir: string, currentDir = rootDir, files: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".deeprun" || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(rootDir, absolutePath, files);
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

function extractTargetPaths(payload: Record<string, unknown>): string[] {
  const targets = new Set<string>();

  const addPath = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      targets.add(value.trim());
    }
  };

  addPath(payload.stubPath);

  const stubTargets = Array.isArray(payload.stubTargets) ? payload.stubTargets : [];
  for (const entry of stubTargets) {
    addPath(toRecord(entry)?.path);
  }

  const debtTargets = Array.isArray(payload.debtTargets) ? payload.debtTargets : [];
  for (const entry of debtTargets) {
    addPath(toRecord(entry)?.path);
  }

  return Array.from(targets);
}

async function collectStubMarkerPaths(projectRoot: string): Promise<string[]> {
  if (!(await pathExists(projectRoot))) {
    return [];
  }

  const files = await walkFiles(projectRoot);
  const markerPaths: string[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (content.includes(STUB_MARKER_PREFIX)) {
        markerPaths.push(path.relative(projectRoot, filePath).replaceAll("\\", "/"));
      }
    } catch {
      // Ignore binary/unreadable files.
    }
  }

  return markerPaths.sort((a, b) => a.localeCompare(b));
}

async function readStubDebtArtifacts(projectRoot: string): Promise<ParsedStubDebtArtifact[]> {
  const dir = path.join(projectRoot, ".deeprun", "learning", "stub-debt");
  if (!(await pathExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const artifacts: ParsedStubDebtArtifact[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(dir, entry.name);
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
      const status = parsed.status === "closed" ? "closed" : parsed.status === "open" ? "open" : null;
      if (!status) {
        continue;
      }

      const timestampValue =
        typeof parsed.resolvedAt === "string" && parsed.resolvedAt.trim()
          ? parsed.resolvedAt.trim()
          : typeof parsed.createdAt === "string" && parsed.createdAt.trim()
            ? parsed.createdAt.trim()
            : null;

      artifacts.push({
        status,
        timestamp: timestampValue || new Date((await fs.stat(filePath)).mtimeMs).toISOString(),
        targetPaths: extractTargetPaths(parsed),
        payload: parsed
      });
    } catch {
      // Ignore malformed artifacts so strict readiness can continue reporting real unresolved state.
    }
  }

  artifacts.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return artifacts;
}

export async function summarizeStubDebt(projectRoot: string): Promise<StubDebtSummary> {
  const markerPaths = await collectStubMarkerPaths(projectRoot);
  const artifacts = await readStubDebtArtifacts(projectRoot);
  const latestByTarget = new Map<string, ParsedStubDebtArtifact>();

  for (const artifact of artifacts) {
    const targetPaths = artifact.targetPaths.length > 0 ? artifact.targetPaths : [""];
    for (const targetPath of targetPaths) {
      const previous = latestByTarget.get(targetPath);
      if (!previous || previous.timestamp.localeCompare(artifact.timestamp) <= 0) {
        latestByTarget.set(targetPath, artifact);
      }
    }
  }

  const openTargets = Array.from(latestByTarget.entries())
    .filter(([, artifact]) => artifact.status === "open")
    .map(([targetPath]) => targetPath)
    .filter((targetPath) => targetPath.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const latestArtifact = artifacts[artifacts.length - 1] || null;
  const lastStubPath =
    typeof latestArtifact?.payload.stubPath === "string" && latestArtifact.payload.stubPath.trim()
      ? latestArtifact.payload.stubPath.trim()
      : latestArtifact?.targetPaths[0] || null;
  const lastPaydownAction =
    typeof latestArtifact?.payload.debtPaydownAction === "string" && latestArtifact.payload.debtPaydownAction.trim()
      ? latestArtifact.payload.debtPaydownAction.trim()
      : null;

  return {
    markerCount: markerPaths.length,
    markerPaths,
    artifactCount: artifacts.length,
    openCount: openTargets.length,
    openTargets,
    lastStubPath,
    lastPaydownAction,
    lastPaydownStatus: latestArtifact?.status || null,
    lastPaydownAt: latestArtifact?.timestamp || null
  };
}
