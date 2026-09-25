import { assertEquals, assertThrows } from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import {
  type CellRecord,
  cellsFromRecords,
} from "../../../src/harness/outcome.ts";
import type {
  CampaignRecord,
  ExecutionRecord,
  JudgmentRecord,
} from "../../../src/harness/records.ts";
import {
  campaign,
  execution,
  H,
  judgment,
  SCORERS_V1_FP,
  telemetry,
} from "./fixtures.ts";

function index(js: JudgmentRecord[]): Map<string, JudgmentRecord[]> {
  const m = new Map<string, JudgmentRecord[]>();
  for (const j of js) {
    m.set(j.execution_id, [...(m.get(j.execution_id) ?? []), j]);
  }
  return m;
}

function cellOf(
  c: CampaignRecord,
  es: ExecutionRecord[],
  js: JudgmentRecord[],
  task = "HX-001",
  arm = "plain",
): CellRecord {
  return cellsFromRecords(c, es, index(js)).find((x) =>
    x.task === task && x.arm === arm
  )!;
}

Deno.test("cellsFromRecords: every planned cell appears, unrun cells have no spend", async () => {
  const cells = cellsFromRecords(await campaign(), [], new Map());
  assertEquals(cells.length, 4);
  assertEquals(
    cells.every((c) => c.status === "unrun" && c.spend_usd === 0),
    true,
  );
});

Deno.test("cellsFromRecords: retry chain resolves by final attempt, every attempt's spend counts", async () => {
  const c = await campaign();
  const first = execution(c, {}, {
    termination: "setup_failed",
    did_work: false,
    workspace_hash: null,
    telemetry: telemetry(0.25),
  });
  const second = execution(c, {
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: first.id,
  });
  const cell = cellOf(c, [first, second], [judgment(c, second, true)]);
  assertEquals(
    [cell.status, cell.pass, cell.spend_usd, cell.used_execution],
    ["scored", true, 1.25, second.id],
  );
});

Deno.test("cellsFromRecords: exhausted automatic retry is terminally unscored, spend kept", async () => {
  const c = await campaign();
  const crash = {
    termination: "setup_failed" as const,
    did_work: false,
    workspace_hash: null,
  };
  const first = execution(c, {}, { ...crash, telemetry: telemetry(2) });
  const retry = execution(
    c,
    { attempt: 2, run_kind: "auto_retry", retry_of: first.id },
    { ...crash, telemetry: telemetry(3) },
  );
  assertEquals(cellOf(c, [first], []).status, "pending");
  const cell = cellOf(c, [first, retry], []);
  assertEquals([cell.status, cell.pass, cell.spend_usd], ["unscored", null, 5]);
});

Deno.test("cellsFromRecords: usage limit, missing verdict and verdict-side infra stay pending", async () => {
  const c = await campaign();
  const limited = execution(c, {}, { termination: "usage_limited" });
  assertEquals(cellOf(c, [limited], []).status, "pending");
  const done = execution(c);
  assertEquals(cellOf(c, [done], []).status, "pending");
  assertEquals(cellOf(c, [done], [judgment(c, done, null)]).status, "pending");
});

Deno.test("cellsFromRecords: a crash after read-only work is judged, not retried", async () => {
  const c = await campaign();
  const e = execution(c, {}, { termination: "harness_crash", did_work: true });
  assertEquals(cellOf(c, [e], [judgment(c, e, false)]).pass, false);
});

Deno.test("cellsFromRecords: judgments are selected by execution, task, workspace and oracle", async () => {
  const c = await campaign();
  const e = execution(c);
  const oracle = c.task_set.tasks[0]!.oracle;
  const newerOtherOracle = judgment(c, e, false, {
    task_oracle_hash: H("e"),
    ended_at: "2026-10-09T00:00:00.000Z",
  });
  const otherTask = judgment(c, e, false, {
    task_id: "HX-002",
    ended_at: "2026-10-08T00:00:00.000Z",
  });
  const otherWorkspace = judgment(c, e, false, {
    workspace_hash: H("d"),
    ended_at: "2026-10-08T00:00:00.000Z",
  });
  const ok = judgment(c, e, true);
  const cell = cellOf(c, [e], [
    newerOtherOracle,
    otherTask,
    otherWorkspace,
    ok,
  ]);
  assertEquals([cell.pass, cell.judgment_id, cell.oracle_hash], [
    true,
    ok.id,
    oracle,
  ]);

  // A rejudge against a fixed oracle is used only in that judging context.
  const current = {
    source: "current" as const,
    oracle: new Map([["HX-001", H("e")], ["HX-002", H("4")]]),
  };
  const rejudged = cellsFromRecords(
    c,
    [e],
    index([newerOtherOracle, ok]),
    current,
  )
    .find((x) => x.task === "HX-001" && x.arm === "plain")!;
  assertEquals([rejudged.pass, rejudged.oracle_hash], [false, H("e")]);
});

Deno.test("cellsFromRecords: same-oracle rejudge wins; equal timestamps break by id", async () => {
  const c = await campaign();
  const e = execution(c);
  const old = judgment(c, e, false);
  const newer = judgment(c, e, true, { ended_at: "2026-10-05T00:00:00.000Z" });
  assertEquals(cellOf(c, [e], [newer, old]).judgment_id, newer.id);
  const tieA = judgment(c, e, false, {
    id: "00000000-0000-4000-a000-00000000000a",
  });
  const tieB = judgment(c, e, true, {
    id: "00000000-0000-4000-a000-00000000000b",
  });
  assertEquals(cellOf(c, [e], [tieB, tieA]).judgment_id, tieB.id);
  assertEquals(cellOf(c, [e], [tieA, tieB]).judgment_id, tieB.id);
});

Deno.test("cellsFromRecords: a manual rerun never replaces a scored result, but fills an unscored one", async () => {
  const c = await campaign();
  const planned = execution(c);
  const manual = execution(c, { attempt: 2, run_kind: "manual_rerun" }, {
    telemetry: telemetry(4),
  });
  const keep = cellOf(c, [planned, manual], [
    judgment(c, planned, false),
    judgment(c, manual, true),
  ]);
  assertEquals([
    keep.pass,
    keep.used_execution,
    keep.spend_usd,
    keep.manual_reruns,
  ], [false, planned.id, 5, 1]);

  const limited = execution(c, {}, { termination: "usage_limited" });
  const fill = execution(c, { attempt: 2, run_kind: "manual_rerun" });
  const filled = cellOf(c, [limited, fill], [judgment(c, fill, true)]);
  assertEquals([filled.status, filled.used_kind, filled.used_execution], [
    "scored",
    "manual_rerun",
    fill.id,
  ]);
});

Deno.test("cellsFromRecords: duplicate attempt numbers are refused", async () => {
  const c = await campaign();
  assertThrows(
    () => cellsFromRecords(c, [execution(c), execution(c)], new Map()),
    ValidationError,
    "duplicate attempt",
  );
});

Deno.test("cellsFromRecords: an unknown attempt cost makes the cell spend unknown", async () => {
  const c = await campaign();
  const e = execution(c, {}, { telemetry: telemetry(null) });
  assertEquals(cellOf(c, [e], [judgment(c, e, true)]).spend_usd, null);
});

Deno.test("cellsFromRecords: an automatic retry of a manual rerun never replaces the scored planned result", async () => {
  const c = await campaign();
  const planned = execution(c);
  const manual = execution(c, { attempt: 2, run_kind: "manual_rerun" }, {
    termination: "setup_failed",
    did_work: false,
    workspace_hash: null,
  });
  const retry = execution(c, {
    attempt: 3,
    run_kind: "auto_retry",
    retry_of: manual.id,
  });
  const cell = cellOf(c, [planned, manual, retry], [
    judgment(c, planned, false),
    judgment(c, retry, true),
  ]);
  assertEquals(
    [cell.pass, cell.used_execution, cell.used_kind, cell.spend_usd],
    [false, planned.id, "planned", 3],
  );
});

Deno.test("cellsFromRecords: a judging context missing a task is refused", async () => {
  const c = await campaign();
  const partial = {
    source: "current" as const,
    oracle: new Map([["HX-001", H("2")]]),
  };
  assertThrows(
    () => cellsFromRecords(c, [], new Map(), partial),
    ValidationError,
    "no oracle for HX-002",
  );
});

Deno.test("cellsFromRecords: known spend is kept when another attempt's cost is unknown", async () => {
  const c = await campaign();
  const first = execution(c, {}, {
    termination: "setup_failed",
    did_work: false,
    workspace_hash: null,
    telemetry: telemetry(2),
  });
  const retry = execution(
    c,
    { attempt: 2, run_kind: "auto_retry", retry_of: first.id },
    { telemetry: telemetry(null) },
  );
  const cell = cellOf(c, [first, retry], [judgment(c, retry, true)]);
  assertEquals([cell.spend_usd, cell.known_spend_usd], [null, 2]);
});

Deno.test("cellsFromRecords: newest judgment is by instant, not string order", async () => {
  const c = await campaign();
  const e = execution(c);
  // String order puts "...00Z" after "...00.500Z"; the instant is earlier.
  const later = judgment(c, e, true, { ended_at: "2026-10-05T00:00:00.500Z" });
  const earlier = judgment(c, e, false, { ended_at: "2026-10-05T00:00:00Z" });
  assertEquals(cellOf(c, [e], [earlier, later]).judgment_id, later.id);
});

Deno.test("cellsFromRecords: two candidate judgments with one id are refused", async () => {
  const c = await campaign();
  const e = execution(c);
  const a = judgment(c, e, false);
  const b = judgment(c, e, true, { id: a.id });
  assertThrows(
    () => cellOf(c, [e], [a, b]),
    ValidationError,
    "duplicate judgment id",
  );
});

Deno.test("cellsFromRecords: executions outside the campaign plan are refused", async () => {
  const c = await campaign();
  const foreign = execution(c, {}, {
    campaign_id: "00000000-0000-4000-8000-000000000009",
  });
  assertThrows(
    () => cellsFromRecords(c, [foreign], new Map()),
    ValidationError,
    "not in campaign",
  );
  const unplanned = execution(c, {}, { repeat: 2 });
  assertThrows(
    () => cellsFromRecords(c, [unplanned], new Map()),
    ValidationError,
    "not in campaign",
  );
});

Deno.test("cellsFromRecords: an automatic retry of a completed run is refused", async () => {
  const c = await campaign();
  const planned = execution(c);
  const retry = execution(c, {
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: planned.id,
  });
  assertThrows(
    () =>
      cellOf(c, [planned, retry], [
        judgment(c, planned, true),
        judgment(c, retry, false),
      ]),
    ValidationError,
    "automatic retry",
  );
});

Deno.test("cellsFromRecords: the newest scored manual rerun fills the cell", async () => {
  const c = await campaign();
  const limited = execution(c, {}, { termination: "usage_limited" });
  const m2 = execution(c, { attempt: 2, run_kind: "manual_rerun" });
  const m3 = execution(c, { attempt: 3, run_kind: "manual_rerun" });
  const cell = cellOf(c, [limited, m3, m2], [
    judgment(c, m2, false),
    judgment(c, m3, true),
  ]);
  assertEquals([cell.used_execution, cell.pass, cell.manual_reruns], [
    m3.id,
    true,
    2,
  ]);
});

Deno.test("cellsFromRecords: a pending manual rerun keeps an unscored planned cell pending", async () => {
  const c = await campaign();
  const crash = {
    termination: "setup_failed" as const,
    did_work: false,
    workspace_hash: null,
  };
  const first = execution(c, {}, crash);
  const retry = execution(
    c,
    { attempt: 2, run_kind: "auto_retry", retry_of: first.id },
    crash,
  );
  const manual = execution(c, { attempt: 3, run_kind: "manual_rerun" });
  const cell = cellOf(c, [first, retry, manual], []);
  assertEquals([cell.status, cell.used_execution, cell.used_kind], [
    "pending",
    manual.id,
    "manual_rerun",
  ]);
});

Deno.test("cellsFromRecords: newest judgment is exact beyond milliseconds", async () => {
  const c = await campaign();
  const e = execution(c);
  const later = judgment(c, e, true, {
    ended_at: "2026-10-05T00:00:00.0001Z",
  });
  const earlier = judgment(c, e, false, { ended_at: "2026-10-05T00:00Z" });
  assertEquals(cellOf(c, [e], [earlier, later]).judgment_id, later.id);
  assertEquals(cellOf(c, [e], [later, earlier]).judgment_id, later.id);
});

Deno.test("cellsFromRecords: a cell with no planned execution is refused", async () => {
  const c = await campaign();
  const manual = execution(c, { attempt: 2, run_kind: "manual_rerun" });
  assertThrows(
    () => cellsFromRecords(c, [manual], new Map()),
    ValidationError,
    "no planned execution in cell HX-001/1/plain",
  );
});

Deno.test("cellsFromRecords: a scored cell carries the judgment's scorer fingerprint", async () => {
  const c = await campaign();
  const e = execution(c);
  const cell = cellOf(c, [e], [judgment(c, e, true)]);
  assertEquals([cell.status, cell.scorer_fingerprint], [
    "scored",
    SCORERS_V1_FP,
  ]);
});

Deno.test("cellsFromRecords: the current context picks its oracle's judgment even when older", async () => {
  const c = await campaign();
  const e = execution(c);
  const olderOther = judgment(c, e, false, { task_oracle_hash: H("e") });
  const newerCampaign = judgment(c, e, true, {
    ended_at: "2026-10-09T00:00:00.000Z",
  });
  const current = {
    source: "current" as const,
    oracle: new Map([["HX-001", H("e")], ["HX-002", H("4")]]),
  };
  const cell = cellsFromRecords(
    c,
    [e],
    index([newerCampaign, olderOther]),
    current,
  ).find((x) => x.task === "HX-001" && x.arm === "plain")!;
  assertEquals([cell.pass, cell.judgment_id, cell.oracle_hash], [
    false,
    olderOther.id,
    H("e"),
  ]);
});

Deno.test("cellsFromRecords: attempt spend sums the same whatever the input order", async () => {
  const c = await campaign();
  const es = [
    execution(c, {}, { telemetry: telemetry(0.1) }),
    execution(c, { attempt: 2, run_kind: "manual_rerun" }, {
      telemetry: telemetry(0.2),
    }),
    execution(c, { attempt: 3, run_kind: "manual_rerun" }, {
      telemetry: telemetry(0.3),
    }),
  ];
  const js = es.map((e) => judgment(c, e, true));
  const a = cellOf(c, es, js);
  const b = cellOf(c, [...es].reverse(), js);
  assertEquals(
    [b.spend_usd, b.known_spend_usd],
    [a.spend_usd, a.known_spend_usd],
  );
});
