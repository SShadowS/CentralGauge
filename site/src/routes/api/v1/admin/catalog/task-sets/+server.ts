import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

interface TaskSetUpsert {
  hash: string;
  created_at: string;
  task_count: number;
  set_current?: boolean;
  display_name?: string | null;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const body = await request.json() as {
      version: number;
      signature: any;
      payload: TaskSetUpsert;
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );
    const p = body.payload;
    if (!p.hash || !p.created_at || p.task_count == null) {
      throw new ApiError(
        400,
        "missing_field",
        "hash, created_at, task_count required",
      );
    }
    // Idempotent by hash; repeated uploads of the same task_set noop on the
    // immutable fields and let the operator update the optional display_name.
    await db.prepare(
      `INSERT INTO task_sets(hash, created_at, task_count, display_name, is_current)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(hash) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, task_sets.display_name)`,
    ).bind(p.hash, p.created_at, p.task_count, p.display_name ?? null).run();
    // Optional: atomically flip the current marker to this hash. Useful for
    // ingest paths where a freshly created task_set should immediately be
    // promoted as the leaderboard's "current" set.
    if (p.set_current === true) {
      await db.batch([
        db.prepare(`UPDATE task_sets SET is_current = 0 WHERE is_current = 1`),
        db.prepare(`UPDATE task_sets SET is_current = 1 WHERE hash = ?`).bind(
          p.hash,
        ),
      ]);
    }
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
