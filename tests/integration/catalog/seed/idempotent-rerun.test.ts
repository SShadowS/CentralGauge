/**
 * Integration test: idempotent-rerun
 * Run seed twice with identical inputs. Second run produces zero new rows.
 * YAML files byte-identical between runs.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";
import {
  type SeedDeps,
  seedMissingSlugs,
} from "../../../../src/catalog/seed/mod.ts";

const stableDeps: SeedDeps = {
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
  fetchLiteLLM: () => null,
};

describe("integration: idempotent-rerun", () => {
  it("running seed twice with identical inputs produces zero second-run changes", async () => {
    const dir = await createTempDir("seed-idempot");
    await Deno.writeTextFile(`${dir}/models.yml`, "");
    await Deno.writeTextFile(`${dir}/model-families.yml`, "");
    await Deno.writeTextFile(`${dir}/pricing.yml`, "");

    try {
      // First run
      const first = await seedMissingSlugs(
        { slugs: ["openrouter/x-ai/grok-4.3"], catalogDir: dir },
        stableDeps,
      );
      assertEquals(first.modelsAdded, 1, "First run should add 1 model");
      assertEquals(
        first.familiesAdded,
        1,
        "First run should add 1 family",
      );
      assertEquals(
        first.pricingAdded,
        1,
        "First run should add 1 pricing row",
      );
      assertEquals(
        first.errors.length,
        0,
        "First run should have no errors",
      );

      const familiesAfter1 = await Deno.readTextFile(
        `${dir}/model-families.yml`,
      );
      const modelsAfter1 = await Deno.readTextFile(`${dir}/models.yml`);
      const pricingAfter1 = await Deno.readTextFile(`${dir}/pricing.yml`);

      // Second run — same inputs
      const second = await seedMissingSlugs(
        { slugs: ["openrouter/x-ai/grok-4.3"], catalogDir: dir },
        stableDeps,
      );
      assertEquals(
        second.modelsAdded,
        0,
        "Second run should add 0 models (idempotent)",
      );
      assertEquals(
        second.familiesAdded,
        0,
        "Second run should add 0 families (idempotent)",
      );
      assertEquals(
        second.pricingAdded,
        0,
        "Second run should add 0 pricing rows (idempotent)",
      );
      assertEquals(
        second.errors.length,
        0,
        "Second run should have no errors",
      );

      const familiesAfter2 = await Deno.readTextFile(
        `${dir}/model-families.yml`,
      );
      const modelsAfter2 = await Deno.readTextFile(`${dir}/models.yml`);
      const pricingAfter2 = await Deno.readTextFile(`${dir}/pricing.yml`);

      assertEquals(
        familiesAfter1,
        familiesAfter2,
        "model-families.yml should be byte-identical after second run",
      );
      assertEquals(
        modelsAfter1,
        modelsAfter2,
        "models.yml should be byte-identical after second run",
      );
      assertEquals(
        pricingAfter1,
        pricingAfter2,
        "pricing.yml should be byte-identical after second run",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
