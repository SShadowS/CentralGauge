import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import {
  migrate,
  resolveTargetFilename,
  resolveTargetSlug,
  SLUG_MIGRATION_TABLE,
} from "../../../scripts/migrate-shortcomings-slugs.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

describe("migrate-shortcomings-slugs", () => {
  it("contains exactly 15 entries matching strategic plan B2", () => {
    assertEquals(SLUG_MIGRATION_TABLE.length, 15);
  });

  it("maps the 2 known JSONs (claude-opus-4-6, gpt-5.3-codex)", () => {
    assertEquals(
      resolveTargetSlug("claude-opus-4-6"),
      "anthropic/claude-opus-4-6",
    );
    assertEquals(resolveTargetSlug("gpt-5.3-codex"), "openai/gpt-5.3-codex");
  });

  it("collapses date suffix from claude-opus-4-5-20251101 to anthropic/claude-opus-4-5", () => {
    assertEquals(
      resolveTargetSlug("claude-opus-4-5-20251101"),
      "anthropic/claude-opus-4-5",
    );
    assertEquals(
      resolveTargetSlug("claude-sonnet-4-5-20250929"),
      "anthropic/claude-sonnet-4-5",
    );
    assertEquals(resolveTargetSlug("gpt-5.2-2025-12-11"), "openai/gpt-5.2");
  });

  it("maps gemini snapshots to google/", () => {
    assertEquals(
      resolveTargetSlug("gemini-3-pro-preview"),
      "google/gemini-3-pro-preview",
    );
    assertEquals(
      resolveTargetSlug("gemini-3.1-pro-preview"),
      "google/gemini-3.1-pro-preview",
    );
  });

  it("converts underscore-separated vendor slugs to openrouter/<vendor>/<model>", () => {
    assertEquals(
      resolveTargetSlug("deepseek_deepseek-v3.2"),
      "openrouter/deepseek/deepseek-v3.2",
    );
    assertEquals(
      resolveTargetSlug("minimax_minimax-m2.5"),
      "openrouter/minimax/minimax-m2.5",
    );
    assertEquals(
      resolveTargetSlug("moonshotai_kimi-k2.5"),
      "openrouter/moonshotai/kimi-k2.5",
    );
    assertEquals(
      resolveTargetSlug("qwen_qwen3-coder-next"),
      "openrouter/qwen/qwen3-coder-next",
    );
    assertEquals(
      resolveTargetSlug("qwen_qwen3-max-thinking"),
      "openrouter/qwen/qwen3-max-thinking",
    );
    assertEquals(
      resolveTargetSlug("x-ai_grok-code-fast-1"),
      "openrouter/x-ai/grok-code-fast-1",
    );
    assertEquals(resolveTargetSlug("z-ai_glm-5"), "openrouter/z-ai/glm-5");
  });

  it("resolveTargetFilename replaces `/` with `_` for fs-safe names", () => {
    assertEquals(
      resolveTargetFilename("anthropic/claude-opus-4-6"),
      "anthropic_claude-opus-4-6.json",
    );
    assertEquals(
      resolveTargetFilename("openrouter/deepseek/deepseek-v3.2"),
      "openrouter_deepseek_deepseek-v3.2.json",
    );
  });

  it("returns null for unknown legacy slugs", () => {
    assertEquals(resolveTargetSlug("unknown-model-slug"), null);
  });
});

describe("migrate() filesystem behavior (I4)", () => {
  /** Helper: write a fixture JSON keyed on legacy slug. */
  async function writeFixture(
    dir: string,
    legacyFile: string,
    legacySlug: string,
    extras: Record<string, unknown> = {},
  ): Promise<void> {
    await Deno.writeTextFile(
      `${dir}/${legacyFile}`,
      JSON.stringify({ model: legacySlug, ...extras }, null, 2),
    );
  }

  it("migrates 3 fixture JSONs to expected vendor-prefixed paths and rewrites the model field", async () => {
    const dir = await createTempDir("cg-migrate-i4-happy");
    try {
      // Pick three rows from the canonical 15-entry table covering each style:
      //  - already-vendor-prefixable (claude-opus-4-6 -> anthropic/claude-opus-4-6)
      //  - date-suffix collapse (claude-opus-4-5-20251101 -> anthropic/claude-opus-4-5)
      //  - underscore vendor split (deepseek_deepseek-v3.2 -> openrouter/deepseek/deepseek-v3.2)
      await writeFixture(
        dir,
        "claude-opus-4-6.json",
        "claude-opus-4-6",
        { shortcomings: [] },
      );
      await writeFixture(
        dir,
        "claude-opus-4-5-20251101.json",
        "claude-opus-4-5-20251101",
      );
      await writeFixture(
        dir,
        "deepseek_deepseek-v3.2.json",
        "deepseek_deepseek-v3.2",
      );

      const result = await migrate({ dir, dryRun: false, log: () => {} });

      // The 3 fixture files were migrated; the other 12 table rows are
      // genuinely missing on disk.
      assertEquals(result.migrated.length, 3);
      assertEquals(result.alreadyMigrated.length, 0);
      assertEquals(result.missing.length, SLUG_MIGRATION_TABLE.length - 3);

      // New paths exist with the rewritten `model` field; old paths gone.
      for (
        const [legacyFile, expectedNew, expectedSlug] of [
          [
            "claude-opus-4-6.json",
            "anthropic_claude-opus-4-6.json",
            "anthropic/claude-opus-4-6",
          ],
          [
            "claude-opus-4-5-20251101.json",
            "anthropic_claude-opus-4-5.json",
            "anthropic/claude-opus-4-5",
          ],
          [
            "deepseek_deepseek-v3.2.json",
            "openrouter_deepseek_deepseek-v3.2.json",
            "openrouter/deepseek/deepseek-v3.2",
          ],
        ] as const
      ) {
        const newText = await Deno.readTextFile(`${dir}/${expectedNew}`);
        const parsed = JSON.parse(newText) as { model: string };
        assertEquals(parsed.model, expectedSlug);
        // Old file removed (different name).
        await assertRejects(
          () => Deno.stat(`${dir}/${legacyFile}`),
          Deno.errors.NotFound,
        );
      }
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("re-running on already-migrated files reports already=N with no file modifications", async () => {
    const dir = await createTempDir("cg-migrate-i4-rerun");
    try {
      await writeFixture(
        dir,
        "claude-opus-4-6.json",
        "claude-opus-4-6",
      );
      await writeFixture(
        dir,
        "gpt-5.3-codex.json",
        "gpt-5.3-codex",
      );

      // First pass: migrate.
      const r1 = await migrate({ dir, dryRun: false, log: () => {} });
      assertEquals(r1.migrated.length, 2);
      assertEquals(r1.alreadyMigrated.length, 0);

      // Capture mtime + content of the migrated files.
      const newPath1 = `${dir}/anthropic_claude-opus-4-6.json`;
      const newPath2 = `${dir}/openai_gpt-5.3-codex.json`;
      const stat1Before = await Deno.stat(newPath1);
      const stat2Before = await Deno.stat(newPath2);
      const content1Before = await Deno.readTextFile(newPath1);
      const content2Before = await Deno.readTextFile(newPath2);

      // Second pass: must be no-op. The migrate loop reads oldPath
      // (legacy filename), fails (already gone), then stats newPath and
      // reports already-migrated — never touching disk.
      const r2 = await migrate({ dir, dryRun: false, log: () => {} });
      assertEquals(r2.migrated.length, 0);
      assertEquals(r2.alreadyMigrated.length, 2);

      // Content byte-identical (strongest guarantee — no rewrite happened).
      const content1After = await Deno.readTextFile(newPath1);
      const content2After = await Deno.readTextFile(newPath2);
      assertEquals(content1After, content1Before);
      assertEquals(content2After, content2Before);

      // mtime preserved (best-effort; some filesystems coarsen mtime, content
      // equality above is the load-bearing assertion).
      assertEquals(
        stat1Before.mtime?.getTime(),
        (await Deno.stat(newPath1)).mtime?.getTime(),
      );
      assertEquals(
        stat2Before.mtime?.getTime(),
        (await Deno.stat(newPath2)).mtime?.getTime(),
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("aborts cleanly with filename-anchored error on corrupt JSON; no partial migration on disk", async () => {
    const dir = await createTempDir("cg-migrate-i4-corrupt");
    try {
      // Two fixtures: a healthy one that comes BEFORE the corrupt file in the
      // table iteration order (claude-opus-4-6 is row 0), and a corrupt one
      // (gpt-5.3-codex is row 1). The corrupt file aborts the run; the
      // healthy file may have been migrated by then — that's fine, atomic
      // means PER-FILE not whole-batch. We assert that the CORRUPT file is
      // not partially written under its new name.
      await writeFixture(
        dir,
        "claude-opus-4-6.json",
        "claude-opus-4-6",
      );
      await Deno.writeTextFile(
        `${dir}/gpt-5.3-codex.json`,
        "{ this is not valid json",
      );

      let raised: Error | null = null;
      try {
        await migrate({ dir, dryRun: false, log: () => {} });
      } catch (e) {
        raised = e instanceof Error ? e : new Error(String(e));
      }
      // Error must reference the offending filename.
      assertEquals(raised !== null, true);
      assertEquals(raised!.message.includes("gpt-5.3-codex.json"), true);
      assertEquals(raised!.message.includes("Failed to parse JSON"), true);

      // The corrupt file is NOT renamed — its destination
      // (openai_gpt-5.3-codex.json) does NOT exist on disk.
      await assertRejects(
        () => Deno.stat(`${dir}/openai_gpt-5.3-codex.json`),
        Deno.errors.NotFound,
      );
      // The corrupt file itself remains untouched at its original path
      // (parse failed BEFORE write; the original file was never removed).
      const corruptStillThere = await Deno.readTextFile(
        `${dir}/gpt-5.3-codex.json`,
      );
      assertEquals(corruptStillThere, "{ this is not valid json");
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("dry-run on a fixture leaves the disk untouched", async () => {
    const dir = await createTempDir("cg-migrate-i4-dry");
    try {
      await writeFixture(
        dir,
        "claude-opus-4-6.json",
        "claude-opus-4-6",
      );
      const before = await Deno.readTextFile(`${dir}/claude-opus-4-6.json`);
      const result = await migrate({ dir, dryRun: true, log: () => {} });
      assertEquals(result.migrated.length, 1);
      const after = await Deno.readTextFile(`${dir}/claude-opus-4-6.json`);
      assertEquals(after, before);
      // No new file appeared.
      await assertRejects(
        () => Deno.stat(`${dir}/anthropic_claude-opus-4-6.json`),
        Deno.errors.NotFound,
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
