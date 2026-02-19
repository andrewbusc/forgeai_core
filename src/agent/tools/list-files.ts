import path from "node:path";
import { z } from "zod";
import { buildTree, pathExists, safeResolvePath } from "../../lib/fs-utils.js";
import { AgentTool } from "./index.js";

const listFilesInputSchema = z.object({
  path: z.string().max(240).optional(),
  maxEntries: z.number().int().min(1).max(800).default(200)
});

interface FlatTreeEntry {
  path: string;
  type: "file" | "directory";
}

export const listFilesTool: AgentTool<z.infer<typeof listFilesInputSchema>> = {
  name: "list_files",
  description: "List files and directories relative to the project workspace.",
  inputSchema: listFilesInputSchema,
  async execute(input, context) {
    const basePath = input.path || ".";
    const targetPath = safeResolvePath(context.projectRoot, basePath);

    if (!(await pathExists(targetPath))) {
      throw new Error(`Path does not exist: ${basePath}`);
    }

    const tree = await buildTree(targetPath);
    const entries: FlatTreeEntry[] = [];

    const walk = (nodes: Awaited<ReturnType<typeof buildTree>>, parent = ""): void => {
      for (const node of nodes) {
        if (entries.length >= input.maxEntries) {
          return;
        }

        const relative = parent ? `${parent}/${node.name}` : node.name;
        entries.push({
          path: path.posix.join(basePath === "." ? "" : basePath, relative).replace(/^\/+/, "") || ".",
          type: node.type
        });

        if (node.type === "directory" && node.children) {
          walk(node.children, relative);
        }
      }
    };

    walk(tree);

    return {
      basePath,
      total: entries.length,
      entries
    };
  }
};

