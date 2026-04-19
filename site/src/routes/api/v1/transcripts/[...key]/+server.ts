import type { RequestHandler } from './$types';
import { decompress } from 'fzstd';
import { ApiError, errorResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const env = platform.env;

  try {
    const key = params.key ?? '';

    // Reject path traversal: check both raw '..' and any decoded form captured by the catch-all
    if (key.includes('..') || key.startsWith('/')) {
      throw new ApiError(400, 'invalid_key', 'Invalid transcript key');
    }

    const objectKey = key.startsWith('transcripts/') ? key : `transcripts/${key}`;

    const obj = await env.BLOBS.get(objectKey);
    if (!obj) throw new ApiError(404, 'transcript_not_found', `No transcript '${objectKey}'`);

    const compressed = objectKey.endsWith('.zst');
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
