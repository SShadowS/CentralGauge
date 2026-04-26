import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { verifySignedRequest } from '$lib/server/signature';
import type { PrecheckRequest, PrecheckResponse } from '$lib/shared/types';

/**
 * POST /api/v1/precheck — read-only signed health probe.
 *
 * Auth-only mode (this task, T6): verifies the Ed25519 signature against the
 * machine_keys row, reports whether the key is active and whether the bound
 * machine_id matches the payload claim, and returns the server's current time
 * for client-side clock-skew detection.
 *
 * T7 will extend this endpoint with an optional catalog block when the
 * request payload includes variants[].
 *
 * Read-only contract: no INSERT/UPDATE/DELETE in this handler. Note that
 * verifySignedRequest performs a best-effort UPDATE machine_keys.last_used_at
 * as telemetry — that is internal to the verifier and not user-visible state.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  }
  const db = platform.env.DB;

  try {
    const body = (await request.json()) as PrecheckRequest;

    if (body.version !== 1) {
      throw new ApiError(400, 'version_unsupported', 'version must be 1');
    }
    if (!body.payload || typeof body.payload.machine_id !== 'string') {
      throw new ApiError(400, 'bad_payload', 'payload.machine_id required');
    }

    // Required scope: 'ingest' (the lowest tier; verifier/admin satisfy via hasScope).
    const verified = await verifySignedRequest(
      db,
      { signature: body.signature, payload: body.payload as unknown as Record<string, unknown> },
      'ingest',
    );

    // verifySignedRequest already throws 401 'revoked_key' when revoked_at is set,
    // so on success the key is by definition active.
    const auth = {
      ok: true as const,
      key_id: verified.key_id,
      key_role: verified.scope,
      key_active: true,
      machine_id_match: verified.machine_id === body.payload.machine_id,
    };

    const response: PrecheckResponse = {
      schema_version: 1,
      auth,
      server_time: new Date().toISOString(),
    };
    return jsonResponse(response, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
