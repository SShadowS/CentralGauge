import type { PageServerLoad } from "./$types";
import type {
  TasksIndexResponse,
  TaskSetsResponse,
  TaxonomyResponse,
} from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { url, fetch, setHeaders, depends },
) => {
  depends("app:tasks");

  const sp = new URLSearchParams();
  const set = url.searchParams.get("set") ?? "current";
  sp.set("set", set);
  const cursor = url.searchParams.get("cursor");
  if (cursor) sp.set("cursor", cursor);
  const difficulty = url.searchParams.get("difficulty") ?? "";
  if (difficulty) sp.set("difficulty", difficulty);
  const category = url.searchParams.get("category") ?? "";
  if (category) sp.set("category", category);
  const activeTags = url.searchParams.getAll("tag");
  for (const tag of activeTags) {
    sp.append("tag", tag);
  }

  const [res, tsRes, taxRes] = await Promise.all([
    fetch(`/api/v1/tasks?${sp.toString()}`),
    fetch("/api/v1/task-sets"),
    fetch("/api/v1/taxonomy"),
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
      (body as { error?: string }).error ?? "tasks load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  const taskSets = tsRes.ok
    ? ((await tsRes.json()) as TaskSetsResponse).data
    : [];

  const taxonomy: TaxonomyResponse = taxRes.ok
    ? await taxRes.json()
    : { groups: [], tags: [], generated_at: "" };

  return {
    tasks: (await res.json()) as TasksIndexResponse,
    filters: { set, difficulty, category },
    taskSets,
    cursor,
    taxonomy,
    activeTags,
  };
};
