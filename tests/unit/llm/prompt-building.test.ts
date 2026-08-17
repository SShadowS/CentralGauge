import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";

import { buildFixPrompt } from "../../../src/llm/prompt-building.ts";

describe("llm/prompt-building", () => {
  const base = {
    attemptNumber: 2,
    originalInstructions: "Write codeunit 71410.",
    previousCode: 'codeunit 71410 "X" { }',
    errors: ["AL0132: unknown field"],
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

  it("caps error list at 20 errors", () => {
    const manyErrors = Array.from({ length: 25 }, (_, i) => `error ${i + 1}`);
    const p = buildFixPrompt({ ...base, errors: manyErrors });
    // Check that errors 1-20 are present
    assertStringIncludes(p, "error 1");
    assertStringIncludes(p, "error 20");
    // Check that errors 21-25 are not present
    assertEquals(p.includes("error 21"), false);
    assertEquals(p.includes("error 25"), false);
  });

  it("renders the complete prompt exactly", () => {
    const p = buildFixPrompt(base);
    const expected =
      `Your previous submission (attempt 1) failed to compile or pass tests.

## Original Task
Write codeunit 71410.

## Your Previous Code
\`\`\`al
codeunit 71410 "X" { }
\`\`\`

## Compilation/Test Errors
AL0132: unknown field

## Instructions
1. Analyze the compilation errors or test failures above
2. Fix the issues in your code
3. Provide the COMPLETE corrected AL code (not a diff)
4. Ensure the fix addresses the root cause
5. Do NOT add references to objects that don't exist (pages, codeunits, etc.) unless they are part of the task
6. Output ONLY the corrected code inside the BEGIN-CODE/END-CODE fences below - no explanations, no markdown, no commentary

BEGIN-CODE
// Your corrected AL code here
END-CODE`;
    assertEquals(p, expected);
  });
});
