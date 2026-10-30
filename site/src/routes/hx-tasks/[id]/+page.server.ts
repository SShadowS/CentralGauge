import type { PageServerLoad } from "./$types";
import type { HxTaskResponse } from "$lib/shared/api-types";
import { error } from "@sveltejs/kit";

export const prerender = false;

export const load: PageServerLoad = async ({ params, url, fetch, setHeaders, depends }) => {
  depends("app:setups");
  const set = url.searchParams.get("set");
  const res = await fetch(
    `/api/v1/hx-tasks/${encodeURIComponent(params.id)}${set ? `?set=${encodeURIComponent(set)}` : ""}`,
  );
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(res.status, (body as { error?: string }).error ?? "task load failed");
  }
  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });
  return { task: (await res.json()) as HxTaskResponse };
};
