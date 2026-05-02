import type { ServerLoad } from "@sveltejs/kit";
import type { FamilyDetail, FamilyDiff } from "$lib/shared/api-types";
import { error } from "@sveltejs/kit";
import { checkDebugBundleAvailable } from "$lib/server/lifecycle-debug-bundle";

/**
 * Family page loader. Fetches the existing FamilyDetail payload and the
 * Phase E concept diff in parallel; for analyzer_mismatch results,
 * additionally HEADs R2 server-side to determine whether the prior
 * generation's debug bundle is retained — the trajectory section's
 * "Re-analyze" CTA is disabled when the bundle is absent.
 *
 * Why direct R2 HEAD (not via /api/v1/admin/lifecycle/debug-bundle-exists):
 *   The HEAD endpoint is admin-signed and the worker doesn't own a private
 *   key for self-signing. Doing the lookup inline against
 *   platform.env.DB + platform.env.LIFECYCLE_BLOBS is the natural path —
 *   the data exposed (a boolean availability flag) is no more sensitive
 *   than what the diff endpoint already returns. The standalone admin
 *   endpoint exists for CLI consumers (e.g. operator scripting that
 *   wants to batch-check bundles).
 *
 * The diff endpoint never 500s for a missing diff (it returns a
 * baseline_missing shell when no analysis events exist), so any non-200
 * response is a real error — surface via SvelteKit's `error()`.
 */
export const load: ServerLoad = async (
  { params, fetch, depends, setHeaders, platform },
) => {
  const slug = params.slug!;
  depends(`app:family:${slug}`);

  const [famR, diffR] = await Promise.all([
    fetch(`/api/v1/families/${slug}`),
    fetch(`/api/v1/families/${slug}/diff`),
  ]);

  if (!famR.ok) {
    let body: { error?: string } = {};
    try {
      body = await famR.json() as { error?: string };
    } catch { /* swallow */ }
    throw error(famR.status, body.error ?? `family fetch ${famR.status}`);
  }
  if (!diffR.ok) {
    let body: { error?: string } = {};
    try {
      body = await diffR.json() as { error?: string };
    } catch { /* swallow */ }
    throw error(diffR.status, body.error ?? `diff fetch ${diffR.status}`);
  }

  const family = await famR.json() as FamilyDetail;
  const diff = await diffR.json() as FamilyDiff;

  // Propagate cache-control from the family endpoint so SvelteKit's response
  // TTL matches the API's (existing /api/v1/families/<slug> emits
  // private,max-age=60).
  const apiCache = famR.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  let r2BundleAvailable = false;
  if (
    diff.status === "analyzer_mismatch" &&
    diff.from_gen_event_id != null &&
    platform?.env?.LIFECYCLE_BLOBS &&
    platform?.env?.DB
  ) {
    // Delegate to the shared `checkDebugBundleAvailable` helper so the
    // family page loader and the `/admin/lifecycle/debug-bundle-exists`
    // endpoint stay byte-equivalent in their availability semantics.
    // The loader collapses any non-success result to false (the UI just
    // needs the boolean to gate the "Re-analyze gen N" CTA); the admin
    // endpoint surfaces the discriminated reason via its JSON body.
    const status = await checkDebugBundleAvailable(
      platform.env.DB,
      platform.env.LIFECYCLE_BLOBS,
      diff.from_gen_event_id,
    );
    r2BundleAvailable = status.exists;
  }

  return { family, diff, r2BundleAvailable };
};
