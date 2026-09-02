import type { RequestHandler } from "./$types";
import { bumpDataEpoch } from "$lib/server/data-epoch";
import { sharedCacheGet, sharedCacheSet } from "$lib/server/shared-cache";
import { verifySignedRequest } from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import type {
  TaskSetSummary,
  TaskSetsResponse,
} from "$lib/shared/api-types";

import {
  buildCacheKey,
  readDataEpoch,
  isFallbackEpoch,
  EPOCH_KEYED_TTL_SECONDS,
  DEGRADED_TTL_SECONDS,
} from "$lib/server/data-epoch";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  try {
    const cache = await platform.caches.open("cg-task-sets");
    // Ordering contract (see data-epoch.ts): epoch read BEFORE any
    // query feeding the payload, and never re-read in the request.
    const epoch = await readDataEpoch(platform.env.DB);
    const ttl = isFallbackEpoch(epoch)
      ? DEGRADED_TTL_SECONDS
      : EPOCH_KEYED_TTL_SECONDS;
    // Key off parsed params only — never the raw URL. See buildCacheKey.
    const cacheKey = buildCacheKey("task-sets", {}, epoch);

    let payload: TaskSetsResponse | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as TaskSetsResponse;
    }

    // L2: globally shared. This route had L1 only, so every colo recomputed it.
    // Its payload is under a kilobyte, which is exactly why it was skipped —
    // and wrong: payload size is not query cost. Measured, this endpoint's
    // query reads tens of thousands of rows to produce that kilobyte.
    if (!payload) {
      const shared = await sharedCacheGet(platform.env.DB, cacheKey.url, epoch);
      if (shared) {
        payload = JSON.parse(shared) as TaskSetsResponse;
        await cache.put(
          cacheKey,
          new Response(shared, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": `public, s-maxage=${ttl}`,
            },
          }),
        ).catch((err) => console.error("[task-sets] L1 backfill failed:", err));
      }
    }

    if (!payload) {
      const rows = await getAll<{
        hash: string;
        display_name: string | null;
        task_count: number;
        run_count: number;
        is_current: number;
        created_at: string;
      }>(
        platform.env.DB,
        `SELECT
           ts.hash,
           ts.display_name,
           ts.task_count,
           ts.is_current,
           ts.created_at,
           (SELECT COUNT(*) FROM runs WHERE task_set_hash = ts.hash) AS run_count
         FROM task_sets ts
         ORDER BY ts.is_current DESC, ts.created_at DESC`,
        [],
      );

      const data: TaskSetSummary[] = rows.map((r) => ({
        hash: r.hash,
        short_hash: r.hash.slice(0, 8),
        display_name: r.display_name,
        task_count: +(r.task_count ?? 0),
        run_count: +(r.run_count ?? 0),
        is_current: r.is_current === 1,
        created_at: r.created_at,
      }));

      payload = { data, generated_at: new Date().toISOString() };

      const storeRes = new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control":
            `public, s-maxage=${ttl}`,
        },
      });
      await sharedCacheSet(platform.env.DB, cacheKey.url, epoch, JSON.stringify(payload));
      await cache.put(cacheKey, storeRes);
    }

    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};

interface TaskSetPayload {
  hash: string;
  created_at: string;
  task_count: number;
  tasks: Array<{
    task_id: string;
    content_hash: string;
    difficulty: "easy" | "medium" | "hard";
    category_slug: string;
    manifest: unknown;
  }>;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const db = platform.env.DB;

  try {
    const signed = (await request.json()) as {
      payload: TaskSetPayload;
      signature: {
        alg: "Ed25519";
        key_id: number;
        signed_at: string;
        value: string;
      };
      run_id?: string;
      version?: number;
    };
    if (!signed.signature) {
      throw new ApiError(400, "missing_signature", "signature block required");
    }
    const payload = signed.payload;
    if (!payload?.hash) {
      throw new ApiError(400, "bad_payload", "payload.hash required");
    }

    await verifySignedRequest(
      db,
      signed as unknown as {
        signature: {
          alg: "Ed25519";
          key_id: number;
          signed_at: string;
          value: string;
        };
        payload: Record<string, unknown>;
      },
      "ingest",
    );

    // Idempotent on (task_set_hash + tasks-populated). Three states:
    //   1. task_set + tasks fully present → 200 status:'exists', skip
    //   2. task_set present but tasks missing/incomplete → 200 status:'backfilled', insert tasks only
    //   3. task_set absent → 201 status:'created', insert task_set + tasks
    const existing = await db
      .prepare(`SELECT hash FROM task_sets WHERE hash = ?`)
      .bind(payload.hash)
      .first();
    const taskCountRow = await db
      .prepare(`SELECT COUNT(*) AS c FROM tasks WHERE task_set_hash = ?`)
      .bind(payload.hash)
      .first<{ c: number }>();
    const existingTaskRows = taskCountRow?.c ?? 0;
    if (existing && existingTaskRows >= payload.task_count) {
      return jsonResponse(
        {
          hash: payload.hash,
          task_count: payload.task_count,
          status: "exists",
        },
        200,
      );
    }

    const setupStatements: ReturnType<typeof db.prepare>[] = [];
    if (!existing) {
      setupStatements.push(
        db
          .prepare(
            `INSERT INTO task_sets(hash, created_at, task_count) VALUES (?,?,?)`,
          )
          .bind(payload.hash, payload.created_at, payload.task_count),
      );
    }

    for (const task of payload.tasks) {
      setupStatements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO task_categories(slug, name) VALUES (?, ?)`,
          )
          .bind(task.category_slug, task.category_slug),
      );
    }

    // Chunked below, so this write cannot be a single atomic batch and the bump
    // cannot ride along inside it. Instead the bump runs unconditionally after
    // the attempt, and a bump failure is fatal to the request — see below.
    let writeError: unknown = null;
    try {
      if (setupStatements.length > 0) await db.batch(setupStatements);

      // Insert tasks with INSERT OR IGNORE so partial backfills are safe to
      // retry (tasks table has PRIMARY KEY (task_set_hash, task_id) per schema).
      const taskStatements: ReturnType<typeof db.prepare>[] = [];
      for (const task of payload.tasks) {
        taskStatements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json)
               VALUES (?, ?, ?, ?, (SELECT id FROM task_categories WHERE slug = ?), ?)`,
            )
            .bind(
              payload.hash,
              task.task_id,
              task.content_hash,
              task.difficulty,
              task.category_slug,
              JSON.stringify(task.manifest),
            ),
        );
      }
      if (taskStatements.length > 0) {
        // D1 batch limit is ~50 statements/batch; chunk for safety on 64+ tasks.
        const CHUNK = 40;
        for (let i = 0; i < taskStatements.length; i += CHUNK) {
          await db.batch(taskStatements.slice(i, i + CHUNK));
        }
      }
    } catch (err) {
      writeError = err;
    }

    // Invalidate even when the writes threw: a partial write still changed
    // leaderboard-visible data, so the caches must not be trusted either way.
    const bumped = await bumpDataEpoch(db)
      .then(() => true)
      .catch((err) => {
        console.error("[task-sets] epoch bump failed:", err);
        return false;
      });

    // Surface the original write failure first — it is the more informative one.
    if (writeError) throw writeError;
    // Writes landed but invalidation did not. Reporting success here would tell
    // the caller their publish is live when every colo is still serving the old
    // aggregates for the next 24h, which is exactly the failure the epoch
    // scheme exists to prevent. Fail loudly instead.
    if (!bumped) {
      throw new ApiError(
        500,
        "epoch_bump_failed",
        "Writes committed but cache invalidation failed. Readers may serve pre-publish aggregates until the operator runs `npm run bump-epoch`.",
      );
    }

    const status = existing ? "backfilled" : "created";
    const httpStatus = existing ? 200 : 201;
    return jsonResponse(
      { hash: payload.hash, task_count: payload.task_count, status },
      httpStatus,
    );
  } catch (err) {
    return errorResponse(err);
  }
};
