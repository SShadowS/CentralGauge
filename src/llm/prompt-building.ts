/**
 * Prompt construction for LLM fix attempts.
 *
 * The authoring dashboard and benchmark both render fix prompts from this module.
 * An author calibrates a task against the prompt the benchmark actually sends,
 * so the prompt text and truncation behavior must be identical.
 */

export function buildFixPrompt(opts: {
  attemptNumber: number;
  originalInstructions: string;
  previousCode: string;
  errors: string[];
}): string {
  const truncatedCode = opts.previousCode.length > 4000
    ? opts.previousCode.substring(0, 4000) + "\n... (truncated)"
    : opts.previousCode;
  const errorSnippet = opts.errors.slice(0, 20).join("\n");

  return `Your previous submission (attempt ${
    opts.attemptNumber - 1
  }) failed to compile or pass tests.

## Original Task
${opts.originalInstructions}

## Your Previous Code
\`\`\`al
${truncatedCode}
\`\`\`

## Compilation/Test Errors
${errorSnippet}

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
}
