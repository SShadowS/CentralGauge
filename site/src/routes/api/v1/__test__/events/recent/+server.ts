import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";

// TEST-ONLY route. Proxies GET /recent on the LeaderboardBroadcaster DO so
// vitest-pool-workers tests can read the in-memory event buffer without
// touching `env.LEADERBOARD_BROADCASTER` directly.
//
// Why proxy instead of using the DO binding from the test isolate:
//   The SvelteKit Cloudflare adapter bundles the DO class inside _worker.js
//   without re-exporting it at the top level. Without re-export, miniflare
//   cannot resolve `class_name = "LeaderboardBroadcaster"` for a test isolate
//   that touches `env.LEADERBOARD_BROADCASTER`. The previous workaround
//   (a custom `main` entrypoint that re-exported the DO class) polluted
//   vite's module graph and caused back-to-back `vitest run` invocations
//   to fail in the same shell. Going through `SELF.fetch` keeps the test
//   on the public route surface, where everything is already wired.
//
// Gating: requires `x-test-only: 1` header. A 403 on missing header is
// sufficient — no production caller would ever set this header, and the
// route returns nothing privileged besides the in-memory event buffer.
export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (request.headers.get("x-test-only") !== "1") {
    return errorResponse(new ApiError(403, "forbidden", "test-only endpoint"));
  }
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env;
  const id = env.LEADERBOARD_BROADCASTER.idFromName("leaderboard");
  const stub = env.LEADERBOARD_BROADCASTER.get(id);
  const limit = url.searchParams.get("limit") ?? "20";
  return stub.fetch(`https://do/recent?limit=${encodeURIComponent(limit)}`, {
    method: "GET",
  });
};
