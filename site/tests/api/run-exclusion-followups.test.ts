import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";
import { cohortDigest } from "../../src/lib/server/releases";
import { resetDb } from "../utils/reset-db";
import type {
  TaskSetsResponse,
  TaskSetV2Summary,
} from "../../src/lib/shared/api-types";

/**
 * Follow-ups to soft run exclusion (migration 0022), from the review round:
 * releases must not rank an excluded run and must export the mark, the task
 * set list must report how many of its runs are excluded, and the v2 run
 * shapes must carry the mark like their v1 counterparts.
 *
 * Fixture: one model, one task set, two runs, the second excluded.
 */

const actor = {
  key_id: 1,
  machine_id: "test-machine",
  scope: "admin" as const,
};

const EXCLUDED_AT = "2026-09-08T00:00:00.000Z";
const EXCLUDED_REASON = "host OOM during evaluation";
const SETTINGS_HASH = "f".repeat(64);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'m1','m1-api','Model One',1)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO settings_profiles(hash) VALUES (?)`,
    ).bind(SETTINGS_HASH),
    env.DB.prepare(
      `INSERT OR IGNORE INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
  await seedSet();
  await applyRevision(env.DB, {
    hash: HASH,
    normalized: normalizeCatalog(smallCatalog(), HASH),
    provenance: {},
    actor,
    signature: "s",
  });

  const run = (id: string, startedAt: string, excluded: boolean) =>
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,source,pricing_version,
                        ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode,
                        harness_fingerprint,test_runner,excluded_at,excluded_reason)
       VALUES (?,?,1,?,'rig',?,?,'completed','claimed','bench','v2026-04','sig','2026-01-01T00:00:00Z',1,'{}','sync',?, 'soap', ?, ?)`,
    ).bind(
      id,
      HASH,
      SETTINGS_HASH,
      startedAt,
      startedAt,
      "f".repeat(64),
      excluded ? EXCLUDED_AT : null,
      excluded ? EXCLUDED_REASON : null,
    );

  // r-drop is the MORE RECENT run, so a cohort rule that takes "the most
  // recent N per model" would pick it first if it were not excluded. That is
  // exactly the leak this fixture is shaped to catch.
  await env.DB.batch([
    run("r-keep", "2026-01-01T00:00:00Z", false),
    run("r-drop", "2026-02-01T00:00:00Z", true),
  ]);
});

const policyFor = (cohortSize: number) => ({
  schema_version: 1,
  eligible: {
    statuses: ["completed"],
    sources: ["bench"],
    settings_hash: SETTINGS_HASH,
  },
  cohort: {
    size: cohortSize,
    order: "started_at_desc",
    tie_break: "run_id",
  },
  reduction: "best_of_cohort",
  cells: {
    infra: "exclude",
    provider_error: "exclude",
    refusal: "count_for_requested_model",
    fallback: "count_for_requested_model",
  },
  macro_weights: {
    "build-from-spec": 0.25,
    "runtime-trap": 0.25,
    "diagnose-single": 0.25,
    "diagnose-composite": 0.25,
  },
  metrics: ["auc_2"],
  estimator_version: "ev0",
  draws: 4000,
  gate: { min_effective_components: 20, max_largest_share: 0.25 },
});

describe("releases do not rank an excluded run", () => {
  it("cohortDigest with an excluded run equals the digest without it", async () => {
    const policy = policyFor(3) as unknown as Parameters<
      typeof cohortDigest
    >[2];
    const withExcluded = await cohortDigest(env.DB, HASH, policy);

    // Delete the excluded run outright and recompute: the two digests must
    // agree, which is only true if the cohort query skipped it.
    await env.DB.prepare(`DELETE FROM runs WHERE id = 'r-drop'`).run();
    const withoutIt = await cohortDigest(env.DB, HASH, policy);
    expect(withExcluded).toBe(withoutIt);
  });

  it("cohortDigest skips it under the no-policy path too", async () => {
    const withExcluded = await cohortDigest(env.DB, HASH, null);
    await env.DB.prepare(`DELETE FROM runs WHERE id = 'r-drop'`).run();
    expect(withExcluded).toBe(await cohortDigest(env.DB, HASH, null));
  });

  it("a cohort of one takes the included run, not the newer excluded one", async () => {
    const policy = policyFor(1) as unknown as Parameters<
      typeof cohortDigest
    >[2];
    const digest = await cohortDigest(env.DB, HASH, policy);
    // Same expectation expressed as an equality against the world where only
    // r-keep exists: if the excluded (newer) run were taken, these differ.
    await env.DB.prepare(`DELETE FROM runs WHERE id = 'r-drop'`).run();
    expect(digest).toBe(await cohortDigest(env.DB, HASH, policy));
  });
});

describe("task-set summaries report how many runs are excluded", () => {
  it("v1 keeps run_count as inventory and adds excluded_run_count", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/task-sets")
    ).json()) as TaskSetsResponse;
    const row = body.data.find((s) => s.hash === HASH);
    expect(row).toBeDefined();
    // run_count stays the inventory of what is stored, excluded included.
    expect(row!.run_count).toBe(2);
    expect(row!.excluded_run_count).toBe(1);
  });

  it("v2 carries the same pair", async () => {
    const res = await SELF.fetch(`https://x/api/v2/task-sets?set=${HASH}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: TaskSetV2Summary[] };
    const row = body.data.find((s) => s.hash === HASH);
    expect(row?.run_count).toBe(2);
    expect(row?.excluded_run_count).toBe(1);
  });

  it("reports zero when nothing is excluded", async () => {
    await env.DB.prepare(
      `UPDATE runs SET excluded_at = NULL, excluded_reason = NULL`,
    ).run();
    const body = (await (
      await SELF.fetch("https://x/api/v1/task-sets")
    ).json()) as TaskSetsResponse;
    const row = body.data.find((s) => s.hash === HASH);
    expect(row?.run_count).toBe(2);
    expect(row?.excluded_run_count).toBe(0);
  });
});

describe("v2 run shapes carry the exclusion mark", () => {
  it("lists both runs, marking the excluded one", async () => {
    const res = await SELF.fetch(`https://x/api/v2/runs?set=${HASH}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        excluded_at: string | null;
        excluded_reason: string | null;
      }>;
    };
    const dropped = body.data.find((r) => r.id === "r-drop");
    expect(dropped?.excluded_at).toBe(EXCLUDED_AT);
    expect(dropped?.excluded_reason).toBe(EXCLUDED_REASON);
    const kept = body.data.find((r) => r.id === "r-keep");
    expect(kept?.excluded_at).toBe(null);
    expect(kept?.excluded_reason).toBe(null);
  });

  it("serves the excluded run's detail with the mark", async () => {
    const res = await SELF.fetch("https://x/api/v2/runs/r-drop");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      excluded_at: string | null;
      excluded_reason: string | null;
    };
    expect(body.id).toBe("r-drop");
    expect(body.excluded_at).toBe(EXCLUDED_AT);
    expect(body.excluded_reason).toBe(EXCLUDED_REASON);
  });

  it("leaves an included run's detail unmarked", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v2/runs/r-keep")
    ).json()) as { excluded_at: string | null; excluded_reason: string | null };
    expect(body.excluded_at).toBe(null);
    expect(body.excluded_reason).toBe(null);
  });
});
