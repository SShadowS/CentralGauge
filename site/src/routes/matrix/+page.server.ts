import type { PageServerLoad } from "./$types";
import type { MatrixResponse } from "$lib/shared/api-types";
import { error } from "@sveltejs/kit";

// Dynamic — depends on D1 catalog state.
export const prerender = false;

export const load: PageServerLoad = async (
  { url, fetch, setHeaders, depends },
) => {
  depends("app:matrix");

  // Mirror filters into the API query string. The endpoint validates the
  // values and returns 400 for malformed inputs; we surface those as 4xx
  // errors here so SvelteKit renders +error.svelte.
  const params = new URLSearchParams();
  const set = url.searchParams.get("set");
  if (set === "current" || set === "all") params.set("set", set);
  const category = url.searchParams.get("category")?.trim();
  if (category) params.set("category", category);
  const difficulty = url.searchParams.get("difficulty");
  if (difficulty) params.set("difficulty", difficulty);

  const qs = params.toString();
  const apiPath = qs ? `/api/v1/matrix?${qs}` : "/api/v1/matrix";
  const res = await fetch(apiPath);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "matrix load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  const matrix = (await res.json()) as MatrixResponse;
  return { matrix };
};
