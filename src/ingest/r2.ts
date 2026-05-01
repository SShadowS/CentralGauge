/**
 * R2 lifecycle blob upload — uploads compressed debug bundles to R2 under
 * `lifecycle/debug/<model_slug>/<session_id>.tar.zst` (and any other
 * `lifecycle/...` key the orchestrator decides). Routes via the worker's
 * signed `/api/v1/admin/lifecycle/r2/<key>` endpoint.
 *
 * Why a separate module from `blobs.ts`: lifecycle blobs are NOT
 * content-addressed (`/api/v1/blobs/<sha256>`); the key is the explicit
 * R2 path, and the signing scheme is the lifecycle-admin canonical
 * `{method, path, query, body_sha256, signed_at}` (see `event-log.ts
 * signLifecycleHeaders`) — distinct from `signBlobUpload`'s legacy shape.
 *
 * @module src/ingest/r2
 */

import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { signLifecycleHeaders } from "../lifecycle/event-log.ts";

export interface UploadLifecycleBlobResult {
  r2_key: string;
  r2_prefix: string;
  compressed_size_bytes: number;
}

export async function uploadLifecycleBlob(
  baseUrl: string,
  r2Key: string, // e.g. "lifecycle/debug/anthropic/claude-opus-4-7/1765986258980.tar.zst"
  body: Uint8Array,
  privateKey: Uint8Array,
  keyId: number,
  fetchFn: typeof fetch = fetch,
): Promise<UploadLifecycleBlobResult> {
  if (!r2Key.startsWith("lifecycle/")) {
    throw new Error(
      `r2Key must begin with 'lifecycle/' (got '${r2Key.slice(0, 32)}...')`,
    );
  }
  const path = `/api/v1/admin/lifecycle/r2/${r2Key}`;
  const headers = await signLifecycleHeaders(privateKey, keyId, {
    method: "PUT",
    path,
    body,
  });
  const max = 5;
  const base = 1000;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= max; attempt++) {
    let resp: Response;
    try {
      resp = await fetchFn(`${baseUrl}${path}`, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          ...headers,
        },
        body: body as BodyInit,
      });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < max) await sleep(base * Math.pow(4, attempt - 1));
      continue;
    }
    if (resp.status === 200 || resp.status === 201) {
      const r2Prefix = r2Key.substring(0, r2Key.lastIndexOf("/"));
      return {
        r2_key: r2Key,
        r2_prefix: r2Prefix,
        compressed_size_bytes: body.byteLength,
      };
    }
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("retry-after");
      const hint = retryAfter ? Number(retryAfter) * 1000 : NaN;
      const wait = Number.isFinite(hint) && hint > 0
        ? hint
        : base * Math.pow(4, attempt - 1);
      lastError = new Error(`r2 upload 429: ${await resp.text()}`);
      if (attempt < max) await sleep(wait);
      continue;
    }
    if (resp.status >= 400 && resp.status < 500) {
      throw new Error(`r2 upload failed: ${resp.status} ${await resp.text()}`);
    }
    lastError = new Error(
      `r2 upload failed: ${resp.status} ${await resp.text()}`,
    );
    if (attempt < max) await sleep(base * Math.pow(4, attempt - 1));
  }
  throw lastError ?? new Error("uploadLifecycleBlob: exhausted attempts");
}

/** Hex-encoded SHA-256 of `bytes`. Exposed for callers that need the digest. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
