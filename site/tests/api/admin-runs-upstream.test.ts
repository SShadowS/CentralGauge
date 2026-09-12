import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { _computeBackfillOutcome } from "../../src/routes/api/v1/admin/runs/upstream/+server";

/**
 * POST /api/v1/admin/runs/upstream: per-(task, attempt) backfill of
 * `served_upstream` for a run ingested before capture existed (Task 13).
 */

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const URL = "https://x/api/v1/admin/runs/upstream";

describe("admin runs upstream backfill endpoint", () => {
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
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,served_upstream)
         VALUES ('r1','t1',1,1,1.0,1,1,1,NULL)`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,served_upstream)
         VALUES ('r1','t1',2,1,1.0,1,1,1,NULL)`,
      ),
    ]);
  });

  it("sets served_upstream per attempt, marks rows unpinned from the provider field, audits and bumps", async () => {
    const res = await post({
      run_id: "r1",
      results: [
        { task_id: "t1", attempt: 1, served_upstream: "Google" },
        { task_id: "t1", attempt: 2, served_upstream: "Google" },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      run_id: "r1",
      updated: 2,
    });
    const rows = (await env.DB.prepare(
      `SELECT attempt, served_upstream, upstream_identity_source, upstream_verification, requested_upstream FROM results WHERE run_id='r1' ORDER BY attempt`,
    ).all()).results;
    expect(rows).toEqual([
      {
        attempt: 1,
        served_upstream: "Google",
        upstream_identity_source: "provider_field",
        upstream_verification: "unpinned",
        requested_upstream: null,
      },
      {
        attempt: 2,
        served_upstream: "Google",
        upstream_identity_source: "provider_field",
        upstream_verification: "unpinned",
        requested_upstream: null,
      },
    ]);
    const audit = await env.DB.prepare(
      `SELECT event FROM admin_audit ORDER BY id DESC LIMIT 1`,
    ).first<{ event: string }>();
    expect(audit?.event).toBe("run.upstream_backfilled");
  });

  it("refuses duplicates in one request and a row that already holds a different value", async () => {
    const dup = await post({
      run_id: "r1",
      results: [
        { task_id: "t1", attempt: 1, served_upstream: "Google" },
        { task_id: "t1", attempt: 1, served_upstream: "Google" },
      ],
    });
    expect(dup.status).toBe(400);
    expect((await dup.json<{ code: string }>()).code).toBe(
      "duplicate_attempt",
    );
    await env.DB.prepare(
      `UPDATE results SET served_upstream='Fireworks' WHERE run_id='r1' AND attempt=1`,
    ).run();
    const conflict = await post({
      run_id: "r1",
      results: [{ task_id: "t1", attempt: 1, served_upstream: "Google" }],
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json<{ code: string; error: string }>()).error)
      .toContain("Fireworks");
    // Zero changes: the conflicting request must not have touched the row.
    const row = await env.DB.prepare(
      `SELECT served_upstream FROM results WHERE run_id='r1' AND task_id='t1' AND attempt=1`,
    ).first<{ served_upstream: string }>();
    expect(row?.served_upstream).toBe("Fireworks");
  });

  it("refuses a pinned run with 409 pinned_run and changes nothing", async () => {
    await env.DB.prepare(
      `UPDATE runs SET invocation_json = ? WHERE id = 'r1'`,
    ).bind(JSON.stringify({ upstream_pin: "novita/fp8" })).run();
    const res = await post({
      run_id: "r1",
      results: [{ task_id: "t1", attempt: 1, served_upstream: "Google" }],
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe("pinned_run");
    expect(body.error).toContain("novita/fp8");
    const rows = (await env.DB.prepare(
      `SELECT served_upstream FROM results WHERE run_id='r1' ORDER BY attempt`,
    ).all()).results;
    expect(rows).toEqual([
      { served_upstream: null },
      { served_upstream: null },
    ]);
  });

  it("refuses a row that already holds a real verdict with 409 already_set", async () => {
    await env.DB.prepare(
      `UPDATE results SET upstream_verification='verified' WHERE run_id='r1' AND task_id='t1' AND attempt=1`,
    ).run();
    const res = await post({
      run_id: "r1",
      results: [{ task_id: "t1", attempt: 1, served_upstream: "Google" }],
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe("already_set");
    expect(body.error).toContain("verified");
    const row = await env.DB.prepare(
      `SELECT served_upstream, upstream_verification FROM results WHERE run_id='r1' AND task_id='t1' AND attempt=1`,
    ).first<{ served_upstream: string | null; upstream_verification: string }>();
    expect(row?.served_upstream).toBeNull();
    expect(row?.upstream_verification).toBe("verified");
  });

  it("404s an unknown run", async () => {
    expect((await post({ run_id: "nope", results: [] })).status).toBe(404);
  });

  it("400s an entry naming a (task, attempt) with no result row, and touches nothing", async () => {
    const res = await post({
      run_id: "r1",
      results: [{ task_id: "no-such-task", attempt: 1, served_upstream: "Google" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ code: string }>()).code).toBe("unknown_attempt");
    const rows = (await env.DB.prepare(
      `SELECT served_upstream FROM results WHERE run_id='r1' ORDER BY attempt`,
    ).all()).results;
    expect(rows).toEqual([
      { served_upstream: null },
      { served_upstream: null },
    ]);
  });

  it("a multi-entry request refuses at the pre-check when one entry already conflicts, writing nothing", async () => {
    // Seed attempt 2's conflicting value BEFORE the call. True interleaving
    // (a concurrent write landing strictly between this endpoint's own
    // pre-check and its guarded UPDATE batch) cannot be triggered from
    // outside a synchronous test - this exercises the pre-check's own
    // all-or-nothing refusal instead: it validates every entry before
    // writing any of them, so one conflicting entry blocks the whole
    // request, including the otherwise-valid first entry.
    await env.DB.prepare(
      `UPDATE results SET served_upstream='Fireworks' WHERE run_id='r1' AND task_id='t1' AND attempt=2`,
    ).run();
    const res = await post({
      run_id: "r1",
      results: [
        { task_id: "t1", attempt: 1, served_upstream: "Google" },
        { task_id: "t1", attempt: 2, served_upstream: "Google" },
      ],
    });
    expect(res.status).toBe(409);
    expect((await res.json<{ code: string }>()).code).toBe("already_set");
    const rows = (await env.DB.prepare(
      `SELECT attempt, served_upstream FROM results WHERE run_id='r1' ORDER BY attempt`,
    ).all()).results;
    expect(rows).toEqual([
      { attempt: 1, served_upstream: null },
      { attempt: 2, served_upstream: "Fireworks" },
    ]);
    const audit = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM admin_audit WHERE event='run.upstream_backfilled'`,
    ).first<{ n: number }>();
    expect(Number(audit?.n)).toBe(0);
  });
});

describe("_computeBackfillOutcome (unit)", () => {
  it("reports a mix of updated and unchanged entries from a fake batch result", () => {
    const entries = [
      { task_id: "t1", attempt: 1 as const, served_upstream: "Google" },
      { task_id: "t1", attempt: 2 as const, served_upstream: "Google" },
    ];
    // Statement 0 matched a row (RETURNING returned one row); statement 1
    // lost the race and RETURNING returned none - exactly the shape a real
    // batch takes when a concurrent request set attempt 2 to a different
    // value between this endpoint's own pre-check and its guarded UPDATE
    // batch, an interleaving that cannot be triggered synchronously from
    // outside the endpoint.
    const fakeBatchResults = [
      { results: [{ task_id: "t1", attempt: 1 }] },
      { results: [] },
    ];
    expect(_computeBackfillOutcome(entries, fakeBatchResults)).toEqual({
      updated: 1,
      unchanged: [{ task_id: "t1", attempt: 2 }],
    });
  });

  it("reports zero unchanged when every statement's RETURNING matched", () => {
    const entries = [
      { task_id: "t1", attempt: 1 as const, served_upstream: "Google" },
    ];
    const fakeBatchResults = [{ results: [{ task_id: "t1", attempt: 1 }] }];
    expect(_computeBackfillOutcome(entries, fakeBatchResults)).toEqual({
      updated: 1,
      unchanged: [],
    });
  });
});
