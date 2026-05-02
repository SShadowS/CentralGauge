/**
 * Synthetic test fixture for the lifecycle digest generator.
 *
 * Spans 7 days, three models, and a representative event mix:
 *
 *   - opus-4-7  : bench → analysis → concept.created → publish (happy path)
 *   - gpt-5.5   : cycle.failed mid-week (analyzer timeout)
 *   - sonnet-4-6: analysis.rejected with reviewer commentary (reject path)
 *
 * Plus a fixture family-diff with one regressed concept and a one-row
 * pending-review queue. Times anchor on `2026-05-05 06:00 UTC` so tests
 * remain deterministic regardless of when the suite runs.
 *
 * @module tests/unit/lifecycle/digest.fixture
 */
import type { LifecycleEvent } from "../../../src/lifecycle/types.ts";

/** Anchor point: 2026-05-05 06:00 UTC (a Monday). */
export const NOW = Date.UTC(2026, 4, 5, 6, 0, 0);
export const DAY = 86_400_000;

export const FIXTURE_EVENTS: LifecycleEvent[] = [
  {
    id: 1,
    ts: NOW - 6 * DAY,
    model_slug: "anthropic/claude-opus-4-7",
    task_set_hash: "ts-current",
    event_type: "bench.completed",
    payload_json: JSON.stringify({ runs_count: 1, tasks_count: 50 }),
    actor: "ci",
    actor_id: "github-actions",
  },
  {
    id: 2,
    ts: NOW - 6 * DAY + 600_000,
    model_slug: "anthropic/claude-opus-4-7",
    task_set_hash: "ts-current",
    event_type: "analysis.completed",
    payload_json: JSON.stringify({ entries_count: 7, min_confidence: 0.82 }),
    actor: "ci",
    actor_id: "github-actions",
  },
  {
    id: 3,
    ts: NOW - 6 * DAY + 660_000,
    model_slug: "anthropic/claude-opus-4-7",
    task_set_hash: "ts-current",
    event_type: "concept.created",
    payload_json: JSON.stringify({
      concept_id: 42,
      slug: "tableextension-fields-merge",
      analyzer_model: "anthropic/claude-opus-4-6",
    }),
    actor: "ci",
    actor_id: "github-actions",
  },
  {
    id: 4,
    ts: NOW - 6 * DAY + 720_000,
    model_slug: "anthropic/claude-opus-4-7",
    task_set_hash: "ts-current",
    event_type: "publish.completed",
    payload_json: JSON.stringify({ upserted: 7, occurrences: 12 }),
    actor: "ci",
    actor_id: "github-actions",
  },
  {
    id: 5,
    ts: NOW - 4 * DAY,
    model_slug: "openai/gpt-5.5",
    task_set_hash: "ts-current",
    event_type: "cycle.failed",
    payload_json: JSON.stringify({
      failed_step: "analyze",
      error_code: "ANALYZER_TIMEOUT",
      error_message: "verify --shortcomings-only timed out after 1800s",
    }),
    actor: "ci",
    actor_id: "github-actions",
  },
  {
    id: 6,
    ts: NOW - DAY,
    model_slug: "anthropic/claude-sonnet-4-6",
    task_set_hash: "ts-current",
    event_type: "analysis.rejected",
    payload_json: JSON.stringify({
      pending_review_id: 11,
      reviewer: "operator@example.com",
      reason: "concept slug hallucinated",
    }),
    actor: "reviewer",
    actor_id: "operator@example.com",
  },
];

/**
 * Shape mirrors Plan E's `FamilyDiff` from
 * `site/src/lib/shared/api-types.ts`. The digest's `gen_a` / `gen_b` labels
 * are derived from `from_model_slug` / `to_model_slug` (vendor-prefixed
 * end-to-end per Plan B's invariant).
 */
export const FIXTURE_FAMILY_DIFFS = [
  {
    family_slug: "anthropic/claude-opus",
    task_set_hash: "ts-current",
    from_gen_event_id: 100,
    to_gen_event_id: 200,
    from_model_slug: "anthropic/claude-opus-4-6",
    to_model_slug: "anthropic/claude-opus-4-7",
    status: "comparable" as const,
    analyzer_model_a: "anthropic/claude-opus-4-6",
    analyzer_model_b: "anthropic/claude-opus-4-6",
    resolved: [{ slug: "flowfield-calcfields-requirement" }],
    persisting: [{ slug: "reserved-keyword-as-parameter-name" }],
    regressed: [{ slug: "page-layout-grouping-required" }],
    new: [{ slug: "tableextension-fields-merge" }],
  },
];

export const FIXTURE_REVIEW_QUEUE = {
  pending_count: 1,
  rows: [
    {
      id: 11,
      model_slug: "anthropic/claude-sonnet-4-6",
      concept_slug_proposed:
        "interface-procedure-without-implementation-section",
      confidence: 0.42,
      created_at: NOW - 2 * DAY,
    },
  ],
};
