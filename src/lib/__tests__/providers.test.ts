import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "../providers.js";

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("ProviderRegistry resolves deterministic default provider", async (t) => {
  await t.test("falls back to mock when no real providers are configured", () => {
    withEnv(
      {
        OPENAI_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
        DEEPRUN_DEFAULT_PROVIDER: undefined
      },
      () => {
        const registry = new ProviderRegistry();
        assert.equal(registry.getDefaultProviderId(), "mock");
        assert.equal(registry.list()[0]?.id, "mock");
        assert.equal(registry.resolveProviderId(undefined), "mock");
      }
    );
  });

  await t.test("prefers first configured real provider when no override is set", () => {
    withEnv(
      {
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: "gpt-test",
        OPENROUTER_API_KEY: undefined,
        DEEPRUN_DEFAULT_PROVIDER: undefined
      },
      () => {
        const registry = new ProviderRegistry();
        assert.equal(registry.getDefaultProviderId(), "openai");
        assert.equal(registry.list()[0]?.id, "openai");
        assert.equal(registry.resolveProviderId(undefined), "openai");
        assert.equal(registry.resolveProviderId("mock"), "mock");
      }
    );
  });

  await t.test("honors explicit default override when configured provider exists", () => {
    withEnv(
      {
        OPENAI_API_KEY: "test-openai-key",
        OPENROUTER_API_KEY: "test-openrouter-key",
        DEEPRUN_DEFAULT_PROVIDER: "openrouter"
      },
      () => {
        const registry = new ProviderRegistry();
        assert.equal(registry.getDefaultProviderId(), "openrouter");
        assert.equal(registry.list()[0]?.id, "openrouter");
      }
    );
  });

  await t.test("throws when explicit default override points to unknown provider", () => {
    withEnv(
      {
        OPENAI_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
        DEEPRUN_DEFAULT_PROVIDER: "openai"
      },
      () => {
        assert.throws(
          () => new ProviderRegistry(),
          /DEEPRUN_DEFAULT_PROVIDER is set to 'openai', but that provider is not configured\./
        );
      }
    );
  });
});
