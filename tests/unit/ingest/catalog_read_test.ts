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

Deno.test("readCatalog keeps batch_* pricing fields when present, absent when omitted", async () => {
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
- pricing_version: pv-batch
  model_slug: a/b
  input_per_mtoken: 5
  output_per_mtoken: 10
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
  batch_input_per_mtoken: 2.5
  batch_output_per_mtoken: 5
  batch_cache_read_per_mtoken: 0
  batch_cache_write_per_mtoken: 0
  effective_from: 2026-04-20T00:00:00Z
  source: manual
- pricing_version: pv-nobatch
  model_slug: a/b
  input_per_mtoken: 5
  output_per_mtoken: 10
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
    const withBatch = cat.pricing.find((p) => p.pricing_version === "pv-batch");
    const withoutBatch = cat.pricing.find((p) =>
      p.pricing_version === "pv-nobatch"
    );
    assertEquals(withBatch?.batch_input_per_mtoken, 2.5);
    assertEquals(withBatch?.batch_output_per_mtoken, 5);
    assertEquals(withoutBatch?.batch_input_per_mtoken, undefined);
    assertEquals(withoutBatch?.batch_output_per_mtoken, undefined);
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
