import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import {
  MODEL_ALIASES,
  resolveProviderAndModel,
} from "../../../src/llm/model-aliases.ts";

/**
 * `resolveProviderAndModel` moved here verbatim from `variant-parser.ts`,
 * where it was private and untested, so that the bench and the authoring
 * dashboard resolve a model spec through ONE implementation. It had no test
 * of its own; these pin the three branches.
 */
describe("llm/model-aliases", () => {
  it("resolves a bare alias through the table", () => {
    assertEquals(resolveProviderAndModel("sonnet"), {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });
    // The alias `.centralgauge.yml`'s quick-test preset uses. Resolving it to
    // {mock, mock} instead — which a plain no-slash fallback would do — is a
    // bench/dashboard divergence, and it is the free calibration path.
    assertEquals(resolveProviderAndModel("mock"), {
      provider: "mock",
      model: "mock-gpt-4",
    });
  });

  it("splits a vendor-prefixed spec on the FIRST slash only", () => {
    assertEquals(resolveProviderAndModel("openai/gpt-5.1"), {
      provider: "openai",
      model: "gpt-5.1",
    });
    // An openrouter model id contains its own slash; splitting on the last
    // one, or on every one, would mangle it.
    assertEquals(
      resolveProviderAndModel("openrouter/deepseek/deepseek-v3.2"),
      { provider: "openrouter", model: "deepseek/deepseek-v3.2" },
    );
  });

  it("returns an unknown spec as both halves rather than throwing", () => {
    assertEquals(resolveProviderAndModel("not-a-model"), {
      provider: "not-a-model",
      model: "not-a-model",
    });
  });

  it("prefers the alias table over a slash split", () => {
    // No alias contains a slash today, so this pins the ORDER rather than a
    // live conflict: an alias added later with a slash in its key must still
    // win, because the table is the more specific answer.
    const withSlash = Object.keys(MODEL_ALIASES).filter((k) => k.includes("/"));
    assertEquals(withSlash, []);
    assertEquals(resolveProviderAndModel("opus").provider, "anthropic");
  });
});
