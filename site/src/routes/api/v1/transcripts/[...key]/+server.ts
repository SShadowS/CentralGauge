import type { RequestHandler } from './$types';
import { decompress } from 'fzstd';
import { ApiError, errorResponse } from '$lib/server/errors';

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Given a caller-supplied key, return the ordered list of R2 object keys to try.
 *
 * Resolution order:
 *   "<sha>"                     -> ["transcripts/<sha>",           "blobs/<sha>"]
 *   "<sha>.txt"                 -> ["transcripts/<sha>.txt",       "blobs/<sha>"]
 *   "<sha>.txt.zst"             -> ["transcripts/<sha>.txt.zst",   "blobs/<sha>"]
 *   "transcripts/<sha>.txt.zst" -> ["transcripts/<sha>.txt.zst"]              (no fallback when caller is explicit)
 *   anything else (not sha)     -> ["transcripts/<key>"]                       (no fallback)
 *
 * The `blobs/<sha>` fallback exists because the ingest pipeline stores transcripts
 * content-addressed under `blobs/<sha>` (see runs POST handler — `transcript_r2_key`
 * is set to `blobs/${r.transcript_sha256}`). The `transcripts/` prefix is reserved
 * for curated uploads, so we only fall back when the caller-supplied key looks like
 * a bare sha (optionally with .txt / .txt.zst suffix) AND they did not explicitly
 * request the `transcripts/` prefix themselves.
 */
function resolveCandidates(key: string): string[] {
  // If the caller explicitly asked for the transcripts/ prefix, honor it without
  // a blobs fallback — that prefix is reserved for curated uploads.
  if (key.startsWith('transcripts/')) {
    return [key];
  }

  // Strip optional .zst then optional .txt to get the "stem".
  let stem = key;
  if (stem.endsWith('.zst')) stem = stem.slice(0, -'.zst'.length);
  if (stem.endsWith('.txt')) stem = stem.slice(0, -'.txt'.length);

  const candidates = [`transcripts/${key}`];
  if (SHA256_HEX.test(stem)) {
    // Ingest writes the raw (uncompressed) bytes to `blobs/<sha>`, regardless of
    // whether the caller asked for .txt or .txt.zst.
    candidates.push(`blobs/${stem}`);
  }
  return candidates;
}

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const env = platform.env;

  try {
    const key = params.key ?? '';

    // Reject path traversal: check both raw '..' and any decoded form captured by the catch-all
    if (key.includes('..') || key.startsWith('/')) {
      throw new ApiError(400, 'invalid_key', 'Invalid transcript key');
    }

    const candidates = resolveCandidates(key);

    let resolvedKey: string | null = null;
    let obj: Awaited<ReturnType<typeof env.BLOBS.get>> = null;
    for (const candidate of candidates) {
      const hit = await env.BLOBS.get(candidate);
      if (hit) {
        resolvedKey = candidate;
        obj = hit;
        break;
      }
    }

    if (!obj || !resolvedKey) {
      throw new ApiError(
        404,
        'transcript_not_found',
        `No transcript '${candidates[0]}'`
      );
    }

    // `compressed` must reflect the RESOLVED key: blobs/<sha> stores raw bytes
    // even when the caller requested <sha>.txt.zst, so we key off of the actual
    // object path that hit, not the user-supplied key.
    const compressed = resolvedKey.endsWith('.zst');
    const bytes = new Uint8Array(await obj.arrayBuffer());
    let plain: Uint8Array;
    if (compressed) {
      try {
        plain = decompress(bytes);
      } catch {
        throw new ApiError(422, 'corrupt_blob', 'Transcript data could not be decompressed');
      }
    } else {
      plain = bytes;
    }

    return new Response(plain, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-api-version': 'v1'
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
};
