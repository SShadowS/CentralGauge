import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CatalogSeedError } from "../../src/errors.ts";

describe("CatalogSeedError", () => {
  it("captures slug + reason in context", () => {
    const err = new CatalogSeedError(
      "no pricing source for openrouter/x-ai/grok-4.3",
      "SEED_NO_PRICING",
      { slug: "openrouter/x-ai/grok-4.3" },
    );
    assertEquals(err.code, "SEED_NO_PRICING");
    assertEquals(err.context, { slug: "openrouter/x-ai/grok-4.3" });
    assert(err instanceof Error);
  });

  it("accepts the four documented codes", () => {
    const codes: Array<CatalogSeedError["code"]> = [
      "SEED_NO_PRICING",
      "SEED_NETWORK",
      "SEED_MISSING_KEY",
      "SEED_YAML_WRITE",
    ];
    for (const c of codes) {
      const e = new CatalogSeedError("x", c);
      assertEquals(e.code, c);
    }
  });
});
