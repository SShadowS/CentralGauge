import type { PageServerLoad } from "./$types";
import type { SetupDetail } from "$lib/server/setups";
import { error } from "@sveltejs/kit";

export const prerender = false;

export const load: PageServerLoad = async ({ params, fetch, setHeaders, depends }) => {
  depends("app:setups");
  const res = await fetch(`/api/v1/setups/${encodeURIComponent(params.id)}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(res.status, (body as { error?: string }).error ?? "setup load failed");
  }
  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });
  return { detail: (await res.json()) as SetupDetail };
};
