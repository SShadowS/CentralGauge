import type { ServerLoadEvent } from "@sveltejs/kit";
import { error } from "@sveltejs/kit";

interface PassthroughOpts<TKey extends string = "data"> {
  depTag: string | ((params: Record<string, string>) => string);
  fetchPath: string | ((url: URL, params: Record<string, string>) => string);
  /** When set, only these query params are forwarded to the API; otherwise all are. */
  forwardParams?: string[];
  /**
   * Key under which the parsed JSON is exposed to the page. Defaults to `'data'`.
   *
   * Pass a string LITERAL (not a string variable) so TypeScript infers the
   * literal type and the return type is `{[K in TKey]: TVal}`. If you pass a
   * non-literal string, TKey widens to `string` and you lose the precise type.
   */
  resultKey?: TKey;
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
 * Returns `Promise<{[K in TKey]: TVal}>` — precisely typed via TypeScript
 * literal-type inference on the `resultKey` argument. Default `TKey = 'data'`.
 *
 * **Type-inference caveat:** TypeScript only infers `TKey` as a string literal
 * when `resultKey` is passed as a string LITERAL at the call site. If a
 * variable typed as `string` is passed, `TKey` widens to `string` and the
 * return type degrades to `Record<string, TVal>` — same as plan v1 pre-fix.
 * In practice every existing call site passes a literal (`'results'`,
 * `'tasks'`, etc.); the literal-type inference is what lets us drop the
 * 17 consumer-side casts.
 *
 * **Rare collision case:** if a future call site assigns `resultKey: 'data'`
 * AND the page expects `data.<something else>`, the TKey default ('data')
 * silently matches — no compile error, but the page sees an unexpected
 * shape. Mitigation: always pass `resultKey` explicitly when not 'data'.
 */
export function passthroughLoader<TVal, TKey extends string = "data">(
  opts: PassthroughOpts<TKey>,
) {
  // Cast inside the helper — externally the return type is precise.
  const key = (opts.resultKey ?? "data") as TKey;
  return async (event: ServerLoadEvent): Promise<{ [K in TKey]: TVal }> => {
    const { url, params, fetch, setHeaders, depends } = event;
    const tag = typeof opts.depTag === "function"
      ? opts.depTag(params)
      : opts.depTag;
    depends(tag);

    let path = typeof opts.fetchPath === "function"
      ? opts.fetchPath(url, params)
      : opts.fetchPath;
    if (opts.forwardParams) {
      const sp = new URLSearchParams();
      for (const k of opts.forwardParams) {
        const v = url.searchParams.get(k);
        if (v !== null && v !== "") sp.set(k, v);
      }
      const qs = sp.toString();
      if (qs) path += `?${qs}`;
    } else {
      const qs = url.searchParams.toString();
      if (qs && !path.includes("?")) path += `?${qs}`;
    }

    const res = await fetch(path);
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      throw error(
        res.status,
        (body as { error?: string }).error ?? `${path} failed`,
      );
    }

    const apiCache = res.headers.get("cache-control");
    if (apiCache) setHeaders({ "cache-control": apiCache });

    return { [key]: (await res.json()) as TVal } as { [K in TKey]: TVal };
  };
}
