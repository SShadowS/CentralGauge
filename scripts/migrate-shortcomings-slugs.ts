/**
 * scripts/migrate-shortcomings-slugs.ts — Rewrite model-shortcomings/*.json
 * to use vendor-prefixed production slugs matching the catalog.
 *
 * Strategic plan: docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md Phase B Task B2.
 *
 * The 15-entry SLUG_MIGRATION_TABLE below is the AUTHORITATIVE mapping; do
 * not edit without updating the strategic plan.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/migrate-shortcomings-slugs.ts [--dir model-shortcomings] [--dry-run]
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";

export interface SlugMigrationRow {
  /** legacy `model` field from JSON */
  legacy: string;
  /** legacy filename (without dir) */
  legacyFile: string;
  /** new vendor-prefixed slug to write into the JSON `model` field */
  target: string;
}

/**
 * The authoritative 15-file migration table from the strategic plan
 * (Phase B Task B2). Editing this requires updating the strategic plan.
 */
export const SLUG_MIGRATION_TABLE: SlugMigrationRow[] = [
  // 2 mapped JSONs
  {
    legacy: "claude-opus-4-6",
    legacyFile: "claude-opus-4-6.json",
    target: "anthropic/claude-opus-4-6",
  },
  {
    legacy: "gpt-5.3-codex",
    legacyFile: "gpt-5.3-codex.json",
    target: "openai/gpt-5.3-codex",
  },
  // 6 unmapped legacy snapshots (collapse date suffix)
  {
    legacy: "claude-opus-4-5-20251101",
    legacyFile: "claude-opus-4-5-20251101.json",
    target: "anthropic/claude-opus-4-5",
  },
  {
    legacy: "claude-sonnet-4-6",
    legacyFile: "claude-sonnet-4-6.json",
    target: "anthropic/claude-sonnet-4-6",
  },
  {
    legacy: "claude-sonnet-4-5-20250929",
    legacyFile: "claude-sonnet-4-5-20250929.json",
    target: "anthropic/claude-sonnet-4-5",
  },
  {
    legacy: "gpt-5.2-2025-12-11",
    legacyFile: "gpt-5.2-2025-12-11.json",
    target: "openai/gpt-5.2",
  },
  {
    legacy: "gemini-3-pro-preview",
    legacyFile: "gemini-3-pro-preview.json",
    target: "google/gemini-3-pro-preview",
  },
  {
    legacy: "gemini-3.1-pro-preview",
    legacyFile: "gemini-3.1-pro-preview.json",
    target: "google/gemini-3.1-pro-preview",
  },
  // 7 vendor-prefixed via underscore (convert _ -> / and prepend openrouter/)
  {
    legacy: "deepseek_deepseek-v3.2",
    legacyFile: "deepseek_deepseek-v3.2.json",
    target: "openrouter/deepseek/deepseek-v3.2",
  },
  {
    legacy: "minimax_minimax-m2.5",
    legacyFile: "minimax_minimax-m2.5.json",
    target: "openrouter/minimax/minimax-m2.5",
  },
  {
    legacy: "moonshotai_kimi-k2.5",
    legacyFile: "moonshotai_kimi-k2.5.json",
    target: "openrouter/moonshotai/kimi-k2.5",
  },
  {
    legacy: "qwen_qwen3-max-thinking",
    legacyFile: "qwen_qwen3-max-thinking.json",
    target: "openrouter/qwen/qwen3-max-thinking",
  },
  {
    legacy: "qwen_qwen3-coder-next",
    legacyFile: "qwen_qwen3-coder-next.json",
    target: "openrouter/qwen/qwen3-coder-next",
  },
  {
    legacy: "x-ai_grok-code-fast-1",
    legacyFile: "x-ai_grok-code-fast-1.json",
    target: "openrouter/x-ai/grok-code-fast-1",
  },
  {
    legacy: "z-ai_glm-5",
    legacyFile: "z-ai_glm-5.json",
    target: "openrouter/z-ai/glm-5",
  },
];

export function resolveTargetSlug(legacy: string): string | null {
  return SLUG_MIGRATION_TABLE.find((r) => r.legacy === legacy)?.target ?? null;
}

export function resolveTargetFilename(targetSlug: string): string {
  return `${targetSlug.replaceAll("/", "_")}.json`;
}

interface CliOptions {
  dir: string;
  dryRun: boolean;
}

async function migrate(opts: CliOptions): Promise<{
  migrated: string[];
  missing: string[];
  alreadyMigrated: string[];
}> {
  const migrated: string[] = [];
  const missing: string[] = [];
  const alreadyMigrated: string[] = [];

  for (const row of SLUG_MIGRATION_TABLE) {
    const oldPath = `${opts.dir}/${row.legacyFile}`;
    const newName = resolveTargetFilename(row.target);
    const newPath = `${opts.dir}/${newName}`;

    let text: string;
    try {
      text = await Deno.readTextFile(oldPath);
    } catch {
      // Maybe already migrated.
      try {
        await Deno.stat(newPath);
        alreadyMigrated.push(row.legacyFile);
      } catch {
        missing.push(row.legacyFile);
      }
      continue;
    }

    const json = JSON.parse(text) as { model: string; [k: string]: unknown };
    json.model = row.target;
    const out = JSON.stringify(json, null, 2);
    if (opts.dryRun) {
      console.log(
        colors.yellow(
          `[DRY] ${oldPath} -> ${newPath} (model: ${row.legacy} -> ${row.target})`,
        ),
      );
    } else {
      await Deno.writeTextFile(newPath, out);
      if (newPath !== oldPath) {
        await Deno.remove(oldPath);
      }
      console.log(colors.green(`[OK] ${row.legacyFile} -> ${newName}`));
    }
    migrated.push(row.legacyFile);
  }

  return { migrated, missing, alreadyMigrated };
}

if (import.meta.main) {
  await new Command()
    .name("migrate-shortcomings-slugs")
    .description("Rewrite model-shortcomings/*.json to vendor-prefixed slugs.")
    .option("--dir <dir:string>", "Directory", {
      default: "model-shortcomings",
    })
    .option("--dry-run", "Preview without writing", { default: false })
    .action(async (opts) => {
      const result = await migrate({ dir: opts.dir, dryRun: opts.dryRun });
      console.log(
        colors.cyan(
          `migrated=${result.migrated.length} missing=${result.missing.length} already=${result.alreadyMigrated.length}`,
        ),
      );
      if (result.missing.length > 0) {
        console.log(colors.yellow("[WARN] missing files (not found in dir):"));
        for (const m of result.missing) console.log(`  - ${m}`);
      }
    })
    .parse(Deno.args);
}
