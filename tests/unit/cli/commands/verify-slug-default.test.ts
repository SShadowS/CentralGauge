import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertMatch } from "@std/assert";
import { LIFECYCLE_DEFAULTS } from "../../../../src/config/config.ts";

/**
 * Reads the verify command source and asserts:
 *
 * 1. (Phase B Task B3) the --model flag never hardcodes an UNPREFIXED
 *    legacy-style model id — preventing the slug-drift class from
 *    regrowing.
 * 2. (T14/V11 follow-up) the --model flag does NOT hardcode ANY Cliffy-level
 *    `default:` at all anymore. A hardcoded default there always wins
 *    (Cliffy supplies it whether or not the user passed --model), which
 *    made `resolveAnalyzerModelDefault()`'s `lifecycle.analyzer_model`
 *    config-chain fallback in `src/verify/analyzer.ts` dead code for the
 *    actual `centralgauge verify` command — a `.centralgauge.yml` override
 *    was silently ignored. The effective built-in fallback now flows from
 *    `LIFECYCLE_DEFAULTS.analyzer_model` (config.ts) instead, asserted
 *    below to still be vendor-prefixed so #1's guarantee holds either way.
 */
describe("verify command --model default", () => {
  it("does not hardcode a Cliffy-level default (T14/V11) — falls through to the config chain", async () => {
    const src = await Deno.readTextFile(
      new URL("../../../../cli/commands/verify-command.ts", import.meta.url),
    );
    const optionBlock = src.match(
      /\.option\(\s*"--model[^"]*",[\s\S]*?\)\s*\n\s*\.option/,
    );
    // Cliffy's own default-value config is a THIRD-argument object literal
    // (`{ default: ... }`) — distinct from the word "default" merely
    // appearing inside the human-readable description string, which is
    // fine (and used here to document the config-chain fallback).
    assertMatch(
      optionBlock?.[0] ?? "",
      /^(?:(?!\{[^}]*\bdefault\s*:)[\s\S])*$/,
    );
  });

  it("the effective built-in analyzer_model default is vendor-prefixed, not the unprefixed legacy form", () => {
    assertEquals(
      LIFECYCLE_DEFAULTS.analyzer_model,
      "anthropic/claude-opus-4-6",
    );
    // Must contain a "/" (vendor prefix) — a bare id like "claude-opus-4-6"
    // would reintroduce the slug-drift class Phase B B3 fixed.
    assertMatch(LIFECYCLE_DEFAULTS.analyzer_model, /^[^/]+\/.+/);
  });
});
