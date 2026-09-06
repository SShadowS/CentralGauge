import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import {
  fetchWithModeFallback,
  pageMode,
  withMode,
} from "$lib/server/page-mode";

export const load: PageServerLoad = async ({
  params,
  url,
  fetch,
  setHeaders,
  depends,
}) => {
  depends(`app:model:${params.slug}:limitations`);

  const requested = pageMode(url);
  // Fetch as markdown text (the API supports content negotiation). The
  // helper's 400-detection reads the response as JSON on the failure path
  // only; a markdown body on an ok response is untouched.
  const { res, mode, modeSplit } = await fetchWithModeFallback(
    (input, init) =>
      fetch(input, { ...init, headers: { accept: "text/markdown" } }),
    (m) =>
      withMode(
        `/api/v1/models/${params.slug}/limitations`,
        new URLSearchParams(),
        m,
      ),
    requested,
  );
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "limitations load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    slug: params.slug,
    markdown: await res.text(),
    mode,
    modeSplit,
  };
};
