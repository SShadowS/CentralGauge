/**
 * Unit tests for the task workbench promote gate.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. Nothing here may
 * write into the real `tasks/`, `tests/al/` or `scratch/` trees, and no test
 * runs a probe or touches a container - `ProbeVerdict`s are hand-built.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { parse } from "@std/yaml";

import type { IdRoots } from "../../../src/workbench/ids.ts";
import type { ProbeVerdict } from "../../../src/workbench/probe.ts";
import { scaffoldDraft as realScaffoldDraft } from "../../../src/workbench/scaffold.ts";
import { promoteDraft } from "../../../src/workbench/promote.ts";
import { writeWorkspace } from "../../../src/workbench/workspace.ts";
import {
  cleanupTempDir,
  createTempDir,
  stubSymbolResolver,
} from "../../utils/test-helpers.ts";

/**
 * `scaffoldDraft` with the `docker inspect` seam stubbed, shadowing the real
 * import so every call site below gets it without repeating the option.
 * `promoteDraft` itself never resolves symbols (it writes `symbolPaths: []`),
 * so this only covers the scaffolding these tests do to build a fixture.
 */
const scaffoldDraft: typeof realScaffoldDraft = (opts) =>
  realScaffoldDraft({ resolveSymbols: stubSymbolResolver, ...opts });

/**
 * A verdict that clears the gate outright. `at` is set a minute into the
 * future rather than "now": the freshness check (I4) refuses a verdict
 * older than the draft's own files, and comparing against real mtimes
 * leaves no safety margin against filesystem mtime rounding - dedicated
 * staleness tests below control timestamps precisely via `Deno.utime`
 * instead of relying on this helper's timing.
 */
function passingVerdict(): ProbeVerdict {
  return {
    correct: "pass",
    naive: "fail",
    discriminates: true,
    at: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("workbench/promote", () => {
  let base: string;
  let roots: IdRoots;

  beforeEach(async () => {
    base = await createTempDir("workbench-promote-test");
    roots = {
      tasksDir: join(base, "tasks"),
      testsDir: join(base, "tests", "al"),
      scratchDir: join(base, "scratch"),
    };
  });

  afterEach(async () => {
    await cleanupTempDir(base);
  });

  describe("promoteDraft", () => {
    /**
     * Fixed id for the companion/compile-fail/freshness tests below, so
     * they can reference `${ID}.<name>.al` paths directly rather than
     * threading a dynamically-allocated id through every assertion.
     */
    const ID = "CG-AL-X001";

    /**
     * Builds `scratch/<ID>/` via the real `scaffoldDraft` (task.yml,
     * .meta.json, correct/app.json + `<ID>.Test.al`, naive/app.json), then
     * writes any named companions into `correct/` as `<ID>.<name>.al` -
     * the reserved oracle-side prefix `classifyOracleFiles` (Task 2)
     * requires for them to be picked up as companions.
     */
    async function writeDraft(opts: { companions?: string[] }): Promise<void> {
      await scaffoldDraft({ id: ID, slug: "day-close", roots });
      for (const name of opts.companions ?? []) {
        await Deno.writeTextFile(
          join(roots.scratchDir, ID, "correct", `${ID}.${name}.al`),
          `codeunit 80090 "${ID} ${name}" { }\n`,
        );
      }
      // Seeded explicitly (not relying on scaffoldDraft's own write) so the
      // rolled-back-promote test below checks promoteDraft's own behavior in
      // isolation - it must never touch this file before the move commits.
      await writeWorkspace({
        id: ID,
        slug: "day-close",
        draftDir: join(roots.scratchDir, ID),
        repoRoot: base,
        hasPrereq: false,
        testCodeunitId: 80001,
        container: "Cronus28",
        symbolPaths: [],
        state: "draft",
      });
    }

    /**
     * A discriminating verdict stamped one second into the future, so the
     * freshness gate (I4) passes against files `writeDraft` just wrote -
     * same reasoning as `passingVerdict()` above, scoped to these tests.
     */
    function freshVerdict(): ProbeVerdict {
      return {
        correct: "pass",
        naive: "fail",
        discriminates: true,
        at: new Date(Date.now() + 1_000).toISOString(),
      };
    }

    it("moves task.yml and <id>.Test.al to their final paths, rewriting expected.testApp", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict: passingVerdict(),
      });

      assertEquals(result.movedTask, `tasks/hard/${meta.id}-day-close.yml`);
      assertEquals(result.movedTest, `tests/al/hard/${meta.id}.Test.al`);
      assertEquals(result.hashChanged, true);
      assertEquals(result.forced, false);

      const taskTarget = join(
        roots.tasksDir,
        "hard",
        `${meta.id}-day-close.yml`,
      );
      const testTarget = join(roots.testsDir, "hard", `${meta.id}.Test.al`);
      assertEquals(await exists(taskTarget), true);
      assertEquals(await exists(testTarget), true);

      // The draft's task.yml is gone (it was moved, not copied); the oracle
      // is gone from correct/ too via the same move.
      assertEquals(
        await exists(join(roots.scratchDir, meta.id, "task.yml")),
        false,
      );
      assertEquals(
        await exists(
          join(roots.scratchDir, meta.id, "correct", `${meta.id}.Test.al`),
        ),
        false,
      );

      const manifest = parse(await Deno.readTextFile(taskTarget)) as {
        expected: { testApp: string };
      };
      assertEquals(
        manifest.expected.testApp,
        `tests/al/hard/${meta.id}.Test.al`,
      );
    });

    it("leaves correct/, naive/, NOTES.md and .meta.json behind as authoring history", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });

      await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict: passingVerdict(),
      });

      const draftDir = join(roots.scratchDir, meta.id);
      assertEquals(await exists(join(draftDir, "correct")), true);
      assertEquals(await exists(join(draftDir, "naive")), true);
      assertEquals(await exists(join(draftDir, "NOTES.md")), true);
      assertEquals(await exists(join(draftDir, ".meta.json")), true);
    });

    it("refuses when verdict.discriminates is false because correct/ did not pass", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "fail",
        naive: "fail",
        discriminates: false,
        at: new Date().toISOString(),
      };

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "correct/ did not pass",
      );

      assertEquals(
        await exists(join(roots.tasksDir, "hard", `${meta.id}-day-close.yml`)),
        false,
      );
    });

    it("refuses when verdict.discriminates is false because naive/ passed", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "pass",
        naive: "pass",
        discriminates: false,
        at: new Date().toISOString(),
      };

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "naive/ passed",
      );
    });

    it("refuses when correct/ is inconclusive, even though naive/ passed its side", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "inconclusive",
        naive: "fail",
        discriminates: false,
        at: new Date().toISOString(),
      };

      const error = await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "inconclusive",
      );
      // Must say "inconclusive", never "failed" - the operator needs to
      // re-run the probe, not go edit a possibly-fine task.
      assertEquals((error as Error).message.includes("failed"), false);
    });

    it("refuses when naive/ is inconclusive, even though correct/ passed its side", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "pass",
        naive: "inconclusive",
        discriminates: false,
        at: new Date().toISOString(),
      };

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "inconclusive",
      );
    });

    it("refuses when no verdict is supplied and not forced", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots }),
        Error,
        "no probe verdict",
      );
    });

    it("force: true promotes despite an inconclusive verdict, and records forced: true", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "inconclusive",
        naive: "inconclusive",
        discriminates: false,
        at: new Date().toISOString(),
      };

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict,
        force: true,
      });

      assertEquals(result.forced, true);
      assertEquals(
        await exists(join(roots.tasksDir, "hard", `${meta.id}-day-close.yml`)),
        true,
      );
    });

    it("force: true promotes despite a failed (non-discriminating) gate", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "fail",
        naive: "pass",
        discriminates: false,
        at: new Date().toISOString(),
      };

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict,
        force: true,
      });

      assertEquals(result.forced, true);
    });

    it("force: true promotes with no verdict at all", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        force: true,
      });

      assertEquals(result.forced, true);
    });

    it("refuses when the task manifest target already exists - no --force override", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      await ensureDir(join(roots.tasksDir, "hard"));
      await Deno.writeTextFile(
        join(roots.tasksDir, "hard", `${meta.id}-day-close.yml`),
        "id: placeholder\n",
      );

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
            force: true,
          }),
        Error,
        "task manifest already exists",
      );
    });

    it("refuses when the test codeunit target already exists - no --force override", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      await ensureDir(join(roots.testsDir, "hard"));
      await Deno.writeTextFile(
        join(roots.testsDir, "hard", `${meta.id}.Test.al`),
        'codeunit 1 "placeholder" { }\n',
      );

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
            force: true,
          }),
        Error,
        "test codeunit already exists",
      );
    });

    it("refuses when an unexplained prereq dir already occupies the target - no --force override", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      // This draft was NOT scaffolded with --with-prereq, so a directory
      // already sitting at its prereq slot is a conflict, not this draft's
      // own resource.
      await ensureDir(join(roots.testsDir, "dependencies", meta.id));
      await Deno.writeTextFile(
        join(roots.testsDir, "dependencies", meta.id, "app.json"),
        "{}\n",
      );

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
            force: true,
          }),
        Error,
        "prereq dir already exists",
      );
    });

    it("moves scratch/<id>/prereq/ to tests/al/dependencies/<id>/ and reports movedPrereq", async () => {
      const meta = await scaffoldDraft({
        id: "CG-AL-X053",
        slug: "poisoned-rescue",
        withPrereq: true,
        roots,
      });

      // Not yet in the committed tree - C1: scaffoldDraft only writes it
      // under scratch/.
      assertEquals(
        await exists(join(roots.testsDir, "dependencies", meta.id)),
        false,
      );

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict: passingVerdict(),
      });

      assertEquals(result.movedPrereq, `tests/al/dependencies/${meta.id}`);
      assertEquals(
        await exists(
          join(roots.testsDir, "dependencies", meta.id, "app.json"),
        ),
        true,
      );
      // Moved, not copied - nothing left behind in scratch/.
      assertEquals(
        await exists(join(roots.scratchDir, meta.id, "prereq")),
        false,
      );
    });

    it("refuses when the prereq target already exists, even for the draft's own --with-prereq app", async () => {
      const meta = await scaffoldDraft({
        id: "CG-AL-X053",
        slug: "poisoned-rescue",
        withPrereq: true,
        roots,
      });
      await ensureDir(join(roots.testsDir, "dependencies", meta.id));
      await Deno.writeTextFile(
        join(roots.testsDir, "dependencies", meta.id, "app.json"),
        "{}\n",
      );

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
            force: true,
          }),
        Error,
        "prereq dir already exists",
      );
    });

    it("refuses when .meta.json says withPrereq but scratch/<id>/prereq/ is missing", async () => {
      const meta = await scaffoldDraft({
        id: "CG-AL-X053",
        slug: "poisoned-rescue",
        withPrereq: true,
        roots,
      });
      await Deno.remove(join(roots.scratchDir, meta.id, "prereq"), {
        recursive: true,
      });

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
          }),
        Error,
        "no prereq/",
      );
    });

    it("uses the slug recorded in .meta.json when opts.slug is not given", async () => {
      const meta = await scaffoldDraft({ slug: "inner-commit", roots });

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict: passingVerdict(),
      });

      assertEquals(result.movedTask, `tasks/hard/${meta.id}-inner-commit.yml`);
    });

    it("opts.slug overrides the slug recorded in .meta.json", async () => {
      const meta = await scaffoldDraft({ slug: "inner-commit", roots });

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        slug: "renamed-slug",
        roots,
        verdict: passingVerdict(),
      });

      assertEquals(result.movedTask, `tasks/hard/${meta.id}-renamed-slug.yml`);
    });

    it("refuses when neither opts.slug nor .meta.json's slug is available", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      await Deno.remove(join(roots.scratchDir, meta.id, ".meta.json"));

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
          }),
        Error,
        "no slug given",
      );
    });

    it(
      "validates the rewritten manifest through the real parseTaskManifest " +
        "and refuses without moving anything on failure",
      async () => {
        const meta = await scaffoldDraft({ slug: "day-close", roots });
        // Corrupt the draft: drop the required `domains` key, which the
        // .strict() TaskManifestSchema requires.
        const draftYamlPath = join(roots.scratchDir, meta.id, "task.yml");
        const raw = parse(await Deno.readTextFile(draftYamlPath)) as Record<
          string,
          unknown
        >;
        delete raw["domains"];
        const { stringify } = await import("@std/yaml");
        await Deno.writeTextFile(draftYamlPath, stringify(raw));

        await assertRejects(() =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
          })
        );

        // Nothing was moved: the draft is untouched and no destination
        // file was created.
        assertEquals(await exists(draftYamlPath), true);
        assertEquals(
          await exists(
            join(roots.scratchDir, meta.id, "correct", `${meta.id}.Test.al`),
          ),
          true,
        );
        assertEquals(
          await exists(
            join(roots.tasksDir, "hard", `${meta.id}-day-close.yml`),
          ),
          false,
        );
        assertEquals(
          await exists(join(roots.testsDir, "hard", `${meta.id}.Test.al`)),
          false,
        );
      },
    );

    it("refuses with a clear message when the draft has no task.yml", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      await Deno.remove(join(roots.scratchDir, meta.id, "task.yml"));

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
          }),
        Error,
        "no task.yml",
      );
    });

    it("refuses with a clear message when the draft has no <id>.Test.al", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      // The oracle lives in correct/ (Task 5), not the draft root - this
      // refusal is now classifyOracleFiles' own (Task 2's single source of
      // truth for the oracle-side file set), reached via promoteDraft's
      // resolution of it.
      await Deno.remove(
        join(roots.scratchDir, meta.id, "correct", `${meta.id}.Test.al`),
      );

      await assertRejects(
        () =>
          promoteDraft(meta.id, {
            difficulty: "hard",
            roots,
            verdict: passingVerdict(),
          }),
        Error,
        "no oracle at correct/",
      );
    });

    it("rewrites metadata.difficulty to match --difficulty, not scaffold's hardcoded value", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });

      const result = await promoteDraft(meta.id, {
        difficulty: "easy",
        roots,
        verdict: passingVerdict(),
      });

      assertEquals(result.movedTask, `tasks/easy/${meta.id}-day-close.yml`);
      const manifest = parse(
        await Deno.readTextFile(
          join(roots.tasksDir, "easy", `${meta.id}-day-close.yml`),
        ),
      ) as { metadata: { difficulty: string } };
      assertEquals(manifest.metadata.difficulty, "easy");
    });

    it("refuses when the oracle was edited after the cached verdict (staleness)", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "pass",
        naive: "fail",
        discriminates: true,
        at: new Date().toISOString(),
      };
      // Simulate an edit landing after the probe ran, by bumping the
      // oracle's mtime forward of the verdict's timestamp.
      const testAlPath = join(
        roots.scratchDir,
        meta.id,
        "correct",
        `${meta.id}.Test.al`,
      );
      const future = new Date(Date.now() + 60_000);
      await Deno.utime(testAlPath, future, future);

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "modified after the cached probe verdict",
      );
      assertEquals(
        await exists(
          join(roots.tasksDir, "hard", `${meta.id}-day-close.yml`),
        ),
        false,
      );
    });

    it("refuses when a file under correct/ was edited after the cached verdict (staleness)", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const correctFile = join(
        roots.scratchDir,
        meta.id,
        "correct",
        "Solution.al",
      );
      await Deno.writeTextFile(correctFile, "codeunit 70001 Solution { }\n");
      const verdict: ProbeVerdict = {
        correct: "pass",
        naive: "fail",
        discriminates: true,
        at: new Date().toISOString(),
      };
      const future = new Date(Date.now() + 60_000);
      await Deno.utime(correctFile, future, future);

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "modified after the cached probe verdict",
      );
    });

    it("refuses when the prereq was edited after the cached verdict (staleness)", async () => {
      // prereq/ is promoted into tests/al/dependencies/<id>/, which IS in the
      // task-set hash scope. An edit landing after a green probe therefore
      // changes both what compiles against the oracle and what the benchmark
      // hashes, while the verdict still claims discrimination was proven.
      const meta = await scaffoldDraft({
        id: "CG-AL-X053",
        slug: "day-close",
        withPrereq: true,
        roots,
      });
      const prereqAppJson = join(
        roots.scratchDir,
        meta.id,
        "prereq",
        "app.json",
      );
      const verdict: ProbeVerdict = {
        correct: "pass",
        naive: "fail",
        discriminates: true,
        at: new Date().toISOString(),
      };
      const future = new Date(Date.now() + 60_000);
      await Deno.utime(prereqAppJson, future, future);

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "modified after the cached probe verdict",
      );
      // Nothing moved - the prereq is still where the draft left it.
      assertEquals(
        await exists(join(roots.testsDir, "dependencies", meta.id)),
        false,
      );
    });

    it("refuses when a .al file under prereq/ was edited after the cached verdict", async () => {
      const meta = await scaffoldDraft({
        id: "CG-AL-X053",
        slug: "day-close",
        withPrereq: true,
        roots,
      });
      const prereqAl = join(
        roots.scratchDir,
        meta.id,
        "prereq",
        "CGDayCloseLog.Table.al",
      );
      await Deno.writeTextFile(prereqAl, 'table 69001 "CG Day Close Log" { }');
      const verdict: ProbeVerdict = {
        correct: "pass",
        naive: "fail",
        discriminates: true,
        at: new Date().toISOString(),
      };
      const future = new Date(Date.now() + 60_000);
      await Deno.utime(prereqAl, future, future);

      await assertRejects(
        () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
        Error,
        "modified after the cached probe verdict",
      );
    });

    it("does not trip prereq freshness on editor state under prereq/", async () => {
      // The dot-segment and extension filters must apply to prereq/ exactly
      // as they do to correct//naive/ - otherwise adding prereq/ to the walk
      // would force a spurious multi-minute re-probe after every AL Test
      // Runner session.
      const meta = await scaffoldDraft({
        id: "CG-AL-X053",
        slug: "day-close",
        withPrereq: true,
        roots,
      });
      const cached = join(
        roots.scratchDir,
        meta.id,
        "prereq",
        ".alpackages",
        "Cached.al",
      );
      await ensureDir(join(roots.scratchDir, meta.id, "prereq", ".alpackages"));
      await Deno.writeTextFile(cached, "// cached symbol shadow\n");
      const future = new Date(Date.now() + 60_000);
      await Deno.utime(cached, future, future);

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict: {
          correct: "pass",
          naive: "fail",
          discriminates: true,
          at: new Date().toISOString(),
        },
      });
      assertEquals(result.movedPrereq, `tests/al/dependencies/${meta.id}`);
    });

    it("does not refuse when the verdict postdates every draft file", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const verdict: ProbeVerdict = {
        correct: "pass",
        naive: "fail",
        discriminates: true,
        at: new Date(Date.now() + 60_000).toISOString(),
      };

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict,
      });

      assertEquals(result.hashChanged, true);
    });

    it(
      "fails CLOSED on an unreadable verdict timestamp, even with a " +
        "stale oracle it could otherwise have caught",
      async () => {
        const meta = await scaffoldDraft({ slug: "day-close", roots });
        // The oracle is genuinely 10 minutes newer than "now" - if the
        // unparseable-timestamp path silently skipped the freshness gate
        // (fail-open), this would promote anyway.
        const testAlPath = join(
          roots.scratchDir,
          meta.id,
          "correct",
          `${meta.id}.Test.al`,
        );
        const future = new Date(Date.now() + 10 * 60_000);
        await Deno.utime(testAlPath, future, future);
        const verdict: ProbeVerdict = {
          correct: "pass",
          naive: "fail",
          discriminates: true,
          at: "not-a-date",
        };

        await assertRejects(
          () => promoteDraft(meta.id, { difficulty: "hard", roots, verdict }),
          Error,
          "unreadable timestamp",
        );
        assertEquals(
          await exists(
            join(roots.tasksDir, "hard", `${meta.id}-day-close.yml`),
          ),
          false,
        );
      },
    );

    it("force: true bypasses the staleness check along with the rest of the gate", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const testAlPath = join(
        roots.scratchDir,
        meta.id,
        "correct",
        `${meta.id}.Test.al`,
      );
      const future = new Date(Date.now() + 60_000);
      await Deno.utime(testAlPath, future, future);
      const stale: ProbeVerdict = {
        correct: "pass",
        naive: "fail",
        discriminates: true,
        at: new Date().toISOString(),
      };

      const result = await promoteDraft(meta.id, {
        difficulty: "hard",
        roots,
        verdict: stale,
        force: true,
      });

      assertEquals(result.forced, true);
    });

    it(
      "refuses to re-promote a shipped id under a different --difficulty " +
        "(cross-difficulty id collision)",
      async () => {
        // A scratch draft, and only THEN the shipped manifest claiming the
        // same id under a new slug - scaffoldDraft refuses an id already in
        // the tree, so this ordering is the only way to reach the state
        // promoteDraft's cross-difficulty check exists for (a task shipped
        // after the draft was cut). The path-based checks alone would miss
        // it: medium/ is a different destination folder than hard/.
        const meta = await scaffoldDraft({
          id: "CG-AL-X001",
          slug: "second-attempt",
          roots,
        });

        await ensureDir(join(roots.tasksDir, "hard"));
        await Deno.writeTextFile(
          join(roots.tasksDir, "hard", "CG-AL-X001-day-close.yml"),
          "id: CG-AL-X001\n",
        );

        await assertRejects(
          () =>
            promoteDraft(meta.id, {
              difficulty: "medium",
              roots,
              verdict: passingVerdict(),
            }),
          Error,
          "already exists somewhere under",
        );

        assertEquals(
          await exists(
            join(roots.tasksDir, "medium", `${meta.id}-second-attempt.yml`),
          ),
          false,
        );
      },
    );

    it(
      "refuses to re-promote when a test codeunit for this id already " +
        "exists under a different --difficulty",
      async () => {
        // Draft first, shipped test codeunit second - see the sibling test
        // above for why the ordering matters.
        const meta = await scaffoldDraft({
          id: "CG-AL-X001",
          slug: "second-attempt",
          roots,
        });

        await ensureDir(join(roots.testsDir, "hard"));
        await Deno.writeTextFile(
          join(roots.testsDir, "hard", "CG-AL-X001.Test.al"),
          'codeunit 1 "placeholder" { }\n',
        );

        await assertRejects(
          () =>
            promoteDraft(meta.id, {
              difficulty: "medium",
              roots,
              verdict: passingVerdict(),
            }),
          Error,
          "already exists somewhere under",
        );
      },
    );

    it(
      "rolls back the task write when the test-file move fails partway " +
        "through (no half-promotion)",
      async () => {
        const meta = await scaffoldDraft({ slug: "day-close", roots });
        const originalRename = Deno.rename;
        Object.defineProperty(Deno, "rename", {
          value: () => {
            throw new Deno.errors.AlreadyExists("simulated: dest appeared");
          },
          configurable: true,
        });

        try {
          await assertRejects(
            () =>
              promoteDraft(meta.id, {
                difficulty: "hard",
                roots,
                verdict: passingVerdict(),
              }),
            Error,
            "rolled back",
          );
        } finally {
          Object.defineProperty(Deno, "rename", {
            value: originalRename,
            configurable: true,
          });
        }

        // Not half-promoted: neither destination exists, and both draft
        // files are still in scratch/.
        assertEquals(
          await exists(
            join(roots.tasksDir, "hard", `${meta.id}-day-close.yml`),
          ),
          false,
        );
        assertEquals(
          await exists(join(roots.testsDir, "hard", `${meta.id}.Test.al`)),
          false,
        );
        assertEquals(
          await exists(join(roots.scratchDir, meta.id, "task.yml")),
          true,
        );
        assertEquals(
          await exists(
            join(roots.scratchDir, meta.id, "correct", `${meta.id}.Test.al`),
          ),
          true,
        );
      },
    );

    it(
      "rolls back the task write AND the test-file move when the prereq " +
        "move fails partway through (no half-promotion)",
      async () => {
        const meta = await scaffoldDraft({
          id: "CG-AL-X053",
          slug: "poisoned-rescue",
          withPrereq: true,
          roots,
        });

        const originalRename = Deno.rename;
        let callCount = 0;
        Object.defineProperty(Deno, "rename", {
          value: async (src: string | URL, dest: string | URL) => {
            callCount++;
            // Let the first rename (the test-file move) succeed for real;
            // fail the second (the prereq move) to simulate a failure
            // after part of the move already landed.
            if (callCount === 2) {
              throw new Deno.errors.AlreadyExists("simulated: dest appeared");
            }
            return await originalRename(src, dest);
          },
          configurable: true,
        });

        try {
          await assertRejects(
            () =>
              promoteDraft(meta.id, {
                difficulty: "hard",
                roots,
                verdict: passingVerdict(),
              }),
            Error,
            "rolled back",
          );
        } finally {
          Object.defineProperty(Deno, "rename", {
            value: originalRename,
            configurable: true,
          });
        }

        // Nothing half-promoted: no destination exists, and the task
        // file, test file, and prereq app.json are all back in scratch/.
        assertEquals(
          await exists(
            join(roots.tasksDir, "hard", `${meta.id}-poisoned-rescue.yml`),
          ),
          false,
        );
        assertEquals(
          await exists(join(roots.testsDir, "hard", `${meta.id}.Test.al`)),
          false,
        );
        assertEquals(
          await exists(
            join(roots.testsDir, "dependencies", meta.id, "app.json"),
          ),
          false,
        );
        assertEquals(
          await exists(join(roots.scratchDir, meta.id, "task.yml")),
          true,
        );
        assertEquals(
          await exists(
            join(roots.scratchDir, meta.id, "correct", `${meta.id}.Test.al`),
          ),
          true,
        );
        assertEquals(
          await exists(
            join(roots.scratchDir, meta.id, "prereq", "app.json"),
          ),
          true,
        );
      },
    );

    it(
      "surfaces the ORIGINAL move failure, not a rollback failure, when " +
        "rollback itself also fails (M2)",
      async () => {
        const meta = await scaffoldDraft({ slug: "day-close", roots });
        const originalRename = Deno.rename;
        const originalRemove = Deno.remove;
        Object.defineProperty(Deno, "rename", {
          value: () => {
            throw new Error("ORIGINAL: simulated test-file move failure");
          },
          configurable: true,
        });
        Object.defineProperty(Deno, "remove", {
          value: () => {
            throw new Error("SECONDARY: simulated rollback remove failure");
          },
          configurable: true,
        });

        try {
          const error = await assertRejects(
            () =>
              promoteDraft(meta.id, {
                difficulty: "hard",
                roots,
                verdict: passingVerdict(),
              }),
            Error,
          );
          const message = (error as Error).message;
          // The original failure must be present and not replaced by the
          // rollback's own failure - an operator debugging this needs to
          // know what actually went wrong first.
          assertEquals(
            message.includes("ORIGINAL: simulated test-file move failure"),
            true,
          );
          assertEquals(message.includes("ROLLBACK ALSO FAILED"), true);
          assertEquals(
            message.includes(
              "SECONDARY: simulated rollback remove failure",
            ),
            true,
          );
        } finally {
          Object.defineProperty(Deno, "rename", {
            value: originalRename,
            configurable: true,
          });
          Object.defineProperty(Deno, "remove", {
            value: originalRemove,
            configurable: true,
          });
        }
      },
    );

    it("moves companion mocks alongside the oracle", async () => {
      await writeDraft({ companions: ["MockThing", "Spy"] });
      const result = await promoteDraft(ID, {
        difficulty: "hard",
        roots,
        verdict: freshVerdict(),
      });

      assertEquals(result.movedCompanions.sort(), [
        `tests/al/hard/${ID}.MockThing.al`,
        `tests/al/hard/${ID}.Spy.al`,
      ]);
      assertEquals(
        await exists(join(roots.testsDir, "hard", `${ID}.MockThing.al`)),
        true,
      );
      assertEquals(
        await exists(join(roots.scratchDir, ID, "correct", `${ID}.Spy.al`)),
        false,
      );
    });

    it("rolls the whole move back when one companion's target exists", async () => {
      await writeDraft({ companions: ["MockThing", "Spy"] });
      await ensureDir(join(roots.testsDir, "hard"));
      await Deno.writeTextFile(
        join(roots.testsDir, "hard", `${ID}.Spy.al`),
        'codeunit 80090 "Existing" { }',
      );

      await assertRejects(() =>
        promoteDraft(ID, { difficulty: "hard", roots, verdict: freshVerdict() })
      );

      // Nothing partially moved, nothing removed from the draft.
      assertEquals(
        await exists(join(roots.testsDir, "hard", `${ID}.MockThing.al`)),
        false,
      );
      assertEquals(
        await exists(join(roots.testsDir, "hard", `${ID}.Test.al`)),
        false,
      );
      assertEquals(
        await exists(
          join(roots.scratchDir, ID, "correct", `${ID}.MockThing.al`),
        ),
        true,
      );
      assertEquals(await exists(join(roots.scratchDir, ID, "task.yml")), true);
    });

    it("refuses a compile_fail verdict", async () => {
      await writeDraft({});
      const error = await assertRejects(() =>
        promoteDraft(ID, {
          difficulty: "hard",
          roots,
          verdict: {
            correct: "pass",
            naive: "compile_fail",
            discriminates: false,
            at: new Date().toISOString(),
          },
        })
      );
      assertStringIncludes((error as Error).message, "compile");
    });

    it("accepts a compile_fail verdict carrying allowCompileFail", async () => {
      await writeDraft({});
      const result = await promoteDraft(ID, {
        difficulty: "hard",
        roots,
        verdict: {
          correct: "pass",
          naive: "compile_fail",
          discriminates: true,
          allowCompileFail: true,
          at: new Date().toISOString(),
        },
      });
      assertEquals(result.movedTest, `tests/al/hard/${ID}.Test.al`);
    });

    it("does not trip freshness on an editor-state write", async () => {
      await writeDraft({});
      const verdict = freshVerdict();
      // Simulate the AL Test Runner extension writing into the project.
      await ensureDir(join(roots.scratchDir, ID, "correct", ".altestrunner"));
      await Deno.writeTextFile(
        join(roots.scratchDir, ID, "correct", ".altestrunner", "config.json"),
        "{}",
      );

      const result = await promoteDraft(ID, {
        difficulty: "hard",
        roots,
        verdict,
      });
      assertEquals(result.hashChanged, true);
    });

    it(
      "ignores an .al file inside a dot-directory, isolating the dot-skip " +
        "from the extension filter",
      async () => {
        await writeDraft({});
        // Unlike the editor-state test above (config.json - already
        // excluded by the .al/app.json extension filter on its own), this
        // file ends in .al. Only the dot-directory skip can exclude it, so
        // this is the test that actually fails if that line is removed -
        // see the RED/GREEN trace in the task-9 report.
        const dotDirFile = join(
          roots.scratchDir,
          ID,
          "correct",
          ".alpackages",
          "Cached.al",
        );
        await ensureDir(
          join(roots.scratchDir, ID, "correct", ".alpackages"),
        );
        await Deno.writeTextFile(dotDirFile, "// cached symbol shadow\n");
        // Stamped newer than the verdict below (Deno.utime, same technique
        // as the staleness tests above) - if the dot-skip did not exclude
        // it, this mtime alone would trip the freshness refusal.
        const future = new Date(Date.now() + 60_000);
        await Deno.utime(dotDirFile, future, future);

        const verdict: ProbeVerdict = {
          correct: "pass",
          naive: "fail",
          discriminates: true,
          at: new Date().toISOString(),
        };

        const result = await promoteDraft(ID, {
          difficulty: "hard",
          roots,
          verdict,
        });
        assertEquals(result.hashChanged, true);
      },
    );

    it(
      "reports a post-commit workspace-write failure instead of throwing",
      async () => {
        // Deno.remove(task.yml) and writeWorkspace() run AFTER the rollback
        // window closes. Throwing there would report failure for a promotion
        // that fully succeeded, and the operator's retry would then hit
        // refuseIfExists on work already done - unrecoverable without hand
        // surgery. Force the failure by parking a DIRECTORY where
        // CHECKLIST.md must be written.
        await writeDraft({});
        const checklistPath = join(roots.scratchDir, ID, "CHECKLIST.md");
        await Deno.remove(checklistPath); // scaffoldDraft wrote it as a file
        await ensureDir(checklistPath);

        const result = await promoteDraft(ID, {
          difficulty: "hard",
          roots,
          verdict: freshVerdict(),
        });

        // The promotion itself is reported as the success it is...
        assertEquals(result.movedTask, `tasks/hard/${ID}-day-close.yml`);
        assertEquals(
          await exists(join(roots.testsDir, "hard", `${ID}.Test.al`)),
          true,
        );
        // ...and the tidy-up failure is surfaced, not swallowed.
        assertEquals(result.postCommitWarnings?.length, 1);
        assertStringIncludes(
          result.postCommitWarnings?.[0] ?? "",
          "the promotion itself succeeded",
        );
      },
    );

    it("omits postCommitWarnings entirely on a clean promotion", async () => {
      await writeDraft({});
      const result = await promoteDraft(ID, {
        difficulty: "hard",
        roots,
        verdict: freshVerdict(),
      });
      assertEquals(result.postCommitWarnings, undefined);
    });

    it("rewrites the workspace to the promoted paths", async () => {
      await writeDraft({});
      await promoteDraft(ID, {
        difficulty: "hard",
        roots,
        verdict: freshVerdict(),
      });
      const ws = JSON.parse(
        await Deno.readTextFile(
          join(roots.scratchDir, ID, `${ID}.code-workspace`),
        ),
      ) as { folders: Array<{ path: string }> };
      assertEquals(
        ws.folders.some((f) => f.path.includes("tests/al/hard")),
        true,
      );
      assertEquals(ws.folders.some((f) => f.path === "correct"), false);
    });

    it("leaves the workspace pointing at the draft on a rolled-back promote", async () => {
      await writeDraft({ companions: ["Spy"] });
      await ensureDir(join(roots.testsDir, "hard"));
      await Deno.writeTextFile(
        join(roots.testsDir, "hard", `${ID}.Spy.al`),
        'codeunit 80090 "Existing" { }',
      );
      await assertRejects(() =>
        promoteDraft(ID, { difficulty: "hard", roots, verdict: freshVerdict() })
      );
      const ws = JSON.parse(
        await Deno.readTextFile(
          join(roots.scratchDir, ID, `${ID}.code-workspace`),
        ),
      ) as { folders: Array<{ path: string }> };
      assertEquals(ws.folders.some((f) => f.path === "correct"), true);
    });
  });
});
