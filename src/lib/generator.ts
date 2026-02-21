import { randomUUID } from "node:crypto";
import { FileSession } from "../agent/fs/file-session.js";
import { ProposedFileChange } from "../agent/fs/types.js";
import { Project } from "../types.js";
import { collectFiles } from "./fs-utils.js";
import { AppStore } from "./project-store.js";
import { ProviderRegistry } from "./providers.js";

interface RunGenerationInput {
  store: AppStore;
  registry: ProviderRegistry;
  project: Project;
  prompt: string;
  providerId: string;
  model?: string;
  kind: "generate" | "chat";
}

interface RunGenerationOutput {
  summary: string;
  filesChanged: string[];
  commands: string[];
  commitHash: string | null;
}

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

async function buildProposedChanges(input: {
  session: FileSession;
  actions: Array<{ action: "create" | "update" | "delete"; path: string; content?: string }>;
}): Promise<ProposedFileChange[]> {
  const states = new Map<string, GenerationPathState>();

  for (const action of input.actions) {
    const normalizedPath = normalizeRelativePath((action.path || "").trim());
    if (!normalizedPath) {
      continue;
    }

    let state = states.get(normalizedPath);
    if (!state) {
      const existing = await input.session.read(normalizedPath);
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

export async function runGeneration(input: RunGenerationInput): Promise<RunGenerationOutput> {
  const projectRoot = input.store.getProjectWorkspacePath(input.project);
  const files = await collectFiles(projectRoot, 30, 12_000);
  const fileSession = await FileSession.create({
    projectId: input.project.id,
    projectRoot,
    options: {
      maxFilesPerStep: Number(process.env.AGENT_FS_MAX_FILES_PER_STEP || 15),
      maxTotalDiffBytes: Number(process.env.AGENT_FS_MAX_TOTAL_DIFF_BYTES || 400_000),
      maxFileBytes: Number(process.env.AGENT_FS_MAX_FILE_BYTES || 1_500_000),
      allowEnvMutation: process.env.AGENT_FS_ALLOW_ENV_MUTATION === "true"
    }
  });

  const provider = input.registry.get(input.providerId);
  const contextBlock = files.length
    ? files
        .map((file) => `File: ${file.path}\n\n${file.content.slice(0, 12_000)}`)
        .join("\n\n-----\n\n")
    : "Project is currently empty.";

  const systemPrompt = [
    "You are an expert senior software engineer that edits projects with precise file operations.",
    "Respect existing files and architecture; avoid destructive rewrites.",
    "When updating files, include full updated file content.",
    "If a delete is required, use action=delete and omit content.",
    "Do not output markdown, only JSON.",
    "Prioritize functional implementations over pseudocode.",
    "Project context:",
    contextBlock
  ].join("\n\n");

  const result = await provider.generate({
    model: input.model,
    systemPrompt,
    userPrompt: input.prompt,
    messages: input.project.messages.slice(-12)
  });

  const proposedChanges = await buildProposedChanges({
    session: fileSession,
    actions: result.files
  });

  let commitHash: string | null = null;
  let filesChanged: string[] = [];

  if (proposedChanges.length > 0) {
    const stepId = `${input.kind}-mutation`;
    fileSession.beginStep(stepId, 0);

    try {
      for (const change of proposedChanges) {
        await fileSession.stageChange(change);
      }

      fileSession.validateStep();
      await fileSession.applyStepChanges();
      commitHash = await fileSession.commitStep({
        agentRunId: `legacy-${input.project.id}-${input.kind}`,
        stepIndex: 0,
        stepId,
        summary: input.prompt
      });

      filesChanged = fileSession.getLastCommittedDiffs().map((entry) => entry.path);
    } catch (error) {
      await fileSession.abortStep().catch(() => undefined);
      throw error;
    }
  }

  const now = new Date().toISOString();
  input.project.messages.push({
    role: "user",
    content: input.prompt,
    createdAt: now
  });
  input.project.messages.push({
    role: "assistant",
    content: result.summary,
    createdAt: now
  });

  input.project.history.unshift({
    id: randomUUID(),
    kind: input.kind,
    prompt: input.prompt,
    summary: result.summary,
    provider: provider.descriptor.id,
    model: input.model || provider.descriptor.defaultModel,
    filesChanged,
    commands: result.runCommands,
    commitHash: commitHash || undefined,
    createdAt: now
  });

  input.project.updatedAt = now;
  input.project.history = input.project.history.slice(0, 80);
  input.project.messages = input.project.messages.slice(-80);

  await input.store.updateProject(input.project);

  return {
    summary: result.summary,
    filesChanged,
    commands: result.runCommands,
    commitHash
  };
}
