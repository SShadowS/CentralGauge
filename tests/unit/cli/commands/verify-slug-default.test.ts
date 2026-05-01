import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

/**
 * Reads the verify command source and asserts the --model flag default is a
 * vendor-prefixed slug, NOT the unprefixed legacy form. Regression guard for
 * Phase B Task B3 — preventing the slug-drift class from regrowing.
 */
describe("verify command --model default", () => {
  it("uses anthropic/claude-opus-4-6 (vendor-prefixed) as default", async () => {
    const src = await Deno.readTextFile(
      new URL("../../../../cli/commands/verify-command.ts", import.meta.url),
    );
    const match = src.match(
      /\.option\(\s*"--model[^"]*",\s*"[^"]+",\s*\{\s*default:\s*"([^"]+)"/,
    );
    assertEquals(match?.[1], "anthropic/claude-opus-4-6");
  });
});
