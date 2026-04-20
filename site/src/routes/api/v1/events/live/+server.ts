import type { RequestHandler } from './$types';
import { errorResponse, ApiError } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'Cloudflare platform not available'));
  const env = platform.env;
  const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
  const stub = env.LEADERBOARD_BROADCASTER.get(id);
  // Forward to DO's /subscribe handler. Preserve request.signal so client disconnect
  // propagates into the DO for writer cleanup.
  return stub.fetch(
    new Request('https://do/subscribe', {
      method: 'GET',
      signal: request.signal,
    }),
  );
};
