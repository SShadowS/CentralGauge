/**
 * Tests for config action functions
 * TDD: These tests are written BEFORE the implementation
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import {
  createEnvTemplate,
  initializeConfigFile,
} from "../../../../cli/services/config-actions.ts";
import { testTempDir } from "../../../utils/temp-dir.ts";

// ============================================================================
// initializeConfigFile tests
// ============================================================================

Deno.test("initializeConfigFile", async (t) => {
  await t.step("creates config file in specified directory", async () => {
    const tempDir = await testTempDir({ prefix: "config-test-" });
    try {
      const targetPath = join(tempDir, ".centralgauge.yml");

      const result = await initializeConfigFile({ targetPath });

      assertEquals(result.success, true);
      assertStringIncludes(result.message, "Created");
      assertEquals(result.path, targetPath);
      assertEquals(await exists(targetPath), true);

      // Verify content is valid YAML with expected sections
      const content = await Deno.readTextFile(targetPath);
      assertStringIncludes(content, "defaultModels:");
      assertStringIncludes(content, "llm:");
      assertStringIncludes(content, "container:");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("returns error if file already exists", async () => {
    const tempDir = await testTempDir({ prefix: "config-test-" });
    try {
      const targetPath = join(tempDir, ".centralgauge.yml");

      // Create file first
      await Deno.writeTextFile(targetPath, "existing: content");

      const result = await initializeConfigFile({ targetPath });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "already exists");
      assertEquals(result.path, targetPath);

      // Original content should be preserved
      const content = await Deno.readTextFile(targetPath);
      assertEquals(content, "existing: content");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("uses default path when none specified", async () => {
    // Save current directory
    const originalCwd = Deno.cwd();
    const tempDir = await testTempDir({ prefix: "config-test-" });

    try {
      Deno.chdir(tempDir);

      const result = await initializeConfigFile();

      assertEquals(result.success, true);
      assertStringIncludes(result.path, ".centralgauge.yml");
      assertEquals(await exists(join(tempDir, ".centralgauge.yml")), true);
    } finally {
      Deno.chdir(originalCwd);
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("handles global option by using home directory", async () => {
    const tempDir = await testTempDir({ prefix: "config-test-" });
    try {
      // Override HOME for test
      const originalHome = Deno.env.get("HOME");
      const originalUserProfile = Deno.env.get("USERPROFILE");
      Deno.env.set("HOME", tempDir);
      Deno.env.set("USERPROFILE", tempDir);

      try {
        const result = await initializeConfigFile({ global: true });

        assertEquals(result.success, true);
        assertStringIncludes(result.path, tempDir);
        assertStringIncludes(result.path, ".centralgauge.yml");
      } finally {
        // Restore
        if (originalHome) Deno.env.set("HOME", originalHome);
        else Deno.env.delete("HOME");
        if (originalUserProfile) {
          Deno.env.set("USERPROFILE", originalUserProfile);
        } else Deno.env.delete("USERPROFILE");
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

// ============================================================================
// createEnvTemplate tests
// ============================================================================

Deno.test("createEnvTemplate", async (t) => {
  await t.step("creates .env file in specified directory", async () => {
    const tempDir = await testTempDir({ prefix: "env-test-" });
    try {
      const targetPath = join(tempDir, ".env");

      const result = await createEnvTemplate({ targetPath });

      assertEquals(result.success, true);
      assertStringIncludes(result.message, "Created");
      assertEquals(result.path, targetPath);
      assertEquals(await exists(targetPath), true);

      // Verify content has expected environment variables
      const content = await Deno.readTextFile(targetPath);
      assertStringIncludes(content, "OPENAI_API_KEY");
      assertStringIncludes(content, "ANTHROPIC_API_KEY");
      assertStringIncludes(content, "CENTRALGAUGE_");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("returns error if file exists and overwrite=false", async () => {
    const tempDir = await testTempDir({ prefix: "env-test-" });
    try {
      const targetPath = join(tempDir, ".env");

      // Create file first
      await Deno.writeTextFile(targetPath, "EXISTING=value");

      const result = await createEnvTemplate({ targetPath, overwrite: false });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "already exists");

      // Original content preserved
      const content = await Deno.readTextFile(targetPath);
      assertEquals(content, "EXISTING=value");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("overwrites file when overwrite=true", async () => {
    const tempDir = await testTempDir({ prefix: "env-test-" });
    try {
      const targetPath = join(tempDir, ".env");

      // Create file first
      await Deno.writeTextFile(targetPath, "EXISTING=value");

      const result = await createEnvTemplate({ targetPath, overwrite: true });

      assertEquals(result.success, true);
      assertStringIncludes(result.message, "Created");

      // Content should be replaced
      const content = await Deno.readTextFile(targetPath);
      assertStringIncludes(content, "OPENAI_API_KEY");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("uses default path when none specified", async () => {
    const originalCwd = Deno.cwd();
    const tempDir = await testTempDir({ prefix: "env-test-" });

    try {
      Deno.chdir(tempDir);

      const result = await createEnvTemplate();

      assertEquals(result.success, true);
      assertStringIncludes(result.path, ".env");
      assertEquals(await exists(join(tempDir, ".env")), true);
    } finally {
      Deno.chdir(originalCwd);
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});
