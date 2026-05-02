import type { PageServerLoad } from "./$types";
import type { CategoriesIndexResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";

// Dynamic — depends on D1 catalog state.
export const prerender = false;

export const load: PageServerLoad = async ({ fetch, setHeaders, depends }) => {
  depends("app:categories");

  const res = await fetch("/api/v1/categories");
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
  };
};
