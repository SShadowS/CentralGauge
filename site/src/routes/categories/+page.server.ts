import type { PageServerLoad } from "./$types";
import type { CategoriesIndexResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";
import {
  fetchWithModeFallback,
  pageMode,
  withMode,
} from "$lib/server/page-mode";

// Dynamic — depends on D1 catalog state.
export const prerender = false;

export const load: PageServerLoad = async ({
  url,
  fetch,
  setHeaders,
  depends,
}) => {
  depends("app:categories");

  const requested = pageMode(url);
  const { res, mode, modeSplit } = await fetchWithModeFallback(
    fetch,
    (m) => withMode("/api/v1/categories", new URLSearchParams(), m),
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
      (body as { error?: string }).error ?? "categories load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    categories: (await res.json()) as CategoriesIndexResponse,
    mode,
    modeSplit,
  };
};
