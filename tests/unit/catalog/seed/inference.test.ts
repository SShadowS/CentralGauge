/**
 * Unit tests for src/catalog/seed/inference.ts
 * Six pure functions: parseSlug, inferFamilySlug, inferDisplayName,
 * inferGeneration, inferReleasedAt, mergeMetadata
 */

import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  inferDisplayName,
  inferFamilySlug,
  inferGeneration,
  inferReleasedAt,
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

// ---------------------------------------------------------------------------
// 3. inferDisplayName
// ---------------------------------------------------------------------------

describe("inferDisplayName", () => {
  it("returns the openrouter name when provided", () => {
    assertEquals(
      inferDisplayName("openrouter/x-ai/grok-4.3", "xAI: Grok 4.3"),
      "xAI: Grok 4.3",
    );
  });

  it("title-cases hyphen-split tail when openrouter name is null", () => {
    // "claude-haiku-4-5" → ["claude","haiku","4","5"] → "Claude Haiku 4 5"
    assertEquals(
      inferDisplayName("anthropic/claude-haiku-4-5", null),
      "Claude Haiku 4 5",
    );
  });

  it("title-cases single-segment tail (no hyphens) when name is null", () => {
    // "gpt-5.4" → ["gpt","5.4"] → "Gpt 5.4"
    assertEquals(inferDisplayName("openai/gpt-5.4", null), "Gpt 5.4");
  });

  it("title-cases multi-hyphen tail when name is null", () => {
    // "grok-code-fast-1" → ["Grok","Code","Fast","1"] → "Grok Code Fast 1"
    assertEquals(
      inferDisplayName("openrouter/x-ai/grok-code-fast-1", null),
      "Grok Code Fast 1",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. inferGeneration
// ---------------------------------------------------------------------------

describe("inferGeneration", () => {
  it("extracts 4 from claude-haiku-4-5 (first digit group after letters)", () => {
    // regex: [a-z]+-?(\d+) — matches 'haiku-' then '4'
    assertEquals(inferGeneration("claude-haiku-4-5"), 4);
  });

  it("extracts 5 from gpt-5.4", () => {
    assertEquals(inferGeneration("gpt-5.4"), 5);
  });

  it("extracts 2 from gemini-2.5-pro", () => {
    assertEquals(inferGeneration("gemini-2.5-pro"), 2);
  });

  it("extracts 4 from grok-4.3", () => {
    assertEquals(inferGeneration("grok-4.3"), 4);
  });

  it("returns null for model with no digits", () => {
    assertEquals(inferGeneration("claude-haiku"), null);
  });

  it("extracts 1 from o1-mini", () => {
    assertEquals(inferGeneration("o1-mini"), 1);
  });
});

// ---------------------------------------------------------------------------
// 5. inferReleasedAt
// ---------------------------------------------------------------------------

describe("inferReleasedAt", () => {
  it("converts a valid epoch to ISO date string", () => {
    assertEquals(inferReleasedAt(1761955200), "2025-11-01");
  });

  it("returns null for null input", () => {
    assertEquals(inferReleasedAt(null), null);
  });

  it("returns null for NaN", () => {
    assertEquals(inferReleasedAt(NaN), null);
  });

  it("returns null for Infinity", () => {
    assertEquals(inferReleasedAt(Infinity), null);
  });
});
