import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { sha256Hex } from '../../src/lib/shared/hash';
import { canonicalJSON } from '../../src/lib/shared/canonical';
import fixture from './fixtures/run.json';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // Wipe data tables in dependency-safe order (results -> runs -> tasks -> task_sets, etc.)
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ingest_events`),
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM tasks`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM task_categories`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM machine_keys`)
  ]);

  // Seed reference data: model family + model + cost snapshot.
  // task_categories and tasks are inserted by the task-set POST below.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,cache_read_per_mtoken,cache_write_per_mtoken,effective_from)
       VALUES ('v2026-04',1,3.0,15.0,0.3,3.75,'2026-04-01T00:00:00Z')`
    )
  ]);

  // Drain the SSE broadcaster buffer between tests via the gated test-only
  // proxy. Going through SELF.fetch avoids touching env.LEADERBOARD_BROADCASTER
  // directly (the SvelteKit Cloudflare bundle doesn't re-export the DO class
  // at the top level — see runs-finalize.test.ts for the same pattern).
  const reset = await SELF.fetch('http://x/api/v1/__test__/events/reset', {
    method: 'POST',
    headers: { 'x-test-only': '1' }
  });
  await reset.arrayBuffer();
});

describe('E2E: sign -> ingest -> upload -> finalize -> read', () => {
  it('round-trips a run through every endpoint', async () => {
    // ---------- 1. Register an ingest key + admin key ----------
    const { keyId: ingestKeyId, keypair: ingestKeypair } = await registerMachineKey('rig', 'ingest');
    const { keyId: adminKeyId, keypair: adminKeypair } = await registerMachineKey('admin-machine', 'admin');

    // ---------- 2. Compute task_set hash and POST /api/v1/task-sets ----------
    const taskSetHash = await sha256Hex(canonicalJSON(fixture.task_set as unknown as Record<string, unknown>));
    const taskSetPayload = {
      hash: taskSetHash,
      created_at: fixture.task_set.created_at,
      task_count: fixture.task_set.tasks.length,
      tasks: fixture.task_set.tasks
    };
    const { signedRequest: taskSetReq } = await createSignedPayload(
      taskSetPayload as unknown as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKeypair
    );
    const tsRes = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskSetReq)
    });
    expect(tsRes.status).toBe(201);
    await tsRes.arrayBuffer();

    // ---------- 3. Promote task set to current via POST /api/v1/task-sets/:hash/current (admin) ----------
    const { signedRequest: promoteReq } = await createSignedPayload(
      {},
      adminKeyId,
      undefined,
      adminKeypair
    );
    const promoteRes = await SELF.fetch(`http://x/api/v1/task-sets/${taskSetHash}/current`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(promoteReq)
    });
    expect(promoteRes.status).toBe(200);
    const promoteBody = await promoteRes.json<{ hash: string; is_current: boolean; changed: boolean }>();
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
      model: { slug: 'sonnet-4.7', api_model_id: 'claude-sonnet-4-7', family_slug: 'claude' },
      settings: { temperature: 0, max_attempts: 2, max_tokens: 8192, prompt_version: 'v3', bc_version: 'Cronus28' },
      machine_id: fixture.run.machine_id,
      started_at: fixture.run.started_at,
      completed_at: fixture.run.completed_at,
      centralgauge_sha: 'abc1234',
      pricing_version: 'v2026-04',
      reproduction_bundle_sha256: bundleSha,
      results: [
        {
          task_id: 'easy/alpha',
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
          code_sha256: codeSha
        }
      ]
    };
    const { signedRequest: runReq } = await createSignedPayload(
      runPayload as unknown as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKeypair
    );
    runReq.run_id = 'e2e-run-1';

    const runRes = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runReq)
    });
    expect(runRes.status).toBe(202);
    const runBody = await runRes.json<{ run_id: string; missing_blobs: string[] }>();
    expect(runBody.run_id).toBe('e2e-run-1');
    expect(runBody.missing_blobs.sort()).toEqual([bundleSha, codeSha, transcriptSha].sort());

    // ---------- 6. PUT each missing blob ----------
    for (const [sha, body] of [
      [transcriptSha, transcriptBytes],
      [codeSha, codeBytes],
      [bundleSha, bundleBytes]
    ] as const) {
      const blobRes = await SELF.fetch(`http://x/api/v1/blobs/${sha}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body
      });
      expect(blobRes.status).toBe(201);
      await blobRes.arrayBuffer();
    }

    // Seed the transcript at the public transcripts/ R2 prefix as well.
    // The transcripts read endpoint serves objects from R2 key
    // `transcripts/<key>`, while the run row's transcript_r2_key points to
    // `blobs/<sha>` (the content-addressed blob). The decoupling lets the
    // operator move/rename transcripts independently of the run record.
    await env.BLOBS.put(`transcripts/${transcriptSha}.txt`, transcriptBytes);

    // ---------- 7. POST /api/v1/runs/:id/finalize ----------
    const finRes = await SELF.fetch(`http://x/api/v1/runs/${runBody.run_id}/finalize`, {
      method: 'POST'
    });
    expect(finRes.status).toBe(200);
    const finBody = await finRes.json<{ status: string }>();
    expect(finBody.status).toBe('completed');

    // ---------- 8. GET /api/v1/leaderboard ----------
    const lbRes = await SELF.fetch('http://x/api/v1/leaderboard?set=current&tier=all');
    expect(lbRes.status).toBe(200);
    const lb = await lbRes.json() as {
      data: Array<{ model: { slug: string }; run_count: number; avg_score: number; tasks_passed: number }>;
    };
    const lbEntry = lb.data.find((r) => r.model.slug === 'sonnet-4.7');
    expect(lbEntry).toBeTruthy();
    expect(lbEntry!.run_count).toBe(1);
    expect(lbEntry!.avg_score).toBe(100);
    expect(lbEntry!.tasks_passed).toBe(1);

    // ---------- 9. GET /api/v1/runs/:id ----------
    const detailRes = await SELF.fetch(`http://x/api/v1/runs/${runBody.run_id}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as {
      id: string;
      status: string;
      tier: string;
      model: { slug: string };
      results: Array<{ cost_usd: number | null; score: number; passed: boolean }>;
    };
    expect(detail.id).toBe(runBody.run_id);
    expect(detail.status).toBe('completed');
    expect(detail.tier).toBe('claimed');
    expect(detail.model.slug).toBe('sonnet-4.7');
    expect(detail.results).toHaveLength(1);
    // 1000 * 3.0 + 500 * 15.0 = 10500 / 1e6 = 0.0105
    expect(detail.results[0].cost_usd).toBeCloseTo(0.0105, 6);
    expect(detail.results[0].passed).toBe(true);

    // ---------- 10. GET /api/v1/runs/:id/signature ----------
    const sigRes = await SELF.fetch(`http://x/api/v1/runs/${runBody.run_id}/signature`);
    expect(sigRes.status).toBe(200);
    const sig = await sigRes.json() as {
      run_id: string;
      signature: { alg: string; key_id: number };
      signer: { machine_id: string; scope: string } | null;
      signed_payload_base64: string;
    };
    expect(sig.run_id).toBe(runBody.run_id);
    expect(sig.signature.alg).toBe('Ed25519');
    expect(sig.signature.key_id).toBe(ingestKeyId);
    expect(sig.signer?.machine_id).toBe('rig');
    expect(sig.signer?.scope).toBe('ingest');
    expect(sig.signed_payload_base64.length).toBeGreaterThan(0);

    // ---------- 11. GET /api/v1/tasks/easy/alpha ----------
    const taskRes = await SELF.fetch('http://x/api/v1/tasks/easy/alpha');
    expect(taskRes.status).toBe(200);
    const task = await taskRes.json() as {
      id: string;
      difficulty: string;
      task_set_hash: string;
      solved_by: Array<{ model_slug: string; runs_total: number; avg_score: number | null }>;
    };
    expect(task.id).toBe('easy/alpha');
    expect(task.difficulty).toBe('easy');
    expect(task.task_set_hash).toBe(taskSetHash);
    expect(task.solved_by).toHaveLength(1);
    expect(task.solved_by[0].model_slug).toBe('sonnet-4.7');
    expect(task.solved_by[0].runs_total).toBe(1);
    expect(task.solved_by[0].avg_score).toBeCloseTo(100, 5);

    // ---------- 12. GET /api/v1/transcripts/<sha>.txt ----------
    const trRes = await SELF.fetch(`http://x/api/v1/transcripts/${transcriptSha}.txt`);
    expect(trRes.status).toBe(200);
    expect(await trRes.text()).toBe(fixture.transcript_plain);

    // ---------- 13. GET /api/v1/sync/health ----------
    const healthRes = await SELF.fetch('http://x/api/v1/sync/health');
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json() as {
      machines: Array<{ machine_id: string; status: string; verified_24h: number }>;
      overall: { total_machines: number; healthy: number };
    };
    const rig = health.machines.find((m) => m.machine_id === 'rig');
    expect(rig).toBeTruthy();
    expect(rig!.status).toBe('healthy');
    expect(rig!.verified_24h).toBe(1);

    // ---------- 14. SSE broadcaster received a run_finalized event ----------
    const recentRes = await SELF.fetch('http://x/api/v1/__test__/events/recent?limit=20', {
      headers: { 'x-test-only': '1' }
    });
    expect(recentRes.status).toBe(200);
    const recent = await recentRes.json() as { events: Array<Record<string, unknown>> };
    const finalizedEv = recent.events.find(
      (e) => e.type === 'run_finalized' && e.run_id === runBody.run_id
    );
    expect(finalizedEv).toBeDefined();
    expect(finalizedEv!.model_slug).toBe('sonnet-4.7');
    expect(finalizedEv!.tier).toBe('claimed');
    expect(finalizedEv!.score).toBe(100);
    // Confirm the promotion event was also broadcast earlier in the flow.
    const promotedEv = recent.events.find(
      (e) => e.type === 'task_set_promoted' && e.hash === taskSetHash
    );
    expect(promotedEv).toBeDefined();
  });
});
