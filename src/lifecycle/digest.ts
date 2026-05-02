/**
 * Weekly lifecycle digest generator.
 *
 * Reads {@link LifecycleEvent}s + family diffs + review queue counts and
 * renders either a markdown report (for the GitHub issue) or JSON (for
 * downstream tooling). Pure function — no I/O. Caller fetches inputs.
 *
 * Architecture: Plan G's `lifecycle digest` CLI subcommand collects the
 * three input streams via the lifecycle admin endpoints (events,
 * review/queue) plus the public family-diff endpoint, then hands them to
 * {@link generateDigest}. Keeping the renderer pure makes it trivially
 * unit-testable with synthetic fixtures (see
 * `tests/unit/lifecycle/digest.fixture.ts`) — the integration cost of
 * spinning up a worker for every render assertion is unacceptable.
 *
 * Cross-plan invariants (see `docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md`):
 *
 *   - Event types come from the canonical 29 in `src/lifecycle/types.ts`.
 *     The digest reads them by string-suffix matching (`.failed`,
 *     `.completed`) — no new types invented here.
 *   - Slugs are vendor-prefixed end-to-end (Plan B) — no `VENDOR_PREFIX_MAP`
 *     re-introduction.
 *   - The JSON shape is the wire contract the workflow YAML reads; renames
 *     here MUST be coordinated with `.github/workflows/weekly-cycle.yml`.
 *
 * @module src/lifecycle/digest
 */
import type { LifecycleEvent } from "./types.ts";

/**
 * Subset of Plan E's `FamilyDiff` shape (`site/src/lib/shared/api-types.ts`)
 * that the digest needs. Slugs are vendor-prefixed end-to-end per Plan B's
 * invariant. Optional fields default to absent / empty arrays so non-
 * `comparable` diffs are skipped gracefully.
 */
export interface FamilyDiffRow {
  family_slug?: string;
  task_set_hash?: string;
  from_gen_event_id?: number | null;
  to_gen_event_id?: number | null;
  from_model_slug?: string | null;
  to_model_slug?: string | null;
  status: "comparable" | "analyzer_mismatch" | "baseline_missing";
  analyzer_model_a?: string | null;
  analyzer_model_b?: string | null;
  resolved?: { slug: string }[];
  persisting?: { slug: string }[];
  regressed?: { slug: string }[];
  new?: { slug: string }[];
}

/**
 * Review queue summary the digest consumes. The {@link generateDigest}
 * function expects this internal shape; the CLI helper that fetches the
 * actual `/api/v1/admin/lifecycle/review/queue` body (which returns
 * `{ entries, count }`) normalises into this shape before calling.
 */
export interface ReviewQueueSummary {
  pending_count: number;
  rows: Array<{
    id: number;
    model_slug: string;
    concept_slug_proposed: string;
    confidence: number;
    created_at: number;
  }>;
}

export interface DigestInput {
  events: LifecycleEvent[];
  familyDiffs: FamilyDiffRow[];
  reviewQueue: ReviewQueueSummary;
  sinceMs: number;
  format: "markdown" | "json";
}

interface ModelStateRow {
  model_slug: string;
  task_set_hash: string;
  last_event: string;
  last_ts: number;
  publish_count: number;
  failure_count: number;
}

interface RegressionRow {
  family_slug: string;
  from_model_slug: string;
  to_model_slug: string;
  concept_slug: string;
}

interface RenderArgs {
  models: ModelStateRow[];
  newConcepts: LifecycleEvent[];
  regressions: RegressionRow[];
  failures: LifecycleEvent[];
  reviewQueue: ReviewQueueSummary;
}

/**
 * Build a markdown or JSON digest from already-fetched lifecycle inputs.
 *
 * Sections:
 *   - Per-model state (one row per (model, task_set) seen in `events`)
 *   - New concepts (counted from `concept.created` events)
 *   - Regressions detected (joined to `comparable`-status family diffs)
 *   - Failures (any `*.failed` event from the canonical 29)
 *   - Review queue (`pending_review.status='pending'` count + sample rows)
 *
 * Empty input collapses to an "All clear" summary — keeps the operator's
 * sticky GitHub issue tidy on quiet weeks.
 */
export function generateDigest(input: DigestInput): Promise<string> {
  // Synchronous logic; wrapped in `Promise.resolve` so the public surface
  // is async (matches caller patterns, lets us add I/O later w/o churn).
  const recent = input.events.filter((e) => e.ts >= input.sinceMs);

  const models = aggregatePerModel(recent);
  const newConcepts = recent.filter((e) => e.event_type === "concept.created");
  const regressions = collectRegressions(input.familyDiffs);
  const failures = recent.filter((e) =>
    e.event_type === "cycle.failed" ||
    e.event_type === "bench.failed" ||
    e.event_type === "analysis.failed" ||
    e.event_type === "publish.failed" ||
    e.event_type === "debug.failed"
  );

  if (input.format === "json") {
    return Promise.resolve(JSON.stringify(
      {
        since_ms: input.sinceMs,
        models,
        new_concepts: newConcepts.map((e) => ({
          model_slug: e.model_slug,
          ts: e.ts,
          ...(safeParseJson(e.payload_json)),
        })),
        regressions,
        failures: failures.map((e) => ({
          model_slug: e.model_slug,
          event_type: e.event_type,
          ts: e.ts,
          ...(safeParseJson(e.payload_json)),
        })),
        review_queue: input.reviewQueue,
      },
      null,
      2,
    ));
  }

  return Promise.resolve(renderMarkdown({
    models,
    newConcepts,
    regressions,
    failures,
    reviewQueue: input.reviewQueue,
  }));
}

/**
 * Reduce events into one-row-per-(model, task_set) summaries. The "last
 * event" column tracks whichever event has the highest `ts` for the pair;
 * `publish_count` and `failure_count` are running tallies over the window.
 */
function aggregatePerModel(events: LifecycleEvent[]): ModelStateRow[] {
  const byKey = new Map<string, ModelStateRow>();
  for (const e of events) {
    const key = `${e.model_slug}|${e.task_set_hash}`;
    const row = byKey.get(key) ?? {
      model_slug: e.model_slug,
      task_set_hash: e.task_set_hash,
      last_event: e.event_type,
      last_ts: e.ts,
      publish_count: 0,
      failure_count: 0,
    };
    if (e.ts > row.last_ts) {
      row.last_event = e.event_type;
      row.last_ts = e.ts;
    }
    if (e.event_type === "publish.completed") row.publish_count++;
    if (e.event_type.endsWith(".failed")) row.failure_count++;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) =>
    a.model_slug.localeCompare(b.model_slug)
  );
}

/**
 * Project family-diff rows into a flat regression list. Only `comparable`
 * diffs contribute — `analyzer_mismatch` / `baseline_missing` are excluded
 * (the regressed slugs aren't comparable across mismatched analyzers).
 */
function collectRegressions(diffs: FamilyDiffRow[]): RegressionRow[] {
  const out: RegressionRow[] = [];
  for (const d of diffs) {
    if (d.status !== "comparable") continue;
    for (const c of d.regressed ?? []) {
      out.push({
        family_slug: d.family_slug ?? "(unknown)",
        from_model_slug: d.from_model_slug ?? "(unknown)",
        to_model_slug: d.to_model_slug ?? "(unknown)",
        concept_slug: c.slug,
      });
    }
  }
  return out;
}

/**
 * Defensive JSON.parse. A malformed `payload_json` row used to crash the
 * whole digest render; now the offending row contributes an empty object
 * to its event's spread and the render continues.
 */
function safeParseJson(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null
      ? v as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function renderMarkdown(args: RenderArgs): string {
  const { models, newConcepts, regressions, failures, reviewQueue } = args;
  const allClear = models.length === 0 && newConcepts.length === 0 &&
    regressions.length === 0 && failures.length === 0 &&
    reviewQueue.pending_count === 0;

  const lines: string[] = [];
  lines.push("# Weekly lifecycle digest");
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()}._`);
  lines.push("");

  if (allClear) {
    lines.push("**All clear.** No state changes in the digest window.");
    lines.push("");
    lines.push("- No new concepts");
    lines.push("- No regressions");
    lines.push("- No failures");
    lines.push("- Review queue empty");
    return lines.join("\n");
  }

  lines.push("## Per-model state");
  lines.push("");
  if (models.length === 0) {
    lines.push("_No model activity in window._");
  } else {
    lines.push("| Model | Task set | Last event | Publishes | Failures |");
    lines.push("|---|---|---|---|---|");
    for (const m of models) {
      lines.push(
        `| ${m.model_slug} | ${m.task_set_hash} | ${m.last_event} | ${m.publish_count} | ${m.failure_count} |`,
      );
    }
  }
  lines.push("");

  lines.push(`## New concepts (${newConcepts.length})`);
  lines.push("");
  if (newConcepts.length === 0) {
    lines.push("_No new concepts._");
  } else {
    for (const e of newConcepts) {
      const p = safeParseJson(e.payload_json);
      const slug = typeof p["slug"] === "string" ? p["slug"] : "(unknown)";
      const analyzer = typeof p["analyzer_model"] === "string"
        ? p["analyzer_model"]
        : "n/a";
      lines.push(
        `- \`${slug}\` (model: ${e.model_slug}, analyzer: ${analyzer})`,
      );
    }
  }
  lines.push("");

  lines.push(`## Regressions detected (${regressions.length})`);
  lines.push("");
  if (regressions.length === 0) {
    lines.push("_No regressions._");
  } else {
    for (const r of regressions) {
      lines.push(
        `- \`${r.concept_slug}\` (${r.family_slug}: ${r.from_model_slug} → ${r.to_model_slug})`,
      );
    }
  }
  lines.push("");

  lines.push(`## Failures (${failures.length})`);
  lines.push("");
  if (failures.length === 0) {
    lines.push("_No failures._");
  } else {
    for (const e of failures) {
      const p = safeParseJson(e.payload_json);
      const errorCode = typeof p["error_code"] === "string"
        ? p["error_code"]
        : "?";
      const errorMessage = typeof p["error_message"] === "string"
        ? p["error_message"]
        : "";
      lines.push(
        `- **${e.model_slug}** — ${e.event_type}: \`${errorCode}\` ${errorMessage}`
          .trim(),
      );
    }
  }
  lines.push("");

  lines.push(`## Review queue (${reviewQueue.pending_count} pending)`);
  lines.push("");
  if (reviewQueue.pending_count === 0) {
    lines.push("_Review queue empty._");
  } else {
    for (const r of reviewQueue.rows) {
      lines.push(
        `- ${r.model_slug}: \`${r.concept_slug_proposed}\` (confidence ${
          r.confidence.toFixed(2)
        })`,
      );
    }
  }

  return lines.join("\n");
}
