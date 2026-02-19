import { z } from "zod";
import { readTextFile, safeResolvePath } from "../../lib/fs-utils.js";
const readFileInputSchema = z.object({
    path: z.string().min(1).max(240)
});
export const readFileTool = {
    name: "read_file",
    description: "Read a UTF-8 text file from the project workspace.",
    inputSchema: readFileInputSchema,
    async execute(input, context) {
        const targetPath = safeResolvePath(context.projectRoot, input.path);
        const content = await readTextFile(targetPath);
        return {
            path: input.path,
            content
        };
    }
};
