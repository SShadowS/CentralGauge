import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { extractCanaryPath } from "$lib/server/canary";
import { injectBaseHref, rewriteAbsoluteLinks } from "$lib/server/canary-scope";

export const prerender = false;
export const ssr = true;
export const csr = true;

export const load: PageServerLoad = async ({ url, fetch, setHeaders }) => {
  const parts = extractCanaryPath(url);
  if (!parts) throw error(400, "Invalid canary URL");

  // event.fetch follows redirects automatically (default redirect: 'follow').
  // Any 3xx from the wrapped route is resolved here; we only see the final
  // 200 HTML. The canary scope leak is at the iframe link-click boundary,
  // NOT here — see P6 A7 design rationale.
  const wrapped = `${parts.path}${parts.search}`;
  const res = await fetch(wrapped);
  if (!res.ok) {
    // Surface the underlying error to the user via SvelteKit's error page.
    throw error(res.status, `Canary fetch of ${wrapped} failed`);
  }
  const rawHtml = await res.text();
  // Two-pass transform (P6 A7): <base> for relative URLs + absolute-link rewrite
  // so link-click navigation INSIDE the iframe stays inside /_canary/<sha>/.
  const withBase = injectBaseHref(rawHtml, parts.sha);
  const html = rewriteAbsoluteLinks(withBase, parts.sha);

  // Propagate cache-control from the wrapped route, but layer X-Canary on top.
  const wrappedCache = res.headers.get("cache-control");
  setHeaders({
    "cache-control": wrappedCache ?? "no-store",
    "x-canary": "1",
  });
  return {
    canary: { sha: parts.sha, path: parts.path },
    wrappedHtml: html,
  };
};
