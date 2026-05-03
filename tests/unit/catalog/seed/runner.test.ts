import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";
import {
  type SeedDeps,
  seedMissingSlugs,
} from "../../../../src/catalog/seed/runner.ts";

async function makeCatalogDir(prefix: string): Promise<string> {
  const dir = await createTempDir(prefix);
  await Deno.writeTextFile(`${dir}/models.yml`, "");
  await Deno.writeTextFile(`${dir}/model-families.yml`, "");
  await Deno.writeTextFile(`${dir}/pricing.yml`, "");
  return dir;
}

describe("seedMissingSlugs", () => {
  it("seeds a single openrouter slug end-to-end", async () => {
    const dir = await makeCatalogDir("seed-runner-or");

    const deps: SeedDeps = {
      fetchOpenRouter: (orSlug) =>
        Promise.resolve(
          orSlug === "x-ai/grok-4.3"
            ? {
              pricing: { input: 1.25, output: 2.5 },
              displayName: "xAI: Grok 4.3",
              vendor: "xAI",
              releasedAt: "2025-11-01",
            }
            : null,
        ),
      fetchLiteLLM: () => null,
    };

    try {
      const result = await seedMissingSlugs(
        { slugs: ["openrouter/x-ai/grok-4.3"], catalogDir: dir },
        deps,
      );
      assertEquals(result.familiesAdded, 1);
      assertEquals(result.modelsAdded, 1);
      assertEquals(result.pricingAdded, 1);
      assertEquals(result.errors.length, 0);

      const families = await Deno.readTextFile(`${dir}/model-families.yml`);
      assertEquals(families.includes("slug: grok"), true);

      const models = await Deno.readTextFile(`${dir}/models.yml`);
      assertEquals(models.includes("openrouter/x-ai/grok-4.3"), true);

      const pricing = await Deno.readTextFile(`${dir}/pricing.yml`);
      assertEquals(pricing.includes("input_per_mtoken: 1.25"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("seeds a direct anthropic slug using LiteLLM pricing", async () => {
    const dir = await makeCatalogDir("seed-runner-anth");

    let liteCalls = 0;
    let orCalls = 0;
    const deps: SeedDeps = {
      fetchOpenRouter: () => {
        orCalls++;
        return Promise.resolve({
          pricing: { input: 99, output: 99 }, // wrong on purpose
          displayName: "Anthropic: Claude Haiku 4.5",
          vendor: "Anthropic",
          releasedAt: "2026-01-15",
        });
      },
      fetchLiteLLM: (p, m) => {
        liteCalls++;
        assertEquals(p, "anthropic");
        assertEquals(m, "claude-haiku-4-5");
        return { input: 1.0, output: 5.0 };
      },
    };

    try {
      const result = await seedMissingSlugs(
        { slugs: ["anthropic/claude-haiku-4-5"], catalogDir: dir },
        deps,
      );
      assertEquals(result.modelsAdded, 1);
      assertEquals(liteCalls, 1);
      assertEquals(orCalls, 1);

      const pricing = await Deno.readTextFile(`${dir}/pricing.yml`);
      assertEquals(pricing.includes("source: litellm"), true);
      // LiteLLM value 1.0 wins, not OR's 99
      assertEquals(pricing.includes("input_per_mtoken: 1"), true);
      assertEquals(pricing.includes("input_per_mtoken: 99"), false);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("collects SEED_INVALID_SLUG errors per slug without aborting others", async () => {
    const dir = await makeCatalogDir("seed-runner-invalid");

    const deps: SeedDeps = {
      fetchOpenRouter: (orSlug) =>
        Promise.resolve(
          orSlug === "x-ai/grok-4.3"
            ? {
              pricing: { input: 1.25, output: 2.5 },
              displayName: "xAI: Grok 4.3",
              vendor: "xAI",
              releasedAt: null,
            }
            : {
              // Provide pricing so the family-inference step is reached
              pricing: { input: 1.0, output: 2.0 },
              displayName: "Unknown",
              vendor: "Unknown",
              releasedAt: null,
            },
        ),
      fetchLiteLLM: () => null,
    };

    try {
      const result = await seedMissingSlugs(
        {
          slugs: [
            "openrouter/x-ai/grok-4.3", // valid, should succeed
            "no-slash-here", // SEED_INVALID_SLUG (no /)
            "acme/unknown-9000", // SEED_INVALID_SLUG (unknown family)
          ],
          catalogDir: dir,
        },
        deps,
      );
      assertEquals(result.modelsAdded, 1);
      assertEquals(result.errors.length, 2);
      assertEquals(result.errors[0]?.error.code, "SEED_INVALID_SLUG");
      assertEquals(result.errors[1]?.error.code, "SEED_INVALID_SLUG");
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("collects SEED_NO_PRICING errors per slug without aborting others", async () => {
    const dir = await makeCatalogDir("seed-runner-errs");

    const deps: SeedDeps = {
      fetchOpenRouter: (orSlug) =>
        Promise.resolve(
          orSlug === "x-ai/grok-4.3"
            ? {
              pricing: { input: 1.25, output: 2.5 },
              displayName: "xAI: Grok 4.3",
              vendor: "xAI",
              releasedAt: null,
            }
            : null,
        ),
      fetchLiteLLM: () => null,
    };

    try {
      const result = await seedMissingSlugs(
        {
          slugs: [
            "openrouter/x-ai/grok-4.3",
            "openrouter/acme/unknown-1",
          ],
          catalogDir: dir,
        },
        deps,
      );
      assertEquals(result.modelsAdded, 1);
      assertEquals(result.errors.length, 1);
      assertEquals(result.errors[0]?.slug, "openrouter/acme/unknown-1");
      assertEquals(result.errors[0]?.error.code, "SEED_NO_PRICING");
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
