import type { PageServerLoad } from "./$types";
import type { CompareResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { url, fetch, setHeaders, depends },
) => {
  const models = (url.searchParams.get("models") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  depends(`app:compare:${[...models].sort().join(",")}`);

  if (models.length < 2) {
    // Empty state — no fetch, no error
    return { compare: null, requested: models };
  }
  if (models.length > 4) {
    throw error(400, "compare supports at most 4 models");
  }

  const sp = new URLSearchParams();
  sp.set("models", models.join(","));
  const res = await fetch(`/api/v1/compare?${sp.toString()}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "compare load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    compare: (await res.json()) as CompareResponse,
    requested: models,
  };
};
