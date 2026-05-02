/**
 * SSE event-to-route-pattern mapping. The Durable Object pre-filters fanout
 * so a subscriber to `/` doesn't receive `/models/sonnet-4-7`-only
 * events.
 *
 * Pattern syntax:
 *   - Literal route ("/", "/runs/r-001"): exact match
 *   - Wildcard segment ("/models/*"): matches any single segment value
 *   - Star ("*"): matches everything (used by `ping` heartbeats)
 *
 * Both sides (event-routes + subscriber-routes) can use any pattern; matching
 * is bidirectional intersection — see `routePatternMatches`.
 */
import type { BroadcastEvent } from "../../do/leaderboard-broadcaster";

export function eventToRoutes(ev: BroadcastEvent): string[] {
  switch (ev.type) {
    case "run_finalized": {
      const runId = (ev as { run_id?: string }).run_id;
      const modelSlug = (ev as { model_slug?: string }).model_slug;
      const familySlug = (ev as { family_slug?: string }).family_slug;
      // Defensive: malformed event without identifiers fans out to nothing.
      // Avoids broadcasting noise to every client when the producer slipped.
      if (!runId && !modelSlug && !familySlug) return [];
      const routes: string[] = ["/", "/runs"];
      if (runId) routes.push(`/runs/${runId}`);
      if (modelSlug) routes.push(`/models/${modelSlug}`);
      if (familySlug) routes.push(`/families/${familySlug}`);
      return routes;
    }
    case "task_set_promoted":
      // Promotion changes every leaderboard row's task-set membership and
      // every model's `is_current` aggregate, so we wildcard models.
      // /tasks is intentionally absent: spec §8.5 subscriber list does
      // not include /tasks, so fanning out there is dead noise. Add
      // /tasks back if a future plan subscribes the page.
      return ["/", "/models/*"];
    case "shortcoming_added": {
      const modelSlug = (ev as { model_slug?: string }).model_slug;
      const routes = ["/limitations"];
      if (modelSlug) routes.push(`/models/${modelSlug}`);
      return routes;
    }
    case "ping":
      return ["*"];
    default:
      // Exhaustiveness sentinel — adding a new BroadcastEvent type without
      // updating this switch should fail typecheck if we tighten the union.
      return [];
  }
}

// 14-day SSE alias for stale-tab support (sunset 2026-05-30 with the
// /leaderboard +server.ts redirect). Treat an INCOMING subscription
// pattern of `/leaderboard` as if it were `/` so a tab held across
// cutover still receives events. Outgoing event routes are NOT aliased
// (eventToRoutes() emits events tagged `/`, not `/leaderboard`).
//
// SUNSET 2026-05-30: when src/routes/leaderboard/+server.ts is deleted,
// ALSO remove this alias.
const LEGACY_LEADERBOARD_ROUTES = new Set(["/leaderboard"]);
const LEGACY_LEADERBOARD_TARGET = "/";

/**
 * Returns true if the union of event routes and subscriber routes share at
 * least one match. Both sides may use literals, wildcard segments, or "*".
 */
export function routePatternMatches(
  eventRoutes: string[],
  subscriberRoutes: string[],
): boolean {
  if (eventRoutes.length === 0 || subscriberRoutes.length === 0) return false;
  // Alias legacy `/leaderboard` subscriptions to `/` (unidirectional).
  const aliasedSubscriberRoutes = subscriberRoutes.map((p) =>
    LEGACY_LEADERBOARD_ROUTES.has(p) ? LEGACY_LEADERBOARD_TARGET : p
  );
  for (const er of eventRoutes) {
    for (const sr of aliasedSubscriberRoutes) {
      if (matchOne(er, sr) || matchOne(sr, er)) return true;
    }
  }
  return false;
}

function matchOne(a: string, b: string): boolean {
  if (a === "*" || b === "*") return true;
  if (a === b) return true;
  // Wildcard segment: "/models/*" matches "/models/<anything-no-slash>"
  if (a.endsWith("/*")) {
    const prefix = a.slice(0, -1); // "/models/"
    if (b.startsWith(prefix) && !b.slice(prefix.length).includes("/")) {
      return true;
    }
  }
  return false;
}
