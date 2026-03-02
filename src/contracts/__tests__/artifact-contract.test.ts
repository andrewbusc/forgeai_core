import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderArtifactContractMarkdown } from "../artifact-contract.js";

test("artifact contract doc matches rendered artifact inventory", async () => {
  const docPath = path.resolve(process.cwd(), "docs/contracts/artifact-contract.md");
  const actual = await readFile(docPath, "utf8");
  const expected = renderArtifactContractMarkdown();

  assert.equal(actual, expected);
});
