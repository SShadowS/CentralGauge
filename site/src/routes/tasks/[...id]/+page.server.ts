import type { PageServerLoad } from "./$types";
import type { TaskDetail } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends(`app:task:${params.id}`);

  const res = await fetch(`/api/v1/tasks/${params.id}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? `task ${params.id} not found`,
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    task: (await res.json()) as TaskDetail,
  };
};
