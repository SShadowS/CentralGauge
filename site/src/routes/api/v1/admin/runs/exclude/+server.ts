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
import {
  claimProfileStmt,
  conflictingRunIds,
  profileKeyOf,
  readProfile,
  releaseProfileIfEmptyStmt,
  STORED_KEY_SUBQUERY,
} from "$lib/server/upstream-profile";
import { pinFromInvocationJson } from "$lib/server/upstream-summary";

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
      .prepare(
        `SELECT id, excluded_at, excluded_reason, model_id, task_set_hash, invocation_mode, invocation_json FROM runs WHERE id = ?`,
      )
      .bind(p.run_id)
      .first<{
        id: string;
        excluded_at: string | null;
        excluded_reason: string | null;
        model_id: number;
        task_set_hash: string;
        invocation_mode: "sync" | "batch";
        invocation_json: string | null;
      }>();
    if (!existing) {
      throw new ApiError(404, "run_not_found", `run ${p.run_id} not found`);
    }

    const triple = {
      modelId: existing.model_id,
      taskSetHash: existing.task_set_hash,
      mode: existing.invocation_mode,
    };
    const key = profileKeyOf(pinFromInvocationJson(existing.invocation_json));

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

    // Registry maintenance rides in the SAME batch as the exclude/include
    // write, same contract as every other admin mutation: a committed
    // change can never be paired with a failed registry update.
    //
    // Exclude: releasing the row (only when no non-excluded run of the
    // triple remains) is what lets a replacement cohort claim it later,
    // matching the 409 advice on the ingest side. Include: re-claim the
    // triple, but refuse first if a DIFFERENT key already holds it, so
    // re-including a stale run can never silently reintroduce a mismatched
    // cohort.
    //
    // The pre-check (readProfile before the batch) gives the common case a
    // friendly, pre-write 409. It is NOT sufficient on its own: two
    // concurrent includes on the same triple with different keys can both
    // pass it before either writes. The batch itself is the real guard:
    // `claimProfileStmt` runs first (ON CONFLICT DO NOTHING, so only the
    // first of the two racers actually claims the triple), then the
    // un-exclude UPDATE is conditioned on the row's own key matching
    // whatever is stored for the triple AFTER that claim (statements in one
    // `db.batch()` execute sequentially in one transaction, so the UPDATE
    // sees the claim that just ran ahead of it). The loser's UPDATE matches
    // zero rows, so its run stays excluded; a re-read after the batch is how
    // the loser learns that and reports 409 instead of a false 200.
    let stmts: D1PreparedStatement[];
    if (p.exclude) {
      const update = db
        .prepare(
          `UPDATE runs SET excluded_at = ?, excluded_reason = ? WHERE id = ?`,
        )
        .bind(now, reason, p.run_id);
      const registryStmt = releaseProfileIfEmptyStmt(db, triple);
      stmts = [update, registryStmt, forceBumpDataEpochStmt(db)];
    } else {
      const stored = await readProfile(db, triple);
      if (stored && stored.key !== key) {
        const conflicts = await conflictingRunIds(db, triple, p.run_id);
        throw new ApiError(
          409,
          "upstream_profile_conflict",
          `including run ${p.run_id} would reintroduce profile key "${key}" alongside the stored "${stored.key}"; exclude the stored cohort first`,
          { stored_key: stored.key, key, conflicting_run_ids: conflicts },
        );
      }
      const claimStmt = claimProfileStmt(db, { ...triple, key, now });
      const guardedUpdate = db
        .prepare(
          `UPDATE runs SET excluded_at = NULL, excluded_reason = NULL
           WHERE id = ? AND ${STORED_KEY_SUBQUERY} = ?`,
        )
        .bind(p.run_id, triple.modelId, triple.taskSetHash, triple.mode, key);
      stmts = [claimStmt, guardedUpdate, forceBumpDataEpochStmt(db)];
    }

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
    await db.batch(stmts);

    if (!p.exclude) {
      // Losing race check: the guarded UPDATE above matched zero rows, so
      // the run is still excluded. Report the conflict rather than a false
      // 200 - the caller's include did not actually happen.
      const after = await db
        .prepare(`SELECT excluded_at FROM runs WHERE id = ?`)
        .bind(p.run_id)
        .first<{ excluded_at: string | null }>();
      if (after && after.excluded_at !== null) {
        const stored = await readProfile(db, triple);
        const conflicts = await conflictingRunIds(db, triple, p.run_id);
        throw new ApiError(
          409,
          "upstream_profile_conflict",
          `including run ${p.run_id} lost a race to claim profile key "${key}"; the triple now holds "${stored?.key}"`,
          { stored_key: stored?.key ?? null, key, conflicting_run_ids: conflicts },
        );
      }
    }

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
