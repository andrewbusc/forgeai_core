import { z } from "zod";
import { pathExists, readTextFile, safeResolvePath } from "../../lib/fs-utils.js";
import { ProposedFileChange, contentHash } from "../fs/types.js";
import { AgentTool } from "./index.js";

const manualFileWriteInputSchema = z.object({
  path: z.string().min(1).max(240),
  content: z.string().max(1_500_000)
});

export const manualFileWriteTool: AgentTool<z.infer<typeof manualFileWriteInputSchema>> = {
  name: "manual_file_write",
  description: "Propose a single create/update change for a manual editor save without committing.",
  inputSchema: manualFileWriteInputSchema,
  async execute(input, context) {
    const targetPath = safeResolvePath(context.projectRoot, input.path);
    const exists = await pathExists(targetPath);
    const previous = exists ? await readTextFile(targetPath) : null;

    let proposedChanges: ProposedFileChange[] = [];

    if (previous !== input.content) {
      proposedChanges = [
        exists
          ? {
              path: input.path,
              type: "update",
              newContent: input.content,
              oldContentHash: contentHash(previous || "")
            }
          : {
              path: input.path,
              type: "create",
              newContent: input.content
            }
      ];
    }

    return {
      summary: `Manual file edit: ${input.path}`,
      filePath: input.path,
      proposedChanges
    };
  }
};
