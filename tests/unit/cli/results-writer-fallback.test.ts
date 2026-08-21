import { assertEquals } from "@std/assert";
import { collectFallbackEvents } from "../../../cli/commands/bench/results-writer.ts";

Deno.test("collectFallbackEvents", async (t) => {
  await t.step("empty when no attempt has fallback data", () => {
    const events = collectFallbackEvents([{
      model: "anthropic/claude-fable-5",
      results: [{
        taskId: "CG-AL-X001",
        attempts: [{ attemptNumber: 1, llmResponse: {} }],
      }],
    }]);
    assertEquals(events, []);
  });

  await t.step("captures recovered fallback and chain refusal", () => {
    const events = collectFallbackEvents([{
      model: "anthropic/claude-fable-5",
      results: [{
        taskId: "CG-AL-X063",
        attempts: [
          {
            attemptNumber: 1,
            llmResponse: { refusal: { category: "cyber", recovered: false } },
          },
          {
            attemptNumber: 2,
            llmResponse: {
              servedModel: "claude-opus-4-8",
              refusal: { category: null, recovered: true },
            },
          },
        ],
      }],
    }]);
    assertEquals(events, [
      {
        model: "anthropic/claude-fable-5",
        taskId: "CG-AL-X063",
        attempt: 1,
        served: null,
        category: "cyber",
        recovered: false,
      },
      {
        model: "anthropic/claude-fable-5",
        taskId: "CG-AL-X063",
        attempt: 2,
        served: "claude-opus-4-8",
        category: null,
        recovered: true,
      },
    ]);
  });
});
