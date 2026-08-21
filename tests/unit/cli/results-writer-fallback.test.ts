import { assertEquals } from "@std/assert";
import {
  collectFallbackEvents,
  renderFallbackBlock,
} from "../../../cli/commands/bench/results-writer.ts";

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

Deno.test("renderFallbackBlock", async (t) => {
  await t.step("empty on no events", () => {
    assertEquals(renderFallbackBlock([]), []);
  });

  await t.step("summarizes per event with recovery split", () => {
    const lines = renderFallbackBlock([
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
        taskId: "CG-AL-X055",
        attempt: 1,
        served: "claude-opus-4-8",
        category: null,
        recovered: true,
      },
    ]);
    assertEquals(lines[0], "# Fallbacks");
    assertEquals(
      lines.some((l) => l.includes("total_refusal_events: 2")),
      true,
    );
    assertEquals(
      lines.some((l) => l.includes("recovered_via_fallback: 1")),
      true,
    );
    assertEquals(lines.some((l) => l.includes("chain_refusals: 1")), true);
    assertEquals(
      lines.some((l) => l.includes("CG-AL-X055 a1: served=claude-opus-4-8")),
      true,
    );
    assertEquals(
      lines.some((l) => l.includes("CG-AL-X063 a1: REFUSED category=cyber")),
      true,
    );
  });
});
