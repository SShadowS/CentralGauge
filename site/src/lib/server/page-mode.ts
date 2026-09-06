/**
 * Page-loader mode passthrough (follow-up to spec D4,
 * docs/superpowers/specs/2026-09-06-batch-mode-design.md section 2).
 *
 * Every ranked API (leaderboard, matrix, compare, families/:slug,
 * models, models/:slug) resolves to exactly one invocation mode and
 * refuses with `400 mode_required` when the current task set has runs in
 * both modes and no `?mode=` was given (see `invocation-mode.ts`). Page
 * loaders forward the caller's `?mode=` through to the API and, when the
 * API refuses because the mode is genuinely ambiguous, fall back to
 * `sync` — every historical run is sync and the published baseline is
 * sync — rather than surfacing a 400 to the visitor.
 */
import type { InvocationMode } from "$lib/server/invocation-mode";

/**
 * Reads the `?mode=` query param. Returns `null` for absent, empty, or any
 * value other than `sync`/`batch` — this never throws; an invalid value is
 * simply treated as "not requested" and left for the API (or its own
 * default resolution) to handle.
 */
export function pageMode(url: URL): InvocationMode | null {
  const raw = url.searchParams.get("mode");
  if (raw === "sync" || raw === "batch") return raw;
  return null;
}

/**
 * Returns `path` with `mode` set to `mode` in its query string (or removed
 * when `mode` is null), keeping every other param verbatim and in place.
 */
export function withMode(
  path: string,
  params: URLSearchParams,
  mode: InvocationMode | null,
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
  mode: InvocationMode | null;
  /** True when the API refused the unqualified request and a sync retry was made. */
  modeSplit: boolean;
}

/**
 * Fetches `buildUrl(requested)`. If the API refuses with `400
 * mode_required` (only possible when `requested` is null — an explicit
 * mode always short-circuits `resolveInvocationMode`), retries exactly
 * once against `buildUrl("sync")`. Any other outcome — ok, or a non-ok
 * response for any other reason — is returned as-is with no retry.
 */
export async function fetchWithModeFallback(
  fetchFn: typeof fetch,
  buildUrl: (mode: InvocationMode | null) => string,
  requested: InvocationMode | null,
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
