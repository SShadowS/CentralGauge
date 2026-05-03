import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse as parseYaml, stringify } from "@std/yaml";
import {
  appendModel,
  appendPricingIfChanged,
  ensureFamily,
} from "../../../../src/catalog/seed/writer.ts";
import { CatalogSeedError } from "../../../../src/errors.ts";
import type { PricingRow } from "../../../../src/catalog/seed/types.ts";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";

describe("ensureFamily", () => {
  it("appends a new family row when slug not present", async () => {
    const dir = await createTempDir("seed-family");
    const path = `${dir}/model-families.yml`;
    await Deno.writeTextFile(
      path,
      `# header
- slug: claude
  vendor: Anthropic
  display_name: Claude
`,
    );

    try {
      const result = await ensureFamily(path, {
        slug: "grok",
        vendor: "xAI",
        display_name: "Grok",
      });
      assertEquals(result.added, true);

      const content = await Deno.readTextFile(path);
      const parsed = parseYaml(content) as Array<Record<string, string>>;
      assertEquals(parsed.length, 2);
      assertEquals(parsed[1]?.["slug"], "grok");
      assertEquals(parsed[1]?.["vendor"], "xAI");

      // Header comment preserved
      assertEquals(content.startsWith("# header"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it(
    "returns added=false and writes nothing when family slug already present",
    async () => {
      const dir = await createTempDir("seed-family-skip");
      const path = `${dir}/model-families.yml`;
      const original = `- slug: claude
  vendor: Anthropic
  display_name: Claude
`;
      await Deno.writeTextFile(path, original);

      try {
        const result = await ensureFamily(path, {
          slug: "claude",
          vendor: "Anthropic",
          display_name: "Claude",
        });
        assertEquals(result.added, false);

        const content = await Deno.readTextFile(path);
        assertEquals(content, original);
      } finally {
        await cleanupTempDir(dir);
      }
    },
  );

  it("throws SEED_YAML_WRITE when target directory does not exist", async () => {
    const path = "/nonexistent-dir-for-seed-test-b4/model-families.yml";

    let caught: unknown = null;
    try {
      await ensureFamily(path, {
        slug: "test",
        vendor: "Test",
        display_name: "Test",
      });
    } catch (e) {
      caught = e;
    }
    assertEquals(caught instanceof CatalogSeedError, true);
    assertEquals((caught as CatalogSeedError).code, "SEED_YAML_WRITE");
  });

  it("safely quotes values containing YAML special characters (colon)", async () => {
    const dir = await createTempDir("seed-family-special");
    const path = `${dir}/model-families.yml`;
    await Deno.writeTextFile(path, "");

    try {
      const result = await ensureFamily(path, {
        slug: "grok",
        vendor: "xAI",
        display_name: "xAI: Grok 4.3",
      });
      assertEquals(result.added, true);

      // Round-trip: parse the file and confirm we get the expected display_name back.
      const content = await Deno.readTextFile(path);
      const parsed = parseYaml(content) as Array<Record<string, string>>;
      assertEquals(parsed.length, 1);
      assertEquals(parsed[0]?.["display_name"], "xAI: Grok 4.3");
    } finally {
      await cleanupTempDir(dir);
    }
  });
});

describe("appendModel", () => {
  it("appends a new model row preserving existing rows + comments", async () => {
    const dir = await createTempDir("seed-model");
    const path = `${dir}/models.yml`;
    await Deno.writeTextFile(
      path,
      `# Models
- slug: openai/gpt-5
  api_model_id: gpt-5
  family: gpt
  display_name: GPT-5
  generation: 5
  released_at: "2025-08-07"
`,
    );

    try {
      const result = await appendModel(path, {
        slug: "openrouter/x-ai/grok-4.3",
        api_model_id: "x-ai/grok-4.3",
        family: "grok",
        display_name: "xAI: Grok 4.3",
        generation: 4,
        released_at: "2025-11-01",
      });
      assertEquals(result.added, true);

      const content = await Deno.readTextFile(path);
      assertEquals(content.startsWith("# Models"), true);
      assertEquals(content.includes("openrouter/x-ai/grok-4.3"), true);

      // Round-trip: parse and verify both rows present
      const parsed = parseYaml(content) as Array<Record<string, unknown>>;
      assertEquals(parsed.length, 2);
      assertEquals(parsed[1]?.["slug"], "openrouter/x-ai/grok-4.3");
      assertEquals(parsed[1]?.["display_name"], "xAI: Grok 4.3");
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("returns added=false when slug already present", async () => {
    const dir = await createTempDir("seed-model-skip");
    const path = `${dir}/models.yml`;
    const original = `- slug: openai/gpt-5
  api_model_id: gpt-5
  family: gpt
  display_name: GPT-5
  generation: 5
`;
    await Deno.writeTextFile(path, original);

    try {
      const result = await appendModel(path, {
        slug: "openai/gpt-5",
        api_model_id: "gpt-5",
        family: "gpt",
        display_name: "GPT-5",
        generation: 5,
      });
      assertEquals(result.added, false);
      assertEquals(await Deno.readTextFile(path), original);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("omits released_at when not provided on row", async () => {
    const dir = await createTempDir("seed-model-no-date");
    const path = `${dir}/models.yml`;
    await Deno.writeTextFile(path, "");

    try {
      await appendModel(path, {
        slug: "openrouter/foo/bar-1",
        api_model_id: "foo/bar-1",
        family: "bar",
        display_name: "Bar 1",
        generation: 1,
        // released_at intentionally omitted
      });

      const content = await Deno.readTextFile(path);
      const parsed = parseYaml(content) as Array<Record<string, unknown>>;
      assertEquals(parsed.length, 1);
      assertEquals(parsed[0]?.["slug"], "openrouter/foo/bar-1");
      assertEquals("released_at" in parsed[0]!, false);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});

describe("appendPricingIfChanged", () => {
  const sampleRow = (overrides: Partial<PricingRow> = {}): PricingRow => ({
    pricing_version: "2026-05-03",
    model_slug: "openrouter/x-ai/grok-4.3",
    effective_from: "2026-05-03T00:00:00.000Z",
    effective_until: null,
    input_per_mtoken: 1.25,
    output_per_mtoken: 2.5,
    cache_read_per_mtoken: 0,
    cache_write_per_mtoken: 0,
    source: "openrouter",
    fetched_at: "2026-05-03T00:00:00.000Z",
    ...overrides,
  });

  it("appends a new snapshot when no prior row exists for slug", async () => {
    const dir = await createTempDir("seed-pricing-new");
    const path = `${dir}/pricing.yml`;
    await Deno.writeTextFile(path, "");

    try {
      const result = await appendPricingIfChanged(path, sampleRow());
      assertEquals(result.added, true);
      const content = await Deno.readTextFile(path);
      assertEquals(content.includes("openrouter/x-ai/grok-4.3"), true);
      const parsed = parseYaml(content) as PricingRow[];
      assertEquals(parsed.length, 1);
      assertEquals(parsed[0]?.input_per_mtoken, 1.25);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("appends a new snapshot when prices differ from latest existing row", async () => {
    const dir = await createTempDir("seed-pricing-diff");
    const path = `${dir}/pricing.yml`;
    const existing: PricingRow = {
      ...sampleRow(),
      pricing_version: "2026-04-01",
      effective_from: "2026-04-01T00:00:00.000Z",
      input_per_mtoken: 2,
      output_per_mtoken: 5,
      fetched_at: "2026-04-01T00:00:00.000Z",
    };
    await Deno.writeTextFile(path, stringify([existing], { lineWidth: -1 }));

    try {
      const result = await appendPricingIfChanged(path, sampleRow());
      assertEquals(result.added, true);
      const content = await Deno.readTextFile(path);
      const parsed = parseYaml(content) as PricingRow[];
      assertEquals(parsed.length, 2);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("returns added=false when prices match latest existing row", async () => {
    const dir = await createTempDir("seed-pricing-skip");
    const path = `${dir}/pricing.yml`;
    const existing: PricingRow = {
      ...sampleRow(),
      pricing_version: "2026-04-01",
      effective_from: "2026-04-01T00:00:00.000Z",
      fetched_at: "2026-04-01T00:00:00.000Z",
    };
    const original = stringify([existing], { lineWidth: -1 });
    await Deno.writeTextFile(path, original);

    try {
      const result = await appendPricingIfChanged(path, sampleRow());
      assertEquals(result.added, false);
      assertEquals(await Deno.readTextFile(path), original);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("uses the latest snapshot (by pricing_version) for delta comparison", async () => {
    const dir = await createTempDir("seed-pricing-multi");
    const path = `${dir}/pricing.yml`;
    const olderRow: PricingRow = {
      ...sampleRow(),
      pricing_version: "2026-01-01",
      input_per_mtoken: 99,
      output_per_mtoken: 99,
    };
    const newerRow: PricingRow = {
      ...sampleRow(),
      pricing_version: "2026-04-01",
      input_per_mtoken: 1.25,
      output_per_mtoken: 2.5,
    };
    await Deno.writeTextFile(
      path,
      stringify([olderRow, newerRow], { lineWidth: -1 }),
    );

    try {
      // Today's row matches NEWER, so should be skipped despite differing from older.
      const result = await appendPricingIfChanged(path, sampleRow());
      assertEquals(result.added, false);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("appendPricingIfChanged throws SEED_YAML_WRITE on filesystem failure", async () => {
    const dir = await createTempDir("seed-pricing-write-fail");
    const path = `${dir}/nonexistent-subdir/pricing.yml`;

    try {
      let caught: unknown = null;
      try {
        await appendPricingIfChanged(path, sampleRow());
      } catch (e) {
        caught = e;
      }
      assertEquals(caught instanceof CatalogSeedError, true);
      assertEquals((caught as CatalogSeedError).code, "SEED_YAML_WRITE");
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
