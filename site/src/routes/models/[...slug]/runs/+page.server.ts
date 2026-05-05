import type { PageServerLoad } from "./$types";
import type { RunsListResponse, TaskSetsResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, url, fetch, setHeaders, depends },
) => {
  depends(`app:model:${params.slug}:runs`);

  const tsRes = await fetch("/api/v1/task-sets");
  const taskSets = tsRes.ok
    ? ((await tsRes.json()) as TaskSetsResponse).data
    : [];

  const sp = new URLSearchParams(url.searchParams);
  sp.set("model", params.slug);
  // Translate the consolidated `set` URL param into the runs endpoint's
  // `task_set` filter so the SetPicker behaves the same on this page as on
  // /, /matrix, /tasks. `set=all` and missing `set` are unfiltered.
  const setParam = sp.get("set");
  sp.delete("set");
  if (setParam === "current") {
    const current = taskSets.find((s) => s.is_current);
    if (current) sp.set("task_set", current.hash);
  } else if (setParam && /^[0-9a-f]{64}$/.test(setParam)) {
    sp.set("task_set", setParam);
  }

  const res = await fetch(`/api/v1/runs?${sp.toString()}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "runs load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    slug: params.slug,
    runs: (await res.json()) as RunsListResponse,
    cursor: url.searchParams.get("cursor"),
    taskSets,
    selectedSet: setParam ?? "all",
  };
};
