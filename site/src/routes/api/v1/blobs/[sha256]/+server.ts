import type { RequestHandler } from './$types';
import { sha256Hex } from '$lib/shared/hash';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { blobKey } from '$lib/server/ingest';

const HEX64 = /^[a-f0-9]{64}$/;

export const PUT: RequestHandler = async ({ params, request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const key = params.sha256!;
  if (!HEX64.test(key)) {
    return errorResponse(new ApiError(400, 'bad_key', 'sha256 path parameter must be 64 lowercase hex chars'));
  }

  try {
    const body = new Uint8Array(await request.arrayBuffer());
    const actualHash = await sha256Hex(body);
    if (actualHash !== key) {
      throw new ApiError(400, 'hash_mismatch', `body sha256 ${actualHash} does not match key ${key}`);
    }

    const r2Key = blobKey(key);
    const existing = await platform.env.BLOBS.head(r2Key);
    if (existing) {
      return jsonResponse({ sha256: key, status: 'exists' }, 200);
    }

    await platform.env.BLOBS.put(r2Key, body);
    return jsonResponse({ sha256: key, status: 'created' }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const key = params.sha256!;
  if (!HEX64.test(key)) {
    return errorResponse(new ApiError(400, 'bad_key', 'sha256 path parameter must be 64 lowercase hex chars'));
  }
  const obj = await platform.env.BLOBS.get(blobKey(key));
  if (!obj) return errorResponse(new ApiError(404, 'not_found', 'blob not found'));
  return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream' } });
};
