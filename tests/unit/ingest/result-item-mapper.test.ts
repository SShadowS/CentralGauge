/**
 * Task 11 fix round 1 — `mapResultItemToInput` is the extracted, exported
 * pure function `ingestRun` uses to turn each `BenchResultItem` into the
 * `ResultInput` row sent in the signed envelope. Two contracts to lock down:
 *  (a) all nine taxonomy-v2 capture fields carry through when present;
 *  (b) an item that never set them produces a row with NO such keys at all
 *      (not `undefined`-valued keys) — legacy-shaped payloads stay
 *      byte-identical.
 */

import { assertEquals, assertFalse } from "@std/assert";
import type { BenchResultItem, BenchResults } from "../../../src/ingest/mod.ts";
import {
  buildRunPayloadInput,
  mapResultItemToInput,
} from "../../../src/ingest/mod.ts";
import { buildPayload } from "../../../src/ingest/envelope.ts";

function baseItem(overrides?: Partial<BenchResultItem>): BenchResultItem {
  return {
    task_id: "CG-AL-E001",
    attempt: 1,
    passed: true,
    score: 100,
    compile_success: true,
    compile_errors: [],
    tests_total: 1,
    tests_passed: 1,
    tokens_in: 10,
    tokens_out: 20,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    served_model: null,
    refusal_category: null,
    // The five upstream-lock fields are non-optional on a BenchResultItem:
    // assembly always sets them, nulling them out (and reporting
    // `not_applicable`) for an attempt the lock never covered.
    requested_upstream: null,
    served_upstream: null,
    served_upstream_model: null,
    upstream_identity_source: null,
    upstream_verification: "not_applicable",
    durations_ms: {},
    failure_reasons: [],
    ...overrides,
  };
}

Deno.test("mapResultItemToInput carries all nine capture fields through when present", async () => {
  const item = baseItem({
    test_vector: [{ id: "abc123", name: "TestA", passed: true }],
    termination_kind: "cap_reached",
    provider_finish_reason: "length",
    cap_reached: true,
    infra_retries: 2,
    infra_exhaustion_reason: "budget_exhausted",
    fallback_chain: ["claude-opus-4-8", "claude-opus-4-7"],
    prompt_sha256: "p".repeat(64),
    candidate_sha256: "c".repeat(64),
  });

  const out = await mapResultItemToInput(item);

  assertEquals(out.test_vector, [
    { id: "abc123", name: "TestA", passed: true },
  ]);
  assertEquals(out.termination_kind, "cap_reached");
  assertEquals(out.provider_finish_reason, "length");
  assertEquals(out.cap_reached, true);
  assertEquals(out.infra_retries, 2);
  assertEquals(out.infra_exhaustion_reason, "budget_exhausted");
  assertEquals(out.fallback_chain, ["claude-opus-4-8", "claude-opus-4-7"]);
  assertEquals(out.prompt_sha256, "p".repeat(64));
  assertEquals(out.candidate_sha256, "c".repeat(64));
});

Deno.test("mapResultItemToInput forwards provider_error_code", async () => {
  const item = baseItem({
    provider_finish_reason: "max_tokens",
    provider_error_code: "http_400:invalid_request_error",
  });

  const out = await mapResultItemToInput(item);

  assertEquals(out.provider_finish_reason, "max_tokens");
  assertEquals(out.provider_error_code, "http_400:invalid_request_error");
});

Deno.test("mapResultItemToInput omits all nine capture keys entirely when absent (legacy shape)", async () => {
  const item = baseItem();

  const out = await mapResultItemToInput(item);

  for (
    const key of [
      "test_vector",
      "termination_kind",
      "provider_finish_reason",
      "cap_reached",
      "infra_retries",
      "infra_exhaustion_reason",
      "fallback_chain",
      "prompt_sha256",
      "candidate_sha256",
    ] as const
  ) {
    assertFalse(
      Object.prototype.hasOwnProperty.call(out, key),
      `expected no "${key}" key on a legacy-shaped item, got: ${
        JSON.stringify(out)
      }`,
    );
  }

  // Base (pre-existing) fields still map through unaffected.
  assertEquals(out.task_id, "CG-AL-E001");
  assertEquals(out.passed, true);
  assertEquals(out.served_model, null);
  assertEquals(out.refusal_category, null);
  // The five upstream fields are always present, like served_model above:
  // they are non-optional on the item, so the row always carries them.
  assertEquals(out.requested_upstream, null);
  assertEquals(out.served_upstream, null);
  assertEquals(out.served_upstream_model, null);
  assertEquals(out.upstream_identity_source, null);
  assertEquals(out.upstream_verification, "not_applicable");
});

Deno.test("mapResultItemToInput hashes transcript/code bytes and omits their keys when absent", async () => {
  const withBytes = baseItem({
    transcript_bytes: new TextEncoder().encode("hello transcript"),
    code_bytes: new TextEncoder().encode("codeunit 1 X { }"),
  });
  const out = await mapResultItemToInput(withBytes);
  assertEquals(out.transcript_sha256?.length, 64);
  assertEquals(out.code_sha256?.length, 64);

  const withoutBytes = baseItem();
  const out2 = await mapResultItemToInput(withoutBytes);
  assertFalse(Object.prototype.hasOwnProperty.call(out2, "transcript_sha256"));
  assertFalse(Object.prototype.hasOwnProperty.call(out2, "code_sha256"));
});

/**
 * Fix round 1: `buildRunPayloadInput` is the extracted pure half of
 * `ingestRun`'s payload step, for the same reason `mapResultItemToInput`
 * above was extracted. It covers the one line that forwards `br.excluded`
 * onto the payload input, which nothing else reaches without a network call.
 */
function baseBenchResults(
  overrides?: Partial<BenchResults>,
): BenchResults {
  return {
    runId: "run-1",
    model: { slug: "s", api_model_id: "m", family_slug: "f" },
    settings: {},
    startedAt: "2026-09-12T00:00:00.000Z",
    completedAt: "2026-09-12T00:01:00.000Z",
    pricingVersion: "2026-09-12",
    results: [],
    invocationMode: "sync",
    ...overrides,
  };
}

const RESOLVED = {
  machineId: "mach-1",
  taskSetHash: "a".repeat(64),
  results: [],
};

Deno.test("buildRunPayloadInput forwards excluded onto the payload input", () => {
  const excluded = {
    code: "upstream_unverified" as const,
    reason:
      "upstream unverified on 1 attempt: pinned novita/fp8, no identity in the response (t1 a1)",
    attempts: [{ task_id: "t1", attempt: 1 as const }],
  };

  const input = buildRunPayloadInput(baseBenchResults({ excluded }), RESOLVED);
  assertEquals(input.excluded, excluded);
  // And it survives the trip onto the wire payload.
  assertEquals(buildPayload(input)["excluded"], excluded);
});

Deno.test("buildRunPayloadInput omits excluded entirely on a clean run", () => {
  const input = buildRunPayloadInput(baseBenchResults(), RESOLVED);
  assertFalse(Object.prototype.hasOwnProperty.call(input, "excluded"));
  assertFalse(
    Object.prototype.hasOwnProperty.call(buildPayload(input), "excluded"),
  );
  // The resolved values the caller computes still map through.
  assertEquals(input.machineId, "mach-1");
  assertEquals(input.taskSetHash, "a".repeat(64));
  assertEquals(input.invocationMode, "sync");
});
