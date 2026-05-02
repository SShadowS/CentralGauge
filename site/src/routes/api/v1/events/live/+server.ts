import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const env = platform.env;
  const id = env.LEADERBOARD_BROADCASTER.idFromName("leaderboard");
  const stub = env.LEADERBOARD_BROADCASTER.get(id);

  // Forward `?routes=` (URL-encoded comma list) verbatim to the DO. Empty or
  // missing → DO defaults to ['*'] (back-compat for any legacy caller).
  const routes = url.searchParams.get("routes");
  const target = routes
    ? `https://do/subscribe?routes=${encodeURIComponent(routes)}`
    : "https://do/subscribe";

  return stub.fetch(
    new Request(target, { method: "GET", signal: request.signal }),
  );
};
