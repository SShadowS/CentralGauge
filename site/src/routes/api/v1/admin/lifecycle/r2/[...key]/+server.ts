import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { buildHeaderSignedFields, verifyLifecycleAdminRequest } from '$lib/server/lifecycle-auth';

/**
 * R2 proxy for lifecycle blob storage. Plan C uploads debug bundles via PUT
 * (`uploadLifecycleBlob`); Plan F's review UI reads them via GET. Same
 * dual-auth contract as the other admin lifecycle endpoints (Ed25519 today,
 * CF Access added by Plan F).
 *
 * Key namespacing: blobs live under
 * `lifecycle/<model_slug>/<task_set_hash>/<event_type>/<payload_hash>.bin`
 * so the orchestrator can replay deterministically. The C2 fix locks down
 * the key character set + path-traversal segments at the edge so an attacker
 * with a valid key can't write into `../../../wrangler.toml` or similar.
 */

const MAX_BODY_BYTES = 50 * 1024 * 1024; // I4: 50 MB cap on PUT body.

/**
 * Validate the R2 key path-component against C2's threat model:
 *  - must start with `lifecycle/`
 *  - charset restricted to [A-Za-z0-9._/-]
 *  - length 1..1024 (excluding the `lifecycle/` prefix would still be ≤ 1024)
 *  - no `..` segments (parent-directory traversal)
 *  - no control chars / null bytes (covered by charset, but re-checked)
 *
 * Exported for unit testing — HTTP-layer URL normalization eats most
 * traversal patterns before they reach the route, so direct tests of this
 * function are the best assurance the guard would still hold under
 * pathological input (URL-encoded `..`, etc).
 *
 * Throws `ApiError(400, 'invalid_key', ...)` naming the specific violation.
 */
export function validateR2Key(key: string | undefined): string {
  if (!key || key.length === 0) {
    throw new ApiError(400, 'invalid_key', 'r2 key required');
  }
  if (key.length > 1024) {
    throw new ApiError(400, 'invalid_key', `key exceeds 1024 chars (got ${key.length})`);
  }
  if (!key.startsWith('lifecycle/')) {
    throw new ApiError(400, 'invalid_key', 'key must start with "lifecycle/"');
  }
  // Charset: alphanumeric + dot, dash, underscore, slash. NO whitespace, NO
  // unicode, NO control chars. Hard line.
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) {
    throw new ApiError(
      400,
      'invalid_key',
      'key contains characters outside [A-Za-z0-9._/-] (control chars / null / unicode rejected)',
    );
  }
  // Path-traversal: forbid `..` as a path segment anywhere.
  const segments = key.split('/');
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new ApiError(400, 'invalid_key', 'key contains "." or ".." segment (path traversal rejected)');
  }
  // Defensive: empty segments mean `//` — should never happen with the
  // charset regex above, but check explicitly.
  if (segments.some((s) => s.length === 0)) {
    throw new ApiError(400, 'invalid_key', 'key contains empty path segment ("//")');
  }
  return key;
}

export const PUT: RequestHandler = async ({ request, platform, params, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) return errorResponse(new ApiError(500, 'no_bucket', 'LIFECYCLE_BLOBS binding missing'));
  try {
    const key = validateR2Key(params.key);

    // I4: enforce a Content-Length cap BEFORE reading the body so attackers
    // can't OOM the worker with a 5GB upload. Some clients omit
    // Content-Length on chunked transfer; in that case we still cap by
    // reading at most MAX_BODY_BYTES bytes below.
    const declaredLen = request.headers.get('content-length');
    if (declaredLen !== null) {
      const n = parseInt(declaredLen, 10);
      if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
        throw new ApiError(
          413,
          'payload_too_large',
          `body exceeds ${MAX_BODY_BYTES} bytes (declared ${n})`,
        );
      }
    }

    const body = await readBodyWithCap(request.body, MAX_BODY_BYTES);

    // C1 fix: bind the URL path AND the body hash into the signed bytes.
    // TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth.
    await verifyLifecycleAdminRequest(db, request, {
      signedFields: buildHeaderSignedFields({ method: 'PUT', path: url.pathname }),
      body,
    });

    await bucket.put(key, body, {
      httpMetadata: {
        contentType: request.headers.get('content-type') ?? 'application/octet-stream',
      },
    });
    return jsonResponse({ key, size: body.byteLength }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ request, platform, params, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) return errorResponse(new ApiError(500, 'no_bucket', 'LIFECYCLE_BLOBS binding missing'));
  try {
    const key = validateR2Key(params.key);
    // C1 fix: bind the URL path into the signed bytes so an attacker can't
    // swap `?key=public.bin` for `?key=secret.bin` with a captured signature.
    // TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth.
    await verifyLifecycleAdminRequest(db, request, {
      signedFields: buildHeaderSignedFields({ method: 'GET', path: url.pathname }),
    });
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

/**
 * Read a `ReadableStream<Uint8Array>` into a single `Uint8Array`, aborting
 * with `413 payload_too_large` if cumulative bytes exceed `cap`. Used in
 * place of `request.arrayBuffer()` so we don't materialize a > 50 MB buffer
 * just to throw it away.
 */
async function readBodyWithCap(
  stream: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        throw new ApiError(413, 'payload_too_large', `body exceeds ${cap} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // Concatenate.
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
