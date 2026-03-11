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

  await t.step("stages all files from source directory", async () => {
    const sourceDir = await createTempDir("stage-all-src");
    const targetDir = await createTempDir("stage-all-tgt");

    try {
      // Create various files in source
      await Deno.writeTextFile(`${sourceDir}/CLAUDE.md`, "# Rules");
      await Deno.writeTextFile(`${sourceDir}/AGENTS.md`, "# Agent Info");
      await Deno.writeTextFile(
        `${sourceDir}/.mcp.json`,
        '{"mcpServers":{}}',
      );

      const staged = await stageAgentWorkspace(sourceDir, targetDir);

      // All files should be staged
      assertEquals(await exists(`${targetDir}/CLAUDE.md`), true);
      assertEquals(await exists(`${targetDir}/AGENTS.md`), true);
      assertEquals(await exists(`${targetDir}/.mcp.json`), true);

      // Verify content
      assertEquals(
        await Deno.readTextFile(`${targetDir}/AGENTS.md`),
        "# Agent Info",
      );
      assertEquals(
        await Deno.readTextFile(`${targetDir}/.mcp.json`),
        '{"mcpServers":{}}',
      );

      // Cleanup removes all
      await staged.cleanup();
      assertEquals(await exists(`${targetDir}/CLAUDE.md`), false);
      assertEquals(await exists(`${targetDir}/AGENTS.md`), false);
      assertEquals(await exists(`${targetDir}/.mcp.json`), false);
    } finally {
      await cleanupTempDir(sourceDir);
      await cleanupTempDir(targetDir);
    }
  });

  await t.step("stages directories from source", async () => {
    const sourceDir = await createTempDir("stage-dirs-src");
    const targetDir = await createTempDir("stage-dirs-tgt");

    try {
      // Create a .tools directory with a script
      await Deno.mkdir(`${sourceDir}/.tools`, { recursive: true });
      await Deno.writeTextFile(
        `${sourceDir}/.tools/my-linter.sh`,
        "#!/bin/bash\necho lint",
      );

      const staged = await stageAgentWorkspace(sourceDir, targetDir);

      assertEquals(await exists(`${targetDir}/.tools`), true);
      assertEquals(await exists(`${targetDir}/.tools/my-linter.sh`), true);
      assertEquals(
        await Deno.readTextFile(`${targetDir}/.tools/my-linter.sh`),
        "#!/bin/bash\necho lint",
      );

      await staged.cleanup();
      assertEquals(await exists(`${targetDir}/.tools`), false);
    } finally {
      await cleanupTempDir(sourceDir);
      await cleanupTempDir(targetDir);
    }
  });

  await t.step(
    "non-existent sourceDir returns empty staged",
    async () => {
      const nonExistentDir = `${Deno.env.get("TEMP") || "/tmp"}/stage-nonexistent-${Date.now()}`;

      const staged = await stageAgentWorkspace(
        nonExistentDir,
        nonExistentDir,
      );

      assertEquals(staged.stagedPaths.length, 0);
      assertEquals(staged.backedUpPaths.length, 0);
      await staged.cleanup(); // Should not throw
    },
  );

  await t.step(
    "backs up existing files and restores on cleanup",
    async () => {
      const sourceDir = await createTempDir("stage-backup-src");
      const targetDir = await createTempDir("stage-backup-tgt");

      try {
        // Pre-create a file in targetDir that will conflict
        await Deno.writeTextFile(
          `${targetDir}/CLAUDE.md`,
          "# Original Content",
        );

        // Create same-named file in sourceDir
        await Deno.writeTextFile(
          `${sourceDir}/CLAUDE.md`,
          "# Staged Content",
        );

        const staged = await stageAgentWorkspace(sourceDir, targetDir);

        // Backup should have been created
        assertEquals(staged.backedUpPaths.length, 1);
        assertEquals(
          await exists(`${targetDir}/CLAUDE.md.bak`),
          true,
        );
        assertEquals(
          await Deno.readTextFile(`${targetDir}/CLAUDE.md.bak`),
          "# Original Content",
        );

        // Staged file should be the new content
        assertEquals(
          await Deno.readTextFile(`${targetDir}/CLAUDE.md`),
          "# Staged Content",
        );

        // Cleanup should restore original
        await staged.cleanup();
        assertEquals(await exists(`${targetDir}/CLAUDE.md`), true);
        assertEquals(
          await Deno.readTextFile(`${targetDir}/CLAUDE.md`),
          "# Original Content",
        );
        assertEquals(
          await exists(`${targetDir}/CLAUDE.md.bak`),
          false,
        );
      } finally {
        await cleanupTempDir(sourceDir);
        await cleanupTempDir(targetDir);
      }
    },
  );
});
