import type { PageServerLoad } from "./$types";
import type { SetupDetail } from "$lib/server/setups";
import { error } from "@sveltejs/kit";

export const prerender = false;

export const load: PageServerLoad = async ({ url, fetch, setHeaders, depends }) => {
  depends("app:setups");
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length < 2) return { details: null as [SetupDetail, SetupDetail] | null };
  if (ids.length > 2) throw error(400, "compare takes exactly two setups");

  const responses = await Promise.all(ids.map((id) => fetch(`/api/v1/setups/${encodeURIComponent(id)}`)));
  for (const res of responses) {
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      throw error(res.status, (body as { error?: string }).error ?? "setup load failed");
    }
  }
  const apiCache = responses[0].headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });
  const details = (await Promise.all(responses.map((r) => r.json()))) as [SetupDetail, SetupDetail];
  return { details };
};
