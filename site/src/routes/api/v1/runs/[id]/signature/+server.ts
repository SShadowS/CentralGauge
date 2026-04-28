import type { RequestHandler } from './$types';
import { ApiError, errorResponse } from '$lib/server/errors';
import { cachedJson } from '$lib/server/cache';
import { bytesToB64 } from '$lib/shared/base64';
import { getFirst } from '$lib/server/db';

interface SignatureRow {
  id: string;
  ingest_signature: string;
  ingest_signed_at: string;
  ingest_public_key_id: number;
  ingest_signed_payload: ArrayBuffer;
}

interface MachineKeyRow {
  machine_id: string;
  scope: string;
  public_key: ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;

  try {
    const run = await db
      .prepare(
        `SELECT id, ingest_signature, ingest_signed_at, ingest_public_key_id, ingest_signed_payload
         FROM runs WHERE id = ?`,
      )
      .bind(params.id)
      .first<SignatureRow>();

    if (!run) throw new ApiError(404, 'not_found', `Run ${params.id} not found`);

    const key = await getFirst<MachineKeyRow>(
      db,
      `SELECT machine_id, scope, public_key FROM machine_keys WHERE id = ?`,
      [run.ingest_public_key_id],
    );

    const payloadBytes = new Uint8Array(run.ingest_signed_payload);
    const publicKeyHex = key ? bytesToHex(new Uint8Array(key.public_key)) : '';

    return cachedJson(request, {
      run_id: run.id,
      payload_b64: bytesToB64(payloadBytes),
      signature: {
        alg: 'Ed25519',
        key_id: run.ingest_public_key_id,
        signed_at: run.ingest_signed_at,
        value_b64: run.ingest_signature,
      },
      public_key_hex: publicKeyHex,
      machine_id: key?.machine_id ?? '',
    }, { cacheControl: 'public, s-maxage=3600, stale-while-revalidate=86400' });
  } catch (err) {
    return errorResponse(err);
  }
};
