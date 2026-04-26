import type { RequestHandler } from "./$types";

/**
 * Liveness probe — read-only, no auth, no D1, no R2. Used by:
 *   - The doctor's `net.health` check (`centralgauge doctor ingest`)
 *   - External uptime monitors
 *
 * Returns 200 always when the worker is reachable.
 */
export const GET: RequestHandler = () => {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "centralgauge",
      now: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
};
