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
import { generateDigest } from "../../../src/lifecycle/digest.ts";
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
