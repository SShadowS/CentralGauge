import type { ServerLoadEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';

interface PassthroughOpts {
  depTag: string | ((params: Record<string, string>) => string);
  fetchPath: string | ((url: URL, params: Record<string, string>) => string);
  /** When set, only these query params are forwarded to the API; otherwise all are. */
  forwardParams?: string[];
  /** Key under which the parsed JSON is exposed to the page. Defaults to `'data'`. */
  resultKey?: string;
}

/**
 * DRY helper for the dozen+ P5.3 +page.server.ts loaders that all share the
 * shape: depends() → fetch /api/v1/... → propagate cache-control →
 * throw error() on non-OK → return parsed JSON.
 *
 * Returns a generic `ServerLoadEvent` consumer rather than a typed
 * `PageServerLoad` because `PageServerLoad` is a per-route generated type
 * (from `./$types`) and isn't exported by `@sveltejs/kit`. Each consumer
 * route should annotate its `load` export with its own `PageServerLoad`
 * from `./$types` — assignment is structurally compatible because the
 * generated type IS a specialization of `ServerLoadEvent`.
 *
 * The returned loader populates `[opts.resultKey ?? 'data']` with the parsed
 * JSON. Pages that want to expose filters or extra projections separately
 * should layer on top — e.g.
 *
 * ```ts
 * import type { PageServerLoad } from './$types';
 * const inner = passthroughLoader<RunsListResponse>({ ..., resultKey: 'runs' });
 * export const load: PageServerLoad = async (event) => ({
 *   ...(await inner(event)),
 *   filters: { tier: event.url.searchParams.get('tier') ?? '' },
 * });
 * ```
 */
export function passthroughLoader<T>(opts: PassthroughOpts) {
  const key = opts.resultKey ?? 'data';
  return async (event: ServerLoadEvent): Promise<Record<string, T>> => {
    const { url, params, fetch, setHeaders, depends } = event;
    const tag = typeof opts.depTag === 'function' ? opts.depTag(params) : opts.depTag;
    depends(tag);

    let path = typeof opts.fetchPath === 'function' ? opts.fetchPath(url, params) : opts.fetchPath;
    if (opts.forwardParams) {
      const sp = new URLSearchParams();
      for (const k of opts.forwardParams) {
        const v = url.searchParams.get(k);
        if (v !== null && v !== '') sp.set(k, v);
      }
      const qs = sp.toString();
      if (qs) path += `?${qs}`;
    } else {
      const qs = url.searchParams.toString();
      if (qs && !path.includes('?')) path += `?${qs}`;
    }

    const res = await fetch(path);
    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = {}; }
      throw error(res.status, (body as { error?: string }).error ?? `${path} failed`);
    }

    const apiCache = res.headers.get('cache-control');
    if (apiCache) setHeaders({ 'cache-control': apiCache });

    return { [key]: (await res.json()) as T };
  };
}
