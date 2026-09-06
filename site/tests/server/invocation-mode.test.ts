import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  parseModeParam,
  resolveInvocationMode,
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

describe("parseModeParam", () => {
  it("accepts sync, batch and absent; refuses all and junk", () => {
    expect(parseModeParam(new URL("https://x/?mode=sync"))).toBe("sync");
    expect(parseModeParam(new URL("https://x/?mode=batch"))).toBe("batch");
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
  it("defaults to the only mode present, sync when empty, and refuses when both exist", async () => {
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe(
      "sync",
    );
    await seedRuns(["batch"]);
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe(
      "batch",
    );
    expect(
      await resolveInvocationMode(env.DB, { kind: "hash", hash: "ts" }, null),
    ).toBe("batch");
    expect(
      await resolveInvocationMode(env.DB, { kind: "current" }, "sync"),
    ).toBe("sync");
    await resetDb();
    await seedRuns(["sync", "batch"]);
    await expect(
      resolveInvocationMode(env.DB, { kind: "current" }, null),
    ).rejects.toMatchObject({
      code: "mode_required",
    });
  });
});
