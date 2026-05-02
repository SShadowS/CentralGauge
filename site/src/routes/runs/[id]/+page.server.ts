import type { PageServerLoad } from "./$types";
import type { RunDetail } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends(`app:run:${params.id}`);

  const res = await fetch(`/api/v1/runs/${params.id}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? `run ${params.id} not found`,
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    run: (await res.json()) as RunDetail,
  };
};
