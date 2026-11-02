import type { PageServerLoad } from "./$types";
import type { SetupsResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const prerender = false;

export const load: PageServerLoad = async ({ url, fetch, setHeaders, depends }) => {
  depends("app:setups");
  const set = url.searchParams.get("set");
  const priv = url.searchParams.get("private") === "1";

  const qs = new URLSearchParams();
  if (set) qs.set("set", set);
  if (priv) qs.set("private", "1");
  const q = qs.toString();

  const res = await fetch(`/api/v1/setups${q ? `?${q}` : ""}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(res.status, (body as { error?: string }).error ?? "setups load failed");
  }
  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  const payload = (await res.json()) as SetupsResponse;
  return { setups: payload, set, showPrivate: priv };
};
