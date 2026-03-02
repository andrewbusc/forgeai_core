import { z } from "zod";
import { collectFiles, pathExists, readTextFile, safeResolvePath } from "../../lib/fs-utils.js";
import { ProviderRegistry } from "../../lib/providers.js";
import { FileAction } from "../../types.js";
import { ProposedFileChange, contentHash } from "../fs/types.js";
import { AgentTool } from "./index.js";

const aiMutationInputSchema = z.object({
  prompt: z.string().min(1).max(24_000),
  provider: z.string().optional(),
  model: z.string().max(100).optional(),
  mode: z.enum(["generate", "chat", "correction"]).default("generate"),
  context: z.record(z.unknown()).optional()
});

interface GenerationPathState {
  path: string;
  originalExists: boolean;
  originalContent: string | null;
  originalContentHash: string | null;
  currentExists: boolean;
  currentContent: string | null;
  touched: boolean;
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

async function readWorkspaceTextFile(projectRoot: string, relativePath: string): Promise<{
  exists: boolean;
  content: string | null;
  contentHash: string | null;
}> {
  const absolutePath = safeResolvePath(projectRoot, relativePath);
  const exists = await pathExists(absolutePath);

  if (!exists) {
    return {
      exists: false,
      content: null,
      contentHash: null
    };
  }

  const content = await readTextFile(absolutePath);
  return {
    exists: true,
    content,
    contentHash: contentHash(content)
  };
}

async function buildProposedChangesFromActions(
  projectRoot: string,
  actions: FileAction[]
): Promise<ProposedFileChange[]> {
  const states = new Map<string, GenerationPathState>();

  for (const action of actions) {
    const normalizedPath = normalizeRelativePath((action.path || "").trim());
    if (!normalizedPath) {
      continue;
    }

    let state = states.get(normalizedPath);
    if (!state) {
      const existing = await readWorkspaceTextFile(projectRoot, normalizedPath);
      state = {
        path: normalizedPath,
        originalExists: existing.exists,
        originalContent: existing.content,
        originalContentHash: existing.contentHash,
        currentExists: existing.exists,
        currentContent: existing.content,
        touched: false
      };
      states.set(normalizedPath, state);
    }

    if (action.action === "delete") {
      state.currentExists = false;
      state.currentContent = null;
      state.touched = true;
      continue;
    }

    if (typeof action.content !== "string") {
      continue;
    }

    state.currentExists = true;
    state.currentContent = action.content;
    state.touched = true;
  }

  const proposedChanges: ProposedFileChange[] = [];

  for (const state of states.values()) {
    if (!state.touched) {
      continue;
    }

    if (!state.originalExists && !state.currentExists) {
      continue;
    }

    if (!state.originalExists && state.currentExists) {
      proposedChanges.push({
        path: state.path,
        type: "create",
        newContent: state.currentContent || ""
      });
      continue;
    }

    if (state.originalExists && !state.currentExists) {
      if (!state.originalContentHash) {
        throw new Error(`Could not resolve content hash for '${state.path}' delete operation.`);
      }

      proposedChanges.push({
        path: state.path,
        type: "delete",
        oldContentHash: state.originalContentHash
      });
      continue;
    }

    if (state.originalContent === state.currentContent) {
      continue;
    }

    if (!state.originalContentHash) {
      throw new Error(`Could not resolve content hash for '${state.path}' update operation.`);
    }

    proposedChanges.push({
      path: state.path,
      type: "update",
      newContent: state.currentContent || "",
      oldContentHash: state.originalContentHash
    });
  }

  return proposedChanges;
}

function buildBuilderSystemPrompt(contextBlock: string, templateId?: string): string {
  const sections = [
    "You are an expert senior software engineer that edits projects with precise file operations.",
    "Respect existing files and architecture; avoid destructive rewrites.",
    "When updating files, include full updated file content.",
    "If a delete is required, use action=delete and omit content.",
    "Do not output markdown, only JSON.",
    "Prioritize functional implementations over pseudocode.",
    "Project context:",
    contextBlock
  ];

  if (templateId === "canonical-backend") {
    sections.push(
      [
        "Canonical backend generation rules:",
        "- The canonical backend module structure MUST contain only these layer directories inside each module: controller/, service/, repository/, schema/, dto/, tests/.",
        "- Do NOT create new layer directories such as routes/, middleware/, handlers/, or utils/ as module layers.",
        "- If routing logic is needed, place it in controller/.",
        "- If any unknown layer directory exists in edited modules, remove it and move logic into canonical layers.",
        "- controller may import: service, schema, dto.",
        "- service may import: repository, schema, dto.",
        "- repository may import: db.",
        "- db may not import any module layer.",
        "- Forbidden: db importing service.",
        "- Forbidden: repository importing service.",
        "- Forbidden: controller importing db.",
        "- Forbidden: cross-module direct service imports.",
        "- Forbidden: service -> service across modules.",
        "- Module tests under src/modules/<module>/tests must import only that same module's service layer when exercising service behavior.",
        "- Do NOT satisfy service-layer test requirements by importing another module's service into a module's tests.",
        "- If code imports a module-local dto/ or schema/ file, you must also create or update that dto/ or schema/ file in the same module.",
        "- Example: importing '../dto/project-dto.js' from src/modules/project/service/project-service.ts requires creating or updating src/modules/project/dto/project-dto.ts.",
        "- Import paths must resolve from the current file location. For files already under src/, do NOT add an extra '/src/' segment in relative imports.",
        "- Relative import depth examples in canonical backend:",
        "- From src/modules/<module>/controller/* to src/errors/* use '../../../errors/<file>.js' (NOT '../../errors/<file>.js').",
        "- From src/modules/<module>/service/* to src/errors/* use '../../../errors/<file>.js'.",
        "- From src/modules/<module>/repository/* to src/db/prisma.ts use '../../../db/prisma.js'.",
        "- From src/modules/<module>/tests/* to src/db/prisma.ts use '../../../db/prisma.js' (NOT '../../../src/db/prisma.js').",
        "- Only import real infrastructure entrypoints under src/db such as src/db/prisma.ts.",
        "- Do NOT invent domain files under src/db such as src/db/audit-log.ts.",
        "- Domain-specific files must live inside the owning module under controller/, service/, repository/, schema/, dto/, or tests/.",
        "- Before returning file operations, verify every local relative import points to an existing file in the edited tree."
      ].join("\n")
    );
  }

  return sections.join("\n\n");
}

export function createAiMutationTool(providers?: ProviderRegistry): AgentTool<z.infer<typeof aiMutationInputSchema>> {
  return {
    name: "ai_mutation",
    description: "Generate structured file mutations from an AI provider and return proposedChanges for kernel commit.",
    inputSchema: aiMutationInputSchema,
    async execute(input, context) {
      if (!providers) {
        throw new Error("ai_mutation tool is unavailable: ProviderRegistry is not configured.");
      }

      const providerId = providers.resolveProviderId(input.provider);
      const provider = providers.get(providerId);
      const files = await collectFiles(context.projectRoot, 30, 12_000);
      const contextBlock = files.length
        ? files.map((file) => `File: ${file.path}\n\n${file.content.slice(0, 12_000)}`).join("\n\n-----\n\n")
        : "Project is currently empty.";

      const result = await provider.generate({
        model: input.model,
        systemPrompt: buildBuilderSystemPrompt(contextBlock, context.project.templateId),
        userPrompt: input.prompt,
        messages: context.project.messages.slice(-12)
      });

      const proposedChanges = await buildProposedChangesFromActions(context.projectRoot, result.files);

      return {
        mode: input.mode,
        summary: result.summary,
        runCommands: result.runCommands,
        providerId,
        model: input.model || provider.descriptor.defaultModel,
        proposedChanges
      };
    }
  };
}
