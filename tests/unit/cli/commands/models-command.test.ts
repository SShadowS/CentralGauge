/**
 * Unit tests for models-command display helpers.
 */

import { assertEquals } from "@std/assert";
import { formatDiscoveredMeta } from "../../../../cli/commands/models-command.ts";

Deno.test("formatDiscoveredMeta", async (t) => {
  await t.step("formats token limits + capability flags", () => {
    const line = formatDiscoveredMeta({
      id: "claude-opus-4-8",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 128_000,
      capabilities: {
        thinking: true,
        imageInput: true,
        pdfInput: true,
        structuredOutputs: true,
        batch: true,
      },
    });
    assertEquals(
      line,
      "1M ctx / 128k out  [thinking, image, pdf, structured, batch]",
    );
  });

  await t.step("omits capabilities that are false", () => {
    const line = formatDiscoveredMeta({
      id: "text-only",
      maxInputTokens: 200_000,
      capabilities: { functionCalling: false, imageInput: false },
    });
    assertEquals(line, "200k ctx / ? out");
  });

  await t.step("uses 1 decimal for non-integer millions", () => {
    const line = formatDiscoveredMeta({
      id: "x",
      maxInputTokens: 1_048_576,
      maxOutputTokens: 65_536,
    });
    assertEquals(line, "1.0M ctx / 66k out");
  });

  await t.step("returns null when no metadata present", () => {
    assertEquals(formatDiscoveredMeta({ id: "bare" }), null);
  });
});
