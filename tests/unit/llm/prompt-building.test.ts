import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

import {
  buildFixPrompt,
  buildGenerationPrompt,
  DEFAULT_PROMPT_TEMPLATE,
  FIX_PROMPT_PREVIOUS_CODE_CAP,
} from "../../../src/llm/prompt-building.ts";
import { TemplateRenderer } from "../../../src/templates/renderer.ts";

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

  // The retry must show the WHOLE previous submission. A 4000-character cap
  // was fine for single-object code-gen tasks and silently crippled every
  // multi-object diagnose retry: the model saw one or two objects of a 20+
  // object app and invented the rest (2026-09-01: 18 of 22 Fable 5.1 second
  // attempts died on AL0185 references to tables it could no longer see).
  it("shows a whole multi-object application on retry, untruncated", () => {
    const app = Array.from(
      { length: 80 },
      (_, i) => `table ${71000 + i} "CG X${i} Thing" { fields { field(1; "No."; Code[20]) { } } }`,
    ).join("\n\n");
    assertEquals(app.length > 4000, true);
    const p = buildFixPrompt({ ...base, previousCode: app });
    assertStringIncludes(p, 'table 71079 "CG X79 Thing"');
    assertEquals(p.includes("... (truncated)"), false);
  });

  it("truncates only past the safety cap", () => {
    const atCap = buildFixPrompt({
      ...base,
      previousCode: "x".repeat(FIX_PROMPT_PREVIOUS_CODE_CAP),
    });
    assertEquals(atCap.includes("... (truncated)"), false);
    const overCap = buildFixPrompt({
      ...base,
      previousCode: "x".repeat(FIX_PROMPT_PREVIOUS_CODE_CAP + 1),
    });
    assertStringIncludes(overCap, "... (truncated)");
    assertEquals(
      overCap.includes("x".repeat(FIX_PROMPT_PREVIOUS_CODE_CAP + 1)),
      false,
    );
  });

  it("restates the changed-objects return rule under that contract", () => {
    const p = buildFixPrompt({ ...base, contract: "changed-objects" });
    assertStringIncludes(p, "only the objects you changed");
    assertStringIncludes(p, "kept exactly as they are in your previous submission");
    assertEquals(p.includes("COMPLETE corrected AL code"), false);
  });

  it("keeps the full-app wording by default", () => {
    const p = buildFixPrompt(base);
    assertStringIncludes(p, "COMPLETE corrected AL code (not a diff)");
    assertEquals(p.includes("only the objects you changed"), false);
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

describe("llm/prompt-building buildGenerationPrompt", () => {
  // The real bench template directory, resolved from this file rather than
  // from the process cwd so the golden assertion below reads the same
  // `templates/code-gen.md` the bench renders regardless of where the suite
  // was started.
  const renderer = new TemplateRenderer(
    fromFileUrl(new URL("../../../templates/", import.meta.url)),
  );

  const base = {
    renderer,
    description: "Create a codeunit that posts a sales order.",
    taskId: "CG-AL-X054",
    maxAttempts: 2,
    provider: "anthropic",
  };

  // GOLDEN STRING. This pins the attempt-1 prompt the BENCH sends, captured
  // from the pre-extraction inline pipeline in `LLMWorkPool.buildRequest`
  // (TemplateRenderer.render("code-gen.md", {description, task_id,
  // max_attempts}) then PromptInjectionResolver.resolveAndApply) before that
  // code moved into `buildGenerationPrompt`. Brittleness is the FEATURE, per
  // the Task 3 ruling on `buildFixPrompt`: an intentional prompt change must
  // require a deliberate test update, because it changes what every
  // benchmarked model is asked.
  it("renders the bench's attempt-1 prompt exactly", async () => {
    const applied = await buildGenerationPrompt(base);
    const expected = `You are a Business Central AL expert developer.

## Task

Create a codeunit that posts a sales order.

## Rules

1. Output code only inside BEGIN-CODE/END-CODE fences
2. Use proper AL syntax and Business Central conventions
3. Include all necessary object declarations and dependencies
4. Follow Microsoft naming conventions for AL objects
5. Ensure code compiles without errors
6. Do NOT reference objects that don't exist (pages, codeunits, reports, etc.) unless explicitly required by the task
7. Only create the objects specifically requested - do not add extra objects "for completeness"
8. Output ONLY AL code - no explanations, no markdown formatting, no commentary

## Context

- Target Business Central version: 24.0 or later
- Use modern AL syntax and features
- Include proper error handling where applicable

BEGIN-CODE
// Your AL code here
END-CODE
`;
    assertEquals(applied.prompt, expected);
    assertEquals(applied.systemPrompt, undefined);
  });

  it("defaults a missing prompt_template to code-gen.md", async () => {
    const withUndefined = await buildGenerationPrompt(base);
    const withEmpty = await buildGenerationPrompt({
      ...base,
      promptTemplate: "",
    });
    const explicit = await buildGenerationPrompt({
      ...base,
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    });
    assertEquals(DEFAULT_PROMPT_TEMPLATE, "code-gen.md");
    // `||`, not `??` — an empty string falls back too, exactly as the pool did.
    assertEquals(withEmpty.prompt, explicit.prompt);
    assertEquals(withUndefined.prompt, explicit.prompt);
  });

  it("substitutes task_id and max_attempts as well as description", async () => {
    const applied = await buildGenerationPrompt({
      ...base,
      renderer: {
        render: (name: string, ctx: Record<string, unknown>) =>
          Promise.resolve(
            `${name}|${ctx["task_id"]}|${ctx["max_attempts"]}|${
              ctx["description"]
            }`,
          ),
      },
    });
    assertEquals(
      applied.prompt,
      "code-gen.md|CG-AL-X054|2|Create a codeunit that posts a sales order.",
    );
  });

  it("applies task-level prompt injections for the generation stage", async () => {
    const applied = await buildGenerationPrompt({
      ...base,
      renderer: { render: () => Promise.resolve("BASE") },
      taskPrompts: {
        injections: {
          default: {
            generation: { prefix: "PRE\n", suffix: "\nPOST", system: "SYS" },
          },
        },
      },
    });
    assertEquals(applied.prompt, "PRE\nBASE\nPOST");
    assertEquals(applied.systemPrompt, "SYS");
  });

  // THE load-bearing property of this function, and the reason the dashboard
  // renders per model rather than once per run. Every other injection fixture
  // here uses the `default` key, which any provider matches — so hardcoding
  // `opts.provider` to a constant would leave them all green. This one is
  // scoped to `anthropic` only, so it fails unless the caller's provider is
  // the value actually forwarded to PromptInjectionResolver.
  it("forwards the caller's provider, so provider-scoped injections do not leak", async () => {
    const taskPrompts = {
      injections: {
        anthropic: {
          generation: { prefix: "ANTHROPIC-ONLY ", system: "ANTHROPIC-SYS" },
        },
      },
    };
    const render = { render: () => Promise.resolve("BASE") };

    const forAnthropic = await buildGenerationPrompt({
      ...base,
      renderer: render,
      taskPrompts,
      provider: "anthropic",
    });
    assertEquals(forAnthropic.prompt, "ANTHROPIC-ONLY BASE");
    assertEquals(forAnthropic.systemPrompt, "ANTHROPIC-SYS");

    for (const provider of ["openai", "gemini", "openrouter", "mock"]) {
      const other = await buildGenerationPrompt({
        ...base,
        renderer: render,
        taskPrompts,
        provider,
      });
      assertEquals(other.prompt, "BASE", provider);
      assertEquals(other.systemPrompt, undefined, provider);
    }
  });

  // The pool renders the GENERATION template but resolves FIX-stage
  // injections when attemptNumber > 1 with no previous attempt recorded
  // (`item.attemptNumber === 1 || !previousAttempt` vs `stage`). The stage is
  // therefore a parameter rather than hardcoded, so that quirk survives the
  // extraction instead of being silently normalised.
  it("resolves injections for the stage it is given", async () => {
    const taskPrompts = {
      injections: { default: { fix: { prefix: "FIX-" } } },
    };
    const asGeneration = await buildGenerationPrompt({
      ...base,
      renderer: { render: () => Promise.resolve("BASE") },
      taskPrompts,
    });
    const asFix = await buildGenerationPrompt({
      ...base,
      renderer: { render: () => Promise.resolve("BASE") },
      taskPrompts,
      stage: "fix",
    });
    assertEquals(asGeneration.prompt, "BASE");
    assertEquals(asFix.prompt, "FIX-BASE");
  });

  it("renders starter code between BEGIN-APP/END-APP and the description under ## The problem", async () => {
    const applied = await buildGenerationPrompt({
      ...base,
      promptTemplate: "diagnose.md",
      description: "The codeunit throws when Amount is negative.",
      starterCode: 'codeunit 50100 "Buggy" { }',
    });
    assertStringIncludes(
      applied.prompt,
      'BEGIN-APP\ncodeunit 50100 "Buggy" { }\nEND-APP',
    );
    assertStringIncludes(
      applied.prompt,
      "## The problem\n\nThe codeunit throws when Amount is negative.",
    );
  });

  it("throws when the diagnose template still needs starter code after render", async () => {
    await assertRejects(
      () =>
        buildGenerationPrompt({
          ...base,
          promptTemplate: "diagnose.md",
          description: "The codeunit throws when Amount is negative.",
        }),
      Error,
      `prompt template requires starter code but none was found for ${base.taskId}`,
    );
  });
});
