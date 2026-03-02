import { promises as fs } from "node:fs";
import path from "node:path";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function safeResolvePath(rootDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, "");
  const candidate = path.resolve(rootDir, normalized);
  const safeRoot = `${path.resolve(rootDir)}${path.sep}`;

  if (candidate !== path.resolve(rootDir) && !candidate.startsWith(safeRoot)) {
    throw new Error(`Unsafe path: ${relativePath}`);
  }

  return candidate;
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  const parent = path.dirname(filePath);
  await fs.mkdir(parent, { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function removeFile(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function compareNormalizedPaths(left: string, right: string): number {
  const normalizedLeft = left.normalize("NFC").replaceAll("\\", "/");
  const normalizedRight = right.normalize("NFC").replaceAll("\\", "/");

  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  return 0;
}

export async function buildTree(rootDir: string, currentDir = rootDir): Promise<FileTreeNode[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries.sort((a, b) => compareNormalizedPaths(a.name, b.name))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: await buildTree(rootDir, absolutePath)
      });
    } else {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "file"
      });
    }
  }

  return nodes;
}

export async function collectFiles(
  rootDir: string,
  maxFiles = 25,
  maxBytesPerFile = 12000
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= maxFiles) {
      return;
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries.sort((a, b) => compareNormalizedPaths(a.name, b.name))) {
      if (files.length >= maxFiles) {
        return;
      }

      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }

      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        const buffer = await fs.readFile(absolute);
        const sliced = buffer.subarray(0, maxBytesPerFile);

        files.push({
          path: path.relative(rootDir, absolute).replaceAll("\\", "/"),
          content: sliced.toString("utf8")
        });
      }
    }
  }

  if (await pathExists(rootDir)) {
    await walk(rootDir);
  }

  return files;
}
