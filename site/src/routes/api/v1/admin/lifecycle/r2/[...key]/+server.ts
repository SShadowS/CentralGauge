import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

/**
 * R2 proxy for lifecycle blob storage. Plan C uploads debug bundles via PUT
 * (`uploadLifecycleBlob`); Plan F's review UI reads them via GET. Same
 * dual-auth contract as the other admin lifecycle endpoints (Ed25519 today,
 * CF Access added by Plan F).
 *
 * Key namespacing (enforced by callers, not the endpoint): blobs live under
 * `lifecycle/<model_slug>/<task_set_hash>/<event_type>/<payload_hash>.bin`
 * so the orchestrator can replay deterministically.
 */
export const PUT: RequestHandler = async ({ request, platform, params }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) return errorResponse(new ApiError(500, 'no_bucket', 'LIFECYCLE_BLOBS binding missing'));
  try {
    // Signature lives in headers (raw-body endpoint, no JSON envelope).
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing X-CG-Signature/X-CG-Key-Id/X-CG-Signed-At');
    }
    const key = params.key;
    if (!key) throw new ApiError(400, 'missing_key', 'r2 key required');
    const fakeBody = {
      version: 1,
      payload: { key },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    const body = await request.arrayBuffer();
    await bucket.put(key, body, {
      httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' },
    });
    return jsonResponse({ key, size: body.byteLength }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ request, platform, params }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) return errorResponse(new ApiError(500, 'no_bucket', 'LIFECYCLE_BLOBS binding missing'));
  try {
    // Plan F's review UI uses CF Access; CLI replay uses Ed25519. Until Plan F
    // ships authenticateAdminRequest, only Ed25519 is accepted.
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing signature headers');
    }
    const key = params.key;
    if (!key) throw new ApiError(400, 'missing_key', 'r2 key required');
    const fakeBody = {
      version: 1,
      payload: { key },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    const obj = await bucket.get(key);
    if (!obj) throw new ApiError(404, 'not_found', `no blob at key=${key}`);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'content-length': String(obj.size),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
