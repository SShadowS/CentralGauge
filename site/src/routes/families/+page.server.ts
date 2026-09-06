import type { PageServerLoad } from "./$types";
import type { FamiliesIndexResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";
import {
  fetchWithModeFallback,
  pageMode,
  withMode,
} from "$lib/server/page-mode";

// /api/v1/families is a mode-scoped index call (D4 follow-up); previously
// this route used the generic `passthroughLoader` helper, but that helper
// forwards query params verbatim with no mode-fallback awareness, so the
// fetch is inlined here instead.
export const load: PageServerLoad = async ({
  url,
  fetch,
  setHeaders,
  depends,
}) => {
  depends("app:families");

  const requested = pageMode(url);
  const { res, mode, modeSplit } = await fetchWithModeFallback(
    fetch,
    (m) => withMode("/api/v1/families", url.searchParams, m),
    requested,
  );
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "/api/v1/families failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    families: (await res.json()) as FamiliesIndexResponse,
    mode,
    modeSplit,
  };
};
