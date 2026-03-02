import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderCanonicalStateMachineMarkdown } from "../lifecycle-graph.js";

test("canonical state machine doc matches rendered graph data", async () => {
  const docPath = path.resolve(process.cwd(), "docs/contracts/state-machine.md");
  const actual = await readFile(docPath, "utf8");
  const expected = renderCanonicalStateMachineMarkdown();

  assert.equal(actual, expected);
});
