import { describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  extractDifficulty,
  extractTaskId,
  generateComprehensiveTaskSetHash,
  generateManifestHash,
  hashFile,
  hashTaskContent,
} from "../../../src/stats/hasher.ts";

describe("hasher", () => {
  describe("extractTaskId", () => {
    it("should extract task ID from easy task manifest path", () => {
      assertEquals(
        extractTaskId("tasks/easy/CG-AL-E008-basic-interface.yml"),
        "CG-AL-E008",
      );
    });

    it("should extract task ID from medium task manifest path", () => {
      assertEquals(
        extractTaskId("tasks/medium/CG-AL-M010-multi-object.yml"),
        "CG-AL-M010",
      );
    });

    it("should extract task ID from hard task manifest path", () => {
      assertEquals(
        extractTaskId("tasks/hard/CG-AL-H205-line-amount-engine-event.yml"),
        "CG-AL-H205",
      );
    });

    it("should extract task ID with Windows path separators", () => {
      assertEquals(
        extractTaskId("tasks\\easy\\CG-AL-E001-basic-table.yml"),
        "CG-AL-E001",
      );
    });

    it("should throw for invalid manifest path", () => {
      assertThrows(
        () => extractTaskId("invalid-file.yml"),
        Error,
        "Cannot extract task ID",
      );
    });
  });

  describe("extractDifficulty", () => {
    it("should return 'easy' for easy task path", () => {
      assertEquals(
        extractDifficulty("tasks/easy/CG-AL-E001.yml"),
        "easy",
      );
    });

    it("should return 'medium' for medium task path", () => {
      assertEquals(
        extractDifficulty("tasks/medium/CG-AL-M001.yml"),
        "medium",
      );
    });

    it("should return 'hard' for hard task path", () => {
      assertEquals(
        extractDifficulty("tasks/hard/CG-AL-H001.yml"),
        "hard",
      );
    });

    it("should handle Windows path separators", () => {
      assertEquals(
        extractDifficulty("tasks\\hard\\CG-AL-H001.yml"),
        "hard",
      );
    });

    it("should throw for path without difficulty", () => {
      assertThrows(
        () => extractDifficulty("tasks/CG-AL-E001.yml"),
        Error,
        "Cannot determine difficulty",
      );
    });
  });

  describe("generateManifestHash", () => {
    it("should generate 16-character hash", async () => {
      const hash = await generateManifestHash("test content");
      assertEquals(hash.length, 16);
    });

    it("should be deterministic", async () => {
      const hash1 = await generateManifestHash("same content");
      const hash2 = await generateManifestHash("same content");
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different content", async () => {
      const hash1 = await generateManifestHash("content A");
      const hash2 = await generateManifestHash("content B");
      assertEquals(hash1 !== hash2, true);
    });

    it("should trim whitespace before hashing", async () => {
      const hash1 = await generateManifestHash("  content  ");
      const hash2 = await generateManifestHash("content");
      assertEquals(hash1, hash2);
    });
  });

  describe("hashFile", () => {
    it("should return null for non-existent file", async () => {
      const result = await hashFile("/non/existent/file.txt");
      assertEquals(result, null);
    });

    it("should THROW (not silently return null) for a real read error (V6)", async () => {
      // Reading a directory as a file is a genuine read error, distinct
      // from "file doesn't exist" — must propagate, not be swallowed.
      const dir = await Deno.makeTempDir();
      try {
        await assertRejects(() => hashFile(dir));
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });
  });

  describe("hashTaskContent", () => {
    const projectRoot = Deno.cwd();

    it("should hash a real easy task with test files", async () => {
      const manifestPath =
        `${projectRoot}/tasks/easy/CG-AL-E008-basic-interface.yml`;
      const result = await hashTaskContent(manifestPath, projectRoot);

      assertEquals(result.taskId, "CG-AL-E008");
      assertExists(result.manifestHash);
      assertEquals(result.manifestHash.length, 16);
      assertExists(result.combinedHash);
      assertEquals(result.combinedHash.length, 16);

      // E008 should have test file and mock processor
      assertEquals(result.testFiles.length >= 1, true);
    });

    it("should include relative paths for test files", async () => {
      const manifestPath =
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`;
      const result = await hashTaskContent(manifestPath, projectRoot);

      // All paths should be relative (not absolute)
      for (const file of result.testFiles) {
        assertEquals(file.path.startsWith("/"), false);
        assertEquals(file.path.startsWith("U:"), false);
        assertEquals(file.path.includes("tests/al/"), true);
      }
    });

    it("should be deterministic", async () => {
      const manifestPath =
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`;
      const result1 = await hashTaskContent(manifestPath, projectRoot);
      const result2 = await hashTaskContent(manifestPath, projectRoot);

      assertEquals(result1.combinedHash, result2.combinedHash);
      assertEquals(result1.manifestHash, result2.manifestHash);
    });
  });

  describe("generateComprehensiveTaskSetHash", () => {
    const projectRoot = Deno.cwd();

    it("should hash multiple tasks", async () => {
      const manifests = [
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`,
        `${projectRoot}/tasks/easy/CG-AL-E008-basic-interface.yml`,
      ];

      const result = await generateComprehensiveTaskSetHash(
        manifests,
        projectRoot,
      );

      assertEquals(result.taskCount, 2);
      assertEquals(result.hash.length, 16);
      assertExists(result.testAppManifestHash);
      assertEquals(result.testAppManifestHash.length, 16);
      assertEquals(result.tasks.length, 2);
    });

    it("should be deterministic regardless of input order", async () => {
      const manifests1 = [
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`,
        `${projectRoot}/tasks/easy/CG-AL-E008-basic-interface.yml`,
      ];
      const manifests2 = [
        `${projectRoot}/tasks/easy/CG-AL-E008-basic-interface.yml`,
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`,
      ];

      const result1 = await generateComprehensiveTaskSetHash(
        manifests1,
        projectRoot,
      );
      const result2 = await generateComprehensiveTaskSetHash(
        manifests2,
        projectRoot,
      );

      assertEquals(result1.hash, result2.hash);
    });

    it("should count total files correctly", async () => {
      const manifests = [
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`,
      ];

      const result = await generateComprehensiveTaskSetHash(
        manifests,
        projectRoot,
      );

      // Should count: 1 manifest + test files + app.json
      assertEquals(result.totalFilesHashed >= 2, true);
    });

    it("should include app.json hash", async () => {
      const manifests = [
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`,
      ];

      const result = await generateComprehensiveTaskSetHash(
        manifests,
        projectRoot,
      );

      assertEquals(result.testAppManifestHash !== "missing", true);
      assertEquals(result.testAppManifestHash.length, 16);
    });

    it("should collect warnings for missing test files", async () => {
      // Create a temp manifest that won't have matching test files
      const tempDir = await Deno.makeTempDir();
      const tempManifest = `${tempDir}/CG-AL-X999-nonexistent.yml`;
      await Deno.writeTextFile(tempManifest, "id: CG-AL-X999\n");

      // This will fail because path doesn't have /easy/, /medium/, or /hard/
      // So we'll use a real manifest but with wrong testsAlDir
      const manifests = [
        `${projectRoot}/tasks/easy/CG-AL-E001-basic-table.yml`,
      ];

      const result = await generateComprehensiveTaskSetHash(
        manifests,
        projectRoot,
        "nonexistent/tests/al",
      );

      // Should have warnings about missing test files
      assertEquals(result.warnings.length > 0, true);

      await Deno.remove(tempDir, { recursive: true });
    });
  });
});
