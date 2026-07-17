import { describe, it } from "@std/testing/bdd";
import { assertMatch } from "@std/assert";

/**
 * T14/V11 follow-up. `rules-command.ts`'s --llm flag used to hardcode
 * `{ default: "claude-sonnet-4-5-20250929" }`. Cliffy always supplies a
 * configured default whether or not the user passes the flag, which made
 * `resolveGeneratorModel`'s `lifecycle.analyzer_model` config-chain fallback
 * (src/rules/generator.ts) dead code for the actual `centralgauge rules`
 * command — a `.centralgauge.yml` override, or a bench-wide model bump, was
 * silently ignored. Regression guard: the --llm flag must never regrow a
 * hardcoded `default:`.
 */
describe("rules command --llm default", () => {
  it("does not hardcode a Cliffy-level default — falls through to the config chain", async () => {
    const src = await Deno.readTextFile(
      new URL("../../../../cli/commands/rules-command.ts", import.meta.url),
    );
    const optionBlock = src.match(
      /\.option\(\s*"--llm[^"]*",[\s\S]*?\)\s*\n\s*\.option/,
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
});
