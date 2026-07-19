/**
 * Unit tests for src/prompts/knowledge-loader.ts
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import {
  hasKnowledgeOptions,
  loadKnowledgeFiles,
} from "../../../src/prompts/knowledge-loader.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

describe("loadKnowledgeFiles", () => {
  it("returns undefined when no files or directory are given", async () => {
    const result = await loadKnowledgeFiles({});
    assertEquals(result, undefined);
  });

  it("loads explicit files and formats them with headers", async () => {
    const dir = await createTempDir("knowledge-explicit");
    const filePath = join(dir, "rules.md");
    await Deno.writeTextFile(filePath, "Always test before shipping.");

    try {
      const result = await loadKnowledgeFiles({ files: [filePath] });
      assert(result);
      assert(result.includes("# Knowledge Bank"));
      assert(result.includes(filePath));
      assert(result.includes("Always test before shipping."));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("loads all .md files from a directory, sorted alphabetically", async () => {
    const dir = await createTempDir("knowledge-dir");
    await Deno.writeTextFile(join(dir, "b-rules.md"), "B content");
    await Deno.writeTextFile(join(dir, "a-rules.md"), "A content");
    await Deno.writeTextFile(join(dir, "ignored.txt"), "should not load");

    try {
      const result = await loadKnowledgeFiles({ directory: dir });
      assert(result);
      const aIndex = result.indexOf("A content");
      const bIndex = result.indexOf("B content");
      assert(aIndex >= 0 && bIndex >= 0 && aIndex < bIndex);
      assert(!result.includes("should not load"));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("loads both same-named files from different directories instead of the second overwriting the first (D6)", async () => {
    const root = await createTempDir("knowledge-dupe-basename");
    const dirA = join(root, "team-a");
    const dirB = join(root, "team-b");
    await Deno.mkdir(dirA, { recursive: true });
    await Deno.mkdir(dirB, { recursive: true });
    const fileA = join(dirA, "rules.md");
    const fileB = join(dirB, "rules.md");
    await Deno.writeTextFile(fileA, "Team A guidance.");
    await Deno.writeTextFile(fileB, "Team B guidance.");

    try {
      const result = await loadKnowledgeFiles({ files: [fileA, fileB] });
      assert(result);
      // Both contents present — pre-fix, the second (basename-keyed) write
      // silently clobbered the first in the Map.
      assert(result.includes("Team A guidance."));
      assert(result.includes("Team B guidance."));
      // Both distinct paths are shown as section headers so the two
      // "rules.md" sections are distinguishable.
      assert(result.includes(fileA));
      assert(result.includes(fileB));
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("combines explicit files with a directory", async () => {
    const dir = await createTempDir("knowledge-combo");
    const dirFile = join(dir, "from-dir.md");
    await Deno.writeTextFile(dirFile, "From directory");
    const explicitDir = await createTempDir("knowledge-combo-explicit");
    const explicitFile = join(explicitDir, "explicit.md");
    await Deno.writeTextFile(explicitFile, "From explicit list");

    try {
      const result = await loadKnowledgeFiles({
        files: [explicitFile],
        directory: dir,
      });
      assert(result);
      assert(result.includes("From directory"));
      assert(result.includes("From explicit list"));
    } finally {
      await cleanupTempDir(dir);
      await cleanupTempDir(explicitDir);
    }
  });

  it("throws when an explicit file does not exist", async () => {
    await assertRejects(
      () => loadKnowledgeFiles({ files: ["/does/not/exist/rules.md"] }),
      Error,
      "Knowledge file not found",
    );
  });

  it("throws when the directory does not exist", async () => {
    await assertRejects(
      () => loadKnowledgeFiles({ directory: "/does/not/exist/dir" }),
      Error,
      "Knowledge directory not found",
    );
  });
});

describe("hasKnowledgeOptions", () => {
  it("returns true when files are provided", () => {
    assertEquals(hasKnowledgeOptions({ files: ["a.md"] }), true);
  });

  it("returns true when a directory is provided", () => {
    assertEquals(hasKnowledgeOptions({ directory: "some/dir" }), true);
  });

  it("returns false for an empty options object", () => {
    assertEquals(hasKnowledgeOptions({}), false);
  });

  it("returns false for an empty files array and empty directory string", () => {
    assertEquals(hasKnowledgeOptions({ files: [], directory: "" }), false);
  });
});
