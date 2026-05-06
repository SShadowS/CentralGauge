import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getFirst } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import { parseChangelog } from "$lib/server/changelog";
import type { ChangelogEntry, SummaryStats } from "$lib/shared/api-types";
import { CACHE_VERSION } from "$lib/server/cache-version";
// Build-time `?raw` import: Vite inlines the markdown file's contents as a
// string at bundle time. The path crosses the site/ boundary; the precedent
// is `site/src/lib/shared/canonical.ts` (re-export from `../../shared`).
// Edits to the markdown file require a redeploy — there is no runtime read
// (zero D1 writes; deterministic bundles).
import changelogMarkdown from "../../../../../../docs/site/changelog.md?raw";

const CACHE_TTL_SECONDS = 60;

// Parse once at module init. The result is shared across all requests
// served by this Worker isolate; it can never change without a redeploy.
const CHANGELOG_ENTRIES: ChangelogEntry[] = parseChangelog(changelogMarkdown);
const LATEST_CHANGELOG: ChangelogEntry | null = CHANGELOG_ENTRIES[0] ?? null;

/**
 * GET /api/v1/summary — aggregate counts + cost/token totals for the
 * site summary band (P7 Phase F home page). Computed from runs +
 * results + cost_snapshots in a single round-trip per field.
 *
 * `latest_changelog` is intentionally `null` at A-COMMIT; Phase F adds
 * the build-time markdown parse (`docs/site/changelog.md`) and wires
 * the entry through.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const cache = await platform!.caches.open("cg-summary");
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.set('_cv', CACHE_VERSION);
    const cacheKey = new Request(cacheUrl.toString(), {
      method: "GET",
    });

    let payload: SummaryStats | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as SummaryStats;
    }

    if (!payload) {
      // Single-row aggregates — null-safe via COALESCE on the numeric
      // fields. last_run_at returns null naturally when runs is empty.
      const counts = await getFirst<{
        runs: number;
        models: number;
        tasks: number;
        last_run_at: string | null;
      }>(
        env.DB,
        `
        SELECT
          (SELECT COUNT(*) FROM runs) AS runs,
          (SELECT COUNT(*) FROM models) AS models,
          (SELECT COUNT(*) FROM tasks
            WHERE task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
          ) AS tasks,
          (SELECT MAX(started_at) FROM runs) AS last_run_at
        `,
        [],
      );

      // Cost + tokens — joins results to runs to get pricing_version, then
      // to cost_snapshots for per-mtoken rates. Null-safe COALESCE so the
      // empty-runs / empty-results case yields 0 (not null).
      const cost = await getFirst<{
        total_cost_usd: number;
        total_tokens: number;
      }>(
        env.DB,
        `
        SELECT
          COALESCE(SUM(
            (r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0
          ), 0) AS total_cost_usd,
          COALESCE(SUM(r.tokens_in + r.tokens_out), 0) AS total_tokens
        FROM results r
        JOIN runs ON runs.id = r.run_id
        JOIN cost_snapshots cs ON cs.model_id = runs.model_id
          AND cs.pricing_version = runs.pricing_version
        `,
        [],
      );

      payload = {
        runs: +(counts?.runs ?? 0),
        models: +(counts?.models ?? 0),
        tasks: +(counts?.tasks ?? 0),
        total_cost_usd: Math.round((+(cost?.total_cost_usd ?? 0)) * 1e6) / 1e6,
        total_tokens: +(cost?.total_tokens ?? 0),
        last_run_at: counts?.last_run_at ?? null,
        // Build-time markdown parse of docs/site/changelog.md (Phase H).
        // `LATEST_CHANGELOG` is `null` only when the markdown file has zero
        // matching `## Title (YYYY-MM-DD)` headers (bootstrap-state safe).
        latest_changelog: LATEST_CHANGELOG,
        generated_at: new Date().toISOString(),
      };

      const storeRes = new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, s-maxage=${CACHE_TTL_SECONDS}`,
        },
      });
      await cache.put(cacheKey, storeRes);
    }

    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};
