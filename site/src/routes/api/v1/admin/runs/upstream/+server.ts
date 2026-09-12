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
 *
 * That rewrite is exactly why the endpoint refuses a run that WAS pinned
 * (`409 pinned_run`) and a row that already carries a real verdict
 * (`409 already_set`): either one would erase a recorded pin decision and
 * leave the row claiming it was never pinned, while the profile registry
 * still holds the pin.
 */
import type { RequestHandler } from "./$types";
import { forceBumpDataEpochStmt } from "$lib/server/data-epoch";
import { type SignedAdminRequest, verifySignedRequest } from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { appendAuditStmt } from "$lib/server/audit";
import { pinFromInvocationJson } from "$lib/server/upstream-summary";

/**
 * Verification states that record a real upstream check. A row holding one of
 * these is never rewritten to `unpinned` by a backfill; only a row that was
 * never checked (NULL) or was explicitly unpinned can take one.
 */
const SETTLED_VERIFICATIONS = new Set([
  "verified",
  "mismatch",
  "unverified",
  "not_served",
]);

interface Entry {
  task_id: string;
  attempt: 1 | 2;
  served_upstream: string;
}

interface Payload {
  run_id: string;
  results: Entry[];
}

interface BackfillOutcome {
  updated: number;
  unchanged: Array<{ task_id: string; attempt: 1 | 2 }>;
}

/**
 * Pure: derives which requested entries the guarded UPDATE batch actually
 * changed, from the `RETURNING` rows in each statement's `D1Result`. An
 * entry with a nonempty `results` array was matched and written; an empty
 * one lost a race to a concurrent write between this endpoint's own
 * pre-check and this batch.
 *
 * Exported (and structured to accept a fabricated batch result) so this
 * computation is unit-testable directly: two requests racing on the exact
 * same (task, attempt) cannot be made to interleave from outside this
 * endpoint in a synchronous test.
 */
export function _computeBackfillOutcome(
  entries: Entry[],
  batchResults: Array<{ results?: unknown[] }>,
): BackfillOutcome {
  const unchanged: Array<{ task_id: string; attempt: 1 | 2 }> = [];
  let updated = 0;
  entries.forEach((e, i) => {
    const rows = batchResults[i]?.results ?? [];
    if (rows.length > 0) {
      updated++;
    } else {
      unchanged.push({ task_id: e.task_id, attempt: e.attempt });
    }
  });
  return { updated, unchanged };
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

    const run = await db
      .prepare(`SELECT id, invocation_json FROM runs WHERE id = ?`)
      .bind(p.run_id)
      .first<{ id: string; invocation_json: string | null }>();
    if (!run) {
      throw new ApiError(404, "run_not_found", `run ${p.run_id} not found`);
    }

    // A pinned run already knows which upstream it asked for, and its rows
    // were verified against that pin at ingest. Backfilling it would set
    // `requested_upstream = NULL` and `upstream_verification = 'unpinned'`
    // on every named row while the profile registry still holds the pin,
    // which is a contradiction, not a repair.
    const runPin = pinFromInvocationJson(run.invocation_json);
    if (runPin !== null) {
      throw new ApiError(
        409,
        "pinned_run",
        `run ${p.run_id} pinned upstream ${runPin}; a pinned run's rows are not backfillable`,
      );
    }

    // Friendly, pre-write checks: a missing (task, attempt) is a caller
    // mistake (400), and a row already holding a DIFFERENT value is a
    // conflict (409). Neither check is sufficient on its own against a
    // concurrent second backfill request racing this one - the guarded
    // UPDATE below, and the RETURNING-derived outcome computed from it, are
    // the real guard.
    for (const e of p.results) {
      const row = await db
        .prepare(
          `SELECT served_upstream, upstream_verification FROM results WHERE run_id = ? AND task_id = ? AND attempt = ?`,
        )
        .bind(p.run_id, e.task_id, e.attempt)
        .first<{
          served_upstream: string | null;
          upstream_verification: string | null;
        }>();
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
      if (
        row.upstream_verification !== null &&
        SETTLED_VERIFICATIONS.has(row.upstream_verification)
      ) {
        throw new ApiError(
          409,
          "already_set",
          `(${e.task_id}, ${e.attempt}) already holds upstream_verification ${row.upstream_verification}`,
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
    //
    // This batch carries ONLY the guarded UPDATEs - the audit and the epoch
    // bump are NOT in it. A multi-entry request can partially succeed (one
    // entry's guard holds, another's loses a race), and the record must stay
    // honest about that: an audit written unconditionally in the same batch
    // would claim the full requested count even when only some rows changed,
    // while the caller was simultaneously told 409 as if nothing happened.
    const updateStmts = p.results.map((e) =>
      db
        .prepare(
          `UPDATE results SET served_upstream = ?, upstream_identity_source = 'provider_field', upstream_verification = 'unpinned', requested_upstream = NULL
         WHERE run_id = ? AND task_id = ? AND attempt = ? AND (served_upstream IS NULL OR served_upstream = ?)
         RETURNING task_id, attempt`,
        )
        .bind(e.served_upstream, p.run_id, e.task_id, e.attempt, e.served_upstream)
    );
    const batchResults = await db.batch(updateStmts);
    const { updated, unchanged } = _computeBackfillOutcome(p.results, batchResults);

    // Audit and bump run AFTER the update batch, as their own statements,
    // and only when something actually changed - so the audit record
    // reflects the real (possibly partial) outcome rather than the
    // requested one, and a fully-lost race never bumps the epoch for a
    // no-op write.
    if (updated > 0) {
      await db.batch([
        appendAuditStmt(db, {
          event: "run.upstream_backfilled",
          actor: verified,
          details: {
            run_id: p.run_id,
            requested: p.results.length,
            updated,
            unchanged,
          },
        }),
        forceBumpDataEpochStmt(db),
      ]);
    }

    if (unchanged.length > 0) {
      // Lost the race on at least one entry: a concurrent request set a
      // different value in between the pre-check and this batch. Any rows
      // that DID change are already committed and already audited above;
      // this only tells the caller the request as a whole did not fully
      // succeed.
      const names = unchanged.map((u) => `(${u.task_id}, ${u.attempt})`).join(", ");
      throw new ApiError(
        409,
        "already_set",
        `a concurrent backfill changed the requested value for ${names} on run ${p.run_id}`,
      );
    }

    return jsonResponse({ ok: true, run_id: p.run_id, updated }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
