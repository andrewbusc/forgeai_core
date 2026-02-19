import { promises as fs } from "node:fs";
import path from "node:path";
export async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}
export function safeResolvePath(rootDir, relativePath) {
    const normalized = relativePath.replace(/^\/+/, "");
    const candidate = path.resolve(rootDir, normalized);
    const safeRoot = `${path.resolve(rootDir)}${path.sep}`;
    if (candidate !== path.resolve(rootDir) && !candidate.startsWith(safeRoot)) {
        throw new Error(`Unsafe path: ${relativePath}`);
    }
    return candidate;
}
export async function writeTextFile(filePath, content) {
    const parent = path.dirname(filePath);
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
}
export async function readTextFile(filePath) {
    return fs.readFile(filePath, "utf8");
}
export async function removeFile(filePath) {
    await fs.rm(filePath, { force: true });
}
export async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
export async function buildTree(rootDir, currentDir = rootDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const nodes = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
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
        }
        else {
            nodes.push({
                name: entry.name,
                path: relativePath,
                type: "file"
            });
        }
    }
    return nodes;
}
export async function collectFiles(rootDir, maxFiles = 25, maxBytesPerFile = 12000) {
    const files = [];
    async function walk(dir) {
        if (files.length >= maxFiles) {
            return;
        }
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (files.length >= maxFiles) {
                return;
            }
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
                continue;
            }
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute);
            }
            else {
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
