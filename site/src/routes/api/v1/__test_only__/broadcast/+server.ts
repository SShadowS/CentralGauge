import type { RequestHandler } from "./$types";
import { broadcastEvent } from "$lib/server/broadcaster";

/**
 * Test-only broadcast endpoint.
 *
 * Double-gated:
 *   1. `env.ALLOW_TEST_BROADCAST === 'on'` — set ONLY in CI / test bindings;
 *      MUST NEVER be set in `wrangler.toml [vars]` for production.
 *   2. Request header `x-test-only: 1` — guarantees the endpoint is not hit
 *      by accident or by an opportunistic crawler that learned the path.
 *
 * Both gates required. Either missing → 403.
 *
 * Used by:
 *   - tests/e2e/sse.spec.ts — to inject `run_finalized` events that drive
 *     SSE invalidate behavior in the browser.
 *   - tests/api/__test_only__-blocked-in-prod.test.ts — security regression.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return new Response("No platform", { status: 500 });
  const env = platform.env as { ALLOW_TEST_BROADCAST?: string };
  if (env.ALLOW_TEST_BROADCAST !== "on") {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.headers.get("x-test-only") !== "1") {
    return new Response("Forbidden", { status: 403 });
  }
  const ev = await request.json();
  const ok = await broadcastEvent(platform.env, ev as never);
  return Response.json({ ok });
};
