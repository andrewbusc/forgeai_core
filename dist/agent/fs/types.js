import { createHash } from "node:crypto";
import { z } from "zod";
export const proposedFileChangeTypeSchema = z.enum(["create", "update", "delete"]);
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
export function contentHash(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
