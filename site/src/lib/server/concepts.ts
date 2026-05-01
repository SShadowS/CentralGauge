/**
 * D-data §D1.4 — Transactional concept-mutation primitives.
 *
 * Every mutation uses the canonical TWO-STEP EVENT-THEN-BATCH pattern:
 *
 *   STEP 1: appendEvent(db, {...}) — captures the durable, audit-bearing
 *           lifecycle_events row and returns {id}. One D1 round-trip.
 *   STEP 2: db.batch([...]) — the dependent INSERT/UPDATE rows that need
 *           to reference the captured id (alias_event_id FK,
 *           provenance_event_id back-patch, shortcomings.concept_id
 *           re-pointer). The batch is itself transactional.
 *
 * Why the split? D1's db.batch([...]) does NOT surface RETURNING ids from
 * earlier statements to later ones in the same batch, and last_insert_rowid()
 * is unreliable mid-batch. The strategic plan documents this as the canonical
 * recovery from D1's no-RETURNING-mid-batch limitation. A worker crash
 * between steps 1 and 2 leaves an audit row pointing at a not-yet-effected
 * change — the next replay re-emits the event (idempotent on payload_hash)
 * and completes step 2.
 *
 * For concept.created the order is INSERT-concept → appendEvent → batch
 * (back-patch + shortcoming reassign): the event payload references
 * concept_id, which only exists after the INSERT. Three round-trips, but
 * the audit trail carries the real id.
 *
 * NO inline `INSERT INTO lifecycle_events` SQL strings appear here — every
 * event flows through the canonical appendEvent helper from
 * $lib/server/lifecycle-event-log.
 *
 * Plan: docs/superpowers/plans/2026-04-29-lifecycle-D-data-impl.md Task D1.4.
 */
import { invalidateConcept } from "./concept-cache";
import { appendEvent } from "./lifecycle-event-log";

export interface MergeArgs {
  proposedSlug: string;
  winnerConceptId: number;
  /**
   * When set, a true MERGE: emits concept.merged + sets
   * concepts.superseded_by = winner on the loser row. When omitted, this is
   * an alias-only operation: emits concept.aliased + INSERTs concept_aliases.
   */
  loserConceptId?: number;
  similarity: number;
  shortcomingIds: number[];
  modelSlug: string;
  taskSetHash: string;
  actor: "migration" | "operator" | "ci" | "reviewer";
  actorId: string | null;
  envelopeJson: string;
  ts: number;
  reviewerActorId?: string;
  /**
   * Origin to thread into invalidateConcept (e.g. derived from request.url
   * in admin endpoints). When omitted, falls back to the helper's sentinel
   * default — fine when the SvelteKit adapter routes all reads through the
   * same sentinel-keyed cache. Tests pass the request origin (`https://x`)
   * to assert per-slug cache eviction end-to-end.
   */
  cacheOrigin?: string;
}

/**
 * Atomic alias-merge or true-merge using the two-step event-then-batch
 * pattern. invalidateConcept is awaited inline (NOT ctx.waitUntil) per
 * CLAUDE.md so the next request observes the cache cleared.
 */
export async function mergeConceptTx(
  db: D1Database,
  args: MergeArgs,
): Promise<{ eventId: number; aliasInserted: boolean }> {
  // Pre-resolve winner + (optionally) loser slugs for invalidateConcept.
  const winner = (await db
    .prepare(`SELECT slug FROM concepts WHERE id = ?`)
    .bind(args.winnerConceptId)
    .first<{ slug: string }>())!;
  const loser =
    args.loserConceptId == null
      ? null
      : await db
          .prepare(`SELECT slug FROM concepts WHERE id = ?`)
          .bind(args.loserConceptId)
          .first<{ slug: string }>();

  const placeholders = args.shortcomingIds.map(() => "?").join(",");
  const isTrueMerge = args.loserConceptId != null;

  // STEP 1: emit the lifecycle event via canonical appendEvent. Payload is
  // an OBJECT — the helper serializes + hashes internally. Capture {id}.
  const ev = await appendEvent(db, {
    event_type: isTrueMerge ? "concept.merged" : "concept.aliased",
    model_slug: args.modelSlug,
    task_set_hash: args.taskSetHash,
    actor: args.actor,
    actor_id: args.actorId,
    payload: isTrueMerge
      ? {
          // Strategic appendix: concept.merged payload =
          //   { winner_concept_id, loser_concept_id, similarity, reviewer_actor_id }
          winner_concept_id: args.winnerConceptId,
          loser_concept_id: args.loserConceptId,
          similarity: args.similarity,
          reviewer_actor_id: args.reviewerActorId ?? null,
        }
      : {
          // Strategic appendix: concept.aliased payload =
          //   { alias_slug, concept_id, similarity, reviewer_actor_id }
          alias_slug: args.proposedSlug,
          concept_id: args.winnerConceptId,
          similarity: args.similarity,
          reviewer_actor_id: args.reviewerActorId ?? null,
        },
  });
  const eventId = ev.id;

  // STEP 2: batch the dependent writes.
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT OR IGNORE INTO concept_aliases
           (alias_slug, concept_id, noted_at, similarity, reviewer_actor_id, alias_event_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        args.proposedSlug,
        args.winnerConceptId,
        args.ts,
        args.similarity,
        args.reviewerActorId ?? null,
        eventId,
      ),
  ];
  if (args.shortcomingIds.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE shortcomings
             SET concept_id = ?, analysis_event_id = COALESCE(analysis_event_id, ?)
           WHERE id IN (${placeholders})`,
        )
        .bind(args.winnerConceptId, eventId, ...args.shortcomingIds),
    );
  }
  if (isTrueMerge) {
    // Loser concept row stays in the table (never DELETE) but is marked
    // superseded. Repoint any shortcoming still on the loser to the winner.
    stmts.push(
      db
        .prepare(`UPDATE concepts SET superseded_by = ? WHERE id = ?`)
        .bind(args.winnerConceptId, args.loserConceptId!),
    );
    stmts.push(
      db
        .prepare(`UPDATE shortcomings SET concept_id = ? WHERE concept_id = ?`)
        .bind(args.winnerConceptId, args.loserConceptId!),
    );
  }
  await db.batch(stmts);

  // STEP 3: cache invalidation. Drop the winner slug, alias slug, and
  // (true-merge) loser slug — all three could be cached as separate URLs.
  const aliasesToDrop: string[] = [args.proposedSlug];
  if (loser) aliasesToDrop.push(loser.slug);
  if (args.cacheOrigin !== undefined) {
    await invalidateConcept(winner.slug, aliasesToDrop, args.cacheOrigin);
  } else {
    await invalidateConcept(winner.slug, aliasesToDrop);
  }

  return { eventId, aliasInserted: true };
}

export interface CreateArgs {
  proposedSlug: string;
  displayName: string;
  alConcept: string;
  description: string;
  similarityToNearest: number;
  shortcomingIds: number[];
  modelSlug: string;
  taskSetHash: string;
  actor: "migration" | "operator" | "ci" | "reviewer";
  actorId: string | null;
  envelopeJson: string;
  ts: number;
  analyzerModel: string | null;
  /** See MergeArgs.cacheOrigin. */
  cacheOrigin?: string;
}

export async function createConceptTx(
  db: D1Database,
  args: CreateArgs,
): Promise<{ conceptId: number; eventId: number }> {
  const placeholders = args.shortcomingIds.map(() => "?").join(",");

  // STEP 1a: INSERT the concept row first — its id is required for the
  // concept.created event payload (per strategic appendix:
  //   { concept_id, slug, llm_proposed_slug, similarity_to_nearest, analyzer_model }).
  const conceptInsert = await db
    .prepare(
      `INSERT INTO concepts
         (slug, display_name, al_concept, description, canonical_correct_pattern,
          first_seen, last_seen, superseded_by, split_into_event_id, provenance_event_id)
       VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL)`,
    )
    .bind(
      args.proposedSlug,
      args.displayName,
      args.alConcept,
      args.description,
      args.ts,
      args.ts,
    )
    .run();
  const conceptId = Number(conceptInsert.meta.last_row_id);

  // STEP 1b: emit concept.created via canonical appendEvent with concept_id.
  const ev = await appendEvent(db, {
    event_type: "concept.created",
    model_slug: args.modelSlug,
    task_set_hash: args.taskSetHash,
    actor: args.actor,
    actor_id: args.actorId,
    payload: {
      concept_id: conceptId,
      slug: args.proposedSlug,
      llm_proposed_slug: args.proposedSlug,
      similarity_to_nearest: args.similarityToNearest,
      analyzer_model: args.analyzerModel,
    },
  });
  const eventId = ev.id;

  // STEP 2: batch provenance back-patch + shortcoming reassignments.
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE concepts SET provenance_event_id = ? WHERE id = ?`)
      .bind(eventId, conceptId),
  ];
  if (args.shortcomingIds.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE shortcomings
             SET concept_id = ?, analysis_event_id = COALESCE(analysis_event_id, ?)
           WHERE id IN (${placeholders})`,
        )
        .bind(conceptId, eventId, ...args.shortcomingIds),
    );
  }
  await db.batch(stmts);

  if (args.cacheOrigin !== undefined) {
    await invalidateConcept(args.proposedSlug, [], args.cacheOrigin);
  } else {
    await invalidateConcept(args.proposedSlug, []);
  }
  return { conceptId, eventId };
}

export interface SplitArgs {
  originalConceptId: number;
  newConceptRows: Array<{
    slug: string;
    displayName: string;
    alConcept: string;
    description: string;
  }>;
  reviewerActorId: string;
  reason: string;
  modelSlug: string;
  taskSetHash: string;
  actor: "reviewer";
  actorId: string;
  envelopeJson: string;
  ts: number;
  /** See MergeArgs.cacheOrigin. */
  cacheOrigin?: string;
}

/**
 * Split an existing concept into N children. Three-step (unavoidable):
 *   1a. INSERT N new concept rows; collect ids (need them in event payload).
 *   1b. appendEvent(concept.split) with the captured ids; capture eventId.
 *   2.  db.batch([UPDATE original.split_into_event_id = eventId,
 *                 UPDATE each child.provenance_event_id = eventId])
 */
export async function splitConceptTx(
  db: D1Database,
  args: SplitArgs,
): Promise<{ eventId: number; newConceptIds: number[] }> {
  // STEP 1a: INSERT the N new concept rows.
  const newConceptIds: number[] = [];
  for (const row of args.newConceptRows) {
    const r = await db
      .prepare(
        `INSERT INTO concepts
           (slug, display_name, al_concept, description, canonical_correct_pattern,
            first_seen, last_seen, superseded_by, split_into_event_id, provenance_event_id)
         VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL)`,
      )
      .bind(
        row.slug,
        row.displayName,
        row.alConcept,
        row.description,
        args.ts,
        args.ts,
      )
      .run();
    newConceptIds.push(Number(r.meta.last_row_id));
  }

  // STEP 1b: emit concept.split with the captured ids in the payload.
  const ev = await appendEvent(db, {
    event_type: "concept.split",
    model_slug: args.modelSlug,
    task_set_hash: args.taskSetHash,
    actor: args.actor,
    actor_id: args.actorId,
    payload: {
      original_concept_id: args.originalConceptId,
      new_concept_ids: newConceptIds,
      reviewer_actor_id: args.reviewerActorId,
      reason: args.reason,
    },
  });
  const eventId = ev.id;

  // STEP 2: back-patch original.split_into_event_id + each child's provenance.
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE concepts SET split_into_event_id = ? WHERE id = ?`)
      .bind(eventId, args.originalConceptId),
  ];
  for (const childId of newConceptIds) {
    stmts.push(
      db
        .prepare(`UPDATE concepts SET provenance_event_id = ? WHERE id = ?`)
        .bind(eventId, childId),
    );
  }
  await db.batch(stmts);

  // Invalidate original slug + every child slug.
  const original = await db
    .prepare(`SELECT slug FROM concepts WHERE id = ?`)
    .bind(args.originalConceptId)
    .first<{ slug: string }>();
  const childSlugs = args.newConceptRows.map((r) => r.slug);
  if (args.cacheOrigin !== undefined) {
    await invalidateConcept(original!.slug, childSlugs, args.cacheOrigin);
  } else {
    await invalidateConcept(original!.slug, childSlugs);
  }

  return { eventId, newConceptIds };
}

export interface ReviewArgs {
  /**
   * The original analyzer entry (zod-compatible with AnalyzerEntrySchema in
   * src/verify/schema.ts owned by Plan D-prompt). Cluster metadata is nested
   * under `entry._cluster` so Plan F's reader (which does
   * `JSON.parse(payload_json) as { entry, confidence }`) doesn't trip on
   * extra top-level keys.
   */
  entry: Record<string, unknown> & {
    concept_slug_proposed: string;
    concept_slug_existing_match: string | null;
    similarity_score: number | null;
  };
  proposedSlug: string;
  nearestConceptId: number;
  similarity: number;
  modelSlug: string;
  shortcomingIds: number[];
  /**
   * Real lifecycle_events.id — pending_review.analysis_event_id has FK
   * NOT NULL REFERENCES lifecycle_events(id). Caller must emit
   * analysis.completed via appendEvent first and pass the captured id here.
   * The legacy 0 placeholder is rejected.
   */
  analysisEventId: number;
  ts: number;
  confidence?: number;
}

/**
 * Insert a pending_review row. NO lifecycle event is emitted — Plan F emits
 * analysis.accepted / analysis.rejected when the operator decides. The
 * three-tier band rationale is explicit: review-band writes ZERO events
 * until the operator decides.
 *
 * payload_json shape MUST match Plan F's reader at
 * /api/v1/admin/lifecycle/review/<id>/decide:
 *   { entry, confidence }
 * with cluster metadata nested under entry._cluster.
 */
// deno-lint-ignore require-await
export async function enqueueReviewTx(
  db: D1Database,
  args: ReviewArgs,
): Promise<number> {
  if (args.analysisEventId == null || args.analysisEventId === 0) {
    throw new Error(
      "enqueueReviewTx: analysisEventId must be a real lifecycle_events.id; " +
        "the legacy 0 placeholder violated the NOT NULL REFERENCES FK. " +
        "Caller must emit analysis.completed via appendEvent first and pass the captured id.",
    );
  }
  const confidence = args.confidence ?? args.similarity;
  const payloadObj = {
    entry: {
      ...args.entry,
      _cluster: {
        proposed_slug: args.proposedSlug,
        nearest_concept_id: args.nearestConceptId,
        similarity: args.similarity,
        shortcoming_ids: args.shortcomingIds,
      },
    },
    confidence,
  };
  return db
    .prepare(
      `INSERT INTO pending_review
         (analysis_event_id, model_slug, concept_slug_proposed, payload_json,
          confidence, created_at, status, reviewer_decision_event_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)`,
    )
    .bind(
      args.analysisEventId,
      args.modelSlug,
      args.proposedSlug,
      JSON.stringify(payloadObj),
      confidence,
      args.ts,
    )
    .run()
    .then((r) => Number(r.meta.last_row_id));
}
