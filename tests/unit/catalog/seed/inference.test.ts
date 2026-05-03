/**
 * Unit tests for src/catalog/seed/inference.ts
 * Six pure functions: parseSlug, inferFamilySlug, inferDisplayName,
 * inferGeneration, inferReleasedAt, mergeMetadata
 */

import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  inferFamilySlug,
  parseSlug,
} from "../../../../src/catalog/seed/inference.ts";

// ---------------------------------------------------------------------------
// 1. parseSlug
// ---------------------------------------------------------------------------

describe("parseSlug", () => {
  it("splits a simple vendor/model slug", () => {
    assertEquals(parseSlug("anthropic/claude-haiku-4-5"), {
      provider: "anthropic",
      subVendor: null,
      model: "claude-haiku-4-5",
    });
  });

  it("splits an openrouter vendor/sub-vendor/model slug", () => {
    assertEquals(parseSlug("openrouter/x-ai/grok-4.3"), {
      provider: "openrouter",
      subVendor: "x-ai",
      model: "grok-4.3",
    });
  });

  it("keeps multi-segment model path for non-openrouter provider", () => {
    assertEquals(parseSlug("google/models/gemini-pro"), {
      provider: "google",
      subVendor: null,
      model: "models/gemini-pro",
    });
  });

  it("throws when no slash is present", () => {
    assertThrows(
      () => parseSlug("invalid"),
      Error,
      "invalid slug",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. inferFamilySlug
// ---------------------------------------------------------------------------

describe("inferFamilySlug", () => {
  it("returns 'claude' for anthropic/claude-haiku-4-5", () => {
    assertEquals(inferFamilySlug("anthropic", "claude-haiku-4-5"), "claude");
  });

  it("returns 'claude' for anthropic/claude-opus-4-7", () => {
    assertEquals(inferFamilySlug("anthropic", "claude-opus-4-7"), "claude");
  });

  it("returns 'gpt' for openai/gpt-5.4", () => {
    assertEquals(inferFamilySlug("openai", "gpt-5.4"), "gpt");
  });

  it("returns 'gpt' for openai/o1-mini", () => {
    assertEquals(inferFamilySlug("openai", "o1-mini"), "gpt");
  });

  it("returns 'gpt' for openai/o3-pro", () => {
    assertEquals(inferFamilySlug("openai", "o3-pro"), "gpt");
  });

  it("returns 'gemini' for google/gemini-2.5-pro", () => {
    assertEquals(inferFamilySlug("google", "gemini-2.5-pro"), "gemini");
  });

  it("returns 'gemini' for google/models/gemini-pro", () => {
    assertEquals(inferFamilySlug("google", "models/gemini-pro"), "gemini");
  });

  it("returns 'grok' for openrouter/grok-4.3 (sub-vendor x-ai)", () => {
    assertEquals(inferFamilySlug("openrouter", "grok-4.3", "x-ai"), "grok");
  });

  it("returns 'deepseek' for openrouter/deepseek-v4-pro (sub-vendor deepseek)", () => {
    assertEquals(
      inferFamilySlug("openrouter", "deepseek-v4-pro", "deepseek"),
      "deepseek",
    );
  });

  it("throws for unknown provider", () => {
    assertThrows(
      () => inferFamilySlug("acme", "ai-9000"),
      Error,
      "cannot infer family",
    );
  });
});
