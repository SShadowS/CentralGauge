/**
 * Push a local `Catalog` (families, models, pricing) to the production
 * admin API. Extracted from `cli/commands/sync-catalog-command.ts` (D8) so
 * `src/doctor/repair.ts`'s `syncCatalogRepairer` can call it in-process
 * instead of shelling out to a subprocess — a subprocess only exposes
 * combined stdout/stderr text, which can't carry a `Retry-After` header or
 * a structured per-row result back to the repairer.
 *
 * `postWithRetry` already retries an individual POST on 429, honoring
 * `Retry-After` when present. This module adds ONE further bounded retry
 * pass over whatever is still 429'd after that — e.g. the admin API's
 * ~10 req/min budget exhausted mid-batch for a 7+ row catalog — and reports
 * a resumable, per-item result so a caller always knows exactly which rows
 * still need syncing instead of a truncated tail of raw process output.
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
  /** True when the bounded retry pass ran (i.e. at least one item came back 429 on the first pass). */
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
 * row; any row still 429'd after `postWithRetry`'s own internal retries
 * triggers ONE further pass over just the 429'd rows, waiting once for the
 * largest `Retry-After` hint seen (capped, and falling back to a short
 * bounded default when the header is absent) — never a blanket 60s sleep.
 * Non-429 failures (bad signature, 5xx exhaustion, etc.) are not retried;
 * they are unrecoverable by waiting and are reported as-is.
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
      const sig = await signPayload(
        item.payload,
        adminPrivateKey,
        config.adminKeyId,
      );
      // maxAttempts: 1 — postWithRetry's own internal 429/5xx retry uses
      // real exponential backoff, which would stack on top of (and fight)
      // this function's own explicit two-pass, Retry-After-honoring retry.
      // syncCatalogToAdmin is the sole retry authority here.
      const resp = await postWithRetry(
        item.url,
        { version: 1, signature: sig, payload: item.payload },
        { ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}), maxAttempts: 1 },
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
      const result: SyncItemResult = {
        kind: item.kind,
        key: item.key,
        status: resp.status,
        ok: resp.ok,
      };
      results.push(result);
      opts.onItem?.(result);
    }
    return { results, retryAfterMs };
  }

  const items = buildItems(cat, config.url.replace(/\/+$/, ""));
  const first = await runPass(items);

  const retryable429Keys = new Set(
    first.results.filter((r) => r.status === 429).map((r) =>
      `${r.kind}:${r.key}`
    ),
  );
  if (retryable429Keys.size === 0) {
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
    retryable429Keys.has(`${it.kind}:${it.key}`)
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
