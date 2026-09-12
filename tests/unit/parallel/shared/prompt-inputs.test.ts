// tests/unit/parallel/shared/prompt-inputs.test.ts
//
// `frozenRoutingFrom` (spec 2026-09-11 D2): the one mapping from a resolved
// upstream pin to the routing a run freezes. Both callers - `submitRuns`,
// which writes `prompt-inputs.json`, and `submitWiring`, which pins wave 1's
// request bodies - go through it, so a run's frozen record and the requests
// it actually sent cannot describe different routing.
import { assertEquals } from "@std/assert";
import { frozenRoutingFrom } from "../../../../src/parallel/shared/prompt-inputs.ts";
import type { ResolvedUpstreamPin } from "../../../../src/llm/upstream-pin.ts";

Deno.test("frozenRoutingFrom keeps exactly the four routing fields", () => {
  const resolved: ResolvedUpstreamPin = {
    upstreamPin: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    preflight: "passed",
  };
  const routing = frozenRoutingFrom(resolved);
  assertEquals(routing, {
    upstreamPin: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    preflight: "passed",
  });
  assertEquals(Object.keys(routing).sort(), [
    "preflight",
    "providerName",
    "quantization",
    "upstreamPin",
  ]);
});

Deno.test("frozenRoutingFrom carries an undeclared quantization through as null", () => {
  // `null` is "the endpoint declared none", which the scores file prints as
  // "quantization undeclared". Dropping the key instead would make an
  // undeclared quantization indistinguishable from an unrecorded one.
  const routing = frozenRoutingFrom({
    upstreamPin: "fireworks",
    providerName: "Fireworks",
    quantization: null,
    preflight: "skipped",
  });
  assertEquals(routing.quantization, null);
  assertEquals(routing.preflight, "skipped");
  assertEquals("quantization" in routing, true);
});

Deno.test("frozenRoutingFrom ignores fields outside the routing contract", () => {
  // A resolver that grows a field must not smuggle it into the frozen run
  // record, where every later step reads routing from.
  const routing = frozenRoutingFrom({
    upstreamPin: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    preflight: "passed",
    ...{ latencyMs: 42 },
  } as ResolvedUpstreamPin);
  assertEquals(Object.keys(routing).length, 4);
  assertEquals(
    (routing as unknown as Record<string, unknown>)["latencyMs"],
    undefined,
  );
});
