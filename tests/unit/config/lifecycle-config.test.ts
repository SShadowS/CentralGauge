/**
 * Plan F / F1.2 — lifecycle config validation + defaults.
 *
 * The `mergeLifecycleDefaults` helper is the single source of truth for
 * what counts as a valid `lifecycle.*` section in `.centralgauge.yml`.
 * Plan C reads `analyzer_model`; Plan F reads all three. Tests pin the
 * defaults so unrelated refactors can't silently shift gate behaviour.
 */
import { assertEquals, assertThrows } from "@std/assert";
import {
  LIFECYCLE_DEFAULTS,
  mergeLifecycleDefaults,
} from "../../../src/config/config.ts";

Deno.test("LIFECYCLE_DEFAULTS pinned values (cross-plan contract)", () => {
  // These three values are read by Plan C, Plan F, and Plan G. Changing
  // them shifts gate behaviour for every cycle run — bump the strategic
  // plan rationale boxes in the same commit if you ever need to.
  assertEquals(
    LIFECYCLE_DEFAULTS.analyzer_model,
    "anthropic/claude-opus-4-6",
  );
  assertEquals(LIFECYCLE_DEFAULTS.cross_llm_sample_rate, 0.2);
  assertEquals(LIFECYCLE_DEFAULTS.confidence_threshold, 0.7);
});

Deno.test("mergeLifecycleDefaults returns defaults when section is absent", () => {
  const r = mergeLifecycleDefaults(undefined);
  assertEquals(r, LIFECYCLE_DEFAULTS);
});

Deno.test("mergeLifecycleDefaults overrides each field independently", () => {
  const r = mergeLifecycleDefaults({ confidence_threshold: 0.85 });
  assertEquals(r.confidence_threshold, 0.85);
  assertEquals(
    r.cross_llm_sample_rate,
    LIFECYCLE_DEFAULTS.cross_llm_sample_rate,
  );
  assertEquals(r.analyzer_model, LIFECYCLE_DEFAULTS.analyzer_model);
});

Deno.test("mergeLifecycleDefaults rejects out-of-range sample rate", () => {
  assertThrows(
    () => mergeLifecycleDefaults({ cross_llm_sample_rate: -0.1 }),
    Error,
    "cross_llm_sample_rate",
  );
  assertThrows(
    () => mergeLifecycleDefaults({ cross_llm_sample_rate: 1.5 }),
    Error,
    "cross_llm_sample_rate",
  );
});

Deno.test("mergeLifecycleDefaults rejects out-of-range threshold", () => {
  assertThrows(
    () => mergeLifecycleDefaults({ confidence_threshold: -0.1 }),
    Error,
    "confidence_threshold",
  );
  assertThrows(
    () => mergeLifecycleDefaults({ confidence_threshold: 1.5 }),
    Error,
    "confidence_threshold",
  );
});

Deno.test("mergeLifecycleDefaults rejects empty analyzer_model", () => {
  assertThrows(
    () => mergeLifecycleDefaults({ analyzer_model: "" }),
    Error,
    "analyzer_model",
  );
});

Deno.test("mergeLifecycleDefaults accepts boundary values", () => {
  const lo = mergeLifecycleDefaults({
    cross_llm_sample_rate: 0,
    confidence_threshold: 0,
  });
  assertEquals(lo.cross_llm_sample_rate, 0);
  assertEquals(lo.confidence_threshold, 0);
  const hi = mergeLifecycleDefaults({
    cross_llm_sample_rate: 1,
    confidence_threshold: 1,
  });
  assertEquals(hi.cross_llm_sample_rate, 1);
  assertEquals(hi.confidence_threshold, 1);
});
