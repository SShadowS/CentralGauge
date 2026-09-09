/**
 * `POST /api/v1/admin/runs/exclude`: soft-exclude a run from every statistic,
 * or put it back (migration 0022).
 *
 * Same signed envelope as the catalog admin routes: `version: 1`, an Ed25519
 * signature over the canonical payload, `admin` scope. Rate limiting is not
 * applied here explicitly. `hooks.server.ts` limits every write method under
 * `/api/` outside the lifecycle prefix, so this route inherits it.
 *
 * Body payload:
 *   { run_id: string, reason: string, exclude: boolean }
 *
 * `exclude: true`  sets `excluded_at = now` and `excluded_reason = reason`.
 * `exclude: false` clears both; `reason` is then ignored and may be empty.
 *
 * Idempotent in both directions. Re-excluding an already-excluded run
 * refreshes its timestamp and reason (that is how an operator corrects a
 * reason); re-including an included run is a no-op that still answers 200.
 * The response says which it was via `changed`, so a caller can tell a real
 * transition from a repeat.
 */
import type { RequestHandler } from "./$types";
import { forceBumpDataEpochStmt } from "$lib/server/data-epoch";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { appendAudit } from "$lib/server/audit";

interface RunExcludePayload {
  run_id: string;
  reason: string;
  exclude: boolean;
}

/** Bounded so a malformed client cannot stuff arbitrary data into the column. */
const MAX_REASON_LENGTH = 500;

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const body = (await request.json()) as {
      version: number;
      signature: unknown;
      payload: RunExcludePayload;
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
    if (typeof p.exclude !== "boolean") {
      throw new ApiError(400, "missing_field", "exclude must be a boolean");
    }

    const reason = typeof p.reason === "string" ? p.reason.trim() : "";
    if (p.exclude && reason === "") {
      // An exclusion without a stated reason is unauditable: six months on,
      // nobody can tell an infra fault from a quiet score edit.
      throw new ApiError(
        400,
        "reason_required",
        "reason is required when excluding a run",
      );
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw new ApiError(
        400,
        "reason_too_long",
        `reason must be <= ${MAX_REASON_LENGTH} characters`,
      );
    }

    const existing = await db
      .prepare(`SELECT id, excluded_at, excluded_reason FROM runs WHERE id = ?`)
      .bind(p.run_id)
      .first<{
        id: string;
        excluded_at: string | null;
        excluded_reason: string | null;
      }>();
    if (!existing) {
      throw new ApiError(404, "run_not_found", `run ${p.run_id} not found`);
    }

    const wasExcluded = existing.excluded_at !== null;
    const now = new Date().toISOString();

    if (!p.exclude && !wasExcluded) {
      // Nothing to undo. Answer 200 (the caller's intent is already the
      // state) but skip the write AND the epoch bump. No cached ranking
      // needs retiring for a no-op.
      return jsonResponse(
        {
          ok: true,
          run_id: p.run_id,
          excluded: false,
          changed: false,
        },
        200,
      );
    }

    const update = p.exclude
      ? db
          .prepare(
            `UPDATE runs SET excluded_at = ?, excluded_reason = ? WHERE id = ?`,
          )
          .bind(now, reason, p.run_id)
      : db
          .prepare(
            `UPDATE runs SET excluded_at = NULL, excluded_reason = NULL WHERE id = ?`,
          )
          .bind(p.run_id);

    // In-batch with the write, same contract as every other admin mutation:
    // a committed change can never be paired with a failed epoch bump, so a
    // cached leaderboard cannot survive a change to what it ranks.
    //
    // FORCED rather than the ordinary debounced mark. `bumpDataEpochStmt`
    // sets `pending_since` and lets a reader promote it once DEBOUNCE_MS has
    // passed, which is right for a bench ingest writing continuously for
    // minutes. This is a deliberate operator action on one row: someone who
    // just ran `centralgauge runs exclude` should not stare at the old
    // numbers for up to a minute wondering whether it worked.
    await db.batch([update, forceBumpDataEpochStmt(db)]);

    await appendAudit(db, {
      event: p.exclude ? "run.excluded" : "run.included",
      actor: verified,
      before: existing.excluded_at,
      after: p.exclude ? now : null,
      details: {
        run_id: p.run_id,
        reason: p.exclude ? reason : null,
        previous_reason: existing.excluded_reason,
        was_excluded: wasExcluded,
      },
    });

    return jsonResponse(
      {
        ok: true,
        run_id: p.run_id,
        excluded: p.exclude,
        // False when re-excluding an already-excluded run only refreshed its
        // reason/timestamp, true for a real state transition.
        changed: p.exclude !== wasExcluded,
        ...(p.exclude ? { excluded_at: now, excluded_reason: reason } : {}),
      },
      200,
    );
  } catch (err) {
    return errorResponse(err);
  }
};
