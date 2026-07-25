/**
 * Model Catalog Lookup
 *
 * Reads the curated `site/catalog/models.yml` seed to answer "is this
 * `<provider>/<model>` slug a model we know about", independent of live
 * provider discovery. Used as a fallback by {@link ModelDiscoveryService}
 * when a provider's discovery API omits a slug the catalog already knows
 * (e.g. Anthropic's `/v1/models` hides bare aliases like `claude-haiku-4-5`
 * even though the completion endpoint accepts them).
 *
 * @module src/llm/model-catalog
 */

import { parse as parseYaml } from "@std/yaml";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("llm:model-catalog");

/** Candidate locations for the catalog models seed (relative to cwd). */
const CATALOG_MODELS_PATHS = [
  "site/catalog/models.yml",
  "../site/catalog/models.yml",
  "../../site/catalog/models.yml",
];

/**
 * Minimal shape of a `site/catalog/models.yml` row consumed here. The slug
 * is already `<provider>/<model>` (matches the format callers key
 * `validateModel`/`validateModelAsync` with), so no field mapping is needed.
 */
export interface CatalogModelRow {
  slug: string;
  [key: string]: unknown;
}

/**
 * Lookup table over the catalog's known model slugs.
 */
export class ModelCatalog {
  /** Known `<provider>/<model>` slugs. Null = not yet loaded. */
  private static slugs: Set<string> | null = null;

  /**
   * Whether `<provider>/<model>` is a slug the catalog knows about.
   * Best-effort: a missing/unparseable catalog file resolves to `false`
   * rather than throwing, so a discovery-based validation can still succeed
   * or fail on its own merits.
   */
  static async isKnown(provider: string, model: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.slugs!.has(`${provider}/${model}`);
  }

  /**
   * Read `site/catalog/models.yml` from disk and load it. Skips if already
   * populated (e.g. a test injected rows via {@link loadRows}).
   */
  private static async ensureLoaded(): Promise<void> {
    if (this.slugs) return;
    for (const path of CATALOG_MODELS_PATHS) {
      try {
        const text = await Deno.readTextFile(path);
        const parsed = parseYaml(text);
        const rows = Array.isArray(parsed) ? parsed as CatalogModelRow[] : [];
        this.loadRows(rows);
        log.debug("Loaded model catalog", { path, rows: rows.length });
        return;
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) continue;
        log.debug("Failed to read model catalog", {
          path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    // No file found anywhere: empty set (non-null so we don't retry).
    this.slugs ??= new Set();
  }

  /**
   * Build the slug set from raw rows. Exposed for direct injection in tests.
   */
  static loadRows(rows: CatalogModelRow[]): void {
    const slugs = new Set<string>();
    for (const row of rows) {
      if (typeof row?.slug === "string") {
        slugs.add(row.slug);
      }
    }
    this.slugs = slugs;
  }

  /** Clear the loaded catalog (for testing). */
  static clear(): void {
    this.slugs = null;
  }
}
