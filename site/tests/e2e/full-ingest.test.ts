import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey, signedBlobPut } from "../fixtures/ingest-helpers";
import { sha256Hex } from "../../src/lib/shared/hash";
import { canonicalJSON } from "../../src/lib/shared/canonical";
import { resetDb } from "../utils/reset-db";
import fixture from "./fixtures/run.json";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();

  // Seed reference data: model family + model + cost snapshot.
  // task_categories and tasks are inserted by the task-set POST below.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,cache_read_per_mtoken,cache_write_per_mtoken,effective_from)
       VALUES ('v2026-04',1,3.0,15.0,0.3,3.75,'2026-04-01T00:00:00Z')`,
    ),
  ]);

  // Drain the SSE broadcaster buffer between tests via the gated test-only
  // proxy. Going through SELF.fetch avoids touching env.LEADERBOARD_BROADCASTER
  // directly (the SvelteKit Cloudflare bundle doesn't re-export the DO class
  // at the top level — see runs-finalize.test.ts for the same pattern).
  const reset = await SELF.fetch("http://x/api/v1/__test__/events/reset", {
    method: "POST",
    headers: { "x-test-only": "1" },
  });
  await reset.arrayBuffer();
});

describe("E2E: sign -> ingest -> upload -> finalize -> read", () => {
  // 30 s: 14 endpoints end-to-end including 3 signed blob PUTs in a shared worker pool.
  it("round-trips a run through every endpoint", async () => {
    // ---------- 1. Register an ingest key + admin key ----------
    const { keyId: ingestKeyId, keypair: ingestKeypair } =
      await registerMachineKey("rig", "ingest");
    const { keyId: adminKeyId, keypair: adminKeypair } =
      await registerMachineKey("admin-machine", "admin");

    // ---------- 2. Compute task_set hash and POST /api/v1/task-sets ----------
    const taskSetHash = await sha256Hex(
      canonicalJSON(fixture.task_set as unknown as Record<string, unknown>),
    );
    const taskSetPayload = {
      hash: taskSetHash,
      created_at: fixture.task_set.created_at,
      task_count: fixture.task_set.tasks.length,
      tasks: fixture.task_set.tasks,
    };
    const { signedRequest: taskSetReq } = await createSignedPayload(
      taskSetPayload as unknown as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKeypair,
    );
    const tsRes = await SELF.fetch("http://x/api/v1/task-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskSetReq),
    });
    expect(tsRes.status).toBe(201);
    await tsRes.arrayBuffer();

    // ---------- 3. Promote task set to current via POST /api/v1/task-sets/:hash/current (admin) ----------
    const { signedRequest: promoteReq } = await createSignedPayload(
      {},
      adminKeyId,
      undefined,
      adminKeypair,
    );
    const promoteRes = await SELF.fetch(
      `http://x/api/v1/task-sets/${taskSetHash}/current`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promoteReq),
      },
    );
    expect(promoteRes.status).toBe(200);
    const promoteBody = await promoteRes.json<
      { hash: string; is_current: boolean; changed: boolean }
    >();
    expect(promoteBody.is_current).toBe(true);
    expect(promoteBody.changed).toBe(true);

    // ---------- 4. Compute blob hashes ----------
    const enc = new TextEncoder();
    const transcriptBytes = enc.encode(fixture.transcript_plain);
    const codeBytes = enc.encode(fixture.code_plain);
    const bundleBytes = enc.encode(fixture.bundle_plain);
    const transcriptSha = await sha256Hex(transcriptBytes);
    const codeSha = await sha256Hex(codeBytes);
    const bundleSha = await sha256Hex(bundleBytes);

    // ---------- 5. POST /api/v1/runs (signed, ingest scope) ----------
    const runPayload = {
      task_set_hash: taskSetHash,
      model: {
        slug: "sonnet-4.7",
        api_model_id: "claude-sonnet-4-7",
        family_slug: "claude",
      },
      settings: {
        temperature: 0,
        max_attempts: 2,
        max_tokens: 8192,
        prompt_version: "v3",
        bc_version: "Cronus28",
      },
      machine_id: fixture.run.machine_id,
      started_at: fixture.run.started_at,
      completed_at: fixture.run.completed_at,
      centralgauge_sha: "abc1234",
      pricing_version: "v2026-04",
      reproduction_bundle_sha256: bundleSha,
      results: [
        {
          task_id: "easy/alpha",
          attempt: 1,
          passed: true,
          score: fixture.run.score,
          compile_success: true,
          compile_errors: [],
          tests_total: 3,
          tests_passed: 3,
          tokens_in: fixture.run.tokens_in,
          tokens_out: fixture.run.tokens_out,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          durations_ms: { llm: 1500, compile: 3000, test: 2000 },
          failure_reasons: [],
          transcript_sha256: transcriptSha,
          code_sha256: codeSha,
        },
      ],
    };
    const { signedRequest: runReq } = await createSignedPayload(
      runPayload as unknown as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKeypair,
    );
    // run_id is outside the signed canonical payload, so reassignment is safe
    runReq.run_id = "e2e-run-1";

    const runRes = await SELF.fetch("http://x/api/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runReq),
    });
    expect(runRes.status).toBe(202);
    const runBody = await runRes.json<
      { run_id: string; missing_blobs: string[] }
    >();
    expect(runBody.run_id).toBe("e2e-run-1");
    expect(runBody.missing_blobs.sort()).toEqual(
      [bundleSha, codeSha, transcriptSha].sort(),
    );

    // ---------- 6. PUT each missing blob ----------
    for (
      const [sha, body] of [
        [transcriptSha, transcriptBytes],
        [codeSha, codeBytes],
        [bundleSha, bundleBytes],
      ] as const
    ) {
      const blobRes = await signedBlobPut(
        `/api/v1/blobs/${sha}`,
        body,
        ingestKeyId,
        ingestKeypair,
      );
      expect(blobRes.status).toBe(201);
      await blobRes.arrayBuffer();
    }

    // ---------- 7. POST /api/v1/runs/:id/finalize ----------
    const finRes = await SELF.fetch(
      `http://x/api/v1/runs/${runBody.run_id}/finalize`,
      {
        method: "POST",
      },
    );
    expect(finRes.status).toBe(200);
    const finBody = await finRes.json<{ status: string }>();
    expect(finBody.status).toBe("completed");

    // ---------- 8. GET /api/v1/leaderboard ----------
    const lbRes = await SELF.fetch(
      "http://x/api/v1/leaderboard?set=current&tier=all",
    );
    expect(lbRes.status).toBe(200);
    const lb = await lbRes.json() as {
      data: Array<
        {
          model: { slug: string };
          run_count: number;
          avg_score: number;
          tasks_passed: number;
        }
      >;
    };
    const lbEntry = lb.data.find((r) => r.model.slug === "sonnet-4.7");
    expect(lbEntry).toBeTruthy();
    expect(lbEntry!.run_count).toBe(1);
    expect(lbEntry!.avg_score).toBe(100);
    expect(lbEntry!.tasks_passed).toBe(1);

    // ---------- 9. GET /api/v1/runs/:id ----------
    const detailRes = await SELF.fetch(
      `http://x/api/v1/runs/${runBody.run_id}`,
    );
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as {
      id: string;
      status: string;
      tier: string;
      model: { slug: string };
      totals: { cost_usd: number; tasks_passed: number };
      results: Array<{
        task_id: string;
        attempts: Array<{ score: number; passed: boolean }>;
      }>;
    };
    expect(detail.id).toBe(runBody.run_id);
    expect(detail.status).toBe("completed");
    expect(detail.tier).toBe("claimed");
    expect(detail.model.slug).toBe("sonnet-4.7");
    expect(detail.results).toHaveLength(1);
    // Mirror the cost_snapshots row seeded above (input_per_mtoken=3.0,
    // output_per_mtoken=15.0). Cost is now in totals (sum across all attempts).
    const inputPerMtoken = 3.0;
    const outputPerMtoken = 15.0;
    const expectedCost = (fixture.run.tokens_in * inputPerMtoken +
      fixture.run.tokens_out * outputPerMtoken) / 1_000_000;
    expect(detail.totals.cost_usd).toBeCloseTo(expectedCost, 6);
    expect(detail.results[0].attempts.at(-1)!.passed).toBe(true);

    // ---------- 10. GET /api/v1/runs/:id/signature ----------
    const sigRes = await SELF.fetch(
      `http://x/api/v1/runs/${runBody.run_id}/signature`,
    );
    expect(sigRes.status).toBe(200);
    const sig = await sigRes.json() as {
      run_id: string;
      signature: { alg: string; key_id: number; value_b64: string };
      machine_id: string;
      public_key_hex: string;
      payload_b64: string;
    };
    expect(sig.run_id).toBe(runBody.run_id);
    expect(sig.signature.alg).toBe("Ed25519");
    expect(sig.signature.key_id).toBe(ingestKeyId);
    expect(sig.machine_id).toBe("rig");
    expect(sig.public_key_hex.length).toBeGreaterThan(0);
    expect(sig.payload_b64.length).toBeGreaterThan(0);

    // ---------- 11. GET /api/v1/tasks/easy/alpha ----------
    const taskRes = await SELF.fetch("http://x/api/v1/tasks/easy/alpha");
    expect(taskRes.status).toBe(200);
    const task = await taskRes.json() as {
      id: string;
      difficulty: string;
      task_set_hash: string;
      solved_by: Array<
        { model_slug: string; runs_total: number; avg_score: number | null }
      >;
    };
    expect(task.id).toBe("easy/alpha");
    expect(task.difficulty).toBe("easy");
    expect(task.task_set_hash).toBe(taskSetHash);
    expect(task.solved_by).toHaveLength(1);
    expect(task.solved_by[0].model_slug).toBe("sonnet-4.7");
    expect(task.solved_by[0].runs_total).toBe(1);
    expect(task.solved_by[0].avg_score).toBeCloseTo(100, 5);

    // ---------- 12. GET /api/v1/transcripts/<sha>.txt ----------
    // Proves the transcripts route falls through to blobs/<sha> when the
    // curated transcripts/<sha>.txt prefix is absent — i.e. the real end-to-end
    // ingest (PUT /blobs/<sha>) -> read (GET /transcripts/<sha>.txt) path.
    const trRes = await SELF.fetch(
      `http://x/api/v1/transcripts/${transcriptSha}.txt`,
    );
    expect(trRes.status).toBe(200);
    expect(await trRes.text()).toBe(fixture.transcript_plain);

    // ---------- 13. GET /api/v1/sync/health ----------
    const healthRes = await SELF.fetch("http://x/api/v1/sync/health");
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json() as {
      machines: Array<
        { machine_id: string; status: string; verified_24h: number }
      >;
      overall: { total_machines: number; healthy: number };
    };
    const rig = health.machines.find((m) => m.machine_id === "rig");
    expect(rig).toBeTruthy();
    expect(rig!.status).toBe("healthy");
    expect(rig!.verified_24h).toBe(1);

    // ---------- 14. SSE broadcaster received a run_finalized event ----------
    const recentRes = await SELF.fetch(
      "http://x/api/v1/__test__/events/recent?limit=20",
      {
        headers: { "x-test-only": "1" },
      },
    );
    expect(recentRes.status).toBe(200);
    const recent = await recentRes.json() as {
      events: Array<Record<string, unknown>>;
    };
    const finalizedEv = recent.events.find(
      (e) => e.type === "run_finalized" && e.run_id === runBody.run_id,
    );
    expect(finalizedEv).toBeDefined();
    expect(finalizedEv!.model_slug).toBe("sonnet-4.7");
    expect(finalizedEv!.tier).toBe("claimed");
    expect(finalizedEv!.score).toBe(100);
    // Confirm the promotion event was also broadcast earlier in the flow.
    const promotedEv = recent.events.find(
      (e) => e.type === "task_set_promoted" && e.hash === taskSetHash,
    );
    expect(promotedEv).toBeDefined();
  }, 30_000);
});
