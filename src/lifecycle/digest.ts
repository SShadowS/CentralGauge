/**
 * Weekly lifecycle digest generator + CLI input fetcher.
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
import { type AppendOptions, queryEvents } from "./event-log.ts";
import { signPayload } from "../ingest/sign.ts";
import { postWithRetry } from "../ingest/client.ts";
import { cfAccessHeaders } from "../ingest/cf-access-headers.ts";

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

// ---------------------------------------------------------------------------
// CLI input fetcher
// ---------------------------------------------------------------------------

/**
 * Wire shape of the public `/api/v1/families` GET. Vendor-prefixed slugs
 * are the hash key for diff lookup.
 */
interface FamiliesListBody {
  data: Array<{ slug: string }>;
}

/**
 * Wire shape of the existing
 * `POST /api/v1/admin/lifecycle/cluster-review/queue` endpoint (D-data §D7.3).
 * The digest only needs slug + confidence + counts; the rest of the row
 * shape is ignored.
 */
interface ClusterReviewQueueBody {
  rows: Array<{
    id: number;
    model_slug: string;
    concept_slug_proposed: string;
    confidence: number;
    created_at: number;
  }>;
}

export interface FetchDigestInputsArgs {
  /** Production worker base URL (e.g. `https://centralgauge.example`). */
  siteUrl: string;
  /** Lower bound for `events.ts >= sinceMs` filter. */
  sinceMs: number;
  /** Admin signing key (Ed25519, 32 bytes). */
  privateKey: Uint8Array;
  /** Admin key id (matches `key_id` column in machine_keys). */
  keyId: number;
  /** Models to query. Caller fetches via `lifecycle status` first. */
  models: readonly string[];
  /**
   * Task-set hash to query lifecycle events under. Resolved client-side
   * by the CLI subcommand (matches `cycle` / `status` behaviour).
   */
  taskSetHash: string;
  /**
   * Test override for `fetch`. Production callers leave it undefined so it
   * falls through to the global. The cluster-review queue path uses
   * `postWithRetry` directly which is not stubbable here — tests that need
   * to stub the queue swap `queryFn`/`fetchFamiliesFn`/`fetchQueueFn` below.
   */
  fetchFn?: typeof fetch;
  /**
   * Test override for `queryEvents`. Defaults to the production helper.
   * Lets unit tests assert per-model fan-out without round-tripping the
   * worker.
   */
  queryFn?: typeof queryEvents;
  /** Test override for the families fetch. */
  fetchFamiliesFn?: (
    siteUrl: string,
    fetchFn: typeof fetch,
  ) => Promise<string[]>;
  /** Test override for the cluster-review queue fetch. */
  fetchQueueFn?: (
    args: { siteUrl: string; privateKey: Uint8Array; keyId: number },
  ) => Promise<ReviewQueueSummary>;
  /** Test override for the family-diff fetch. */
  fetchDiffFn?: (
    siteUrl: string,
    family: string,
    fetchFn: typeof fetch,
  ) => Promise<FamilyDiffRow | null>;
}

/**
 * Fetch the three input streams the digest needs:
 *
 *   1. Per-model lifecycle events (admin-signed GET, one round-trip per model).
 *   2. Family slugs from `/api/v1/families` (public) + per-family diff
 *      (`/api/v1/families/<slug>/diff`, public).
 *   3. Pending review queue via `cluster-review/queue` POST (admin Ed25519
 *      body-signed). The newer `/admin/lifecycle/review/queue` GET endpoint
 *      is CF-Access-only (see `site/src/lib/server/cf-access.ts` —
 *      `signedBody=null` is passed for read-only GETs); the CLI cannot
 *      authenticate to it, hence the cluster-review POST mirror.
 *
 * Returns an `Omit<DigestInput, "format">` ready for {@link generateDigest}.
 *
 * Failure isolation: a single family's diff fetch failure is swallowed
 * (logs to stderr); the other inputs proceed. A queue-fetch failure is
 * fatal because an absent queue count would silently misreport the
 * digest's "review queue depth" line.
 */
export async function fetchDigestInputs(
  args: FetchDigestInputsArgs,
): Promise<Omit<DigestInput, "format">> {
  const fetchFn = args.fetchFn ?? fetch;
  const queryFn = args.queryFn ?? queryEvents;
  const fetchFamiliesFn = args.fetchFamiliesFn ?? defaultFetchFamilies;
  const fetchQueueFn = args.fetchQueueFn ?? defaultFetchQueue;
  const fetchDiffFn = args.fetchDiffFn ?? defaultFetchDiff;

  const opts: AppendOptions = {
    url: args.siteUrl,
    privateKey: args.privateKey,
    keyId: args.keyId,
  };

  // 1. Events — one round-trip per model. Concurrency cap not needed at
  // the typical ~5–10 model count.
  //
  // `Promise.allSettled` (NOT `Promise.all`) is the canonical choice for
  // fan-out with per-model failure isolation: each model's promise either
  // resolves with its events or rejects with its error, and the
  // aggregator sorts them apart. `Promise.all` would propagate the FIRST
  // rejection and discard healthy results — the previous implementation
  // worked only because of a per-task try/catch that converted rejections
  // to empty results before `Promise.all` saw them. That's load-bearing
  // logic disguised as a defensive null-guard, easy to remove during
  // refactor under the assumption that `Promise.all` already isolates.
  // `allSettled` is self-documenting.
  const settled = await Promise.allSettled(
    args.models.map((slug) =>
      // `Promise.resolve().then(...)` defers the queryFn invocation into
      // a microtask so synchronous throws inside the function become
      // promise rejections that `allSettled` quarantines, matching the
      // semantics of the previous `async (slug) => { try { ... } }`
      // wrapper without re-introducing a per-task try/catch.
      Promise.resolve().then(() =>
        queryFn({
          model_slug: slug,
          task_set_hash: args.taskSetHash,
          since: args.sinceMs,
        }, opts)
      )
    ),
  );
  const eventBatches: LifecycleEvent[][] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    if (result.status === "fulfilled") {
      eventBatches.push(result.value);
    } else {
      // Operator sees a less-complete digest with a workflow-step
      // warning — failed model simply contributes no events.
      const slug = args.models[i] ?? "<unknown>";
      const err = result.reason;
      console.warn(
        `[digest] queryEvents failed for ${slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const events = eventBatches.flat();

  // 2. Family diffs. Public endpoints; no signature.
  const families = await fetchFamiliesFn(args.siteUrl, fetchFn);
  const familyDiffs: FamilyDiffRow[] = [];
  for (const family of families) {
    try {
      const diff = await fetchDiffFn(args.siteUrl, family, fetchFn);
      if (diff) familyDiffs.push(diff);
    } catch (err) {
      console.warn(
        `[digest] family-diff fetch failed for ${family}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // 3. Review queue (admin-signed POST, mandatory).
  const reviewQueue = await fetchQueueFn({
    siteUrl: args.siteUrl,
    privateKey: args.privateKey,
    keyId: args.keyId,
  });

  return {
    events,
    familyDiffs,
    reviewQueue,
    sinceMs: args.sinceMs,
  };
}

async function defaultFetchFamilies(
  siteUrl: string,
  fetchFn: typeof fetch,
): Promise<string[]> {
  const resp = await fetchFn(`${siteUrl}/api/v1/families`);
  if (!resp.ok) throw new Error(`families list failed (${resp.status})`);
  const body = await resp.json() as FamiliesListBody;
  return body.data.map((f) => f.slug);
}

async function defaultFetchDiff(
  siteUrl: string,
  family: string,
  fetchFn: typeof fetch,
): Promise<FamilyDiffRow | null> {
  const resp = await fetchFn(`${siteUrl}/api/v1/families/${family}/diff`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`family-diff failed (${resp.status})`);
  const body = await resp.json() as FamilyDiffRow;
  return body;
}

async function defaultFetchQueue(
  args: { siteUrl: string; privateKey: Uint8Array; keyId: number },
): Promise<ReviewQueueSummary> {
  const payload = { scope: "list" as const, ts: Date.now() };
  const sig = await signPayload(payload, args.privateKey, args.keyId);
  const resp = await postWithRetry(
    `${args.siteUrl}/api/v1/admin/lifecycle/cluster-review/queue`,
    { version: 1, payload, signature: sig },
    {},
    cfAccessHeaders(),
  );
  if (!resp.ok) {
    throw new Error(
      `cluster-review/queue failed (${resp.status}): ${await resp.text()}`,
    );
  }
  const body = await resp.json() as ClusterReviewQueueBody;
  return {
    pending_count: body.rows.length,
    rows: body.rows.map((r) => ({
      id: r.id,
      model_slug: r.model_slug,
      concept_slug_proposed: r.concept_slug_proposed,
      confidence: r.confidence,
      created_at: r.created_at,
    })),
  };
}
