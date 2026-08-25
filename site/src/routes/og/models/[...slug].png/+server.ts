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

export const GET: RequestHandler = async ({ params, url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const env = platform.env;

  // Epoch-keyed named cache, checked BEFORE any D1 work. renderOgPng's own R2
  // cache is keyed on a payload derived from D1, so it saves the Satori render
  // and zero D1 rows — the caching has to happen here to matter.
  // Ordering contract (data-epoch.ts): epoch read first, never re-read.
  const ogCache = await platform.caches.open("cg-og");
  const epoch = await readDataEpoch(env.DB);
  const ogTtl = isFallbackEpoch(epoch)
    ? DEGRADED_TTL_SECONDS
    : EPOCH_KEYED_TTL_SECONDS;
  const ogKey = buildCacheKey("og-model", { slug: params.slug ?? "" }, epoch);
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
      console.error("[og-model] L1 backfill failed:", err)
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

  const slug = params.slug;
  const m = await env.DB.prepare(
    `SELECT m.id, m.display_name, mf.slug AS family_slug
     FROM models m JOIN model_families mf ON mf.id = m.family_id
     WHERE m.slug = ?`,
  ).bind(slug).first<
    { id: number; display_name: string; family_slug: string }
  >();
  if (!m) return new Response(`Unknown model: ${slug}`, { status: 404 });

  const taskSet = await env.DB.prepare(
    `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
  ).first<{ hash: string }>();
  const taskSetHash = taskSet?.hash ?? null;

  const agg = (await computeModelAggregates(env.DB, { modelIds: [m.id], taskSetHash })).get(
    m.id,
  );

  // Solve AUC@2: (2*passedA1 + passedA2Only) / (2*D)
  // D is back-derived: D = (p1 + p2) / pass_at_n when pass_at_n > 0.
  // Simplified: auc_2 = (2*p1 + p2) * pass_at_n / (2 * (p1 + p2))
  const p1 = agg?.tasks_passed_attempt_1 ?? 0;
  const p2 = agg?.tasks_passed_attempt_2_only ?? 0;
  const total = p1 + p2;
  const passAtN = agg?.pass_at_n ?? 0;
  // Guard total === 0 (model passed zero tasks): pass_at_n is also 0 there,
  // so auc_2 = 0 is correct and avoids 0/0 = NaN ("NaN%" on the card).
  const auc2 = total > 0
    ? (2 * p1 + p2) * passAtN / (2 * total)
    : 0;

  const out = await renderOgPng({
    kind: "model",
    slug,
    blobs: env.BLOBS,
    taskSetHash: taskSetHash ?? undefined,
    payload: {
      kind: "model",
      displayName: m.display_name,
      familySlug: m.family_slug,
      auc2,
      runCount: agg?.run_count ?? 0,
    },
  });

  const res = new Response(out.body, {
    headers: {
      "content-type": out.contentType,
      // Deliberately NOT a long s-maxage: .png URLs are edge-cached by URL,
      // and a URL-keyed copy carries no epoch, so a publish could not clear it.
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
  ).catch((err) => console.error("[og] cache put failed:", err));

  return res;
};
