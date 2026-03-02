import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveWorkspaceRoot, workspacePath, workspacePathFrom } from "../workspace.js";

test("resolveWorkspaceRoot uses DEEPRUN_WORKSPACE_ROOT when set", () => {
  const previous = process.env.DEEPRUN_WORKSPACE_ROOT;
  process.env.DEEPRUN_WORKSPACE_ROOT = "/mnt/workspace";

  try {
    assert.equal(resolveWorkspaceRoot(), path.resolve("/mnt/workspace"));
    assert.equal(workspacePath(".deeprun", "datasets"), path.join("/mnt/workspace", ".deeprun", "datasets"));
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPRUN_WORKSPACE_ROOT;
    } else {
      process.env.DEEPRUN_WORKSPACE_ROOT = previous;
    }
  }
});

test("workspacePathFrom explicit root overrides DEEPRUN_WORKSPACE_ROOT", () => {
  const previous = process.env.DEEPRUN_WORKSPACE_ROOT;
  process.env.DEEPRUN_WORKSPACE_ROOT = "/mnt/workspace";

  try {
    assert.equal(resolveWorkspaceRoot("/tmp/deeprun-test-root"), path.resolve("/tmp/deeprun-test-root"));
    assert.equal(
      workspacePathFrom("/tmp/deeprun-test-root", ".workspace", "project"),
      path.join("/tmp/deeprun-test-root", ".workspace", "project")
    );
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPRUN_WORKSPACE_ROOT;
    } else {
      process.env.DEEPRUN_WORKSPACE_ROOT = previous;
    }
  }
});

test("resolveWorkspaceRoot rejects relative DEEPRUN_WORKSPACE_ROOT", () => {
  const previous = process.env.DEEPRUN_WORKSPACE_ROOT;
  process.env.DEEPRUN_WORKSPACE_ROOT = "relative/path";

  try {
    assert.throws(() => resolveWorkspaceRoot(), /DEEPRUN_WORKSPACE_ROOT must be an absolute path/);
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPRUN_WORKSPACE_ROOT;
    } else {
      process.env.DEEPRUN_WORKSPACE_ROOT = previous;
    }
  }
});
