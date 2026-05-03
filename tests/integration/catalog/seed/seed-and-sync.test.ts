/**
 * Integration test: seed-and-sync
 * End-to-end: seed 2 slugs (1 openrouter + 1 direct anthropic) using mocked deps.
 * Asserts both source paths produce correct rows in YAML.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";
import {
  type SeedDeps,
  seedMissingSlugs,
} from "../../../../src/catalog/seed/mod.ts";

describe("integration: seed-and-sync", () => {
  it("end-to-end: seeds 1 openrouter + 1 anthropic from mocked sources", async () => {
    const dir = await createTempDir("seed-int");
    await Deno.writeTextFile(`${dir}/models.yml`, "");
    await Deno.writeTextFile(`${dir}/model-families.yml`, "");
    await Deno.writeTextFile(`${dir}/pricing.yml`, "");

    const mockDeps: SeedDeps = {
      fetchOpenRouter: (orSlug: string) => {
        if (orSlug === "x-ai/grok-4.3") {
          return Promise.resolve({
            pricing: { input: 1.25, output: 2.5 },
            displayName: "xAI: Grok 4.3",
            vendor: "xAI",
            releasedAt: "2025-11-01",
          });
        }
        return Promise.resolve(null);
      },
      fetchLiteLLM: (provider: string, model: string) => {
        if (provider === "anthropic" && model === "claude-haiku-4-5") {
          return { input: 1.0, output: 5.0 };
        }
        return null;
      },
    };

    try {
      const result = await seedMissingSlugs(
        {
          slugs: [
            "openrouter/x-ai/grok-4.3",
            "anthropic/claude-haiku-4-5",
          ],
          catalogDir: dir,
        },
        mockDeps,
      );

      assertEquals(result.modelsAdded, 2, "Should add 2 models");
      assertEquals(result.familiesAdded, 2, "Should add 2 families");
      assertEquals(result.pricingAdded, 2, "Should add 2 pricing rows");
      assertEquals(result.errors.length, 0, "Should have no errors");

      const families = await Deno.readTextFile(
        `${dir}/model-families.yml`,
      );
      assertEquals(
        families.includes("grok") || families.includes("x-ai"),
        true,
        "model-families.yml should contain grok/xai reference",
      );
      assertEquals(
        families.includes("claude") || families.includes("haiku"),
        true,
        "model-families.yml should contain claude/haiku reference",
      );

      const pricing = await Deno.readTextFile(`${dir}/pricing.yml`);
      assertEquals(
        pricing.includes("openrouter"),
        true,
        "pricing.yml should contain openrouter source",
      );
      assertEquals(
        pricing.includes("litellm") || pricing.includes("anthropic"),
        true,
        "pricing.yml should contain anthropic/litellm reference",
      );

      const models = await Deno.readTextFile(`${dir}/models.yml`);
      assertEquals(
        models.includes("grok-4.3") || models.includes("x-ai"),
        true,
        "models.yml should contain grok-4.3 model",
      );
      assertEquals(
        models.includes("claude-haiku-4-5") ||
          models.includes("haiku"),
        true,
        "models.yml should contain claude-haiku-4-5 model",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
