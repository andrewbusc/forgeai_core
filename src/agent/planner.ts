import { collectFiles } from "../lib/fs-utils.js";
import {
  AgentPlan,
  AgentStep,
  PlannerMemoryContext,
  agentPlanSchema,
  agentStepSchema,
  PlannerInput,
  PlannerRuntimeCorrectionInput
} from "./types.js";

const planResponseSchemaLiteral = `{
  "goal": "string",
  "steps": [
    {
      "id": "step-1",
      "type": "analyze | modify | verify",
      "tool": "read_file | write_file | apply_patch | list_files | run_preview_container | fetch_runtime_logs",
      "input": {}
    }
  ]
}`;

const correctionResponseSchemaLiteral = `{
  "id": "runtime-correction-1",
  "type": "modify",
  "tool": "write_file | apply_patch",
  "input": {}
}`;

const correctionStepSchema = agentStepSchema.refine(
  (step) => step.type === "modify" && (step.tool === "write_file" || step.tool === "apply_patch"),
  "Correction step must be a modify step that uses write_file or apply_patch."
);

function getProviderConfig(providerId: string): { apiKey: string; baseUrl: string; defaultModel: string } {
  if (providerId === "openai") {
    const apiKey = process.env.OPENAI_API_KEY || "";
    const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    return { apiKey, baseUrl, defaultModel };
  }

  if (providerId === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY || "";
    const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    const defaultModel = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";

    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    return { apiKey, baseUrl, defaultModel };
  }

  throw new Error(`Unsupported planner provider: ${providerId}`);
}

function parseJsonPayload(input: unknown): unknown {
  if (typeof input === "object" && input && !Array.isArray(input)) {
    return input;
  }

  if (typeof input !== "string") {
    throw new Error("Planner returned unsupported response format.");
  }

  const trimmed = input.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = fenceMatch?.[1] ?? trimmed;

  return JSON.parse(raw);
}

function buildFallbackPlan(goal: string): AgentPlan {
  return {
    goal,
    steps: [
      {
        id: "step-1",
        type: "analyze",
        tool: "list_files",
        input: {
          path: ".",
          maxEntries: 120
        }
      },
      {
        id: "step-2",
        type: "analyze",
        tool: "read_file",
        input: {
          path: "README.md"
        }
      }
    ]
  };
}

function trimLogPayload(value: string, maxLength = 12_000): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(value.length - maxLength);
}

function buildMemoryContextBlock(memory?: PlannerMemoryContext): string {
  if (!memory) {
    return "No project memory available.";
  }

  try {
    return JSON.stringify(memory, null, 2);
  } catch {
    return "Project memory present but failed to serialize.";
  }
}

function buildFailureReportBlock(input: PlannerRuntimeCorrectionInput["failureReport"]): string {
  if (!input || !Array.isArray(input.failures) || input.failures.length === 0) {
    return "No structured failure report available.";
  }

  try {
    return JSON.stringify(
      {
        summary: input.summary,
        failures: input.failures.slice(0, 20)
      },
      null,
      2
    );
  } catch {
    return "Structured failure report present but could not be serialized.";
  }
}

export class AgentPlanner {
  private async requestPlannerJson(input: {
    providerId: string;
    model?: string;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<unknown> {
    const providerConfig = getProviderConfig(input.providerId);

    const response = await fetch(`${providerConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`
      },
      body: JSON.stringify({
        model: input.model || providerConfig.defaultModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: input.systemPrompt
          },
          {
            role: "user",
            content: input.userPrompt
          }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Planner request failed (${response.status}): ${details}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Planner returned an empty response.");
    }

    return parseJsonPayload(content);
  }

  async plan(input: PlannerInput): Promise<AgentPlan> {
    if (input.providerId === "mock") {
      return agentPlanSchema.parse(buildFallbackPlan(input.goal));
    }

    const projectFiles = await collectFiles(input.projectRoot, 18, 1_600);
    const contextBlock = projectFiles.length
      ? projectFiles.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n---\n\n")
      : "Project has no readable files yet.";

    const systemPrompt = [
      "You are deeprun Planner.",
      "Return STRICT JSON only. No markdown. No explanation.",
      "Output must match this exact schema:",
      planResponseSchemaLiteral,
      "Constraints:",
      "- Use only tools: read_file, write_file, apply_patch, list_files, run_preview_container, fetch_runtime_logs.",
      "- Keep 2 to 10 steps.",
      "- First step must be analyze and should usually be list_files or read_file.",
      "- Include at least one verify step for code-changing goals. Verify steps should use run_preview_container.",
      "- Use project memory (stack info, architecture summary, recent commits, recent agent runs) when relevant.",
      "- Input must be a plain JSON object for each step.",
      "- Use deterministic step ids: step-1, step-2, ...",
      "If you cannot produce a valid plan, return {}."
    ].join("\n");

    const memoryBlock = buildMemoryContextBlock(input.memory);
    const userPrompt = [
      `Goal: ${input.goal}`,
      `Project: ${input.project.name}`,
      "Project memory:",
      memoryBlock,
      "Project context:",
      contextBlock
    ].join("\n\n");

    const parsed = await this.requestPlannerJson({
      providerId: input.providerId,
      model: input.model,
      systemPrompt,
      userPrompt
    });

    return agentPlanSchema.parse(parsed);
  }

  async planRuntimeCorrection(input: PlannerRuntimeCorrectionInput): Promise<AgentStep> {
    if (input.providerId === "mock") {
      throw new Error("Runtime correction is unavailable with provider 'mock'.");
    }

    const projectFiles = await collectFiles(input.projectRoot, 20, 1_400);
    const contextBlock = projectFiles.length
      ? projectFiles.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n---\n\n")
      : "Project has no readable files yet.";

    const systemPrompt = [
      "You are deeprun Runtime Fix Planner.",
      "Return STRICT JSON only. No markdown. No explanation.",
      "Return exactly one step object matching this schema:",
      correctionResponseSchemaLiteral,
      "Hard constraints:",
      "- type must be modify.",
      "- tool must be write_file or apply_patch.",
      "- Perform the smallest code change likely to fix startup/runtime errors.",
      "- Prefer apply_patch when possible over write_file.",
      "- Use project memory context when choosing fixes.",
      "- Prefer structured failure diagnostics over raw logs when both are provided.",
      "- Do not emit analyze/verify tools.",
      "If you cannot produce a valid correction step, return {}."
    ].join("\n");

    const memoryBlock = buildMemoryContextBlock(input.memory);
    const failureReportBlock = buildFailureReportBlock(input.failureReport);
    const userPrompt = [
      `Goal: ${input.goal}`,
      `Project: ${input.project.name}`,
      `Correction attempt: ${input.attempt}`,
      `Failed verify step id: ${input.failedStepId}`,
      "Structured failure report:",
      failureReportBlock,
      "Recent runtime logs (tail):",
      trimLogPayload(input.runtimeLogs || ""),
      "Project memory:",
      memoryBlock,
      "Project context:",
      contextBlock
    ].join("\n\n");

    const parsed = await this.requestPlannerJson({
      providerId: input.providerId,
      model: input.model,
      systemPrompt,
      userPrompt
    });

    const maybeStep =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && "step" in parsed
        ? (parsed as { step?: unknown }).step
        : parsed;

    return correctionStepSchema.parse(maybeStep);
  }
}
