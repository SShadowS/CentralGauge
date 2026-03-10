import { assertEquals, assertExists } from "@std/assert";
import { exists } from "@std/fs";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";
import { stageAgentWorkspace } from "../../../src/agents/workspace-staging.ts";

Deno.test("stageAgentWorkspace", async (t) => {
  await t.step("stages CLAUDE.md into target directory", async () => {
    const sourceDir = await createTempDir("stage-source");
    const targetDir = await createTempDir("stage-target");

    try {
      await Deno.writeTextFile(
        `${sourceDir}/CLAUDE.md`,
        "# Test Instructions",
      );

      const staged = await stageAgentWorkspace(sourceDir, targetDir);
      assertExists(staged);

      assertEquals(await exists(`${targetDir}/CLAUDE.md`), true);
      const content = await Deno.readTextFile(`${targetDir}/CLAUDE.md`);
      assertEquals(content, "# Test Instructions");

      // Cleanup should remove it
      await staged.cleanup();
      assertEquals(await exists(`${targetDir}/CLAUDE.md`), false);
    } finally {
      await cleanupTempDir(sourceDir);
      await cleanupTempDir(targetDir);
    }
  });

  await t.step("returns empty staged when no files exist", async () => {
    const sourceDir = await createTempDir("stage-empty-src");
    const targetDir = await createTempDir("stage-empty-tgt");

    try {
      const staged = await stageAgentWorkspace(sourceDir, targetDir);
      assertEquals(staged.stagedPaths.length, 0);
      await staged.cleanup(); // Should not throw
    } finally {
      await cleanupTempDir(sourceDir);
      await cleanupTempDir(targetDir);
    }
  });
});
