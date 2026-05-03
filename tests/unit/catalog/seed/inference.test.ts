/**
 * Unit tests for src/catalog/seed/inference.ts
 * Six pure functions: parseSlug, inferFamilySlug, inferDisplayName,
 * inferGeneration, inferReleasedAt, mergeMetadata
 */

import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseSlug } from "../../../../src/catalog/seed/inference.ts";

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
