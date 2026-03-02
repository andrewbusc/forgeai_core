import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentRunDetail } from "../agent/types.js";
import { evaluateExecutionContractSupport } from "../agent/execution-contract.js";
import { workspacePath } from "../lib/workspace.js";

export const GOVERNANCE_DECISION_SCHEMA_VERSION = 2 as const;

const governanceReasonSchema = z.object({
  code: z.string().min(1),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional()
});

const governanceArtifactRefSchema = z.object({
  kind: z.string().min(1),
  path: z.string().min(1),
  contentType: z.string().optional(),
  sessionId: z.string().optional()
});

export const governanceDecisionPayloadWithoutHashSchema = z.object({
  decisionSchemaVersion: z.literal(GOVERNANCE_DECISION_SCHEMA_VERSION),
  decision: z.enum(["PASS", "FAIL"]),
  reasonCodes: z.array(z.string().min(1)),
  reasons: z.array(governanceReasonSchema),
  runId: z.string().uuid(),
  contract: z.object({
    schemaVersion: z.number().int().min(1),
    hash: z.string().min(1),
    determinismPolicyVersion: z.number().int().min(1),
    plannerPolicyVersion: z.number().int().min(1),
    correctionRecipeVersion: z.number().int().min(1),
    validationPolicyVersion: z.number().int().min(1),
    randomnessSeed: z.string().min(1)
  }),
  artifactRefs: z.array(governanceArtifactRefSchema)
});

export const governanceDecisionSchema = governanceDecisionPayloadWithoutHashSchema.extend({
  decisionHash: z.string().length(64)
});

export type GovernanceDecisionPayload = z.infer<typeof governanceDecisionSchema>;
export type GovernanceDecisionPayloadWithoutHash = z.infer<typeof governanceDecisionPayloadWithoutHashSchema>;

function toRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  return input as Record<string, unknown>;
}

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

export function buildGovernanceDecisionHash(payloadWithoutHash: GovernanceDecisionPayloadWithoutHash): string {
  return createHash("sha256").update(canonicalJson(payloadWithoutHash)).digest("hex");
}

export function finalizeGovernanceDecision(
  payloadWithoutHash: GovernanceDecisionPayloadWithoutHash
): GovernanceDecisionPayload {
  const parsed = governanceDecisionPayloadWithoutHashSchema.parse(payloadWithoutHash);
  return governanceDecisionSchema.parse({
    ...parsed,
    decisionHash: buildGovernanceDecisionHash(parsed)
  });
}

export async function persistGovernanceDecision(input: {
  decision: GovernanceDecisionPayload;
  rootDir?: string;
}): Promise<{
  decisionPath: string;
  latestPath: string;
}> {
  const decisionsDir = input.rootDir
    ? path.join(input.rootDir, ".deeprun", "decisions")
    : workspacePath(".deeprun", "decisions");
  const decisionPath = path.join(decisionsDir, `${input.decision.decisionHash}.json`);
  const latestPath = path.join(decisionsDir, "latest.json");
  const serialized = `${JSON.stringify(input.decision, null, 2)}\n`;

  await mkdir(decisionsDir, { recursive: true });
  await writeFile(decisionPath, serialized, "utf8");
  await writeFile(latestPath, serialized, "utf8");

  return {
    decisionPath,
    latestPath
  };
}

export function buildGovernanceDecision(input: {
  detail: AgentRunDetail;
  strictV1Ready: boolean;
}): GovernanceDecisionPayload {
  const reasons: GovernanceDecisionPayload["reasons"] = [];
  const validationResult = toRecord(input.detail.run.validationResult);
  const validation = toRecord(validationResult?.validation);
  const v1Ready = toRecord(validationResult?.v1Ready);
  const contract = input.detail.contract;
  const contractSupport = contract ? evaluateExecutionContractSupport(contract.material) : null;

  if (!contract?.hash) {
    reasons.push({
      code: "EXECUTION_CONTRACT_MISSING",
      message: "Run does not expose a persisted execution contract hash."
    });
  }

  if (contractSupport && !contractSupport.supported) {
    reasons.push({
      code: "UNSUPPORTED_CONTRACT",
      message: contractSupport.message || "Worker/runtime does not support this execution contract.",
      details: contractSupport.details
    });
  } else if (
    typeof input.detail.run.errorMessage === "string" &&
    input.detail.run.errorMessage.startsWith("UNSUPPORTED_CONTRACT:")
  ) {
    reasons.push({
      code: "UNSUPPORTED_CONTRACT",
      message: input.detail.run.errorMessage
    });
  }

  if (input.detail.run.status !== "complete") {
    reasons.push({
      code: "RUN_NOT_COMPLETE",
      message: "Run is not complete.",
      details: {
        status: input.detail.run.status
      }
    });
  }

  if (!input.detail.run.validationStatus) {
    reasons.push({
      code: "RUN_NOT_VALIDATED",
      message: "Run has not been validated."
    });
  } else if (input.detail.run.validationStatus !== "passed") {
    reasons.push({
      code: "RUN_VALIDATION_FAILED",
      message: "Run validation failed.",
      details: {
        validationStatus: input.detail.run.validationStatus,
        summary: typeof validation?.summary === "string" ? validation.summary : null,
        blockingCount: typeof validation?.blockingCount === "number" ? validation.blockingCount : null,
        warningCount: typeof validation?.warningCount === "number" ? validation.warningCount : null
      }
    });
  }

  if (!input.detail.run.currentCommitHash) {
    reasons.push({
      code: "RUN_COMMIT_UNPINNED",
      message: "Run does not have a pinned commit hash."
    });
  }

  if (input.strictV1Ready) {
    if (typeof v1Ready?.ok !== "boolean") {
      reasons.push({
        code: "RUN_V1_READY_NOT_RUN",
        message: "Run has not been strict v1-ready validated."
      });
    } else if (v1Ready.ok !== true) {
      reasons.push({
        code: "RUN_V1_READY_FAILED",
        message: "Run v1-ready validation failed.",
        details: {
          verdict: typeof v1Ready.verdict === "string" ? v1Ready.verdict : null,
          generatedAt: typeof v1Ready.generatedAt === "string" ? v1Ready.generatedAt : null,
          checks: Array.isArray(v1Ready.checks) ? v1Ready.checks : []
        }
      });
    }
  }

  const artifactRefs: GovernanceDecisionPayload["artifactRefs"] = [];
  if (typeof input.detail.run.worktreePath === "string" && input.detail.run.worktreePath.trim()) {
    artifactRefs.push({
      kind: "run_worktree",
      path: input.detail.run.worktreePath.trim()
    });
  }

  if (typeof validationResult?.targetPath === "string" && validationResult.targetPath.trim()) {
    artifactRefs.push({
      kind: "validation_target",
      path: validationResult.targetPath.trim()
    });
  }

  artifactRefs.sort((left, right) => {
    if (left.kind < right.kind) {
      return -1;
    }
    if (left.kind > right.kind) {
      return 1;
    }
    if (left.path < right.path) {
      return -1;
    }
    if (left.path > right.path) {
      return 1;
    }
    return 0;
  });

  const reasonCodes = Array.from(new Set(reasons.map((entry) => entry.code)));

  return finalizeGovernanceDecision({
    decisionSchemaVersion: GOVERNANCE_DECISION_SCHEMA_VERSION,
    decision: reasons.length === 0 ? "PASS" : "FAIL",
    reasonCodes,
    reasons,
    runId: input.detail.run.id,
    contract: {
      schemaVersion: contract?.schemaVersion || input.detail.executionConfigSummary?.schemaVersion || 1,
      hash: contract?.hash || "missing",
      determinismPolicyVersion: contract?.material.determinismPolicyVersion || 1,
      plannerPolicyVersion: contract?.material.plannerPolicyVersion || 1,
      correctionRecipeVersion: contract?.material.correctionRecipeVersion || 1,
      validationPolicyVersion: contract?.material.validationPolicyVersion || 1,
      randomnessSeed: contract?.material.randomnessSeed || "missing"
    },
    artifactRefs
  });
}
