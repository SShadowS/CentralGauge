import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { loadPrereqSources } from "../../../src/dashboard/prereq-sources.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

describe("dashboard/prereq-sources", () => {
  let root: string;
  beforeEach(async () => {
    root = await createTempDir("prereq-sources-test");
  });
  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("returns nothing when the draft has no prereq directory", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(draft);
    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.sources.length, 0);
    assertEquals(r.files.length, 0);
  });

  it("reads the draft's own prereq AL, sorted", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(join(draft, "prereq"));
    await Deno.writeTextFile(
      join(draft, "prereq", "B.Table.al"),
      "table 2 B { }",
    );
    await Deno.writeTextFile(
      join(draft, "prereq", "A.Table.al"),
      "table 1 A { }",
    );
    await Deno.writeTextFile(join(draft, "prereq", "app.json"), "{}");
    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.files, ["A.Table.al", "B.Table.al"]);
    assertEquals(r.sources.length, 2);
  });

  it("follows a chained dependency by app id", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(join(draft, "prereq"));
    await Deno.writeTextFile(
      join(draft, "prereq", "app.json"),
      JSON.stringify({
        id: "a1b2c3d4-0a54-0000-0000-000000000001",
        dependencies: [{ id: "a1b2c3d4-0ff0-0000-0000-000000000022" }],
      }),
    );
    await Deno.writeTextFile(
      join(draft, "prereq", "Own.Table.al"),
      "table 1 Own { }",
    );

    const dep = join(root, "deps", "CG-AL-H022");
    await ensureDir(dep);
    await Deno.writeTextFile(
      join(dep, "app.json"),
      JSON.stringify({ id: "a1b2c3d4-0ff0-0000-0000-000000000022" }),
    );
    await Deno.writeTextFile(
      join(dep, "Chained.Table.al"),
      "table 9 Chained { }",
    );

    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.files.includes("Chained.Table.al"), true);
    assertEquals(r.sources.length, 2);
  });

  it("skips an unresolvable dependency id and still loads the resolvable one", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(join(draft, "prereq"));
    await Deno.writeTextFile(
      join(draft, "prereq", "app.json"),
      JSON.stringify({
        id: "a1b2c3d4-0a54-0000-0000-000000000001",
        dependencies: [
          { id: "a1b2c3d4-0ff0-0000-0000-000000000022" },
          { id: "437dbf0e-0000-0000-0000-000000000000" },
        ],
      }),
    );
    await Deno.writeTextFile(
      join(draft, "prereq", "Own.Table.al"),
      "table 1 Own { }",
    );

    const dep = join(root, "deps", "CG-AL-H022");
    await ensureDir(dep);
    await Deno.writeTextFile(
      join(dep, "app.json"),
      JSON.stringify({ id: "a1b2c3d4-0ff0-0000-0000-000000000022" }),
    );
    await Deno.writeTextFile(
      join(dep, "Chained.Table.al"),
      "table 9 Chained { }",
    );

    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.files.includes("Own.Table.al"), true);
    assertEquals(r.files.includes("Chained.Table.al"), true);
    assertEquals(r.sources.length, 2);
  });

  it("does not loop forever on a circular dependency", async () => {
    const draft = join(root, "CG-AL-X054");
    await ensureDir(join(draft, "prereq"));
    await Deno.writeTextFile(
      join(draft, "prereq", "app.json"),
      JSON.stringify({ id: "id-a", dependencies: [{ id: "id-b" }] }),
    );
    const depB = join(root, "deps", "B");
    await ensureDir(depB);
    await Deno.writeTextFile(
      join(depB, "app.json"),
      JSON.stringify({ id: "id-b", dependencies: [{ id: "id-a" }] }),
    );
    await Deno.writeTextFile(join(depB, "B.Table.al"), "table 2 B { }");
    const r = await loadPrereqSources(draft, join(root, "deps"));
    assertEquals(r.files, ["B.Table.al"]);
  });
});
