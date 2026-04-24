import { assertEquals } from "@std/assert";
import { readCatalog } from "../../../src/ingest/catalog/read.ts";

Deno.test("readCatalog parses models, pricing, families", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${tmp}/models.yml`,
      `
- slug: a/b
  api_model_id: b-2026
  family: a
  display_name: B
`,
    );
    await Deno.writeTextFile(
      `${tmp}/pricing.yml`,
      `
- pricing_version: pv-1
  model_slug: a/b
  input_per_mtoken: 1
  output_per_mtoken: 2
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
  effective_from: 2026-04-20T00:00:00Z
  source: manual
`,
    );
    await Deno.writeTextFile(
      `${tmp}/model-families.yml`,
      `
- slug: a
  vendor: A Inc
  display_name: Alpha
`,
    );
    const cat = await readCatalog(tmp);
    assertEquals(cat.models.length, 1);
    assertEquals(cat.models[0]?.slug, "a/b");
    assertEquals(cat.pricing.length, 1);
    assertEquals(cat.pricing[0]?.pricing_version, "pv-1");
    assertEquals(cat.families.length, 1);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readCatalog returns empty arrays when files absent", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const cat = await readCatalog(tmp);
    assertEquals(cat.models, []);
    assertEquals(cat.pricing, []);
    assertEquals(cat.families, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
