import { createHash } from "node:crypto";
import { z } from "zod";

export const proposedFileChangeTypeSchema = z.enum(["create", "update", "delete"]);
export type ProposedFileChangeType = z.infer<typeof proposedFileChangeTypeSchema>;

export const proposedFileChangeSchema = z
  .object({
    path: z.string().min(1).max(400),
    type: proposedFileChangeTypeSchema,
    newContent: z.string().optional(),
    oldContentHash: z.string().regex(/^[a-f0-9]{64}$/i).optional()
  })
  .superRefine((value, ctx) => {
    if ((value.type === "create" || value.type === "update") && typeof value.newContent !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["newContent"],
        message: `'${value.type}' changes require newContent.`
      });
    }

    if (value.type === "update" && !value.oldContentHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["oldContentHash"],
        message: "'update' changes require oldContentHash for optimistic locking."
      });
    }
  });

export type ProposedFileChange = z.infer<typeof proposedFileChangeSchema>;

export interface StagedFileChange extends ProposedFileChange {
  absolutePath: string;
  previousContent: string | null;
  previousContentHash: string | null;
  nextContentHash: string | null;
  diffPreview: string;
  diffBytes: number;
}

export interface FileValidationIssue {
  code: string;
  path?: string;
  message: string;
}

export interface FileValidationResult {
  ok: boolean;
  issues: FileValidationIssue[];
}

export interface FileSessionOptions {
  maxFilesPerStep?: number;
  maxTotalDiffBytes?: number;
  maxFileBytes?: number;
  allowEnvMutation?: boolean;
  restrictedPathPrefixes?: string[];
}

export interface NormalizedFileSessionOptions {
  maxFilesPerStep: number;
  maxTotalDiffBytes: number;
  maxFileBytes: number;
  allowEnvMutation: boolean;
  restrictedPathPrefixes: string[];
}

export interface FileSessionCommitMeta {
  agentRunId: string;
  stepIndex: number;
  stepId: string;
  summary?: string;
}

export interface AppliedStepRecord {
  stepId: string;
  stepIndex: number;
  commitHash: string | null;
  filePaths: string[];
  committedAt: string;
}

export function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

