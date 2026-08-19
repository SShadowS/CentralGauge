import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { promoteAsNaive } from "../../../src/dashboard/promote-naive.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const BASE = {
  taskId: "CG-AL-X054",
  model: "anthropic/claude-opus-4-8",
  attempt: 1,
  timestamp: "2026-08-18T10:00:00.000Z",
};

describe("dashboard/promote-naive", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await createTempDir("promote-naive-test");
    await ensureDir(join(dir, "naive"));
    await Deno.writeTextFile(join(dir, "naive", "app.json"), "{}");
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("writes one file per top-level object", async () => {
    const code = `codeunit 70054 "CG Agent" { }
table 70055 "CG Thing" { }`;
    const r = await promoteAsNaive({ ...BASE, draftDir: dir, code });
    assertEquals(r.written.sort(), [
      "CG Agent.Codeunit.al",
      "CG Thing.Table.al",
    ]);
  });

  it("stamps provenance as a comment header", async () => {
    const code = `codeunit 70054 "CG Agent" { }`;
    await promoteAsNaive({ ...BASE, draftDir: dir, code });
    const text = await Deno.readTextFile(
      join(dir, "naive", "CG Agent.Codeunit.al"),
    );
    assertStringIncludes(text, "anthropic/claude-opus-4-8");
    assertStringIncludes(text, "2026-08-18T10:00:00.000Z");
  });

  it("replaces existing AL rather than merging, and keeps app.json", async () => {
    await Deno.writeTextFile(
      join(dir, "naive", "Stale.Codeunit.al"),
      "codeunit 1 S { }",
    );
    const r = await promoteAsNaive({
      ...BASE,
      draftDir: dir,
      code: `codeunit 70054 "CG Agent" { }`,
    });
    assertEquals(r.removed, ["Stale.Codeunit.al"]);
    assertEquals(
      await Deno.stat(join(dir, "naive", "app.json")).then(() => true),
      true,
    );
  });

  it("sanitises characters invalid in a filename", async () => {
    const code = `codeunit 70054 "CG/Agent: v2" { }`;
    const r = await promoteAsNaive({ ...BASE, draftDir: dir, code });
    assertEquals(r.written[0]?.includes("/"), false);
    assertEquals(r.written[0]?.includes(":"), false);
  });

  it("collapses runs of sanitised characters into a single hyphen", async () => {
    const code = `codeunit 70054 "CG//Agent" { }`;
    const r = await promoteAsNaive({ ...BASE, draftDir: dir, code });
    assertEquals(r.written, ["CG-Agent.Codeunit.al"]);
  });

  it("floors a name that sanitises to nothing into a readable placeholder", async () => {
    const code = `codeunit 70054 "///" { }`;
    const r = await promoteAsNaive({ ...BASE, draftDir: dir, code });
    assertEquals(r.written, ["Unnamed.Codeunit.al"]);
  });

  it("refuses a name that would collide with the reserved task-id prefix", async () => {
    const code = `codeunit 70054 "CG-AL-X054.Helper" { }`;
    await assertRejects(
      () => promoteAsNaive({ ...BASE, draftDir: dir, code }),
      Error,
      "reserved",
    );
  });

  it("refuses two objects of one type sanitising to the same name", async () => {
    const code = `codeunit 70054 "CG:Agent" { }
codeunit 70055 "CG/Agent" { }`;
    await assertRejects(
      () => promoteAsNaive({ ...BASE, draftDir: dir, code }),
      Error,
      "collide",
    );
  });

  it("refuses when nothing extractable was produced", async () => {
    await assertRejects(
      () => promoteAsNaive({ ...BASE, draftDir: dir, code: "I cannot help." }),
      Error,
    );
  });
});
