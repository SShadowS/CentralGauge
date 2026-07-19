/**
 * Push a local `Catalog` (families, models, pricing) to the production
 * admin API. Extracted from `cli/commands/sync-catalog-command.ts` (D8) so
 * `src/doctor/repair.ts`'s `syncCatalogRepairer` can call it in-process
 * instead of shelling out to a subprocess — a subprocess only exposes
 * combined stdout/stderr text, which can't carry a `Retry-After` header or
 * a structured per-row result back to the repairer.
 *
 * `syncCatalogToAdmin` is the SOLE retry authority: each POST goes through
 * `postWithRetry` with `maxAttempts: 1`, so `postWithRetry`'s own internal
 * per-request retry (real `setTimeout`-based exponential backoff) never
 * fires — it would otherwise stack on top of (and fight) the bounded retry
 * pass below. Instead, the first pass posts every row; any row that comes
 * back 429, comes back 5xx, or throws (network error — caught and reported
 * as a resumable item, never an uncaught rejection) triggers ONE further
 * pass over just those rows, waiting once for the largest `Retry-After`
 * hint seen among the 429s (capped, and falling back to a short bounded
 * default when no such header was present) — never a blanket 60s sleep.
 * Permanent 4xx failures (bad signature, etc.) are not retried; waiting
 * can't fix them, and they are reported as-is. This restores the
 * transient-error resilience both callers had before D8's rewrite (a
 * single 5xx or network blip is no longer a hard, unretried failure) while
 * keeping the retry logic deterministic and unit-testable (no real timers
 * hidden inside a dependency).
 * @module ingest/catalog/sync
 */
import type { AdminConfig } from "../types.ts";
import type { Catalog } from "./read.ts";
import { signPayload } from "../sign.ts";
import { postWithRetry, type RetryOptions } from "../client.ts";

export type SyncItemKind = "family" | "model" | "pricing";

export interface SyncItemResult {
  kind: SyncItemKind;
  /** slug for family/model rows; `${pricing_version}/${model_slug}` for pricing rows. */
  key: string;
  status: number;
  ok: boolean;
}

export interface SyncCatalogResult {
  /** One entry per catalog row, in family → model → pricing order. Resumable: filter on `!ok` to see exactly what's still outstanding. */
  items: SyncItemResult[];
  /** True when the bounded retry pass ran (i.e. at least one item was 429/5xx/thrown on the first pass). */
  retried: boolean;
  ok: boolean;
}

export interface SyncCatalogOptions {
  fetchFn?: RetryOptions["fetchFn"];
  onItem?: (result: SyncItemResult) => void;
  /** Upper bound on the single retry-pass wait, regardless of the Retry-After hint. Default 120_000ms. */
  maxRetryWaitMs?: number;
  /** Wait used for a 429 with no (or a non-positive) Retry-After header. Default 2_000ms. */
  defaultRetryWaitMs?: number;
  /** Injectable for tests; defaults to a real timer-based sleep. */
  sleepFn?: (ms: number) => Promise<void>;
}

interface PendingItem {
  kind: SyncItemKind;
  key: string;
  url: string;
  payload: Record<string, unknown>;
}

function pricingKey(
  p: { pricing_version: string; model_slug: string },
): string {
  return `${p.pricing_version}/${p.model_slug}`;
}

function buildItems(cat: Catalog, baseUrl: string): PendingItem[] {
  const items: PendingItem[] = [];
  for (const f of cat.families) {
    items.push({
      kind: "family",
      key: f.slug,
      url: `${baseUrl}/api/v1/admin/catalog/families`,
      payload: f as unknown as Record<string, unknown>,
    });
  }
  for (const m of cat.models) {
    items.push({
      kind: "model",
      key: m.slug,
      url: `${baseUrl}/api/v1/admin/catalog/models`,
      payload: m as unknown as Record<string, unknown>,
    });
  }
  for (const p of cat.pricing) {
    items.push({
      kind: "pricing",
      key: pricingKey(p),
      url: `${baseUrl}/api/v1/admin/catalog/pricing`,
      payload: p as unknown as Record<string, unknown>,
    });
  }
  return items;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync a catalog to the admin API. Two-pass: the first pass posts every
 * row (one attempt each — see module doc); any row that came back 429,
 * came back 5xx, or threw (network error) triggers ONE further pass over
 * just those rows, waiting once for the largest `Retry-After` hint seen
 * among the 429s (capped, falling back to a short bounded default when no
 * such header was present) — never a blanket 60s sleep. Permanent 4xx
 * failures (bad signature, etc.) are not retried; they are unrecoverable
 * by waiting and are reported as-is.
 */
export async function syncCatalogToAdmin(
  cat: Catalog,
  config: Pick<AdminConfig, "url" | "adminKeyId">,
  adminPrivateKey: Uint8Array,
  opts: SyncCatalogOptions = {},
): Promise<SyncCatalogResult> {
  const maxRetryWaitMs = opts.maxRetryWaitMs ?? 120_000;
  const defaultRetryWaitMs = opts.defaultRetryWaitMs ?? 2_000;
  const sleep = opts.sleepFn ?? defaultSleep;

  async function runPass(
    pending: PendingItem[],
  ): Promise<{ results: SyncItemResult[]; retryAfterMs: number | null }> {
    const results: SyncItemResult[] = [];
    let retryAfterMs: number | null = null;
    for (const item of pending) {
      let result: SyncItemResult;
      try {
        const sig = await signPayload(
          item.payload,
          adminPrivateKey,
          config.adminKeyId,
        );
        // maxAttempts: 1 — postWithRetry's own internal 429/5xx retry uses
        // real exponential backoff, which would stack on top of (and
        // fight) this function's own explicit two-pass, Retry-After-aware
        // retry below. syncCatalogToAdmin is the sole retry authority; a
        // thrown network error is caught below and folded into that same
        // bounded pass instead of escaping as an uncaught rejection.
        const resp = await postWithRetry(
          item.url,
          { version: 1, signature: sig, payload: item.payload },
          {
            ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
            maxAttempts: 1,
          },
        );
        if (resp.status === 429) {
          const header = resp.headers.get("retry-after");
          const hint = header ? Number(header) * 1000 : NaN;
          if (Number.isFinite(hint) && hint > 0) {
            retryAfterMs = retryAfterMs === null
              ? hint
              : Math.max(retryAfterMs, hint);
          }
        }
        result = {
          kind: item.kind,
          key: item.key,
          status: resp.status,
          ok: resp.ok,
        };
      } catch {
        // A thrown fetch/network error never produced a Response. Report
        // it as a resumable item (status 0 — a sentinel no real HTTP
        // status uses) instead of letting the rejection propagate out of
        // runPass uncaught; it's picked up by the retryable-status check
        // below just like a 429 or 5xx.
        result = { kind: item.kind, key: item.key, status: 0, ok: false };
      }
      results.push(result);
      opts.onItem?.(result);
    }
    return { results, retryAfterMs };
  }

  // Retryable: 429 (rate-limited), 5xx (transient server error), and 0
  // (thrown/network error sentinel — see runPass). A permanent 4xx (e.g.
  // bad signature) is unrecoverable by waiting and is excluded.
  function isRetryableStatus(status: number): boolean {
    return status === 429 || status === 0 || status >= 500;
  }

  const items = buildItems(cat, config.url.replace(/\/+$/, ""));
  const first = await runPass(items);

  const retryableKeys = new Set(
    first.results.filter((r) => isRetryableStatus(r.status)).map((r) =>
      `${r.kind}:${r.key}`
    ),
  );
  if (retryableKeys.size === 0) {
    return {
      items: first.results,
      retried: false,
      ok: first.results.every((r) => r.ok),
    };
  }

  const wait = Math.min(
    first.retryAfterMs !== null ? first.retryAfterMs : defaultRetryWaitMs,
    maxRetryWaitMs,
  );
  if (wait > 0) await sleep(wait);

  const retryItems = items.filter((it) =>
    retryableKeys.has(`${it.kind}:${it.key}`)
  );
  const second = await runPass(retryItems);
  const secondByKey = new Map(
    second.results.map((r) => [`${r.kind}:${r.key}`, r]),
  );
  const merged = first.results.map((r) =>
    secondByKey.get(`${r.kind}:${r.key}`) ?? r
  );

  return {
    items: merged,
    retried: true,
    ok: merged.every((r) => r.ok),
  };
}
