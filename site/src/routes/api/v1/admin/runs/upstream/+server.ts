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

    for (const e of p.results) {
      const row = await db
        .prepare(
          `SELECT served_upstream FROM results WHERE run_id = ? AND task_id = ? AND attempt = ?`,
        )
        .bind(p.run_id, e.task_id, e.attempt)
        .first<{ served_upstream: string | null }>();
      if (row && row.served_upstream !== null && row.served_upstream !== e.served_upstream) {
        throw new ApiError(
          409,
          "already_set",
          `(${e.task_id}, ${e.attempt}) already holds served_upstream ${row.served_upstream}`,
        );
      }
    }

    const stmts = p.results.map((e) =>
      db
        .prepare(
          `UPDATE results SET served_upstream = ?, upstream_identity_source = 'provider_field', upstream_verification = 'unpinned', requested_upstream = NULL
         WHERE run_id = ? AND task_id = ? AND attempt = ?`,
        )
        .bind(e.served_upstream, p.run_id, e.task_id, e.attempt)
    );
    stmts.push(
      appendAuditStmt(db, {
        event: "run.upstream_backfilled",
        actor: verified,
        details: { run_id: p.run_id, count: p.results.length },
      }),
    );
    stmts.push(forceBumpDataEpochStmt(db));
    await db.batch(stmts);

    return jsonResponse({ ok: true, run_id: p.run_id, updated: p.results.length }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
