import { Buffer } from "node:buffer";
import { z } from "zod";
import { pathExists, readTextFile, safeResolvePath } from "../../lib/fs-utils.js";
import { contentHash } from "../fs/types.js";
const writeFileEntrySchema = z.object({
    path: z.string().min(1).max(240),
    content: z.string().max(1_500_000)
});
const writeFileInputSchema = z
    .object({
    path: z.string().min(1).max(240).optional(),
    content: z.string().max(1_500_000).optional(),
    files: z.array(writeFileEntrySchema).min(1).max(15).optional()
})
    .superRefine((value, ctx) => {
    const hasSingle = typeof value.path === "string" || typeof value.content === "string";
    const hasBatch = Array.isArray(value.files) && value.files.length > 0;
    if (hasSingle && hasBatch) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Use either path/content or files[], not both."
        });
        return;
    }
    if (!hasBatch && (typeof value.path !== "string" || typeof value.content !== "string")) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide either path/content or files[]."
        });
    }
});
function toWriteEntries(input) {
    if (Array.isArray(input.files) && input.files.length > 0) {
        return input.files;
    }
    return [
        {
            path: input.path,
            content: input.content
        }
    ];
}
export const writeFileTool = {
    name: "write_file",
    description: "Propose create/update changes for UTF-8 text files in the project workspace.",
    inputSchema: writeFileInputSchema,
    async execute(input, context) {
        const entries = toWriteEntries(input);
        const proposedChanges = [];
        const changedPaths = [];
        const unchangedPaths = [];
        let plannedBytes = 0;
        for (const entry of entries) {
            const targetPath = safeResolvePath(context.projectRoot, entry.path);
            const exists = await pathExists(targetPath);
            const previous = exists ? await readTextFile(targetPath) : null;
            if (previous === entry.content) {
                unchangedPaths.push(entry.path);
                continue;
            }
            const change = exists
                ? {
                    path: entry.path,
                    type: "update",
                    newContent: entry.content,
                    oldContentHash: contentHash(previous || "")
                }
                : {
                    path: entry.path,
                    type: "create",
                    newContent: entry.content
                };
            proposedChanges.push(change);
            changedPaths.push(entry.path);
            plannedBytes += Buffer.byteLength(entry.content, "utf8");
        }
        return {
            proposedChanges,
            fileCount: changedPaths.length,
            paths: changedPaths,
            unchangedPaths,
            plannedBytes
        };
    }
};
