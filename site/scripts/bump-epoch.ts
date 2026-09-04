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
import { execSync } from "node:child_process";

const local = process.argv.includes("--local");
const target = local ? "--local" : "--remote";

// Built as one shell string with the SQL explicitly quoted. execFileSync with
// `shell: true` splits the SQL on spaces on Windows (npx needs the shell to
// resolve npx.cmd), so wrangler saw each word as a separate argument.
function d1(sql: string, extra = ""): string {
  return execSync(
    `npx wrangler d1 execute centralgauge ${target} ${extra} --command "${sql}"`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

console.log(`Bumping data epoch (${local ? "local" : "remote"})...`);
d1("UPDATE cache_epoch SET epoch = epoch + 1 WHERE id = 1");
const out = d1("SELECT epoch FROM cache_epoch WHERE id = 1", "--json");
const epoch = JSON.parse(out.slice(out.indexOf("[")))[0].results[0].epoch;
console.log(
  `Done — epoch is now ${epoch}. Every cached aggregate is retired; the next request recomputes.`,
);
