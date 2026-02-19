import { randomUUID } from "node:crypto";
import { collectFiles, removeFile, safeResolvePath, writeTextFile } from "./fs-utils.js";
import { AppStore } from "./project-store.js";
import { ProviderRegistry } from "./providers.js";
import { Project } from "../types.js";

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
}

export async function runGeneration(input: RunGenerationInput): Promise<RunGenerationOutput> {
  const projectRoot = input.store.getProjectWorkspacePath(input.project);
  const files = await collectFiles(projectRoot, 30, 12_000);

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

  const filesChanged: string[] = [];

  for (const action of result.files) {
    const targetPath = safeResolvePath(projectRoot, action.path);

    if (action.action === "delete") {
      await removeFile(targetPath);
      filesChanged.push(action.path);
      continue;
    }

    if (typeof action.content !== "string") {
      continue;
    }

    await writeTextFile(targetPath, action.content);
    filesChanged.push(action.path);
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
    createdAt: now
  });

  input.project.updatedAt = now;
  input.project.history = input.project.history.slice(0, 80);
  input.project.messages = input.project.messages.slice(-80);

  await input.store.updateProject(input.project);

  return {
    summary: result.summary,
    filesChanged,
    commands: result.runCommands
  };
}
