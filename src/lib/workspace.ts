import path from "node:path";

const WORKSPACE_ROOT_ENV = "DEEPRUN_WORKSPACE_ROOT";

export function resolveWorkspaceRoot(explicitRoot?: string): string {
  const rawExplicit = typeof explicitRoot === "string" ? explicitRoot.trim() : "";
  if (rawExplicit) {
    return path.resolve(rawExplicit);
  }

  const configured = String(process.env[WORKSPACE_ROOT_ENV] || "").trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error(`${WORKSPACE_ROOT_ENV} must be an absolute path. Received '${configured}'.`);
    }

    return path.resolve(configured);
  }

  return path.resolve(process.cwd());
}

export function workspacePath(...parts: string[]): string {
  return path.join(resolveWorkspaceRoot(), ...parts);
}

export function workspacePathFrom(rootDir: string | undefined, ...parts: string[]): string {
  return path.join(resolveWorkspaceRoot(rootDir), ...parts);
}
