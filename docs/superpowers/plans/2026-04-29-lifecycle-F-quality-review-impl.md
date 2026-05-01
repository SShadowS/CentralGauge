# Phase F — Quality gating + review UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-score every analyzer entry's confidence (schema validity + concept-cluster consistency + sampled cross-LLM agreement); route below-threshold entries to a Cloudflare Access-gated `/admin/lifecycle/review` queue where an operator accepts or rejects with full provenance side-by-side; record every decision as an immutable lifecycle event.

**Architecture:** A pure `confidence.ts` scorer produces a per-entry score 0..1 from three deterministic-or-sampled signals; a `pending-review` writer enqueues below-threshold entries; two admin endpoints (`/queue`, `/decide`) read the queue and write `analysis.accepted` / `analysis.rejected` events; Cloudflare Access guards `/admin/lifecycle/*` with GitHub OAuth at the edge; a Svelte 5 admin UI renders the queue with raw-debug ↔ rationale side-by-side panes plus a status matrix mirroring the CLI.

**Tech Stack:** Deno (CLI scorer + pending-review writer), zod (schema validity), SvelteKit Cloudflare Worker (admin endpoints + UI), D1 (`pending_review` table from Phase A's migration 0006), Cloudflare Access (GitHub OAuth, `CF-Access-Jwt-Assertion` header verification), R2 (raw debug bundle proxy reads via the `LIFECYCLE_BLOBS` binding), Svelte 5 runes, Vitest.

**Depends on:**
- **Phase A** — event log writer (`appendEvent`), `pending_review` table from `0006_lifecycle.sql`, Ed25519 admin endpoints, AND the `LIFECYCLE_BLOBS` R2 binding declared in `site/wrangler.toml`. Plan A also creates `PUT|GET /api/v1/admin/lifecycle/r2/<key>` admin endpoints; F retro-patches them to use `authenticateAdminRequest` (see F5.5).
- **Phase C** — analyze step writes entries + invokes `enqueue` from `src/lifecycle/pending-review.ts` (F2's module). Plan C's `analysis.completed` event payload includes `analyzer_model` (read by Plan E for diff comparability).
- **Phase D** — concept registry; clustering-consistency signal reads `concepts.slug`. Plan D-prompt's batch endpoint shares the canonical `pending_review.payload_json` shape defined in F2.1; Plan D-data's cluster-review enqueue calls F2's `enqueue()` directly.

**Cross-plan contracts this plan owns or depends on:**
- `appendEvent({ model_slug, task_set_hash, event_type, payload, tool_versions, envelope }) → { id }` — canonical signature from Plan A. Both worker-side `(db, input)` and CLI-side `(input, opts)` consume `AppendEventInput` with object-form `payload`/`tool_versions`/`envelope`. F4's `/decide` endpoint emits `analysis.accepted` / `analysis.rejected` events through this writer.
- `pending_review.payload_json = { entry: AnalyzerEntry, confidence: ConfidenceResult }` — canonical shape, owned by F2.1. Plans C, D-prompt, and D-data all emit this shape.
- `lifecycle.analyzer_model` config knob — owned by F1.2. Plans C and G read it.
- `LIFECYCLE_BLOBS` R2 binding — declared by Plan A. F's `debug/[...key]` proxy and Plan E's `debug-bundle-exists` endpoint both use the same name.
- `authenticateAdminRequest(request, env, signedBody | null) → { kind: 'cf-access' | 'admin-sig', actor_id }` — owned by F (F3.1's `cf-access.ts`). F5.5 retro-patches every admin lifecycle endpoint (Plan A's events/state/r2 + Plan D-data's clusters + Plan E's debug-bundle-exists) to call this helper instead of `verifySignedRequest` directly.

**Strategic context:** See `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md` Phase F. Read the rationale boxes "quality gating is a human-in-the-loop checkpoint... with sampled cross-LLM agreement" and "web admin auth via Cloudflare Access (GitHub OAuth)" — both decisions shape this plan.

---

## F1 — Confidence scorer (`src/lifecycle/confidence.ts`)

- [ ] **F1.1** — Create `U:\Git\CentralGauge\src\lifecycle\confidence.ts` with the three-signal scoring function. The score combines: (a) schema validity — always run, deterministic, no API call; (b) concept-cluster consistency — always run, no API call; (c) cross-LLM agreement — sampled by config rate, deterministic selection.

  ```typescript
  /**
   * Confidence scorer for analyzer-emitted shortcoming entries. The strategic
   * plan rationale is explicit: this is a triage signal, not a gate. Above
   * threshold auto-publishes; below threshold routes to the human-review
   * queue. The cross-LLM agreement check is sampled to bound API spend.
   *
   * @module src/lifecycle/confidence
   */
  import { z } from "zod";
  // CANONICAL schema lives in `src/verify/schema.ts` (Plan D-prompt) — single
  // source of truth matching the on-disk `model-shortcomings/*.json` format.
  // Field naming is camelCase (`alConcept`, `correctPattern`, ...) to align
  // with the existing JSON file convention. DO NOT redefine here.
  import {
    AnalyzerEntrySchema,
    type ModelShortcomingParsed as AnalyzerEntry,
  } from "../verify/schema.ts";

  export { AnalyzerEntrySchema };
  export type { AnalyzerEntry };

  export interface ConfidenceContext {
    /** Existing concept slugs for cluster-consistency check. */
    knownConceptSlugs: Set<string>;
    /** Sampling rate from .centralgauge.yml lifecycle.cross_llm_sample_rate. */
    crossLlmSampleRate: number;
    /**
     * Threshold below which entries route to pending_review. Default 0.7.
     * Read from config (not a constant) because operators bump it during
     * high-stakes releases.
     */
    threshold: number;
    /**
     * Cross-LLM agreement runner. Optional — only invoked when sampling
     * selects this entry. Returns a score 0..1 indicating agreement
     * (concept_slug + correct_pattern wording match).
     */
    crossLlmAgreementRunner?: (
      entry: AnalyzerEntry,
    ) => Promise<number>;
  }

  export interface ConfidenceResult {
    score: number;                         // 0..1
    breakdown: {
      schema_validity: number;             // 0 or 1
      concept_cluster_consistency: number; // -0.1 .. 0.2
      cross_llm_agreement: number | null;  // null when not sampled
    };
    sampled_for_cross_llm: boolean;
    above_threshold: boolean;
    failure_reasons: string[];             // reasons populated when score < 1
  }

  /**
   * Deterministic sampling: sha256(canonical(payload)) modulo (1/rate).
   * The same entry hashes to the same selection across runs, enabling
   * trend visibility on systemic hallucinators.
   */
  export async function selectsForCrossLlmCheck(
    entry: AnalyzerEntry,
    rate: number,
  ): Promise<boolean> {
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    const canonical = JSON.stringify(entry, Object.keys(entry).sort());
    const buf = new TextEncoder().encode(canonical);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    const view = new DataView(hash);
    const first32 = view.getUint32(0, false);
    const bucket = Math.floor(1 / rate);  // e.g. rate=0.2 → 5 buckets
    return (first32 % bucket) === 0;
  }

  export async function scoreEntry(
    entry: unknown,
    ctx: ConfidenceContext,
  ): Promise<ConfidenceResult> {
    const reasons: string[] = [];

    // (a) Schema validity. Zod failure is hard-zero — without a parsable
    // entry the downstream signals are meaningless.
    const parsed = AnalyzerEntrySchema.safeParse(entry);
    if (!parsed.success) {
      return {
        score: 0,
        breakdown: {
          schema_validity: 0,
          concept_cluster_consistency: 0,
          cross_llm_agreement: null,
        },
        sampled_for_cross_llm: false,
        above_threshold: false,
        failure_reasons: parsed.error.issues.map((i) => `schema:${i.path.join('.')}:${i.message}`),
      };
    }
    const e = parsed.data;
    let schemaScore = 1;

    // Additional schema heuristics that zod can't express cleanly.
    // Field names are camelCase per the canonical D-prompt schema.
    if (e.correctPattern.trim().length === 0) {
      schemaScore = 0;
      reasons.push('schema:correctPattern_empty');
    }
    if (e.errorCodes && e.errorCodes.length === 0) {
      // empty array is allowed; explicit null is canonical, but neither blocks.
    }

    // (b) Concept-cluster consistency.
    let clusterScore = 0;
    if (ctx.knownConceptSlugs.has(e.conceptSlugProposed)) {
      clusterScore = 0.2;  // matches existing cluster
    } else {
      clusterScore = -0.1;  // orphan — penalised but not blocking
      reasons.push('concept:orphan_slug');
    }

    // (c) Cross-LLM agreement. Sampled.
    const sampled = await selectsForCrossLlmCheck(e, ctx.crossLlmSampleRate);
    let crossScore: number | null = null;
    if (sampled && ctx.crossLlmAgreementRunner) {
      const raw = await ctx.crossLlmAgreementRunner(e);
      crossScore = Math.max(0, Math.min(1, raw)) * 0.3;  // cap boost at +0.3
      if (crossScore < 0.15) reasons.push('cross_llm:low_agreement');
    }

    // Composite. Schema is the dominant gate (0 → score floored at 0).
    const base = schemaScore * (0.5 + clusterScore + (crossScore ?? 0));
    const score = Math.max(0, Math.min(1, base));

    return {
      score,
      breakdown: {
        schema_validity: schemaScore,
        concept_cluster_consistency: clusterScore,
        cross_llm_agreement: crossScore,
      },
      sampled_for_cross_llm: sampled,
      above_threshold: score >= ctx.threshold,
      failure_reasons: reasons,
    };
  }
  ```

- [ ] **F1.2** — Update `.centralgauge.yml` schema in `src/config/config.ts` to include the `lifecycle.cross_llm_sample_rate`, `lifecycle.confidence_threshold`, and `lifecycle.analyzer_model` fields. **Plan F is the canonical owner of the `lifecycle.*` zod schema**; Plan C reads `lifecycle.analyzer_model` (the default analyzer LLM for `cycle analyze`) and Plan G's weekly CI workflow also reads it. Adding the field here means Plan C and Plan G consume from one source of truth — no duplicated defaults:

  ```typescript
  // Inside the existing config zod schema, add:
  lifecycle: z.object({
    /** Default analyzer LLM slug (Plan C's verify-step uses this when --analyzer-model is unset; Plan G's weekly CI also reads it). */
    analyzer_model: z.string().min(1).default('anthropic/claude-opus-4-6').optional(),
    /** Sampling rate for the cross-LLM agreement check (F1.1). */
    cross_llm_sample_rate: z.number().min(0).max(1).default(0.2),
    /** Threshold below which entries route to the review queue (F1.1). */
    confidence_threshold: z.number().min(0).max(1).default(0.7),
  }).optional(),
  ```

  > **Cross-plan dependency.** Plan C's `cycle analyze` step picks up `lifecycle.analyzer_model` as the default for its `--analyzer-model` flag (CLI flag wins when present). Plan G's `.github/workflows/weekly-cycle.yml` may export this value into the env so the cron run matches operator-local config. The default `'anthropic/claude-opus-4-6'` is the same default the strategic plan rationale documents ("the analyzer LLM choice is configurable, default = claude-opus-4-6").

- [ ] **F1.3** — Tests in `tests/unit/lifecycle/confidence.test.ts`. Snapshot the breakdown for a fixture entry to ensure determinism across runs. Verify schema-fail, orphan slug, cluster-match, and sampling determinism.

  ```typescript
  import { assertEquals } from "@std/assert";
  import {
    scoreEntry,
    selectsForCrossLlmCheck,
    type AnalyzerEntry,
  } from "../../../src/lifecycle/confidence.ts";

  const validEntry: AnalyzerEntry = {
    al_concept: "FlowField",
    concept_slug_proposed: "flowfield-calcfields-requirement",
    description: "FlowFields require explicit CalcFields() before reading",
    correct_pattern: "Rec.CalcFields(\"Amount\");",
    incorrect_pattern: "if Rec.\"Amount\" > 0 then ...",
    error_codes: ["AL0606"],
    rationale: "BC requires CalcFields for FlowField evaluation",
  };

  Deno.test("scoreEntry", async (t) => {
    await t.step("returns 0 with schema:correct_pattern_empty when correct_pattern is empty", async () => {
      const r = await scoreEntry({ ...validEntry, correct_pattern: "" }, {
        knownConceptSlugs: new Set(),
        crossLlmSampleRate: 0,
        threshold: 0.7,
      });
      assertEquals(r.score, 0);
      assertEquals(r.above_threshold, false);
      assertEquals(r.failure_reasons.includes("schema:correct_pattern_empty"), true);
    });

    await t.step("returns 0 on bad error code (not AL\\d{4})", async () => {
      const r = await scoreEntry(
        { ...validEntry, error_codes: ["E0606"] as unknown as string[] },
        { knownConceptSlugs: new Set(), crossLlmSampleRate: 0, threshold: 0.7 },
      );
      assertEquals(r.score, 0);
      assertEquals(r.failure_reasons[0]!.startsWith("schema:"), true);
    });

    await t.step("boosts when concept_slug_proposed matches a known cluster", async () => {
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set(["flowfield-calcfields-requirement"]),
        crossLlmSampleRate: 0,
        threshold: 0.7,
      });
      assertEquals(r.breakdown.concept_cluster_consistency, 0.2);
      // schema=1, cluster=+0.2, cross=null → base = 1*(0.5+0.2+0) = 0.7
      assertEquals(r.score, 0.7);
      assertEquals(r.above_threshold, true);
    });

    await t.step("penalises orphan slug", async () => {
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set(["unrelated-concept"]),
        crossLlmSampleRate: 0,
        threshold: 0.7,
      });
      assertEquals(r.breakdown.concept_cluster_consistency, -0.1);
      assertEquals(r.failure_reasons.includes("concept:orphan_slug"), true);
    });

    await t.step("invokes cross-LLM runner when sampling selects entry", async () => {
      let calls = 0;
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set(["flowfield-calcfields-requirement"]),
        crossLlmSampleRate: 1.0,
        threshold: 0.7,
        crossLlmAgreementRunner: async () => { calls += 1; return 1.0; },
      });
      assertEquals(calls, 1);
      assertEquals(r.sampled_for_cross_llm, true);
      // schema=1, cluster=0.2, cross=0.3 → base = 1*(0.5+0.2+0.3) = 1.0
      assertEquals(r.score, 1);
    });
  });

  Deno.test("selectsForCrossLlmCheck is deterministic across runs", async () => {
    const entry: AnalyzerEntry = { ...validEntry };
    const a = await selectsForCrossLlmCheck(entry, 0.2);
    const b = await selectsForCrossLlmCheck(entry, 0.2);
    assertEquals(a, b);
  });

  Deno.test("rate=0 → never sampled, rate=1 → always sampled", async () => {
    assertEquals(await selectsForCrossLlmCheck(validEntry, 0), false);
    assertEquals(await selectsForCrossLlmCheck(validEntry, 1), true);
  });
  ```

- [ ] **F1.4** — Run `deno task test:unit -- confidence`. All steps green. Run `deno check`, `deno lint`, `deno fmt`.

---

## F2 — Pending review writer (`src/lifecycle/pending-review.ts`)

- [ ] **F2.1** — Create `U:\Git\CentralGauge\src\lifecycle\pending-review.ts`. **This module is the canonical writer for `pending_review` rows across Plans C, D-prompt, D-data, and F.** All writers go through `enqueue()` (defined here) so the `payload_json` shape is uniform.

  > **Canonical `pending_review.payload_json` shape (cross-plan contract).** All three writers — Plan C's `cycle analyze` step, Plan D-prompt's batch endpoint, Plan D-data's cluster-review enqueue — emit rows with this exact shape:
  >
  > ```jsonc
  > {
  >   "entry": { /* the original AnalyzerEntry: al_concept, concept_slug_proposed, description, correct_pattern, ... */ },
  >   "confidence": { /* the full ConfidenceResult: score, breakdown, sampled_for_cross_llm, above_threshold, failure_reasons */ },
  >   // Optional metadata may nest under entry._cluster, entry._batch, entry._source, etc.
  >   // The decide endpoint (F4) reads ONLY top-level entry + confidence.
  > }
  > ```
  >
  > **Top-level keys:** `entry` (required, mirrors the `AnalyzerEntry` zod schema), `confidence` (required, mirrors `ConfidenceResult`). Additional metadata MUST nest under `entry._<namespace>` (e.g., `entry._cluster.similarity` for D-data's cluster-review path). The F4 `/decide` endpoint reads `JSON.parse(pr.payload_json) as { entry, confidence }` — extra top-level keys are tolerated but ignored. Migrators / new writers MUST NOT introduce parallel top-level keys (no `pending_review_id`, no `proposal`, no `meta` siblings) — that would force F4 to branch on shape.
  >
  > **Writer registration.** Plan C imports `enqueue` from this module. Plan D-data's cluster-review path also imports `enqueue` from here. Plan D-prompt's batch endpoint depends on F2 having shipped: when F2 is on-trunk, D-prompt imports `enqueue`; when F2 has not yet shipped (D-prompt may land first per the strategic phase order), D-prompt writes inline using the same shape with a TODO marker (`// TODO(F2): replace inline insert with enqueue() once F2 lands`). Both paths converge on the same row shape so the F4 decide endpoint stays single-shape.

  ```typescript
  /**
   * Pending-review writer. Phase A's 0006_lifecycle.sql migration creates
   * the pending_review table; this module is the typed interface.
   *
   * Triggered by Phase C's analyze step when scoreEntry returns
   * above_threshold=false. Decision-time updates come from the web admin
   * /decide endpoint (F4).
   *
   * Canonical row shape: payload_json = { entry: AnalyzerEntry, confidence: ConfidenceResult }.
   * All cross-plan writers (Plan C, Plan D-prompt, Plan D-data) emit this
   * shape so the F4 /decide endpoint stays single-shape. Optional metadata
   * nests under entry._<namespace>, never as a sibling top-level key.
   *
   * @module src/lifecycle/pending-review
   */
  import type { AnalyzerEntry, ConfidenceResult } from "./confidence.ts";

  export interface PendingReviewRow {
    id: number;
    analysis_event_id: number;
    model_slug: string;
    concept_slug_proposed: string;
    payload_json: string;
    confidence: number;
    created_at: number;
    status: "pending" | "accepted" | "rejected";
    reviewer_decision_event_id: number | null;
  }

  export interface EnqueueArgs {
    analysis_event_id: number;
    model_slug: string;
    entry: AnalyzerEntry;
    confidence: ConfidenceResult;
  }

  /**
   * D1-binding shim. The CLI invokes via signed POST to
   * /api/v1/admin/lifecycle/review/enqueue (added below), the worker
   * exec-path uses this module directly with the env.DB binding.
   */
  export interface PendingReviewDb {
    prepare(sql: string): {
      bind(...p: unknown[]): {
        run(): Promise<{ meta?: { last_row_id?: number } }>;
        first<T>(): Promise<T | null>;
        all<T>(): Promise<{ results: T[] }>;
      };
    };
  }

  export async function enqueue(
    db: PendingReviewDb,
    args: EnqueueArgs,
  ): Promise<number> {
    const res = await db.prepare(
      `INSERT INTO pending_review(
         analysis_event_id, model_slug, concept_slug_proposed,
         payload_json, confidence, created_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    ).bind(
      args.analysis_event_id,
      args.model_slug,
      args.entry.conceptSlugProposed,
      JSON.stringify({
        entry: args.entry,
        confidence: args.confidence,
      }),
      args.confidence.score,
      Date.now(),
    ).run();
    if (res.meta?.last_row_id == null) {
      throw new Error("enqueue: D1 did not return last_row_id");
    }
    return res.meta.last_row_id;
  }

  export async function markDecided(
    db: PendingReviewDb,
    args: {
      id: number;
      decision: "accepted" | "rejected";
      reviewer_decision_event_id: number;
    },
  ): Promise<void> {
    await db.prepare(
      `UPDATE pending_review
          SET status = ?, reviewer_decision_event_id = ?
        WHERE id = ?`,
    ).bind(args.decision, args.reviewer_decision_event_id, args.id).run();
  }

  export async function listPending(
    db: PendingReviewDb,
    opts: { limit?: number } = {},
  ): Promise<PendingReviewRow[]> {
    const limit = opts.limit ?? 100;
    const r = await db.prepare(
      `SELECT id, analysis_event_id, model_slug, concept_slug_proposed,
              payload_json, confidence, created_at, status,
              reviewer_decision_event_id
         FROM pending_review
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?`,
    ).bind(limit).all<PendingReviewRow>();
    return r.results;
  }
  ```

- [ ] **F2.2** — Wire into Phase C's analyze step. Open the file Phase C creates (`src/lifecycle/orchestrator.ts` per the strategic plan). Inside the analyze step's per-entry loop, after computing confidence, branch:

  ```typescript
  for (const entry of analyzerOutput.entries) {
    const conf = await scoreEntry(entry, confidenceCtx);
    if (conf.above_threshold) {
      await publishToBatch(entry);
    } else {
      await enqueue(db, {
        analysis_event_id: analysisEventId,
        model_slug: cycleArgs.model_slug,
        entry,
        confidence: conf,
      });
      log.info(`[review-queue] enqueued '${entry.conceptSlugProposed}' (score=${conf.score.toFixed(3)})`);
    }
  }
  ```

- [ ] **F2.3** — Tests in `tests/unit/lifecycle/pending-review.test.ts` exercise enqueue + listPending + markDecided against a `MockEnv`-style in-memory shim or the project's existing `test-helpers.ts` D1 mock pattern.

---

## F3 — `/api/v1/admin/lifecycle/review/queue` endpoint (GET)

- [ ] **F3.1** — First land the auth middleware that backs F3 + F4. Create `U:\Git\CentralGauge\site\src\lib\server\cf-access.ts`:

  ```typescript
  import { ApiError } from './errors';

  /**
   * Cloudflare Access JWT verifier.
   *
   * Strategy: cache the JWKs in module memory for 10 minutes (CF rotates
   * keys on a 24h cadence; a 10-min cache is well-conservative). On every
   * admin request we extract the CF-Access-Jwt-Assertion header, verify the
   * signature against the cached JWKs, and check audience.
   *
   * Fail closed: any verification failure throws ApiError(401), caught by
   * the calling endpoint's errorResponse wrapper.
   */
  export interface CfAccessUser {
    email: string;
    sub: string;  // CF Access user id
  }

  interface JwksCacheEntry {
    fetchedAt: number;
    keys: JsonWebKey[];
  }

  let jwksCache: JwksCacheEntry | null = null;
  const JWKS_TTL_MS = 10 * 60 * 1000;

  async function fetchJwks(teamDomain: string): Promise<JsonWebKey[]> {
    if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
      return jwksCache.keys;
    }
    const url = `https://${teamDomain}/cdn-cgi/access/certs`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new ApiError(503, 'cf_access_jwks_unreachable',
        `cf access JWKs fetch ${resp.status}`);
    }
    const body = await resp.json() as { keys: JsonWebKey[] };
    jwksCache = { fetchedAt: Date.now(), keys: body.keys };
    return body.keys;
  }

  function b64UrlDecode(s: string): Uint8Array {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * Verify a CF Access JWT. Throws ApiError(401) on any failure.
   *
   * Required env vars:
   *   - CF_ACCESS_AUD: the audience tag from the CF Access application
   *   - CF_ACCESS_TEAM_DOMAIN: e.g. 'centralgauge.cloudflareaccess.com'
   */
  export async function verifyCfAccessJwt(
    request: Request,
    env: { CF_ACCESS_AUD?: string; CF_ACCESS_TEAM_DOMAIN?: string },
  ): Promise<CfAccessUser> {
    if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) {
      throw new ApiError(500, 'cf_access_misconfigured',
        'CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN must be set');
    }
    const jwt = request.headers.get('cf-access-jwt-assertion');
    if (!jwt) throw new ApiError(401, 'cf_access_missing', 'no CF Access JWT');

    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new ApiError(401, 'cf_access_malformed', 'JWT must have 3 parts');
    }
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    const header = JSON.parse(new TextDecoder().decode(b64UrlDecode(headerB64))) as {
      alg: string; kid: string;
    };
    if (header.alg !== 'RS256') {
      throw new ApiError(401, 'cf_access_bad_alg', `alg=${header.alg}`);
    }

    const keys = await fetchJwks(env.CF_ACCESS_TEAM_DOMAIN);
    const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) throw new ApiError(401, 'cf_access_unknown_kid', `kid=${header.kid}`);

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify'],
    );

    const sig = b64UrlDecode(sigB64);
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!ok) throw new ApiError(401, 'cf_access_bad_sig', 'signature failed');

    const claims = JSON.parse(new TextDecoder().decode(b64UrlDecode(payloadB64))) as {
      aud?: string | string[];
      email?: string;
      sub?: string;
      exp?: number;
    };
    const auds = Array.isArray(claims.aud) ? claims.aud : (claims.aud ? [claims.aud] : []);
    if (!auds.includes(env.CF_ACCESS_AUD)) {
      throw new ApiError(401, 'cf_access_bad_aud',
        `expected aud=${env.CF_ACCESS_AUD}, got ${JSON.stringify(auds)}`);
    }
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      throw new ApiError(401, 'cf_access_expired', 'JWT exp passed');
    }
    if (!claims.email || !claims.sub) {
      throw new ApiError(401, 'cf_access_missing_claims', 'email and sub required');
    }

    return { email: claims.email, sub: claims.sub };
  }

  /**
   * Admin auth: try CF Access first (browser path), fall back to Ed25519
   * admin signature (CLI path). Fail closed if neither succeeds.
   *
   * The strategic plan rationale: two identities with separate revocation
   * paths. The CLI never sets CF Access JWTs; the browser never has the
   * Ed25519 private key. They must not be conflated.
   *
   * **Canonical return-discriminant** (used across all retro-patched
   * endpoints in F5.5):
   *   - 'cf-access' → CF Access JWT verified; `email` is the GitHub OAuth
   *     identity. actor_id derives as cfAccessUser.email.
   *   - 'admin-sig' → Ed25519 signature verified; `key_id` is the row id
   *     in machine_keys. actor_id derives as `key:${key_id}`.
   *   - 'unauthenticated' is NOT returned; the function throws
   *     ApiError(401) instead so callers do not need to branch on a
   *     null-like state. Endpoints rely on this throw-on-fail contract.
   */
  export type AdminAuthResult =
    | { kind: 'cf-access'; email: string; sub: string }
    | { kind: 'admin-sig'; key_id: number; key_fingerprint: string };

  export async function authenticateAdminRequest(
    request: Request,
    env: { CF_ACCESS_AUD?: string; CF_ACCESS_TEAM_DOMAIN?: string; DB: D1Database },
    signedBody: { signature?: unknown } | null,
  ): Promise<AdminAuthResult> {
    // Path 1: CF Access JWT.
    if (request.headers.get('cf-access-jwt-assertion')) {
      const user = await verifyCfAccessJwt(request, env);
      return { kind: 'cf-access', email: user.email, sub: user.sub };
    }
    // Path 2: Ed25519 admin signature.
    if (signedBody?.signature) {
      const { verifySignedRequest } = await import('./signature');
      const verified = await verifySignedRequest(
        env.DB,
        signedBody as Parameters<typeof verifySignedRequest>[1],
        'admin',
      );
      return {
        kind: 'admin-sig',
        key_id: verified.key_id,
        key_fingerprint: `key:${verified.key_id}`,
      };
    }
    throw new ApiError(401, 'unauthenticated',
      'CF Access JWT or admin Ed25519 signature required');
  }
  ```

- [ ] **F3.2** — Update `site/wrangler.toml` to commit only the non-secret `CF_ACCESS_TEAM_DOMAIN`. **`CF_ACCESS_AUD` is a `wrangler secret put` value — NOT a `[vars]` entry.** Wrangler vars are baked into the deployed bundle and visible to anyone with read access to the Worker; secrets are encrypted at rest and read at runtime. The audience tag is operator-environment-specific (different per CF Access app) and rotates when the app is reconfigured, so it belongs in `wrangler secret put`:

  ```toml
  # site/wrangler.toml — append to [vars] block:
  [vars]
  CF_ACCESS_TEAM_DOMAIN = "centralgauge.cloudflareaccess.com"
  # CF_ACCESS_AUD is a SECRET, not a var. Set per-environment via:
  #   wrangler secret put CF_ACCESS_AUD
  # See F5.1 runbook.
  ```

  **Do NOT** add `CF_ACCESS_AUD = ""` under `[vars]`. The empty string would be deployed and shadow the secret at runtime (vars and secrets share the same `env.*` namespace; the resolution order is implementation-defined). Verify post-deploy with `wrangler secret list` showing `CF_ACCESS_AUD` and `wrangler deploy --dry-run` not echoing it back.

- [ ] **F3.3** — Create the queue endpoint at `U:\Git\CentralGauge\site\src\routes\api\v1\admin\lifecycle\review\queue\+server.ts`:

  ```typescript
  import type { RequestHandler } from './$types';
  import { authenticateAdminRequest } from '$lib/server/cf-access';
  import { jsonResponse, errorResponse, ApiError } from '$lib/server/errors';
  import { getAll } from '$lib/server/db';

  interface QueueRow {
    id: number;
    analysis_event_id: number;
    model_slug: string;
    concept_slug_proposed: string;
    payload_json: string;
    confidence: number;
    created_at: number;
    debug_session_id: string | null;
    r2_key: string | null;
    analyzer_model: string | null;
  }

  export const GET: RequestHandler = async ({ request, platform }) => {
    if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
    const env = platform.env;
    try {
      // CF Access path only — no body, no signature.
      await authenticateAdminRequest(request, env, null);

      const rows = await getAll<QueueRow>(
        env.DB,
        `SELECT pr.id,
                pr.analysis_event_id,
                pr.model_slug,
                pr.concept_slug_proposed,
                pr.payload_json,
                pr.confidence,
                pr.created_at,
                json_extract(dbg.payload_json, '$.session_id') AS debug_session_id,
                json_extract(dbg.payload_json, '$.r2_key')     AS r2_key,
                json_extract(le.payload_json, '$.analyzer_model') AS analyzer_model
           FROM pending_review pr
           JOIN lifecycle_events le ON le.id = pr.analysis_event_id
      LEFT JOIN lifecycle_events dbg
                  ON dbg.model_slug = pr.model_slug
                 AND dbg.task_set_hash = le.task_set_hash
                 AND dbg.event_type = 'debug.captured'
                 AND dbg.id < le.id
          WHERE pr.status = 'pending'
          ORDER BY pr.created_at ASC
          LIMIT 200`,
        [],
      );

      return jsonResponse({
        entries: rows.map((r) => ({
          id: r.id,
          analysis_event_id: r.analysis_event_id,
          model_slug: r.model_slug,
          concept_slug_proposed: r.concept_slug_proposed,
          payload: JSON.parse(r.payload_json),
          confidence: r.confidence,
          created_at: r.created_at,
          debug_session_id: r.debug_session_id,
          r2_key: r.r2_key,
          analyzer_model: r.analyzer_model,
        })),
        count: rows.length,
      }, 200);
    } catch (err) {
      return errorResponse(err);
    }
  };
  ```

---

## F4 — `/api/v1/admin/lifecycle/review/<id>/decide` endpoint (POST)

- [ ] **F4.1** — Create `U:\Git\CentralGauge\site\src\routes\api\v1\admin\lifecycle\review\[id]\decide\+server.ts`:

  ```typescript
  import type { RequestHandler } from './$types';
  import { authenticateAdminRequest } from '$lib/server/cf-access';
  import { jsonResponse, errorResponse, ApiError } from '$lib/server/errors';
  import { getFirst, runBatch } from '$lib/server/db';

  interface DecideBody {
    decision: 'accept' | 'reject';
    reason?: string;
    /** Optional: when posted from the CLI path. CF Access path has no body wrapping. */
    signature?: unknown;
    payload?: unknown;
    version?: number;
  }

  export const POST: RequestHandler = async ({ request, params, platform }) => {
    if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
    const env = platform.env;
    const id = +(params.id ?? 0);
    if (!id) return errorResponse(new ApiError(400, 'bad_id', 'numeric id required'));

    try {
      const body = (await request.json()) as DecideBody;

      // Decision content lives at body root for CF Access path; under
      // body.payload for CLI signed path. Resolve both.
      const isCli = !!body.signature;
      const decisionBody = isCli ? (body.payload as DecideBody) : body;

      const auth = await authenticateAdminRequest(
        request,
        env,
        isCli ? body : null,
      );
      // actor_id derivation is fixed by the authenticateAdminRequest contract:
      //   - 'cf-access' path  → auth.email          (e.g. 'op@example.com')
      //   - 'admin-sig' path  → auth.key_fingerprint = 'key:' + key_id (e.g. 'key:42')
      // This is what lands in lifecycle_events.actor_id for the
      // analysis.accepted / analysis.rejected events emitted by this endpoint.
      // Strategic appendix payload schema for these events:
      //   { pending_review_id, reviewer, reason? }
      // We satisfy `reviewer = actorId` below; reason is required for reject,
      // optional for accept.
      const actorId = auth.kind === 'cf-access' ? auth.email : auth.key_fingerprint;

      const decision = decisionBody.decision;
      if (decision !== 'accept' && decision !== 'reject') {
        throw new ApiError(400, 'bad_decision', 'decision must be accept|reject');
      }
      if (decision === 'reject' && !decisionBody.reason) {
        throw new ApiError(400, 'reason_required', 'reject requires reason');
      }

      const pr = await getFirst<{
        analysis_event_id: number;
        model_slug: string;
        payload_json: string;
        status: string;
      }>(
        env.DB,
        `SELECT analysis_event_id, model_slug, payload_json, status
           FROM pending_review WHERE id = ?`,
        [id],
      );
      if (!pr) throw new ApiError(404, 'not_found', `pending_review ${id} not found`);
      if (pr.status !== 'pending') {
        throw new ApiError(409, 'already_decided', `status=${pr.status}`);
      }

      const analysisEvent = await getFirst<{ task_set_hash: string }>(
        env.DB,
        `SELECT task_set_hash FROM lifecycle_events WHERE id = ?`,
        [pr.analysis_event_id],
      );
      if (!analysisEvent) {
        throw new ApiError(500, 'orphan_review', `analysis_event_id missing`);
      }

      const eventType = decision === 'accept' ? 'analysis.accepted' : 'analysis.rejected';
      const eventPayload = {
        pending_review_id: id,
        reviewer: actorId,
        reason: decisionBody.reason ?? null,
      };

      // Two-step batch — same canonical recovery pattern Plan D-data uses.
      //
      // D1 does NOT support RETURNING in mid-batch statements (the
      // last_row_id from a batched INSERT is not exposed to subsequent
      // statements in the same batch). Workaround: (1) batch #1 inserts the
      // lifecycle_events row only, (2) read it back via a deterministic
      // SELECT (ts + event_type + model_slug → unique tuple here because we
      // synthesise a fresh ts per request), (3) batch #2 does the
      // pending_review update + shortcomings insert keyed to the resolved
      // event id. This mirrors Plan D-data's narrative for cluster-review
      // commits — see D-data plan "Two-step batch for D1 RETURNING gap"
      // section. If Plan A later adds a `appendEventReturning` helper that
      // exposes the inserted id (e.g., via a worker-side SELECT after the
      // INSERT in the same module), simplify this to one batch.
      const ts = Date.now();
      const stmts = [
        {
          sql: `INSERT INTO lifecycle_events(
                  ts, model_slug, task_set_hash, event_type,
                  payload_json, actor, actor_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params: [
            ts, pr.model_slug, analysisEvent.task_set_hash, eventType,
            JSON.stringify(eventPayload),
            'reviewer', actorId,
          ],
        },
      ];
      await runBatch(env.DB, stmts as never);

      const insertedEvent = await getFirst<{ id: number }>(
        env.DB,
        `SELECT id FROM lifecycle_events
          WHERE ts = ? AND event_type = ? AND model_slug = ?
          ORDER BY id DESC LIMIT 1`,
        [ts, eventType, pr.model_slug],
      );
      if (!insertedEvent) {
        throw new ApiError(500, 'event_lost', 'could not read back inserted event id');
      }

      // Second batch: pending_review update + (on accept) shortcomings insert.
      const followUp = [
        {
          sql: `UPDATE pending_review
                   SET status = ?, reviewer_decision_event_id = ?
                 WHERE id = ?`,
          params: [
            decision === 'accept' ? 'accepted' : 'rejected',
            insertedEvent.id,
            id,
          ],
        },
      ];
      if (decision === 'accept') {
        const reviewBody = JSON.parse(pr.payload_json) as {
          entry: { al_concept: string; concept_slug_proposed: string; description: string;
                   correct_pattern: string; incorrect_pattern?: string; error_codes?: string[] };
          confidence: { score: number };
        };
        // Resolve concept_id (Phase D guarantees the slug exists in concepts
        // for any analyzer-proposed entry — clustering happens before
        // pending_review enqueue).
        const concept = await getFirst<{ id: number }>(
          env.DB,
          `SELECT id FROM concepts WHERE slug = ? AND superseded_by IS NULL`,
          [reviewBody.entry.conceptSlugProposed],
        );
        if (!concept) {
          throw new ApiError(409, 'concept_missing',
            `concept ${reviewBody.entry.conceptSlugProposed} not in registry`);
        }
        followUp.push({
          sql: `INSERT INTO shortcomings(
                  model_id, concept_id, concept, al_concept, description,
                  correct_pattern, error_codes_json,
                  analysis_event_id, published_event_id, confidence,
                  first_seen, last_seen
                )
                SELECT m.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                  FROM models m WHERE m.slug = ?`,
          params: [
            concept.id,
            reviewBody.entry.conceptSlugProposed,
            reviewBody.entry.alConcept,
            reviewBody.entry.description,
            reviewBody.entry.correctPattern,
            JSON.stringify(reviewBody.entry.errorCodes ?? []),
            pr.analysis_event_id,
            insertedEvent.id,
            reviewBody.confidence.score,
            ts, ts,
            pr.model_slug,
          ],
        });
      }
      await runBatch(env.DB, followUp as never);

      return jsonResponse({
        ok: true,
        decision,
        event_id: insertedEvent.id,
        actor_id: actorId,
      }, 200);
    } catch (err) {
      return errorResponse(err);
    }
  };
  ```

- [ ] **F4.2** — Tests in `site/tests/api/lifecycle-review-decide.test.ts`:

  ```typescript
  import { env, applyD1Migrations, SELF } from 'cloudflare:test';
  import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
  import { createSignedPayload } from '../fixtures/keys';
  import { registerMachineKey } from '../fixtures/ingest-helpers';
  import { resetDb } from '../utils/reset-db';

  beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
  beforeEach(async () => { await resetDb(); });

  describe('POST /api/v1/admin/lifecycle/review/:id/decide', () => {
    it('rejects unauthenticated requests (no CF Access, no signature)', async () => {
      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/review/1/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'accept' }),
      });
      expect(r.status).toBe(401);
    });

    it('rejects malformed CF Access JWT (signature mismatch)', async () => {
      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/review/1/decide', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-access-jwt-assertion': 'eyJhbGciOiJSUzI1NiJ9.bogus.bogus',
        },
        body: JSON.stringify({ decision: 'accept' }),
      });
      expect(r.status).toBe(401);
    });

    it('accepts via CLI signature path → writes analysis.accepted + shortcomings row', async () => {
      // Seed: model + family, concepts row, lifecycle_events row for analysis.completed,
      // pending_review row, machine key with admin scope.
      // ... setup omitted; mirror catalog-admin.test.ts pattern ...

      const { keyId, keypair } = await registerMachineKey('admin', 'admin');
      const { signedRequest } = await createSignedPayload({
        decision: 'accept',
      }, keyId, undefined, keypair);

      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/review/1/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedRequest),
      });
      expect(r.status).toBe(200);

      const ev = await env.DB.prepare(
        `SELECT event_type, actor_id FROM lifecycle_events WHERE event_type = 'analysis.accepted'`
      ).first<{ event_type: string; actor_id: string }>();
      expect(ev?.event_type).toBe('analysis.accepted');
      // CLI path → actor_id = 'key:' + key_id (per authenticateAdminRequest contract)
      expect(ev?.actor_id).toMatch(/^key:\d+$/);

      const sc = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM shortcomings`
      ).first<{ n: number }>();
      expect(sc?.n).toBe(1);
    });

    it('reject without reason returns 400', async () => {
      const { keyId, keypair } = await registerMachineKey('admin', 'admin');
      const { signedRequest } = await createSignedPayload(
        { decision: 'reject' }, keyId, undefined, keypair,
      );
      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/review/1/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedRequest),
      });
      expect(r.status).toBe(400);
    });
  });
  ```

---

## F5 — Cloudflare Access setup

- [ ] **F5.1** — Document the operator runbook in `docs/site/operations.md` under a new "Admin lifecycle UI access" section:

  ```markdown
  ## Admin lifecycle UI access (Cloudflare Access)

  The `/admin/lifecycle/*` paths are gated by Cloudflare Access with GitHub
  OAuth as the identity provider. Browser access never sees the Ed25519
  admin key; the key remains a CLI-only credential.

  ### One-time setup (operator)

  1. Cloudflare dashboard → Zero Trust → Access → Applications → Add an
     application → Self-hosted.
  2. **Application name**: `CentralGauge Admin Lifecycle`
  3. **Session duration**: 24 hours
  4. **Application domain**: `centralgauge.sshadows.workers.dev`
     **Path**: `/admin/lifecycle/*` (and add `/api/v1/admin/lifecycle/*`
     as a second path entry)
  5. **Identity providers**: GitHub OAuth (configure under Settings →
     Authentication if not already present).
  6. **Policies**: add a policy `Operators` with rule
     `Emails → operator@example.com,...`. Add additional reviewer emails
     as needed.
  7. Save. Note the **Application Audience (AUD) Tag** — copy it for
     the next step.
  8. From a shell with `wrangler` and `CLOUDFLARE_API_TOKEN` configured:
     ```bash
     wrangler secret put CF_ACCESS_AUD
     # paste the AUD tag when prompted
     ```
  9. Verify: `curl https://centralgauge.sshadows.workers.dev/admin/lifecycle`
     should redirect to a CF Access login page in a fresh incognito window.

  ### Revoking access

  Cloudflare dashboard → Access → Applications → CentralGauge Admin
  Lifecycle → Policies → remove the email. Active sessions invalidate
  on the next request.
  ```

- [ ] **F5.5** — **Retro-patch all existing admin lifecycle endpoints to call `authenticateAdminRequest`**, replacing direct `verifySignedRequest` calls. F's commit explicitly bundles these patches so no admin endpoint slips through using the old single-path auth. This is a cross-plan retro-patch: the endpoints below are owned by Plans A, D-data, and F itself, but auth wiring is centralised here:

  | File | Owner plan | Current auth | Patch |
  | --- | --- | --- | --- |
  | `site/src/routes/api/v1/admin/lifecycle/events/+server.ts` | Plan A | `verifySignedRequest(env.DB, body, 'admin')` | `authenticateAdminRequest(request, env, body)` — POST is signed (CLI); GET may be CF-Access-only |
  | `site/src/routes/api/v1/admin/lifecycle/state/+server.ts` | Plan A | `verifySignedRequest` (read endpoint, signed today) | `authenticateAdminRequest(request, env, null)` — accept either CF Access JWT or Ed25519 |
  | `site/src/routes/api/v1/admin/lifecycle/r2/[...key]/+server.ts` | Plan A | `verifySignedRequest` for PUT; signed for GET | `authenticateAdminRequest` for both methods. PUT requires the body's `signature` field (CLI ingest); GET accepts CF Access (browser proxy) OR signature (CLI replay). |
  | `site/src/routes/api/v1/admin/lifecycle/clusters/+server.ts` | Plan D-data | `verifySignedRequest` | `authenticateAdminRequest` (browser cluster review UI lives at `/admin/lifecycle/clusters`) |
  | `site/src/routes/api/v1/admin/lifecycle/clusters/[id]/decide/+server.ts` | Plan D-data | `verifySignedRequest` | `authenticateAdminRequest` (operator clicks Accept/Reject in browser) |
  | `site/src/routes/api/v1/admin/lifecycle/review/queue/+server.ts` | Plan F (this plan) | (new in F3.3) | `authenticateAdminRequest(request, env, null)` |
  | `site/src/routes/api/v1/admin/lifecycle/review/[id]/decide/+server.ts` | Plan F (this plan) | (new in F4.1) | `authenticateAdminRequest(request, env, isCli ? body : null)` |
  | `site/src/routes/api/v1/admin/lifecycle/debug/[...key]/+server.ts` | Plan F (this plan) | (new in F6.5.3) | `authenticateAdminRequest(request, env, null)` |
  | `site/src/routes/api/v1/admin/lifecycle/debug-bundle-exists/+server.ts` | Plan E | (new in E4.5) | `authenticateAdminRequest(request, env, null)` — browser loader for family page calls this |
  | `site/src/routes/api/v1/admin/lifecycle/reanalyze/+server.ts` | Plan E (re-analyze CTA target, if implemented) | n/a | `authenticateAdminRequest(request, env, isCli ? body : null)` |

  **Patch shape (apply identically to each file):**

  ```typescript
  // Before:
  import { verifySignedRequest } from '$lib/server/signature';
  // ... inside POST handler:
  const verified = await verifySignedRequest(env.DB, body, 'admin');

  // After:
  import { authenticateAdminRequest } from '$lib/server/cf-access';
  // ... inside handler:
  const auth = await authenticateAdminRequest(request, env, signedBody);
  // auth.kind === 'cf' | 'cli'; downstream uses the unified actorId.
  ```

  For GET endpoints that previously used `verifySignedRequest` against the URL: drop the signature-on-URL path and pass `null` as the third arg — CF Access JWT in the browser is the primary path, and any CLI consumer can switch to a body-signed POST mirror if needed.

  **Test acceptance:** every patched endpoint gets the same triple from F8.4 — (1) no auth → 401, (2) valid CF Access JWT → 200, (3) valid Ed25519 signature with admin scope → 200. Add tests under `site/tests/api/lifecycle-{events,state,r2,clusters,clusters-decide,review-queue,review-decide,debug,debug-bundle-exists,reanalyze}-auth.test.ts` (or extend the per-endpoint test files where they already exist).

- [ ] **F5.2** — Update `wrangler.toml` with the secret reference and confirm `CF_ACCESS_TEAM_DOMAIN` is committed (non-secret).

- [ ] **F5.3** — Tests in `site/tests/server/cf-access.test.ts` for the JWT verifier (use a synthesised RSA keypair to avoid hitting real CF Access JWKs):

  ```typescript
  import { describe, expect, it, beforeAll } from 'vitest';
  import { verifyCfAccessJwt } from '../../src/lib/server/cf-access';

  // Spin up a stub fetch that returns our test JWK as the "CF Access JWKs"
  // endpoint, sign a JWT with the matching private key, then verify.
  // (full body left to the contributor — pattern matches existing
  // ed25519.test.ts approach in the repo)

  describe('verifyCfAccessJwt', () => {
    it('rejects when CF_ACCESS_AUD is unset', async () => {
      const req = new Request('https://x/admin/lifecycle/review', {
        headers: { 'cf-access-jwt-assertion': 'a.b.c' },
      });
      await expect(
        verifyCfAccessJwt(req, { CF_ACCESS_TEAM_DOMAIN: 't.c.com' }),
      ).rejects.toThrow(/cf_access_misconfigured/);
    });

    it('rejects when JWT header is missing', async () => {
      const req = new Request('https://x/admin/lifecycle/review');
      await expect(
        verifyCfAccessJwt(req, {
          CF_ACCESS_AUD: 'aud',
          CF_ACCESS_TEAM_DOMAIN: 't.c.com',
        }),
      ).rejects.toThrow(/cf_access_missing/);
    });

    it('rejects malformed JWT (not 3 parts)', async () => {
      const req = new Request('https://x/admin/lifecycle/review', {
        headers: { 'cf-access-jwt-assertion': 'a.b' },
      });
      await expect(
        verifyCfAccessJwt(req, {
          CF_ACCESS_AUD: 'aud',
          CF_ACCESS_TEAM_DOMAIN: 't.c.com',
        }),
      ).rejects.toThrow(/cf_access_malformed/);
    });

    it('rejects bad audience even with valid signature', async () => {
      // generate keypair, sign JWT with aud='wrong', stub global fetch to
      // return the JWK, expect 'cf_access_bad_aud'
    });
  });
  ```

---

## F6 — Web admin page skeleton at `/admin/lifecycle`

- [ ] **F6.1** — Create the admin layout `U:\Git\CentralGauge\site\src\routes\admin\lifecycle\+layout.svelte`:

  ```svelte
  <script lang="ts">
    import { page } from '$app/state';
    import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
    let { children } = $props();

    const navItems = [
      { href: '/admin/lifecycle', label: 'Overview' },
      { href: '/admin/lifecycle/review', label: 'Review queue' },
      { href: '/admin/lifecycle/status', label: 'Status matrix' },
      { href: '/admin/lifecycle/events', label: 'Event log' },
    ];
  </script>

  <Breadcrumbs crumbs={[
    { label: 'Home', href: '/' },
    { label: 'Admin', href: '/admin' },
    { label: 'Lifecycle' },
  ]} />

  <header class="admin-head">
    <h1>Lifecycle admin</h1>
    <p class="meta text-muted">
      Authenticated via Cloudflare Access. CLI uses the Ed25519 admin key.
    </p>
  </header>

  <nav class="admin-nav" aria-label="Admin sections">
    <ul>
      {#each navItems as item (item.href)}
        <li>
          <a
            href={item.href}
            aria-current={page.url.pathname === item.href ? 'page' : undefined}
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <main class="admin-main">
    {@render children()}
  </main>

  <style>
    .admin-head { padding: var(--space-6) 0 var(--space-4) 0; }
    .admin-head h1 { font-size: var(--text-3xl); margin: 0; }
    .meta { font-size: var(--text-sm); margin-top: var(--space-2); }
    .admin-nav ul {
      display: flex; gap: var(--space-3);
      list-style: none; padding: 0; margin: 0 0 var(--space-5) 0;
      border-bottom: 1px solid var(--border);
    }
    .admin-nav a {
      display: inline-block; padding: var(--space-3) var(--space-4);
      color: var(--text-muted); text-decoration: none;
      border-bottom: 2px solid transparent;
    }
    .admin-nav a[aria-current='page'] {
      color: var(--text); border-bottom-color: var(--accent);
    }
  </style>
  ```

- [ ] **F6.2** — Add an Overview index page `site/src/routes/admin/lifecycle/+page.svelte`:

  ```svelte
  <script lang="ts">
    interface SummaryData {
      pending_count: number;
      models_total: number;
      models_with_pending: number;
      latest_event_ts: number | null;
    }
    let { data } = $props<{ data: SummaryData }>();
  </script>

  <svelte:head><title>Lifecycle admin — CentralGauge</title></svelte:head>

  <section class="cards">
    <div class="card">
      <div class="card-label">Pending review</div>
      <div class="card-value">{data.pending_count}</div>
      <a href="/admin/lifecycle/review">Open queue →</a>
    </div>
    <div class="card">
      <div class="card-label">Models tracked</div>
      <div class="card-value">{data.models_total}</div>
      <a href="/admin/lifecycle/status">Open matrix →</a>
    </div>
    <div class="card">
      <div class="card-label">Models with pending</div>
      <div class="card-value">{data.models_with_pending}</div>
    </div>
  </section>

  <style>
    .cards {
      display: grid; gap: var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-2);
      padding: var(--space-5);
    }
    .card-label { font-size: var(--text-sm); color: var(--text-muted); }
    .card-value { font-size: var(--text-3xl); font-weight: var(--weight-medium); margin: var(--space-2) 0; }
  </style>
  ```

- [ ] **F6.3** — Server loader `site/src/routes/admin/lifecycle/+page.server.ts`:

  ```typescript
  import type { PageServerLoad } from './$types';
  import { getFirst } from '$lib/server/db';

  export const load: PageServerLoad = async ({ platform }) => {
    if (!platform) throw new Error('no platform');
    const env = platform.env;
    const pending = await getFirst<{ n: number }>(
      env.DB,
      `SELECT COUNT(*) AS n FROM pending_review WHERE status = 'pending'`,
      [],
    );
    const total = await getFirst<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM models`, []);
    const withPending = await getFirst<{ n: number }>(
      env.DB,
      `SELECT COUNT(DISTINCT model_slug) AS n FROM pending_review WHERE status = 'pending'`,
      [],
    );
    const latest = await getFirst<{ ts: number }>(
      env.DB,
      `SELECT MAX(ts) AS ts FROM lifecycle_events`,
      [],
    );
    return {
      pending_count: pending?.n ?? 0,
      models_total: total?.n ?? 0,
      models_with_pending: withPending?.n ?? 0,
      latest_event_ts: latest?.ts ?? null,
    };
  };
  ```

---

## F6.5 — Review UI at `/admin/lifecycle/review`

- [ ] **F6.5.1** — Server loader `site/src/routes/admin/lifecycle/review/+page.server.ts`:

  ```typescript
  import type { PageServerLoad } from './$types';

  export const load: PageServerLoad = async ({ fetch }) => {
    const r = await fetch('/api/v1/admin/lifecycle/review/queue');
    if (!r.ok) throw new Error(`queue fetch ${r.status}`);
    return await r.json() as { entries: ReviewEntry[]; count: number };
  };

  export interface ReviewEntry {
    id: number;
    analysis_event_id: number;
    model_slug: string;
    concept_slug_proposed: string;
    payload: {
      entry: {
        al_concept: string;
        concept_slug_proposed: string;
        description: string;
        correct_pattern: string;
        incorrect_pattern?: string;
        error_codes?: string[];
        rationale?: string;
      };
      confidence: {
        score: number;
        breakdown: {
          schema_validity: number;
          concept_cluster_consistency: number;
          cross_llm_agreement: number | null;
        };
        failure_reasons: string[];
      };
    };
    confidence: number;
    created_at: number;
    debug_session_id: string | null;
    r2_key: string | null;
    analyzer_model: string | null;
  }
  ```

- [ ] **F6.5.2** — Page `site/src/routes/admin/lifecycle/review/+page.svelte`:

  ```svelte
  <script lang="ts">
    import { invalidateAll } from '$app/navigation';
    import MarkdownRenderer from '$lib/components/domain/MarkdownRenderer.svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import type { ReviewEntry } from './+page.server';

    let { data } = $props<{ data: { entries: ReviewEntry[]; count: number } }>();

    let selectedId = $state<number | null>(null);
    const selected = $derived(
      data.entries.find((e) => e.id === selectedId) ?? null,
    );

    let debugExcerpt = $state<string>('');
    let debugLoading = $state(false);
    let rejectReason = $state('');
    let submitting = $state(false);
    let error = $state('');

    $effect(() => {
      if (!selected || !selected.r2_key) {
        debugExcerpt = '';
        return;
      }
      debugLoading = true;
      const ctrl = new AbortController();
      fetch(
        `/api/v1/admin/lifecycle/debug/${encodeURIComponent(selected.r2_key)}`,
        { signal: ctrl.signal },
      )
        .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((t) => { debugExcerpt = t; })
        .catch((e) => {
          if (e?.name !== 'AbortError') debugExcerpt = `Failed to load: ${e.message}`;
        })
        .finally(() => { debugLoading = false; });
      return () => ctrl.abort();
    });

    async function decide(decision: 'accept' | 'reject') {
      if (!selected) return;
      if (decision === 'reject' && rejectReason.trim().length === 0) {
        error = 'Reject requires a reason';
        return;
      }
      submitting = true;
      error = '';
      try {
        const r = await fetch(
          `/api/v1/admin/lifecycle/review/${selected.id}/decide`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              decision,
              reason: decision === 'reject' ? rejectReason.trim() : undefined,
            }),
          },
        );
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
        }
        rejectReason = '';
        selectedId = null;
        await invalidateAll();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        submitting = false;
      }
    }
  </script>

  <svelte:head><title>Review queue — Lifecycle — CentralGauge</title></svelte:head>

  <div class="layout">
    <aside class="queue">
      <h2>Pending ({data.count})</h2>
      {#if data.entries.length === 0}
        <p class="text-muted">No entries pending review.</p>
      {:else}
        <ul>
          {#each data.entries as e (e.id)}
            <li>
              <button
                type="button"
                class:selected={e.id === selectedId}
                onclick={() => { selectedId = e.id; }}
              >
                <span class="row-model">{e.model_slug}</span>
                <span class="row-concept">{e.concept_slug_proposed}</span>
                <span class="row-score">{e.confidence.toFixed(2)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <section class="detail">
      {#if !selected}
        <p class="text-muted">Select an entry from the queue.</p>
      {:else}
        <header>
          <h2>{selected.payload.entry.alConcept}</h2>
          <p class="text-muted">
            Model: <code>{selected.model_slug}</code> ·
            Analyzer: <code>{selected.analyzer_model ?? 'unknown'}</code> ·
            Confidence: <strong>{selected.confidence.toFixed(3)}</strong>
          </p>
          <ul class="reasons">
            {#each selected.payload.confidence.failure_reasons as r (r)}
              <li><code>{r}</code></li>
            {/each}
          </ul>
        </header>

        <div class="panes">
          <article class="pane pane-debug">
            <h3>Raw debug excerpt</h3>
            {#if debugLoading}
              <p class="text-muted">Loading…</p>
            {:else if !selected.r2_key}
              <p class="text-muted">Debug bundle not in R2 (older session).</p>
            {:else}
              <pre class="debug">{numberLines(debugExcerpt)}</pre>
            {/if}
          </article>

          <article class="pane pane-rationale">
            <h3>Analyzer rationale</h3>
            <p>{selected.payload.entry.description}</p>
            {#if selected.payload.entry.rationale}
              <MarkdownRenderer source={selected.payload.entry.rationale} />
            {/if}

            <h4>Correct pattern</h4>
            <pre class="code">{selected.payload.entry.correctPattern}</pre>

            {#if selected.payload.entry.incorrectPattern}
              <h4>Incorrect pattern</h4>
              <pre class="code">{selected.payload.entry.incorrectPattern}</pre>
            {/if}

            {#if selected.payload.entry.errorCodes?.length}
              <h4>Error codes</h4>
              <ul class="codes">
                {#each selected.payload.entry.errorCodes as c (c)}<li><code>{c}</code></li>{/each}
              </ul>
            {/if}
          </article>
        </div>

        <footer class="actions">
          <Button onclick={() => decide('accept')} disabled={submitting}>Accept</Button>
          <label class="reject">
            Reject reason:
            <input
              type="text"
              bind:value={rejectReason}
              disabled={submitting}
              placeholder="Why is this a hallucination?"
            />
          </label>
          <Button
            onclick={() => decide('reject')}
            disabled={submitting || rejectReason.trim().length === 0}
            variant="danger"
          >
            Reject
          </Button>
          {#if error}<p class="error" role="alert">{error}</p>{/if}
        </footer>
      {/if}
    </section>
  </div>

  <script context="module" lang="ts">
    function numberLines(s: string): string {
      return s.split('\n').map((line, i) =>
        `${String(i + 1).padStart(4, ' ')} | ${line}`
      ).join('\n');
    }
  </script>

  <style>
    .layout { display: grid; grid-template-columns: 320px 1fr; gap: var(--space-5); }
    .queue ul { list-style: none; padding: 0; margin: 0; }
    .queue li button {
      display: grid; grid-template-columns: 1fr auto; row-gap: 2px;
      width: 100%; padding: var(--space-3); background: transparent;
      border: 1px solid transparent; border-radius: var(--radius-2);
      text-align: left; cursor: pointer;
    }
    .queue li button.selected {
      background: var(--surface); border-color: var(--accent);
    }
    .row-model { grid-column: 1; font-family: var(--font-mono); font-size: var(--text-sm); }
    .row-concept { grid-column: 1; color: var(--text-muted); font-size: var(--text-xs); }
    .row-score { grid-column: 2; grid-row: 1 / span 2; font-family: var(--font-mono); }

    .panes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin-top: var(--space-4); }
    .pane { border: 1px solid var(--border); border-radius: var(--radius-2); padding: var(--space-4); }
    .pane h3 { margin: 0 0 var(--space-3) 0; font-size: var(--text-base); }
    .debug { font-family: var(--font-mono); font-size: var(--text-xs); white-space: pre; overflow-x: auto; max-height: 480px; overflow-y: auto; }
    .code { font-family: var(--font-mono); font-size: var(--text-sm); white-space: pre-wrap; background: var(--surface); padding: var(--space-3); border-radius: var(--radius-1); }
    .codes { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; padding: 0; }
    .reasons { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; padding: 0; margin: var(--space-2) 0; }
    .actions { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); }
    .reject input { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-1); min-width: 280px; }
    .error { color: var(--danger); margin-left: var(--space-3); }
  </style>
  ```

- [ ] **F6.5.3** — R2 proxy endpoint `site/src/routes/api/v1/admin/lifecycle/debug/[...key]/+server.ts`. **Reads from the `LIFECYCLE_BLOBS` R2 binding declared by Plan A in `site/wrangler.toml`** (see Plan A's wrangler patch — `[[r2_buckets]] binding = "LIFECYCLE_BLOBS"`). This is the same binding Plan E's `debug-bundle-exists` endpoint uses; the names MUST match across plans:

  ```typescript
  import type { RequestHandler } from './$types';
  import { authenticateAdminRequest } from '$lib/server/cf-access';
  import { errorResponse, ApiError } from '$lib/server/errors';

  export const GET: RequestHandler = async ({ request, params, platform }) => {
    if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
    const env = platform.env;
    try {
      await authenticateAdminRequest(request, env, null);
      const key = params.key!;
      // env.LIFECYCLE_BLOBS — declared by Plan A in site/wrangler.toml.
      // Do NOT fall back to env.BLOBS or env.LIFECYCLE_BLOBS_BUCKET; both
      // names are wrong. If the binding is missing, fail loudly so deploys
      // catch it before browser traffic does.
      if (!env.LIFECYCLE_BLOBS) {
        throw new ApiError(500, 'r2_unbound',
          'LIFECYCLE_BLOBS R2 binding missing — Plan A wrangler.toml not deployed');
      }
      const obj = await env.LIFECYCLE_BLOBS.get(key);
      if (!obj) throw new ApiError(404, 'r2_missing', `key ${key} not in R2`);
      // Return raw bytes; UI numbers lines client-side.
      return new Response(obj.body, {
        status: 200,
        headers: {
          'content-type': obj.httpMetadata?.contentType ?? 'text/plain; charset=utf-8',
          'cache-control': 'private, max-age=300',
        },
      });
    } catch (err) {
      return errorResponse(err);
    }
  };
  ```

---

## F7 — Status page at `/admin/lifecycle/status`

- [ ] **F7.1** — Server loader `site/src/routes/admin/lifecycle/status/+page.server.ts` reads `v_lifecycle_state` (defined by Phase A):

  ```typescript
  import type { PageServerLoad } from './$types';
  import { getAll } from '$lib/server/db';

  export interface StateRow {
    model_slug: string;
    task_set_hash: string;
    step: 'bench' | 'debug' | 'analyze' | 'publish' | 'cycle' | 'other';
    last_ts: number;
    last_event_id: number;
  }

  export const load: PageServerLoad = async ({ platform }) => {
    if (!platform) throw new Error('no platform');
    const rows = await getAll<StateRow>(
      platform.env.DB,
      `SELECT v.model_slug, v.task_set_hash, v.step, v.last_ts, v.last_event_id
         FROM v_lifecycle_state v
         JOIN task_sets ts ON ts.hash = v.task_set_hash AND ts.is_current = 1
        ORDER BY v.model_slug, v.step`,
      [],
    );
    return { rows };
  };
  ```

- [ ] **F7.2** — Page `site/src/routes/admin/lifecycle/status/+page.svelte`:

  ```svelte
  <script lang="ts">
    import type { StateRow } from './+page.server';
    let { data } = $props<{ data: { rows: StateRow[] } }>();

    type Step = 'bench' | 'debug' | 'analyze' | 'publish';
    const STEPS: Step[] = ['bench', 'debug', 'analyze', 'publish'];

    interface ModelRow { model_slug: string; cells: Record<Step, StateRow | null>; }

    const matrix = $derived<ModelRow[]>(() => {
      const byModel = new Map<string, ModelRow>();
      for (const r of data.rows) {
        const slot = byModel.get(r.model_slug) ??
          { model_slug: r.model_slug, cells: { bench: null, debug: null, analyze: null, publish: null } };
        if (STEPS.includes(r.step as Step)) {
          slot.cells[r.step as Step] = r;
        }
        byModel.set(r.model_slug, slot);
      }
      return Array.from(byModel.values());
    });

    function symbolFor(s: StateRow | null): { sym: string; cls: string; title: string } {
      if (!s) return { sym: '--', cls: 'cell-missing', title: 'no events' };
      const ageDays = (Date.now() - s.last_ts) / (1000 * 60 * 60 * 24);
      if (ageDays < 7) return { sym: 'OK', cls: 'cell-ok', title: `last: ${new Date(s.last_ts).toISOString()}` };
      return { sym: '...', cls: 'cell-stale', title: `stale ${ageDays.toFixed(0)}d` };
    }
  </script>

  <svelte:head><title>Status matrix — Lifecycle — CentralGauge</title></svelte:head>

  <table class="matrix">
    <thead>
      <tr>
        <th scope="col">Model</th>
        {#each STEPS as s (s)}<th scope="col">{s}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each matrix() as m (m.model_slug)}
        <tr>
          <th scope="row"><a href={`/admin/lifecycle/events?model=${m.model_slug}`}>{m.model_slug}</a></th>
          {#each STEPS as s (s)}
            {@const sf = symbolFor(m.cells[s])}
            <td class={sf.cls} title={sf.title}>{sf.sym}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  <p class="legend text-muted">
    <span class="legend-cell cell-ok">OK</span> = recent (&lt;7d).
    <span class="legend-cell cell-stale">...</span> = stale.
    <span class="legend-cell cell-missing">--</span> = no events for this step.
  </p>

  <style>
    table.matrix { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
    th, td { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); text-align: left; }
    td { font-family: var(--font-mono); text-align: center; }
    .cell-ok { color: var(--success); }
    .cell-stale { color: var(--warning); }
    .cell-missing { color: var(--text-faint); }
    .legend { margin-top: var(--space-4); font-size: var(--text-sm); }
    .legend-cell { font-family: var(--font-mono); padding: 0 var(--space-2); }
  </style>
  ```

---

## F8 — Tests + acceptance

- [ ] **F8.1** — Confidence scoring snapshot test: pin the breakdown for a known fixture entry. Run twice, assert identical output. (Already covered in F1.3.)

- [ ] **F8.2** — Review queue endpoint sign-verify tests in `site/tests/api/lifecycle-review-queue.test.ts`. Cover: (a) GET without CF Access JWT → 401; (b) GET with valid CF Access JWT (use the stubbed JWKs from F5.3) → 200 with entries.

- [ ] **F8.3** — Decide endpoint write-through tests:
  - Accept path → `analysis.accepted` event written, `pending_review.status='accepted'`, `shortcomings` row inserted with the correct `concept_id`, `analysis_event_id`, `published_event_id`, `confidence`.
  - Reject path → `analysis.rejected` event, `pending_review.status='rejected'`, no `shortcomings` row.
  - `actor_id` recorded as the CF Access email or `key:<id>` per auth path.

- [ ] **F8.4** — CF Access bypass tests: no header → 401, invalid signature → 401, wrong audience → 401. (F5.3.)

- [ ] **F8.5** — Run `cd site && npm run build && npm test`. Run `deno task test:unit -- confidence pending-review`. Run `deno check`, `deno lint`, `deno fmt` on the CLI source files (skip site/).

- [ ] **F8.6** — Manual acceptance: with a `pending_review` row seeded in the staging D1, navigate (CF Access authenticated) to `/admin/lifecycle/review`. Click the entry → side-by-side panes render. Click Accept → entry disappears from queue, `shortcomings` row appears via `/api/v1/models/<slug>/limitations`.

---

## F-COMMIT

- [ ] Stage:
  - `src/lifecycle/confidence.ts`, `src/lifecycle/pending-review.ts`
  - `tests/unit/lifecycle/confidence.test.ts`, `tests/unit/lifecycle/pending-review.test.ts`
  - `site/src/lib/server/cf-access.ts` (auth helper, exports `authenticateAdminRequest`)
  - `site/src/routes/api/v1/admin/lifecycle/review/queue/+server.ts`
  - `site/src/routes/api/v1/admin/lifecycle/review/[id]/decide/+server.ts`
  - `site/src/routes/api/v1/admin/lifecycle/debug/[...key]/+server.ts`
  - **F5.5 retro-patches** — wiring `authenticateAdminRequest` into existing admin endpoints (do NOT skip these; the commit is incomplete without them):
    - `site/src/routes/api/v1/admin/lifecycle/events/+server.ts` (Plan A endpoint)
    - `site/src/routes/api/v1/admin/lifecycle/state/+server.ts` (Plan A endpoint)
    - `site/src/routes/api/v1/admin/lifecycle/r2/[...key]/+server.ts` (Plan A endpoint)
    - `site/src/routes/api/v1/admin/lifecycle/clusters/+server.ts` (Plan D-data endpoint)
    - `site/src/routes/api/v1/admin/lifecycle/clusters/[id]/decide/+server.ts` (Plan D-data endpoint)
    - `site/src/routes/api/v1/admin/lifecycle/debug-bundle-exists/+server.ts` (Plan E endpoint)
    - `site/src/routes/api/v1/admin/lifecycle/reanalyze/+server.ts` (Plan E re-analyze CTA, if landed)
  - `site/src/routes/admin/lifecycle/+layout.svelte`
  - `site/src/routes/admin/lifecycle/+page.{svelte,server.ts}`
  - `site/src/routes/admin/lifecycle/review/+page.{svelte,server.ts}`
  - `site/src/routes/admin/lifecycle/status/+page.{svelte,server.ts}`
  - `site/wrangler.toml` (commits `CF_ACCESS_TEAM_DOMAIN` only; `CF_ACCESS_AUD` set via `wrangler secret put`)
  - `docs/site/operations.md` (F5.1 runbook for CF Access + secret setup)
  - `src/config/config.ts` (`lifecycle.analyzer_model` + `cross_llm_sample_rate` + `confidence_threshold`)
  - All matching `*.test.ts` files (including the per-endpoint auth-triple tests from F5.5)

- [ ] Commit message:

  ```
  feat(site,cli): quality gating + web admin review UI for lifecycle

  Phase F of the lifecycle event-sourcing initiative. Adds three signals
  to score every analyzer entry (schema validity, concept-cluster
  consistency, sampled cross-LLM agreement); below-threshold entries
  route to /admin/lifecycle/review where an operator authenticated via
  Cloudflare Access decides accept/reject. Decisions land as
  analysis.accepted / analysis.rejected events with full provenance.
  Admin endpoints accept either CF Access JWT (browser) or Ed25519
  admin signature (CLI), never both, never neither.
  ```

> **Acceptance.** Running `cycle` on a model that produces a hallucinated entry (low confidence) does NOT publish it; entry appears at `/admin/lifecycle/review`. Operator clicks Accept → entry becomes a `shortcomings` row + `analysis.accepted` event written. Operator clicks Reject → entry skipped + `analysis.rejected` event written. CF Access bypass attempts (no header / invalid JWT / wrong audience) all fail closed with 401.
