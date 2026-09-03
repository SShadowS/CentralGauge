import { assertEquals } from "@std/assert";
import { terminationKind, testVector } from "../../../src/ingest/capture.ts";
import {
  createMockExecutionAttempt,
  createMockLLMResponse,
} from "../../utils/test-helpers.ts";

Deno.test("termination kind follows finish reason, refusal and infra state", () => {
  const ok = createMockExecutionAttempt({
    llmResponse: createMockLLMResponse({ finishReason: "stop" }),
  });
  assertEquals(terminationKind(ok), "response");
  const cap = createMockExecutionAttempt({
    llmResponse: createMockLLMResponse({ finishReason: "length" }),
  });
  assertEquals(terminationKind(cap), "cap_reached");
  const err = createMockExecutionAttempt({
    llmResponse: createMockLLMResponse({ finishReason: "error" }),
  });
  assertEquals(terminationKind(err), "provider_error");
  const refused = createMockExecutionAttempt({
    llmResponse: createMockLLMResponse({
      finishReason: "content_filter",
      refusal: { category: "cyber", recovered: false },
    }),
  });
  assertEquals(terminationKind(refused), "refusal");
  const infra = createMockExecutionAttempt(
    { infraRetryExhaustionReason: "budget_exhausted" } as never,
  );
  assertEquals(terminationKind(infra), "infra_exhausted");
});

Deno.test("test vector carries stable ids in oracle order", async () => {
  const a = createMockExecutionAttempt({
    testResult: {
      success: false,
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      duration: 1,
      output: "",
      results: [
        { name: "X076_ParseAmountAcceptsZero", passed: true, duration: 1 },
        { name: "X140_ZeroWeight", passed: false, duration: 1 },
      ],
    },
  });
  const v = await testVector(a, "CG-AL-X283");
  assertEquals(v.map((x) => x.name), [
    "X076_ParseAmountAcceptsZero",
    "X140_ZeroWeight",
  ]);
  const first = v[0];
  if (!first) throw new Error("expected at least one test vector entry");
  assertEquals(first.id.length, 16);
  const sameTask = (await testVector(a, "CG-AL-X283"))[0];
  const otherTask = (await testVector(a, "CG-AL-X999"))[0];
  if (!sameTask || !otherTask) {
    throw new Error("expected vector entries for both re-runs");
  }
  assertEquals(first.id, sameTask.id);
  assertEquals(first.id !== otherTask.id, true);
});
