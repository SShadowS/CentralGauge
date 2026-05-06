import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { FAMILY_DIFF_CACHE_NAME } from "../../src/lib/server/family-diff-cache";
import { CACHE_VERSION } from "../../src/lib/server/cache-version";
import { maybeTriggerFamilyDiff } from "../../src/lib/server/lifecycle-diff-trigger";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

const ANALYZER_OPUS = "anthropic/claude-opus-4-6";
const ANALYZER_GPT = "openai/gpt-5.5";

async function seedFamilyAndModels(opts: {
  familySlug: string;
  vendor: string;
  models: Array<{ slug: string; api_id: string; display: string; gen: number }>;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO model_families(slug, vendor, display_name) VALUES (?, ?, ?)`,
  ).bind(opts.familySlug, opts.vendor, opts.familySlug).run();
  const fam = await env.DB.prepare(
    `SELECT id FROM model_families WHERE slug = ?`,
  ).bind(opts.familySlug).first<{ id: number }>();
  for (const m of opts.models) {
    await env.DB.prepare(
      `INSERT INTO models(family_id, slug, api_model_id, display_name, generation)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(fam!.id, m.slug, m.api_id, m.display, m.gen).run();
  }
}

async function postAnalysisCompleted(opts: {
  keyId: number;
  keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];
  modelSlug: string;
  taskSetHash: string;
  analyzerModel: string;
  ts?: number;
}): Promise<{ id: number }> {
  const payload = {
    ts: opts.ts ?? Date.now(),
    model_slug: opts.modelSlug,
    task_set_hash: opts.taskSetHash,
    event_type: "analysis.completed",
    payload: { analyzer_model: opts.analyzerModel },
    actor: "operator",
  };
  const { signedRequest } = await createSignedPayload(
    payload,
    opts.keyId,
    undefined,
    opts.keypair,
  );
  const r = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signedRequest),
  });
  expect(r.status).toBe(200);
  const body = await r.json() as { id: number };
  return body;
}

describe("lifecycle diff trigger on analysis.completed", () => {
  it("writes family_diffs row with status=baseline_missing for first gen", async () => {
    await seedFamilyAndModels({
      familySlug: "anthropic/claude-x",
      vendor: "anthropic",
      models: [{
        slug: "anthropic/claude-x-4-6",
        api_id: "x-4-6",
        display: "X 4.6",
        gen: 46,
      }],
    });
    const { keyId, keypair } = await registerMachineKey(
      "admin-baseline",
      "admin",
    );
    await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "anthropic/claude-x-4-6",
      taskSetHash: "h-baseline",
      analyzerModel: ANALYZER_OPUS,
    });

    // Trigger awaits inline (see lifecycle-diff-trigger.ts) so the
    // family_diffs row is observable immediately after the POST returns.

    const row = await env.DB.prepare(
      `SELECT status, from_gen_event_id, from_model_slug, to_model_slug,
              analyzer_model_a, analyzer_model_b, payload_json
         FROM family_diffs WHERE family_slug = 'anthropic/claude-x'`,
    ).first<{
      status: string;
      from_gen_event_id: number | null;
      from_model_slug: string | null;
      to_model_slug: string;
      analyzer_model_a: string | null;
      analyzer_model_b: string;
      payload_json: string;
    }>();
    expect(row).not.toBeNull();
    expect(row!.status).toBe("baseline_missing");
    expect(row!.from_gen_event_id).toBeNull();
    expect(row!.from_model_slug).toBeNull();
    expect(row!.to_model_slug).toBe("anthropic/claude-x-4-6");
    expect(row!.analyzer_model_a).toBeNull();
    expect(row!.analyzer_model_b).toBe(ANALYZER_OPUS);
    const payload = JSON.parse(row!.payload_json) as {
      status: string;
      resolved?: unknown;
    };
    expect(payload.status).toBe("baseline_missing");
    expect(payload.resolved).toBeUndefined();
  });

  it("writes status=analyzer_mismatch when analyzers differ", async () => {
    await seedFamilyAndModels({
      familySlug: "anthropic/claude-y",
      vendor: "anthropic",
      models: [
        {
          slug: "anthropic/claude-y-4-6",
          api_id: "y-4-6",
          display: "Y 4.6",
          gen: 46,
        },
        {
          slug: "anthropic/claude-y-4-7",
          api_id: "y-4-7",
          display: "Y 4.7",
          gen: 47,
        },
      ],
    });
    const { keyId, keypair } = await registerMachineKey(
      "admin-mismatch",
      "admin",
    );
    const t1 = Date.now() - 10_000;
    await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "anthropic/claude-y-4-6",
      taskSetHash: "h-mismatch",
      analyzerModel: ANALYZER_OPUS,
      ts: t1,
    });
    await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "anthropic/claude-y-4-7",
      taskSetHash: "h-mismatch",
      analyzerModel: ANALYZER_GPT,
      ts: t1 + 1000,
    });

    // Two diff rows expected: (1) baseline_missing for the first event,
    // (2) analyzer_mismatch for the second.
    const rows = await env.DB.prepare(
      `SELECT status FROM family_diffs WHERE family_slug = 'anthropic/claude-y' ORDER BY id ASC`,
    ).all<{ status: string }>();
    expect(rows.results.map((r) => r.status)).toEqual([
      "baseline_missing",
      "analyzer_mismatch",
    ]);

    const mismatch = await env.DB.prepare(
      `SELECT analyzer_model_a, analyzer_model_b, from_model_slug, to_model_slug, payload_json
         FROM family_diffs
        WHERE family_slug = 'anthropic/claude-y' AND status = 'analyzer_mismatch'`,
    ).first<{
      analyzer_model_a: string;
      analyzer_model_b: string;
      from_model_slug: string;
      to_model_slug: string;
      payload_json: string;
    }>();
    expect(mismatch!.analyzer_model_a).toBe(ANALYZER_OPUS);
    expect(mismatch!.analyzer_model_b).toBe(ANALYZER_GPT);
    expect(mismatch!.from_model_slug).toBe("anthropic/claude-y-4-6");
    expect(mismatch!.to_model_slug).toBe("anthropic/claude-y-4-7");
    const payload = JSON.parse(mismatch!.payload_json) as {
      status: string;
      resolved?: unknown;
      persisting?: unknown;
      regressed?: unknown;
      new?: unknown;
    };
    expect(payload.status).toBe("analyzer_mismatch");
    // Buckets are intentionally absent on analyzer_mismatch.
    expect(payload.resolved).toBeUndefined();
    expect(payload.persisting).toBeUndefined();
    expect(payload.regressed).toBeUndefined();
    expect(payload.new).toBeUndefined();
  });

  it("is idempotent — second analysis.completed for same to_event upserts not duplicates", async () => {
    // The events POST handler dedupes on (payload_hash, ts, event_type), so
    // we cannot literally POST the same event twice. This test instead
    // asserts the trigger upsert path: emit two analysis.completed events
    // (different ts), then verify family_diffs has exactly one row per
    // (from, to) tuple — the second event should add a new row keyed to its
    // own to_gen_event_id and the first row's baseline_missing remains.
    await seedFamilyAndModels({
      familySlug: "anthropic/claude-z",
      vendor: "anthropic",
      models: [
        {
          slug: "anthropic/claude-z-4-6",
          api_id: "z-4-6",
          display: "Z 4.6",
          gen: 46,
        },
        {
          slug: "anthropic/claude-z-4-7",
          api_id: "z-4-7",
          display: "Z 4.7",
          gen: 47,
        },
      ],
    });
    const { keyId, keypair } = await registerMachineKey("admin-idemp", "admin");
    const t1 = Date.now() - 20_000;
    await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "anthropic/claude-z-4-6",
      taskSetHash: "h-idemp",
      analyzerModel: ANALYZER_OPUS,
      ts: t1,
    });
    await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "anthropic/claude-z-4-7",
      taskSetHash: "h-idemp",
      analyzerModel: ANALYZER_OPUS,
      ts: t1 + 1000,
    });

    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM family_diffs WHERE family_slug = 'anthropic/claude-z'`,
    ).first<{ n: number }>();
    // Exactly two rows: baseline_missing + comparable.
    expect(rows!.n).toBe(2);
    const comparable = await env.DB.prepare(
      `SELECT status FROM family_diffs WHERE family_slug = 'anthropic/claude-z' AND status = 'comparable'`,
    ).first<{ status: string }>();
    expect(comparable!.status).toBe("comparable");
  });

  it("non-analysis.completed events are no-op for the trigger", async () => {
    await seedFamilyAndModels({
      familySlug: "anthropic/claude-w",
      vendor: "anthropic",
      models: [{
        slug: "anthropic/claude-w-4-6",
        api_id: "w-4-6",
        display: "W 4.6",
        gen: 46,
      }],
    });
    const { keyId, keypair } = await registerMachineKey("admin-noop", "admin");
    const payload = {
      ts: Date.now(),
      model_slug: "anthropic/claude-w-4-6",
      task_set_hash: "h-noop",
      event_type: "bench.completed",
      payload: { runs_count: 1 },
      actor: "operator",
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const r = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(r.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT id FROM family_diffs WHERE family_slug = 'anthropic/claude-w'`,
    ).first<{ id: number }>();
    expect(row).toBeNull();
  });

  it("analysis.completed for unknown model_slug is no-op (no family resolved)", async () => {
    // No seed_family — the model isn't in the catalog.
    const { keyId, keypair } = await registerMachineKey(
      "admin-no-fam",
      "admin",
    );
    await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "unknown/model-slug-z",
      taskSetHash: "h-no-fam",
      analyzerModel: ANALYZER_OPUS,
    });

    const cnt = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM family_diffs`,
    ).first<{ n: number }>();
    expect(cnt!.n).toBe(0);
  });

  it("trigger evicts the named-cache slot the GET handler put there (no 5-min stale window)", async () => {
    // Wave-5 critical-fix coverage: invalidateFamilyDiffCache used to delete
    // synthetic `https://cache.lifecycle/family-diff/...` URLs that no
    // handler ever wrote to — entries actually stored under the
    // `lifecycle-family-diff` named cache (keyed on real Request URLs)
    // were left to be served stale for the full 300s TTL after every
    // analysis.completed event.
    //
    // This test pre-warms the cache via a real GET, fires the trigger via
    // a real POST analysis.completed, and asserts the next GET returns
    // FRESH data (different to_gen_event_id) — proving eviction reached
    // the right slot.
    await seedFamilyAndModels({
      familySlug: "famcache",
      vendor: "anthropic",
      models: [
        { slug: "famcache-4-6", api_id: "fc-4-6", display: "FC 4.6", gen: 46 },
        { slug: "famcache-4-7", api_id: "fc-4-7", display: "FC 4.7", gen: 47 },
      ],
    });
    await env.DB.prepare(
      `INSERT INTO task_sets(hash, created_at, task_count, is_current)
       VALUES (?, ?, 0, 1)`,
    ).bind("h-cache", new Date().toISOString()).run();

    const { keyId, keypair } = await registerMachineKey("admin-cache", "admin");
    const t1 = Date.now() - 20_000;

    // First analysis: triggers baseline_missing diff. POST body's
    // origin = https://x (matches SELF.fetch).
    const ev1 = await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "famcache-4-6",
      taskSetHash: "h-cache",
      analyzerModel: ANALYZER_OPUS,
      ts: t1,
    });

    // Pre-warm the cache via a real GET. The handler MUST inline-put before
    // returning, so the next cache.match observes the entry.
    const url = "https://x/api/v1/families/famcache/diff";
    const r1 = await SELF.fetch(url);
    expect(r1.status).toBe(200);
    const body1 = await r1.json() as {
      to_gen_event_id: number;
      status: string;
    };
    expect(body1.status).toBe("baseline_missing");
    expect(body1.to_gen_event_id).toBe(ev1.id);

    // The handler appends _cv=<version> to the cache key so old entries
    // retire on deploy. Check the versioned key, not the bare URL.
    const cache = await caches.open(FAMILY_DIFF_CACHE_NAME);
    const versionedUrl = `${url}?_cv=${CACHE_VERSION}`;
    const warmHit = await cache.match(new Request(versionedUrl));
    expect(
      warmHit,
      "cache MUST have an entry after the GET — handler should inline-put before returning",
    ).toBeTruthy();

    // Now post a second analysis.completed for the sibling model. The
    // trigger fires inline, materialises a new family_diffs row, AND
    // evicts the named-cache slot for `https://x/.../diff`.
    const ev2 = await postAnalysisCompleted({
      keyId,
      keypair,
      modelSlug: "famcache-4-7",
      taskSetHash: "h-cache",
      analyzerModel: ANALYZER_OPUS,
      ts: t1 + 1000,
    });

    const postEvictMiss = await cache.match(new Request(versionedUrl));
    expect(
      postEvictMiss,
      "trigger MUST evict the cache slot the GET handler wrote — pre-fix this" +
        " would still hit (synthetic URL eviction never matched the real key).",
    ).toBeUndefined();

    // The next GET should observe ev2 as the to_gen_event_id, not ev1
    // (proves the second-level cache.put fed fresh data into the cache).
    // Confirm the trigger did NOT also poison caches.default — historical
    // hazard: adapter-cloudflare's worker wrapper (worker.js line 21)
    // automatically writes responses with `cache-control: public,*` to
    // caches.default keyed by URL, bypassing app-level eviction. The
    // handler now emits `private, max-age` to opt out of that tee.
    const dflt = await caches.default.match(new Request(url));
    expect(
      dflt,
      "caches.default MUST NOT have an entry — adapter-cloudflare " +
        "should skip the tee for `cache-control: private` responses",
    ).toBeUndefined();

    const r2 = await SELF.fetch(url);
    expect(r2.status).toBe(200);
    const body2 = await r2.json() as {
      to_gen_event_id: number;
      status: string;
    };
    expect(body2.to_gen_event_id).toBe(ev2.id);
    // ev2 is comparable (analyzer matches). If we still saw the stale
    // baseline_missing body, the trigger eviction failed.
    expect(body2.status).toBe("comparable");
  });

  it("comparable diff materialises with all 4 buckets populated when shortcomings are attached BEFORE the trigger fires", async () => {
    // Wave 5 / Plan E IMPORTANT 4: existing trigger tests cover
    // baseline_missing, analyzer_mismatch, dedup, and no-op edge cases
    // but never assert that the trigger writes a `comparable` row with
    // all four bucket arrays populated. The acceptance suite
    // (families-diff-acceptance.test.ts) asserts populated buckets but
    // PURGES the trigger-written row first to exercise the GET
    // fallback path — silently masking any trigger-side regression
    // that only writes empty buckets.
    //
    // This test invokes `maybeTriggerFamilyDiff` DIRECTLY (bypassing
    // the events POST handler) so we can attach shortcomings to a
    // lifecycle_event row BEFORE firing the trigger. That mirrors
    // production's atomic shape (Plan D-data's batch insert: shortcomings
    // INSERT in the same db.batch as the analysis.completed event), with
    // the trigger reading attached state on first fire.
    await seedFamilyAndModels({
      familySlug: "famhappy",
      vendor: "anthropic",
      models: [
        { slug: "famhappy-4-6", api_id: "fh-4-6", display: "FH 4.6", gen: 46 },
        { slug: "famhappy-4-7", api_id: "fh-4-7", display: "FH 4.7", gen: 47 },
      ],
    });
    const m46 = await env.DB.prepare(
      `SELECT id FROM models WHERE slug = ?`,
    ).bind("famhappy-4-6").first<{ id: number }>();
    const m47 = await env.DB.prepare(
      `SELECT id FROM models WHERE slug = ?`,
    ).bind("famhappy-4-7").first<{ id: number }>();

    // Concept timestamps (production-realistic unix-ms scale per Wave 5
    // CRITICAL 1 fix). PRE_TS predates gen_a's analysis ts → bucketed
    // regressed (when present at gen_b but absent at gen_a) or
    // persisting (present at both). POST_TS post-dates gen_a → bucketed
    // `new` when present at gen_b only.
    const tA = Date.now() - 10_000;
    const tB = tA + 5_000;
    const PRE_TS = tA - 30 * 86_400_000;
    const POST_TS = tA + 1_000; // between gen_a and gen_b

    async function seedConcept(
      slug: string,
      alConcept: string,
      firstSeen: number,
    ) {
      const r = await env.DB.prepare(
        `INSERT INTO concepts(slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(slug, slug, alConcept, "d", firstSeen, firstSeen).run();
      return Number(r.meta!.last_row_id!);
    }
    const cResolved = await seedConcept("h-resolved", "al-r", PRE_TS);
    const cPersisting = await seedConcept("h-persists", "al-p", PRE_TS);
    const cRegressed = await seedConcept("h-regressed", "al-rg", PRE_TS);
    const cNew = await seedConcept("h-new", "al-n", POST_TS);

    // Insert lifecycle_events directly (no signature/POST overhead — we
    // want the trigger to fire deterministically AFTER shortcomings are
    // attached, which the events POST API can't express).
    const evARes = await env.DB.prepare(
      `INSERT INTO lifecycle_events(
         ts, model_slug, task_set_hash, event_type, payload_json, actor
       ) VALUES (?, ?, ?, 'analysis.completed', ?, 'operator')`,
    ).bind(
      tA,
      "famhappy-4-6",
      "h-happy",
      JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
    ).run();
    const evAId = Number(evARes.meta!.last_row_id!);

    const evBRes = await env.DB.prepare(
      `INSERT INTO lifecycle_events(
         ts, model_slug, task_set_hash, event_type, payload_json, actor
       ) VALUES (?, ?, ?, 'analysis.completed', ?, 'operator')`,
    ).bind(
      tB,
      "famhappy-4-7",
      "h-happy",
      JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
    ).run();
    const evBId = Number(evBRes.meta!.last_row_id!);

    // Attach shortcomings to BOTH events. This is the production-shape
    // analog: shortcomings INSERT inside the same db.batch as the
    // analysis.completed event (Plan D-data).
    async function attachShortcoming(
      modelId: number,
      conceptId: number,
      alConcept: string,
      analysisEventId: number,
      i: number,
    ): Promise<void> {
      await env.DB.prepare(
        `INSERT INTO shortcomings(
           model_id, al_concept, concept, description, correct_pattern,
           incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen,
           concept_id, analysis_event_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        modelId,
        `${alConcept}-${analysisEventId}-${i}`,
        "mock",
        "mock",
        "mock",
        "mock-r2",
        "[]",
        new Date().toISOString(),
        new Date().toISOString(),
        conceptId,
        analysisEventId,
      ).run();
    }
    // gen_a: resolved (1) + persisting (3)
    await attachShortcoming(m46!.id, cResolved, "al-r", evAId, 0);
    await attachShortcoming(m46!.id, cPersisting, "al-p", evAId, 0);
    await attachShortcoming(m46!.id, cPersisting, "al-p", evAId, 1);
    await attachShortcoming(m46!.id, cPersisting, "al-p", evAId, 2);
    // gen_b: persisting (1) + regressed (2) + new (1). resolved is
    // dropped (was in gen_a, gone in gen_b). regressed wasn't in gen_a
    // but its concept first_seen predates gen_a → bucket = regressed.
    // new's first_seen post-dates gen_a → bucket = new.
    await attachShortcoming(m47!.id, cPersisting, "al-p", evBId, 0);
    await attachShortcoming(m47!.id, cRegressed, "al-rg", evBId, 0);
    await attachShortcoming(m47!.id, cRegressed, "al-rg", evBId, 1);
    await attachShortcoming(m47!.id, cNew, "al-n", evBId, 0);

    // Now fire the trigger directly. The trigger SELECTs the prior
    // event (gen_a) + ts, computes the diff against the now-attached
    // shortcomings, and upserts a `comparable` row.
    const cache = await caches.open(FAMILY_DIFF_CACHE_NAME);
    const noopCtx = { waitUntil: (_: Promise<unknown>) => {} };
    await maybeTriggerFamilyDiff(
      noopCtx,
      env.DB,
      cache,
      {
        id: evBId,
        model_slug: "famhappy-4-7",
        task_set_hash: "h-happy",
        event_type: "analysis.completed",
      },
      "https://x",
    );

    // Read the materialised row directly. The trigger MUST have written
    // a comparable row keyed (gen_a, gen_b) with all four buckets
    // populated.
    const row = await env.DB.prepare(
      `SELECT status, payload_json FROM family_diffs
        WHERE family_slug = 'famhappy' AND from_gen_event_id = ?
          AND to_gen_event_id = ?`,
    ).bind(evAId, evBId).first<{ status: string; payload_json: string }>();
    expect(row, "trigger MUST materialise a row for the (gen_a, gen_b) pair")
      .toBeTruthy();
    expect(row!.status).toBe("comparable");

    const payload = JSON.parse(row!.payload_json) as {
      status: string;
      resolved: Array<{ slug: string; delta: number }>;
      persisting: Array<{ slug: string; delta: number }>;
      regressed: Array<{ slug: string; delta: number }>;
      new: Array<{ slug: string; delta: number }>;
    };
    expect(payload.status).toBe("comparable");
    expect(payload.resolved.map((c) => c.slug)).toEqual(["h-resolved"]);
    expect(payload.resolved[0].delta).toBe(1);
    expect(payload.persisting.map((c) => c.slug)).toEqual(["h-persists"]);
    expect(payload.persisting[0].delta).toBe(-2); // 1 - 3
    expect(payload.regressed.map((c) => c.slug)).toEqual(["h-regressed"]);
    expect(payload.regressed[0].delta).toBe(2);
    expect(payload.new.map((c) => c.slug)).toEqual(["h-new"]);
    expect(payload.new[0].delta).toBe(1);
  });
});
