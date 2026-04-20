import type { RequestHandler } from './$types';
import { ApiError, errorResponse } from '$lib/server/errors';

// TEST-ONLY route. Proxies POST /reset on the LeaderboardBroadcaster DO so
// vitest-pool-workers tests can drain the in-memory buffer between cases
// without touching `env.LEADERBOARD_BROADCASTER` directly. See
// `../recent/+server.ts` for the rationale on why proxying through the
// public route surface is preferable to re-exporting the DO class from a
// custom worker entrypoint.
//
// Gating: requires `x-test-only: 1` header. The DO's own `/reset` handler
// ALSO requires this header — both layers gate the operation, so even if
// this route were ever invoked from production by accident, the DO would
// reject the call.
export const POST: RequestHandler = async ({ request, platform }) => {
  if (request.headers.get('x-test-only') !== '1') {
    return errorResponse(new ApiError(403, 'forbidden', 'test-only endpoint'));
  }
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const env = platform.env;
  const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
  const stub = env.LEADERBOARD_BROADCASTER.get(id);
  return stub.fetch('https://do/reset', {
    method: 'POST',
    headers: { 'x-test-only': '1' }
  });
};
