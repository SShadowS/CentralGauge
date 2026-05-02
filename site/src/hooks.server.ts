import type { Handle } from "@sveltejs/kit";
import { isRateLimited, type RateLimitBinding } from "$lib/server/rate-limit";
import { resetIdCounter } from "$lib/client/use-id";
import { isCanary } from "$lib/server/canary";
import { runNightlyBackup } from "./cron/nightly-backup";
import { runDailyDriftProbe } from "./cron/catalog-drift";

export { LeaderboardBroadcaster } from "./do/leaderboard-broadcaster";

interface ScheduledEnv {
  DB: D1Database;
  BLOBS: R2Bucket;
}

/**
 * Cloudflare cron entrypoint. Wired to the `[triggers].crons` block in
 * `wrangler.toml`. Branches by `controller.cron`:
 *   - `0 2 * * *` → nightly D1 -> R2 backup (src/cron/nightly-backup.ts)
 *   - `0 3 * * *` → daily catalog-drift probe (src/cron/catalog-drift.ts, P6 A6)
 *
 * Both run inline (no HTTP self-fetch), no shared secret. `ctx.waitUntil`
 * keeps the worker alive past the synchronous return so the work can finish
 * even if it outlives the cron tick.
 */
export async function scheduled(
  controller: ScheduledController,
  env: ScheduledEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (controller.cron === "0 2 * * *") {
    ctx.waitUntil(
      runNightlyBackup(env).catch((err) => {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          msg: "nightly_backup_failed",
          err: err instanceof Error ? err.message : String(err),
        }));
      }),
    );
    return;
  }
  if (controller.cron === "0 3 * * *") {
    ctx.waitUntil(
      runDailyDriftProbe(env).catch((err) => {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          msg: "catalog_drift_probe_failed",
          err: err instanceof Error ? err.message : String(err),
        }));
      }),
    );
    return;
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const handle: Handle = async ({ event, resolve }) => {
  // Reset the SSR id counter per request. Otherwise the long-lived Cloudflare
  // Worker isolate's counter drifts across requests, producing SSR ids that
  // don't match the client's fresh-start hydration counter. See
  // $lib/client/use-id.ts for context.
  resetIdCounter();

  // Canary-mode flag for downstream loaders. Today only used by
  // +layout.server.ts (loadFlags treats canary URLs as flags-on); future
  // consumers can read event.locals.canary directly.
  event.locals.canary = isCanary(event.url);

  // NB: paletteBus (cmd-K rune store at $lib/client/palette-bus.svelte) is
  // intentionally NOT imported here. The palette is mounted client-side
  // only, so its module-scope state is never reachable from SSR. Importing
  // a .svelte.ts file from hooks.server.ts pulls the Svelte 5 server runtime
  // chunk (`chunks/dev.js`) into the worker bundle, which breaks the vitest
  // pool-workers script-string loader. See palette-bus.svelte.ts header.

  const startNs = Date.now();
  const method = event.request.method;
  const path = event.url.pathname;
  const ip = event.request.headers.get("cf-connecting-ip") || "unknown";

  // Graceful degradation: if the platform bindings are somehow missing
  // (misconfiguration, local dev without --experimental-platform-proxy),
  // short-circuit the middleware rather than 500'ing every request.
  if (!event.platform) {
    return resolve(event);
  }

  // Admin lifecycle endpoints are Ed25519-signature-authenticated (key
  // revocation = throttle); IP-based limits would block legitimate weekly-CI
  // bursts (Phase G writes ~50 events per cycle × ~6 models = ~300/week,
  // and the throughput acceptance test exercises 100 events in tight loop).
  const shouldLimit = WRITE_METHODS.has(method) && path.startsWith("/api/") &&
    !path.startsWith("/api/v1/admin/lifecycle/");

  if (shouldLimit) {
    // The RL binding is provisioned via [[unsafe.bindings]] in wrangler.toml.
    // It is not yet emitted by `wrangler types`, so we narrow it locally.
    const rl = (event.platform.env as unknown as { RL?: RateLimitBinding }).RL;
    if (rl) {
      try {
        const result = await isRateLimited(rl, ip);
        if (result.limited) {
          const res = new Response(
            JSON.stringify({
              error: { code: "rate_limited", message: "Too many requests" },
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
                "retry-after": String(result.retry_after),
                "x-ratelimit-remaining": String(result.remaining),
              },
            },
          );
          logRequest(event.platform.env, {
            method,
            path,
            status: 429,
            ip,
            dur_ms: Date.now() - startNs,
          });
          return res;
        }
      } catch (err) {
        // Best-effort: if the binding throws we let the request through
        // rather than taking the whole API offline. Log the error so it surfaces.
        const env = event.platform.env as { LOG_LEVEL?: string };
        if (env.LOG_LEVEL !== "silent") {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "rate_limit_binding_error",
            err: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    }
  }

  const response = await resolve(event);

  // Surface canary-ness as a response header on every canary request.
  if (event.locals.canary) {
    response.headers.set("x-canary", "1");
  }

  logRequest(event.platform.env, {
    method,
    path,
    status: response.status,
    ip,
    dur_ms: Date.now() - startNs,
  });
  return response;
};

interface LogEntry {
  method: string;
  path: string;
  status: number;
  ip: string;
  dur_ms: number;
}

function logRequest(env: unknown, entry: LogEntry) {
  // Gate on LOG_LEVEL so test runs (which set LOG_LEVEL='silent' in
  // vitest.config.ts bindings) stay quiet. Production sets LOG_LEVEL
  // in wrangler.toml; if unset, we still log by default.
  //
  // The Cloudflare adapter blocks `platform.env.<key>` reads during prerender
  // (throws "Cannot access platform.env.LOG_LEVEL in a prerenderable route").
  // We treat any throw as "skip logging" — prerender shouldn't emit per-request
  // logs anyway.
  let level: string | undefined;
  try {
    level = (env as { LOG_LEVEL?: string }).LOG_LEVEL;
  } catch {
    return;
  }
  if (level === "silent") return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  }));
}
