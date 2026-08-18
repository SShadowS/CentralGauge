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

  async function makeDraft(id: string, opts: { prereq?: boolean } = {}) {
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
    if (opts.prereq) await ensureDir(join(dir, "prereq"));
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
