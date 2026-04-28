/**
 * 30-day sunset 302 redirect from the pre-cutover URL `/leaderboard`
 * to the post-cutover homepage `/`. Preserves query string verbatim
 * so bookmarked filtered views (e.g. `?tier=verified&sort=...`) land
 * on the equivalent filtered homepage.
 *
 * SUNSET: this file MUST be deleted by 2026-05-30. The
 * `tests/build/redirect-sunset.test.ts` guard fails CI 14 days BEFORE
 * sunset (2026-05-16) to force operator attention.
 *
 * SUNSET 2026-05-30: when this file is deleted, ALSO remove the
 * LEGACY_LEADERBOARD_ROUTES alias from src/lib/server/sse-routes.ts.
 * The alias's only purpose is keeping stale tabs (with the legacy
 * /leaderboard subscription) receiving events for the 30-day window.
 *
 * Why 302 (architect I4 finding), not 301/307/308:
 * - 302 (Found, temporary): crawlers keep checking back; browsers cache
 *   only as long as `cache-control` allows. Right semantics for a 30-day
 *   sunset: post-deletion-day, cached clients re-fetch within max-age and
 *   discover the 404.
 * - 301 (permanent): crawlers update their index forever AND browsers may
 *   cache aggressively (combined with `Cache-Control: ...immutable`,
 *   indefinitely). Wrong for a route we're about to delete.
 * - 307/308: preserve method (POST stays POST). Not relevant here —
 *   `/leaderboard` had no POST handler.
 */
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
  // Preserve the query string verbatim. `url.search` is `''` for no
  // params or `?foo=bar` (with leading `?`) when params present.
  return new Response(null, {
    status: 302,
    headers: {
      location: `/${url.search}`,
      // 1-hour cache; NOT immutable. Post-deletion-day clients re-fetch
      // within the hour and learn the URL is gone. See architect I4.
      'cache-control': 'public, max-age=3600',
    },
  });
};
