import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";

import { buildFixPrompt } from "../../../src/llm/prompt-building.ts";

describe("llm/prompt-building", () => {
  const base = {
    attemptNumber: 2,
    originalInstructions: "Write codeunit 71410.",
    previousCode: 'codeunit 71410 "X" { }',
    errorSnippet: "AL0132: unknown field",
  };

  it("frames the request in BEGIN-CODE and forbids a diff", () => {
    const p = buildFixPrompt(base);
    assertStringIncludes(p, "BEGIN-CODE");
    assertStringIncludes(p, "END-CODE");
    assertStringIncludes(p, "not a diff");
  });

  it("names the previous attempt number", () => {
    assertStringIncludes(buildFixPrompt(base), "attempt 1");
  });

  it("includes the instructions, previous code and errors", () => {
    const p = buildFixPrompt(base);
    assertStringIncludes(p, "Write codeunit 71410.");
    assertStringIncludes(p, 'codeunit 71410 "X" { }');
    assertStringIncludes(p, "AL0132: unknown field");
  });

  it("truncates previous code at 4000 characters", () => {
    const p = buildFixPrompt({ ...base, previousCode: "x".repeat(5000) });
    assertStringIncludes(p, "... (truncated)");
    assertEquals(p.includes("x".repeat(4001)), false);
  });

  it("does not truncate previous code at exactly 4000", () => {
    const p = buildFixPrompt({ ...base, previousCode: "x".repeat(4000) });
    assertEquals(p.includes("... (truncated)"), false);
  });
});
