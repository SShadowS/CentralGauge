import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import {
  type BackfillOccurrenceGroup,
  buildAnalysisEvents,
  buildBenchEvents,
  buildPublishEvents,
  dedupePublishGroups,
  writeEvents,
} from "../../../scripts/backfill-lifecycle.ts";
import type { AppendEventInput } from "../../../src/lifecycle/types.ts";
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

  // I3: mixed-state model — one shortcoming with occurrences AND a separate
  // shortcoming WITHOUT occurrences appears in BOTH the withOcc query AND the
  // cascaded query, so naive concatenation emits two publish.completed events
  // with the same (model_slug, task_set_hash, event_type) triple. Site dedupes
  // by payload_hash but the migration_note differs ("backfilled..." vs
  // "occurrences cascaded") → two non-duplicate-by-server-rules rows land for
  // the same logical state. Wrong.
  it("dedupePublishGroups: mixed-state model produces only the withOcc group", () => {
    const groups: BackfillOccurrenceGroup[] = [
      {
        model_slug: "anthropic/mixed-model",
        task_set_hash: null,
        last_seen: "2026-04-20T00:00:00Z",
        occurrences_count: 3,
      },
      {
        model_slug: "anthropic/mixed-model",
        task_set_hash: null,
        last_seen: "2026-04-19T00:00:00Z",
        occurrences_count: 0,
        cascaded: true,
      },
      // Pure-cascaded model (no occurrences anywhere) survives.
      {
        model_slug: "openai/cascaded-only",
        task_set_hash: null,
        last_seen: "2026-04-18T00:00:00Z",
        occurrences_count: 0,
        cascaded: true,
      },
    ];
    const deduped = dedupePublishGroups(groups);
    assertEquals(deduped.length, 2);
    const mixed = deduped.find((g) =>
      g.model_slug === "anthropic/mixed-model"
    )!;
    assertEquals(mixed.occurrences_count, 3);
    assertEquals(mixed.cascaded, undefined);
    const cascadedOnly = deduped.find((g) =>
      g.model_slug === "openai/cascaded-only"
    )!;
    assertEquals(cascadedOnly.occurrences_count, 0);
    assertEquals(cascadedOnly.cascaded, true);
  });

  it("mixed-state model emits exactly one publish.completed event (end-to-end)", () => {
    const groups: BackfillOccurrenceGroup[] = [
      {
        model_slug: "anthropic/mixed-model",
        task_set_hash: "h1",
        last_seen: "2026-04-20T00:00:00Z",
        occurrences_count: 3,
      },
      {
        model_slug: "anthropic/mixed-model",
        task_set_hash: "h1",
        last_seen: "2026-04-19T00:00:00Z",
        occurrences_count: 0,
        cascaded: true,
      },
    ];
    const events = buildPublishEvents(dedupePublishGroups(groups));
    const forMixed = events.filter((e) =>
      e.model_slug === "anthropic/mixed-model"
    );
    assertEquals(forMixed.length, 1);
    assertEquals(forMixed[0]!.payload, { occurrences_count: 3 });
    // Real publish wins → migration_note is the standard backfill stamp,
    // NOT "occurrences cascaded".
    assertEquals(
      forMixed[0]!.migration_note?.startsWith("backfilled at"),
      true,
    );
  });
});

describe("writeEvents (I1+I2)", () => {
  function mkEv(slug: string, ts: number): AppendEventInput {
    return {
      ts,
      model_slug: slug,
      task_set_hash: "h",
      event_type: "bench.completed",
      payload: { run_id: slug + ts },
      tool_versions: {},
      envelope: {},
      actor: "migration",
    };
  }

  it("paces requests at the configured interval (I1)", async () => {
    const events = [mkEv("a", 1), mkEv("b", 2), mkEv("c", 3)];
    const sleeps: number[] = [];
    const seen: AppendEventInput[] = [];
    const result = await writeEvents(events, {
      append: (ev) => {
        seen.push(ev);
        return Promise.resolve();
      },
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      paceMs: 7000,
      log: () => {},
    });
    assertEquals(seen.length, 3);
    assertEquals(result.written, 3);
    assertEquals(result.skipped, 0);
    // Sleep called exactly once per appended event (after each, including the
    // last for simple loop-loc).
    assertEquals(sleeps.length, 3);
    assertEquals(sleeps.every((s) => s === 7000), true);
  });

  it("skips duplicate_event 409 and continues (I2)", async () => {
    const events = [mkEv("a", 1), mkEv("b", 2), mkEv("c", 3)];
    const result = await writeEvents(events, {
      append: (ev) => {
        if (ev.model_slug === "b") {
          return Promise.reject(
            new Error('appendEvent failed (409): {"error":"duplicate_event"}'),
          );
        }
        return Promise.resolve();
      },
      sleep: () => Promise.resolve(),
      paceMs: 0,
      log: () => {},
    });
    assertEquals(result.written, 2);
    assertEquals(result.skipped, 1);
  });

  it("re-throws non-duplicate errors (I2 negative case)", async () => {
    const events = [mkEv("a", 1), mkEv("b", 2)];
    await assertRejects(
      () =>
        writeEvents(events, {
          append: () =>
            Promise.reject(
              new Error('appendEvent failed (500): {"error":"server_error"}'),
            ),
          sleep: () => Promise.resolve(),
          paceMs: 0,
          log: () => {},
        }),
      Error,
      "(500)",
    );
  });

  it("logs per-event progress with [N/total] prefix (I1 visibility)", async () => {
    const events = [mkEv("a", 1), mkEv("b", 2)];
    const lines: string[] = [];
    await writeEvents(events, {
      append: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
      paceMs: 0,
      log: (s) => lines.push(s),
    });
    // Per-event progress; each line includes [n/total] and the event_type.
    assertEquals(lines.length >= 2, true);
    assertEquals(lines[0]!.includes("[1/2]"), true);
    assertEquals(lines[0]!.includes("bench.completed"), true);
    assertEquals(lines[1]!.includes("[2/2]"), true);
  });

  it("re-throws ordinary 409 (no duplicate_event marker) — I2 boundary", async () => {
    // 409 alone (without duplicate_event in the message) is NOT a known idempotency
    // outcome — bail rather than silently swallow conflicts of unknown shape.
    const events = [mkEv("a", 1)];
    await assertRejects(
      () =>
        writeEvents(events, {
          append: () =>
            Promise.reject(
              new Error('appendEvent failed (409): {"error":"some_other_409"}'),
            ),
          sleep: () => Promise.resolve(),
          paceMs: 0,
          log: () => {},
        }),
      Error,
      "(409)",
    );
  });
});
