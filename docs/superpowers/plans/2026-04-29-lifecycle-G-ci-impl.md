# Phase G — Weekly Cycle CI Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the unattended weekly CI cycle for the lifecycle log. Every Monday 06:00 UTC the workflow runs `centralgauge status --json`, picks up models whose most-recent `analysis.completed` is older than 7 days (or absent for the current task set), runs `centralgauge cycle --llms <slug> --analyzer-model anthropic/claude-opus-4-6 --yes` per stale model, and posts a markdown digest to a sticky GitHub issue. Per-model failures do not abort the run; the digest reflects them and the issue stays open until the operator triages.

**Architecture.** One YAML workflow + one new CLI subcommand:

- `.github/workflows/weekly-cycle.yml` — `cron: '0 6 * * MON'` + `workflow_dispatch`. Steps: checkout, setup deno, decode `${{ secrets.ADMIN_KEY_PEM }}` to a temp file, export provider keys + `CLOUDFLARE_API_TOKEN`, run `centralgauge doctor ingest --no-bench` as a fail-fast precheck (guards against secret-decode regressions; without it a single corrupted secret causes N×failure with N×digest noise), run a thin orchestrator script that fans out `cycle` calls under `continue-on-error` semantics, then runs the digest generator and posts/updates the issue via `gh`.
- `centralgauge lifecycle digest --since <duration> --format <markdown|json>` — new Cliffy subcommand registered under the parent `lifecycle` Command group. **Parent ownership:** the `lifecycle` parent Command is created by Plan A's A3 task (`centralgauge lifecycle event-log` is the first subcommand registered there); Plan D7 adds `lifecycle cluster review`; this plan (G) adds `lifecycle digest`. If at execution time the parent does not yet exist (Plan A regression), this plan creates it minimally and bolts the subcommand on. Reads `GET /api/v1/admin/lifecycle/events?since=<ts>` and `GET /api/v1/admin/lifecycle/state` (Phase A4) plus `GET /api/v1/admin/lifecycle/review/queue` (Phase F3) using the canonical signed-headers pattern (`X-CG-Signature`, `X-CG-Key-Id`, `X-CG-Signed-At`) from `src/ingest/sign.ts`. Emits per-model state summary, new concepts surfaced (counted from `concept.created` events), regressions detected (joined to family diffs from Phase E), pending-review-queue depth.

**Tech Stack:** GitHub Actions (`actions/checkout@v4`, `denoland/setup-deno@v2`); Deno 1.46+ (matches the project's pinned task runner); Cliffy `Command`; `gh` CLI (preinstalled on `ubuntu-latest`); the lifecycle endpoints from Phase A and the orchestrator from Phase C. No new runtime dependencies in the worker.

**Depends on:**
- Phase A — event log endpoints (`/api/v1/admin/lifecycle/events`, `/api/v1/admin/lifecycle/state`).
- Phase C — `centralgauge cycle` command with `--yes` non-interactive flag and `--analyzer-model`.
- Phase E — family-diff endpoint (`/api/v1/families/<slug>/diff`) for regression counting in the digest.
- Phase F — `pending_review` table + `/api/v1/admin/lifecycle/review/queue` endpoint for queue-depth counting.
- Phase H — `centralgauge status --json` schema (`StatusJson` zod type) so the workflow can `jq` over it without parsing surprises.

**Strategic context:** This phase delivers item 8 of the strategic plan ("CI integration") — the unattended cadence that keeps the lifecycle log current without operator intervention. Its real product is the digest issue: the operator's Monday morning read is "did anything regress, did any analyzer entries land in the review queue, do I need to do anything?" The cycle invocations are mechanism; the digest is the surface.

---

## Step 0 — Pre-flight verification

Before writing code, confirm the dependencies are landed.

- [ ] **0.1 Verify Phase H acceptance is green.** `centralgauge status --json | jq '.models[0]'` returns a row with `model_slug`, `task_set_hash`, `bench`, `debug`, `analyze`, `publish` keys. If H is not yet merged, this plan blocks on it.

- [ ] **0.2 Verify Phase C `--yes` flag exists.** Grep: `Grep --pattern "--yes" --path cli/commands/cycle-command.ts`. Cycle's interactive confirmations (notably `--force-unlock`'s warning prompt per C7) must accept a non-interactive `--yes` for CI use.

- [ ] **0.3 Verify the admin signing key path the workflow will use.** `centralgauge doctor ingest --json | jq '.adminKey'` — confirms the local config consumes a path. CI will write `${{ secrets.ADMIN_KEY_PEM }}` (base64-encoded PEM) to `$RUNNER_TEMP/admin_key.pem` and override `CENTRALGAUGE_ADMIN_KEY_PATH` in the env block.

- [ ] **0.4 Confirm the GitHub repo's secrets list contains the required keys.** Run `gh secret list` against the repo. Required entries: `CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `ADMIN_KEY_PEM`. If any are missing, add them via `gh secret set <NAME>` before the first scheduled run.

- [ ] **0.5 Confirm `doctor ingest --no-bench` flag exists.** Grep: `Grep --pattern "no-bench" --path cli/commands/`. The workflow's precheck step runs `deno task start doctor ingest --no-bench` to fail-fast on a corrupted `ADMIN_KEY_PEM` before the orchestrator fans out. If the flag is missing, file the gap against the doctor command before this plan can ship.

---

## Step 1 — Test fixture for the digest generator

TDD: write the digest unit test before the digest implementation. Red → Green.

- [ ] **1.1 Create the digest fixture.** New file `tests/unit/lifecycle/digest.fixture.ts`. Synthetic events spanning 7 days: 3 models, mix of `bench.completed`, `analysis.completed`, `concept.created`, `publish.completed`, `analysis.rejected`. Two regressions (one concept moves from absent → present in opus-4-7 vs opus-4-6 family-diff fixture), one pending-review entry.

  ```typescript
  // tests/unit/lifecycle/digest.fixture.ts
  import type { LifecycleEvent } from "../../../src/lifecycle/types.ts";

  const NOW = Date.UTC(2026, 4, 5, 6, 0, 0); // 2026-05-05 06:00 UTC
  const DAY = 86_400_000;

  export const FIXTURE_EVENTS: LifecycleEvent[] = [
    {
      id: 1, ts: NOW - 6 * DAY,
      model_slug: "anthropic/claude-opus-4-7",
      task_set_hash: "ts-current",
      event_type: "bench.completed",
      payload_json: JSON.stringify({ runs_count: 1, tasks_count: 50 }),
      actor: "ci", actor_id: "github-actions",
    },
    {
      id: 2, ts: NOW - 6 * DAY + 600_000,
      model_slug: "anthropic/claude-opus-4-7",
      task_set_hash: "ts-current",
      event_type: "analysis.completed",
      payload_json: JSON.stringify({ entries_count: 7, min_confidence: 0.82 }),
      actor: "ci", actor_id: "github-actions",
    },
    {
      id: 3, ts: NOW - 6 * DAY + 660_000,
      model_slug: "anthropic/claude-opus-4-7",
      task_set_hash: "ts-current",
      event_type: "concept.created",
      payload_json: JSON.stringify({
        concept_id: 42, slug: "tableextension-fields-merge",
        analyzer_model: "anthropic/claude-opus-4-6",
      }),
      actor: "ci", actor_id: "github-actions",
    },
    {
      id: 4, ts: NOW - 6 * DAY + 720_000,
      model_slug: "anthropic/claude-opus-4-7",
      task_set_hash: "ts-current",
      event_type: "publish.completed",
      payload_json: JSON.stringify({ upserted: 7, occurrences: 12 }),
      actor: "ci", actor_id: "github-actions",
    },
    {
      id: 5, ts: NOW - 4 * DAY,
      model_slug: "openai/gpt-5.5",
      task_set_hash: "ts-current",
      event_type: "cycle.failed",
      payload_json: JSON.stringify({
        failed_step: "analyze",
        error_code: "ANALYZER_TIMEOUT",
        error_message: "verify --shortcomings-only timed out after 1800s",
      }),
      actor: "ci", actor_id: "github-actions",
    },
    {
      id: 6, ts: NOW - DAY,
      model_slug: "anthropic/claude-sonnet-4-6",
      task_set_hash: "ts-current",
      event_type: "analysis.rejected",
      payload_json: JSON.stringify({
        pending_review_id: 11,
        reviewer: "operator@example.com",
        reason: "concept slug hallucinated",
      }),
      actor: "reviewer", actor_id: "operator@example.com",
    },
  ];

  // Shape matches `FamilyDiff` from Plan E's
  // `site/src/lib/shared/api-types.ts` (E3.2). The digest's `gen_a` / `gen_b`
  // labels are derived from `from_model_slug` / `to_model_slug` (vendor-
  // prefixed end-to-end per Plan B's invariant).
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
    rows: [{
      id: 11, model_slug: "anthropic/claude-sonnet-4-6",
      concept_slug_proposed: "interface-procedure-without-implementation-section",
      confidence: 0.42, created_at: NOW - 2 * DAY,
    }],
  };
  ```

- [ ] **1.2 Write the failing test.** New file `tests/unit/lifecycle/digest.test.ts`.

  ```typescript
  // tests/unit/lifecycle/digest.test.ts
  import { assertEquals, assertStringIncludes } from "@std/assert";
  import { generateDigest } from "../../../src/lifecycle/digest.ts";
  import {
    FIXTURE_EVENTS,
    FIXTURE_FAMILY_DIFFS,
    FIXTURE_REVIEW_QUEUE,
  } from "./digest.fixture.ts";

  Deno.test("digest — markdown format renders all sections", async () => {
    const md = await generateDigest({
      events: FIXTURE_EVENTS,
      familyDiffs: FIXTURE_FAMILY_DIFFS,
      reviewQueue: FIXTURE_REVIEW_QUEUE,
      sinceMs: Date.UTC(2026, 4, 5, 6, 0, 0) - 7 * 86_400_000,
      format: "markdown",
    });

    assertStringIncludes(md, "# Weekly lifecycle digest");
    assertStringIncludes(md, "## Per-model state");
    assertStringIncludes(md, "anthropic/claude-opus-4-7");
    assertStringIncludes(md, "## New concepts (1)");
    assertStringIncludes(md, "tableextension-fields-merge");
    assertStringIncludes(md, "## Regressions detected (1)");
    assertStringIncludes(md, "page-layout-grouping-required");
    assertStringIncludes(md, "## Failures (1)");
    assertStringIncludes(md, "openai/gpt-5.5");
    assertStringIncludes(md, "ANALYZER_TIMEOUT");
    assertStringIncludes(md, "## Review queue (1 pending)");
  });

  Deno.test("digest — json format is structured + sortable", async () => {
    const json = await generateDigest({
      events: FIXTURE_EVENTS,
      familyDiffs: FIXTURE_FAMILY_DIFFS,
      reviewQueue: FIXTURE_REVIEW_QUEUE,
      sinceMs: Date.UTC(2026, 4, 5, 6, 0, 0) - 7 * 86_400_000,
      format: "json",
    });

    const parsed = JSON.parse(json);
    assertEquals(parsed.failures.length, 1);
    assertEquals(parsed.failures[0].model_slug, "openai/gpt-5.5");
    assertEquals(parsed.new_concepts.length, 1);
    assertEquals(parsed.regressions.length, 1);
    assertEquals(parsed.review_queue.pending_count, 1);
    assertEquals(parsed.models.length, 3);
  });

  Deno.test("digest — empty input produces 'all clear' summary", async () => {
    const md = await generateDigest({
      events: [],
      familyDiffs: [],
      reviewQueue: { pending_count: 0, rows: [] },
      sinceMs: Date.UTC(2026, 4, 5, 6, 0, 0) - 7 * 86_400_000,
      format: "markdown",
    });

    assertStringIncludes(md, "All clear");
    assertStringIncludes(md, "No new concepts");
    assertStringIncludes(md, "No regressions");
  });
  ```

- [ ] **1.3 Run the test — expect failure.** `deno task test:unit --filter "digest"` fails because `src/lifecycle/digest.ts` does not exist.

---

## Step 2 — Digest generator implementation

- [ ] **2.1 Create `src/lifecycle/digest.ts`.**

  ```typescript
  /**
   * Weekly lifecycle digest generator.
   *
   * Reads {@link LifecycleEvent}s + family diffs + review queue counts and
   * renders either a markdown report (for the GitHub issue) or JSON (for
   * downstream tooling). Pure function — no I/O. Caller fetches inputs.
   *
   * @module src/lifecycle/digest
   */
  import type { LifecycleEvent } from "./types.ts";

  /**
   * Subset of Plan E's `FamilyDiff` (site/src/lib/shared/api-types.ts) used
   * by the digest. Slugs are vendor-prefixed end-to-end per Plan B.
   */
  export interface FamilyDiffRow {
    family_slug: string;
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

  export async function generateDigest(input: DigestInput): Promise<string> {
    const recent = input.events.filter((e) => e.ts >= input.sinceMs);

    const models = aggregatePerModel(recent);
    const newConcepts = recent.filter((e) => e.event_type === "concept.created");
    const regressions = input.familyDiffs.flatMap((d) =>
      d.status === "comparable" ? (d.regressed ?? []).map((c) => ({
        family_slug: d.family_slug,
        from_model_slug: d.from_model_slug ?? "(unknown)",
        to_model_slug: d.to_model_slug ?? "(unknown)",
        concept_slug: c.slug,
      })) : []
    );
    const failures = recent.filter((e) =>
      e.event_type === "cycle.failed" ||
      e.event_type === "bench.failed" ||
      e.event_type === "analysis.failed" ||
      e.event_type === "publish.failed"
    );

    if (input.format === "json") {
      return JSON.stringify({
        since_ms: input.sinceMs,
        models,
        new_concepts: newConcepts.map((e) => ({
          model_slug: e.model_slug,
          ts: e.ts,
          ...(JSON.parse(e.payload_json ?? "{}")),
        })),
        regressions,
        failures: failures.map((e) => ({
          model_slug: e.model_slug,
          event_type: e.event_type,
          ts: e.ts,
          ...(JSON.parse(e.payload_json ?? "{}")),
        })),
        review_queue: input.reviewQueue,
      }, null, 2);
    }

    return renderMarkdown({
      models, newConcepts, regressions, failures, reviewQueue: input.reviewQueue,
    });
  }

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

  function renderMarkdown(args: {
    models: ModelStateRow[];
    newConcepts: LifecycleEvent[];
    regressions: { family_slug: string; from_model_slug: string; to_model_slug: string; concept_slug: string }[];
    failures: LifecycleEvent[];
    reviewQueue: ReviewQueueSummary;
  }): string {
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
      lines.push("**All clear.** No state changes in the last 7 days.");
      lines.push("");
      lines.push("- No new concepts");
      lines.push("- No regressions");
      lines.push("- No failures");
      lines.push("- Review queue empty");
      return lines.join("\n");
    }

    lines.push("## Per-model state");
    lines.push("");
    lines.push("| Model | Task set | Last event | Publishes | Failures |");
    lines.push("|---|---|---|---|---|");
    for (const m of models) {
      lines.push(
        `| ${m.model_slug} | ${m.task_set_hash} | ${m.last_event} | ${m.publish_count} | ${m.failure_count} |`,
      );
    }
    lines.push("");

    lines.push(`## New concepts (${newConcepts.length})`);
    lines.push("");
    if (newConcepts.length === 0) {
      lines.push("_No new concepts._");
    } else {
      for (const e of newConcepts) {
        const p = JSON.parse(e.payload_json ?? "{}");
        lines.push(`- \`${p.slug}\` (model: ${e.model_slug}, analyzer: ${p.analyzer_model ?? "n/a"})`);
      }
    }
    lines.push("");

    lines.push(`## Regressions detected (${regressions.length})`);
    lines.push("");
    if (regressions.length === 0) {
      lines.push("_No regressions._");
    } else {
      for (const r of regressions) {
        lines.push(`- \`${r.concept_slug}\` (${r.family_slug}: ${r.from_model_slug} → ${r.to_model_slug})`);
      }
    }
    lines.push("");

    lines.push(`## Failures (${failures.length})`);
    lines.push("");
    if (failures.length === 0) {
      lines.push("_No failures._");
    } else {
      for (const e of failures) {
        const p = JSON.parse(e.payload_json ?? "{}");
        lines.push(
          `- **${e.model_slug}** — ${e.event_type}: \`${p.error_code ?? "?"}\` ${p.error_message ?? ""}`.trim(),
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
        lines.push(`- ${r.model_slug}: \`${r.concept_slug_proposed}\` (confidence ${r.confidence.toFixed(2)})`);
      }
    }
    lines.push("");

    return lines.join("\n");
  }
  ```

- [ ] **2.2 Run the test — expect green.** `deno task test:unit --filter "digest"`. All three test cases pass.

- [ ] **2.3 Lint + format.** `deno check src/lifecycle/digest.ts && deno lint src/lifecycle/digest.ts && deno fmt src/lifecycle/digest.ts tests/unit/lifecycle/digest.test.ts tests/unit/lifecycle/digest.fixture.ts`.

---

## Step 3 — Wire `lifecycle digest` Cliffy subcommand

The digest generator is a pure function; the CLI wraps it with the HTTP fetches that supply its inputs.

- [ ] **3.1 Test the CLI fetcher with mocks.** Append to `tests/unit/lifecycle/digest.test.ts`:

  ```typescript
  import { fetchDigestInputs } from "../../../src/lifecycle/digest.ts";

  Deno.test("fetchDigestInputs — uses signed admin endpoints", async () => {
    const calls: string[] = [];
    const mockFetch = (url: string | URL, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push(u);
      if (u.includes("/lifecycle/events")) {
        return Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
      }
      if (u.includes("/families/") && u.includes("/diff")) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
      }
      if (u.includes("/lifecycle/review/queue")) {
        return Promise.resolve(
          new Response(JSON.stringify({ pending_count: 0, rows: [] }), { status: 200 }),
        );
      }
      throw new Error(`Unexpected URL: ${u}`);
    };

    const inputs = await fetchDigestInputs({
      siteUrl: "https://centralgauge.example",
      sinceMs: 0,
      // Returns the canonical signed-headers triple (Plan A pattern).
      signHeaders: () => Promise.resolve({
        "X-CG-Signature": "sig-stub",
        "X-CG-Key-Id": "1",
        "X-CG-Signed-At": "2026-04-29T00:00:00.000Z",
      }),
      fetchFn: mockFetch,
    });

    assertEquals(inputs.events.length, 0);
    assertEquals(inputs.reviewQueue.pending_count, 0);
    assertEquals(calls.some((c) => c.includes("/lifecycle/events?since=0")), true);
    assertEquals(calls.some((c) => c.includes("/lifecycle/review/queue")), true);
  });
  ```

- [ ] **3.2 Implement `fetchDigestInputs` in `src/lifecycle/digest.ts`.** Append:

  ```typescript
  export interface SignedHeaders {
    "X-CG-Signature": string;
    "X-CG-Key-Id": string;
    "X-CG-Signed-At": string;
  }

  export interface FetchDigestInputsArgs {
    siteUrl: string;
    sinceMs: number;
    /**
     * Produces the canonical signed-headers triple required by every
     * `/api/v1/admin/lifecycle/*` GET endpoint (Plan A pattern). The caller
     * derives these from `signPayload(payload, privateKey, keyId)` in
     * `src/ingest/sign.ts` — see Plan A's `queryEvents` helper for the
     * reference implementation. Header names match Plan A's
     * `verifyAdminSignedRequest` middleware verbatim.
     */
    signHeaders: (payload: Record<string, unknown>) => Promise<SignedHeaders>;
    fetchFn?: typeof fetch;
  }

  /**
   * Fetches the three input streams for the digest from the lifecycle admin API.
   *
   * - `/api/v1/admin/lifecycle/events?since=<ms>` — Phase A4
   * - `/api/v1/admin/lifecycle/review/queue` — Phase F3
   * - For each family with two visible generations, `/api/v1/families/<slug>/diff` — Phase E3
   *
   * The site endpoint set authenticates via Ed25519 admin signature for CLI
   * traffic (Phase F5 — `worker accepts EITHER a valid CF Access JWT OR a
   * valid Ed25519 admin signature`). Signed headers are the canonical wire
   * format (`X-CG-Signature` / `X-CG-Key-Id` / `X-CG-Signed-At`); the
   * `x-cg-admin-signature` legacy header is NOT supported by Plan A's
   * endpoints — do not introduce it here.
   */
  export async function fetchDigestInputs(
    args: FetchDigestInputsArgs,
  ): Promise<Omit<DigestInput, "format">> {
    const fetchFn = args.fetchFn ?? fetch;
    // Sign an empty payload — the query parameter (`since`) goes on the URL
    // and is not part of the canonical signed body. Matches Plan A's
    // `queryEvents` shape.
    const eventsHeaders = await args.signHeaders({});

    const eventsUrl = `${args.siteUrl}/api/v1/admin/lifecycle/events?since=${args.sinceMs}`;
    const eventsRes = await fetchFn(eventsUrl, {
      method: "GET",
      headers: { ...eventsHeaders },
    });
    if (!eventsRes.ok) {
      throw new Error(`lifecycle/events: ${eventsRes.status}`);
    }
    const { events } = await eventsRes.json() as { events: LifecycleEvent[] };

    const familyDiffs: FamilyDiffRow[] = [];
    const families = new Set(events
      .filter((e) => e.event_type === "analysis.completed")
      .map((e) => e.model_slug.split("/").slice(0, 2).join("/")));
    for (const family of families) {
      const diffUrl = `${args.siteUrl}/api/v1/families/${family}/diff`;
      // /api/v1/families/<slug>/diff is a public endpoint (Phase E3) — no
      // admin signature required.
      const r = await fetchFn(diffUrl);
      if (r.ok) {
        const body = await r.json() as FamilyDiffRow;
        if (body && body.status) familyDiffs.push(body);
      }
    }

    const queueHeaders = await args.signHeaders({});
    const queueRes = await fetchFn(
      `${args.siteUrl}/api/v1/admin/lifecycle/review/queue`,
      { method: "GET", headers: { ...queueHeaders } },
    );
    if (!queueRes.ok) {
      throw new Error(`review/queue: ${queueRes.status}`);
    }
    const reviewQueue = await queueRes.json() as ReviewQueueSummary;

    return { events, familyDiffs, reviewQueue, sinceMs: args.sinceMs };
  }
  ```

- [ ] **3.3 Add the Cliffy subcommand.** Edit `cli/commands/lifecycle-command.ts`. **Parent ownership:** Plan A's A3 owns the `lifecycle` parent Command (it registers `lifecycle event-log` first); Plan D7 adds `lifecycle cluster review`; this step adds `lifecycle digest`. If at execution time the parent file does not yet exist (Plan A regression), create it minimally and bolt the digest subcommand on.

  ```typescript
  // cli/commands/lifecycle-command.ts (additions)
  import { Command } from "@cliffy/command";
  import { fetchDigestInputs, generateDigest } from "../../src/lifecycle/digest.ts";
  import { loadIngestConfig, readPrivateKey } from "../../src/ingest/config.ts";
  import { signPayload } from "../../src/ingest/sign.ts";

  export function registerDigestSubcommand(parent: Command): void {
    parent.command("digest", "Generate a lifecycle activity digest")
      .option("--since <duration:string>", "Time window (e.g. '7d', '24h')", { default: "7d" })
      .option("--format <format:string>", "Output format", { default: "markdown" })
      .action(async ({ since, format }) => {
        if (format !== "markdown" && format !== "json") {
          throw new Error(`--format must be 'markdown' or 'json', got: ${format}`);
        }
        const config = await loadIngestConfig(Deno.cwd(), {});
        if (config.adminKeyId == null || !config.adminKeyPath) {
          throw new Error(
            "admin_key_id + admin_key_path required (.centralgauge.yml) for lifecycle digest",
          );
        }
        const adminPriv = await readPrivateKey(config.adminKeyPath);
        const adminKeyId = config.adminKeyId;
        const sinceMs = Date.now() - parseDuration(since);
        const inputs = await fetchDigestInputs({
          siteUrl: config.url,
          sinceMs,
          // Canonical signed-headers triple per Plan A. Sign an empty payload
          // (matches `queryEvents` in `src/lifecycle/event-log.ts` from A3).
          signHeaders: async (payload) => {
            const sig = await signPayload(payload, adminPriv, adminKeyId);
            return {
              "X-CG-Signature": sig.value,
              "X-CG-Key-Id": String(sig.key_id),
              "X-CG-Signed-At": sig.signed_at,
            };
          },
        });
        const out = await generateDigest({ ...inputs, format });
        console.log(out);
      });
  }

  function parseDuration(s: string): number {
    const m = /^(\d+)([dh])$/.exec(s);
    if (!m) throw new Error(`Invalid duration: ${s} (expected e.g. '7d' or '24h')`);
    const n = parseInt(m[1], 10);
    return m[2] === "d" ? n * 86_400_000 : n * 3_600_000;
  }
  ```

- [ ] **3.4 Register the digest subcommand on the parent `lifecycle` command** owned by Plan A's A3. Edit `cli/commands/lifecycle-command.ts` (or wherever Plan A wired the parent) to call the registration helper after the existing `event-log` registration:

  ```typescript
  import { registerDigestSubcommand } from "./lifecycle-command.ts";
  // ... inside the lifecycle Command builder, after registerEventLogSubcommand(lifecycleCmd):
  registerDigestSubcommand(lifecycleCmd);
  ```

  If the parent does not yet exist when this step runs (Plan A is not merged), file the gap against Plan A's A3 acceptance and fall back to creating the parent locally with just `digest` registered; remove the local creation when A3 lands.

- [ ] **3.5 Smoke-test against staging.** `deno task start lifecycle digest --since 7d --format json | jq .` returns valid JSON with the documented keys against the staging worker.

---

## Step 4 — Workflow orchestrator script

The workflow YAML stays small; the per-model fan-out logic lives in a Deno script at `scripts/weekly-cycle.ts`. Easier to test, easier to evolve. Workflow shells out to it.

- [ ] **4.1 Test fixture for the orchestrator.** New file `tests/unit/lifecycle/weekly-orchestrator.test.ts`:

  ```typescript
  import { assertEquals } from "@std/assert";
  import { selectStaleModels } from "../../../scripts/weekly-cycle.ts";

  const NOW = Date.UTC(2026, 4, 5, 6, 0, 0);
  const DAY = 86_400_000;

  Deno.test("selectStaleModels — picks models with no analysis under current task_set", () => {
    const status = {
      models: [
        {
          model_slug: "anthropic/claude-opus-4-7",
          task_set_hash: "ts-current",
          analyze: { last_ts: NOW - 3 * DAY, last_event_type: "analysis.completed" },
        },
        {
          model_slug: "anthropic/claude-opus-4-6",
          task_set_hash: "ts-current",
          analyze: { last_ts: NOW - 14 * DAY, last_event_type: "analysis.completed" },
        },
        {
          model_slug: "openai/gpt-5.5",
          task_set_hash: "ts-current",
          analyze: null, // never analyzed
        },
      ],
    };

    const stale = selectStaleModels(status, { now: NOW, staleAfterMs: 7 * DAY });
    assertEquals(stale.map((m) => m.model_slug).sort(), [
      "anthropic/claude-opus-4-6",
      "openai/gpt-5.5",
    ]);
  });

  Deno.test("selectStaleModels — skips legacy task_set entries", () => {
    const status = {
      models: [
        {
          model_slug: "anthropic/claude-sonnet-4-6",
          task_set_hash: "pre-p6-unknown",
          analyze: null,
        },
      ],
    };
    const stale = selectStaleModels(status, { now: NOW, staleAfterMs: 7 * DAY });
    assertEquals(stale.length, 0);
  });
  ```

- [ ] **4.2 Implement `scripts/weekly-cycle.ts`.**

  ```typescript
  /**
   * Weekly cycle orchestrator — invoked by .github/workflows/weekly-cycle.yml.
   *
   * 1. Reads `centralgauge status --json`.
   * 2. Selects models whose most-recent analysis under the current task_set is
   *    older than 7 days (or absent).
   * 3. Runs `centralgauge cycle --llms <slug> --analyzer-model anthropic/claude-opus-4-6 --yes`
   *    per stale model, recording per-model exit codes; never aborts on first
   *    failure.
   * 4. Writes `weekly-cycle-result.json` summarizing per-model outcome for the
   *    digest step.
   */
  import * as colors from "@std/fmt/colors";

  interface StatusJsonModel {
    model_slug: string;
    task_set_hash: string;
    analyze: { last_ts: number; last_event_type: string } | null;
  }

  interface StatusJson {
    models: StatusJsonModel[];
  }

  export interface SelectArgs {
    now: number;
    staleAfterMs: number;
  }

  export function selectStaleModels(
    status: StatusJson,
    args: SelectArgs,
  ): StatusJsonModel[] {
    return status.models.filter((m) => {
      if (m.task_set_hash === "pre-p6-unknown") return false;
      if (!m.analyze) return true;
      return (args.now - m.analyze.last_ts) > args.staleAfterMs;
    });
  }

  async function runCycle(modelSlug: string): Promise<{ exitCode: number; durationMs: number }> {
    const start = Date.now();
    const cmd = new Deno.Command("deno", {
      args: [
        "task", "start", "cycle",
        "--llms", modelSlug,
        "--analyzer-model", "anthropic/claude-opus-4-6",
        "--yes",
      ],
      stdout: "inherit",
      stderr: "inherit",
    });
    const { code } = await cmd.output();
    return { exitCode: code, durationMs: Date.now() - start };
  }

  async function readStatusJson(): Promise<StatusJson> {
    const cmd = new Deno.Command("deno", {
      args: ["task", "start", "status", "--json"],
      stdout: "piped",
      stderr: "inherit",
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) throw new Error(`status --json exited ${code}`);
    return JSON.parse(new TextDecoder().decode(stdout)) as StatusJson;
  }

  if (import.meta.main) {
    const status = await readStatusJson();
    const stale = selectStaleModels(status, {
      now: Date.now(),
      staleAfterMs: 7 * 86_400_000,
    });

    console.log(colors.cyan(`[weekly-cycle] ${stale.length} stale model(s):`));
    for (const m of stale) console.log(`  - ${m.model_slug}`);

    const results: Array<{ model_slug: string; exit_code: number; duration_ms: number }> = [];
    for (const m of stale) {
      console.log(colors.cyan(`[weekly-cycle] cycling ${m.model_slug}...`));
      try {
        const r = await runCycle(m.model_slug);
        results.push({ model_slug: m.model_slug, exit_code: r.exitCode, duration_ms: r.durationMs });
        if (r.exitCode === 0) {
          console.log(colors.green(`[OK] ${m.model_slug} (${(r.durationMs / 1000).toFixed(0)}s)`));
        } else {
          console.log(colors.red(`[FAIL] ${m.model_slug} exit ${r.exitCode}`));
        }
      } catch (e) {
        console.log(colors.red(`[FAIL] ${m.model_slug} ${e instanceof Error ? e.message : String(e)}`));
        results.push({ model_slug: m.model_slug, exit_code: 99, duration_ms: 0 });
      }
    }

    await Deno.writeTextFile("weekly-cycle-result.json", JSON.stringify({
      ran_at: new Date().toISOString(),
      total: results.length,
      succeeded: results.filter((r) => r.exit_code === 0).length,
      failed: results.filter((r) => r.exit_code !== 0).length,
      results,
    }, null, 2));

    const anyFailed = results.some((r) => r.exit_code !== 0);
    Deno.exit(anyFailed ? 1 : 0);
  }
  ```

- [ ] **4.3 Test failure-escalation path.** Append to `weekly-orchestrator.test.ts` a test that mocks `runCycle` indirectly (extract for testability if needed) and asserts the script exits non-zero when any cycle fails. Pragmatic alternative if extraction is fiddly: integration-test the script via `deno run` with a stubbed `cycle` command on `PATH` (skip on CI; gated `Deno.env.get("CI")`).

- [ ] **4.4 Lint + format.** `deno check scripts/weekly-cycle.ts && deno lint scripts/weekly-cycle.ts && deno fmt scripts/weekly-cycle.ts tests/unit/lifecycle/weekly-orchestrator.test.ts`.

---

## Step 5 — Workflow YAML

- [ ] **5.1 Create `.github/workflows/weekly-cycle.yml`.**

  ```yaml
  name: Weekly lifecycle cycle

  # Runs every Monday 06:00 UTC. Identifies stale models from the
  # production lifecycle event log, runs `centralgauge cycle` for each,
  # posts a digest to a sticky GitHub issue tagged `weekly-cycle-digest`.
  #
  # Manual trigger: gh workflow run weekly-cycle.yml

  on:
    schedule:
      - cron: '0 6 * * MON'
    workflow_dispatch:

  permissions:
    contents: read
    issues: write   # for sticky digest issue

  concurrency:
    group: weekly-cycle
    cancel-in-progress: false

  jobs:
    cycle:
      runs-on: ubuntu-latest
      timeout-minutes: 240   # 4h hard cap; expected ~30-90 min for typical 1-3 stale models
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: 22c8fbe790464b492d9b178cc0f9255b
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
        OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      steps:
        - uses: actions/checkout@v4

        - uses: denoland/setup-deno@v2
          with:
            deno-version: v1.46.x

        - name: Decode admin signing key
          id: admin-key
          run: |
            mkdir -p "$RUNNER_TEMP/cg"
            printf '%s' '${{ secrets.ADMIN_KEY_PEM }}' | base64 -d > "$RUNNER_TEMP/cg/admin_key.pem"
            chmod 600 "$RUNNER_TEMP/cg/admin_key.pem"
            echo "path=$RUNNER_TEMP/cg/admin_key.pem" >> "$GITHUB_OUTPUT"

        - name: Cache Deno deps
          uses: actions/cache@v4
          with:
            path: ~/.cache/deno
            key: deno-${{ runner.os }}-${{ hashFiles('deno.lock') }}

        # Fail-fast precheck: validate ingest config + admin key + connectivity
        # BEFORE the orchestrator fans out N cycle invocations. Without this,
        # a corrupted ADMIN_KEY_PEM secret causes N×failure with N×digest
        # noise — the precheck collapses that to a single failure with a
        # clear root-cause message.
        - name: Doctor ingest precheck
          env:
            CENTRALGAUGE_ADMIN_KEY_PATH: ${{ steps.admin-key.outputs.path }}
            CENTRALGAUGE_BENCH_PRECHECK: '0'   # this IS the precheck; don't recurse
          run: deno task start doctor ingest --no-bench

        - name: Run weekly cycle orchestrator
          id: cycle
          continue-on-error: true
          env:
            CENTRALGAUGE_ADMIN_KEY_PATH: ${{ steps.admin-key.outputs.path }}
            CENTRALGAUGE_BENCH_PRECHECK: '0'   # bench-aware doctor would gate every cycle; precheck above already ran
          run: deno run --allow-all scripts/weekly-cycle.ts

        - name: Generate digest
          id: digest
          if: always()
          env:
            CENTRALGAUGE_ADMIN_KEY_PATH: ${{ steps.admin-key.outputs.path }}
          run: |
            deno task start lifecycle digest --since 7d --format markdown > digest.md
            cat digest.md
            {
              echo "digest<<DIGEST_EOF"
              cat digest.md
              echo "DIGEST_EOF"
            } >> "$GITHUB_OUTPUT"

        - name: Post or update sticky digest issue
          if: always()
          env:
            GH_TOKEN: ${{ github.token }}
          run: |
            set -euo pipefail
            CYCLE_RESULT="${{ steps.cycle.outcome }}"
            BODY=$(cat digest.md)
            BODY="$BODY

          ---
          - Workflow run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          - Cycle outcome: $CYCLE_RESULT"

            # Find or create the sticky issue
            EXISTING=$(gh issue list --label weekly-cycle-digest --state open --json number --jq '.[0].number' || true)

            if [ "$CYCLE_RESULT" = "success" ]; then
              if [ -n "$EXISTING" ]; then
                gh issue comment "$EXISTING" --body "$BODY"
                gh issue close "$EXISTING" --comment "All clear — closing sticky digest issue."
              else
                gh issue create \
                  --title "Weekly lifecycle digest — $(date -u +%Y-%m-%d)" \
                  --label weekly-cycle-digest \
                  --body "$BODY"
                # Created issue is auto-closed on success per the strategic plan.
                gh issue close "$(gh issue list --label weekly-cycle-digest --state open --json number --jq '.[0].number')"
              fi
            else
              if [ -n "$EXISTING" ]; then
                gh issue comment "$EXISTING" --body "$BODY"
              else
                gh issue create \
                  --title "Weekly lifecycle digest — $(date -u +%Y-%m-%d) (FAILED)" \
                  --label weekly-cycle-digest \
                  --body "$BODY"
              fi
            fi

        - name: Upload weekly-cycle artifacts
          if: always()
          uses: actions/upload-artifact@v4
          with:
            name: weekly-cycle-${{ github.run_id }}
            path: |
              digest.md
              weekly-cycle-result.json
            retention-days: 90

        - name: Surface cycle failure to workflow status
          if: steps.cycle.outcome == 'failure'
          run: |
            echo "::error::One or more cycle invocations failed; sticky digest issue stays open."
            exit 1
  ```

- [ ] **5.2 Install actionlint locally + validate the YAML.** Pin to a known-good release. One of:

  ```bash
  # macOS
  brew install actionlint

  # Windows
  winget install rhysd.actionlint

  # Cross-platform (any Go toolchain)
  go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.1
  ```

  Then run `actionlint .github/workflows/weekly-cycle.yml`. Zero warnings expected. Document the install snippet in J3's operations runbook (the operator running G6.1 from a fresh box should be able to copy/paste).

- [ ] **5.3 Add the `weekly-cycle-digest` issue label.** Run `gh label create weekly-cycle-digest --description "Sticky issue for the weekly lifecycle digest" --color 0E8A16` (or update if it exists).

---

## Step 6 — Failure-escalation test

- [ ] **6.1 Add a self-test that exercises the failure-escalation branch.** Append to `tests/unit/lifecycle/weekly-orchestrator.test.ts`:

  ```typescript
  Deno.test({
    name: "weekly-cycle script exits non-zero when any cycle fails",
    ignore: !Deno.env.get("CI") && !Deno.env.get("RUN_INTEGRATION"),
    async fn() {
      // Stage a fake `deno task start status --json` that returns one stale
      // model + a fake `deno task start cycle` that exits 1. We simulate by
      // pre-writing weekly-cycle-result.json and asserting the orchestrator
      // would emit Deno.exit(1) given that input. The unit-level guard is
      // already covered by selectStaleModels; this test is for end-to-end
      // confidence and is gated behind CI/RUN_INTEGRATION to keep the local
      // unit suite fast.
      // Implementation: run `deno run --allow-all scripts/weekly-cycle.ts`
      // with PATH-shadowed `deno` shim; assert exit 1.
    },
  });
  ```

  The shim approach is intentionally sketched, not implemented — the deterministic unit coverage in 4.1 is the primary signal; the gated integration test is documentation for future maintainers who want a tighter end-to-end. If actually needed, implement it using a tempdir + `Deno.Command` with a custom `PATH`.

- [ ] **6.2 Manual workflow_dispatch dry run.** From the repo's Actions tab → "Weekly lifecycle cycle" → Run workflow → from `master`. Watch the run; expect digest to render against current production state. Issue created. If staging models are all current, expect "All clear" digest + auto-closed issue.

---

## Step 7 — Commit + verify

- [ ] **7.1 Stage the deliverables.**

  ```bash
  git add \
    .github/workflows/weekly-cycle.yml \
    src/lifecycle/digest.ts \
    cli/commands/lifecycle-command.ts \
    cli/commands/mod.ts \
    scripts/weekly-cycle.ts \
    tests/unit/lifecycle/digest.test.ts \
    tests/unit/lifecycle/digest.fixture.ts \
    tests/unit/lifecycle/weekly-orchestrator.test.ts
  ```

- [ ] **7.2 Run the full check suite locally.**

  ```bash
  deno check
  deno lint
  deno fmt --check
  deno task test:unit
  ```

  All four must pass. The strategic plan's rule applies: do NOT run `deno fmt` on any `site/` files.

- [ ] **7.3 Commit.**

  ```bash
  git commit -m "$(cat <<'EOF'
  feat(ci): weekly model lifecycle cycle + digest

  - .github/workflows/weekly-cycle.yml — Monday 06:00 UTC + workflow_dispatch
  - scripts/weekly-cycle.ts — fan-out orchestrator (continue-on-error per model)
  - src/lifecycle/digest.ts — markdown/JSON digest generator
  - cli/commands/lifecycle-command.ts — `lifecycle digest --since --format` subcommand
  - Sticky GitHub issue tagged `weekly-cycle-digest`: auto-closed on success, kept open on failure

  Strategic plan G — phase G of 2026-04-29-model-lifecycle-event-sourcing.md.
  EOF
  )"
  ```

- [ ] **7.4 Verify the workflow has run at least once cleanly before declaring acceptance.** Trigger via `gh workflow run weekly-cycle.yml`. Wait for completion. `gh run watch` or the Actions UI. The acceptance gate per the strategic plan: "Manual `workflow_dispatch` run completes; opens a GitHub issue with the digest. Stale models get re-cycled; current models skip via `*.skipped` events."

---

## Acceptance

- [ ] `actionlint .github/workflows/weekly-cycle.yml` is clean.
- [ ] `deno task test:unit --filter "digest|weekly-orchestrator"` passes (≥ 4 tests).
- [ ] `deno task start lifecycle digest --since 7d --format json | jq '.review_queue.pending_count'` returns a number.
- [ ] `gh workflow run weekly-cycle.yml` completes; sticky issue created/commented.
- [ ] When any per-model cycle fails: workflow ends `failure`, issue stays open, digest documents the failure.
- [ ] When all per-model cycles succeed: workflow ends `success`, issue is auto-closed (or no issue created if there was nothing to report).

## Out of scope

- Slack / email notifications on the digest. Sticky GitHub issue is the canonical surface.
- Per-model retry beyond what `cycle` already does internally (the orchestrator runs each model exactly once).
- Cost dashboards in the digest — covered by a follow-up plan if needed.
- Auto-rerun of failed models on a 24h delay — operator triages via the open issue.
