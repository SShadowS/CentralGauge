import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import {
  listDrafts,
  resolvePresetModels,
} from "../../../src/dashboard/drafts.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

describe("dashboard/drafts", () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await createTempDir("dashboard-drafts-test");
  });
  afterEach(async () => {
    await cleanupTempDir(scratch);
  });

  async function makeDraft(
    id: string,
    opts: { prereq?: boolean; prereqFiles?: string[] } = {},
  ) {
    const dir = join(scratch, id);
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      `id: ${id}\nexpected:\n  testCodeunitId: 88801\n`,
    );
    await Deno.writeTextFile(
      join(dir, ".meta.json"),
      JSON.stringify({ id, slug: "day-close" }),
    );
    if (opts.prereq || opts.prereqFiles) {
      await ensureDir(join(dir, "prereq"));
      for (const name of opts.prereqFiles ?? []) {
        await Deno.writeTextFile(join(dir, "prereq", name), "");
      }
    }
  }

  it("lists a scaffolded draft", async () => {
    await makeDraft("CG-AL-X054");
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 1);
    assertEquals(drafts[0]?.id, "CG-AL-X054");
    assertEquals(drafts[0]?.slug, "day-close");
    assertEquals(drafts[0]?.testCodeunitId, 88801);
  });

  it("ignores directories without the scaffold markers", async () => {
    await ensureDir(join(scratch, "fieldref-hunt"));
    await Deno.writeTextFile(join(scratch, "fable-repro-req.json"), "{}");
    await ensureDir(join(scratch, "premise-x046"));
    await makeDraft("CG-AL-X054");
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.map((d) => d.id), ["CG-AL-X054"]);
  });

  it("reports whether a draft has a prereq", async () => {
    await makeDraft("CG-AL-X054", { prereq: true });
    assertEquals((await listDrafts(scratch))[0]?.hasPrereq, true);
  });

  it("lists prereq/ filenames sorted", async () => {
    await makeDraft("CG-AL-X054", {
      prereqFiles: ["Table.al", "app.json", "Enum.al"],
    });
    const drafts = await listDrafts(scratch);
    assertEquals(drafts[0]?.hasPrereq, true);
    assertEquals(drafts[0]?.prereqFiles, ["Enum.al", "Table.al", "app.json"]);
  });

  it("reports an empty prereqFiles list when prereq/ exists but is empty", async () => {
    await makeDraft("CG-AL-X054", { prereq: true });
    assertEquals((await listDrafts(scratch))[0]?.prereqFiles, []);
  });

  it("reports an empty prereqFiles list when there is no prereq/ at all", async () => {
    await makeDraft("CG-AL-X054");
    assertEquals((await listDrafts(scratch))[0]?.prereqFiles, []);
  });

  it("returns an empty list when scratch does not exist", async () => {
    assertEquals((await listDrafts(join(scratch, "nope"))).length, 0);
  });

  it("handles malformed .meta.json gracefully", async () => {
    const dir = join(scratch, "CG-AL-X055");
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      `id: CG-AL-X055\nexpected:\n  testCodeunitId: 88802\n`,
    );
    await Deno.writeTextFile(join(dir, ".meta.json"), "not json at all");
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 1);
    assertEquals(drafts[0]?.id, "CG-AL-X055");
    assertEquals(drafts[0]?.slug, undefined);
    assertEquals(drafts[0]?.testCodeunitId, 88802);
  });

  it("handles malformed task.yml gracefully", async () => {
    const dir = join(scratch, "CG-AL-X056");
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      "not: [valid: yaml: structure",
    );
    await Deno.writeTextFile(
      join(dir, ".meta.json"),
      JSON.stringify({ id: "CG-AL-X056", slug: "test-slug" }),
    );
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 1);
    assertEquals(drafts[0]?.id, "CG-AL-X056");
    assertEquals(drafts[0]?.slug, "test-slug");
    assertEquals(drafts[0]?.testCodeunitId, undefined);
  });

  it("ignores wrong-typed slug in .meta.json", async () => {
    const dir = join(scratch, "CG-AL-X057");
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      `id: CG-AL-X057\nexpected:\n  testCodeunitId: 88803\n`,
    );
    await Deno.writeTextFile(
      join(dir, ".meta.json"),
      JSON.stringify({ id: "CG-AL-X057", slug: 123 }),
    );
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 1);
    assertEquals(drafts[0]?.id, "CG-AL-X057");
    assertEquals(drafts[0]?.slug, undefined);
    assertEquals(drafts[0]?.testCodeunitId, 88803);
  });

  it("returns drafts sorted by id", async () => {
    await makeDraft("CG-AL-X055");
    await makeDraft("CG-AL-X053");
    await makeDraft("CG-AL-X054");
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.map((d) => d.id), [
      "CG-AL-X053",
      "CG-AL-X054",
      "CG-AL-X055",
    ]);
  });

  it("reads task id from task.yml even when directory name differs", async () => {
    const dir = join(scratch, "pre-migration-backup_x053");
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      "id: CG-AL-X053\nexpected:\n  testCodeunitId: 88804\n",
    );
    await Deno.writeTextFile(
      join(dir, ".meta.json"),
      JSON.stringify({ id: "CG-AL-X053", slug: "action-visibility" }),
    );
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 1);
    assertEquals(drafts[0]?.id, "CG-AL-X053");
    assertEquals(drafts[0]?.dirName, "pre-migration-backup_x053");
    assertEquals(drafts[0]?.slug, "action-visibility");
  });

  it("falls back to directory name when task.yml has no id", async () => {
    const dir = join(scratch, "CG-AL-X058");
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      "description: test\nexpected:\n  testCodeunitId: 88805\n",
    );
    await Deno.writeTextFile(
      join(dir, ".meta.json"),
      JSON.stringify({ slug: "fallback-test" }),
    );
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 1);
    assertEquals(drafts[0]?.id, "CG-AL-X058");
    assertEquals(drafts[0]?.dirName, "CG-AL-X058");
  });

  it("includes both drafts when directory names differ but task ids are same", async () => {
    await makeDraft("CG-AL-X053");
    const dir2 = join(scratch, "pre-migration-backup_x053");
    await ensureDir(join(dir2, "correct"));
    await Deno.writeTextFile(
      join(dir2, "task.yml"),
      "id: CG-AL-X053\nexpected:\n  testCodeunitId: 88804\n",
    );
    await Deno.writeTextFile(
      join(dir2, ".meta.json"),
      JSON.stringify({ slug: "action-visibility" }),
    );
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 2);
    assertEquals(drafts.every((d) => d.id === "CG-AL-X053"), true);
    assertEquals(
      drafts.map((d) => d.dirName),
      ["CG-AL-X053", "pre-migration-backup_x053"],
    );
  });

  // The prompt inputs. `POST /api/run` renders the question from these
  // through the bench's own attempt-1 path, so listDrafts is where they have
  // to arrive — the alternative was the dashboard asking every model "".
  it("reads the prompt inputs from task.yml", async () => {
    const dir = join(scratch, "CG-AL-X059");
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      [
        "id: CG-AL-X059",
        "prompt_template: code-gen.md",
        "max_attempts: 2",
        "description: Write a codeunit that validates quantity.",
        "prompts:",
        "  injections:",
        "    anthropic:",
        "      generation:",
        "        prefix: 'PRE '",
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(join(dir, ".meta.json"), "{}");

    const draft = (await listDrafts(scratch))[0];
    assertEquals(
      draft?.description,
      "Write a codeunit that validates quantity.",
    );
    assertEquals(draft?.promptTemplate, "code-gen.md");
    assertEquals(draft?.maxAttempts, 2);
    assertEquals(
      draft?.prompts?.injections?.["anthropic"]?.generation?.prefix,
      "PRE ",
    );
  });

  // A draft scaffolded but not yet written up. It still lists (the author
  // needs to see it); `POST /api/run` is what refuses to spend money on it.
  it("reports an empty description when task.yml has none", async () => {
    await makeDraft("CG-AL-X060");
    const draft = (await listDrafts(scratch))[0];
    assertEquals(draft?.description, "");
    assertEquals(draft?.promptTemplate, undefined);
    assertEquals(draft?.maxAttempts, undefined);
    assertEquals(draft?.prompts, undefined);
  });

  // Wrong-typed fields fall back individually rather than failing the listing,
  // the same tolerance already applied to `slug` and `id`.
  it("ignores wrong-typed prompt inputs in task.yml", async () => {
    const dir = join(scratch, "CG-AL-X061");
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      "id: CG-AL-X061\ndescription: 12\nprompt_template: 7\nmax_attempts: two\nprompts: nope\n",
    );
    await Deno.writeTextFile(join(dir, ".meta.json"), "{}");

    const draft = (await listDrafts(scratch))[0];
    assertEquals(draft?.id, "CG-AL-X061");
    assertEquals(draft?.description, "");
    assertEquals(draft?.promptTemplate, undefined);
    assertEquals(draft?.maxAttempts, undefined);
    assertEquals(draft?.prompts, undefined);
  });

  it("reports starterDir as an absolute path when starter/ has a .al file", async () => {
    await makeDraft("CG-AL-X062");
    const starterDir = join(scratch, "CG-AL-X062", "starter");
    await ensureDir(starterDir);
    await Deno.writeTextFile(
      join(starterDir, "App.Codeunit.al"),
      "codeunit 1 A { }",
    );

    const draft = (await listDrafts(scratch))[0];
    assertEquals(draft?.starterDir, starterDir);
  });

  it("omits starterDir when starter/ is absent or has no .al files", async () => {
    await makeDraft("CG-AL-X063");
    const withoutDraft = (await listDrafts(scratch))[0];
    assertEquals(withoutDraft?.starterDir, undefined);

    await ensureDir(join(scratch, "CG-AL-X063", "starter"));
    await Deno.writeTextFile(
      join(scratch, "CG-AL-X063", "starter", "notes.txt"),
      "not al",
    );
    const withEmptyStarter = (await listDrafts(scratch))[0];
    assertEquals(withEmptyStarter?.starterDir, undefined);
  });

  it("reports starterDir when starter/ has only an uppercase .AL file", async () => {
    await makeDraft("CG-AL-X064");
    const starterDir = join(scratch, "CG-AL-X064", "starter");
    await ensureDir(starterDir);
    await Deno.writeTextFile(
      join(starterDir, "App.AL"),
      "codeunit 1 A { }",
    );

    const draft = (await listDrafts(scratch))[0];
    assertEquals(draft?.starterDir, starterDir);
  });

  it("resolves models from a named preset", () => {
    const models = resolvePresetModels(
      { benchmarkPresets: { flagship: { llms: ["a/b", "c/d"] } } },
      "flagship",
    );
    assertEquals(models, ["a/b", "c/d"]);
  });

  it("returns an empty list for an unknown preset", () => {
    assertEquals(resolvePresetModels({ benchmarkPresets: {} }, "nope"), []);
  });
});
