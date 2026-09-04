import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every GET route that reads D1 must either go through the epoch cache or be
 * listed below with a reason.
 *
 * This exists because of a specific, repeated failure. The cache rollout picked
 * its route list from a snapshot of the most expensive queries at one moment,
 * rather than from an audit of every route touching D1. Consequences, measured
 * in production on 2026-09-01, the first day the 5,000,000 rows/day cap was
 * enforced:
 *
 *   /api/v1/families/[slug]   104,781 rows x 19 calls = 1.99M   no cache at all
 *   /api/v1/categories         57,952 rows x 28 calls = 1.62M   L1 only, no L2
 *   /api/v1/summary            29,535 rows x 30 calls =  886k   L1 only, no L2
 *
 * 4.5M rows from 1,140 queries — 76% of the daily cap by mid-morning.
 *
 * Two lessons are encoded here rather than remembered:
 *
 *  1. A route list goes stale the moment someone adds a route. A check that
 *     enumerates the filesystem does not.
 *  2. Payload size is not query cost. `/api/v1/categories` was skipped because
 *     it returns under a kilobyte; it reads 57,952 rows to produce that
 *     kilobyte. Never judge a route by its response size.
 *
 * A new D1-reading GET route fails this test by default. That is the point:
 * adding one should require a deliberate decision, not silence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = resolve(HERE, "..", "..", "src", "routes");

/**
 * Routes allowed to read D1 without the epoch cache, each with the reason.
 * Adding an entry is a real decision — prefer wrapping the route in
 * `epochCachedJson` unless one of these rationales genuinely applies.
 */
const UNCACHED_ALLOWED: Record<string, string> = {
  // Admin surfaces: authenticated, single-operator, negligible volume, and
  // several are explicitly meant to read through to live state.
  "api/v1/admin/lifecycle/debug-bundle-exists": "admin, single operator",
  "api/v1/admin/lifecycle/events": "admin, must read live state",
  "api/v1/admin/lifecycle/r2/[...key]": "admin R2 proxy, not a D1 aggregate",
  "api/v1/admin/lifecycle/review/queue": "admin, must read live state",
  "api/v1/admin/lifecycle/state": "admin, must read live state",

  // Artifact and blob delivery: the D1 read is a metadata lookup, and the
  // payload is a stream that does not belong in a TEXT column.
  "api/v1/blobs/[sha256]": "R2 blob delivery, D1 read is a metadata lookup",
  "api/v1/runs/[id]/reproduce.tar.gz": "streamed artifact, not a JSON payload",
  "api/v1/runs/[id]/signature": "tiny lookup, already public s-maxage=3600",

  // Health and internal probes: caching these defeats their purpose.
  "api/v1/health/catalog-drift": "health probe, must read live state",
  "api/v1/sync/health": "health probe, must read live state",
  "api/v1/internal/search-index.json":
    "internal index build, freshness by design",

  // Routes with their own established named caches predating the epoch scheme.
  // These are DEBT, not exemptions: their keys are built from the raw URL and
  // are not epoch-invalidated, so a publish does not clear them and junk query
  // params still fragment them. Migrating them to epochCachedJson is the fix.
  "api/v1/concepts": "own named cache (pre-epoch scheme) - migration debt",
  "api/v1/concepts/[slug]":
    "own named cache (pre-epoch scheme) - migration debt",
  "api/v1/families/[slug]/diff":
    "own named cache (pre-epoch scheme) - migration debt",
  "api/v1/taxonomy": "own named cache (pre-epoch scheme) - migration debt",

  // Public reads that are genuinely uncovered. Not yet measured as hot, but
  // "not currently in the top queries" is precisely the reasoning that missed
  // /api/v1/families/[slug]. These are candidates for epochCachedJson, listed
  // so the gap is visible rather than forgotten.
  "api/v1/compare": "uncovered public read - candidate for epochCachedJson",
  "api/v1/families": "uncovered public read - candidate for epochCachedJson",
  "api/v1/models/[...slug]/limitations": "uncovered public read - candidate",
  "api/v1/runs": "uncovered public read - candidate for epochCachedJson",
  "api/v1/runs/[id]": "uncovered public read - candidate for epochCachedJson",
  "api/v1/search": "uncovered public read - candidate for epochCachedJson",
  "api/v1/tasks": "uncovered public read - candidate for epochCachedJson",
  "api/v1/tasks/[...id]":
    "uncovered public read - candidate for epochCachedJson",
  "og/runs/[id].png": "uncovered OG route - candidate for epochCachedJson",

  // Taxonomy v2 (Plan B, dark launch). Every one of these goes through
  // `v2Json`, which stores in the named `cg-v2` cache under a key of URL +
  // CACHE_VERSION + revision digest + scoring-policy digest. That key retires
  // instantly when a revision or policy changes, but it does NOT move when a
  // run is ingested, so for the run- and model-shaped routes it is a 60s TTL
  // like the pre-epoch named caches above: same debt, newer code. None is
  // reachable in production until a schema-version-2 taxonomy is activated
  // (they 404 `no_active_revision` before that). Release 2 migrates them onto
  // epochCachedJson; until then the exemption is listed per route so the gap
  // stays visible.
  "api/v2/categories":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/exports":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/models":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/releases":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/releases/[slug]":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/runs":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/runs/[id]":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/task-sets":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/tasks":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/tasks/[...id]":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
  "api/v2/taxonomy":
    "v2 dark launch: cg-v2 named cache, 60s TTL - release 2 migrates",
};

interface RouteInfo {
  route: string;
  cached: boolean;
}

function collectD1GetRoutes(dir: string, acc: RouteInfo[] = []): RouteInfo[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectD1GetRoutes(full, acc);
      continue;
    }
    if (entry !== "+server.ts") continue;

    const src = readFileSync(full, "utf8");
    if (!/export const GET/.test(src)) continue;
    // `platform.env.DB` / `platform!.env.DB` / a destructured `env.DB`.
    if (!/[^.]env\.DB|platform!?\.env\.DB/.test(src)) continue;

    acc.push({
      route: full
        .slice(ROUTES.length + 1)
        .split(sep)
        .join("/")
        .replace("/+server.ts", ""),
      cached: src.includes("readDataEpoch") || src.includes("epochCachedJson"),
    });
  }
  return acc;
}

describe("every D1-reading GET route is cached or explicitly exempted", () => {
  const routes = collectD1GetRoutes(ROUTES);

  it("finds routes to check at all", () => {
    // Guards the guard: a broken walk or a changed layout would make every
    // assertion below vacuously pass.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.some((r) => r.route === "api/v1/leaderboard")).toBe(true);
  });

  it("has no unlisted uncached route", () => {
    const offenders = routes
      .filter((r) => !r.cached && !(r.route in UNCACHED_ALLOWED))
      .map((r) => r.route);

    expect(
      offenders,
      offenders.length
        ? `These GET routes read D1 with no epoch cache and no exemption:\n` +
            offenders.map((r) => `  - ${r}`).join("\n") +
            `\n\nWrap them with epochCachedJson (src/lib/server/shared-cache.ts), ` +
            `or add them to UNCACHED_ALLOWED with a reason. Do not judge by ` +
            `response size: /api/v1/categories returns under a kilobyte and ` +
            `reads 57,952 rows to do it.`
        : "",
    ).toEqual([]);
  });

  it("keeps the routes that measured hottest cached", () => {
    // These three were the 4.5M/day. Regressing any of them is the exact
    // failure this file exists to prevent, so they are named, not inferred.
    for (const critical of [
      "api/v1/leaderboard",
      "api/v1/families/[slug]",
      "api/v1/categories",
      "api/v1/summary",
      "api/v1/models",
      "api/v1/models/[...slug]",
    ]) {
      const found = routes.find((r) => r.route === critical);
      expect(found, `${critical} not found — was it renamed?`).toBeDefined();
      expect(found!.cached, `${critical} lost its epoch cache`).toBe(true);
    }
  });

  it("has no stale exemptions", () => {
    // An entry that is now cached, or names a route that no longer exists,
    // should be deleted rather than left to rot into misleading documentation.
    const names = new Set(routes.map((r) => r.route));
    const cachedNames = new Set(
      routes.filter((r) => r.cached).map((r) => r.route),
    );
    const stale = Object.keys(UNCACHED_ALLOWED).filter(
      (r) => !names.has(r) || cachedNames.has(r),
    );
    expect(
      stale,
      `stale UNCACHED_ALLOWED entries: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
