import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface ShortcomingOccurrence {
  result_id: number;
  task_id: string;
  error_code: string | null;
}

interface ShortcomingItem {
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  incorrect_pattern_sha256: string;
  error_codes: string[];
  occurrences: ShortcomingOccurrence[];
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'Cloudflare platform not available'));
  const db = platform.env.DB;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, 'bad_request', 'request body must be valid JSON');
    }

    const envelope = body as {
      payload: Record<string, unknown>;
      signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
    };
    if (!envelope.signature) throw new ApiError(400, 'missing_signature', 'signature block required');
    if (!envelope.payload || typeof envelope.payload !== 'object') {
      throw new ApiError(400, 'bad_payload', 'payload object required');
    }

    await verifySignedRequest(db, envelope, 'verifier');

    const payload = envelope.payload;
    if (!payload.model_slug || typeof payload.model_slug !== 'string') {
      throw new ApiError(400, 'bad_payload', 'model_slug is required and must be a string');
    }
    if (!Array.isArray(payload.shortcomings)) {
      throw new ApiError(400, 'bad_payload', 'shortcomings must be an array');
    }

    const modelSlug = payload.model_slug as string;
    const shortcomings = payload.shortcomings as ShortcomingItem[];

    // Look up model by slug
    const modelRow = await db
      .prepare(`SELECT id FROM models WHERE slug = ?`)
      .bind(modelSlug)
      .first<{ id: number }>();
    if (!modelRow) throw new ApiError(404, 'model_not_found', `model '${modelSlug}' not found`);

    const modelId = modelRow.id;
    const now = new Date().toISOString();

    let upserted = 0;
    let occurrences = 0;

    for (const item of shortcomings) {
      const r2Key = `shortcomings/${item.incorrect_pattern_sha256}.al.zst`;
      const errorCodesJson = JSON.stringify(item.error_codes ?? []);

      // Upsert the shortcoming row; preserve first_seen on conflict
      const row = await db
        .prepare(
          `INSERT INTO shortcomings(model_id, al_concept, concept, description, correct_pattern, incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(model_id, al_concept) DO UPDATE SET
             concept = excluded.concept,
             description = excluded.description,
             correct_pattern = excluded.correct_pattern,
             incorrect_pattern_r2_key = excluded.incorrect_pattern_r2_key,
             error_codes_json = excluded.error_codes_json,
             last_seen = excluded.last_seen
           RETURNING id`
        )
        .bind(modelId, item.al_concept, item.concept, item.description, item.correct_pattern, r2Key, errorCodesJson, now, now)
        .first<{ id: number }>();

      if (!row) throw new ApiError(500, 'db_error', 'failed to upsert shortcoming');
      upserted++;

      // Insert occurrences; INSERT OR IGNORE for idempotency on same (shortcoming, result) PK
      for (const occ of item.occurrences ?? []) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO shortcoming_occurrences(shortcoming_id, result_id, task_id, error_code)
             VALUES (?, ?, ?, ?)`
          )
          .bind(row.id, occ.result_id, occ.task_id, occ.error_code ?? null)
          .run();
        occurrences++;
      }
    }

    return jsonResponse({ upserted, occurrences }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    return errorResponse(err);
  }
};
