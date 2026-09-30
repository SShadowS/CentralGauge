import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  modePredicate,
  parseModeParam,
  resolveInvocationMode,
  servedModes,
} from "../../src/lib/server/invocation-mode";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedRuns(modes: string[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'f','v','F')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'m','m','M')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`,
    ),
    env.DB.prepare(`INSERT INTO settings_profiles(hash) VALUES ('s')`),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
    ...modes.map((mode, i) =>
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES (?,'ts',1,'s','rig','2026-01-01T00:00:00Z','completed','claimed','v','sig','2026-01-01T00:00:00Z',1,'{}',?)`,
      ).bind(`r${i}`, mode),
    ),
  ]);
}

async function seedModelRuns(
  runs: Array<{ model: number; mode: string; excluded?: boolean }>,
): Promise<void> {
  const modelIds = [...new Set(runs.map((r) => r.model))];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'f','v','F')`,
    ),
    ...modelIds.map((id) =>
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (?,1,?,?,?)`,
      ).bind(id, `m${id}`, `m${id}`, `M${id}`),
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`,
    ),
    env.DB.prepare(`INSERT INTO settings_profiles(hash) VALUES ('s')`),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
    ...runs.map((r, i) =>
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode,excluded_at) VALUES (?,'ts',?,'s','rig','2026-01-01T00:00:00Z','completed','claimed','v','sig','2026-01-01T00:00:00Z',1,'{}',?,?)`,
      ).bind(`r${i}`, r.model, r.mode, r.excluded ? "2026-01-02T00:00:00Z" : null),
    ),
  ]);
}

describe("parseModeParam", () => {
  it("accepts sync, batch, combined and absent; refuses all and junk", () => {
    expect(parseModeParam(new URL("https://x/?mode=sync"))).toBe("sync");
    expect(parseModeParam(new URL("https://x/?mode=batch"))).toBe("batch");
    expect(parseModeParam(new URL("https://x/?mode=combined"))).toBe("combined");
    expect(parseModeParam(new URL("https://x/"))).toBeNull();
    expect(() => parseModeParam(new URL("https://x/?mode=all"))).toThrowError(
      expect.objectContaining({ code: "invalid_mode_for_metric" }),
    );
    expect(() => parseModeParam(new URL("https://x/?mode=turbo"))).toThrowError(
      expect.objectContaining({ code: "invalid_mode" }),
    );
  });
});

describe("resolveInvocationMode", () => {
  it("defaults to the only mode present, sync when empty, and combined when both exist", async () => {
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("sync");
    await seedRuns(["batch"]);
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("batch");
    expect(await resolveInvocationMode(env.DB, { kind: "hash", hash: "ts" }, null)).toBe("batch");
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, "sync")).toBe("sync");
    await resetDb();
    await seedRuns(["sync", "batch"]);
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("combined");
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, "batch")).toBe("batch");
  });
});

describe("modePredicate", () => {
  it("keeps the single-mode SQL exactly and adds one-bind combined SQL", () => {
    expect(modePredicate("runs", "sync")).toBe("runs.invocation_mode = ?");
    expect(modePredicate("ru1", "batch")).toBe("ru1.invocation_mode = ?");
    const combined = modePredicate("ru2", "combined");
    expect(combined.split("?").length - 1).toBe(1);
    expect(combined).toContain("NULLIF(?, 'combined')");
    expect(combined).toContain("sm.model_id = ru2.model_id");
    expect(() => modePredicate("x; DROP", "sync")).toThrow();
    expect(() => modePredicate("sm", "combined")).toThrow();
  });

  it("combined selects each model's majority mode, tie to batch, excluded runs ignored", async () => {
    await seedModelRuns([
      { model: 1, mode: "batch" }, // batch only
      { model: 2, mode: "sync" }, // sync only
      { model: 3, mode: "batch" }, // 1 batch vs 2 sync: sync
      { model: 3, mode: "sync" },
      { model: 3, mode: "sync" },
      { model: 4, mode: "batch" }, // tie: batch
      { model: 4, mode: "sync" },
      { model: 5, mode: "batch" }, // 2 sync excluded: batch
      { model: 5, mode: "sync", excluded: true },
      { model: 5, mode: "sync", excluded: true },
      { model: 6, mode: "sync", excluded: true }, // all excluded: no row
    ]);
    const rs = await env.DB.prepare(
      `SELECT runs.model_id AS model_id, runs.invocation_mode AS mode
         FROM runs
        WHERE ${modePredicate("runs", "combined")} AND runs.excluded_at IS NULL
        ORDER BY runs.model_id, runs.id`,
    )
      .bind("combined")
      .all<{ model_id: number; mode: string }>();
    const got = (rs.results ?? []).map((r) => `${r.model_id}:${r.mode}`);
    expect(got).toEqual(["1:batch", "2:sync", "3:sync", "3:sync", "4:batch", "5:batch"]);

    const served = await servedModes(env.DB, { kind: "current" });
    expect(Object.fromEntries(served)).toEqual({
      1: "batch",
      2: "sync",
      3: "sync",
      4: "batch",
      5: "batch",
    });
  });
});
