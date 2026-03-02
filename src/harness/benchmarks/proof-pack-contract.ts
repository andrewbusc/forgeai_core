import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { workspacePath } from "../../lib/workspace.js";

export const PROOF_PACK_SCHEMA_VERSION = 1 as const;

const proofPackStepSchema = z.object({
  name: z.string().min(1),
  ok: z.boolean(),
  exitCode: z.number().int(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  artifacts: z.array(z.string().min(1)),
  details: z.record(z.unknown()).optional()
});

export const proofPackPayloadWithoutHashSchema = z.object({
  proofPackSchemaVersion: z.literal(PROOF_PACK_SCHEMA_VERSION),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  git: z
    .object({
      sha: z.string().min(1).optional()
    })
    .optional(),
  config: z.record(z.unknown()),
  steps: z.array(proofPackStepSchema),
  summary: z
    .object({
      ok: z.boolean(),
      failedSteps: z.array(z.string().min(1))
    })
    .optional()
});

export const proofPackSchema = proofPackPayloadWithoutHashSchema.extend({
  proofPackHash: z.string().length(64)
});

export type ProofPackStep = z.infer<typeof proofPackStepSchema>;
export type ProofPackPayloadWithoutHash = z.infer<typeof proofPackPayloadWithoutHashSchema>;
export type ProofPackPayload = z.infer<typeof proofPackSchema>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  });

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function buildProofPackHash(payloadWithoutHash: ProofPackPayloadWithoutHash): string {
  return createHash("sha256").update(canonicalJson(payloadWithoutHash)).digest("hex");
}

export function finalizeProofPack(payloadWithoutHash: ProofPackPayloadWithoutHash): ProofPackPayload {
  const parsed = proofPackPayloadWithoutHashSchema.parse(payloadWithoutHash);
  return proofPackSchema.parse({
    ...parsed,
    proofPackHash: buildProofPackHash(parsed)
  });
}

export async function persistProofPack(input: {
  proofPack: ProofPackPayload;
  benchmarkDir: string;
  rootDir?: string;
}): Promise<{
  proofPackPath: string;
  contentAddressedPath: string;
  latestPath: string;
}> {
  const proofPackPath = path.join(input.benchmarkDir, "proof-pack.json");
  const packsDir = input.rootDir
    ? path.join(input.rootDir, ".deeprun", "benchmarks", "proof-packs")
    : workspacePath(".deeprun", "benchmarks", "proof-packs");
  const contentAddressedPath = path.join(packsDir, `${input.proofPack.proofPackHash}.json`);
  const latestPath = path.join(packsDir, "latest.json");
  const serialized = `${JSON.stringify(input.proofPack, null, 2)}\n`;

  await mkdir(input.benchmarkDir, { recursive: true });
  await mkdir(packsDir, { recursive: true });
  await writeFile(proofPackPath, serialized, "utf8");
  await writeFile(contentAddressedPath, serialized, "utf8");
  await writeFile(latestPath, serialized, "utf8");

  return {
    proofPackPath,
    contentAddressedPath,
    latestPath
  };
}
