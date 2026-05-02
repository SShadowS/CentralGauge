/**
 * Pending-review writer (Plan F / F2).
 *
 * Migration `0006_lifecycle.sql` creates the `pending_review` table; this
 * module is the typed interface across plans. All cross-plan writers
 * converge here so the row shape stays single-format and the F4 `/decide`
 * endpoint never has to branch on payload variants.
 *
 * Triggered by:
 *   - Plan C analyze step when `scoreEntry()` returns
 *     `above_threshold = false` (the strategic plan's primary intent —
 *     hallucinated entries route to human review instead of auto-publish).
 *   - Plan D-prompt's batch endpoint when its similarity-band
 *     classification falls inside the 0.70-0.85 review band.
 *   - Plan D-data's cluster-review enqueue when the backfill produces
 *     ambiguous matches that the operator must arbitrate.
 *
 * Decision-time updates flow through `markDecided` from Plan F's web
 * decide endpoint at `/api/v1/admin/lifecycle/review/[id]/decide`.
 *
 * **Canonical row shape (cross-plan invariant):**
 *
 * ```jsonc
 * pending_review.payload_json = {
 *   "entry":      <AnalyzerEntry>,       // required, mirrors src/verify/schema.ts
 *   "confidence": <ConfidenceResult>,    // required, mirrors src/lifecycle/confidence.ts
 *   // Optional metadata MUST nest under entry._<namespace>.
 *   // Examples that already exist in the codebase:
 *   //   entry._cluster.{nearest_concept_id, similarity, shortcoming_ids}  (Plan D-data)
 * }
 * ```
 *
 * The F4 `/decide` endpoint reads ONLY top-level `entry` + `confidence`.
 * Extra top-level keys are tolerated but ignored. Migrators / new writers
 * MUST NOT introduce parallel top-level keys (no `pending_review_id`,
 * no `proposal`, no `meta` siblings) — that would force F4 to branch on
 * shape.
 *
 * @module src/lifecycle/pending-review
 */

import type { AnalyzerEntry, ConfidenceResult } from "./confidence.ts";

/**
 * Row shape returned by `listPending`. Mirrors the migration columns in
 * `0006_lifecycle.sql` exactly. `payload_json` is intentionally a string
 * (not parsed) so consumers can decide whether to incur the JSON.parse
 * cost — the queue endpoint parses it once and forwards the object,
 * the CLI replay path forwards the raw string.
 */
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

/**
 * Arguments to `enqueue`. The `entry` may carry optional `_*` metadata
 * (see canonical row shape above) — `enqueue` JSON.stringifies the whole
 * thing into `payload_json`.
 */
export interface EnqueueArgs {
  /**
   * The lifecycle event id of the `analysis.completed` row that produced
   * this entry. MUST be > 0 — the `0` placeholder used in pre-Plan-A
   * tests is no longer valid (`pending_review.analysis_event_id` is a
   * NOT NULL FK to `lifecycle_events.id` per the migration).
   */
  analysis_event_id: number;
  model_slug: string;
  /** Canonical analyzer entry (camelCase + snake_case mix per schema). */
  entry: AnalyzerEntry & Record<string, unknown>;
  confidence: ConfidenceResult;
}

/**
 * Minimal D1-binding shim. The CLI ingests via signed POST to
 * `/api/v1/admin/lifecycle/review/enqueue` (TODO if/when added); the
 * worker exec-path uses this module directly with the env.DB binding.
 *
 * Tests use `MemoryDb` (defined alongside the unit test) which mirrors
 * this shape against in-memory state.
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

/**
 * Insert a `pending_review` row with canonical
 * `payload_json = { entry, confidence }`. Returns the new row id (which
 * becomes the URL parameter for the decide endpoint).
 *
 * Throws `Error('enqueue: analysis_event_id must be > 0')` when the
 * caller passes the legacy 0 placeholder — guarding against the bug
 * pattern Plan D-data caught in its `enqueueReviewTx` review.
 */
export async function enqueue(
  db: PendingReviewDb,
  args: EnqueueArgs,
): Promise<number> {
  if (!Number.isInteger(args.analysis_event_id) || args.analysis_event_id < 1) {
    throw new Error(
      `enqueue: analysis_event_id must be > 0 (got ${args.analysis_event_id})`,
    );
  }
  if (!args.model_slug) {
    throw new Error("enqueue: model_slug must be non-empty");
  }
  const proposedSlug = args.entry.concept_slug_proposed;
  if (!proposedSlug) {
    throw new Error(
      "enqueue: entry.concept_slug_proposed must be non-empty (canonical schema)",
    );
  }
  const payload_json = JSON.stringify({
    entry: args.entry,
    confidence: args.confidence,
  });
  const res = await db.prepare(
    `INSERT INTO pending_review(
       analysis_event_id, model_slug, concept_slug_proposed,
       payload_json, confidence, created_at, status
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).bind(
    args.analysis_event_id,
    args.model_slug,
    proposedSlug,
    payload_json,
    args.confidence.score,
    Date.now(),
  ).run();
  if (res.meta?.last_row_id == null) {
    throw new Error("enqueue: D1 did not return last_row_id");
  }
  return Number(res.meta.last_row_id);
}

/**
 * Mark a `pending_review` row decided. Status becomes `'accepted'` or
 * `'rejected'`; `reviewer_decision_event_id` points at the
 * `analysis.accepted` / `analysis.rejected` lifecycle event the F4 decide
 * endpoint just emitted.
 *
 * The F4 endpoint runs this *after* the lifecycle event INSERT so the FK
 * always resolves. Standalone callers (CLI replay, tests) must observe
 * the same ordering.
 */
export async function markDecided(
  db: PendingReviewDb,
  args: {
    id: number;
    decision: "accepted" | "rejected";
    reviewer_decision_event_id: number;
  },
): Promise<void> {
  if (!Number.isInteger(args.id) || args.id < 1) {
    throw new Error(`markDecided: id must be > 0 (got ${args.id})`);
  }
  if (
    !Number.isInteger(args.reviewer_decision_event_id) ||
    args.reviewer_decision_event_id < 1
  ) {
    throw new Error(
      `markDecided: reviewer_decision_event_id must be > 0 (got ${args.reviewer_decision_event_id})`,
    );
  }
  await db.prepare(
    `UPDATE pending_review
        SET status = ?, reviewer_decision_event_id = ?
      WHERE id = ?`,
  ).bind(args.decision, args.reviewer_decision_event_id, args.id).run();
}

/**
 * Read the queue. Returns `pending` rows oldest-first so reviewers
 * triage a stable order and the same row doesn't bounce between page
 * loads.
 */
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
