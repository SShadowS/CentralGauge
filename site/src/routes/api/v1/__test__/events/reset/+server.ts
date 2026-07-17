import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";

// TEST-ONLY route. Proxies POST /reset on the LeaderboardBroadcaster DO so
// vitest-pool-workers tests can drain the in-memory buffer between cases
// without touching `env.LEADERBOARD_BROADCASTER` directly. See
// `../recent/+server.ts` for the rationale on why proxying through the
// public route surface is preferable to re-exporting the DO class from a
// custom worker entrypoint.
//
// Gating (S4): double-gated like `__test_only__/broadcast`:
//   1. `env.ALLOW_TEST_BROADCAST === 'on'` — set ONLY in CI / test bindings;
//      MUST NEVER appear in production `wrangler.toml [vars]`.
//   2. `x-test-only: 1` request header.
// Either missing → 403. The DO's own `/reset` handler applies the same two
// gates, so even a mis-deployed route cannot reach the operation.
export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env as unknown as { ALLOW_TEST_BROADCAST?: string };
  if (env.ALLOW_TEST_BROADCAST !== "on") {
    return errorResponse(new ApiError(403, "forbidden", "test-only endpoint"));
  }
  if (request.headers.get("x-test-only") !== "1") {
    return errorResponse(new ApiError(403, "forbidden", "test-only endpoint"));
  }
  const doEnv = platform.env;
  const id = doEnv.LEADERBOARD_BROADCASTER.idFromName("leaderboard");
  const stub = doEnv.LEADERBOARD_BROADCASTER.get(id);
  return stub.fetch("https://do/reset", {
    method: "POST",
    headers: { "x-test-only": "1" },
  });
};
