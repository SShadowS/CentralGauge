import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  buildAnalysisEvents,
  buildBenchEvents,
  buildPublishEvents,
} from "../../../scripts/backfill-lifecycle.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../../../src/lifecycle/types.ts";

describe("backfill-lifecycle", () => {
  it("synthesizes one bench.completed per runs row", () => {
    const runs = [
      {
        id: "r1",
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        started_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "r2",
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        started_at: "2026-04-15T00:00:00Z",
      },
      {
        id: "r3",
        model_slug: "openai/gpt-5.5",
        task_set_hash: "h1",
        started_at: "2026-04-10T00:00:00Z",
      },
    ];
    const events = buildBenchEvents(runs);
    assertEquals(events.length, 3);
    assertEquals(
      events.every((e) => e.event_type === "bench.completed"),
      true,
    );
    assertEquals(events.every((e) => e.actor === "migration"), true);
    assertEquals(
      events.every((e) => e.migration_note?.startsWith("backfilled at")),
      true,
    );
  });

  it("uses pre-p6-unknown sentinel when task_set_hash is null", () => {
    const runs = [
      {
        id: "r1",
        model_slug: "m/x",
        task_set_hash: null,
        started_at: "2025-01-01T00:00:00Z",
      },
    ];
    const events = buildBenchEvents(runs);
    assertEquals(events[0]!.task_set_hash, PRE_P6_TASK_SET_SENTINEL);
    assertEquals(events[0]!.migration_note?.includes("pre-P6"), true);
  });

  it("synthesizes one analysis.completed per (model_slug, task_set_hash) shortcoming pair", () => {
    const shortcomings = [
      {
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        first_seen: "2026-04-20T00:00:00Z",
      },
      {
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h1",
        first_seen: "2026-04-21T00:00:00Z",
      },
      {
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "h2",
        first_seen: "2026-04-22T00:00:00Z",
      },
    ];
    const events = buildAnalysisEvents(shortcomings);
    assertEquals(events.length, 2); // dedupe by (model_slug, task_set_hash)
    const byHash = events.map((e) => e.task_set_hash).sort();
    assertEquals(byHash, ["h1", "h2"]);
  });

  it("synthesizes publish events with occurrences_count from groups", () => {
    const occGroups = [
      {
        model_slug: "m/a",
        task_set_hash: "h",
        last_seen: "2026-04-25T00:00:00Z",
        occurrences_count: 5,
      },
      {
        model_slug: "m/b",
        task_set_hash: "h",
        last_seen: "2026-04-26T00:00:00Z",
        occurrences_count: 0,
        cascaded: true,
      },
    ];
    const events = buildPublishEvents(occGroups);
    assertEquals(events.length, 2);
    assertEquals(events[0]!.event_type, "publish.completed");
    assertEquals(events[1]!.migration_note, "occurrences cascaded");
    assertEquals(events[1]!.payload, { occurrences_count: 0 });
  });
});
