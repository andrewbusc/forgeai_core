import { z } from "zod";
import { BuilderMessage, GenerationResult, ProviderDescriptor } from "../types.js";

const generationResultSchema = z.object({
  summary: z.string().min(1),
  files: z.array(
    z.object({
      action: z.enum(["create", "update", "delete"]),
      path: z.string().min(1),
      content: z.string().optional(),
      reason: z.string().optional()
    })
  ),
  runCommands: z.array(z.string()).default([])
});

interface GenerateInput {
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  messages?: BuilderMessage[];
}

export interface AiProvider {
  descriptor: ProviderDescriptor;
  generate(input: GenerateInput): Promise<GenerationResult>;
}

class MockProvider implements AiProvider {
  descriptor: ProviderDescriptor = {
    id: "mock",
    name: "Mock Provider",
    defaultModel: "mock-v1",
    configured: true
  };

  async generate(input: GenerateInput): Promise<GenerationResult> {
    const slug = input.userPrompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);

    return {
      summary: "Mock response generated a planning note and TODO list. Configure a real provider for full generation.",
      files: [
        {
          action: "create",
          path: `notes/${slug || "new-feature"}.md`,
          content: `# Builder Request\n\n${input.userPrompt}\n\n## Suggested next steps\n- Break feature into components\n- Add tests for generated behavior\n- Run project formatter and lint\n`
        }
      ],
      runCommands: ["npm install", "npm run dev"]
    };
  }
}

class OpenAICompatibleProvider implements AiProvider {
  descriptor: ProviderDescriptor;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(descriptor: ProviderDescriptor, apiKey: string, baseUrl: string) {
    this.descriptor = descriptor;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async generate(input: GenerateInput): Promise<GenerationResult> {
    const messages = [
      { role: "system", content: input.systemPrompt },
      ...((input.messages ?? []).map((message) => ({
        role: message.role === "system" ? "assistant" : message.role,
        content: message.content
      })) as Array<{ role: "assistant" | "user"; content: string }>),
      { role: "user", content: input.userPrompt }
    ];

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: input.model || this.descriptor.defaultModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          ...messages,
          {
            role: "system",
            content:
              "Return only valid JSON matching this schema: { summary: string, files: Array<{ action: 'create'|'update'|'delete', path: string, content?: string, reason?: string }>, runCommands: string[] }."
          }
        ]
      }),
      signal: AbortSignal.timeout(90_000)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Provider request failed (${response.status}): ${details}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Provider returned an empty completion.");
    }

    const parsed = generationResultSchema.parse(parseJsonPayload(content));
    return parsed;
  }
}

function parseJsonPayload(input: unknown): unknown {
  if (typeof input === "object" && input && !Array.isArray(input)) {
    return input;
  }

  if (Array.isArray(input)) {
    const joined = input
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("\n");
    return parseJsonPayload(joined);
  }

  if (typeof input !== "string") {
    throw new Error("Provider returned unsupported content format.");
  }

  const trimmed = input.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = fenceMatch?.[1] ?? trimmed;

  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Could not parse JSON from provider response.");
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();
  private readonly defaultProviderId: string;

  constructor() {
    this.providers.set("mock", new MockProvider());

    const openAiKey = process.env.OPENAI_API_KEY;
    const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    if (openAiKey) {
      this.providers.set(
        "openai",
        new OpenAICompatibleProvider(
          {
            id: "openai",
            name: "OpenAI",
            defaultModel: openAiModel,
            configured: true
          },
          openAiKey,
          process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
        )
      );
    }

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const openRouterModel = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
    if (openRouterKey) {
      this.providers.set(
        "openrouter",
        new OpenAICompatibleProvider(
          {
            id: "openrouter",
            name: "OpenRouter",
            defaultModel: openRouterModel,
            configured: true
          },
          openRouterKey,
          process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
        )
      );
    }

    this.defaultProviderId = this.resolveDefaultProviderId();
  }

  private resolveDefaultProviderId(): string {
    const configuredDefault = String(process.env.DEEPRUN_DEFAULT_PROVIDER || "").trim();
    if (configuredDefault) {
      if (!this.providers.has(configuredDefault)) {
        throw new Error(
          `DEEPRUN_DEFAULT_PROVIDER is set to '${configuredDefault}', but that provider is not configured.`
        );
      }
      return configuredDefault;
    }

    const firstConfiguredRealProvider = Array.from(this.providers.values())
      .map((provider) => provider.descriptor)
      .find((descriptor) => descriptor.id !== "mock" && descriptor.configured);

    return firstConfiguredRealProvider?.id || "mock";
  }

  list(): ProviderDescriptor[] {
    return Array.from(this.providers.values())
      .sort((left, right) => {
        const leftDefault = left.descriptor.id === this.defaultProviderId ? 0 : 1;
        const rightDefault = right.descriptor.id === this.defaultProviderId ? 0 : 1;
        if (leftDefault !== rightDefault) {
          return leftDefault - rightDefault;
        }
        return left.descriptor.id.localeCompare(right.descriptor.id);
      })
      .map((provider) => provider.descriptor);
  }

  getDefaultProviderId(): string {
    return this.defaultProviderId;
  }

  resolveProviderId(providerId: string | undefined | null): string {
    const resolved = typeof providerId === "string" && providerId.trim().length > 0 ? providerId.trim() : this.defaultProviderId;
    if (!this.providers.has(resolved)) {
      throw new Error(`Unknown provider: ${resolved}`);
    }
    return resolved;
  }

  get(providerId: string): AiProvider {
    const provider = this.providers.get(this.resolveProviderId(providerId));
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return provider;
  }
}
