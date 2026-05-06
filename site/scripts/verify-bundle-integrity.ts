#!/usr/bin/env tsx
/**
 * Post-build sanity check: verify that the built worker bundle contains
 * string references to every aggregate field name declared in api-types.ts.
 *
 * This catches the regression class where a 3-way merge silently drops field
 * assignments from a route handler. If the bundle contains the string literal
 * of a field name, the wiring almost certainly exists; if it's absent, the
 * handler forgot to include it.
 *
 * Run as part of `npm run build` (chained after vite build + wrap-worker-exports).
 * Exits 1 on failure so the build chain aborts.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const BUNDLE_DIR = resolve(
  import.meta.dirname ?? process.cwd(),
  "..",
  ".svelte-kit",
  "output",
  "server",
);

// Field names that MUST appear somewhere in the server bundle.
// Mirrors the keys declared in:
//   - ModelDetail["aggregates"]    (GET /api/v1/models/:slug)
//   - LeaderboardRow               (GET /api/v1/leaderboard)
//
// If you add a field to either type, add the string here AND wire it up in
// the corresponding route handler. This script will fail the build if you do
// one without the other.
const REQUIRED_FIELDS: readonly string[] = [
  // ModelDetail.aggregates
  "avg_score",
  "tasks_attempted",
  "tasks_passed",
  "tasks_attempted_distinct",
  "tasks_passed_attempt_1",
  "tasks_passed_attempt_2_only",
  "pass_at_n",
  "avg_cost_usd",
  "latency_p50_ms",
  "latency_p95_ms",
  "pass_rate_ci",
  "pass_hat_at_n",
  "cost_per_pass_usd",
  "run_count",
  "verified_runs",
  // LeaderboardRow extras (beyond ModelDetail.aggregates overlap above)
  "last_run_at",
  "family_slug",
  // A.4 new fields: strict denominator + deprecated alias + pass@1
  "denominator",
  "pass_at_1",
  "pass_at_n_per_attempted",
];

function walkAndConcat(dir: string): string {
  let combined = "";
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return combined;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      combined += walkAndConcat(full);
    } else if (entry.endsWith(".js") || entry.endsWith(".mjs")) {
      try {
        combined += readFileSync(full, "utf8");
      } catch {
        // skip unreadable files
      }
    }
  }
  return combined;
}

const bundle = walkAndConcat(BUNDLE_DIR);

if (bundle.length === 0) {
  console.error(
    "[bundle-integrity] FAIL — no JS files found under .svelte-kit/output/server/",
  );
  console.error(
    "  Did you run `npm run build` before this script?",
  );
  process.exit(1);
}

const missing = REQUIRED_FIELDS.filter((f) => !bundle.includes(f));

if (missing.length > 0) {
  console.error(
    "[bundle-integrity] FAIL — fields missing from worker bundle:",
  );
  for (const f of missing) console.error(`  - ${f}`);
  console.error(
    "\nThis means the built worker bundle does not contain a string reference",
    "to one or more aggregate/row fields declared in api-types.ts.",
    "\nLikely cause: the field was added to the type but not wired into a route",
    "handler, or a merge commit silently dropped the assignment.",
  );
  process.exit(1);
}

console.log(
  `[bundle-integrity] OK — all ${REQUIRED_FIELDS.length} required fields present in bundle.`,
);
