import type { PageServerLoad } from "./$types";
import type { ModelsIndexResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";
import {
  fetchWithModeFallback,
  pageMode,
  withMode,
} from "$lib/server/page-mode";

// /api/v1/models is a mode-scoped ranked endpoint (D4 follow-up); previously
// this route used the generic `passthroughLoader` helper, but that helper
// forwards query params verbatim with no mode-fallback awareness, so the
// fetch is inlined here instead.
export const load: PageServerLoad = async ({
  url,
  fetch,
  setHeaders,
  depends,
}) => {
  depends("app:models");

  const requested = pageMode(url);
  const { res, mode, modeSplit } = await fetchWithModeFallback(
    fetch,
    (m) => withMode("/api/v1/models", url.searchParams, m),
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
      (body as { error?: string }).error ?? "/api/v1/models failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    models: (await res.json()) as ModelsIndexResponse,
    mode,
    modeSplit,
    filters: {
      family: url.searchParams.get("family") ?? "",
      has_runs: url.searchParams.get("has_runs") ?? "",
    },
  };
};
