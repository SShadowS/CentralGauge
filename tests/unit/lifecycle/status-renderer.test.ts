/**
 * Tests for the lifecycle status matrix renderer.
 *
 * The renderer is a pure function (string in, string out) so all tests
 * pass `color: false` to keep snapshots ANSI-free. The 80-column constraint
 * is asserted explicitly because every step column adds up — a single
 * unintentional layout regression cascades to every operator's terminal.
 *
 * @module tests/unit/lifecycle/status-renderer
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderMatrix } from "../../../src/lifecycle/status-renderer.ts";
import type { StateRow } from "../../../src/lifecycle/status-types.ts";

function row(over: Partial<StateRow>): StateRow {
  return {
    model_slug: "vendor/model",
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

// ANSI strip — we pass color:false but be defensive: any leak should be
// caught by the 80-col assertion.
// deno-lint-ignore no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

Deno.test("renderMatrix", async (t) => {
  await t.step("empty input prints header + (no rows)", () => {
    const s = renderMatrix([], { color: false });
    assertStringIncludes(s, "MODEL");
    assertStringIncludes(s, "(no rows)");
  });

  await t.step("missing steps render as --", () => {
    // Only bench row → debug, analyze, publish should each show "--".
    const s = renderMatrix([row({ step: "bench" })], { color: false });
    const missingMatches = s.match(/\s--\s/g) ?? [];
    assertEquals(
      missingMatches.length >= 3,
      true,
      `expected >=3 missing cells, got ${missingMatches.length}; output:\n${s}`,
    );
  });

  await t.step(
    "completed recent row renders as OK (not stale, not in-progress)",
    () => {
      const s = renderMatrix([row({ step: "bench" })], { color: false });
      assertStringIncludes(s, "OK");
    },
  );

  await t.step(
    "stale row (>14 days old) renders as STALE",
    () => {
      const stale = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const s = renderMatrix(
        [row({ step: "bench", last_ts: stale })],
        { color: false },
      );
      assertStringIncludes(s, "STALE");
    },
  );

  await t.step(
    "in-progress event (.started without terminal) renders as ...",
    () => {
      const s = renderMatrix(
        [row({ step: "analyze", last_event_type: "analysis.started" })],
        { color: false },
      );
      assertStringIncludes(s, "…");
    },
  );

  await t.step("output fits 80 columns even with long model slug", () => {
    const s = renderMatrix(
      [
        row({
          model_slug: "anthropic/claude-opus-4-7-very-long-experimental-name",
          step: "bench",
        }),
      ],
      { color: false },
    );
    for (const line of s.split("\n")) {
      const stripped = line.replace(ANSI_RE, "");
      assertEquals(
        stripped.length <= 80,
        true,
        `line too long (${stripped.length}): "${stripped}"`,
      );
    }
  });

  await t.step(
    "multiple models sort alphabetically by slug",
    () => {
      const s = renderMatrix(
        [
          row({ model_slug: "z/model", step: "bench", last_event_id: 2 }),
          row({ model_slug: "a/model", step: "bench", last_event_id: 1 }),
        ],
        { color: false },
      );
      const aIdx = s.indexOf("a/model");
      const zIdx = s.indexOf("z/model");
      assertEquals(aIdx > -1 && zIdx > -1, true);
      assertEquals(aIdx < zIdx, true, "a/model should sort before z/model");
    },
  );

  await t.step("header lists all four pipeline steps", () => {
    const s = renderMatrix([], { color: false });
    assertStringIncludes(s, "BENCH");
    assertStringIncludes(s, "DEBUG");
    assertStringIncludes(s, "ANALYZE");
    assertStringIncludes(s, "PUBLISH");
  });

  await t.step("legend renders when color enabled", () => {
    const s = renderMatrix([row({ step: "bench" })], { color: true });
    // Legend mentions each symbol meaning.
    assertStringIncludes(s, "Legend");
  });

  await t.step("dim option does not crash and still produces output", () => {
    const s = renderMatrix(
      [row({ step: "bench" })],
      { color: true, dim: true },
    );
    assertStringIncludes(s, "MODEL");
  });

  await t.step(
    "groups multiple step rows for the same model into one matrix row",
    () => {
      const now = Date.now();
      const s = renderMatrix(
        [
          row({ model_slug: "x/y", step: "bench", last_ts: now }),
          row({
            model_slug: "x/y",
            step: "debug",
            last_ts: now,
            last_event_id: 2,
            last_event_type: "debug.captured",
          }),
        ],
        { color: false },
      );
      // Should be exactly one body line for x/y.
      const bodyLines = s.split("\n").filter((l) => l.includes("x/y"));
      assertEquals(bodyLines.length, 1);
      // Two OK cells (bench + debug), two missing (analyze + publish).
      const okCount = (bodyLines[0]!.match(/OK/g) ?? []).length;
      assertEquals(okCount, 2);
    },
  );
});
