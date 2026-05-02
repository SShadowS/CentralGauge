import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  // Run r1 — has reproduction bundle, started earlier (r2 should be first in DESC order)
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,reproduction_bundle_r2_key,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "r1",
      "ts",
      1,
      "s",
      "rig",
      "2026-04-01T00:00:00Z",
      "2026-04-01T01:00:00Z",
      "completed",
      "claimed",
      "v1",
      "reproductions/r1.tar.zst",
      "sig-value",
      "2026-04-01T00:00:00Z",
      1,
      new Uint8Array([0x7b, 0x7d]),
    )
    .run();

  // Run r2 — no reproduction bundle, started later (should be first in DESC order)
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,reproduction_bundle_r2_key,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "r2",
      "ts",
      1,
      "s",
      "rig",
      "2026-04-02T00:00:00Z",
      "2026-04-02T01:00:00Z",
      "completed",
      "claimed",
      "v1",
      null,
      "sig2",
      "2026-04-02T00:00:00Z",
      1,
      new Uint8Array([0x7b, 0x7d]),
    )
    .run();

  // Seed a tasks row so the run-detail JOIN to `tasks` resolves difficulty.
  await env.DB.prepare(
    `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts','easy/a','ch','easy','{}')`,
  ).run();

  // Insert a result for r1 (1000 tokens_in, 500 tokens_out → cost = (1000*3 + 500*15)/1e6)
  // Seed transcript_r2_key + durations to exercise the per-attempt mapping.
  await env.DB.prepare(
    `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tokens_in,tokens_out,
                         llm_duration_ms,compile_duration_ms,test_duration_ms,transcript_r2_key)
     VALUES ('r1','easy/a',1,1,1.0,1,1000,500,100,200,300,'blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`,
  ).run();

  // Seed R2 blob for reproduction download test
  await env.BLOBS.put("reproductions/r1.tar.zst", new Uint8Array([1, 2, 3, 4]));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs — list
// ──────────────────────────────────────────────────────────

describe("GET /api/v1/runs", () => {
  it("returns paginated list of runs with nested model object + aggregates + generated_at", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      next_cursor: string | null;
      generated_at: string;
    };
    expect(body.data).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
    // generated_at is an ISO-8601 timestamp
    expect(typeof body.generated_at).toBe("string");
    expect(Number.isNaN(Date.parse(body.generated_at))).toBe(false);
    // DESC order — r2 started later, so it comes first
    expect(body.data[0].id).toBe("r2");
    // model must be a nested object with family_slug
    const model = body.data[0].model as Record<string, unknown>;
    expect(model.slug).toBe("sonnet-4.7");
    expect(model.display_name).toBe("Sonnet 4.7");
    expect(model.family_slug).toBe("claude");
    // no top-level model_slug
    expect(body.data[0].model_slug).toBeUndefined();
    // aggregates are present (numbers, never undefined)
    // r2 has no results → all zeros; r1 has 1 result so check it instead
    const r1 = body.data.find((r) => r.id === "r1") as Record<string, unknown>;
    expect(r1.tasks_attempted).toBe(1);
    expect(r1.tasks_passed).toBe(1);
    expect(r1.avg_score).toBeCloseTo(1.0, 6);
    // cost = (1000*3 + 500*15)/1e6
    expect(r1.cost_usd as number).toBeCloseTo((1000 * 3 + 500 * 15) / 1e6, 6);
    // duration sum = 100 + 200 + 300
    expect(r1.duration_ms).toBe(600);
    // r2 (no results) → zeros
    const r2 = body.data.find((r) => r.id === "r2") as Record<string, unknown>;
    expect(r2.tasks_attempted).toBe(0);
    expect(r2.tasks_passed).toBe(0);
    expect(r2.avg_score).toBe(0);
    expect(r2.cost_usd).toBe(0);
    expect(r2.duration_ms).toBe(0);
  });

  it("filters by model slug", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?model=sonnet-4.7");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
  });

  it("filters by tier — verified returns 0 (seeded tier is claimed)", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?tier=verified");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(0);
  });

  it("filters by task_set", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?task_set=ts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);

    const miss = await SELF.fetch("https://x/api/v1/runs?task_set=nonexistent");
    const missBody = (await miss.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(missBody.data).toHaveLength(0);
  });

  it("filters by since (ISO-8601) — returns only runs at or after the cutoff", async () => {
    // r1=2026-04-01, r2=2026-04-02 — cutoff 2026-04-02 should include only r2
    const res = await SELF.fetch(
      "https://x/api/v1/runs?since=2026-04-02T00:00:00Z",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("r2");
  });

  for (const bad of ["lol", "", "not-a-date", "   "]) {
    it(`returns 400 for since=${JSON.stringify(bad)}`, async () => {
      const res = await SELF.fetch(
        `https://x/api/v1/runs?since=${encodeURIComponent(bad)}`,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("invalid_since");
    });
  }

  it("paginates with limit", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?limit=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.next_cursor).not.toBeNull();
  });

  it("returns 400 for limit=0", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?limit=0");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_limit");
  });

  it("returns 400 for limit=101", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?limit=101");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_limit");
  });

  it("returns 400 for limit=-1", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?limit=-1");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_limit");
  });

  it("returns 400 for limit=abc", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?limit=abc");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_limit");
  });
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs/:id — detail
// ──────────────────────────────────────────────────────────

describe("GET /api/v1/runs/:id", () => {
  it("returns run detail with nested model.family_slug, totals, settings, grouped results", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      tier: string;
      machine_id: string;
      task_set_hash: string;
      pricing_version: string;
      model: {
        slug: string;
        display_name: string;
        api_model_id: string;
        family_slug: string;
      };
      settings: {
        temperature: number;
        max_attempts: number;
        max_tokens: number;
        prompt_version: string;
        bc_version: string;
      };
      totals: {
        avg_score: number;
        cost_usd: number;
        duration_ms: number;
        tasks_attempted: number;
        tasks_passed: number;
      };
      results: Array<{
        task_id: string;
        difficulty: string;
        attempts: Array<{
          attempt: number;
          passed: boolean;
          score: number;
          compile_success: boolean;
          compile_errors: Array<unknown>;
          tests_total: number;
          tests_passed: number;
          duration_ms: number;
          transcript_key: string;
          code_key?: string;
          failure_reasons: string[];
        }>;
      }>;
      reproduction_bundle?: { sha256: string; size_bytes: number };
      // legacy fields (must be undefined on the new shape)
      family_slug?: unknown;
      reproduction_bundle_r2_key?: unknown;
      source?: unknown;
      ingest_public_key_id?: unknown;
    };
    expect(body.id).toBe("r1");
    expect(body.status).toBe("completed");
    expect(body.machine_id).toBe("rig");
    expect(body.task_set_hash).toBe("ts");
    expect(body.pricing_version).toBe("v1");
    // model now contains family_slug; legacy top-level family_slug is gone.
    expect(body.model.slug).toBe("sonnet-4.7");
    expect(body.model.display_name).toBe("Sonnet 4.7");
    expect(body.model.api_model_id).toBe("claude-sonnet-4-7");
    expect(body.model.family_slug).toBe("claude");
    expect(body.family_slug).toBeUndefined();
    expect(body.reproduction_bundle_r2_key).toBeUndefined();
    expect(body.source).toBeUndefined();
    expect(body.ingest_public_key_id).toBeUndefined();
    // settings come from settings_profiles JOIN
    expect(body.settings.temperature).toBe(0.0);
    expect(body.settings.max_attempts).toBe(2);
    expect(body.settings.max_tokens).toBe(8192);
    expect(body.settings.prompt_version).toBe("v1");
    expect(body.settings.bc_version).toBe("Cronus28");
    // totals
    expect(body.totals.tasks_attempted).toBe(1);
    expect(body.totals.tasks_passed).toBe(1);
    expect(body.totals.avg_score).toBeCloseTo(1.0, 6);
    expect(body.totals.cost_usd).toBeCloseTo((1000 * 3 + 500 * 15) / 1e6, 6);
    // duration sum = 100 + 200 + 300
    expect(body.totals.duration_ms).toBe(600);
    // results grouped by task with attempts[]
    expect(body.results).toHaveLength(1);
    const t = body.results[0];
    expect(t.task_id).toBe("easy/a");
    expect(t.difficulty).toBe("easy");
    expect(t.attempts).toHaveLength(1);
    const a = t.attempts[0];
    expect(a.attempt).toBe(1);
    expect(a.passed).toBe(true);
    expect(a.score).toBeCloseTo(1.0, 6);
    expect(a.compile_success).toBe(true);
    expect(Array.isArray(a.compile_errors)).toBe(true);
    expect(a.duration_ms).toBe(600);
    // transcript_key passes through; we seeded blobs/<64 hex chars>
    expect(a.transcript_key).toBe(
      "blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(a.failure_reasons).toEqual([]);
    // reproduction_bundle is derived from R2 head() — seeded blob has 4 bytes,
    // key is 'reproductions/r1.tar.zst' (no sha prefix) so sha = 'r1' (path stem).
    expect(body.reproduction_bundle).toBeDefined();
    expect(body.reproduction_bundle!.size_bytes).toBe(4);
    expect(body.reproduction_bundle!.sha256).toBe("r1");
  });

  it("returns 404 for unknown run", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("emits completed_at as null (not empty string) for incomplete runs", async () => {
    // P6 C1: null preservation across the wire. Set the completed_at column
    // to NULL to simulate a still-running ingest (rare path).
    await env.DB.prepare(
      `UPDATE runs SET completed_at = NULL, status = 'running' WHERE id = 'r1'`,
    ).run();
    const res = await SELF.fetch("https://x/api/v1/runs/r1", {
      headers: { "cache-control": "no-cache" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      completed_at: string | null;
      status: string;
    };
    expect(body.completed_at).toBeNull();
    expect(body.status).toBe("running");
  });

  it("returns 500 result_corrupt when failure_reasons_json is malformed", async () => {
    await env.DB.prepare(
      `UPDATE results SET failure_reasons_json = '{bad json' WHERE run_id = 'r1'`,
    ).run();
    // `runs/[id]` is `public, s-maxage=30` and the adapter-cloudflare wrapper
    // caches in `caches.default` keyed by URL only. A prior `it` block has
    // populated that cache with a valid 200 response, so we bypass the edge
    // cache to exercise the corrupt-DB path.
    const res = await SELF.fetch("https://x/api/v1/runs/r1", {
      headers: { "cache-control": "no-cache" },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("result_corrupt");
  });
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs/:id/signature
// ──────────────────────────────────────────────────────────

describe("GET /api/v1/runs/:id/signature", () => {
  it("returns RunSignature shape with payload_b64, value_b64, public_key_hex, top-level machine_id", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r1/signature");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run_id: string;
      payload_b64: string;
      signature: {
        alg: string;
        key_id: number;
        signed_at: string;
        value_b64: string;
      };
      public_key_hex: string;
      machine_id: string;
      // legacy fields (must be undefined on new shape)
      signed_payload_base64?: unknown;
      signer?: unknown;
    };
    expect(body.run_id).toBe("r1");
    expect(body.signature.alg).toBe("Ed25519");
    expect(body.signature.key_id).toBe(1);
    expect(body.signature.value_b64).toBe("sig-value");
    expect(body.signature.signed_at).toBe("2026-04-01T00:00:00Z");
    // top-level machine_id (was nested under `signer` in the old shape)
    expect(body.machine_id).toBe("rig");
    // seeded public_key is new Uint8Array([0]) → '00' lowercase hex
    expect(body.public_key_hex).toBe("00");
    // {} in base64 is 'e30='
    expect(body.payload_b64).toBe("e30=");
    expect(body.payload_b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    // Legacy fields are gone.
    expect(body.signed_payload_base64).toBeUndefined();
    expect(body.signer).toBeUndefined();
  });

  it("returns 404 for unknown run", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/nope/signature");
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs/:id/reproduce.tar.gz
// ──────────────────────────────────────────────────────────

describe("GET /api/v1/runs/:id/reproduce.tar.gz", () => {
  it("streams R2 bytes with correct content-type and immutable cache headers", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r1/reproduce.tar.gz");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-tar");
    expect(res.headers.get("cache-control")?.includes("immutable")).toBe(true);
    const buf = await res.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns 404 when run has no reproduction bundle", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r2/reproduce.tar.gz");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown run", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/nope/reproduce.tar.gz");
    expect(res.status).toBe(404);
  });
});
