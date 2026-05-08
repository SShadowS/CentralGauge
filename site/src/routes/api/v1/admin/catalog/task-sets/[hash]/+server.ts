import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { getFirst } from "$lib/server/db";

interface DeletePayload {
  hash: string;
}

interface OrphanRow {
  k: string;
}

const HASH_RE = /^[0-9a-f]{64}$/;

export const DELETE: RequestHandler = async (
  { params, request, platform },
) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  const blobs: R2Bucket | undefined = platform.env.BLOBS;

  try {
    const urlHash = params.hash ?? "";
    if (!HASH_RE.test(urlHash)) {
      throw new ApiError(
        400,
        "invalid_hash",
        `hash must be a 64-char lowercase hex string (got "${urlHash}")`,
      );
    }

    const signed = (await request.json()) as unknown;
    if (
      typeof signed !== "object" || signed === null ||
      typeof (signed as { signature?: unknown }).signature !== "object" ||
      (signed as { signature: unknown }).signature === null ||
      typeof (signed as { payload?: unknown }).payload !== "object" ||
      (signed as { payload: unknown }).payload === null
    ) {
      throw new ApiError(
        400,
        "bad_envelope",
        "request body must be a signed envelope with {signature, payload}",
      );
    }
    const envelope = signed as SignedAdminRequest;
    if (envelope.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }

    await verifySignedRequest(db, envelope, "admin");

    const payload = envelope.payload as unknown as DeletePayload;
    if (typeof payload.hash !== "string" || payload.hash !== urlHash) {
      throw new ApiError(
        400,
        "hash_mismatch",
        "payload.hash must match URL hash",
      );
    }

    const row = await getFirst<{ hash: string; is_current: number }>(
      db,
      `SELECT hash, is_current FROM task_sets WHERE hash = ?`,
      [urlHash],
    );
    if (!row) {
      throw new ApiError(
        404,
        "task_set_not_found",
        `task_set ${urlHash.slice(0, 8)} not found`,
      );
    }
    if (row.is_current === 1) {
      throw new ApiError(
        409,
        "task_set_is_current",
        "refusing to delete the current task_set; flip is_current with set-current first",
      );
    }

    // Orphan blob keys: referenced by this set's runs but no other rows.
    // Single query keeps the refcount atomic relative to the snapshot we
    // observe before D1 deletes happen below.
    const orphanRows = await db
      .prepare(
        `SELECT v.k FROM (
           SELECT transcript_r2_key AS k FROM results
             WHERE run_id IN (SELECT id FROM runs WHERE task_set_hash = ?1)
               AND transcript_r2_key IS NOT NULL
           UNION
           SELECT code_r2_key FROM results
             WHERE run_id IN (SELECT id FROM runs WHERE task_set_hash = ?1)
               AND code_r2_key IS NOT NULL
           UNION
           SELECT reproduction_bundle_r2_key FROM runs
             WHERE task_set_hash = ?1
               AND reproduction_bundle_r2_key IS NOT NULL
         ) v
         WHERE NOT EXISTS (
           SELECT 1 FROM results r
             WHERE (r.transcript_r2_key = v.k OR r.code_r2_key = v.k)
               AND r.run_id NOT IN (SELECT id FROM runs WHERE task_set_hash = ?1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM runs r
             WHERE r.reproduction_bundle_r2_key = v.k
               AND r.task_set_hash != ?1
         )`,
      )
      .bind(urlHash)
      .all<OrphanRow>();
    const orphanKeys = (orphanRows.results ?? []).map((r) => r.k);

    // Pre-count for the response. Cheap (small per-set rowcounts) and lets
    // the CLI render a useful summary without re-issuing reads.
    const counts = await getFirst<{
      runs: number;
      results: number;
      ingest_events: number;
      lifecycle_events: number;
      family_diffs: number;
      tasks: number;
      run_verifications: number;
    }>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM runs WHERE task_set_hash = ?1) AS runs,
         (SELECT COUNT(*) FROM results
            WHERE run_id IN (SELECT id FROM runs WHERE task_set_hash = ?1)) AS results,
         (SELECT COUNT(*) FROM ingest_events
            WHERE run_id IN (SELECT id FROM runs WHERE task_set_hash = ?1)) AS ingest_events,
         (SELECT COUNT(*) FROM lifecycle_events WHERE task_set_hash = ?1) AS lifecycle_events,
         (SELECT COUNT(*) FROM family_diffs WHERE task_set_hash = ?1) AS family_diffs,
         (SELECT COUNT(*) FROM tasks WHERE task_set_hash = ?1) AS tasks,
         (SELECT COUNT(*) FROM run_verifications
            WHERE original_run_id IN (SELECT id FROM runs WHERE task_set_hash = ?1)
               OR verifier_run_id IN (SELECT id FROM runs WHERE task_set_hash = ?1)) AS run_verifications`,
      [urlHash],
    );

    // D1 FKs default off in worker (no PRAGMA foreign_keys=ON); cascade
    // explicitly. Batch is atomic: any statement failing rolls the whole
    // group back, so partial deletes can't leave dangling rows.
    await db.batch([
      db.prepare(
        `DELETE FROM run_verifications
           WHERE original_run_id IN (SELECT id FROM runs WHERE task_set_hash = ?)
              OR verifier_run_id IN (SELECT id FROM runs WHERE task_set_hash = ?)`,
      ).bind(urlHash, urlHash),
      db.prepare(
        `DELETE FROM results
           WHERE run_id IN (SELECT id FROM runs WHERE task_set_hash = ?)`,
      ).bind(urlHash),
      db.prepare(
        `DELETE FROM ingest_events
           WHERE run_id IN (SELECT id FROM runs WHERE task_set_hash = ?)`,
      ).bind(urlHash),
      db.prepare(`DELETE FROM lifecycle_events WHERE task_set_hash = ?`).bind(
        urlHash,
      ),
      db.prepare(`DELETE FROM family_diffs WHERE task_set_hash = ?`).bind(
        urlHash,
      ),
      db.prepare(`DELETE FROM runs WHERE task_set_hash = ?`).bind(urlHash),
      db.prepare(`DELETE FROM tasks WHERE task_set_hash = ?`).bind(urlHash),
      db.prepare(`DELETE FROM task_sets WHERE hash = ?`).bind(urlHash),
    ]);

    // R2 cleanup happens AFTER D1 commits. If R2 partially fails, D1 stays
    // consistent; orphan blobs leak but storage cost is trivial and they
    // can be reaped later. The reverse order would risk 404s on transcripts
    // if D1 rolled back.
    let blobsDeleted = 0;
    let blobsFailed = 0;
    if (blobs && orphanKeys.length > 0) {
      const settled = await Promise.allSettled(
        orphanKeys.map((k) => blobs.delete(k)),
      );
      for (const s of settled) {
        if (s.status === "fulfilled") blobsDeleted++;
        else blobsFailed++;
      }
    }

    return jsonResponse({
      hash: urlHash,
      deleted: {
        task_sets: 1,
        runs: counts?.runs ?? 0,
        results: counts?.results ?? 0,
        ingest_events: counts?.ingest_events ?? 0,
        lifecycle_events: counts?.lifecycle_events ?? 0,
        family_diffs: counts?.family_diffs ?? 0,
        tasks: counts?.tasks ?? 0,
        run_verifications: counts?.run_verifications ?? 0,
      },
      blobs: {
        deleted: blobsDeleted,
        failed: blobsFailed,
        candidates: orphanKeys.length,
      },
    }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
