import { ApiError } from "./errors";

/**
 * Read a `ReadableStream<Uint8Array>` into a single `Uint8Array`, aborting
 * with `413 payload_too_large` if cumulative bytes exceed `cap`. Used in
 * place of `request.arrayBuffer()` so we don't materialize a huge buffer
 * just to throw it away.
 */
export async function readBodyWithCap(
  stream: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<Uint8Array<ArrayBuffer>> {
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
