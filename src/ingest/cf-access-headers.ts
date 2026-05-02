/**
 * CF Access service-token headers for CLI → admin endpoints.
 *
 * The production worker is fronted by Cloudflare Access on
 * `/api/v1/admin/lifecycle/*` (and `/admin/lifecycle/*`). Browser users
 * authenticate via GitHub OAuth at the edge; CLI / CI users authenticate
 * via a CF Access service token that bypasses the OAuth flow but still
 * goes through CF Access.
 *
 * The worker's `authenticateAdminRequest` already does dual auth (CF
 * Access JWT OR Ed25519 admin signature on body). The service token only
 * gets the request *past CF Access* — once at the worker, the existing
 * Ed25519 signature is what authenticates the operation. So the service
 * token is purely an edge-bypass mechanism, not an additional auth
 * surface from the application's perspective.
 *
 * Returns an empty object when the env vars are unset, so calls from
 * environments without CF Access (local dev, tests, the public site)
 * don't spuriously emit the headers.
 *
 * @module src/ingest/cf-access-headers
 */
export function cfAccessHeaders(): Record<string, string> {
  const id = Deno.env.get("CF_ACCESS_CLIENT_ID");
  const secret = Deno.env.get("CF_ACCESS_CLIENT_SECRET");
  if (!id || !secret) return {};
  return {
    "CF-Access-Client-Id": id,
    "CF-Access-Client-Secret": secret,
  };
}
