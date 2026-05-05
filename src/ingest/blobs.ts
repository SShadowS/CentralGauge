import { signBlobUpload } from "./sign.ts";

export interface BlobUploadResult {
  uploaded: number;
  skipped: number;
}

export interface UploadBlobOptions {
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  backoffBaseMs?: number;
  /** Max parallel uploads in {@link uploadMissing}. Ignored by {@link uploadBlob}. */
  concurrency?: number;
}

export async function uploadBlob(
  baseUrl: string,
  sha256: string,
  body: Uint8Array,
  privateKey: Uint8Array,
  keyId: number,
  opts: UploadBlobOptions = {},
): Promise<void> {
  const path = `/api/v1/blobs/${sha256}`;
  const { signature, signed_at } = await signBlobUpload(
    path,
    sha256,
    privateKey,
    keyId,
  );
  const fetchFn = opts.fetchFn ?? fetch;
  // 5 attempts × 4^attempt-1 backoff = up to ~5+ minutes worst case before
  // giving up. Rate-limited workers usually clear within a few seconds; the
  // larger ceiling tolerates short bursts of 429 without aborting an ingest.
  const max = opts.maxAttempts ?? 5;
  const base = opts.backoffBaseMs ?? 1000;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= max; attempt++) {
    let resp: Response;
    try {
      resp = await fetchFn(`${baseUrl}${path}`, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "x-cg-signature": signature,
          "x-cg-key-id": String(keyId),
          "x-cg-signed-at": signed_at,
        },
        body: body as BodyInit,
      });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < max) await sleep(base * Math.pow(4, attempt - 1));
      continue;
    }
    if (resp.status === 200 || resp.status === 201) return;
    // 429 is in the 4xx band but transient — back off and retry, optionally
    // honoring the server's Retry-After hint.
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("retry-after");
      const hint = retryAfter ? Number(retryAfter) * 1000 : NaN;
      const wait = Number.isFinite(hint) && hint > 0
        ? hint
        : base * Math.pow(4, attempt - 1);
      lastError = new Error(
        `blob upload failed: 429 ${await resp.text()}`,
      );
      if (attempt < max) await sleep(wait);
      continue;
    }
    if (resp.status >= 400 && resp.status < 500) {
      throw new Error(
        `blob upload failed: ${resp.status} ${await resp.text()}`,
      );
    }
    lastError = new Error(
      `blob upload failed: ${resp.status} ${await resp.text()}`,
    );
    if (attempt < max) await sleep(base * Math.pow(4, attempt - 1));
  }
  throw lastError ?? new Error("uploadBlob: exhausted attempts");
}

export async function uploadMissing(
  baseUrl: string,
  missing: Array<{ sha256: string; body: Uint8Array }>,
  privateKey: Uint8Array,
  keyId: number,
  opts: UploadBlobOptions = {},
): Promise<BlobUploadResult> {
  // Bounded-concurrency worker pool. Pulls from a shared cursor so each
  // upload runs exactly once and no work is duplicated. The site's
  // ratelimit binding caps writes at 600/min, so 10 in-flight × ~150ms
  // round-trip ≈ 60/sec stays within budget while saturating throughput.
  const concurrency = Math.max(1, opts.concurrency ?? 10);
  const workerCount = Math.min(concurrency, missing.length);
  if (workerCount === 0) return { uploaded: 0, skipped: 0 };

  let cursor = 0;
  let uploaded = 0;
  let firstError: Error | null = null;

  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (firstError === null) {
        const i = cursor++;
        if (i >= missing.length) return;
        const item = missing[i]!;
        try {
          await uploadBlob(
            baseUrl,
            item.sha256,
            item.body,
            privateKey,
            keyId,
            opts,
          );
          uploaded++;
        } catch (e) {
          firstError = e instanceof Error ? e : new Error(String(e));
          return;
        }
      }
    })());
  }

  await Promise.all(workers);
  if (firstError) throw firstError;
  return { uploaded, skipped: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
