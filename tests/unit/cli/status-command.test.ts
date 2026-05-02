/**
 * Wave 5 / Plan H — `centralgauge lifecycle status` unit tests.
 *
 * Coverage matrix:
 *
 *   - Registration smoke test (the command attaches under the lifecycle
 *     parent with the expected subcommand name + --json/--legacy options).
 *   - Pure converters: `currentStateToRows`, `partitionRows`.
 *   - End-to-end snapshot: a fixture lifecycle event set rendered through
 *     `renderMatrix` + `generateHints` → asserted shape.
 *   - JSON schema validation: `StatusJsonOutputSchema` accepts a known-good
 *     payload and rejects malformed payloads (Plan G CI consumer contract).
 *   - Legacy partition: rows with `task_set_hash === PRE_P6_TASK_SET_SENTINEL`
 *     route to `legacy`, NEVER affect human-readable matrix unless --legacy.
 *
 * The `setEventStore` test seam from `src/lifecycle/event-log.ts` is NOT
 * needed here because the command exposes `currentStateToRows` /
 * `partitionRows` directly. Integration coverage of the signed HTTP path
 * lives under `tests/integration/lifecycle/` (out of scope for Wave 5).
 *
 * @module tests/unit/cli/status-command
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { Command } from "@cliffy/command";
import {
  currentStateToRows,
  partitionRows,
  registerStatusCommand,
} from "../../../cli/commands/status-command.ts";
import { renderMatrix } from "../../../src/lifecycle/status-renderer.ts";
import { generateHints } from "../../../src/lifecycle/status-hints.ts";
import {
  type StateRow,
  type StatusJsonOutput,
  StatusJsonOutputSchema,
} from "../../../src/lifecycle/status-types.ts";
import {
  type CurrentStateMap,
  type LifecycleEvent,
  PRE_P6_TASK_SET_SENTINEL,
} from "../../../src/lifecycle/types.ts";

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

Deno.test("status registers under the lifecycle parent command", () => {
  const parent = new Command();
  registerStatusCommand(parent);
  const sub = parent.getCommand("status");
  assertEquals(sub?.getName(), "status");
  assertEquals(typeof sub?.getDescription(), "string");
});

Deno.test("status exposes --model, --task-set, --json, --legacy options", () => {
  const parent = new Command();
  registerStatusCommand(parent);
  const sub = parent.getCommand("status");
  const names = (sub?.getOptions() ?? []).map((o) => o.name);
  assertEquals(names.includes("model"), true);
  assertEquals(names.includes("task-set"), true);
  assertEquals(names.includes("json"), true);
  assertEquals(names.includes("legacy"), true);
});

// ---------------------------------------------------------------------------
// currentStateToRows: converts CurrentStateMap → flat StateRow[]
// ---------------------------------------------------------------------------

function ev(over: Partial<LifecycleEvent>): LifecycleEvent {
  return {
    id: 1,
    ts: Date.now(),
    model_slug: "vendor/m",
    task_set_hash: "h",
    event_type: "bench.completed",
    actor: "operator",
    payload_hash: "deadbeef",
    envelope_json: '{"git_sha":"abc"}',
    ...over,
  };
}

Deno.test("currentStateToRows emits one row per non-empty step", () => {
  const state: CurrentStateMap = {
    bench: ev({ id: 1, event_type: "bench.completed" }),
    debug: ev({ id: 2, event_type: "debug.captured" }),
    analyze: ev({ id: 3, event_type: "analysis.completed" }),
    publish: ev({ id: 4, event_type: "publish.completed" }),
  };
  const rows = currentStateToRows("a/b", "hash", state);
  assertEquals(rows.length, 4);
  assertEquals(rows.map((r) => r.step).sort(), [
    "analyze",
    "bench",
    "debug",
    "publish",
  ]);
  assertEquals(rows[0]!.model_slug, "a/b");
  assertEquals(rows[0]!.task_set_hash, "hash");
});

Deno.test("currentStateToRows preserves last_event_id and event_type", () => {
  const state: CurrentStateMap = {
    bench: ev({ id: 42, event_type: "bench.completed", payload_hash: "ph" }),
  };
  const rows = currentStateToRows("a/b", "hash", state);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.last_event_id, 42);
  assertEquals(rows[0]!.last_event_type, "bench.completed");
  assertEquals(rows[0]!.last_payload_hash, "ph");
});

Deno.test("currentStateToRows handles a missing event id (defaults to 0)", () => {
  // Worker rows always have id, but defensive: if a synthetic event
  // arrives without id, the row should still validate. Construct without
  // the id field rather than passing `undefined` (exactOptionalPropertyTypes).
  const noIdEvent: LifecycleEvent = {
    ts: Date.now(),
    model_slug: "vendor/m",
    task_set_hash: "h",
    event_type: "bench.completed",
    actor: "operator",
  };
  const state: CurrentStateMap = { bench: noIdEvent };
  const rows = currentStateToRows("a/b", "hash", state);
  assertEquals(rows[0]!.last_event_id, 0);
});

Deno.test("currentStateToRows includes cycle.* rows when present", () => {
  const state: CurrentStateMap = {
    cycle: ev({ id: 99, event_type: "cycle.completed" }),
  };
  const rows = currentStateToRows("a/b", "hash", state);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.step, "cycle");
});

// ---------------------------------------------------------------------------
// partitionRows: legacy sentinel routing
// ---------------------------------------------------------------------------

function row(over: Partial<StateRow>): StateRow {
  return {
    model_slug: "a/b",
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

Deno.test("partitionRows routes pre-P6 sentinel rows to legacy", () => {
  const rows = [
    row({ task_set_hash: "real-hash", model_slug: "a/b" }),
    row({ task_set_hash: PRE_P6_TASK_SET_SENTINEL, model_slug: "c/d" }),
  ];
  const { current, legacy } = partitionRows(rows);
  assertEquals(current.length, 1);
  assertEquals(current[0]!.model_slug, "a/b");
  assertEquals(legacy.length, 1);
  assertEquals(legacy[0]!.model_slug, "c/d");
});

Deno.test("partitionRows returns empty arrays for empty input", () => {
  const { current, legacy } = partitionRows([]);
  assertEquals(current, []);
  assertEquals(legacy, []);
});

// ---------------------------------------------------------------------------
// End-to-end snapshot: matrix + hints for a representative fixture
// ---------------------------------------------------------------------------

const fixtureRows: StateRow[] = [
  // Model A: fully current (bench + debug + analyze + publish all OK)
  row({
    model_slug: "anthropic/claude-opus-4-6",
    step: "bench",
    last_event_id: 1,
    last_ts: Date.now() - 60_000,
  }),
  row({
    model_slug: "anthropic/claude-opus-4-6",
    step: "debug",
    last_event_id: 2,
    last_ts: Date.now() - 50_000,
    last_event_type: "debug.captured",
  }),
  row({
    model_slug: "anthropic/claude-opus-4-6",
    step: "analyze",
    last_event_id: 3,
    last_ts: Date.now() - 40_000,
    last_event_type: "analysis.completed",
  }),
  row({
    model_slug: "anthropic/claude-opus-4-6",
    step: "publish",
    last_event_id: 4,
    last_ts: Date.now() - 30_000,
    last_event_type: "publish.completed",
  }),
  // Model B: bench + debug only (missing analyze + publish)
  row({
    model_slug: "anthropic/claude-opus-4-7",
    step: "bench",
    last_event_id: 5,
    last_ts: Date.now() - 60_000,
  }),
  row({
    model_slug: "anthropic/claude-opus-4-7",
    step: "debug",
    last_event_id: 6,
    last_ts: Date.now() - 50_000,
    last_event_type: "debug.captured",
  }),
];

Deno.test("status snapshot — matrix shows both models with correct cells", () => {
  const matrix = renderMatrix(fixtureRows, { color: false });
  assertStringIncludes(matrix, "anthropic/claude-opus-4-6");
  assertStringIncludes(matrix, "anthropic/claude-opus-4-7");

  // The 4-7 row should have exactly 2 OK cells (bench + debug); 4-6 should
  // have 4. We use the per-line count to assert.
  const lines = matrix.split("\n");
  const opus47Line = lines.find((l) => l.includes("4-7"));
  const opus46Line = lines.find((l) => l.includes("4-6"));
  assertEquals(
    (opus47Line!.match(/OK/g) ?? []).length,
    2,
    "opus-4-7 should have 2 OK cells",
  );
  assertEquals(
    (opus46Line!.match(/OK/g) ?? []).length,
    4,
    "opus-4-6 should have 4 OK cells",
  );
});

Deno.test("status snapshot — hints fire only for the partial-state model", () => {
  const hints = generateHints(fixtureRows);
  assertEquals(hints.length, 1);
  assertEquals(hints[0]!.model_slug, "anthropic/claude-opus-4-7");
  assertStringIncludes(hints[0]!.command, "--from analyze");
  assertEquals(hints[0]!.severity, "warn");
});

// ---------------------------------------------------------------------------
// JSON output schema (Plan G CI consumer contract)
// ---------------------------------------------------------------------------

Deno.test("StatusJsonOutputSchema accepts a fully populated payload", () => {
  const ok: StatusJsonOutput = {
    as_of_ts: 1714000000000,
    rows: [{
      model_slug: "anthropic/claude-opus-4-7",
      task_set_hash: "abc",
      step: "bench",
      last_ts: 1713000000000,
      last_event_id: 1,
      last_event_type: "bench.completed",
      last_payload_hash: "deadbeef",
      last_envelope_json: '{"deno":"1.46.3"}',
    }],
    legacy_rows: [],
    hints: [{
      model_slug: "anthropic/claude-opus-4-7",
      severity: "warn",
      text: "missing analyze",
      command:
        "centralgauge cycle --llms anthropic/claude-opus-4-7 --from analyze",
    }],
  };
  const r = StatusJsonOutputSchema.parse(ok);
  assertEquals(r.rows.length, 1);
  assertEquals(r.hints[0]!.severity, "warn");
});

Deno.test("StatusJsonOutputSchema rejects non-numeric as_of_ts", () => {
  const bad = {
    as_of_ts: "not-a-number",
    rows: [],
    legacy_rows: [],
    hints: [],
  };
  const r = StatusJsonOutputSchema.safeParse(bad);
  assertEquals(r.success, false);
});

Deno.test("StatusJsonOutputSchema rejects unknown step enum value", () => {
  const bad = {
    as_of_ts: 0,
    rows: [{
      model_slug: "x",
      task_set_hash: "y",
      step: "deploy", // not a valid step
      last_ts: 0,
      last_event_id: 1,
      last_event_type: "deploy.completed",
      last_payload_hash: null,
      last_envelope_json: null,
    }],
    legacy_rows: [],
    hints: [],
  };
  const r = StatusJsonOutputSchema.safeParse(bad);
  assertEquals(r.success, false);
});

Deno.test("StatusJsonOutputSchema requires legacy_rows array", () => {
  const bad = {
    as_of_ts: 0,
    rows: [],
    // legacy_rows missing
    hints: [],
  };
  const r = StatusJsonOutputSchema.safeParse(bad);
  assertEquals(r.success, false);
});

// ---------------------------------------------------------------------------
// --legacy flag: human display vs JSON contract
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clock-skew edge case (IMPORTANT 4): future last_ts must not silently OK
// ---------------------------------------------------------------------------

Deno.test(
  "renderer flips to STALE when last_ts is materially in the future (clock skew)",
  () => {
    // ~16 minutes in the future — well past the 60s jitter tolerance.
    const futureRow: StateRow = row({
      model_slug: "vendor/skewed-model",
      step: "bench",
      last_ts: Date.now() + 1_000_000,
      last_event_type: "bench.completed",
    });
    const matrix = renderMatrix([futureRow], { color: false });
    const skewedLine = matrix
      .split("\n")
      .find((l) => l.includes("vendor/skewed-model"));
    // Must NOT render as OK; must render as STALE.
    assertEquals(
      (skewedLine!.match(/OK/g) ?? []).length,
      0,
      "future-timestamped row must not render as OK",
    );
    assertStringIncludes(skewedLine!, "STALE");
  },
);

Deno.test(
  "hints emit a clock-skew info hint when last_ts is materially in the future",
  () => {
    const futureRow: StateRow = row({
      model_slug: "vendor/skewed-model",
      step: "bench",
      last_ts: Date.now() + 1_000_000,
      last_event_type: "bench.completed",
    });
    const hints = generateHints([futureRow]);
    const skew = hints.find((h) => h.model_slug === "vendor/skewed-model");
    assertEquals(skew?.severity, "info");
    assertStringIncludes(skew?.text ?? "", "Future timestamp");
    assertStringIncludes(skew?.text ?? "", "clock skew");
    assertStringIncludes(
      skew?.command ?? "",
      "centralgauge lifecycle status --model vendor/skewed-model",
    );
  },
);

Deno.test(
  "renderer tolerates 60s jitter — last_ts at +30s still renders OK",
  () => {
    const jitterRow: StateRow = row({
      model_slug: "vendor/jittery-model",
      step: "bench",
      last_ts: Date.now() + 30_000,
      last_event_type: "bench.completed",
    });
    const matrix = renderMatrix([jitterRow], { color: false });
    const line = matrix
      .split("\n")
      .find((l) => l.includes("vendor/jittery-model"));
    assertStringIncludes(line!, "OK");
  },
);

Deno.test(
  "--legacy controls human display only; JSON always exposes legacy_rows",
  () => {
    const legacyTs = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const legacyRow: StateRow = row({
      model_slug: "anthropic/claude-opus-4-5",
      task_set_hash: PRE_P6_TASK_SET_SENTINEL,
      step: "bench",
      last_event_id: 100,
      last_ts: legacyTs,
    });
    const all = [...fixtureRows, legacyRow];
    const { current, legacy } = partitionRows(all);
    assertEquals(current.length, fixtureRows.length);
    assertEquals(legacy.length, 1);
    assertEquals(legacy[0]!.model_slug, "anthropic/claude-opus-4-5");

    // Render the legacy partition explicitly (this is what --legacy
    // triggers) and verify the legacy model appears.
    const legacyMatrix = renderMatrix(legacy, { color: false, dim: true });
    assertStringIncludes(legacyMatrix, "anthropic/claude-opus-4-5");

    // The current matrix MUST NOT include the legacy model regardless of
    // the --legacy flag — partitioning happens before either render call.
    const currentMatrix = renderMatrix(current, { color: false });
    assertEquals(currentMatrix.includes("anthropic/claude-opus-4-5"), false);

    // And the JSON contract: legacy_rows is unconditional.
    const output: StatusJsonOutput = {
      as_of_ts: Date.now(),
      rows: current,
      legacy_rows: legacy,
      hints: generateHints(current),
    };
    const verified = StatusJsonOutputSchema.parse(output);
    assertEquals(verified.legacy_rows.length, 1);
  },
);
