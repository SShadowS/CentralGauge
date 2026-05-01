/**
 * Fetches the top-N most-recently-seen concepts from the prod registry.
 *
 * Used by the analyzer to seed the LLM prompt with existing slugs so the LLM
 * can propose `concept_slug_existing_match` rather than always inventing a
 * fresh slug. In-process memoization: one fetch per analyzer run lifetime
 * (5-minute TTL guards long-lived processes — verify-orchestrator and
 * cycle.analyze stay well below that).
 *
 * Non-fatal on registry outage: returns `[]`, the analyzer prompt then
 * instructs the LLM to invent fresh slugs. Resolver's tier-3 auto-create
 * path absorbs this gracefully.
 */

export interface ConceptSummary {
  slug: string;
  display_name: string;
  description: string;
  /** ISO timestamp of last sighting in the registry. */
  last_seen: string;
}

let cached: { ts: number; data: ConceptSummary[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export interface FetchOptions {
  recent: number;
  /** Site URL, e.g. "https://centralgauge.sshadows.workers.dev". */
  baseUrl: string;
  signal?: AbortSignal;
}

export async function fetchRecentConcepts(
  opts: FetchOptions,
): Promise<ConceptSummary[]> {
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return cached.data.slice(0, opts.recent);
  }
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/v1/concepts?recent=${
    encodeURIComponent(String(opts.recent))
  }`;
  const init: RequestInit = {};
  if (opts.signal) init.signal = opts.signal;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // Network error — analyzer continues with empty seed.
    return [];
  }
  if (!res.ok) {
    // Non-fatal: missing-registry → empty seed list. Analyzer still works.
    // Drain the body to release the underlying stream — Deno's test runner
    // flags an unconsumed response body as a leak.
    try {
      await res.body?.cancel();
    } catch { /* swallow */ }
    return [];
  }
  let body: { data?: ConceptSummary[] };
  try {
    body = (await res.json()) as { data?: ConceptSummary[] };
  } catch {
    try {
      await res.body?.cancel();
    } catch { /* swallow */ }
    return [];
  }
  const data = Array.isArray(body.data) ? body.data : [];
  cached = { ts: Date.now(), data };
  return data.slice(0, opts.recent);
}

/** Test-only: reset the in-process memo. */
export function _resetConceptCache(): void {
  cached = null;
}
