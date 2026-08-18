import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { basename } from "@std/path";

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

  const draft = {
    id: "CG-AL-X054",
    dir: "",
    dirName: "CG-AL-X054",
    hasPrereq: false,
    prereqFiles: [],
  };

  it("collects one response per model and classifies each", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["m-correct", "m-naive"],
      prompt: "p",
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model) =>
        Promise.resolve({
          content: `BEGIN-CODE\n${
            model === "m-naive" ? NAIVE : CORRECT
          }\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });

    assertEquals(run.responses.length, 2);
    assertEquals(
      run.responses.find((r) => r.model === "m-naive")?.classification.verdict,
      "made-the-mistake",
    );
    assertEquals(
      run.responses.find((r) => r.model === "m-correct")?.classification
        .verdict,
      "avoided-the-mistake",
    );
  });

  it("records a per-model failure without failing the run", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["ok", "boom"],
      prompt: "p",
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model) =>
        model === "boom"
          ? Promise.reject(new Error("model unavailable"))
          : Promise.resolve({
            content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
            finishReason: "stop" as const,
          }),
    });

    assertEquals(run.responses.length, 2);
    assertStringIncludes(
      run.responses.find((r) => r.model === "boom")?.error ?? "",
      "model unavailable",
    );
  });

  it("classifies as cannot-compare when there is no naive source", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["m"],
      prompt: "p",
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
      models: ["m"],
      prompt: "p",
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
  });

  it("refuses a draftId that would escape the draft directory", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: [],
      prompt: "p",
      correctSources: [],
      naiveSources: [],
      call: () => Promise.reject(new Error("unused")),
    });
    await assertRejects(() =>
      writeRunArtifact(dir, { ...run, draftId: "../../escaped" })
    );
  });
});
