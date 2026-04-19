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

function validateOccurrence(occ: unknown, shortIdx: number, occIdx: number): ShortcomingOccurrence {
  const o = occ as Record<string, unknown>;
  const { result_id, task_id, error_code } = o;
  if (!Number.isInteger(result_id) || (result_id as number) <= 0) {
    throw new ApiError(
      400,
      'bad_payload',
      `shortcomings[${shortIdx}].occurrences[${occIdx}].result_id must be a positive integer`
    );
  }
  if (typeof task_id !== 'string' || task_id.length === 0) {
    throw new ApiError(
      400,
      'bad_payload',
      `shortcomings[${shortIdx}].occurrences[${occIdx}].task_id must be a non-empty string`
    );
  }
  return {
    result_id: result_id as number,
    task_id,
    error_code: typeof error_code === 'string' ? error_code : null
  };
}

function validateShortcomingItem(item: unknown, index: number): ShortcomingItem {
  const it = item as Record<string, unknown>;

  if (typeof it.al_concept !== 'string' || it.al_concept.length === 0) {
    throw new ApiError(400, 'bad_payload', `shortcomings[${index}].al_concept must be a non-empty string`);
  }
  if (typeof it.concept !== 'string' || it.concept.length === 0) {
    throw new ApiError(400, 'bad_payload', `shortcomings[${index}].concept must be a non-empty string`);
  }
  if (typeof it.description !== 'string' || it.description.length === 0) {
    throw new ApiError(400, 'bad_payload', `shortcomings[${index}].description must be a non-empty string`);
  }
  if (typeof it.correct_pattern !== 'string' || it.correct_pattern.length === 0) {
    throw new ApiError(400, 'bad_payload', `shortcomings[${index}].correct_pattern must be a non-empty string`);
  }
  if (typeof it.incorrect_pattern_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(it.incorrect_pattern_sha256)) {
    throw new ApiError(
      400,
      'bad_payload',
      `shortcomings[${index}].incorrect_pattern_sha256 must be a 64-char hex string`
    );
  }

  const rawErrorCodes = it.error_codes;
  if (rawErrorCodes !== undefined && !Array.isArray(rawErrorCodes)) {
    throw new ApiError(400, 'bad_payload', `shortcomings[${index}].error_codes must be an array of strings or absent`);
  }
  if (Array.isArray(rawErrorCodes) && !rawErrorCodes.every((e) => typeof e === 'string')) {
    throw new ApiError(400, 'bad_payload', `shortcomings[${index}].error_codes must be an array of strings`);
  }

  const rawOccurrences = it.occurrences;
  if (rawOccurrences !== undefined && !Array.isArray(rawOccurrences)) {
    throw new ApiError(400, 'bad_payload', `shortcomings[${index}].occurrences must be an array or absent`);
  }

  const occurrences: ShortcomingOccurrence[] = Array.isArray(rawOccurrences)
    ? rawOccurrences.map((occ, occIdx) => validateOccurrence(occ, index, occIdx))
    : [];

  return {
    al_concept: it.al_concept,
    concept: it.concept,
    description: it.description,
    correct_pattern: it.correct_pattern,
    incorrect_pattern_sha256: it.incorrect_pattern_sha256,
    error_codes: Array.isArray(rawErrorCodes) ? (rawErrorCodes as string[]) : [],
    occurrences
  };
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

    const payload = envelope.payload;
    if (!payload.model_slug || typeof payload.model_slug !== 'string') {
      throw new ApiError(400, 'bad_payload', 'model_slug is required and must be a string');
    }
    if (!Array.isArray(payload.shortcomings)) {
      throw new ApiError(400, 'bad_payload', 'shortcomings must be an array');
    }

    // Validate all items BEFORE signature verification to avoid timing leaks
    const shortcomings: ShortcomingItem[] = (payload.shortcomings as unknown[]).map((item, idx) =>
      validateShortcomingItem(item, idx)
    );

    await verifySignedRequest(db, envelope, 'verifier');

    const modelSlug = payload.model_slug as string;

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
      const errorCodesJson = JSON.stringify(item.error_codes);

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

      // Batch occurrence inserts per shortcoming for efficiency
      if (item.occurrences.length > 0) {
        const occStmts = item.occurrences.map((occ) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO shortcoming_occurrences(shortcoming_id, result_id, task_id, error_code)
               VALUES (?, ?, ?, ?)`
            )
            .bind(row.id, occ.result_id, occ.task_id, occ.error_code ?? null)
        );

        // Chunk at 500 to stay within D1 batch limits
        for (let i = 0; i < occStmts.length; i += 500) {
          const chunk = occStmts.slice(i, i + 500);
          const results = await db.batch(chunk);
          for (const r of results) {
            occurrences += r.meta?.changes ?? 0;
          }
        }
      }
    }

    return jsonResponse({ upserted, occurrences }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    return errorResponse(err);
  }
};
