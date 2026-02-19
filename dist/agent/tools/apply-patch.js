import { z } from "zod";
import { readTextFile, safeResolvePath } from "../../lib/fs-utils.js";
import { contentHash } from "../fs/types.js";
const patchOperationSchema = z.object({
    search: z.string().min(1).max(200_000),
    replace: z.string().max(200_000),
    replaceAll: z.boolean().default(false)
});
const patchFileSchema = z.object({
    path: z.string().min(1).max(240),
    operations: z.array(patchOperationSchema).min(1).max(32)
});
const applyPatchInputSchema = z
    .object({
    path: z.string().min(1).max(240).optional(),
    operations: z.array(patchOperationSchema).min(1).max(32).optional(),
    files: z.array(patchFileSchema).min(1).max(15).optional()
})
    .superRefine((value, ctx) => {
    const hasSingle = typeof value.path === "string" || Array.isArray(value.operations);
    const hasBatch = Array.isArray(value.files) && value.files.length > 0;
    if (hasSingle && hasBatch) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Use either path/operations or files[], not both."
        });
        return;
    }
    if (!hasBatch && (typeof value.path !== "string" || !Array.isArray(value.operations) || value.operations.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide either path/operations or files[]."
        });
    }
});
function applySingleOperation(source, operation) {
    if (operation.replaceAll) {
        if (!source.includes(operation.search)) {
            throw new Error(`Patch search string not found: ${operation.search.slice(0, 80)}`);
        }
        const chunks = source.split(operation.search);
        return {
            next: chunks.join(operation.replace),
            replacements: chunks.length - 1
        };
    }
    const index = source.indexOf(operation.search);
    if (index < 0) {
        throw new Error(`Patch search string not found: ${operation.search.slice(0, 80)}`);
    }
    return {
        next: source.slice(0, index) + operation.replace + source.slice(index + operation.search.length),
        replacements: 1
    };
}
function toPatchTargets(input) {
    if (Array.isArray(input.files) && input.files.length > 0) {
        return input.files;
    }
    return [
        {
            path: input.path,
            operations: input.operations
        }
    ];
}
export const applyPatchTool = {
    name: "apply_patch",
    description: "Propose deterministic string replacement changes for existing text files.",
    inputSchema: applyPatchInputSchema,
    async execute(input, context) {
        const targets = toPatchTargets(input);
        const proposedChanges = [];
        const changedPaths = [];
        const replacementsByFile = [];
        for (const target of targets) {
            const targetPath = safeResolvePath(context.projectRoot, target.path);
            const original = await readTextFile(targetPath);
            const oldContentHash = contentHash(original);
            let content = original;
            let totalReplacements = 0;
            for (const operation of target.operations) {
                const result = applySingleOperation(content, operation);
                content = result.next;
                totalReplacements += result.replacements;
            }
            if (content === original) {
                continue;
            }
            proposedChanges.push({
                path: target.path,
                type: "update",
                newContent: content,
                oldContentHash
            });
            changedPaths.push(target.path);
            replacementsByFile.push({
                path: target.path,
                replacements: totalReplacements,
                operations: target.operations.length
            });
        }
        const replacementCount = replacementsByFile.reduce((sum, entry) => sum + entry.replacements, 0);
        const operationCount = replacementsByFile.reduce((sum, entry) => sum + entry.operations, 0);
        return {
            proposedChanges,
            fileCount: changedPaths.length,
            paths: changedPaths,
            operations: operationCount,
            replacements: replacementCount,
            replacementsByFile
        };
    }
};
