/**
 * Page-loader mode passthrough (follow-up to spec D4,
 * docs/superpowers/specs/2026-09-06-batch-mode-design.md section 2).
 *
 * Every ranked API (leaderboard, matrix, compare, families/:slug,
 * models, models/:slug) resolves each model to exactly one invocation
 * mode (see `invocation-mode.ts`). Page loaders forward the caller's
 * `?mode=` through to the API. The API now resolves a mixed set to
 * `combined` itself, so the sync retry below only fires against an older
 * worker that still refuses with `mode_required`.
 */
import type { InvocationMode, RankMode } from "$lib/server/invocation-mode";

/**
 * Reads the `?mode=` query param. Returns `null` for absent, empty, or any
 * value other than `sync`/`batch` — this never throws; an invalid value is
 * simply treated as "not requested" and left for the API (or its own
 * default resolution) to handle.
 */
export function pageMode(url: URL): RankMode | null {
  const raw = url.searchParams.get("mode");
  if (raw === "sync" || raw === "batch" || raw === "combined") return raw;
  return null;
}

/**
 * Returns `path` with `mode` set to `mode` in its query string (or removed
 * when `mode` is null), keeping every other param verbatim and in place.
 */
export function withMode(
  path: string,
  params: URLSearchParams,
  mode: RankMode | null,
): string {
  const sp = new URLSearchParams(params);
  if (mode) {
    sp.set("mode", mode);
  } else {
    sp.delete("mode");
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface ModeFetchResult {
  res: Response;
  /** The mode actually served: `requested`, or `"sync"` after a fallback. */
  mode: RankMode | null;
  /** True when the API refused the unqualified request and a sync retry was made. */
  modeSplit: boolean;
}

/**
 * Fetches `buildUrl(requested)`. If an older worker refuses with `400
 * mode_required` (only possible when `requested` is null), retries
 * exactly once against `buildUrl("sync")`. Any other outcome (ok, or a non-ok
 * response for any other reason) is returned as-is with no retry.
 */
export async function fetchWithModeFallback(
  fetchFn: typeof fetch,
  buildUrl: (mode: RankMode | null) => string,
  requested: RankMode | null,
): Promise<ModeFetchResult> {
  const res = await fetchFn(buildUrl(requested));
  if (res.ok) {
    return { res, mode: requested, modeSplit: false };
  }

  if (res.status === 400) {
    let code: string | undefined;
    try {
      const body = (await res.clone().json()) as { code?: string };
      code = body.code;
    } catch {
      code = undefined;
    }
    if (code === "mode_required") {
      const fallbackRes = await fetchFn(buildUrl("sync"));
      return { res: fallbackRes, mode: "sync", modeSplit: true };
    }
  }

  return { res, mode: requested, modeSplit: false };
}
