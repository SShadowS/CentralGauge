/**
 * Unit tests for task workbench draft scaffolding.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. Nothing here may
 * read or write the real `tasks/`, `tests/al/` or `scratch/` trees.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertNotMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import type { IdRoots } from "../../../src/workbench/ids.ts";
import type { DraftMeta } from "../../../src/workbench/scaffold.ts";
import { scaffoldDraft } from "../../../src/workbench/scaffold.ts";
import { parseTaskManifest } from "../../../src/tasks/interfaces.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

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
        await exists(join(draftDir, `${meta.id}.Test.al`)),
        true,
      );
      assertEquals(await exists(join(draftDir, "correct")), true);
      assertEquals(await exists(join(draftDir, "naive")), true);
      assertEquals(await exists(join(draftDir, "NOTES.md")), true);
      assertEquals(await exists(join(draftDir, ".meta.json")), true);
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
        join(draftDir, `${meta.id}.Test.al`),
      );

      // Assert.IsTrue(true, ...) always passes - it would let an unfinished
      // oracle look green in a bench run.
      assertNotMatch(al, /Assert\.IsTrue\(\s*true/);
    });

    it("emits an explicit failing marker so an unedited draft cannot pass a probe", async () => {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      const draftDir = join(roots.scratchDir, meta.id);
      const al = await Deno.readTextFile(
        join(draftDir, `${meta.id}.Test.al`),
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
        join(draftDir, `${meta.id}.Test.al`),
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

    it("does not collide on test codeunit id across two drafts scaffolded before either promotes", async () => {
      // This is the exact gap allocateTestCodeunitId used to have: draft 1
      // writes its codeunit id into scratch/, and a second scaffoldDraft
      // call - before draft 1 is promoted into tests/al/ - must see it.
      const first = await scaffoldDraft({ slug: "day-close", roots });
      const second = await scaffoldDraft({ slug: "inner-commit", roots });

      assertEquals(second.testCodeunitId, first.testCodeunitId + 1);
    });
  });
});
