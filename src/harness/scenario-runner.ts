import "dotenv/config";

import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AppStore } from "../lib/project-store.js";
import { type ScenarioLabel } from "./scenario-fixtures.js";
import { createHarnessRuntime, runScenario } from "./utils.js";

const plan: ScenarioLabel[] = [
  ...Array(5).fill("architecture_contract"),
  ...Array(4).fill("typecheck_failure"),
  ...Array(4).fill("build_failure"),
  ...Array(2).fill("regression"),
  ...Array(2).fill("oscillation")
];

async function main(): Promise<void> {
  const store = new AppStore();
  await store.initialize();

  try {
    const runtime = await createHarnessRuntime(store);
    const counts = new Map<ScenarioLabel, number>();

    console.log(`Running correction pressure harness with ${plan.length} deterministic scenarios.`);

    for (const label of plan) {
      const occurrence = (counts.get(label) ?? 0) + 1;
      counts.set(label, occurrence);

      const result = await runScenario(runtime, label, occurrence);
      console.log(
        JSON.stringify(
          {
            label: result.label,
            occurrence: result.occurrence,
            runId: result.runId,
            projectId: result.projectId,
            status: result.status,
            validationStatus: result.validationStatus,
            correctionAttempts: result.correctionAttempts,
            learningEventCount: result.learningEventCount
          },
          null,
          2
        )
      );
    }
  } finally {
    await store.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
