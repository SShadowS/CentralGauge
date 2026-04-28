import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { extractCanaryPath } from '$lib/server/canary';

export const prerender = false;
export const ssr = true;
export const csr = true;

export const load: PageServerLoad = async ({ url, fetch, setHeaders }) => {
  const parts = extractCanaryPath(url);
  if (!parts) throw error(400, 'Invalid canary URL');

  // Re-fetch the wrapped route's HTML server-side. event.fetch() routes
  // through the same worker, so cache headers and SSE bindings work.
  const wrapped = `${parts.path}${parts.search}`;
  const res = await fetch(wrapped);
  if (!res.ok) {
    // Surface the underlying error to the user via SvelteKit's error page.
    throw error(res.status, `Canary fetch of ${wrapped} failed`);
  }
  const html = await res.text();
  // Propagate cache-control from the wrapped route, but layer X-Canary on top.
  const wrappedCache = res.headers.get('cache-control');
  setHeaders({
    'cache-control': wrappedCache ?? 'no-store',
    'x-canary': '1',
  });
  return {
    canary: { sha: parts.sha, path: parts.path },
    wrappedHtml: html,
  };
};
