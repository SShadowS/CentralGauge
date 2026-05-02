/**
 * Unit tests for the weekly lifecycle digest generator.
 *
 * The generator is a pure function: events + family diffs + review-queue
 * counts in, markdown / JSON out. Tests cover:
 *
 *   1. Markdown rendering — every section header + key payload field
 *      surfaces. Headers are part of the operator-facing surface (the
 *      sticky GitHub issue) so the test asserts them verbatim.
 *   2. JSON rendering — schema-typed; CI consumers `jq` over it.
 *   3. Empty-input "all clear" path — keeps the issue tidy when nothing
 *      happened in the window.
 *
 * Cross-plan coupling: the JSON shape is consumed by Plan G's workflow
 * itself (the digest step pipes the JSON into the issue body). Renames
 * here MUST be coordinated with `.github/workflows/weekly-cycle.yml`.
 *
 * @module tests/unit/lifecycle/digest
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  fetchDigestInputs,
  generateDigest,
} from "../../../src/lifecycle/digest.ts";
import {
  FIXTURE_EVENTS,
  FIXTURE_FAMILY_DIFFS,
  FIXTURE_REVIEW_QUEUE,
  NOW,
} from "./digest.fixture.ts";

const SEVEN_DAYS_MS = 7 * 86_400_000;

Deno.test("digest — markdown format renders all sections", async () => {
  const md = await generateDigest({
    events: FIXTURE_EVENTS,
    familyDiffs: FIXTURE_FAMILY_DIFFS,
    reviewQueue: FIXTURE_REVIEW_QUEUE,
    sinceMs: NOW - SEVEN_DAYS_MS,
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
    sinceMs: NOW - SEVEN_DAYS_MS,
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
    sinceMs: NOW - SEVEN_DAYS_MS,
    format: "markdown",
  });

  assertStringIncludes(md, "All clear");
  assertStringIncludes(md, "No new concepts");
  assertStringIncludes(md, "No regressions");
});

Deno.test("digest — events outside since window are filtered", async () => {
  // sinceMs cutoff after the most-recent fixture event → no events visible.
  const md = await generateDigest({
    events: FIXTURE_EVENTS,
    familyDiffs: [],
    reviewQueue: { pending_count: 0, rows: [] },
    sinceMs: NOW + DAY_AHEAD,
    format: "markdown",
  });
  assertStringIncludes(md, "All clear");
});

const DAY_AHEAD = 86_400_000;

Deno.test("fetchDigestInputs — fans out per model + dedupes families", async () => {
  const queryCalls: string[] = [];
  const familyCalls: string[] = [];

  const inputs = await fetchDigestInputs({
    siteUrl: "https://centralgauge.example",
    sinceMs: 0,
    privateKey: new Uint8Array(32), // dummy; queryFn is stubbed
    keyId: 1,
    models: ["anthropic/claude-opus-4-7", "openai/gpt-5.5"],
    taskSetHash: "ts-current",
    queryFn: (filter, _opts) => {
      queryCalls.push(filter.model_slug);
      return Promise.resolve([]);
    },
    fetchFamiliesFn: (siteUrl, _fetch) => {
      familyCalls.push(siteUrl);
      return Promise.resolve(["anthropic/claude-opus", "openai/gpt"]);
    },
    fetchDiffFn: (_siteUrl, _family, _fetch) =>
      Promise.resolve({ status: "baseline_missing" as const }),
    fetchQueueFn: (_args) => Promise.resolve({ pending_count: 0, rows: [] }),
  });

  assertEquals(queryCalls.sort(), [
    "anthropic/claude-opus-4-7",
    "openai/gpt-5.5",
  ]);
  assertEquals(familyCalls.length, 1);
  assertEquals(inputs.events.length, 0);
  assertEquals(inputs.familyDiffs.length, 2);
  assertEquals(inputs.reviewQueue.pending_count, 0);
  assertEquals(inputs.sinceMs, 0);
});

Deno.test("fetchDigestInputs — per-model queryEvents failure is non-fatal", async () => {
  const inputs = await fetchDigestInputs({
    siteUrl: "https://centralgauge.example",
    sinceMs: 0,
    privateKey: new Uint8Array(32),
    keyId: 1,
    models: ["anthropic/claude-opus-4-7", "openai/gpt-5.5"],
    taskSetHash: "ts-current",
    queryFn: (filter, _opts) => {
      if (filter.model_slug === "openai/gpt-5.5") {
        return Promise.reject(new Error("network down"));
      }
      // Just return one event for the working model.
      return Promise.resolve([{
        id: 1,
        ts: 1000,
        model_slug: filter.model_slug,
        task_set_hash: "ts-current",
        event_type: "bench.completed",
        actor: "ci",
      }]);
    },
    fetchFamiliesFn: () => Promise.resolve([]),
    fetchQueueFn: () => Promise.resolve({ pending_count: 0, rows: [] }),
  });

  // Working model contributes its event; failed model contributes none —
  // the digest still renders with partial data instead of aborting.
  assertEquals(inputs.events.length, 1);
  assertEquals(inputs.events[0]!.model_slug, "anthropic/claude-opus-4-7");
});

Deno.test("digest — non-comparable family diffs do not contribute regressions", async () => {
  const json = await generateDigest({
    events: [],
    familyDiffs: [
      {
        family_slug: "anthropic/claude-opus",
        status: "analyzer_mismatch",
        regressed: [{ slug: "should-be-ignored" }],
      },
    ],
    reviewQueue: { pending_count: 0, rows: [] },
    sinceMs: NOW - SEVEN_DAYS_MS,
    format: "json",
  });
  const parsed = JSON.parse(json);
  assertEquals(parsed.regressions.length, 0);
});
