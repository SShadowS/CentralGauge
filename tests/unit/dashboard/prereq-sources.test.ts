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

  // Everything this loader misses becomes a false accusation against a
  // model that referenced it correctly (the module's own doc comment). An
  // incomplete load used to be indistinguishable from an empty one, so the
  // missing fields simply vanished from the index and every reference to
  // one became a confident `hard` finding produced by a disk error.
  describe("says so when the load was incomplete", () => {
    it("is clean for a load that read everything it listed", async () => {
      const draft = join(root, "CG-AL-X054");
      await ensureDir(join(draft, "prereq"));
      await Deno.writeTextFile(
        join(draft, "prereq", "A.Table.al"),
        "table 1 A { }",
      );
      const r = await loadPrereqSources(draft, join(root, "deps"));
      assertEquals(r.hasError, false);
    });

    it("is clean when the draft simply has no prereq directory", async () => {
      // An author who never scaffolded a prereq is an ordinary state, not
      // a load failure — and `hasError` here would degrade every such
      // draft's rail into a permanent false "couldn't check the prereq".
      const draft = join(root, "CG-AL-X054");
      await ensureDir(draft);
      const r = await loadPrereqSources(draft, join(root, "deps"));
      assertEquals(r.hasError, false);
    });

    it("is clean for an unresolvable dependency id", async () => {
      // The committed `CG-AL-X047` case: a platform/base-app id that has no
      // local directory and never will. Documented as normal, not an error.
      const draft = join(root, "CG-AL-X054");
      await ensureDir(join(draft, "prereq"));
      await Deno.writeTextFile(
        join(draft, "prereq", "app.json"),
        JSON.stringify({
          id: "a1b2c3d4-0a54-0000-0000-000000000001",
          dependencies: [{ id: "437dbf0e-0000-0000-0000-000000000000" }],
        }),
      );
      await Deno.writeTextFile(
        join(draft, "prereq", "Own.Table.al"),
        "table 1 Own { }",
      );
      const r = await loadPrereqSources(draft, join(root, "deps"));
      assertEquals(r.hasError, false);
      assertEquals(r.sources.length, 1);
    });

    it("reports a directory that would not list", async () => {
      // `prereq` exists as a FILE, so `Deno.readDir` fails with something
      // other than "not there" — a real shortfall, not an absent prereq.
      const draft = join(root, "CG-AL-X054");
      await ensureDir(draft);
      await Deno.writeTextFile(join(draft, "prereq"), "not a directory");
      const r = await loadPrereqSources(draft, join(root, "deps"));
      assertEquals(r.hasError, true);
    });

    it("reports a listed .al file that would not read, and still loads the rest", async () => {
      const draft = join(root, "CG-AL-X054");
      await ensureDir(join(draft, "prereq"));
      await Deno.writeTextFile(
        join(draft, "prereq", "A.Table.al"),
        "table 1 A { }",
      );
      await Deno.writeTextFile(
        join(draft, "prereq", "B.Table.al"),
        "table 2 B { }",
      );

      // A file that lists and then fails to read (removed mid-scan, a
      // permission change, a device error) has no portable on-disk
      // reproduction, so the read itself is stubbed for exactly one name.
      // `configurable: true` + restore in `finally`: Deno 2.8 exposes these
      // as getters, and a leaked stub is test-order poison.
      const real = Deno.readTextFile;
      Object.defineProperty(Deno, "readTextFile", {
        value: (path: string | URL, opts?: Deno.ReadFileOptions) => {
          if (String(path).endsWith("B.Table.al")) {
            return Promise.reject(new Deno.errors.PermissionDenied("nope"));
          }
          return real(path, opts);
        },
        configurable: true,
        writable: true,
      });
      try {
        const r = await loadPrereqSources(draft, join(root, "deps"));
        assertEquals(r.hasError, true);
        // Skipping the bad file stays right — the rest still loads.
        assertEquals(r.files, ["A.Table.al"]);
      } finally {
        Object.defineProperty(Deno, "readTextFile", {
          value: real,
          configurable: true,
          writable: true,
        });
      }
    });

    it("propagates a chained dependency's incomplete load to the top", async () => {
      const draft = join(root, "CG-AL-X054");
      await ensureDir(join(draft, "prereq"));
      await Deno.writeTextFile(
        join(draft, "prereq", "app.json"),
        JSON.stringify({
          id: "id-a",
          dependencies: [{ id: "id-b" }],
        }),
      );
      await Deno.writeTextFile(
        join(draft, "prereq", "Own.Table.al"),
        "table 1 Own { }",
      );
      const depB = join(root, "deps", "B");
      await ensureDir(depB);
      await Deno.writeTextFile(
        join(depB, "app.json"),
        JSON.stringify({ id: "id-b" }),
      );
      await Deno.writeTextFile(join(depB, "Dep.Table.al"), "table 2 B { }");

      const real = Deno.readTextFile;
      Object.defineProperty(Deno, "readTextFile", {
        value: (path: string | URL, opts?: Deno.ReadFileOptions) => {
          if (String(path).endsWith("Dep.Table.al")) {
            return Promise.reject(new Deno.errors.PermissionDenied("nope"));
          }
          return real(path, opts);
        },
        configurable: true,
        writable: true,
      });
      try {
        const r = await loadPrereqSources(draft, join(root, "deps"));
        assertEquals(r.hasError, true);
        assertEquals(r.files, ["Own.Table.al"]);
      } finally {
        Object.defineProperty(Deno, "readTextFile", {
          value: real,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});
