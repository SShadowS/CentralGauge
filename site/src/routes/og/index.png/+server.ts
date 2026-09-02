import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { loadFlags } from "$lib/server/flags";
import { renderOgPng } from "$lib/server/og-render";
import { isCanary } from "$lib/server/canary";
import { computeModelAggregates } from "$lib/server/model-aggregates";
import {
  buildCacheKey,
  readDataEpoch,
  isFallbackEpoch,
  EPOCH_KEYED_TTL_SECONDS,
  DEGRADED_TTL_SECONDS,
} from "$lib/server/data-epoch";
import { sharedCacheGet, sharedCacheSet } from "$lib/server/shared-cache";
import { b64ToBytes, bytesToB64 } from "$shared/base64";

export const prerender = false;

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const env = platform.env;

  // Epoch-keyed named cache, checked BEFORE any D1 work.
  //
  // Placement matters: renderOgPng already has an R2 payload-hash cache, but it
  // is keyed on a payload this handler computes from D1 first, so it saves the
  // Satori render and ZERO D1 rows. The expensive part (computeModelAggregates
  // plus the count queries below) runs before it. Caching has to happen here.
  //
  // Ordering contract (data-epoch.ts): epoch read first, never re-read.
  const ogCache = await platform.caches.open("cg-og");
  const epoch = await readDataEpoch(env.DB);
  const ogTtl = isFallbackEpoch(epoch)
    ? DEGRADED_TTL_SECONDS
    : EPOCH_KEYED_TTL_SECONDS;
  const ogKey = buildCacheKey("og-index", {}, epoch);
  const ogHit = await ogCache.match(ogKey);
  if (ogHit) return ogHit;

  // L2: globally shared. The expensive part of this route is the D1 aggregate
  // above the render, so without a shared tier every colo repeats it after an
  // invalidation. PNG bytes are base64'd for the TEXT column — roughly a third
  // larger, still far under the 512KB cap.
  const ogShared = await sharedCacheGet(env.DB, ogKey.url, epoch);
  if (ogShared) {
    const decoded = b64ToBytes(ogShared);
    // Slice to an exact ArrayBuffer: Response wants a buffer, not a view, and
    // a view could in principle span a larger backing buffer.
    // `.buffer` is typed ArrayBufferLike (ArrayBuffer | SharedArrayBuffer);
    // b64ToBytes only ever allocates a plain ArrayBuffer.
    const bytes = decoded.buffer.slice(
      decoded.byteOffset,
      decoded.byteOffset + decoded.byteLength,
    ) as ArrayBuffer;
    const backfill = new Response(bytes, {
      headers: {
        "content-type": "image/png",
        "cache-control": `public, s-maxage=${ogTtl}`,
        "x-og-cache": "epoch",
      },
    });
    await ogCache.put(ogKey, backfill.clone()).catch((err) =>
      console.error("[og-index] L1 backfill failed:", err)
    );
    return backfill;
  }

  const flags = loadFlags(
    env as unknown as Record<string, string | undefined>,
    isCanary(url),
  );
  if (!flags.og_dynamic) {
    return new Response("og_dynamic flag is off", { status: 404 });
  }

  // 1. Aggregate inputs from D1 (counts + current task-set hash in parallel).
  const [counts, taskSet] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM models)                                         AS model_count,
         (SELECT COUNT(*) FROM runs)                                           AS run_count,
         (SELECT MAX(started_at) FROM runs)                                    AS last_run_at`,
    ).first<
      { model_count: number; run_count: number; last_run_at: string | null }
    >(),
    // 2. Cache key needs current task-set hash so a promotion invalidates fresh.
    env.DB.prepare(
      `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
    ).first<{ hash: string }>(),
  ]);

  // 3. Compute Solve AUC@2 for all models to find the leading value.
  //    auc_2 = (2*passedA1 + passedA2Only) / (2*D)
  //    The strict denominator D is not directly in the aggregate, but we can
  //    back-derive it: D = (passedA1 + passedA2Only) / pass_at_n (when > 0).
  //    Substituting: auc_2 = (2*p1 + p2) * pass_at_n / (2 * (p1 + p2))
  const aggMap = await computeModelAggregates(env.DB, {
    taskSetHash: taskSet?.hash ?? null,
  });
  let topAuc2 = 0;
  for (const agg of aggMap.values()) {
    const p1 = agg.tasks_passed_attempt_1;
    const p2 = agg.tasks_passed_attempt_2_only;
    const total = p1 + p2;
    // Guard total === 0 (model passed zero tasks): pass_at_n is also 0 there,
    // so auc_2 = 0 is correct and avoids 0/0 = NaN ("NaN%" on the card).
    const auc2 = total > 0
      ? (2 * p1 + p2) * agg.pass_at_n / (2 * total)
      : 0;
    if (auc2 > topAuc2) topAuc2 = auc2;
  }

  const out = await renderOgPng({
    kind: "index",
    blobs: env.BLOBS,
    taskSetHash: taskSet?.hash,
    payload: {
      kind: "index",
      modelCount: counts?.model_count ?? 0,
      runCount: counts?.run_count ?? 0,
      lastRunAt: counts?.last_run_at ?? "1970-01-01T00:00:00Z",
      topAuc2,
    },
  });

  const res = new Response(out.body, {
    headers: {
      "content-type": out.contentType,
      // Deliberately NOT a long s-maxage. These URLs end in .png, so
      // Cloudflare's edge already caches them by URL honoring this header — and
      // a URL-keyed edge copy carries no epoch, so a publish could not
      // invalidate it. Short here; the epoch-keyed named cache below is what
      // actually absorbs the load.
      "cache-control": out.cacheControl,
      "x-og-cache": out.cacheHit ? "hit" : "miss",
    },
  });

  // `out.body` is an ArrayBuffer, so both Responses are built from it directly.
  // Do not use res.clone(): cloning ties the stored copy's body to the returned
  // response's stream, and a failure there is swallowed by the catch below,
  // producing a silent cache that never populates.
  await sharedCacheSet(
    env.DB,
    ogKey.url,
    epoch,
    bytesToB64(new Uint8Array(out.body)),
  );

  await ogCache.put(
    ogKey,
    new Response(out.body, {
      headers: {
        "content-type": out.contentType,
        "cache-control": `public, s-maxage=${ogTtl}`,
        // Marks responses served from the epoch-keyed cache, which short-
        // circuits before any D1 work. Distinct from renderOgPng's own
        // "hit"/"miss", which only reports whether the Satori render was
        // reused and says nothing about read cost.
        "x-og-cache": "epoch",
      },
    }),
  ).catch((err) => console.error("[og-index] cache put failed:", err));

  return res;
};
