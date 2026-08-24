/**
 * Manually bump the D1 data epoch, retiring every cached aggregate.
 *
 *   npm run bump-epoch            # production
 *   npm run bump-epoch -- --local # local dev D1
 *
 * You need this only after writing to D1 OUT OF BAND — that is, without going
 * through an API route. The routes bump the epoch inside their own write batch
 * (see src/lib/server/data-epoch.ts), so a normal publish needs nothing here.
 *
 * Out-of-band writes include:
 *   - `wrangler d1 execute ... --command "UPDATE ..."`
 *   - restoring from an R2 backup dump
 *   - `populate-task-set` and similar direct-write backfill scripts
 *   - any hand-edit via the Cloudflare dashboard
 *
 * Skipping it after such a write leaves every colo serving pre-change
 * aggregates until the 24h TTL expires, because nothing signalled the change.
 */
import { execFileSync } from "node:child_process";

const local = process.argv.includes("--local");
const args = [
  "wrangler",
  "d1",
  "execute",
  "centralgauge",
  local ? "--local" : "--remote",
  "--command",
  "UPDATE cache_epoch SET epoch = epoch + 1 WHERE id = 1; SELECT epoch FROM cache_epoch WHERE id = 1",
];

console.log(`Bumping data epoch (${local ? "local" : "remote"})...`);
execFileSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
console.log("Done. Every cached aggregate is now retired; the next request recomputes.");
