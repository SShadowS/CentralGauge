import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type {
  FamilyRow,
  ModelRow,
  OpenRouterMeta,
  PricingRow,
  SeedInputs,
} from "../../../../src/catalog/seed/types.ts";

describe("seed types", () => {
  it("ModelRow round-trips required fields", () => {
    const m: ModelRow = {
      slug: "openrouter/x-ai/grok-4.3",
      api_model_id: "x-ai/grok-4.3",
      family: "grok",
      display_name: "xAI: Grok 4.3",
      generation: 4,
      released_at: "2025-11-01",
    };
    assertEquals(m.slug, "openrouter/x-ai/grok-4.3");
  });

  it("PricingRow uses the existing YAML schema", () => {
    const p: PricingRow = {
      pricing_version: "2026-05-03",
      model_slug: "openrouter/x-ai/grok-4.3",
      effective_from: "2026-05-03T00:00:00.000Z",
      effective_until: null,
      input_per_mtoken: 1.25,
      output_per_mtoken: 2.50,
      cache_read_per_mtoken: 0,
      cache_write_per_mtoken: 0,
      source: "manual",
      fetched_at: "2026-05-03T00:00:00.000Z",
    };
    assertEquals(p.input_per_mtoken, 1.25);
  });

  it("FamilyRow matches model-families.yml schema", () => {
    const f: FamilyRow = {
      slug: "grok",
      vendor: "xAI",
      display_name: "Grok",
    };
    assertEquals(f.slug, "grok");
  });

  it("SeedInputs is a list of slugs plus a catalogDir", () => {
    const s: SeedInputs = {
      slugs: ["openrouter/x-ai/grok-4.3"],
      catalogDir: "/tmp/catalog",
    };
    assertEquals(s.slugs.length, 1);
  });

  it("OpenRouterMeta carries pricing + name + releasedAt", () => {
    const m: OpenRouterMeta = {
      pricing: { input: 1.25, output: 2.50 },
      displayName: "xAI: Grok 4.3",
      vendor: "xAI",
      releasedAt: "2025-11-01",
    };
    assertEquals(m.vendor, "xAI");
  });
});
