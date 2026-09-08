import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";

/**
 * POST /api/v1/admin/runs/exclude, the signed operator endpoint behind
 * `centralgauge runs exclude` / `runs include` (migration 0022).
 */

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const URL = "https://x/api/v1/admin/runs/exclude";
const REASON = "host OOM during evaluation";

async function readEpoch(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT epoch, pending_since FROM cache_epoch WHERE id = 1`,
  ).first<{ epoch: number; pending_since: number }>();
  // The bump is debounced: it sets `pending_since` rather than incrementing
  // `epoch` directly (see data-epoch.ts), so a caller checking "was the epoch
  // retired" has to look at both.
  return Number(row?.epoch ?? 0) + Number(row?.pending_since ?? 0);
}

async function runRow(id: string) {
  return await env.DB.prepare(
    `SELECT excluded_at, excluded_reason FROM runs WHERE id = ?`,
  )
    .bind(id)
    .first<{ excluded_at: string | null; excluded_reason: string | null }>();
}

describe("admin run exclude endpoint", () => {
  let keyId: number;
  let keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];

  const signAsAdmin = (p: object) =>
    createSignedPayload(
      p as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );

  const post = async (p: object) => {
    const { signedRequest } = await signAsAdmin(p);
    return await SELF.fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
  };

  beforeEach(async () => {
    await resetDb();
    ({ keyId, keypair } = await registerMachineKey("admin-test", "admin"));
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'fam','V','Fam')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'m','api-m','M')`,
      ),
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`,
      ),
      env.DB.prepare(`INSERT INTO settings_profiles(hash) VALUES ('s')`),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,
                          ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('r1','ts',1,'s','rig','2026-01-01T00:00:00Z','completed','claimed','v1','sig','2026-01-01T00:00:00Z',?,'{}')`,
      ).bind(keyId),
    ]);
  });

  it("excludes a run, writes an audit row and retires cached rankings", async () => {
    const before = await readEpoch();
    const res = await post({ run_id: "r1", reason: REASON, exclude: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      excluded: boolean;
      changed: boolean;
      excluded_reason?: string;
    };
    expect(body).toMatchObject({ ok: true, excluded: true, changed: true });
    expect(body.excluded_reason).toBe(REASON);

    const row = await runRow("r1");
    expect(row?.excluded_at).toBeTruthy();
    expect(row?.excluded_reason).toBe(REASON);

    const audit = await env.DB.prepare(
      `SELECT event, actor_key_id, details_json FROM admin_audit ORDER BY id DESC LIMIT 1`,
    ).first<{
      event: string;
      actor_key_id: number;
      details_json: string;
    }>();
    expect(audit?.event).toBe("run.excluded");
    expect(audit?.actor_key_id).toBe(keyId);
    expect(JSON.parse(audit!.details_json)).toMatchObject({
      run_id: "r1",
      reason: REASON,
    });

    expect(await readEpoch()).toBeGreaterThan(before);
  });

  it("re-includes a run, clearing both columns", async () => {
    await post({ run_id: "r1", reason: REASON, exclude: true });
    const res = await post({ run_id: "r1", reason: "", exclude: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ excluded: false, changed: true });

    const row = await runRow("r1");
    expect(row?.excluded_at).toBe(null);
    expect(row?.excluded_reason).toBe(null);

    const audit = await env.DB.prepare(
      `SELECT event FROM admin_audit ORDER BY id DESC LIMIT 1`,
    ).first<{ event: string }>();
    expect(audit?.event).toBe("run.included");
  });

  it("is idempotent: re-excluding updates the reason, re-including is a no-op", async () => {
    await post({ run_id: "r1", reason: REASON, exclude: true });
    const first = await runRow("r1");

    const again = await post({
      run_id: "r1",
      reason: "corrected reason",
      exclude: true,
    });
    expect(again.status).toBe(200);
    // Still excluded, so no state TRANSITION, but the reason is updated,
    // which is how an operator corrects a wrong one.
    expect(await again.json()).toMatchObject({
      excluded: true,
      changed: false,
    });
    const second = await runRow("r1");
    expect(second?.excluded_reason).toBe("corrected reason");
    expect(second?.excluded_at).toBeTruthy();
    expect(first?.excluded_at).toBeTruthy();

    await post({ run_id: "r1", reason: "", exclude: false });
    const noop = await post({ run_id: "r1", reason: "", exclude: false });
    expect(noop.status).toBe(200);
    expect(await noop.json()).toMatchObject({
      excluded: false,
      changed: false,
    });
    expect((await runRow("r1"))?.excluded_at).toBe(null);
  });

  it("404s on an unknown run id without touching anything", async () => {
    const res = await post({ run_id: "nope", reason: REASON, exclude: true });
    expect(res.status).toBe(404);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "run_not_found",
    });
  });

  it("400s when excluding with an empty or whitespace-only reason", async () => {
    for (const reason of ["", "   "]) {
      const res = await post({ run_id: "r1", reason, exclude: true });
      expect(res.status).toBe(400);
      expect((await res.json()) as { code: string }).toMatchObject({
        code: "reason_required",
      });
    }
    expect((await runRow("r1"))?.excluded_at).toBe(null);
  });

  it("400s on a missing run_id or a non-boolean exclude", async () => {
    const noId = await post({ reason: REASON, exclude: true });
    expect(noId.status).toBe(400);
    expect((await noId.json()) as { code: string }).toMatchObject({
      code: "missing_field",
    });
    const badFlag = await post({ run_id: "r1", reason: REASON });
    expect(badFlag.status).toBe(400);
    expect((await badFlag.json()) as { code: string }).toMatchObject({
      code: "missing_field",
    });
  });

  it("rejects an unsigned request and one signed by a non-admin key", async () => {
    const unsigned = await SELF.fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        payload: { run_id: "r1", reason: REASON, exclude: true },
      }),
    });
    expect(unsigned.status).toBeGreaterThanOrEqual(400);
    expect((await runRow("r1"))?.excluded_at).toBe(null);

    const ingest = await registerMachineKey("ingest-only", "ingest");
    const { signedRequest } = await createSignedPayload(
      { run_id: "r1", reason: REASON, exclude: true },
      ingest.keyId,
      undefined,
      ingest.keypair,
    );
    const wrongScope = await SELF.fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(wrongScope.status).toBe(403);
    expect((await wrongScope.json()) as { code: string }).toMatchObject({
      code: "insufficient_scope",
    });
    expect((await runRow("r1"))?.excluded_at).toBe(null);
  });

  it("rejects an envelope version other than 1", async () => {
    const { signedRequest } = await signAsAdmin({
      run_id: "r1",
      reason: REASON,
      exclude: true,
    });
    const res = await SELF.fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...signedRequest, version: 2 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "bad_version",
    });
  });
});
