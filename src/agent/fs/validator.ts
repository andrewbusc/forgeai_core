import path from "node:path";
import { FileValidationIssue, FileValidationResult, NormalizedFileSessionOptions, StagedFileChange } from "./types.js";

function hasBinaryLikeContent(value: string): boolean {
  if (value.includes("\u0000")) {
    return true;
  }

  let suspicious = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13) {
      continue;
    }
    if (code < 32) {
      suspicious += 1;
    }
  }

  return suspicious > 0;
}

function hasUnsafeRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return normalized.startsWith("/") || normalized.includes("../") || normalized.includes("/..");
}

function isRestrictedEnvPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  return normalized === ".env" || normalized.endsWith("/.env");
}

function isRestrictedByPrefix(relativePath: string, prefixes: string[]): boolean {
  const normalized = relativePath.replaceAll("\\", "/");

  for (const prefix of prefixes) {
    const normalizedPrefix = prefix.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!normalizedPrefix) {
      continue;
    }

    if (normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`)) {
      return true;
    }
  }

  return false;
}

export function validateStagedChanges(input: {
  projectRoot: string;
  stagedChanges: StagedFileChange[];
  config: NormalizedFileSessionOptions;
}): FileValidationResult {
  const issues: FileValidationIssue[] = [];
  const { stagedChanges, config } = input;
  const safeRoot = `${path.resolve(input.projectRoot)}${path.sep}`;
  const totalDiffBytes = stagedChanges.reduce((sum, change) => sum + change.diffBytes, 0);

  if (stagedChanges.length === 0) {
    issues.push({
      code: "empty_step",
      message: "Step has no staged file changes."
    });
  }

  if (stagedChanges.length > config.maxFilesPerStep) {
    issues.push({
      code: "max_files_per_step",
      message: `Step modifies ${stagedChanges.length} files, which exceeds maxFilesPerStep (${config.maxFilesPerStep}).`
    });
  }

  if (totalDiffBytes > config.maxTotalDiffBytes) {
    issues.push({
      code: "max_total_diff_bytes",
      message: `Step diff size ${totalDiffBytes} bytes exceeds maxTotalDiffBytes (${config.maxTotalDiffBytes}).`
    });
  }

  for (const change of stagedChanges) {
    if (hasUnsafeRelativePath(change.path)) {
      issues.push({
        code: "unsafe_path",
        path: change.path,
        message: "Path contains traversal or absolute segments."
      });
    }

    const absolute = path.resolve(change.absolutePath);
    if (absolute !== path.resolve(input.projectRoot) && !absolute.startsWith(safeRoot)) {
      issues.push({
        code: "path_outside_project",
        path: change.path,
        message: "Path resolves outside project boundary."
      });
    }

    if (!config.allowEnvMutation && isRestrictedEnvPath(change.path)) {
      issues.push({
        code: "restricted_env_file",
        path: change.path,
        message: "Mutating .env is blocked by validator policy."
      });
    }

    if (isRestrictedByPrefix(change.path, config.restrictedPathPrefixes)) {
      issues.push({
        code: "restricted_path",
        path: change.path,
        message: "Mutating this path is blocked by validator policy."
      });
    }

    if (typeof change.newContent === "string") {
      const bytes = Buffer.byteLength(change.newContent, "utf8");
      if (bytes > config.maxFileBytes) {
        issues.push({
          code: "max_file_bytes",
          path: change.path,
          message: `File size ${bytes} bytes exceeds maxFileBytes (${config.maxFileBytes}).`
        });
      }

      if (hasBinaryLikeContent(change.newContent)) {
        issues.push({
          code: "binary_like_content",
          path: change.path,
          message: "Binary-like content detected in text file mutation."
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

