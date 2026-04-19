import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { runBatch } from '$lib/server/db';

const PROMOTION_THRESHOLD = 0.9;

interface RunRow {
  id: string;
  tier: string;
  task_set_hash: string;
  model_id: number;
  settings_hash: string;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'Cloudflare platform not available'));
  const db = platform.env.DB;
  const cache = platform.env.CACHE;

  try {
    // Step 1: Parse JSON body in its own try/catch
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, 'bad_request', 'request body must be valid JSON');
    }

    // Step 2: Validate envelope shape
    const envelope = body as {
      payload: Record<string, unknown>;
      signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
    };
    if (!envelope.signature) throw new ApiError(400, 'missing_signature', 'signature block required');
    if (!envelope.payload || typeof envelope.payload !== 'object') {
      throw new ApiError(400, 'bad_payload', 'payload object required');
    }

    // Step 3: Verify signature — requires 'verifier' scope (admin also passes via hasScope)
    const verified = await verifySignedRequest(db, envelope, 'verifier');

    // Step 4: Coerce and validate payload fields
    const payload = envelope.payload as {
      original_run_id?: unknown;
      verifier_run_id?: unknown;
      agreement_score?: unknown;
      notes?: unknown;
    };

    const original_run_id = payload.original_run_id;
    const verifier_run_id = payload.verifier_run_id;
    const agreement_score = payload.agreement_score;
    const notesRaw = payload.notes;

    if (typeof original_run_id !== 'string' || !original_run_id) {
      throw new ApiError(400, 'bad_request', 'original_run_id must be a non-empty string');
    }
    if (typeof verifier_run_id !== 'string' || !verifier_run_id) {
      throw new ApiError(400, 'bad_request', 'verifier_run_id must be a non-empty string');
    }
    if (original_run_id === verifier_run_id) {
      throw new ApiError(400, 'same_run', 'original_run_id and verifier_run_id must differ');
    }
    if (typeof agreement_score !== 'number' || !Number.isFinite(agreement_score) || agreement_score < 0 || agreement_score > 1) {
      throw new ApiError(400, 'invalid_agreement', 'agreement_score must be a finite number in [0, 1]');
    }
    if (notesRaw !== undefined && notesRaw !== null && typeof notesRaw !== 'string') {
      throw new ApiError(400, 'bad_payload', 'notes must be a string or absent');
    }
    const notes: string | null = typeof notesRaw === 'string' ? notesRaw : null;

    // Note: this endpoint does not prevent a single operator from signing both the
    // original run ingest and the verification attestation. Verifier identity is
    // trust-on-first-use — the attack surface is an operator who controls both an
    // ingest-scoped key and a verifier-scoped key. P1 accepts this trust boundary;
    // P2+ may add attestation-chain audits to detect same-operator self-verify.

    // Step 5: Fetch both runs
    const origRun = await db
      .prepare(`SELECT id, tier, task_set_hash, model_id, settings_hash FROM runs WHERE id = ?`)
      .bind(original_run_id)
      .first<RunRow>();
    if (!origRun) throw new ApiError(404, 'original_run_not_found', `run ${original_run_id} not found`);

    const verifRun = await db
      .prepare(`SELECT id, tier, task_set_hash, model_id, settings_hash FROM runs WHERE id = ?`)
      .bind(verifier_run_id)
      .first<RunRow>();
    if (!verifRun) throw new ApiError(404, 'verifier_run_not_found', `run ${verifier_run_id} not found`);

    // Step 6: Grouping check — task_set_hash, model_id, and settings_hash must match
    if (
      origRun.task_set_hash !== verifRun.task_set_hash ||
      origRun.model_id !== verifRun.model_id ||
      origRun.settings_hash !== verifRun.settings_hash
    ) {
      throw new ApiError(400, 'grouping_mismatch', 'original and verifier runs must share task_set_hash, model_id, and settings_hash');
    }

    // Step 7: Determine promotion — only promote if agreement >= threshold AND original is still 'claimed'
    const promoted = agreement_score >= PROMOTION_THRESHOLD && origRun.tier === 'claimed';

    // Step 8: Build atomic batch
    const now = new Date().toISOString();

    const ops = [
      // Upsert verification attestation — ON CONFLICT preserves FK semantics cleanly
      {
        sql: `
          INSERT INTO run_verifications(original_run_id, verifier_run_id, verified_at, agreement_score, notes)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(original_run_id, verifier_run_id) DO UPDATE SET
            agreement_score = excluded.agreement_score,
            notes = excluded.notes,
            verified_at = excluded.verified_at
        `,
        params: [original_run_id, verifier_run_id, now, agreement_score, notes] as (string | number | null)[]
      }
    ];

    if (promoted) {
      // Promote the original run's tier
      ops.push({
        sql: `UPDATE runs SET tier = 'verified' WHERE id = ?`,
        params: [original_run_id]
      });

      // Audit event — use verified.machine_id (the verifier that signed), not a hard-coded string.
      // If two verifiers simultaneously attest the same run across threshold, both batches include
      // the UPDATE — D1 serialises writes so the second UPDATE is a no-op, but both run_promoted
      // events fire (with different verifier_run_ids). This is acceptable for auditability.
      ops.push({
        sql: `INSERT INTO ingest_events(event, machine_id, ts, details_json) VALUES (?, ?, ?, ?)`,
        params: [
          'run_promoted',
          verified.machine_id,
          now,
          JSON.stringify({ original_run_id, verifier_run_id, agreement_score, key_id: verified.key_id })
        ]
      });
    }

    // Step 9: Execute batch atomically
    await runBatch(db, ops);

    // Step 10: Invalidate leaderboard KV only on promotion — non-promotion doesn't change standings
    if (promoted) {
      try {
        let cursor: string | undefined = undefined;
        do {
          const opts: KVNamespaceListOptions = { prefix: 'leaderboard:' };
          if (cursor) opts.cursor = cursor;
          const listed: KVNamespaceListResult<unknown, string> = await cache.list(opts);
          await Promise.all(listed.keys.map((k: KVNamespaceListKey<unknown, string>) => cache.delete(k.name)));
          cursor = listed.list_complete ? undefined : listed.cursor;
        } while (cursor);
      } catch { /* best-effort — DB is source of truth */ }
    }

    // Step 11: Return response
    return jsonResponse(
      { original_run_id, verifier_run_id, agreement_score, promoted },
      200,
      { 'Cache-Control': 'no-store' }
    );
  } catch (err) {
    return errorResponse(err);
  }
};
