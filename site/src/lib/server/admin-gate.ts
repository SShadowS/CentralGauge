/**
 * S1 — SSR auth gate for /admin* pages, called from hooks.server.ts BEFORE
 * SvelteKit resolves the route. Pre-fix, the admin lifecycle pages relied
 * solely on the edge CF Access policy ("CF Access already gates the route");
 * the workers.dev hostname bypasses that policy, so the loaders leaked
 * pending-review counts / model roster / lifecycle state to anyone who found
 * the hostname.
 *
 * Fail-closed contract (round-2 review):
 *   - no JWT header             → 403 (regardless of env config)
 *   - JWT present, env missing  → 500 cf_access_misconfigured — a dropped
 *                                 CF_ACCESS_AUD secret must NEVER silently
 *                                 open /admin
 *   - JWT present, verify fails → 403 (reason not leaked to the caller)
 *   - JWT present, verify ok    → null (request proceeds to the page loader)
 *
 * Local dev + vitest: there is no bypass. Configure CF_ACCESS_AUD +
 * CF_ACCESS_TEAM_DOMAIN in `.dev.vars` (see `.dev.vars.example`) and send a
 * JWT, or exercise the gate through the unit suite
 * (tests/server/admin-gate.test.ts) which injects a synthetic JWK.
 */
import { type CfAccessEnv, verifyCfAccessJwt } from "./cf-access";
import { ApiError } from "./errors";

function gateResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * Returns `null` when the request carries a valid CF Access JWT; otherwise
 * the Response to short-circuit with. Never throws.
 */
export async function gateAdminRequest(
  request: Request,
  env: CfAccessEnv | undefined,
): Promise<Response | null> {
  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (!jwt) {
    return gateResponse(403, "forbidden", "Cloudflare Access JWT required");
  }
  if (!env) {
    // Missing platform bindings entirely — fail closed, never resolve the page.
    return gateResponse(
      500,
      "cf_access_misconfigured",
      "platform env missing — /admin is fail-closed",
    );
  }
  try {
    await verifyCfAccessJwt(request, env);
    return null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 500) {
      // cf_access_misconfigured (missing AUD/TEAM_DOMAIN) — surface as the
      // server fault it is, still fail closed.
      return gateResponse(500, err.code, err.message);
    }
    return gateResponse(
      403,
      "forbidden",
      "Cloudflare Access verification failed",
    );
  }
}
