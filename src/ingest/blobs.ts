import { signBlobUpload } from "./sign.ts";

export interface BlobUploadResult {
  uploaded: number;
  skipped: number;
}

export interface UploadBlobOptions {
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  backoffBaseMs?: number;
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
  const max = opts.maxAttempts ?? 3;
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
  let uploaded = 0;
  for (const { sha256, body } of missing) {
    await uploadBlob(baseUrl, sha256, body, privateKey, keyId, opts);
    uploaded++;
  }
  return { uploaded, skipped: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
