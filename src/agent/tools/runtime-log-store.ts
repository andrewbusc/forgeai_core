import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureDir } from "../../lib/fs-utils.js";

const runtimeLogRoot = path.join(process.cwd(), ".data", "agent-runtime");

export interface RuntimeLogRecord {
  projectId: string;
  status: string;
  logs: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

function normalizeProjectId(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function runtimeLogPathForProject(projectId: string): string {
  return path.join(runtimeLogRoot, `${normalizeProjectId(projectId)}.json`);
}

export async function writeRuntimeLog(record: RuntimeLogRecord): Promise<void> {
  await ensureDir(runtimeLogRoot);
  const filePath = runtimeLogPathForProject(record.projectId);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
}

export async function readRuntimeLog(projectId: string): Promise<RuntimeLogRecord | undefined> {
  const filePath = runtimeLogPathForProject(projectId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<RuntimeLogRecord>;

    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    return {
      projectId,
      status: typeof parsed.status === "string" ? parsed.status : "unknown",
      logs: typeof parsed.logs === "string" ? parsed.logs : "",
      metadata:
        parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
          ? (parsed.metadata as Record<string, unknown>)
          : {},
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString()
    };
  } catch {
    return undefined;
  }
}
