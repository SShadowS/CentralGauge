/**
 * Known model slugs for the workbench dashboard's model picker, sourced from
 * the site's model catalog (`site/catalog/models.yml`) — the same file
 * `sync-catalog` reconciles against D1 (CLAUDE.md's "Catalog auto-seed").
 *
 * Read-only and best-effort: this module must never import the config
 * loader or anything under `src/ingest/` (same constraint as
 * `server.ts` — see `tests/unit/dashboard/ingest-safety.test.ts`), so it
 * parses the YAML directly rather than going through the catalog sync
 * machinery. A checkout without `site/` (or a `site/` whose catalog file is
 * malformed) must not break the dashboard — it just has no catalog slugs to
 * offer, on top of whatever `--preset` supplied.
 */

import { exists } from "@std/fs";
import { join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

/**
 * Per-repoRoot cache, not a single global — `catalogModelSlugs` is called
 * with different roots across a test run (each test's own temp dir), and a
 * single cache keyed on nothing would let the first caller's result leak
 * into every later one. Within one resolved root it is read at most once
 * per process, exactly as documented below.
 */
const cache = new Map<string, Promise<string[]>>();

/** Reads slug: entries from site/catalog/models.yml once; cached for process lifetime. */
export function catalogModelSlugs(repoRoot?: string): Promise<string[]> {
  const root = resolve(repoRoot ?? Deno.cwd());
  let cached = cache.get(root);
  if (!cached) {
    cached = readCatalogModelSlugs(root);
    cache.set(root, cached);
  }
  return cached;
}

async function readCatalogModelSlugs(repoRoot: string): Promise<string[]> {
  const catalogPath = join(repoRoot, "site", "catalog", "models.yml");
  if (!await exists(catalogPath)) {
    return [];
  }

  try {
    const text = await Deno.readTextFile(catalogPath);
    const parsed = parseYaml(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const slugs: string[] = [];
    for (const entry of parsed) {
      if (entry === null || typeof entry !== "object") continue;
      const slug = (entry as Record<string, unknown>)["slug"];
      if (typeof slug === "string") {
        slugs.push(slug);
      }
    }
    return slugs;
  } catch {
    // Unreadable or malformed catalog — same "never throw" contract as a
    // missing file, above.
    return [];
  }
}
