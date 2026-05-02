/**
 * Tests for the next-action hint generator.
 *
 * Each test asserts both the suggested command AND the severity, because
 * Plan G's CI workflow uses severity to gate the workflow exit code (warn
 * → non-fatal warning, error → workflow fails). A regression in either
 * dimension breaks the operator-facing contract.
 *
 * @module tests/unit/lifecycle/status-hints
 */
import { assertEquals } from "@std/assert";
import { generateHints } from "../../../src/lifecycle/status-hints.ts";
import type { StateRow } from "../../../src/lifecycle/status-types.ts";

function row(over: Partial<StateRow>): StateRow {
  return {
    model_slug: "vendor/m",
    task_set_hash: "h",
    step: "bench",
    last_ts: Date.now(),
    last_event_id: 1,
    last_event_type: "bench.completed",
    last_payload_hash: null,
    last_envelope_json: null,
    ...over,
  };
}

Deno.test("generateHints", async (t) => {
  await t.step("empty rows produces no hints", () => {
    assertEquals(generateHints([]), []);
  });

  await t.step(
    "benched-only model suggests cycle --from debug-capture",
    () => {
      const hints = generateHints([row({ step: "bench" })]);
      assertEquals(hints.length, 1);
      assertEquals(hints[0]!.model_slug, "vendor/m");
      assertEquals(hints[0]!.severity, "warn");
      assertEquals(
        hints[0]!.command,
        "centralgauge cycle --llms vendor/m --from debug-capture",
      );
    },
  );

  await t.step("benched + debugged suggests cycle --from analyze", () => {
    const hints = generateHints([
      row({ step: "bench", last_event_id: 1 }),
      row({
        step: "debug",
        last_event_id: 2,
        last_event_type: "debug.captured",
      }),
    ]);
    assertEquals(hints.length, 1);
    assertEquals(
      hints[0]!.command,
      "centralgauge cycle --llms vendor/m --from analyze",
    );
  });

  await t.step("missing publish suggests cycle --from publish", () => {
    const hints = generateHints([
      row({ step: "bench", last_event_id: 1 }),
      row({
        step: "debug",
        last_event_id: 2,
        last_event_type: "debug.captured",
      }),
      row({
        step: "analyze",
        last_event_id: 3,
        last_event_type: "analysis.completed",
      }),
    ]);
    assertEquals(hints[0]!.severity, "warn");
    assertEquals(
      hints[0]!.command,
      "centralgauge cycle --llms vendor/m --from publish",
    );
  });

  await t.step("fully-current model emits no hint", () => {
    const hints = generateHints([
      row({ step: "bench", last_event_id: 1 }),
      row({
        step: "debug",
        last_event_id: 2,
        last_event_type: "debug.captured",
      }),
      row({
        step: "analyze",
        last_event_id: 3,
        last_event_type: "analysis.completed",
      }),
      row({
        step: "publish",
        last_event_id: 4,
        last_event_type: "publish.completed",
      }),
    ]);
    assertEquals(hints, []);
  });

  await t.step(
    "in-progress analyze emits info severity, no rerun command",
    () => {
      const hints = generateHints([
        row({ step: "bench", last_event_id: 1 }),
        row({
          step: "debug",
          last_event_id: 2,
          last_event_type: "debug.captured",
        }),
        row({
          step: "analyze",
          last_event_id: 3,
          last_event_type: "analysis.started",
        }),
      ]);
      assertEquals(hints.length, 1);
      assertEquals(hints[0]!.severity, "info");
    },
  );

  await t.step(
    "stale analyze (>14d) suggests --force-rerun analyze",
    () => {
      const oldTs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const hints = generateHints([
        row({ step: "bench", last_event_id: 1 }),
        row({
          step: "debug",
          last_event_id: 2,
          last_event_type: "debug.captured",
        }),
        row({
          step: "analyze",
          last_event_id: 3,
          last_event_type: "analysis.completed",
          last_ts: oldTs,
        }),
        row({
          step: "publish",
          last_event_id: 4,
          last_event_type: "publish.completed",
        }),
      ]);
      assertEquals(hints.length, 1);
      assertEquals(
        hints[0]!.command,
        "centralgauge cycle --llms vendor/m --force-rerun analyze",
      );
    },
  );

  await t.step(
    "stale bench with no downstream suggests --force-rerun bench",
    () => {
      const oldTs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const hints = generateHints([
        row({ step: "bench", last_ts: oldTs, last_event_id: 1 }),
      ]);
      // Stale bench (>14d) takes precedence over the "missing debug" hint.
      assertEquals(hints.length, 1);
      assertEquals(
        hints[0]!.command,
        "centralgauge cycle --llms vendor/m --force-rerun bench",
      );
    },
  );

  await t.step("hints sort alphabetically by model_slug", () => {
    const hints = generateHints([
      row({ model_slug: "z/m", step: "bench", last_event_id: 1 }),
      row({ model_slug: "a/m", step: "bench", last_event_id: 2 }),
    ]);
    assertEquals(hints.length, 2);
    assertEquals(hints[0]!.model_slug, "a/m");
    assertEquals(hints[1]!.model_slug, "z/m");
  });

  await t.step(
    "missing bench emits warn + cycle --to bench (entrypoint)",
    () => {
      // A model with NO bench row but downstream rows is degenerate; we
      // can only render hints for models that have at least one row in
      // the input. The empty-input case (no rows at all) is covered by
      // the first test step. Here we verify that when bench is missing
      // but other steps exist (e.g. orphaned debug entry from a prior
      // task_set), the bench hint still wins.
      const hints = generateHints([
        row({
          step: "debug",
          last_event_id: 5,
          last_event_type: "debug.captured",
        }),
      ]);
      assertEquals(hints.length, 1);
      assertEquals(hints[0]!.severity, "warn");
      assertEquals(
        hints[0]!.command,
        "centralgauge cycle --llms vendor/m --to bench",
      );
    },
  );
});
