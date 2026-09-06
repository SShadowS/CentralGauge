import type { PageServerLoad } from "./$types";
import type { MatrixResponse, TaskSetsResponse } from "$lib/shared/api-types";
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
  depends("app:matrix");

  // Mirror filters into the API query string. The endpoint validates the
  // values and returns 400 for malformed inputs; we surface those as 4xx
  // errors here so SvelteKit renders +error.svelte.
  const params = new URLSearchParams();
  const set = url.searchParams.get("set");
  if (
    set === "current" ||
    set === "all" ||
    (set && /^[0-9a-f]{64}$/.test(set))
  ) {
    params.set("set", set);
  }
  const category = url.searchParams.get("category")?.trim();
  if (category) params.set("category", category);
  const difficulty = url.searchParams.get("difficulty");
  if (difficulty) params.set("difficulty", difficulty);

  const requested = pageMode(url);
  const [{ res, mode, modeSplit }, tsRes] = await Promise.all([
    fetchWithModeFallback(
      fetch,
      (m) => withMode("/api/v1/matrix", params, m),
      requested,
    ),
    fetch("/api/v1/task-sets"),
  ]);
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
  const taskSets = tsRes.ok
    ? ((await tsRes.json()) as TaskSetsResponse).data
    : [];
  return { matrix, taskSets, mode, modeSplit };
};
