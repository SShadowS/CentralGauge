import type { RequestHandler } from './$types';
import { ApiError, errorResponse } from '$lib/server/errors';
import { cachedJson } from '$lib/server/cache';
import { bytesToB64 } from '$lib/shared/base64';

interface SignatureRow {
  ingest_signature: string;
  ingest_signed_at: string;
  ingest_public_key_id: number;
  ingest_signed_payload: ArrayBuffer;
}

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;

  try {
    const run = await db
      .prepare(
        `SELECT ingest_signature, ingest_signed_at, ingest_public_key_id, ingest_signed_payload
         FROM runs WHERE id = ?`,
      )
      .bind(params.id)
      .first<SignatureRow>();

    if (!run) throw new ApiError(404, 'not_found', `Run ${params.id} not found`);

    const payloadBytes = new Uint8Array(run.ingest_signed_payload);

    const body = {
      ingest_signature: run.ingest_signature,
      ingest_signed_at: run.ingest_signed_at,
      ingest_public_key_id: run.ingest_public_key_id,
      signed_payload_base64: bytesToB64(payloadBytes),
    };

    return cachedJson(request, body, { cacheControl: 'public, s-maxage=3600, stale-while-revalidate=86400' });
  } catch (err) {
    return errorResponse(err);
  }
};
