import { assert, assertEquals } from "@std/assert";
import { ContainerError } from "../../../../src/errors.ts";
import { synthesizeInfraAttempt } from "../../../../src/parallel/shared/infra-attempt.ts";
import { isInfraInvalidatedAttempt } from "../../../../src/health/infra-invalidation.ts";

Deno.test("synthesizeInfraAttempt keeps the attempt number, prompt and billed usage", () => {
  const err = new ContainerError("Boom", "Cronus281", "test", { exitCode: 1 });
  const startTime = new Date(Date.now() - 5_000);
  const a = synthesizeInfraAttempt({
    attemptNumber: 2,
    startTime,
    error: err,
    classification: {
      fingerprint: "test:abc",
      signature: { label: "SQL down" },
    },
    request: { prompt: "RENDERED", maxTokens: 10 },
    llmResponse: {
      content: "some code",
      model: "m",
      duration: 100,
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        estimatedCost: 0.01,
      },
    },
    infraRetryExhausted: true,
    infraRetryExhaustionReason: "budget_exhausted",
  });
  assertEquals(a.attemptNumber, 2);
  assertEquals(a.prompt, "RENDERED");
  assertEquals(a.tokensUsed, 15);
  assertEquals(a.cost, 0.01);
  assertEquals(a.containerName, "Cronus281");
  assertEquals(a.success, false);
  assertEquals(a.infraSynthesized, true);
  assertEquals(a.infraRetryExhausted, true);
  assert(a.failureReasons[0]?.startsWith("Infra error: Boom"));
  assert(a.failureReasons.some((r) => r === "Signature: SQL down"));
  assert(isInfraInvalidatedAttempt(a));
  assert(a.duration >= 5_000);
});

Deno.test("synthesizeInfraAttempt without an LLM response zeroes usage and prompt", () => {
  const a = synthesizeInfraAttempt({
    attemptNumber: 1,
    startTime: new Date(),
    error: new Error("plain"),
    classification: { fingerprint: "x" },
  });
  assertEquals(a.prompt, "");
  assertEquals(a.tokensUsed, 0);
  assertEquals(a.cost, 0);
  assertEquals(a.containerName, undefined);
  assert(a.failureReasons.some((r) => r === "Signature: (unclassified)"));
});

Deno.test("synthesizeInfraAttempt records the requested pin with not_served when no response exists", () => {
  const a = synthesizeInfraAttempt({
    attemptNumber: 1,
    startTime: new Date(),
    error: new Error("plain"),
    classification: { fingerprint: "x" },
    provider: "openrouter",
    requestedUpstream: "novita/fp8",
    upstreamProviderName: "Novita",
  });
  assertEquals(a.requestedUpstream, "novita/fp8");
  assertEquals(a.servedUpstream, null);
  assertEquals(a.upstreamVerification, "not_served");
});

Deno.test("synthesizeInfraAttempt verifies the pin when the response carries the upstream", () => {
  const a = synthesizeInfraAttempt({
    attemptNumber: 2,
    startTime: new Date(),
    error: new ContainerError("Boom", "Cronus281", "test"),
    classification: { fingerprint: "test:abc" },
    provider: "openrouter",
    requestedUpstream: "novita/fp8",
    upstreamProviderName: "Novita",
    llmResponse: {
      content: "code",
      model: "m",
      duration: 1,
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      servedUpstream: "Novita",
      upstreamIdentitySource: "provider_field",
    },
  });
  assertEquals(a.upstreamVerification, "verified");
  assertEquals(a.servedUpstream, "Novita");
});

Deno.test("synthesizeInfraAttempt without a provider classifies as not_applicable", () => {
  const a = synthesizeInfraAttempt({
    attemptNumber: 1,
    startTime: new Date(),
    error: new Error("plain"),
    classification: { fingerprint: "x" },
  });
  assertEquals(a.upstreamVerification, "not_applicable");
  assertEquals(a.requestedUpstream, null);
});
