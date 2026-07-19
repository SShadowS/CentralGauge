/**
 * T14/V11 — generator.ts must resolve its default summarization model via
 * the `lifecycle.analyzer_model` config chain, not a hardcoded literal.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { resolveGeneratorModel } from "../../../src/rules/generator.ts";
import { ConfigManager } from "../../../src/config/config.ts";

describe("resolveGeneratorModel (T14/V11)", () => {
  beforeEach(() => {
    ConfigManager.reset();
  });

  afterEach(() => {
    ConfigManager.reset();
  });

  it("uses caller-supplied provider/model verbatim, no config lookup", async () => {
    ConfigManager.setConfig({
      lifecycle: { analyzer_model: "mock/should-not-be-used" },
    });
    const result = await resolveGeneratorModel({
      llmProvider: "openai",
      llmModel: "gpt-5.5",
    });
    assertEquals(result, { provider: "openai", model: "gpt-5.5" });
  });

  it("falls back to lifecycle.analyzer_model when both are omitted", async () => {
    ConfigManager.setConfig({
      lifecycle: { analyzer_model: "anthropic/claude-rules-test" },
    });
    const result = await resolveGeneratorModel({});
    assertEquals(result, {
      provider: "anthropic",
      model: "claude-rules-test",
    });
  });

  it("splits a vendor-prefixed analyzer_model on the first slash only", async () => {
    ConfigManager.setConfig({
      lifecycle: { analyzer_model: "openrouter/x-ai/grok-4.3" },
    });
    const result = await resolveGeneratorModel({});
    assertEquals(result.provider, "openrouter");
    assertEquals(result.model, "x-ai/grok-4.3");
  });

  it("falls back to the built-in lifecycle default when no config is set", async () => {
    ConfigManager.setConfig({});
    const result = await resolveGeneratorModel({});
    // Built-in default is anthropic/claude-opus-4-6 (LIFECYCLE_DEFAULTS).
    assertEquals(result.provider, "anthropic");
    assertEquals(result.model, "claude-opus-4-6");
  });

  it("never resolves to the old stale hardcoded model id", async () => {
    ConfigManager.setConfig({});
    const result = await resolveGeneratorModel({});
    assertEquals(result.model === "claude-sonnet-4-5-20250929", false);
  });

  // CLI follow-up (T14/V11 review): rules-command.ts's --llm flag supplies a
  // BARE model id (e.g. "gpt-5-codex"), never vendor-prefixed. When only the
  // model is explicit, the provider must default to "anthropic" (this CLI's
  // historical convention) rather than being pulled from the config chain's
  // *default* provider, which may not match the explicit model at all.
  it("explicit llmModel without llmProvider defaults provider to anthropic, ignoring an unrelated config-chain provider", async () => {
    ConfigManager.setConfig({
      lifecycle: { analyzer_model: "openrouter/x-ai/grok-4.3" },
    });
    const result = await resolveGeneratorModel({ llmModel: "gpt-5-codex" });
    assertEquals(result, { provider: "anthropic", model: "gpt-5-codex" });
  });

  it("explicit llmModel AND llmProvider are both honored verbatim over config", async () => {
    ConfigManager.setConfig({
      lifecycle: { analyzer_model: "openrouter/x-ai/grok-4.3" },
    });
    const result = await resolveGeneratorModel({
      llmProvider: "openai",
      llmModel: "gpt-5-codex",
    });
    assertEquals(result, { provider: "openai", model: "gpt-5-codex" });
  });

  it("llmProvider alone (no llmModel) still resolves the model from config chain, provider explicit wins", async () => {
    ConfigManager.setConfig({
      lifecycle: { analyzer_model: "openrouter/x-ai/grok-4.3" },
    });
    const result = await resolveGeneratorModel({ llmProvider: "openai" });
    assertEquals(result.provider, "openai");
    assertEquals(result.model, "x-ai/grok-4.3");
  });
});
