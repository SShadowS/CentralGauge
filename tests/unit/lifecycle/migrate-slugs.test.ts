import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  resolveTargetFilename,
  resolveTargetSlug,
  SLUG_MIGRATION_TABLE,
} from "../../../scripts/migrate-shortcomings-slugs.ts";

describe("migrate-shortcomings-slugs", () => {
  it("contains exactly 15 entries matching strategic plan B2", () => {
    assertEquals(SLUG_MIGRATION_TABLE.length, 15);
  });

  it("maps the 2 known JSONs (claude-opus-4-6, gpt-5.3-codex)", () => {
    assertEquals(
      resolveTargetSlug("claude-opus-4-6"),
      "anthropic/claude-opus-4-6",
    );
    assertEquals(resolveTargetSlug("gpt-5.3-codex"), "openai/gpt-5.3-codex");
  });

  it("collapses date suffix from claude-opus-4-5-20251101 to anthropic/claude-opus-4-5", () => {
    assertEquals(
      resolveTargetSlug("claude-opus-4-5-20251101"),
      "anthropic/claude-opus-4-5",
    );
    assertEquals(
      resolveTargetSlug("claude-sonnet-4-5-20250929"),
      "anthropic/claude-sonnet-4-5",
    );
    assertEquals(resolveTargetSlug("gpt-5.2-2025-12-11"), "openai/gpt-5.2");
  });

  it("maps gemini snapshots to google/", () => {
    assertEquals(
      resolveTargetSlug("gemini-3-pro-preview"),
      "google/gemini-3-pro-preview",
    );
    assertEquals(
      resolveTargetSlug("gemini-3.1-pro-preview"),
      "google/gemini-3.1-pro-preview",
    );
  });

  it("converts underscore-separated vendor slugs to openrouter/<vendor>/<model>", () => {
    assertEquals(
      resolveTargetSlug("deepseek_deepseek-v3.2"),
      "openrouter/deepseek/deepseek-v3.2",
    );
    assertEquals(
      resolveTargetSlug("minimax_minimax-m2.5"),
      "openrouter/minimax/minimax-m2.5",
    );
    assertEquals(
      resolveTargetSlug("moonshotai_kimi-k2.5"),
      "openrouter/moonshotai/kimi-k2.5",
    );
    assertEquals(
      resolveTargetSlug("qwen_qwen3-coder-next"),
      "openrouter/qwen/qwen3-coder-next",
    );
    assertEquals(
      resolveTargetSlug("qwen_qwen3-max-thinking"),
      "openrouter/qwen/qwen3-max-thinking",
    );
    assertEquals(
      resolveTargetSlug("x-ai_grok-code-fast-1"),
      "openrouter/x-ai/grok-code-fast-1",
    );
    assertEquals(resolveTargetSlug("z-ai_glm-5"), "openrouter/z-ai/glm-5");
  });

  it("resolveTargetFilename replaces `/` with `_` for fs-safe names", () => {
    assertEquals(
      resolveTargetFilename("anthropic/claude-opus-4-6"),
      "anthropic_claude-opus-4-6.json",
    );
    assertEquals(
      resolveTargetFilename("openrouter/deepseek/deepseek-v3.2"),
      "openrouter_deepseek_deepseek-v3.2.json",
    );
  });

  it("returns null for unknown legacy slugs", () => {
    assertEquals(resolveTargetSlug("unknown-model-slug"), null);
  });
});
