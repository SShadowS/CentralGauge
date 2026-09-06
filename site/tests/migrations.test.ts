import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function tableNames(): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  ).all();
  return (res.results as { name: string }[]).map((r) => r.name);
}

describe("migration 0001 core schema", () => {
  it("creates all core tables", async () => {
    const names = await tableNames();
    for (const required of [
      "model_families",
      "models",
      "task_sets",
      "task_categories",
      "tasks",
      "settings_profiles",
      "cost_snapshots",
      "runs",
      "results",
      "run_verifications",
      "shortcomings",
      "shortcoming_occurrences",
      "machine_keys",
      "ingest_events",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("enforces exactly-one-current task_set", async () => {
    await env.DB.prepare(
      `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
    )
      .bind("hash-a", "2026-01-01T00:00:00Z", 5)
      .run();
    await expect(
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
      )
        .bind("hash-b", "2026-01-02T00:00:00Z", 5)
        .run(),
    ).rejects.toThrow();
  });
});

describe("migration 0007 family_diffs", () => {
  it("creates family_diffs with NULLABLE from_gen_event_id (no UNIQUE)", async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(family_diffs)`).all<{
      name: string;
      type: string;
      notnull: number;
    }>();
    const colNames = cols.results.map((c) => c.name);
    for (const required of [
      "id",
      "family_slug",
      "task_set_hash",
      "from_gen_event_id",
      "to_gen_event_id",
      "from_model_slug",
      "to_model_slug",
      "status",
      "analyzer_model_a",
      "analyzer_model_b",
      "payload_json",
      "computed_at",
    ]) {
      expect(colNames).toContain(required);
    }
    // from_gen_event_id is NULLABLE
    const fromCol = cols.results.find((c) => c.name === "from_gen_event_id");
    expect(fromCol?.notnull).toBe(0);
    // from_model_slug is NULLABLE (paired with from_gen_event_id)
    const fromSlugCol = cols.results.find((c) => c.name === "from_model_slug");
    expect(fromSlugCol?.notnull).toBe(0);
    // analyzer_model_a is NULLABLE (omitted on baseline_missing)
    const analyzerACol = cols.results.find(
      (c) => c.name === "analyzer_model_a",
    );
    expect(analyzerACol?.notnull).toBe(0);
    // status is NOT NULL
    const statusCol = cols.results.find((c) => c.name === "status");
    expect(statusCol?.notnull).toBe(1);

    // Seed a real lifecycle_events row to satisfy the to_gen_event_id FK.
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, payload_json, actor)
       VALUES (?, 'a/x', 'h', 'analysis.completed', '{"analyzer_model":"a/o"}', 'operator')`,
    )
      .bind(Date.now())
      .run();
    const ev = await env.DB.prepare(
      `SELECT id FROM lifecycle_events ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number }>();

    // baseline_missing row inserts with NULL from_gen_event_id + NULL from_model_slug
    await env.DB.prepare(
      `INSERT INTO family_diffs(family_slug, task_set_hash, from_gen_event_id,
         to_gen_event_id, from_model_slug, to_model_slug, status,
         analyzer_model_a, analyzer_model_b, payload_json, computed_at)
       VALUES ('a/x','h', NULL, ?, NULL, 'a/x-4-7', 'baseline_missing',
               NULL, 'a/o', '{}', ?)`,
    )
      .bind(ev!.id, Date.now())
      .run();

    // SECOND baseline_missing for the SAME (family, ts, to) tuple inserts at the
    // SQL level (no UNIQUE) — app-level dedup is responsible for keeping it unique.
    // This proves the absence of a UNIQUE constraint, which is intentional per
    // the cross-plan rationale: D1 UNIQUE treats NULL as distinct, and a
    // table-level UNIQUE here would falsely permit duplicate baseline_missing
    // rows anyway.
    await env.DB.prepare(
      `INSERT INTO family_diffs(family_slug, task_set_hash, from_gen_event_id,
         to_gen_event_id, from_model_slug, to_model_slug, status,
         analyzer_model_a, analyzer_model_b, payload_json, computed_at)
       VALUES ('a/x','h', NULL, ?, NULL, 'a/x-4-7', 'baseline_missing',
               NULL, 'a/o', '{}', ?)`,
    )
      .bind(ev!.id, Date.now())
      .run();
    const dup = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM family_diffs WHERE family_slug = 'a/x' AND status = 'baseline_missing'`,
    ).first<{ n: number }>();
    expect(dup!.n).toBe(2);

    // status CHECK constraint enforced
    await expect(
      env.DB.prepare(
        `INSERT INTO family_diffs(family_slug, task_set_hash, from_gen_event_id,
         to_gen_event_id, from_model_slug, to_model_slug, status,
         analyzer_model_a, analyzer_model_b, payload_json, computed_at)
         VALUES ('x','y', NULL, ?, NULL,'b','bogus', NULL, NULL, '{}',0)`,
      )
        .bind(ev!.id)
        .run(),
    ).rejects.toThrow();
  });

  it("to_gen_event_id FK rejects bogus event ids (no -1 sentinel)", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO family_diffs(family_slug, task_set_hash, from_gen_event_id,
         to_gen_event_id, from_model_slug, to_model_slug, status,
         analyzer_model_a, analyzer_model_b, payload_json, computed_at)
         VALUES ('x','y', NULL, -1, NULL, 'b', 'baseline_missing', NULL, 'a/o', '{}', 0)`,
      ).run(),
    ).rejects.toThrow();
  });
});

describe("migration 0010 task_tags", () => {
  it("adds tags + task_tags tables and task_categories.description", async () => {
    const tbls = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tags','task_tags') ORDER BY name",
    ).all();
    expect((tbls.results as any[]).map((r) => r.name)).toEqual([
      "tags",
      "task_tags",
    ]);
    const cols = await env.DB.prepare(
      "PRAGMA table_info(task_categories)",
    ).all();
    expect((cols.results as any[]).some((c) => c.name === "description")).toBe(
      true,
    );
  });
});

describe("0018_taxonomy_v2", () => {
  it("creates the revision, policy, release and capture schema", async () => {
    const names = (
      await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type='table'`,
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    for (const t of [
      "taxonomy_revisions",
      "taxonomy_active",
      "taxonomy_groups",
      "taxonomy_families",
      "taxonomy_tags",
      "taxonomy_revision_tasks",
      "taxonomy_task_tags",
      "taxonomy_task_donors",
      "taxonomy_v1_snapshots",
      "scoring_policies",
      "benchmark_releases",
      "release_tasks",
      "admin_audit",
    ]) {
      expect(names, t).toContain(t);
    }
    const runCols = (
      await env.DB.prepare(`PRAGMA table_info(runs)`).all<{ name: string }>()
    ).results.map((r) => r.name);
    for (const c of [
      "harness_fingerprint",
      "retry_path_version",
      "environment_digest",
      "test_runner",
      "invocation_json",
    ])
      expect(runCols).toContain(c);
    const resCols = (
      await env.DB.prepare(`PRAGMA table_info(results)`).all<{
        name: string;
      }>()
    ).results.map((r) => r.name);
    for (const c of [
      "test_vector_json",
      "termination_kind",
      "cap_reached",
      "prompt_digest",
      "failure_class",
    ])
      expect(resCols).toContain(c);
    const tsCols = (
      await env.DB.prepare(`PRAGMA table_info(task_sets)`).all<{
        name: string;
      }>()
    ).results.map((r) => r.name);
    expect(tsCols).toContain("scoring_policy_id");
  });
});

describe("migration 0019 batch mode", () => {
  it("adds runs.invocation_mode defaulting to sync and four batch rate columns", async () => {
    const runCols = (await env.DB.prepare(`PRAGMA table_info(runs)`).all())
      .results as {
      name: string;
      dflt_value: string | null;
      notnull: number;
    }[];
    const mode = runCols.find((c) => c.name === "invocation_mode");
    expect(mode?.notnull).toBe(1);
    expect(mode?.dflt_value).toBe("'sync'");
    const csCols = (
      (await env.DB.prepare(`PRAGMA table_info(cost_snapshots)`).all())
        .results as { name: string }[]
    ).map((c) => c.name);
    for (const c of [
      "batch_input_per_mtoken",
      "batch_output_per_mtoken",
      "batch_cache_read_per_mtoken",
      "batch_cache_write_per_mtoken",
    ]) {
      expect(csCols).toContain(c);
    }
  });

  it("v_results_with_cost prices batch runs from batch columns and NULL without them", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (901,'f901','v','F')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (901,901,'m901','m901','M')`,
      ),
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts901','2026-01-01T00:00:00Z',1,0)`,
      ),
      env.DB.prepare(`INSERT INTO settings_profiles(hash) VALUES ('s901')`),
      env.DB.prepare(
        `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (901,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
      ).bind(new Uint8Array([0])),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from,batch_input_per_mtoken,batch_output_per_mtoken) VALUES ('pv-b',901,10,20,'2026-01-01',5,10)`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('pv-n',901,10,20,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES ('r-sync','ts901',901,'s901','rig','2026-01-01T00:00:00Z','completed','claimed','pv-b','sig','2026-01-01T00:00:00Z',901,'{}','sync')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES ('r-batch','ts901',901,'s901','rig','2026-01-01T00:00:00Z','completed','claimed','pv-b','sig','2026-01-01T00:00:00Z',901,'{}','batch')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES ('r-batch-nocols','ts901',901,'s901','rig','2026-01-01T00:00:00Z','completed','claimed','pv-n','sig','2026-01-01T00:00:00Z',901,'{}','batch')`,
      ),
      ...["r-sync", "r-batch", "r-batch-nocols"].map((id) =>
        env.DB.prepare(
          `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,failure_reasons_json) VALUES (?,'t',1,1,1,1,'[]',1,1,1000000,1000000,0,0,'[]')`,
        ).bind(id),
      ),
    ]);
    const rows = (
      await env.DB.prepare(
        `SELECT run_id, cost_usd FROM v_results_with_cost WHERE run_id IN ('r-sync','r-batch','r-batch-nocols') ORDER BY run_id`,
      ).all()
    ).results as { run_id: string; cost_usd: number | null }[];
    expect(rows.find((r) => r.run_id === "r-sync")?.cost_usd).toBeCloseTo(
      30,
      6,
    );
    expect(rows.find((r) => r.run_id === "r-batch")?.cost_usd).toBeCloseTo(
      15,
      6,
    );
    expect(
      rows.find((r) => r.run_id === "r-batch-nocols")?.cost_usd,
    ).toBeNull();
  });
});
