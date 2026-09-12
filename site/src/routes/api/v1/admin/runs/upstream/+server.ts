/**
 * `POST /api/v1/admin/runs/upstream`: per-(task, attempt) backfill of
 * `served_upstream` for a run ingested before upstream capture existed
 * (spec 2026-09-11, OpenRouter upstream lock, Task 13).
 *
 * Same signed envelope as the other admin routes: `version: 1`, an Ed25519
 * signature over the canonical payload, `admin` scope.
 *
 * Body payload:
 *   { run_id: string, results: Array<{ task_id: string, attempt: 1 | 2, served_upstream: string }> }
 *
 * Every named (task, attempt) is set to `upstream_identity_source =
 * 'provider_field'`, `upstream_verification = 'unpinned'`,
 * `requested_upstream = NULL`, since a backfilled row was never pinned in the
 * first place, only its provider-reported upstream is now known. Only the
 * named rows change; the rest of the run is left untouched.
 */
import type { RequestHandler } from "./$types";
import { forceBumpDataEpochStmt } from "$lib/server/data-epoch";
import { type SignedAdminRequest, verifySignedRequest } from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { appendAuditStmt } from "$lib/server/audit";

interface Entry {
  task_id: string;
  attempt: 1 | 2;
  served_upstream: string;
}

interface Payload {
  run_id: string;
  results: Entry[];
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(new ApiError(500, "no_platform", "platform env missing"));
  }
  const db = platform.env.DB;
  try {
    const body = (await request.json()) as {
      version: number;
      signature: unknown;
      payload: Payload;
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    const verified = await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );

    const p = body.payload;
    if (!p || typeof p.run_id !== "string" || p.run_id === "") {
      throw new ApiError(400, "missing_field", "run_id required");
    }
    if (!Array.isArray(p.results)) {
      throw new ApiError(400, "missing_field", "results must be an array");
    }

    const seen = new Set<string>();
    for (const e of p.results) {
      if (
        !e ||
        typeof e.task_id !== "string" ||
        (e.attempt !== 1 && e.attempt !== 2) ||
        typeof e.served_upstream !== "string" ||
        e.served_upstream.length === 0 ||
        e.served_upstream.length > 128
      ) {
        throw new ApiError(
          400,
          "invalid_entry",
          "each entry needs task_id, attempt 1|2 and a served_upstream of 1..128 chars",
        );
      }
      const k = `${e.task_id}#${e.attempt}`;
      if (seen.has(k)) {
        throw new ApiError(
          400,
          "duplicate_attempt",
          `duplicate (${e.task_id}, ${e.attempt}) in request`,
        );
      }
      seen.add(k);
    }

    const run = await db.prepare(`SELECT id FROM runs WHERE id = ?`).bind(p.run_id).first();
    if (!run) {
      throw new ApiError(404, "run_not_found", `run ${p.run_id} not found`);
    }

    // Friendly, pre-write checks: a missing (task, attempt) is a caller
    // mistake (400), and a row already holding a DIFFERENT value is a
    // conflict (409). Neither check is sufficient on its own against a
    // concurrent second backfill request racing this one - the guarded
    // UPDATE below, and the post-batch changes count, are the real guard.
    for (const e of p.results) {
      const row = await db
        .prepare(
          `SELECT served_upstream FROM results WHERE run_id = ? AND task_id = ? AND attempt = ?`,
        )
        .bind(p.run_id, e.task_id, e.attempt)
        .first<{ served_upstream: string | null }>();
      if (!row) {
        throw new ApiError(
          400,
          "unknown_attempt",
          `(${e.task_id}, ${e.attempt}) has no result row on run ${p.run_id}`,
        );
      }
      if (row.served_upstream !== null && row.served_upstream !== e.served_upstream) {
        throw new ApiError(
          409,
          "already_set",
          `(${e.task_id}, ${e.attempt}) already holds served_upstream ${row.served_upstream}`,
        );
      }
    }

    // Guarded so a value set concurrently, between the pre-check above and
    // this batch, cannot be silently overwritten: the UPDATE only applies
    // when the row is still NULL or already holds the exact value being
    // requested. A racing writer that got there first with a DIFFERENT
    // value makes this match zero rows.
    //
    // Counted via `RETURNING`, not `meta.changes`: the `results` table
    // carries FTS5 triggers (results_fts_ai/au, migration 0002_fts.sql)
    // whose shadow-table writes are folded into SQLite's changes() count
    // for the statement that fired them, so `meta.changes` on this table is
    // not the row count this UPDATE itself matched (confirmed empirically:
    // it returned 5/9/4 for single-row UPDATEs, nonzero even for a guard
    // miss that touched nothing). `RETURNING` reports exactly the rows this
    // statement wrote, unaffected by trigger side effects.
    const updateStmts = p.results.map((e) =>
      db
        .prepare(
          `UPDATE results SET served_upstream = ?, upstream_identity_source = 'provider_field', upstream_verification = 'unpinned', requested_upstream = NULL
         WHERE run_id = ? AND task_id = ? AND attempt = ? AND (served_upstream IS NULL OR served_upstream = ?)
         RETURNING task_id, attempt`,
        )
        .bind(e.served_upstream, p.run_id, e.task_id, e.attempt, e.served_upstream)
    );
    const auditStmt = appendAuditStmt(db, {
      event: "run.upstream_backfilled",
      actor: verified,
      details: { run_id: p.run_id, count: p.results.length },
    });
    const bumpStmt = forceBumpDataEpochStmt(db);
    const results = await db.batch([...updateStmts, auditStmt, bumpStmt]);

    const updated = updateStmts.reduce(
      (sum, _stmt, i) => sum + (results[i]?.results?.length ?? 0),
      0,
    );
    if (updated < p.results.length) {
      // Lost the race: at least one guarded UPDATE matched zero rows
      // because a concurrent request set a different value in between the
      // pre-check and this batch.
      throw new ApiError(
        409,
        "already_set",
        `a concurrent backfill changed at least one of the requested (task, attempt) rows on run ${p.run_id}`,
      );
    }

    return jsonResponse({ ok: true, run_id: p.run_id, updated }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
