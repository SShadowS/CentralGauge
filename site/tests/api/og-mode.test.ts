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
