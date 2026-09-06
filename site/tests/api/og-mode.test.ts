import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { seedSmokeData } from "../utils/seed";

/**
 * D4 fix round 1, finding 1: og/* routes call resolveInvocationMode, which
 * throws ApiError("mode_required") on a mixed-mode current task set. Before
 * this fix, none of the three og/* handlers wrapped their body in a
 * try/catch, so that ApiError propagated as an unhandled exception —
 * SvelteKit turns that into an opaque 500, not the visible 400 the inline
 * "acceptable and visible, per D4" comments promised.
 *
 * Own file (own vitest-pool-workers isolate, own Cache API namespace) so the
 * two-mode seed below cannot collide with og-images.test.ts's single-mode
 * fixture and its own cached responses.
 */
describe("og/* routes surface mode_required as a visible 400", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await resetDb();
    await seedSmokeData({ runCount: 1 });
    // Add a second run for the SAME model, on the same (current) task set,
    // under the batch mode — the current set now has both modes present, so
    // resolveInvocationMode's default rule (no explicit ?mode=) must refuse
    // rather than silently pick one.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
       VALUES ('run-batch-1','ts',1,'s','rig','2026-04-27T12:00:00Z','2026-04-27T12:05:00Z','completed','claimed','v1','sig','2026-04-27T12:00:00Z',1,'{}','batch')`,
    ).run();
  });

  it.each([
    ["GET /og/index.png", "http://x/og/index.png"],
    ["GET /og/models/sonnet-4-7.png", "http://x/og/models/sonnet-4-7.png"],
    ["GET /og/families/claude.png", "http://x/og/families/claude.png"],
  ])(
    "%s returns a visible 400 mode_required, not a 500",
    async (_label, url) => {
      const res = await SELF.fetch(url);
      expect(res.status).toBe(400);
      const body = await res.json<{ code: string }>();
      expect(body.code).toBe("mode_required");
    },
  );
});

/**
 * D4 fix round 1, finding 2: each og/* handler built its `cg-og` cache key
 * BEFORE resolving the invocation mode and WITHOUT `mode` in the key params —
 * so an explicit `?mode=sync` request and an explicit `?mode=batch` request
 * (different raw URLs, so this is NOT the platform's own URL-keyed
 * `caches.default` — that layer is orthogonal and would treat them as
 * distinct regardless) shared the SAME internal `cg-og` entry, because that
 * entry's key was built from an empty (or slug-only) params object with no
 * `mode` segment. Whichever mode rendered first "won" the entry for both.
 *
 * Observable via the `x-og-cache` response header: `"miss"` means the
 * handler ran the full compute path for THIS request; `"epoch"` means it was
 * served from the `cg-og` L1/L2 tier without recomputing. Pre-fix, the
 * second (batch) request below would come back `"epoch"` — silently reusing
 * the first (sync) request's rendered bytes. Post-fix, `mode` is part of the
 * key, so the second request is a genuine miss, and repeating either request
 * now correctly hits its own entry.
 *
 * Own describe block (separate D1 state via `resetDb()`) so this fixture
 * cannot collide with the mixed-mode fixture in the describe block above.
 */
describe("og/* routes key their cache entry by the resolved mode", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it.each([
    ["GET /og/index.png", "http://x/og/index.png"],
    ["GET /og/models/sonnet-4-7.png", "http://x/og/models/sonnet-4-7.png"],
    ["GET /og/families/claude.png", "http://x/og/families/claude.png"],
  ])(
    "%s does not reuse the ?mode=sync entry for a ?mode=batch request",
    async (_label, url) => {
      await resetDb();
      await seedSmokeData({ runCount: 1 });
      // seedSmokeData inserts runs but no results, so the sync-vs-batch
      // aggregate (topAuc2 in the og payload) would be 0 either way and
      // renderOgPng's own payload-hash cache would legitimately return
      // "hit" for identical payloads — masking whether the outer cg-og key
      // is genuinely mode-scoped. Give the seeded run (run-0000, sync by
      // seedSmokeData's default) one passing result so topAuc2 differs
      // between modes: nonzero under sync, 0 under batch (no batch runs).
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('run-0000','CG-AL-E001',1,1,1.0,1)`,
      ).run();

      const syncReq = await SELF.fetch(`${url}?mode=sync`);
      expect(syncReq.status).toBe(200);
      // First-ever request for this key: must be a genuine compute, not a hit.
      expect(syncReq.headers.get("x-og-cache")).toBe("miss");
      // Drain so the inline cache.put/sharedCacheSet commit before the next
      // fetch could observe a race.
      await syncReq.arrayBuffer();

      const batchReq = await SELF.fetch(`${url}?mode=batch`);
      expect(batchReq.status).toBe(200);
      // Pre-fix: the cg-og key ignored mode entirely, so this would come
      // back "epoch" — the sync request's cached PNG, silently mislabeled as
      // a batch-mode render. Post-fix: mode is part of the key, so a
      // distinct mode is a distinct entry, and this is a genuine miss.
      //
      // (Not asserting a repeat-hit "positive control" here: the platform's
      // own URL-keyed `caches.default` would intercept an identical second
      // fetch to this exact URL and replay THIS response's headers/bytes
      // without reaching the handler at all, which would just prove
      // `caches.default` works — a fact this repo already has coverage for
      // elsewhere — not that the `cg-og` entry is genuinely mode-keyed.)
      expect(batchReq.headers.get("x-og-cache")).toBe("miss");
    },
  );
});
