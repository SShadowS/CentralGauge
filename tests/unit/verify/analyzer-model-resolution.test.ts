/**
 * T14/V11 — the analyzer's default model must resolve via the
 * `lifecycle.analyzer_model` config chain, not a hardcoded literal, and the
 * concept-registry default URL must be the canonical site, not workers.dev.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  DEFAULT_ANALYZER_CONFIG,
  splitVendorSlug,
} from "../../../src/verify/analyzer.ts";
import {
  ConfigManager,
  resolveAnalyzerModelDefault,
} from "../../../src/config/config.ts";

describe("DEFAULT_ANALYZER_CONFIG (T14/V11)", () => {
  it("no longer hardcodes a stale model literal", () => {
    assertEquals(DEFAULT_ANALYZER_CONFIG.model, undefined);
  });

  it("registryBaseUrl defaults to the canonical site, not workers.dev", () => {
    assertEquals(
      DEFAULT_ANALYZER_CONFIG.registryBaseUrl,
      "https://ai.sshadows.dk",
    );
  });
});

describe("splitVendorSlug", () => {
  it("splits a vendor-prefixed slug on the first slash", () => {
    assertEquals(splitVendorSlug("anthropic/claude-opus-4-6"), {
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
  });

  it("keeps subsequent slashes as part of the model id (openrouter-style)", () => {
    assertEquals(splitVendorSlug("openrouter/x-ai/grok-4.3"), {
      provider: "openrouter",
      model: "x-ai/grok-4.3",
    });
  });

  it("falls back to fallbackProvider when the slug has no slash", () => {
    assertEquals(splitVendorSlug("bare-model-id", "openai"), {
      provider: "openai",
      model: "bare-model-id",
    });
  });

  it("defaults fallbackProvider to anthropic when not specified", () => {
    assertEquals(splitVendorSlug("bare-model-id"), {
      provider: "anthropic",
      model: "bare-model-id",
    });
  });
});

describe("resolveAnalyzerModelDefault (T14/V11 config chain)", () => {
  beforeEach(() => {
    ConfigManager.reset();
  });

  afterEach(() => {
    ConfigManager.reset();
  });

  it("reads lifecycle.analyzer_model from ConfigManager when set", async () => {
    ConfigManager.setConfig({
      lifecycle: { analyzer_model: "openrouter/deepseek/deepseek-v4-pro" },
    });
    const result = await resolveAnalyzerModelDefault();
    assertEquals(result, "openrouter/deepseek/deepseek-v4-pro");
  });

  it("falls back to the built-in default (anthropic/claude-opus-4-6) when unset", async () => {
    ConfigManager.setConfig({});
    const result = await resolveAnalyzerModelDefault();
    assertEquals(result, "anthropic/claude-opus-4-6");
  });

  it("never resolves to the old stale literal claude-sonnet-4-5-20250929", async () => {
    ConfigManager.setConfig({});
    const result = await resolveAnalyzerModelDefault();
    assertEquals(result.includes("claude-sonnet-4-5-20250929"), false);
  });
});
