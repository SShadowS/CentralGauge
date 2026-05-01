import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

describe("populate-shortcomings VENDOR_PREFIX_MAP removal", () => {
  it("source no longer contains VENDOR_PREFIX_MAP literal", async () => {
    const src = await Deno.readTextFile(
      new URL(
        "../../../../cli/commands/populate-shortcomings-command.ts",
        import.meta.url,
      ),
    );
    assert(
      !src.includes("VENDOR_PREFIX_MAP"),
      "VENDOR_PREFIX_MAP still present in populate-shortcomings — Phase B4 not done",
    );
  });

  it("mapToProductionSlug now passes through vendor-prefixed inputs unchanged", async () => {
    const mod = await import(
      new URL(
        "../../../../cli/commands/populate-shortcomings-command.ts",
        import.meta.url,
      ).href
    ) as { mapToProductionSlug?: (s: string) => string | null };
    if (!mod.mapToProductionSlug) {
      // export was removed entirely (acceptable end state)
      return;
    }
    assertEquals(
      mod.mapToProductionSlug("anthropic/claude-opus-4-6"),
      "anthropic/claude-opus-4-6",
    );
    assertEquals(
      mod.mapToProductionSlug("openrouter/deepseek/deepseek-v3.2"),
      "openrouter/deepseek/deepseek-v3.2",
    );
  });
});
