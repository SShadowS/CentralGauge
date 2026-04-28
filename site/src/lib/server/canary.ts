/**
 * Canary path-prefix utilities. The canary URL surface is
 * `/_canary/<sha>/<route>` — same Worker, same bindings, but the layout sets
 * `event.locals.canary = true` and emits an `X-Canary` response header.
 *
 * The reverse-proxy at `+page.server.ts` under `/_canary/[sha]/[...path]`
 * uses `extractCanaryPath()` to derive the wrapped route, then re-fetches
 * via `event.fetch()` so cache-control and other headers propagate.
 */

export function isCanary(url: URL): boolean {
  return url.pathname.startsWith('/_canary/');
}

export interface CanaryParts {
  sha: string;
  path: string;        // leading slash; "/" if no tail
  search: string;      // includes "?" if present, else ""
}

export function extractCanaryPath(url: URL): CanaryParts | null {
  if (!isCanary(url)) return null;
  // pathname:  /_canary/<sha>/<rest...>
  const stripped = url.pathname.slice('/_canary/'.length);
  const slash = stripped.indexOf('/');
  const sha = slash === -1 ? stripped : stripped.slice(0, slash);
  const tail = slash === -1 ? '' : stripped.slice(slash);  // includes leading slash
  return {
    sha,
    path: tail || '/',
    search: url.search,
  };
}
