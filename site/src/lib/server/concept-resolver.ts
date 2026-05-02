/**
 * Resolves analyzer-proposed concept slugs to concept_id rows.
 *
 * Three-tier band (per Phase D rationale):
 *   existing_match non-null AND similarity ≥ 0.85 → reuse existing → emits concept.aliased
 *   existing_match null    AND similarity ≥ 0.85 → fall through to create (no winner row)
 *   0.70 ≤ similarity < 0.85 → return action='pending' (caller writes pending_review)
 *   similarity < 0.70 OR null → create new concept → emits concept.created
 *
 * Two-step pattern per concept-write band (D1 cannot return RETURNING ids
 * mid-batch reliably): event INSERT first via canonical `appendEvent` →
 * capture `{id}` → batched writes (alias / concept / shortcoming UPDATE)
 * reference that id. Auto-create inverts the order (insert concept first
 * to obtain `concept_id` for the event payload, emit event, then back-patch
 * `provenance_event_id` on the concept row) — the strategic appendix
 * mandates `concept.created.payload.concept_id`.
 *
 * Auto-merge naming: 0.85+ is implemented as inserting an alias row
 * pointing the proposed slug at the existing winner concept_id. The
 * lifecycle event is `concept.aliased`, NOT `concept.created`. Inverting
 * that mapping was a bug in an earlier draft; do not reintroduce.
 */

import type { AppendEventInput } from "../../../../src/lifecycle/types";

export interface ResolveInput {
  proposed_slug: string;
  existing_match: string | null;
  similarity_score: number | null;
  /** From item.concept (analyzer free-text); seeds new concept rows. */
  display_name: string;
  al_concept: string;
  description: string;
  correct_pattern: string;
  /** Who proposed (for concept.created / concept.aliased payload). */
  analyzer_model: string;
}

export type ResolveAction = "aliased" | "created" | "pending";

export interface ResolveResult {
  /** null when action === 'pending'. */
  concept_id: number | null;
  action: ResolveAction;
  /** Event row id for 'aliased' / 'created'; null for 'pending'. */
  emitted_event_id: number | null;
}

const AUTO_MERGE_THRESHOLD = 0.85;
const REVIEW_LOWER_BOUND = 0.7;

/**
 * `appendEvent` injection point. The worker passes the canonical
 * `appendEvent(db, AppendEventInput)` from `$lib/server/lifecycle-event-log`.
 * Tests pass a fake that captures inputs.
 */
export type AppendEventFn = (
  input: AppendEventInput,
) => Promise<{ id: number }>;

export async function resolveConcept(
  db: D1Database,
  input: ResolveInput,
  nowMs: number,
  appendEvent: AppendEventFn,
  modelSlug: string,
  taskSetHash: string,
): Promise<ResolveResult> {
  const sim = input.similarity_score ?? 0;

  // Tier 1: auto-merge — analyzer proposed an existing-match slug AND sim ≥ 0.85.
  if (input.existing_match && sim >= AUTO_MERGE_THRESHOLD) {
    const row = await db
      .prepare(
        `SELECT id FROM concepts WHERE slug = ? AND superseded_by IS NULL`,
      )
      .bind(input.existing_match)
      .first<{ id: number }>();
    if (row) {
      // Two-step pattern: emit concept.aliased FIRST (event id is needed for
      // concept_aliases.alias_event_id FK in the next INSERT). The helper
      // serializes the payload object internally; pass plain objects.
      const ev = await appendEvent({
        event_type: "concept.aliased",
        model_slug: modelSlug,
        task_set_hash: taskSetHash,
        actor: "operator",
        actor_id: null,
        payload: {
          alias_slug: input.proposed_slug,
          concept_id: row.id,
          similarity: input.similarity_score,
          analyzer_model: input.analyzer_model,
          reviewer_actor_id: null,
        },
      });
      // Then INSERT the alias row referencing the captured event id.
      await db
        .prepare(
          `INSERT OR IGNORE INTO concept_aliases
             (alias_slug, concept_id, noted_at, similarity, reviewer_actor_id, alias_event_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.proposed_slug,
          row.id,
          nowMs,
          input.similarity_score,
          null,
          ev.id,
        )
        .run();
      return {
        concept_id: row.id,
        action: "aliased",
        emitted_event_id: ev.id,
      };
    }
    // Existing slug claimed by analyzer but not in registry — fall through to create.
  }

  // Tier 2: review band. NO event emitted yet — Plan F emits analysis.accepted
  // / analysis.rejected when the operator decides. The caller is responsible
  // for INSERTing pending_review with a real analysis_event_id (NOT a 0
  // placeholder — that violates the FK NOT NULL REFERENCES lifecycle_events(id)).
  if (sim >= REVIEW_LOWER_BOUND && sim < AUTO_MERGE_THRESHOLD) {
    return { concept_id: null, action: "pending", emitted_event_id: null };
  }

  // Tier 3: auto-create. INSERT concept first (need concept_id for the event
  // payload per strategic appendix line 460), then emit concept.created with
  // that concept_id, then back-patch provenance_event_id.
  //
  // Concurrency: two batch requests can race on the same proposed_slug. The
  // first wins the INSERT; the second hits a UNIQUE constraint failure on
  // `concepts.slug`. We catch that failure, re-SELECT the winner's id, and
  // recover as an alias-merge with `payload.race_recovery: true` so audit
  // consumers can distinguish a real analyzer-driven alias-merge from a
  // collision-driven one. Without this recovery the second concurrent
  // batch request 500s.
  let inserted: { id: number } | null = null;
  try {
    inserted = await db
      .prepare(
        `INSERT INTO concepts (slug, display_name, al_concept, description,
                               canonical_correct_pattern, first_seen, last_seen,
                               provenance_event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         RETURNING id`,
      )
      .bind(
        input.proposed_slug,
        input.display_name,
        input.al_concept,
        input.description,
        input.correct_pattern,
        nowMs,
        nowMs,
      )
      .first<{ id: number }>();
    if (!inserted) throw new Error("concept insert returned no row");
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (msg.includes("UNIQUE constraint failed: concepts.slug")) {
      // Race partner already created this concept. Recover as alias-merge.
      const existing = await db
        .prepare(
          `SELECT id FROM concepts WHERE slug = ? AND superseded_by IS NULL`,
        )
        .bind(input.proposed_slug)
        .first<{ id: number }>();
      if (!existing) {
        // Slug is taken but the row is superseded — surface the original
        // error rather than silently masking what is likely a deeper bug.
        throw e;
      }
      const ev = await appendEvent({
        event_type: "concept.aliased",
        model_slug: modelSlug,
        task_set_hash: taskSetHash,
        actor: "operator",
        actor_id: null,
        payload: {
          alias_slug: input.proposed_slug,
          concept_id: existing.id,
          similarity: input.similarity_score,
          analyzer_model: input.analyzer_model,
          reviewer_actor_id: null,
          // Distinguish race-driven recovery from analyzer-driven alias-merge.
          race_recovery: true,
        },
      });
      await db
        .prepare(
          `INSERT OR IGNORE INTO concept_aliases
             (alias_slug, concept_id, noted_at, similarity, reviewer_actor_id, alias_event_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.proposed_slug,
          existing.id,
          nowMs,
          input.similarity_score,
          null,
          ev.id,
        )
        .run();
      return {
        concept_id: existing.id,
        action: "aliased",
        emitted_event_id: ev.id,
      };
    }
    throw e;
  }

  // Now that we have the new concept_id, emit concept.created with it in the
  // payload (per strategic plan: payload = { concept_id, slug,
  // llm_proposed_slug, similarity_to_nearest, analyzer_model }).
  const ev = await appendEvent({
    event_type: "concept.created",
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    actor: "operator",
    actor_id: null,
    payload: {
      concept_id: inserted.id,
      slug: input.proposed_slug,
      llm_proposed_slug: input.proposed_slug,
      similarity_to_nearest: input.similarity_score,
      analyzer_model: input.analyzer_model,
    },
  });

  // Back-patch provenance_event_id on the freshly-inserted concept row.
  await db
    .prepare(`UPDATE concepts SET provenance_event_id = ? WHERE id = ?`)
    .bind(ev.id, inserted.id)
    .run();

  return {
    concept_id: inserted.id,
    action: "created",
    emitted_event_id: ev.id,
  };
}

export const _thresholds = { AUTO_MERGE_THRESHOLD, REVIEW_LOWER_BOUND };
