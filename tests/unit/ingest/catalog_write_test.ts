import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  appendModel,
  appendPricing,
} from "../../../src/ingest/catalog/write.ts";

Deno.test("appendModel adds an entry, preserving leading comments", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const path = `${tmp}/models.yml`;
    await Deno.writeTextFile(
      path,
      `# Model catalog — checked in\n- slug: x/y\n  api_model_id: y-1\n  family: x\n  display_name: Y\n`,
    );
    await appendModel(path, {
      slug: "x/z",
      api_model_id: "z-1",
      family: "x",
      display_name: "Z",
    });
    const text = await Deno.readTextFile(path);
    assertStringIncludes(text, "# Model catalog — checked in");
    assertStringIncludes(text, "slug: x/z");
    assertStringIncludes(text, "display_name: Z");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("appendPricing writes source field", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const path = `${tmp}/pricing.yml`;
    await Deno.writeTextFile(path, "[]\n");
    await appendPricing(path, {
      pricing_version: "pv-1",
      model_slug: "x/y",
      input_per_mtoken: 1,
      output_per_mtoken: 2,
      cache_read_per_mtoken: 0,
      cache_write_per_mtoken: 0,
      effective_from: "2026-04-20T00:00:00Z",
      source: "manual",
      fetched_at: "2026-04-20T10:00:00Z",
    });
    const text = await Deno.readTextFile(path);
    assertStringIncludes(text, "source: manual");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("appendModel creates file when missing", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const path = `${tmp}/models.yml`;
    await appendModel(path, {
      slug: "a/b",
      api_model_id: "b-1",
      family: "a",
      display_name: "B",
    });
    const text = await Deno.readTextFile(path);
    assertStringIncludes(text, "slug: a/b");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("appendPricing carries batch rates forward from the latest prior row", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const path = `${tmp}/pricing.yml`;
    await Deno.writeTextFile(
      path,
      `- pricing_version: "2026-09-01"
  model_slug: x/y
  input_per_mtoken: 1
  output_per_mtoken: 2
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
  effective_from: "2026-09-01T00:00:00Z"
  source: manual
  fetched_at: "2026-09-01T00:00:00Z"
  batch_input_per_mtoken: 0.5
  batch_output_per_mtoken: 1
  batch_cache_read_per_mtoken: 0.05
  batch_cache_write_per_mtoken: 0.625
`,
    );

    // What LiteLLM/OpenRouter report: sync rates only. Appended as-is it
    // would shadow the batch rates above under "latest version wins".
    const written = await appendPricing(path, {
      pricing_version: "2026-09-08",
      model_slug: "x/y",
      input_per_mtoken: 1,
      output_per_mtoken: 2,
      cache_read_per_mtoken: 0,
      cache_write_per_mtoken: 0,
      effective_from: "2026-09-08T00:00:00Z",
      source: "litellm-api",
      fetched_at: "2026-09-08T10:00:00Z",
    });

    assertEquals(written.batch_input_per_mtoken, 0.5);
    assertEquals(written.batch_output_per_mtoken, 1);
    assertEquals(written.batch_cache_read_per_mtoken, 0.05);
    assertEquals(written.batch_cache_write_per_mtoken, 0.625);

    const rows = parseYaml(await Deno.readTextFile(path)) as Array<
      Record<string, unknown>
    >;
    const appended = rows.at(-1)!;
    assertEquals(appended["pricing_version"], "2026-09-08");
    assertEquals(appended["batch_input_per_mtoken"], 0.5);
    assertEquals(appended["batch_cache_write_per_mtoken"], 0.625);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("appendPricing leaves a row that states its own batch rates alone", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const path = `${tmp}/pricing.yml`;
    await Deno.writeTextFile(
      path,
      `- pricing_version: "2026-09-01"
  model_slug: x/y
  input_per_mtoken: 1
  output_per_mtoken: 2
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
  effective_from: "2026-09-01T00:00:00Z"
  source: manual
  fetched_at: "2026-09-01T00:00:00Z"
  batch_input_per_mtoken: 0.5
`,
    );

    const written = await appendPricing(path, {
      pricing_version: "2026-09-08",
      model_slug: "x/y",
      input_per_mtoken: 1,
      output_per_mtoken: 2,
      cache_read_per_mtoken: 0,
      cache_write_per_mtoken: 0,
      effective_from: "2026-09-08T00:00:00Z",
      source: "manual",
      fetched_at: "2026-09-08T10:00:00Z",
      batch_input_per_mtoken: 0.25,
    });

    assertEquals(written.batch_input_per_mtoken, 0.25);
    assertEquals(written.batch_output_per_mtoken, undefined);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
