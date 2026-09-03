/**
 * Request-context resolution shared by every `/api/v2/*` route (Task 7).
 *
 * A v2 request always pins its response to a specific taxonomy revision
 * (never "whatever is active right now, unpinned") and, when the task set
 * carries one, a scoring policy — both digests ride along in the response
 * envelope so a client can detect exactly what generated a payload.
 */

import { ApiError } from "./errors";
import { CACHE_VERSION } from "./cache-version";
import { type ActiveRevision, readActiveRevision } from "./taxonomy-v2";
import type { V2Envelope } from "../shared/api-types";

const HASH_RE = /^[0-9a-f]{64}$/i;

export interface V2Context {
  task_set_hash: string;
  revision: ActiveRevision;
  scoring_policy: { id: number; digest: string; policy: unknown } | null;
  query: Record<string, string>;
}

/**
 * Resolve `?set=` (default `current`) to a task-set hash, then `?revision=`
 * (default: that set's active revision) to a verified `taxonomy_revisions`
 * row, plus the scoring policy the set currently points at (if any).
 *
 * Throws `ApiError`:
 *  - 400 `invalid_set` — `set` is neither `current` nor a 64-hex hash.
 *  - 404 `no_current_task_set` — `set=current` but no task_set has
 *    `is_current = 1`.
 *  - 404 `no_revision` — `?revision=` was given but no VERIFIED revision
 *    with that digest exists for the resolved set.
 *  - 404 `no_active_revision` — no `?revision=` given and the set has no
 *    active (schema-version-2) taxonomy.
 */
export async function resolveV2Context(
  db: D1Database,
  url: URL,
): Promise<V2Context> {
  const set = url.searchParams.get("set")?.trim() || "current";
  let hash: string;
  if (set === "current") {
    const row = await db
      .prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`)
      .first<{ hash: string }>();
    if (!row)
      throw new ApiError(404, "no_current_task_set", "no current task set");
    hash = row.hash;
  } else if (HASH_RE.test(set)) {
    hash = set.toLowerCase();
  } else {
    throw new ApiError(
      400,
      "invalid_set",
      "set must be 'current' or a 64-hex hash",
    );
  }

  const wanted = url.searchParams.get("revision")?.trim();
  let revision: ActiveRevision | null;
  if (wanted) {
    revision = await db
      .prepare(
        `SELECT id, digest, schema_version, verified_at FROM taxonomy_revisions
         WHERE task_set_hash = ? AND digest = ? AND verified_at IS NOT NULL`,
      )
      .bind(hash, wanted)
      .first<ActiveRevision>();
    if (!revision) {
      throw new ApiError(
        404,
        "no_revision",
        `no verified revision ${wanted} for this set`,
      );
    }
  } else {
    revision = await readActiveRevision(db, hash);
    if (!revision) {
      throw new ApiError(
        404,
        "no_active_revision",
        "this set has no active schema-version-2 taxonomy",
      );
    }
  }

  const pol = await db
    .prepare(
      `SELECT p.id, p.digest, p.policy_json FROM task_sets t
       JOIN scoring_policies p ON p.id = t.scoring_policy_id WHERE t.hash = ?`,
    )
    .bind(hash)
    .first<{ id: number; digest: string; policy_json: string }>();

  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (!k.startsWith("_")) query[k] = v;

  return {
    task_set_hash: hash,
    revision,
    scoring_policy: pol
      ? { id: pol.id, digest: pol.digest, policy: JSON.parse(pol.policy_json) }
      : null,
    query,
  };
}

export function v2Envelope(ctx: V2Context): V2Envelope {
  return {
    schema_version: 2,
    task_set_hash: ctx.task_set_hash,
    revision_digest: ctx.revision.digest,
    scoring_policy_digest: ctx.scoring_policy?.digest ?? null,
    generated_at: new Date().toISOString(),
    query: ctx.query,
  };
}

/**
 * Serialize `body` merged with the v2 envelope, serving/storing through the
 * `"v2"` named Cache API store (never `caches.default` — see CLAUDE.md
 * "Workers KV / Cache API"). The cache key folds in `CACHE_VERSION` plus the
 * resolved revision + scoring-policy digests, so a response is only ever
 * served back for the exact (deploy version, revision, policy) it was
 * generated under — a stale revision can never be served past its own
 * change.
 */
export async function v2Json(
  req: Request,
  ctx: V2Context,
  body: Record<string, unknown>,
  ttlSeconds = 60,
): Promise<Response> {
  const cache = await caches.open("v2");
  const url = new URL(req.url);
  url.searchParams.set("_cv", CACHE_VERSION);
  url.searchParams.set("_rev", ctx.revision.digest);
  url.searchParams.set("_pol", ctx.scoring_policy?.digest ?? "none");
  const key = new Request(url.toString(), { method: "GET" });

  const hit = await cache.match(key);
  if (hit) return hit;

  const res = new Response(JSON.stringify({ ...v2Envelope(ctx), ...body }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${ttlSeconds}`,
    },
  });
  // Inline (not ctx.waitUntil) so the next request — and tests — observe
  // the cached entry deterministically. CLAUDE.md "Workers KV / Cache API".
  await cache.put(key, res.clone());
  return res;
}
