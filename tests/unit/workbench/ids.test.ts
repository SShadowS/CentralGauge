/**
 * Unit tests for task workbench id allocation.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. Nothing here may
 * read or write the real `tasks/`, `tests/al/` or `scratch/` trees.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";

import type { IdRoots } from "../../../src/workbench/ids.ts";
import {
  allocateTaskId,
  allocateTestCodeunitId,
  taskIdExists,
} from "../../../src/workbench/ids.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

/** Writes `content` to `path`, creating parent directories as needed. */
async function writeFile(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, content);
}

function testCodeunit(id: number, name = "Mock"): string {
  return `codeunit ${id} "${name}"\n{\n    Subtype = Test;\n}\n`;
}

describe("workbench/ids", () => {
  let base: string;
  let roots: IdRoots;

  beforeEach(async () => {
    base = await createTempDir("workbench-ids-test");
    roots = {
      tasksDir: join(base, "tasks"),
      testsDir: join(base, "tests", "al"),
      scratchDir: join(base, "scratch"),
    };
  });

  afterEach(async () => {
    await cleanupTempDir(base);
  });

  describe("allocateTaskId", () => {
    it("returns the next id after the highest committed task", async () => {
      await writeFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-inner-commit.yml"),
        "id: CG-AL-X052\n",
      );

      assertEquals(await allocateTaskId(roots), "CG-AL-X053");
    });

    it("scans scratch/ too - a draft collides with a free-looking id", async () => {
      await writeFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-inner-commit.yml"),
        "id: CG-AL-X052\n",
      );
      // A draft already claims X053, even though tasks/ alone would say
      // X053 is free.
      await ensureDir(join(roots.scratchDir, "CG-AL-X053"));

      assertEquals(await allocateTaskId(roots), "CG-AL-X054");
    });

    it("does not gap-fill a hole between committed ids", async () => {
      await writeFile(
        join(roots.tasksDir, "medium", "CG-AL-X050-a.yml"),
        "id: CG-AL-X050\n",
      );
      await writeFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-b.yml"),
        "id: CG-AL-X052\n",
      );
      // X051 is missing (e.g. a deleted draft) - must not be reused.

      assertEquals(await allocateTaskId(roots), "CG-AL-X053");
    });

    it("zero-pads to 3 digits, then grows past it without truncation", async () => {
      await writeFile(
        join(roots.tasksDir, "easy", "CG-AL-X099-z.yml"),
        "id: CG-AL-X099\n",
      );

      assertEquals(await allocateTaskId(roots), "CG-AL-X100");
    });

    it("starts at CG-AL-X001 on an empty tree", async () => {
      assertEquals(await allocateTaskId(roots), "CG-AL-X001");
    });

    it("also picks up ids that only appear in tests/al/", async () => {
      await writeFile(
        join(roots.testsDir, "hard", "CG-AL-X052.Test.al"),
        testCodeunit(80342),
      );

      assertEquals(await allocateTaskId(roots), "CG-AL-X053");
    });
  });

  describe("taskIdExists", () => {
    it("is true for an id committed under tasks/", async () => {
      await writeFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-inner-commit.yml"),
        "id: CG-AL-X052\n",
      );

      assertEquals(await taskIdExists("CG-AL-X052", roots), true);
    });

    it("is true for an id only present as a scratch/ draft", async () => {
      await ensureDir(join(roots.scratchDir, "CG-AL-X053"));

      assertEquals(await taskIdExists("CG-AL-X053", roots), true);
    });

    it("is false for an id not present anywhere", async () => {
      await writeFile(
        join(roots.tasksDir, "hard", "CG-AL-X052-inner-commit.yml"),
        "id: CG-AL-X052\n",
      );

      assertEquals(await taskIdExists("CG-AL-X999", roots), false);
    });

    it("is false for a malformed id instead of throwing", async () => {
      assertEquals(await taskIdExists("not-an-id", roots), false);
    });
  });

  describe("allocateTestCodeunitId", () => {
    it("returns the next id after the highest across tests/al/**/*.al", async () => {
      await writeFile(
        join(roots.testsDir, "hard", "CG-AL-X052.Test.al"),
        testCodeunit(80342),
      );

      assertEquals(await allocateTestCodeunitId(roots), 80343);
    });

    it("starts at 80001 on an empty tree", async () => {
      assertEquals(await allocateTestCodeunitId(roots), 80001);
    });

    it("throws once the 80000-89999 range is exhausted", async () => {
      await writeFile(
        join(roots.testsDir, "hard", "CG-AL-X999.Test.al"),
        testCodeunit(89999),
      );

      await assertRejects(
        () => allocateTestCodeunitId(roots),
        Error,
        "89999",
      );
    });
  });
});
