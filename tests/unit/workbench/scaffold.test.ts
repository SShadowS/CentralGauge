/**
 * Unit tests for task workbench draft scaffolding.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. Nothing here may
 * read or write the real `tasks/`, `tests/al/` or `scratch/` trees, and
 * nothing may reach a container - `scaffoldDraft`'s `docker inspect` seam is
 * stubbed for every call by the local wrapper below.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertNotMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import type { IdRoots } from "../../../src/workbench/ids.ts";
import type { DraftMeta } from "../../../src/workbench/scaffold.ts";
import { scaffoldDraft as realScaffoldDraft } from "../../../src/workbench/scaffold.ts";
import { parseTaskManifest } from "../../../src/tasks/interfaces.ts";
import {
  cleanupTempDir,
  createTempDir,
  stubSymbolResolver,
} from "../../utils/test-helpers.ts";

/**
 * `scaffoldDraft` with the `docker inspect` seam stubbed, shadowing the real
 * import so every call site below gets it without repeating the option. An
 * explicit `resolveSymbols` in `opts` still wins.
 */
const scaffoldDraft: typeof realScaffoldDraft = (opts) =>
  realScaffoldDraft({ resolveSymbols: stubSymbolResolver, ...opts });

describe("workbench/scaffold", () => {
  let base: string;
  let roots: IdRoots;

  beforeEach(async () => {
    base = await createTempDir("workbench-scaffold-test");
    roots = {
      tasksDir: join(base, "tasks"),
      testsDir: join(base, "tests", "al"),
      scratchDir: join(base, "scratch"),
    };
  });

  afterEach(async () => {
    await cleanupTempDir(base);
  });

  describe("scaffoldDraft", () => {
    it("creates the full draft tree on an empty root", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);

      assertEquals(await exists(join(draftDir, "task.yml")), true);
      assertEquals(
        await exists(join(draftDir, "correct", `${meta.id}.Test.al`)),
        true,
      );
      assertEquals(await exists(join(draftDir, "correct")), true);
      assertEquals(await exists(join(draftDir, "naive")), true);
      assertEquals(await exists(join(draftDir, "NOTES.md")), true);
      assertEquals(await exists(join(draftDir, ".meta.json")), true);
    });

    it("writes the oracle into correct/, not the draft root", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);

      assertEquals(
        await exists(join(draftDir, "correct", `${meta.id}.Test.al`)),
        true,
      );
      assertEquals(await exists(join(draftDir, `${meta.id}.Test.al`)), false);
    });

    it("writes the workspace file and checklist", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      assertEquals(
        await exists(join(draftDir, `${meta.id}.code-workspace`)),
        true,
      );
      assertEquals(await exists(join(draftDir, "CHECKLIST.md")), true);
    });

    it("writes an app.json into both solution directories", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);

      for (const side of ["correct", "naive"]) {
        const raw = await Deno.readTextFile(join(draftDir, side, "app.json"));
        const appJson = JSON.parse(raw) as {
          idRanges: Array<{ from: number; to: number }>;
          dependencies: Array<{ name: string }>;
          id: string;
        };

        const covers = (n: number) =>
          appJson.idRanges.some((r) => r.from <= n && r.to >= n);
        assertEquals(covers(70001), true, `${side}: generated-code range`);
        assertEquals(covers(80001), true, `${side}: test-codeunit range`);
        assertEquals(
          appJson.dependencies.some((d) => d.name === "Library Assert"),
          true,
          `${side}: Library Assert dependency`,
        );
      }
    });

    it("gives correct/ and naive/ different app ids", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const read = async (side: string) =>
        (JSON.parse(
          await Deno.readTextFile(join(draftDir, side, "app.json")),
        ) as { id: string }).id;

      const correctId = await read("correct");
      const naiveId = await read("naive");
      assertNotEquals(correctId, naiveId);
      // Both must be syntactically valid GUIDs - an invalid one fails to compile.
      const guid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      assertMatch(correctId, guid);
      assertMatch(naiveId, guid);
    });

    it("declares the prereq dependency only when --with-prereq", async () => {
      const withPrereq = await scaffoldDraft({
        slug: "with-dep",
        withPrereq: true,
        roots,
      });
      const withDir = join(roots.scratchDir, withPrereq.id);
      const prereqAppJson = JSON.parse(
        await Deno.readTextFile(join(withDir, "prereq", "app.json")),
      ) as { id: string };
      const correctAppJson = JSON.parse(
        await Deno.readTextFile(join(withDir, "correct", "app.json")),
      ) as { dependencies: Array<{ id: string }> };
      assertEquals(
        correctAppJson.dependencies.some((d) => d.id === prereqAppJson.id),
        true,
      );

      const without = await scaffoldDraft({ slug: "no-dep", roots });
      const withoutAppJson = JSON.parse(
        await Deno.readTextFile(
          join(roots.scratchDir, without.id, "correct", "app.json"),
        ),
      ) as { dependencies: Array<{ id: string }> };
      assertEquals(
        withoutAppJson.dependencies.some((d) => d.id.includes("0a")),
        false,
      );
    });

    it("returns the allocated id and test codeunit id", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });

      assertEquals(meta.id, "CG-AL-X001");
      assertEquals(meta.testCodeunitId, 80001);
      assertEquals(meta.slug, "day-close");
      assertEquals(meta.withPrereq, false);
    });

    it("renders a task.yml that parses through the real parseTaskManifest", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const raw = await Deno.readTextFile(join(draftDir, "task.yml"));

      // Import path matters here: parseTaskManifest's TaskManifestSchema is
      // .strict(), so a missing required key OR a stray key both throw.
      // Re-parsing the raw YAML text (not a hand-built object) proves the
      // rendered file itself is valid, not just the in-memory shape.
      const { parse } = await import("@std/yaml");
      const manifest = parseTaskManifest(
        parse(raw),
        join(draftDir, "task.yml"),
      );

      assertEquals(manifest.id, meta.id);
    });

    it("sets expected.testCodeunitId and expected.testApp from the allocation", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const raw = await Deno.readTextFile(join(draftDir, "task.yml"));
      const { parse } = await import("@std/yaml");
      const manifest = parseTaskManifest(
        parse(raw),
        join(draftDir, "task.yml"),
      );

      assertEquals(manifest.expected.testCodeunitId, meta.testCodeunitId);
      assertEquals(
        manifest.expected.testApp,
        `tests/al/hard/${meta.id}.Test.al`,
      );
    });

    it("never emits a placeholder assertion in the AL skeleton", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const al = await Deno.readTextFile(
        join(draftDir, "correct", `${meta.id}.Test.al`),
      );

      // Assert.IsTrue(true, ...) always passes - it would let an unfinished
      // oracle look green in a bench run.
      assertNotMatch(al, /Assert\.IsTrue\(\s*true/);
    });

    it("emits an explicit failing marker so an unedited draft cannot pass a probe", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const al = await Deno.readTextFile(
        join(draftDir, "correct", `${meta.id}.Test.al`),
      );

      // Assert.IsTrue(false, ...), not Assert.Fail(...): IsTrue is used 550
      // times across tests/al/ (verified), Assert.Fail has zero precedent
      // there, and this marker is load-bearing enough to need proof over
      // inference.
      assertStringIncludes(al, "Assert.IsTrue(false,");
    });

    it("declares the allocated test codeunit id in the AL skeleton", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const al = await Deno.readTextFile(
        join(draftDir, "correct", `${meta.id}.Test.al`),
      );

      assertStringIncludes(al, `codeunit ${meta.testCodeunitId} `);
    });

    it("never emits a guiding note in the rendered description", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const raw = await Deno.readTextFile(join(draftDir, "task.yml"));
      const { parse } = await import("@std/yaml");
      const manifest = parseTaskManifest(
        parse(raw),
        join(draftDir, "task.yml"),
      );
      const lowered = manifest.description.toLowerCase();

      for (
        const phrase of ["note:", "remember", "be careful", "do not forget"]
      ) {
        assertEquals(
          lowered.includes(phrase),
          false,
          `description must not contain "${phrase}"`,
        );
      }
    });

    it("writes .meta.json recording id, slug, testCodeunitId, createdAt, withPrereq", async () => {
      const meta = await scaffoldDraft({ slug: "inner-commit", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const raw = await Deno.readTextFile(join(draftDir, ".meta.json"));
      const written = JSON.parse(raw) as DraftMeta;

      assertEquals(written, meta);
      assertEquals(written.slug, "inner-commit");
      assertEquals(typeof written.createdAt, "string");
      // createdAt must be a real, parseable timestamp.
      assertEquals(Number.isNaN(Date.parse(written.createdAt)), false);
    });

    it("withPrereq: true scaffolds scratch/<id>/prereq/app.json - never tests/al/", async () => {
      const meta = await scaffoldDraft({
        id: "CG-AL-X053",
        slug: "poisoned-rescue",
        withPrereq: true,
        roots,
      });

      assertEquals(meta.withPrereq, true);

      const appJsonPath = join(
        roots.scratchDir,
        "CG-AL-X053",
        "prereq",
        "app.json",
      );
      assertEquals(await exists(appJsonPath), true);

      const appJson = JSON.parse(await Deno.readTextFile(appJsonPath));
      // 0a53, not the literal task letter: verified against every
      // committed X-series app.json (e.g. CG-AL-X052 -> a1b2c3d4-0a52-...).
      // "x" is not a hex digit, so "a1b2c3d4-x053-..." is not a valid GUID.
      assertEquals(appJson.id, "a1b2c3d4-0a53-0000-0000-000000000001");
      assertEquals(appJson.idRanges, [{ from: 69000, to: 69099 }]);

      // Load-bearing: the committed tests/al/ tree (and therefore
      // task_sets.hash, which src/ingest/catalog/task-set-hash.ts computes
      // from every file under tests/al/** with no .gitignore awareness)
      // must be untouched by scaffolding alone - only promoteDraft may
      // write there.
      assertEquals(
        await exists(join(roots.testsDir, "dependencies", "CG-AL-X053")),
        false,
      );
    });

    it("withPrereq: false (default) does not create a prereq/ entry", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const appJsonPath = join(
        roots.scratchDir,
        meta.id,
        "prereq",
        "app.json",
      );

      assertEquals(await exists(appJsonPath), false);
    });

    it("refuses when scratch/<id>/ already exists", async () => {
      await ensureDir(join(roots.scratchDir, "CG-AL-X001"));

      await assertRejects(
        () => scaffoldDraft({ id: "CG-AL-X001", slug: "day-close", roots }),
        Error,
      );
    });

    it("refuses a slug that is not kebab-case", async () => {
      await assertRejects(
        () => scaffoldDraft({ slug: "Not_Kebab", roots }),
        Error,
      );
      await assertRejects(
        () => scaffoldDraft({ slug: "TooManyCaps", roots }),
        Error,
      );
      await assertRejects(
        () => scaffoldDraft({ slug: "trailing-", roots }),
        Error,
      );

      // No draft directory should be left behind by a rejected call.
      assertEquals(await exists(join(roots.scratchDir, "Not_Kebab")), false);
    });

    it("refuses an explicit id that is not CG-AL-X<digits>", async () => {
      // E/M/H are valid per the manifest schema but NOT per this workbench:
      // src/workbench/ids.ts only collision-tracks the X-series, so letting
      // one through here would produce a draft that is never checked for
      // collisions.
      await assertRejects(
        () => scaffoldDraft({ id: "CG-AL-E002", slug: "day-close", roots }),
        Error,
      );
      await assertRejects(
        () => scaffoldDraft({ id: "not-an-id", slug: "day-close", roots }),
        Error,
      );

      assertEquals(await exists(join(roots.scratchDir, "CG-AL-E002")), false);
    });

    it("refuses an explicit id already used by a committed task", async () => {
      // Without this the draft scaffolds happily, burns a test-codeunit-id
      // allocation, and the collision only surfaces at promote - after the
      // task has been authored against the taken id.
      await ensureDir(join(roots.tasksDir, "hard"));
      await Deno.writeTextFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-inner-commit.yml"),
        "id: CG-AL-X052\n",
      );

      await assertRejects(
        () => scaffoldDraft({ id: "CG-AL-X052", slug: "day-close", roots }),
        Error,
        "already in use",
      );

      assertEquals(await exists(join(roots.scratchDir, "CG-AL-X052")), false);
    });

    it("refuses an explicit id already used by a committed test codeunit", async () => {
      await ensureDir(join(roots.testsDir, "hard"));
      await Deno.writeTextFile(
        join(roots.testsDir, "hard", "CG-AL-X052.Test.al"),
        'codeunit 80052 "CG-AL-X052 Test"\n{\n}\n',
      );

      await assertRejects(
        () => scaffoldDraft({ id: "CG-AL-X052", slug: "day-close", roots }),
        Error,
        "already in use",
      );
    });

    it("normalises a short explicit id to 3 digits", async () => {
      const meta = await scaffoldDraft({
        id: "CG-AL-X52",
        slug: "day-close",
        roots,
      });

      assertEquals(meta.id, "CG-AL-X052");
      assertEquals(await exists(join(roots.scratchDir, "CG-AL-X052")), true);
      assertEquals(await exists(join(roots.scratchDir, "CG-AL-X52")), false);
    });

    it("normalises an over-padded explicit id to 3 digits", async () => {
      const meta = await scaffoldDraft({
        id: "CG-AL-X0052",
        slug: "day-close",
        roots,
      });

      assertEquals(meta.id, "CG-AL-X052");
    });

    it("refuses a digit-width variant of an id already shipped", async () => {
      // The escape the collision check exists to close: ids.ts folds X52 and
      // X052 to the same number, but promote.ts's filenameMatchesId compares
      // substrings, so "CG-AL-X52" does not match
      // "CG-AL-X052-day-close.yml" - the promote gate would have shipped a
      // second manifest for the same task.
      await ensureDir(join(roots.tasksDir, "hard"));
      await Deno.writeTextFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-day-close.yml"),
        "id: CG-AL-X052\n",
      );

      await assertRejects(
        () => scaffoldDraft({ id: "CG-AL-X52", slug: "inner-commit", roots }),
        Error,
        "already in use",
      );
    });

    it("refuses an explicit id already claimed by another draft", async () => {
      await scaffoldDraft({ id: "CG-AL-X052", slug: "day-close", roots });

      await assertRejects(
        () => scaffoldDraft({ id: "CG-AL-X052", slug: "inner-commit", roots }),
        Error,
      );
      // The digit-width variant must be refused too, and must not create a
      // second directory alongside the first.
      await assertRejects(
        () => scaffoldDraft({ id: "CG-AL-X52", slug: "inner-commit", roots }),
        Error,
      );
      assertEquals(await exists(join(roots.scratchDir, "CG-AL-X52")), false);
    });

    it("still scaffolds an explicit id that is genuinely free", async () => {
      await ensureDir(join(roots.tasksDir, "hard"));
      await Deno.writeTextFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-inner-commit.yml"),
        "id: CG-AL-X052\n",
      );

      const meta = await scaffoldDraft({
        id: "CG-AL-X060",
        slug: "day-close",
        roots,
      });

      assertEquals(meta.id, "CG-AL-X060");
    });

    it("does not collide on test codeunit id across two drafts scaffolded before either promotes", async () => {
      // This is the exact gap allocateTestCodeunitId used to have: draft 1
      // writes its codeunit id into scratch/, and a second scaffoldDraft
      // call - before draft 1 is promoted into tests/al/ - must see it.
      const first = await scaffoldDraft({ slug: "day-close", roots });
      const second = await scaffoldDraft({ slug: "inner-commit", roots });

      assertEquals(second.testCodeunitId, first.testCodeunitId + 1);
    });

    it("diagnose: true creates starter/ instead of naive/, and points task.yml at diagnose.md", async () => {
      const meta = await scaffoldDraft({
        slug: "diagnose-me",
        diagnose: true,
        roots,
      });
      const draftDir = join(roots.scratchDir, meta.id);

      assertEquals(await exists(join(draftDir, "starter")), true);
      assertEquals(await exists(join(draftDir, "naive")), false);

      const taskYaml = await Deno.readTextFile(join(draftDir, "task.yml"));
      assertStringIncludes(taskYaml, "prompt_template: diagnose.md");
    });

    it("diagnose: false (default) still creates naive/ and no starter/", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);

      assertEquals(await exists(join(draftDir, "naive")), true);
      assertEquals(await exists(join(draftDir, "starter")), false);

      const taskYaml = await Deno.readTextFile(join(draftDir, "task.yml"));
      assertStringIncludes(taskYaml, "prompt_template: code-gen.md");
    });
  });
});
