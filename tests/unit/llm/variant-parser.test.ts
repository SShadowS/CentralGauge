/**
 * Unit tests for variant-parser
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists, assertThrows } from "@std/assert";
import {
  getVariantDisplayName,
  parseVariantSpec,
  resolveWithVariants,
} from "../../../src/llm/variant-parser.ts";
import type { CentralGaugeConfig } from "../../../src/config/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";

describe("parseVariantSpec", () => {
  describe("Basic model resolution", () => {
    it("should parse simple model spec without variant", () => {
      const variants = parseVariantSpec("sonnet");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.baseModel, "sonnet");
      assertEquals(variant.hasVariant, false);
    });

    it("should parse provider/model format", () => {
      const variants = parseVariantSpec("anthropic/claude-sonnet-4-20250514");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.provider, "anthropic");
      assertEquals(variant.model, "claude-sonnet-4-20250514");
    });

    it("should resolve preset aliases", () => {
      const variants = parseVariantSpec("gpt-4o");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.provider, "openai");
    });
  });

  describe("Variant configuration", () => {
    it("should parse temperature variant", () => {
      const variants = parseVariantSpec("sonnet@temp=0.5");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.hasVariant, true);
      assertEquals(variant.config.temperature, 0.5);
    });

    it("should parse multiple variant parameters", () => {
      const variants = parseVariantSpec("sonnet@temp=0.7;tokens=8000");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.temperature, 0.7);
      assertEquals(variant.config.maxTokens, 8000);
    });

    it("should parse thinking budget parameter", () => {
      const variants = parseVariantSpec("sonnet@thinking=10000");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.thinkingBudget, 10000);
    });

    it("should parse timeout parameter", () => {
      const variants = parseVariantSpec("sonnet@timeout=60000");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.timeout, 60000);
    });

    it("should parse system prompt name", () => {
      const config = {
        systemPrompts: {
          coding: { content: "You are a coding assistant." },
        },
      };

      const variants = parseVariantSpec(
        "sonnet@prompt=coding",
        config as CentralGaugeConfig,
      );

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.systemPromptName, "coding");
    });

    it("should throw ConfigurationError for unknown system prompt name", () => {
      const config = {
        systemPrompts: {
          coding: { content: "You are a coding assistant." },
          terse: { content: "Be terse." },
        },
      };

      const error = assertThrows(
        () =>
          parseVariantSpec(
            "sonnet@prompt=nonexistent",
            config as CentralGaugeConfig,
          ),
        ConfigurationError,
        'Unknown system prompt "nonexistent"',
      );
      // Error must name the available prompts so the miss is actionable
      assert(error.message.includes("coding"));
      assert(error.message.includes("terse"));
    });

    it("should throw ConfigurationError for @prompt with no prompts configured", () => {
      assertThrows(
        () => parseVariantSpec("sonnet@prompt=coding"),
        ConfigurationError,
        "(none)",
      );
    });

    it("should not throw on unknown variant keys (forward-compat)", () => {
      const variants = parseVariantSpec("sonnet@bogus=1;temp=0.5");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.temperature, 0.5);
    });

    it("should handle alias for temperature (temp)", () => {
      const variants = parseVariantSpec("sonnet@temp=0.3");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.temperature, 0.3);
    });
  });

  describe("Profile resolution", () => {
    it("should resolve profile from config", () => {
      const config: Partial<CentralGaugeConfig> = {
        variantProfiles: {
          "conservative": {
            description: "Conservative settings",
            config: {
              temperature: 0.1,
              maxTokens: 2000,
            },
          },
        },
      };

      const variants = parseVariantSpec(
        "sonnet@profile=conservative",
        config as CentralGaugeConfig,
      );

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.temperature, 0.1);
      assertEquals(variant.config.maxTokens, 2000);
    });

    it("should resolve system prompt content from config", () => {
      const config: Partial<CentralGaugeConfig> = {
        systemPrompts: {
          "coding": {
            description: "Coding assistant",
            content: "You are a coding assistant.",
          },
        },
      };

      const variants = parseVariantSpec(
        "sonnet@prompt=coding",
        config as CentralGaugeConfig,
      );

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.systemPromptName, "coding");
      assertEquals(variant.config.systemPrompt, "You are a coding assistant.");
    });

    it("should throw ConfigurationError when profile references unknown system prompt", () => {
      const config: Partial<CentralGaugeConfig> = {
        variantProfiles: {
          "prompted": {
            description: "Profile with a stale prompt reference",
            config: {
              systemPromptName: "nonexistent",
            },
          },
        },
        systemPrompts: {
          "coding": {
            description: "Coding assistant",
            content: "You are a coding assistant.",
          },
        },
      };

      const error = assertThrows(
        () =>
          parseVariantSpec(
            "sonnet@profile=prompted",
            config as CentralGaugeConfig,
          ),
        ConfigurationError,
        'Unknown system prompt "nonexistent"',
      );
      assert(error.message.includes("coding"));
    });
  });

  describe("Variant ID generation", () => {
    it("should generate unique variantId for same model with different configs", () => {
      const variants1 = parseVariantSpec("sonnet@temp=0.1");
      const variants2 = parseVariantSpec("sonnet@temp=0.9");

      const variant1 = variants1[0];
      const variant2 = variants2[0];
      assertExists(variant1);
      assertExists(variant2);
      assert(variant1.variantId !== variant2.variantId);
    });

    it("should generate same variantId for identical specs", () => {
      const variants1 = parseVariantSpec("sonnet@temp=0.5");
      const variants2 = parseVariantSpec("sonnet@temp=0.5");

      const variant1 = variants1[0];
      const variant2 = variants2[0];
      assertExists(variant1);
      assertExists(variant2);
      assertEquals(variant1.variantId, variant2.variantId);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty variant spec after @", () => {
      const variants = parseVariantSpec("sonnet@");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.hasVariant, false);
      // maxTokens comes from LiteLLM cache (may be undefined when cache is cold)
    });

    it("should handle unknown parameter keys", () => {
      const variants = parseVariantSpec("sonnet@unknown=value");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      // Unknown params should be ignored, hasVariant false since no valid params
      assertEquals(variant.hasVariant, false);
      // maxTokens comes from LiteLLM cache (may be undefined when cache is cold)
    });

    it("should handle whitespace in parameters", () => {
      const variants = parseVariantSpec("sonnet@ temp = 0.5 ; tokens = 1000 ");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      assertEquals(variant.config.temperature, 0.5);
      assertEquals(variant.config.maxTokens, 1000);
    });

    it("should handle missing value in parameter", () => {
      const variants = parseVariantSpec("sonnet@temp");

      assertEquals(variants.length, 1);
      const variant = variants[0];
      assertExists(variant);
      // No equals sign, should be ignored
      assertEquals(variant.config.temperature, undefined);
    });
  });
});

describe("resolveWithVariants", () => {
  it("should resolve multiple specs", () => {
    const variants = resolveWithVariants(["sonnet", "gpt-4o"]);

    assertEquals(variants.length, 2);
  });

  it("should resolve specs with different variants", () => {
    const variants = resolveWithVariants([
      "sonnet@temp=0.1",
      "sonnet@temp=0.9",
      "gpt-4o",
    ]);

    assertEquals(variants.length, 3);
    // All should be unique
    const variantIds = variants.map((v) => v.variantId);
    const uniqueIds = new Set(variantIds);
    assertEquals(uniqueIds.size, 3);
  });

  it("should handle empty array", () => {
    const variants = resolveWithVariants([]);

    assertEquals(variants.length, 0);
  });

  it("should expand model groups", () => {
    // Assuming "all-claude" or similar groups exist
    const variants = resolveWithVariants(["sonnet", "haiku"]);

    assert(variants.length >= 2);
  });
});

describe("getVariantDisplayName", () => {
  it("should return simple name for non-variant", () => {
    const variants = parseVariantSpec("sonnet");
    const variant = variants[0];
    assertExists(variant);

    const displayName = getVariantDisplayName(variant);

    // Should use the preset alias or short name
    assert(displayName.length < 50);
    assert(!displayName.includes("@"));
  });

  it("should include variant suffix for variant", () => {
    const variants = parseVariantSpec("sonnet@temp=0.5");
    const variant = variants[0];
    assertExists(variant);

    const displayName = getVariantDisplayName(variant);

    assert(displayName.includes("@"));
    assert(displayName.includes("temp=0.5"));
  });

  it("should include multiple parameters in suffix", () => {
    const variants = parseVariantSpec("sonnet@temp=0.5;tokens=8000");
    const variant = variants[0];
    assertExists(variant);

    const displayName = getVariantDisplayName(variant);

    assert(displayName.includes("temp=0.5"));
    assert(displayName.includes("tokens=8000"));
  });

  it("should include thinking budget in suffix", () => {
    const variants = parseVariantSpec("sonnet@thinking=5000");
    const variant = variants[0];
    assertExists(variant);

    const displayName = getVariantDisplayName(variant);

    assert(displayName.includes("thinking=5000"));
  });

  it("should include prompt name in suffix", () => {
    const config = {
      systemPrompts: {
        coding: { content: "You are a coding assistant." },
      },
    };

    const variants = parseVariantSpec(
      "sonnet@prompt=coding",
      config as CentralGaugeConfig,
    );
    const variant = variants[0];
    assertExists(variant);

    const displayName = getVariantDisplayName(variant);

    assert(displayName.includes("prompt=coding"));
  });
});
