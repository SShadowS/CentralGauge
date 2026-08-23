import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  DRAFT_STARTER_DIRNAME,
  loadStarterCode,
  starterDirForTask,
} from "../../../src/tasks/starter-code.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("starter-code", async (t) => {
  await t.step("returns undefined for a missing dir", async () => {
    assertEquals(await loadStarterCode("Z:/no/such/dir"), undefined);
  });

  await t.step("returns undefined for a dir with no .al files", async () => {
    const dir = await createTempDir("starter-empty");
    try {
      await Deno.writeTextFile(join(dir, "readme.md"), "not al");
      assertEquals(await loadStarterCode(dir), undefined);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("concatenates .al files sorted with FILE headers", async () => {
    const dir = await createTempDir("starter");
    try {
      await Deno.writeTextFile(join(dir, "b.Codeunit.al"), "codeunit B");
      await Deno.writeTextFile(join(dir, "A.Table.al"), "table A");
      await Deno.writeTextFile(join(dir, "notes.txt"), "skip me");
      assertEquals(
        await loadStarterCode(dir),
        "// FILE: A.Table.al\ntable A\n\n// FILE: b.Codeunit.al\ncodeunit B",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step(
    "loads a dir with only an uppercase .AL file, keeping its original basename",
    async () => {
      const dir = await createTempDir("starter-upper");
      try {
        await Deno.writeTextFile(join(dir, "App.AL"), "codeunit App");
        assertEquals(
          await loadStarterCode(dir),
          "// FILE: App.AL\ncodeunit App",
        );
      } finally {
        await cleanupTempDir(dir);
      }
    },
  );

  await t.step("starterDirForTask composes tasks/starter/<id>", () => {
    assertEquals(
      starterDirForTask("U:/repo", "CG-AL-X070"),
      join("U:/repo", "tasks", "starter", "CG-AL-X070"),
    );
  });

  await t.step("draft starter dirname is the volotests convention", () => {
    assertEquals(DRAFT_STARTER_DIRNAME, "starter");
  });
});
