/**
 * Unit tests for the task workbench discrimination probe.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. No test may spawn
 * `trap-probe` or touch a container - every probe run here goes through a
 * stub `ProbeRunner` injected via `opts.runner`.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import type {
  ProbeRunner,
  ProbeVerdict,
} from "../../../src/workbench/probe.ts";
import { probeDraft } from "../../../src/workbench/probe.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

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

describe("workbench/probe", () => {
  let base: string;
  let scratchDir: string;
  const id = "CG-AL-X053";

  beforeEach(async () => {
    base = await createTempDir("workbench-probe-test");
    scratchDir = join(base, "scratch");
    await ensureDir(join(scratchDir, id, "correct"));
    await ensureDir(join(scratchDir, id, "naive"));
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
  });
});
