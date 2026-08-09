/**
 * Unit tests for the task workbench discrimination probe.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. No test may spawn
 * `trap-probe` or touch a container - every probe run here goes through a
 * stub `ProbeRunner` injected via `opts.runner`, and the workspace refresh's
 * `docker inspect` goes through a stub `SymbolPathResolver` injected via
 * `opts.resolveSymbols` by the local wrapper below.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import type {
  ProbeRunner,
  ProbeVerdict,
} from "../../../src/workbench/probe.ts";
import {
  probeDraft as realProbeDraft,
  resolveDraftSlugForWorkspace,
} from "../../../src/workbench/probe.ts";
import { OracleFileError } from "../../../src/workbench/oracle-files.ts";
import { renderWorkspace } from "../../../src/workbench/workspace.ts";
import {
  cleanupTempDir,
  createTempDir,
  stubSymbolResolver,
} from "../../utils/test-helpers.ts";

/**
 * `probeDraft` with the `docker inspect` seam stubbed, shadowing the real
 * import so every call site below gets it without repeating the option. An
 * explicit `resolveSymbols` in `opts` still wins.
 */
const probeDraft: typeof realProbeDraft = (id, opts) =>
  realProbeDraft(id, { resolveSymbols: stubSymbolResolver, ...opts });

/**
 * Maps exit codes onto the recorded run for a solution directory whose path
 * contains "correct" or "naive" - `probeDraft` always probes those two
 * literal directory names, so branching on the `--solution` arg is enough to
 * tell the two calls apart without any other bookkeeping.
 */
function stubRunner(codes: { correct: number; naive: number }): ProbeRunner {
  return (args: string[]): Promise<number> => {
    const solutionIdx = args.indexOf("--solution");
    const solutionDir = args[solutionIdx + 1] ?? "";
    const code = solutionDir.includes("naive") ? codes.naive : codes.correct;
    return Promise.resolve(code);
  };
}

/** Records every call's full args array, always returning 0 (matched). */
function recordingRunner(calls: string[][]): ProbeRunner {
  return (args: string[]): Promise<number> => {
    calls.push(args);
    return Promise.resolve(0);
  };
}

/** Value of `--<flag>` in a recorded call, or undefined when absent. */
function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

describe("workbench/probe", () => {
  let base: string;
  let scratchDir: string;
  let draftDir: string;
  const id = "CG-AL-X053";

  beforeEach(async () => {
    base = await createTempDir("workbench-probe-test");
    scratchDir = join(base, "scratch");
    draftDir = join(scratchDir, id);
    await ensureDir(join(draftDir, "correct"));
    await ensureDir(join(draftDir, "naive"));
    // The oracle a real draft carries, now inside correct/ (Task 5). probeDraft
    // refuses without it, and every assertion below about --test-file keys off
    // this path.
    await Deno.writeTextFile(
      join(draftDir, "correct", `${id}.Test.al`),
      `codeunit 80053 "${id} Test"\n{\n    Subtype = Test;\n}\n`,
    );
  });

  afterEach(async () => {
    await cleanupTempDir(base);
  });

  describe("probeDraft", () => {
    it("correct passes (0) and naive fails (0) -> discriminates", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 0, naive: 0 }),
      });

      assertEquals(verdict.correct, "pass");
      assertEquals(verdict.naive, "fail");
      assertEquals(verdict.discriminates, true);
    });

    it("correct mismatched (1) -> correct fails, does not discriminate", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 1, naive: 0 }),
      });

      assertEquals(verdict.correct, "fail");
      assertEquals(verdict.discriminates, false);
    });

    it("naive mismatched (1) -> naive actually passed, does not discriminate", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 0, naive: 1 }),
      });

      assertEquals(verdict.naive, "pass");
      assertEquals(verdict.discriminates, false);
    });

    it("correct inconclusive (3) -> that side is inconclusive, does not discriminate", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 3, naive: 0 }),
      });

      assertEquals(verdict.correct, "inconclusive");
      assertEquals(verdict.naive, "fail");
      assertEquals(verdict.discriminates, false);
    });

    it("naive inconclusive (3) -> that side is inconclusive, does not discriminate", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 0, naive: 3 }),
      });

      assertEquals(verdict.correct, "pass");
      assertEquals(verdict.naive, "inconclusive");
      assertEquals(verdict.discriminates, false);
    });

    it("both inconclusive (3) -> neither side discriminates", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 3, naive: 3 }),
      });

      assertEquals(verdict.correct, "inconclusive");
      assertEquals(verdict.naive, "inconclusive");
      assertEquals(verdict.discriminates, false);
    });

    it("records a compile-earned naive fail as compile_fail, not fail", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 0, naive: 4 }),
      });
      assertEquals(verdict.naive, "compile_fail");
      assertEquals(verdict.discriminates, false);
    });

    it("passes --strict-fail-mode on the naive run only", async () => {
      const seen: string[][] = [];
      const runner: ProbeRunner = (args) => {
        seen.push(args);
        return Promise.resolve(0);
      };
      await probeDraft(id, { scratchDir, runner });

      const naiveArgs = seen.find((a) =>
        (a[a.indexOf("--solution") + 1] ?? "").includes("naive")
      );
      const correctArgs = seen.find((a) =>
        (a[a.indexOf("--solution") + 1] ?? "").includes("correct")
      );
      assertEquals(naiveArgs?.includes("--strict-fail-mode"), true);
      assertEquals(correctArgs?.includes("--strict-fail-mode"), false);
    });

    it("treats compile_fail as discriminating under allowCompileFail", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        allowCompileFail: true,
        runner: stubRunner({ correct: 0, naive: 4 }),
      });
      assertEquals(verdict.discriminates, true);
      assertEquals(verdict.allowCompileFail, true);
    });

    it("persists allowCompileFail into .probe.json", async () => {
      await probeDraft(id, {
        scratchDir,
        allowCompileFail: true,
        runner: stubRunner({ correct: 0, naive: 4 }),
      });
      const saved = JSON.parse(
        await Deno.readTextFile(join(scratchDir, id, ".probe.json")),
      ) as ProbeVerdict;
      assertEquals(saved.allowCompileFail, true);
    });

    it("writes scratch/<id>/.probe.json with the verdict", async () => {
      const verdict = await probeDraft(id, {
        scratchDir,
        runner: stubRunner({ correct: 0, naive: 0 }),
      });

      const probeJsonPath = join(scratchDir, id, ".probe.json");
      assertEquals(await exists(probeJsonPath), true);

      const written = JSON.parse(
        await Deno.readTextFile(probeJsonPath),
      ) as ProbeVerdict;
      assertEquals(written, verdict);
      // `at` must be a real, parseable timestamp.
      assertEquals(Number.isNaN(Date.parse(written.at)), false);
    });

    it("throws naming correct/ when it is missing", async () => {
      await Deno.remove(join(scratchDir, id, "correct"), { recursive: true });

      await assertRejects(
        () =>
          probeDraft(id, {
            scratchDir,
            runner: stubRunner({ correct: 0, naive: 0 }),
          }),
        Error,
        "correct/",
      );
    });

    it("throws naming naive/ when it is missing", async () => {
      await Deno.remove(join(scratchDir, id, "naive"), { recursive: true });

      await assertRejects(
        () =>
          probeDraft(id, {
            scratchDir,
            runner: stubRunner({ correct: 0, naive: 0 }),
          }),
        Error,
        "naive/",
      );
    });

    it("does not invoke the runner at all when correct/ is missing", async () => {
      await Deno.remove(join(scratchDir, id, "correct"), { recursive: true });
      const calls: string[][] = [];

      await assertRejects(() =>
        probeDraft(id, { scratchDir, runner: recordingRunner(calls) })
      );

      assertEquals(calls.length, 0);
    });

    it(
      "invokes correct/ with --expect pass and naive/ with --expect fail " +
        "(the exact mapping the exit-code inversion bug would get backwards)",
      async () => {
        const calls: string[][] = [];
        await probeDraft(id, {
          scratchDir,
          runner: recordingRunner(calls),
        });

        assertEquals(calls.length, 2);
        const correctCall = calls.find((a) =>
          (a[a.indexOf("--solution") + 1] ?? "").includes("correct")
        );
        const naiveCall = calls.find((a) =>
          (a[a.indexOf("--solution") + 1] ?? "").includes("naive")
        );

        assertEquals(
          correctCall?.[correctCall.indexOf("--expect") + 1],
          "pass",
        );
        assertEquals(naiveCall?.[naiveCall.indexOf("--expect") + 1], "fail");

        for (const call of calls) {
          assertEquals(call[call.indexOf("--task") + 1], id);
          assertEquals(
            call[call.indexOf("--container") + 1],
            "Cronus28",
            "defaults to Cronus28 - the only container with credentials wired",
          );
        }
      },
    );

    it("forwards an explicit container override to both calls", async () => {
      const calls: string[][] = [];
      await probeDraft(id, {
        scratchDir,
        container: "Cronus281",
        runner: recordingRunner(calls),
      });

      for (const call of calls) {
        assertEquals(call[call.indexOf("--container") + 1], "Cronus281");
      }
    });

    it(
      "probes the draft's own oracle by path, never by committed task id",
      async () => {
        // THE regression this file exists to pin. Resolving the oracle from
        // the task id looks for tests/al/<difficulty>/<id>.Test.al, which a
        // draft has not got - trap-probe then returns "Test file not found",
        // which classifies as a real "fail" on BOTH sides. Every scaffolded
        // draft scored {correct: fail, naive: fail} and could only be
        // promoted with --force, i.e. with no discrimination gate at all.
        const calls: string[][] = [];
        await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

        assertEquals(calls.length, 2);
        for (const call of calls) {
          assertEquals(
            flag(call, "--test-file"),
            join(draftDir, "correct", `${id}.Test.al`),
          );
        }
      },
    );

    it("passes the codeunit id from task.yml's expected block", async () => {
      // Preferred over .meta.json because it is the field the bench itself
      // reads (loadTestCodeunitId in mcp/al-tools-server.ts) once promoted,
      // and the file the operator actually edits.
      await Deno.writeTextFile(
        join(draftDir, "task.yml"),
        `id: ${id}\nexpected:\n  testCodeunitId: 80099\n`,
      );
      await Deno.writeTextFile(
        join(draftDir, ".meta.json"),
        JSON.stringify({ id, slug: "day-close", testCodeunitId: 80053 }),
      );

      const calls: string[][] = [];
      await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

      for (const call of calls) {
        assertEquals(flag(call, "--test-codeunit-id"), "80099");
      }
    });

    it("falls back to .meta.json when task.yml has no usable codeunit id", async () => {
      await Deno.writeTextFile(join(draftDir, "task.yml"), "id: not-yaml: [\n");
      await Deno.writeTextFile(
        join(draftDir, ".meta.json"),
        JSON.stringify({ id, slug: "day-close", testCodeunitId: 80053 }),
      );

      const calls: string[][] = [];
      await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

      for (const call of calls) {
        assertEquals(flag(call, "--test-codeunit-id"), "80053");
      }
    });

    it("omits --test-codeunit-id when neither file yields one", async () => {
      const calls: string[][] = [];
      await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

      for (const call of calls) {
        assertEquals(flag(call, "--test-codeunit-id"), undefined);
      }
    });

    it("passes --prereq-dir for a draft scaffolded with one", async () => {
      // A --with-prereq draft keeps its prereq at scratch/<id>/prereq/ until
      // promote moves it; without this the correct/ solution cannot compile
      // against it and the probe reports a failure that is not real.
      await ensureDir(join(draftDir, "prereq"));
      await Deno.writeTextFile(
        join(draftDir, "prereq", "app.json"),
        JSON.stringify({ id: "a1b2c3d4-0a53-0000-0000-000000000001" }),
      );

      const calls: string[][] = [];
      await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

      for (const call of calls) {
        assertEquals(flag(call, "--prereq-dir"), join(draftDir, "prereq"));
      }
    });

    it("omits --prereq-dir when the draft has none", async () => {
      const calls: string[][] = [];
      await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

      for (const call of calls) {
        assertEquals(flag(call, "--prereq-dir"), undefined);
      }
    });

    it("passes --stage-symbols-dir <draftDir>/.symbols on both invocations for a prereq draft", async () => {
      // Both sides compile the prereq independently, so staging from either
      // is valid - the flag just needs to be on both. Task 11 depends on
      // this staging actually working for the AL extension to resolve
      // symbols, so it must be verified, not just wired.
      await ensureDir(join(draftDir, "prereq"));
      await Deno.writeTextFile(
        join(draftDir, "prereq", "app.json"),
        JSON.stringify({ id: "a1b2c3d4-0a53-0000-0000-000000000001" }),
      );

      const calls: string[][] = [];
      await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

      assertEquals(calls.length, 2);
      for (const call of calls) {
        assertEquals(
          flag(call, "--stage-symbols-dir"),
          join(draftDir, ".symbols"),
        );
      }
    });

    it("omits --stage-symbols-dir entirely for a draft with no prereq", async () => {
      const calls: string[][] = [];
      await probeDraft(id, { scratchDir, runner: recordingRunner(calls) });

      assertEquals(calls.length, 2);
      for (const call of calls) {
        assertEquals(call.includes("--stage-symbols-dir"), false);
        assertEquals(flag(call, "--stage-symbols-dir"), undefined);
      }
    });

    it("throws naming the oracle when <id>.Test.al is missing", async () => {
      await Deno.remove(join(draftDir, "correct", `${id}.Test.al`));

      await assertRejects(
        () =>
          probeDraft(id, {
            scratchDir,
            runner: stubRunner({ correct: 0, naive: 0 }),
          }),
        Error,
        `${id}.Test.al`,
      );
    });

    it("does not invoke the runner at all when the oracle is missing", async () => {
      await Deno.remove(join(draftDir, "correct", `${id}.Test.al`));
      const calls: string[][] = [];

      await assertRejects(() =>
        probeDraft(id, { scratchDir, runner: recordingRunner(calls) })
      );

      assertEquals(calls.length, 0);
    });

    it("probes the oracle inside correct/", async () => {
      const seen: string[][] = [];
      const runner: ProbeRunner = (args) => {
        seen.push(args);
        return Promise.resolve(0);
      };
      await probeDraft(id, { scratchDir, runner });

      for (const args of seen) {
        const testFile = args[args.indexOf("--test-file") + 1] ?? "";
        assertStringIncludes(testFile, join("correct", `${id}.Test.al`));
      }
    });

    it("refuses a bare <id>.al without invoking the runner", async () => {
      await Deno.writeTextFile(
        join(scratchDir, id, "correct", `${id}.al`),
        'codeunit 70001 "X" { }',
      );
      let called = false;
      const runner: ProbeRunner = () => {
        called = true;
        return Promise.resolve(0);
      };
      await assertRejects(
        () => probeDraft(id, { scratchDir, runner }),
        OracleFileError,
      );
      assertEquals(called, false);
    });

    it("refuses an <id>.*.al in naive/ without invoking the runner", async () => {
      await Deno.writeTextFile(
        join(scratchDir, id, "naive", `${id}.Mock.al`),
        'codeunit 88806 "X" { }',
      );
      let called = false;
      const runner: ProbeRunner = () => {
        called = true;
        return Promise.resolve(0);
      };
      await assertRejects(
        () => probeDraft(id, { scratchDir, runner }),
        OracleFileError,
      );
      assertEquals(called, false);
    });

    it(
      "refreshes the workspace with the probe's actual container and " +
        "codeunit id before running",
      async () => {
        // A real codeunit id must resolve or the refresh is skipped
        // entirely - see the "leaves a pre-existing workspace untouched"
        // test below for that path.
        await Deno.writeTextFile(
          join(draftDir, "task.yml"),
          `id: ${id}\nexpected:\n  testCodeunitId: 80099\n`,
        );
        await Deno.writeTextFile(
          join(draftDir, ".meta.json"),
          JSON.stringify({
            id,
            slug: "poisoned-rescue",
            testCodeunitId: 80053,
          }),
        );
        // A stale pre-existing workspace, so a genuine rewrite (not just
        // "the file already existed") is what makes this test pass.
        await Deno.writeTextFile(
          join(draftDir, `${id}.code-workspace`),
          JSON.stringify({ folders: [{ path: ".", name: "STALE" }] }),
        );

        await probeDraft(id, {
          scratchDir,
          container: "Cronus281",
          runner: stubRunner({ correct: 0, naive: 0 }),
        });

        const raw = await Deno.readTextFile(
          join(draftDir, `${id}.code-workspace`),
        );
        const ws = JSON.parse(raw) as {
          folders: Array<{ path: string; name: string }>;
          settings: Record<string, unknown>;
          tasks: { tasks: Array<{ label: string; command: string }> };
        };

        assertEquals(ws.folders.some((f) => f.name === "STALE"), false);
        assertEquals(
          ws.folders.some((f) => f.name === `${id} (draft)`),
          true,
        );

        const correctOnly = ws.tasks.tasks.find((t) =>
          t.label === "probe: correct only"
        );
        assertStringIncludes(
          correctOnly?.command ?? "",
          "--container Cronus281",
        );
        assertStringIncludes(
          correctOnly?.command ?? "",
          "--test-codeunit-id 80099",
        );

        // Symbol paths: this test does not assert a specific value. Whatever
        // the injected resolver produced (read back from the file itself)
        // must round-trip through the same pure renderWorkspace the
        // production code uses - proving the write is a genuine fresh
        // render of the probe's real inputs, not a stale or guessed value.
        // That holds for the stub's `[]` exactly as it would for a real
        // resolution, which is why the seam does not weaken the assertion.
        const resolvedSymbolPaths =
          (ws.settings["al.packageCachePath"] as string[] | undefined) ?? [];
        const expected = renderWorkspace({
          id,
          slug: "poisoned-rescue",
          draftDir,
          repoRoot: Deno.cwd(),
          hasPrereq: false,
          testCodeunitId: 80099,
          container: "Cronus281",
          symbolPaths: resolvedSymbolPaths,
          state: "draft",
        });
        assertEquals(raw, expected);
      },
    );

    it(
      "leaves a pre-existing workspace and checklist untouched when no " +
        "codeunit id resolves (the refresh is skipped, not defaulted)",
      async () => {
        // beforeEach never writes task.yml/.meta.json for this id, so
        // resolveDraftTestCodeunitId returns undefined and the refresh
        // block never runs - this is the documented degrade: an author
        // keeps whatever workspace/checklist they already had, stale
        // symbol path included, rather than getting a freshly-but-wrongly
        // shaped one.
        await Deno.writeTextFile(
          join(draftDir, `${id}.code-workspace`),
          "STALE-WORKSPACE-MARKER",
        );
        await Deno.writeTextFile(
          join(draftDir, "CHECKLIST.md"),
          "STALE-CHECKLIST-MARKER",
        );

        await probeDraft(id, {
          scratchDir,
          runner: stubRunner({ correct: 0, naive: 0 }),
        });

        assertEquals(
          await Deno.readTextFile(join(draftDir, `${id}.code-workspace`)),
          "STALE-WORKSPACE-MARKER",
        );
        assertEquals(
          await Deno.readTextFile(join(draftDir, "CHECKLIST.md")),
          "STALE-CHECKLIST-MARKER",
        );
      },
    );
  });

  describe("resolveDraftSlugForWorkspace", () => {
    it("returns the slug from .meta.json when present", async () => {
      await Deno.writeTextFile(
        join(draftDir, ".meta.json"),
        JSON.stringify({ id, slug: "poisoned-rescue", testCodeunitId: 80053 }),
      );
      assertEquals(
        await resolveDraftSlugForWorkspace(draftDir, id),
        "poisoned-rescue",
      );
    });

    it("falls back to id when .meta.json is missing", async () => {
      // beforeEach never writes .meta.json for this id.
      assertEquals(await resolveDraftSlugForWorkspace(draftDir, id), id);
    });

    it("falls back to id when .meta.json has no usable slug", async () => {
      await Deno.writeTextFile(
        join(draftDir, ".meta.json"),
        JSON.stringify({ id, slug: "", testCodeunitId: 80053 }),
      );
      assertEquals(await resolveDraftSlugForWorkspace(draftDir, id), id);
    });

    it("falls back to id when .meta.json is unparseable", async () => {
      await Deno.writeTextFile(join(draftDir, ".meta.json"), "not-json: [");
      assertEquals(await resolveDraftSlugForWorkspace(draftDir, id), id);
    });
  });
});
