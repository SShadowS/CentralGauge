/**
 * Per-generation concept-diff for a model family. Comparable iff both
 * `analysis.completed` events were produced by the same analyzer model;
 * otherwise the four buckets are deliberately omitted (a cross-analyzer
 * diff produces phantom regressions because the new analyzer notices
 * shortcomings the old one missed — rendering empty buckets would
 * falsely suggest equivalence).
 *
 * Strategic rationale: docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md
 * (Phase E "differential analysis is automatic AND constrained to matching
 * analyzer models").
 *
 * @module src/lifecycle/diff
 */

/**
 * One row in a diff bucket.
 *
 * `delta` semantics by bucket:
 *   - `resolved`:   gen_a count (which dropped to zero in gen_b).
 *   - `persisting`: gen_b_count - gen_a_count (positive = worse).
 *   - `regressed`:  gen_b count (concept already existed at gen_a's time
 *                   but did not appear in gen_a's analysis).
 *   - `new`:        gen_b count (concept's `first_seen` post-dates gen_a;
 *                   bucketed separately so UI can distinguish "model got
 *                   worse" from "the analyzer learned a new concept").
 */
export interface DiffConcept {
  concept_id: number;
  slug: string;
  display_name: string;
  description: string;
  al_concept: string;
  delta: number;
}

export type DiffStatus =
  | "comparable"
  | "analyzer_mismatch"
  | "baseline_missing";

export interface DiffResult {
  status: DiffStatus;
  family_slug: string;
  task_set_hash: string;
  from_gen_event_id: number | null;
  to_gen_event_id: number;
  from_model_slug: string | null;
  to_model_slug: string;
  analyzer_model_a: string | null;
  analyzer_model_b: string;
  /**
   * Buckets are only populated when `status === 'comparable'`.
   * Intentionally undefined for `analyzer_mismatch` and `baseline_missing`
   * — consumers MUST check `status` first.
   */
  resolved?: DiffConcept[];
  persisting?: DiffConcept[];
  regressed?: DiffConcept[];
  new?: DiffConcept[];
}

/**
 * Minimal D1 binding shape sufficient for the diff function. Kept here so
 * the pure function can be tested with an in-memory shim and the worker
 * can pass the real `D1Database` binding straight in.
 */
export interface DiffDb {
  prepare(sql: string): {
    bind(...p: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

/**
 * Args for `computeGenerationDiff`. `from_event_ts` is the unix-ms
 * `lifecycle_events.ts` of the from-event row, threaded through by the
 * caller after its own SELECT (the worker trigger has it; the inline-
 * recompute fallback in the API endpoint re-SELECTs and passes it). MUST
 * be `null` when `from_gen_event_id` is `null` (baseline_missing — there
 * is no from-event timestamp to bucket against).
 *
 * Why the caller plumbs it (vs the diff function re-fetching it itself):
 * keeps the function close to pure (single SELECT per event, callers
 * already paid the cost) and lets the worker share its own SELECT result.
 */
export interface DiffArgs {
  family_slug: string;
  task_set_hash: string;
  from_gen_event_id: number | null;
  /**
   * Unix-ms timestamp of the from-event's `lifecycle_events.ts` column.
   * `null` iff `from_gen_event_id === null`. The bucketing logic compares
   * `concepts.first_seen` (also unix-ms) against this value to distinguish
   * `regressed` (concept pre-existed gen_a) from `new` (concept post-dates
   * gen_a's analysis). Using event ids as a proxy was a critical bug
   * (production ids are ~10^4-10^6 while ts is ~10^12 — every comparison
   * was always FALSE, mis-bucketing all regressions as 'new').
   */
  from_event_ts: number | null;
  to_gen_event_id: number;
}

/**
 * Compute the per-concept diff between two `analysis.completed` events.
 *
 * The caller passes both `from_gen_event_id` (nullable — `null` ↔ no
 * baseline exists, the to-event is the family's first analysis) and
 * `to_gen_event_id`. Both are looked up in `lifecycle_events`; their
 * `payload_json.analyzer_model` is read by `parseAnalyzerModel`.
 *
 * Comparability rule (strategic plan Phase E):
 *   When `analyzer_model_a !== analyzer_model_b`, return
 *   `status='analyzer_mismatch'` and OMIT all four buckets. The strategic
 *   rationale is explicit: a cross-analyzer diff produces phantom
 *   regressions because the new analyzer notices things the old one
 *   missed; rendering empty buckets would falsely signal equivalence.
 *
 * @throws when `to_gen_event_id` doesn't resolve to an `analysis.completed`
 *         row, or when either event's `payload_json` is missing
 *         `analyzer_model`.
 */
export async function computeGenerationDiff(
  db: DiffDb,
  args: DiffArgs,
): Promise<DiffResult> {
  // Resolve to_gen first — it must exist (caller invokes after the event lands).
  const toEvent = await db.prepare(
    `SELECT id, model_slug, payload_json
       FROM lifecycle_events
      WHERE id = ? AND event_type = 'analysis.completed'`,
  ).bind(args.to_gen_event_id).first<EventRow>();
  if (!toEvent) {
    throw new Error(
      `computeGenerationDiff: to_gen_event ${args.to_gen_event_id} not found ` +
        `or not analysis.completed`,
    );
  }
  const toAnalyzer = parseAnalyzerModel(toEvent.payload_json);

  // Baseline missing: first generation in the family, no comparison possible.
  if (args.from_gen_event_id == null) {
    return {
      status: "baseline_missing",
      family_slug: args.family_slug,
      task_set_hash: args.task_set_hash,
      from_gen_event_id: null,
      to_gen_event_id: args.to_gen_event_id,
      from_model_slug: null,
      to_model_slug: toEvent.model_slug,
      analyzer_model_a: null,
      analyzer_model_b: toAnalyzer,
    };
  }

  const fromEvent = await db.prepare(
    `SELECT id, model_slug, payload_json
       FROM lifecycle_events
      WHERE id = ? AND event_type = 'analysis.completed'`,
  ).bind(args.from_gen_event_id).first<EventRow>();
  if (!fromEvent) {
    throw new Error(
      `computeGenerationDiff: from_gen_event ${args.from_gen_event_id} not found ` +
        `or not analysis.completed`,
    );
  }
  const fromAnalyzer = parseAnalyzerModel(fromEvent.payload_json);

  // Invariant: when from_gen_event_id is non-null, the caller MUST pass the
  // matching from_event_ts so the regressed/new bucket discriminator can
  // compare against the right unit. (Pre-fix the discriminator silently
  // used fromEvent.id, which differs from concepts.first_seen by ~12 orders
  // of magnitude in production and mis-bucketed every regression as 'new'.)
  if (args.from_event_ts == null) {
    throw new Error(
      `computeGenerationDiff: from_event_ts is required when from_gen_event_id ` +
        `is non-null (got from_gen_event_id=${args.from_gen_event_id}, ` +
        `from_event_ts=null). The caller must SELECT lifecycle_events.ts and ` +
        `thread it through DiffArgs — see lifecycle-diff-trigger.ts for the ` +
        `canonical pattern.`,
    );
  }

  // Analyzer-mismatch short-circuit: omit buckets entirely.
  if (fromAnalyzer !== toAnalyzer) {
    return {
      status: "analyzer_mismatch",
      family_slug: args.family_slug,
      task_set_hash: args.task_set_hash,
      from_gen_event_id: args.from_gen_event_id,
      to_gen_event_id: args.to_gen_event_id,
      from_model_slug: fromEvent.model_slug,
      to_model_slug: toEvent.model_slug,
      analyzer_model_a: fromAnalyzer,
      analyzer_model_b: toAnalyzer,
    };
  }

  // Comparable path: load concept counts for each side, then diff.
  const fromConcepts = await loadConceptCounts(db, fromEvent.id);
  const toConcepts = await loadConceptCounts(db, toEvent.id);

  const fromIds = new Set(fromConcepts.map((c) => c.concept_id));
  const toIds = new Set(toConcepts.map((c) => c.concept_id));

  const fromMap = new Map(fromConcepts.map((c) => [c.concept_id, c]));

  const resolved: DiffConcept[] = [];
  const persisting: DiffConcept[] = [];
  const regressed: DiffConcept[] = [];
  const newBucket: DiffConcept[] = [];

  for (const c of fromConcepts) {
    if (!toIds.has(c.concept_id)) {
      resolved.push(toDiffConcept(c, c.count));
    }
  }
  for (const c of toConcepts) {
    if (fromIds.has(c.concept_id)) {
      const a = fromMap.get(c.concept_id)!;
      persisting.push(toDiffConcept(c, c.count - a.count));
    } else if (existedAtFromGen(c.first_seen, args.from_event_ts)) {
      // Concept already existed in the registry by the time gen_a was analyzed
      // but did not appear in gen_a's shortcomings. Now it does — the model
      // regressed (or it always had this issue but earlier analysis missed it).
      regressed.push(toDiffConcept(c, c.count));
    } else {
      // The concept was created AFTER gen_a's analysis event — not a model
      // regression but a fresh task category / analyzer-discovered concept.
      // UI distinguishes 'new' from 'regressed' so a deluge of new concepts
      // post-analyzer-update doesn't masquerade as a wave of model regressions.
      newBucket.push(toDiffConcept(c, c.count));
    }
  }

  return {
    status: "comparable",
    family_slug: args.family_slug,
    task_set_hash: args.task_set_hash,
    from_gen_event_id: args.from_gen_event_id,
    to_gen_event_id: args.to_gen_event_id,
    from_model_slug: fromEvent.model_slug,
    to_model_slug: toEvent.model_slug,
    analyzer_model_a: fromAnalyzer,
    analyzer_model_b: toAnalyzer,
    resolved,
    persisting,
    regressed,
    new: newBucket,
  };
}

interface EventRow {
  id: number;
  model_slug: string;
  payload_json: string;
}

/**
 * Read `analyzer_model` from an `analysis.completed` event's `payload_json`.
 *
 * **Cross-plan contract (Plan C):** Plan C's verify-step writes
 * `analysis.completed` events with a payload object that includes
 * `analyzer_model: string` (the model slug used by the analyzer LLM,
 * e.g. `'anthropic/claude-opus-4-6'`). The lifecycle event log
 * stringifies that object into `payload_json` at write time. This is the
 * canonical reader; callers MUST NOT pull `analyzer_model` from any
 * other location (envelope, root payload, etc.). If Plan C ever moves
 * the field, update this reader and Plan E together.
 *
 * Throws when the field is missing or empty — analyzer-mismatch logic
 * cannot proceed without it, and silently defaulting would produce
 * wrong diffs.
 */
export function parseAnalyzerModel(payloadJson: string): string {
  try {
    const p = JSON.parse(payloadJson) as { analyzer_model?: unknown };
    if (typeof p.analyzer_model !== "string" || p.analyzer_model.length === 0) {
      throw new Error("payload_json missing analyzer_model");
    }
    return p.analyzer_model;
  } catch (err) {
    throw new Error(
      `parseAnalyzerModel: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface ConceptCountRow {
  concept_id: number;
  slug: string;
  display_name: string;
  description: string;
  al_concept: string;
  count: number;
  first_seen: number;
}

async function loadConceptCounts(
  db: DiffDb,
  analysis_event_id: number,
): Promise<ConceptCountRow[]> {
  const res = await db.prepare(
    `SELECT c.id AS concept_id,
            c.slug,
            c.display_name,
            c.description,
            c.al_concept,
            c.first_seen,
            COUNT(s.id) AS count
       FROM shortcomings s
       JOIN concepts c ON c.id = s.concept_id
      WHERE s.analysis_event_id = ?
        AND c.superseded_by IS NULL
      GROUP BY c.id`,
  ).bind(analysis_event_id).all<ConceptCountRow>();
  return res.results;
}

function toDiffConcept(c: ConceptCountRow, delta: number): DiffConcept {
  return {
    concept_id: c.concept_id,
    slug: c.slug,
    display_name: c.display_name,
    description: c.description,
    al_concept: c.al_concept,
    delta,
  };
}

/**
 * Whether the concept already existed at the time gen_a was analyzed.
 *
 * Both arguments are unix-ms timestamps:
 *   - `conceptFirstSeen` from `concepts.first_seen` (set to `Date.now()`
 *     when the concept.created event lands).
 *   - `fromEventTs` from `lifecycle_events.ts` of gen_a's
 *     `analysis.completed` event.
 *
 * `<=` (not strict `<`) so a concept created in the same millisecond as
 * the analyzer ran is treated as pre-existing — strictness here only
 * matters for synthetic test fixtures, but `<=` is the conservative
 * choice (mis-bucketing one occurrence as `regressed` is preferable to
 * mis-bucketing it as `new` because the latter inflates the "model
 * worse on new things" signal).
 *
 * History: prior to the wave-5 critical-fix, this compared against
 * `lifecycle_events.id` (autoincrement) instead of `lifecycle_events.ts`
 * (unix-ms). The id-vs-ts unit mismatch silently broke production: ids
 * are ~10^4-10^6 while ts is ~10^12, so the comparison was always FALSE
 * and every pre-existing-concept regression got mis-bucketed as `new`.
 */
function existedAtFromGen(
  conceptFirstSeen: number,
  fromEventTs: number,
): boolean {
  return conceptFirstSeen <= fromEventTs;
}
