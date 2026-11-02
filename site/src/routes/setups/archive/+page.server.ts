import type { PageServerLoad } from "./$types";
import type { SetupTaskSet } from "$lib/server/setups";
import { error } from "@sveltejs/kit";

export const prerender = false;

export const load: PageServerLoad = async ({ fetch, setHeaders }) => {
  const res = await fetch("/api/v1/setup-task-sets");
  if (!res.ok) throw error(res.status, "setup task sets load failed");
  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });
  const { sets } = (await res.json()) as { sets: SetupTaskSet[] };
  return { sets };
};
