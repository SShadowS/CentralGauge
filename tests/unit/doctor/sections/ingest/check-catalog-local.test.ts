import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCatalogLocal } from "../../../../../src/doctor/sections/ingest/check-catalog-local.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return { cwd, fetchFn: globalThis.fetch, previousResults: new Map() };
}

describe("checkCatalogLocal", () => {
  it("passes when all catalog YAMLs parse cleanly", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.mkdir(`${tmp}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/site/catalog/models.yml`,
      `- slug: x/y\n  api_model_id: y\n  family: f\n  display_name: Y\n`,
    );
    await Deno.writeTextFile(
      `${tmp}/site/catalog/model-families.yml`,
      `- slug: f\n  vendor: V\n  display_name: F\n`,
    );
    await Deno.writeTextFile(
      `${tmp}/site/catalog/pricing.yml`,
      `[]\n`,
    );
    try {
      const result = await checkCatalogLocal.run(ctx(tmp));
      assertEquals(result.status, "passed");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails on YAML parse error", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.mkdir(`${tmp}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/site/catalog/models.yml`,
      `: not [valid yaml`,
    );
    try {
      const result = await checkCatalogLocal.run(ctx(tmp));
      assertEquals(result.status, "failed");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when site/catalog directory is missing entirely", async () => {
    const tmp = await Deno.makeTempDir();
    try {
      const result = await checkCatalogLocal.run(ctx(tmp));
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("site/catalog"), true);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
