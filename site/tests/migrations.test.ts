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
    for (
      const required of [
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
      ]
    ) {
      expect(names).toContain(required);
    }
  });

  it("enforces exactly-one-current task_set", async () => {
    await env.DB.prepare(
      `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
    )
      .bind("hash-a", "2026-01-01T00:00:00Z", 5).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
      )
        .bind("hash-b", "2026-01-02T00:00:00Z", 5).run(),
    ).rejects.toThrow();
  });
});

describe("migration 0007 family_diffs", () => {
  it("creates family_diffs with NULLABLE from_gen_event_id (no UNIQUE)", async () => {
    const cols = await env.DB.prepare(
      `PRAGMA table_info(family_diffs)`,
    ).all<{ name: string; type: string; notnull: number }>();
    const colNames = cols.results.map((c) => c.name);
    for (
      const required of [
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
      ]
    ) {
      expect(colNames).toContain(required);
    }
    // from_gen_event_id is NULLABLE
    const fromCol = cols.results.find((c) => c.name === "from_gen_event_id");
    expect(fromCol?.notnull).toBe(0);
    // from_model_slug is NULLABLE (paired with from_gen_event_id)
    const fromSlugCol = cols.results.find((c) => c.name === "from_model_slug");
    expect(fromSlugCol?.notnull).toBe(0);
    // analyzer_model_a is NULLABLE (omitted on baseline_missing)
    const analyzerACol = cols.results.find((c) =>
      c.name === "analyzer_model_a"
    );
    expect(analyzerACol?.notnull).toBe(0);
    // status is NOT NULL
    const statusCol = cols.results.find((c) => c.name === "status");
    expect(statusCol?.notnull).toBe(1);

    // Seed a real lifecycle_events row to satisfy the to_gen_event_id FK.
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, payload_json, actor)
       VALUES (?, 'a/x', 'h', 'analysis.completed', '{"analyzer_model":"a/o"}', 'operator')`,
    ).bind(Date.now()).run();
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
    ).bind(ev!.id, Date.now()).run();

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
    ).bind(ev!.id, Date.now()).run();
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
      ).bind(ev!.id).run(),
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
