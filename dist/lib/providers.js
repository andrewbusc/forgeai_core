import { z } from "zod";
const generationResultSchema = z.object({
    summary: z.string().min(1),
    files: z.array(z.object({
        action: z.enum(["create", "update", "delete"]),
        path: z.string().min(1),
        content: z.string().optional(),
        reason: z.string().optional()
    })),
    runCommands: z.array(z.string()).default([])
});
class MockProvider {
    descriptor = {
        id: "mock",
        name: "Mock Provider",
        defaultModel: "mock-v1",
        configured: true
    };
    async generate(input) {
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
class OpenAICompatibleProvider {
    descriptor;
    apiKey;
    baseUrl;
    constructor(descriptor, apiKey, baseUrl) {
        this.descriptor = descriptor;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }
    async generate(input) {
        const messages = [
            { role: "system", content: input.systemPrompt },
            ...(input.messages ?? []).map((message) => ({
                role: message.role === "system" ? "assistant" : message.role,
                content: message.content
            })),
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
                        content: "Return only valid JSON matching this schema: { summary: string, files: Array<{ action: 'create'|'update'|'delete', path: string, content?: string, reason?: string }>, runCommands: string[] }."
                    }
                ]
            }),
            signal: AbortSignal.timeout(90_000)
        });
        if (!response.ok) {
            const details = await response.text();
            throw new Error(`Provider request failed (${response.status}): ${details}`);
        }
        const payload = (await response.json());
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Provider returned an empty completion.");
        }
        const parsed = generationResultSchema.parse(parseJsonPayload(content));
        return parsed;
    }
}
function parseJsonPayload(input) {
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
                return String(part.text);
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
    }
    catch {
        const firstBrace = raw.indexOf("{");
        const lastBrace = raw.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
        }
        throw new Error("Could not parse JSON from provider response.");
    }
}
export class ProviderRegistry {
    providers = new Map();
    constructor() {
        this.providers.set("mock", new MockProvider());
        const openAiKey = process.env.OPENAI_API_KEY;
        const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
        if (openAiKey) {
            this.providers.set("openai", new OpenAICompatibleProvider({
                id: "openai",
                name: "OpenAI",
                defaultModel: openAiModel,
                configured: true
            }, openAiKey, process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"));
        }
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const openRouterModel = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
        if (openRouterKey) {
            this.providers.set("openrouter", new OpenAICompatibleProvider({
                id: "openrouter",
                name: "OpenRouter",
                defaultModel: openRouterModel,
                configured: true
            }, openRouterKey, process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"));
        }
    }
    list() {
        return Array.from(this.providers.values()).map((provider) => provider.descriptor);
    }
    get(providerId) {
        const provider = this.providers.get(providerId);
        if (!provider) {
            throw new Error(`Unknown provider: ${providerId}`);
        }
        return provider;
    }
}
