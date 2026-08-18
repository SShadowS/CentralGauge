import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { basename } from "@std/path";

import type { DraftSummary } from "../../../src/dashboard/drafts.ts";
import {
  runQuick,
  writeRunArtifact,
} from "../../../src/dashboard/run-manager.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const CORRECT = `codeunit 71410 "A"
{
    procedure P()
    begin
        Q.Validate(Qty, 1);
    end;
}`;
const NAIVE = `codeunit 71410 "A"
{
    procedure P()
    begin
        Q.Qty := 1;
    end;
}`;

describe("dashboard/run-manager", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await createTempDir("dashboard-run-test");
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  const draft: DraftSummary = {
    id: "CG-AL-X054",
    dir: "",
    dirName: "CG-AL-X054",
    description: "Write a codeunit that validates quantity.",
    hasPrereq: false,
    prereqFiles: [],
  };

  /**
   * Stands in for the real `templates/code-gen.md` so these tests assert the
   * PLUMBING (which values reach the renderer, and that its output reaches
   * the model) without also re-pinning the bench's prompt text — that is the
   * golden-string test in `tests/unit/llm/prompt-building.test.ts`.
   */
  const renderer = {
    render: (name: string, ctx: Record<string, unknown>) =>
      Promise.resolve(
        `[${name}] ${ctx["task_id"]}/${ctx["max_attempts"]}: ${
          ctx["description"]
        }`,
      ),
  };

  it("collects one response per model and classifies each", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["anthropic/correct", "anthropic/naive"],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model) =>
        Promise.resolve({
          content: `BEGIN-CODE\n${
            model === "anthropic/naive" ? NAIVE : CORRECT
          }\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });

    assertEquals(run.responses.length, 2);
    assertEquals(
      run.responses.find((r) => r.model === "anthropic/naive")?.classification
        .verdict,
      "made-the-mistake",
    );
    assertEquals(
      run.responses.find((r) => r.model === "anthropic/correct")?.classification
        .verdict,
      "avoided-the-mistake",
    );
  });

  it("records a per-model failure without failing the run", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["anthropic/ok", "anthropic/boom"],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model) =>
        model === "anthropic/boom"
          ? Promise.reject(new Error("model unavailable"))
          : Promise.resolve({
            content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
            finishReason: "stop" as const,
          }),
    });

    assertEquals(run.responses.length, 2);
    assertStringIncludes(
      run.responses.find((r) => r.model === "anthropic/boom")?.error ?? "",
      "model unavailable",
    );
  });

  // ParsedAl.hasError was destructured away, so an unparseable candidate was
  // indistinguishable from one that wrote no objects and the matrix reported
  // "not written" for every row. An ordinary prose-wrapped answer reaches
  // this: the extractor returns the whole response at confidence 0.7, which
  // IS ready for compile, and the parse then fails on the prose.
  it("records that a resolved candidate failed to parse", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["anthropic/prose", "anthropic/clean"],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model) =>
        Promise.resolve({
          content: model === "anthropic/prose"
            ? `Here is the codeunit you asked for:\n\n${CORRECT}\n\nLet me know if you want changes.`
            : `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });

    const prose = run.responses.find((r) => r.model === "anthropic/prose");
    assertEquals(prose?.resolution.isReadyForCompile, true);
    assertEquals(prose?.hasParseError, true);
    assertEquals(prose?.objects.length, 0);

    const clean = run.responses.find((r) => r.model === "anthropic/clean");
    assertEquals(clean?.hasParseError, false);
    assertEquals((clean?.objects.length ?? 0) > 0, true);
  });

  // The signature was derived and then thrown away, so the UI could not show
  // emptyReason even if it wanted to — and "Couldn't compare yet" with no
  // reason is the only state a half-written draft can reach.
  it("returns the trap signature the run was judged against", async () => {
    const withTrap = await runQuick({
      draft: { ...draft, dir },
      models: [],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: () => Promise.reject(new Error("unused")),
    });
    assertEquals(withTrap.signature.sites.length > 0, true);
    assertEquals(withTrap.signature.emptyReason, undefined);

    const withoutNaive = await runQuick({
      draft: { ...draft, dir },
      models: [],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [],
      call: () => Promise.reject(new Error("unused")),
    });
    assertEquals(withoutNaive.signature.sites.length, 0);
    assertEquals(withoutNaive.signature.emptyReason, "no-naive-objects");
  });

  it("classifies as cannot-compare when there is no naive source", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["anthropic/m"],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [],
      call: () =>
        Promise.resolve({
          content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });
    assertEquals(run.responses[0]?.classification.verdict, "cannot-compare");
  });

  it("writes the artifact under .runs/ and not as a bench results file", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["anthropic/m"],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: () =>
        Promise.resolve({
          content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });

    const path = await writeRunArtifact(dir, run);
    assertEquals(path.replaceAll("\\", "/").includes("/.runs/"), true);
    assertEquals(path.includes("benchmark-results-"), false);
    // The colon an unsanitized toISOString() would leave behind is illegal in
    // a Windows filename; assert on the basename so the drive letter's colon
    // in an absolute path does not mask it.
    assertEquals(basename(path).includes(":"), false);

    const parsed = JSON.parse(await Deno.readTextFile(path));
    assertEquals("results" in parsed, false);
    assertEquals(parsed.draftId, "CG-AL-X054");
    // The trap travels with the run, so a saved artifact can be read back
    // and understood without re-deriving anything.
    assertEquals(Array.isArray(parsed.signature.sites), true);
  });

  // The defect this replaced: app.js posted {draftId, models}, server.ts
  // defaulted the absent `prompt` to "", and every model was asked the empty
  // string. There is now no way to supply one — the question comes from the
  // draft's task.yml, rendered through the bench's own attempt-1 path.
  it("asks each model the draft's own description, not a caller-supplied prompt", async () => {
    const seen: Array<{ model: string; prompt: string }> = [];
    const run = await runQuick({
      draft: {
        ...draft,
        dir,
        description: "Write a codeunit that validates quantity.",
        maxAttempts: 2,
      },
      models: ["anthropic/opus", "openai/gpt"],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model, request) => {
        seen.push({ model, prompt: request.prompt });
        return Promise.resolve({
          content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        });
      },
    });

    const expected =
      "[code-gen.md] CG-AL-X054/2: Write a codeunit that validates quantity.";
    assertEquals(seen.length, 2);
    for (const call of seen) {
      assertEquals(call.prompt, expected);
    }
    // Also recorded on the response, so the artifact and the UI can show the
    // author exactly what was asked.
    for (const response of run.responses) {
      assertEquals(response.prompt, expected);
    }
  });

  // A long-lived TemplateRenderer caches template text per instance, so a
  // module-level one read templates/code-gen.md once per process while the
  // bench re-reads it every run. An author editing the template and seeing
  // the dashboard keep showing the old prompt would be badly misled by the
  // one thing this tool claims: prompt fidelity.
  //
  // No `renderer` is passed here, so the real fallback runs, which resolves
  // the template directory relative to the process cwd exactly as the bench
  // does. `Deno.chdir` is safe because this repo forbids `--parallel`, so
  // test files run sequentially; the cwd is restored in `finally`.
  it("re-reads the template between runs rather than caching it for the process", async () => {
    const cwd = Deno.cwd();
    const home = await createTempDir("dashboard-template-reread");
    try {
      await Deno.mkdir(`${home}/templates`, { recursive: true });
      const template = `${home}/templates/code-gen.md`;
      await Deno.writeTextFile(template, "V1: {{description}}");
      Deno.chdir(home);

      const first = await runQuick({
        draft: { ...draft, dir },
        models: ["anthropic/m"],
        correctSources: [CORRECT],
        naiveSources: [NAIVE],
        call: () =>
          Promise.resolve({
            content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
            finishReason: "stop" as const,
          }),
      });
      assertEquals(
        first.responses[0]?.prompt,
        "V1: Write a codeunit that validates quantity.",
      );

      await Deno.writeTextFile(template, "V2: {{description}}");

      const second = await runQuick({
        draft: { ...draft, dir },
        models: ["anthropic/m"],
        correctSources: [CORRECT],
        naiveSources: [NAIVE],
        call: () =>
          Promise.resolve({
            content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
            finishReason: "stop" as const,
          }),
      });
      assertEquals(
        second.responses[0]?.prompt,
        "V2: Write a codeunit that validates quantity.",
      );
    } finally {
      Deno.chdir(cwd);
      await cleanupTempDir(home);
    }
  });

  // Prompt injections are provider-scoped in the bench
  // (PromptInjectionResolver.resolve takes a provider), so the prompt is
  // rendered per model rather than once per run. Rendering it once would send
  // one model the other's prompt.
  it("resolves task.yml prompt injections against each model's own provider", async () => {
    const seen = new Map<string, { prompt: string; systemPrompt?: string }>();
    await runQuick({
      draft: {
        ...draft,
        dir,
        prompts: {
          injections: {
            anthropic: { generation: { prefix: "ANTHROPIC-", system: "SYS" } },
          },
        },
      },
      models: ["anthropic/opus", "openai/gpt"],
      renderer: { render: () => Promise.resolve("BASE") },
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model, request) => {
        seen.set(model, {
          prompt: request.prompt,
          ...(request.systemPrompt !== undefined
            ? { systemPrompt: request.systemPrompt }
            : {}),
        });
        return Promise.resolve({
          content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        });
      },
    });

    assertEquals(seen.get("anthropic/opus")?.prompt, "ANTHROPIC-BASE");
    assertEquals(seen.get("anthropic/opus")?.systemPrompt, "SYS");
    assertEquals(seen.get("openai/gpt")?.prompt, "BASE");
    assertEquals(seen.get("openai/gpt")?.systemPrompt, undefined);
  });

  // A slug with no vendor prefix cannot name a provider, so it cannot resolve
  // injections either. That failure belongs to one column, not the run.
  it("records a render failure as that model's error without failing the run", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["no-vendor-prefix", "anthropic/opus"],
      renderer,
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: () =>
        Promise.resolve({
          content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });

    const bad = run.responses.find((r) => r.model === "no-vendor-prefix");
    assertStringIncludes(bad?.error ?? "", "vendor-prefixed");
    assertEquals(bad?.prompt, "");
    assertEquals(
      run.responses.find((r) => r.model === "anthropic/opus")?.classification
        .verdict,
      "avoided-the-mistake",
    );
  });

  it("refuses a draftId that would escape the draft directory", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: [],
      renderer,
      correctSources: [],
      naiveSources: [],
      call: () => Promise.reject(new Error("unused")),
    });
    await assertRejects(() =>
      writeRunArtifact(dir, { ...run, draftId: "../../escaped" })
    );
  });
});
