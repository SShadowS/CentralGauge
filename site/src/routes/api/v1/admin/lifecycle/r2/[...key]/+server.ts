import type { RequestHandler } from "./$types";
import { authenticateAdminRequest } from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import {
  buildHeaderSignedFields,
  verifyLifecycleAdminRequest,
} from "$lib/server/lifecycle-auth";
import { validateR2Key } from "$lib/server/r2-key";

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

export const PUT: RequestHandler = async (
  { request, platform, params, url },
) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) {
    return errorResponse(
      new ApiError(500, "no_bucket", "LIFECYCLE_BLOBS binding missing"),
    );
  }
  try {
    const key = validateR2Key(params.key);

    // I4: enforce a Content-Length cap BEFORE reading the body so attackers
    // can't OOM the worker with a 5GB upload. Some clients omit
    // Content-Length on chunked transfer; in that case we still cap by
    // reading at most MAX_BODY_BYTES bytes below.
    const declaredLen = request.headers.get("content-length");
    if (declaredLen !== null) {
      const n = parseInt(declaredLen, 10);
      if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
        throw new ApiError(
          413,
          "payload_too_large",
          `body exceeds ${MAX_BODY_BYTES} bytes (declared ${n})`,
        );
      }
    }

    // (Plan F / F5.5) Dual-auth PUT. Wave 5 / IMPORTANT 5 — defer body
    // buffering until AFTER the CF Access auth check to avoid an
    // unauthenticated DoS that materializes up to MAX_BODY_BYTES per
    // attempt. The Ed25519 path still reads the body first because the
    // signature is hash-bound to the body bytes (rebinding the upload
    // would require a fresh sig).
    let body: Uint8Array;
    // Prefer header-signed path when CLI signature headers are present —
    // CF Access service-token requests carry both `x-cg-signature` and a
    // `cf-access-jwt-assertion` JWT (the JWT is just edge-bypass).
    if (request.headers.get("x-cg-signature")) {
      // Ed25519 path: body first because verifyLifecycleAdminRequest
      // hashes the bytes into the signed envelope. Without the hash
      // binding an attacker could redirect a captured signature to a
      // different upload.
      body = await readBodyWithCap(request.body, MAX_BODY_BYTES);
      await verifyLifecycleAdminRequest(db, request, {
        signedFields: buildHeaderSignedFields({
          method: "PUT",
          path: url.pathname,
        }),
        body,
      });
    } else if (request.headers.get("cf-access-jwt-assertion")) {
      // CF Access browser path: auth FIRST (JWT validation is
      // body-independent), then read the body. This caps unauthenticated
      // body buffering at zero bytes for malformed-JWT attackers.
      await authenticateAdminRequest(request, platform.env, null);
      body = await readBodyWithCap(request.body, MAX_BODY_BYTES);
    } else {
      throw new ApiError(
        401,
        "unauthenticated",
        "CF Access JWT or X-CG-Signature required",
      );
    }

    await bucket.put(key, body, {
      httpMetadata: {
        contentType: request.headers.get("content-type") ??
          "application/octet-stream",
      },
    });
    return jsonResponse({ key, size: body.byteLength }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async (
  { request, platform, params, url },
) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) {
    return errorResponse(
      new ApiError(500, "no_bucket", "LIFECYCLE_BLOBS binding missing"),
    );
  }
  try {
    const key = validateR2Key(params.key);
    // (Plan F / F5.5) Dual-auth GET. CF Access JWT in the browser is the
    // primary path (review UI proxies blob bytes via this endpoint); fall
    // back to the existing header-signed Ed25519 path (binds the URL path
    // so a captured envelope can't be swapped to a different key).
    // Prefer header-signed path when CLI signature headers are present —
    // CF Access service-token requests carry both `x-cg-signature` and a
    // `cf-access-jwt-assertion` JWT.
    if (request.headers.get("x-cg-signature")) {
      await verifyLifecycleAdminRequest(db, request, {
        signedFields: buildHeaderSignedFields({
          method: "GET",
          path: url.pathname,
        }),
      });
    } else if (request.headers.get("cf-access-jwt-assertion")) {
      await authenticateAdminRequest(request, platform.env, null);
    } else {
      throw new ApiError(
        401,
        "unauthenticated",
        "CF Access JWT or X-CG-Signature required",
      );
    }
    const obj = await bucket.get(key);
    if (!obj) throw new ApiError(404, "not_found", `no blob at key=${key}`);
    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": obj.httpMetadata?.contentType ??
          "application/octet-stream",
        "content-length": String(obj.size),
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
        throw new ApiError(
          413,
          "payload_too_large",
          `body exceeds ${cap} bytes`,
        );
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
