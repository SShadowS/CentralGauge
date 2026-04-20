import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { getFirst } from '$lib/server/db';

interface SignedAdminRequest {
  version: number;
  signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
  payload: Record<string, unknown>;
}

export const DELETE: RequestHandler = async ({ params, request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;

  try {
    const idStr = params.id ?? '';
    const parsedId = Number(idStr);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      throw new ApiError(400, 'invalid_id', `id must be a positive integer (got "${idStr}")`);
    }

    const signed = (await request.json()) as SignedAdminRequest;
    if (signed.version !== 1) {
      throw new ApiError(400, 'bad_version', 'only version 1 supported');
    }

    await verifySignedRequest(db, signed, 'admin');

    // Defense-in-depth: payload.key_id must match URL id so that a leaked admin
    // signature for one key can't be replayed against a different key id.
    const payloadKeyId = signed.payload?.key_id;
    if (typeof payloadKeyId !== 'number' || payloadKeyId !== parsedId) {
      throw new ApiError(
        400,
        'id_mismatch',
        `payload.key_id (${String(payloadKeyId)}) must match URL id (${parsedId})`
      );
    }

    const row = await getFirst<{ id: number; revoked_at: string | null }>(
      db,
      `SELECT id, revoked_at FROM machine_keys WHERE id = ?`,
      [parsedId]
    );
    if (!row) {
      throw new ApiError(404, 'key_not_found', `key id ${parsedId} not found`);
    }

    if (row.revoked_at) {
      // Idempotent: already revoked, report previous timestamp + changed=false.
      return jsonResponse({ id: parsedId, revoked_at: row.revoked_at, changed: false }, 200);
    }

    const now = new Date().toISOString();
    await db
      .prepare(`UPDATE machine_keys SET revoked_at = ? WHERE id = ?`)
      .bind(now, parsedId)
      .run();

    return jsonResponse({ id: parsedId, revoked_at: now, changed: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
