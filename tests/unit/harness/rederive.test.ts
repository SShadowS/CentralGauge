import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import type {
  ExecutionRecord,
  RederivationRecord,
} from "../../../src/harness/records.ts";
import { RecordStore, TERMINATIONS } from "../../../src/harness/records.ts";
import {
  rederiveExecution,
  rederiveTargets,
} from "../../../src/harness/rederive.ts";
import { deriveOutcome } from "../../../src/harness/execution.ts";
import { recordCellProblems } from "../../../src/harness/egress.ts";
import { campaign, execution, manifest, telemetry } from "./fixtures.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const PROBE = "tests/fixtures/harness/claude-code/probe.jsonl";
const AGENT = "toolu_01JFf97YM2Bqmy8ACxXQgweb";
const COMMIT = "a".repeat(40);
const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "claude-sonnet-5": {
      slug: "anthropic/claude-sonnet-5",
      pricing_version: "2026-09-25",
      input: 2,
      output: 10,
      cache_read: 0.2,
      cache_write_5m: 2.5,
      cache_write_1h: 4,
      cache_write_1h_derived: true,
    },
  },
};
const AL = { name: "al-tools", version: "v", tool_schema_hash: "h" };
const PROBE_ARM = {
  mcp: [AL],
  settings: {
    requested: {},
    native: {
      mcp: ["al-tools"],
      mcp_tools: {
        "al-tools": [
          "al_compile",
          "al_container_status",
          "al_test",
          "al_verify",
          "al_verify_task",
        ],
      },
    },
  },
};

type Block = {
  type?: string;
  id?: string;
  tool_use_id?: string;
  input?: { subagent_type?: string };
  content?: unknown;
};
type Rec = {
  type: string;
  parent_tool_use_id?: string | null;
  message?: { content: Block[] };
};

/**
 * The probe as Claude Code 2.1.310 writes an Agent fork (R-07, cell
 * 37609da2): subagent_type fork, and the fork's stream opened by a "Fork
 * started" tool_result for the call, so the call has two tool_results.
 */
async function forkProbe(): Promise<string> {
  const recs = (await Deno.readTextFile(PROBE)).split("\n")
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as Rec);
  for (const r of recs) {
    for (const c of r.message?.content ?? []) {
      if (c.id === AGENT) {
        c.input!.subagent_type = "fork";
      }
    }
    if (
      r.type === "user" && r.parent_tool_use_id === AGENT &&
      r.message!.content.some((c) => c.type === "text")
    ) {
      r.message!.content = [{
        type: "tool_result",
        tool_use_id: AGENT,
        content: [{ type: "text", text: "Fork started — that fork is you." }],
      }];
    }
  }
  const results = recs.flatMap((r) => r.message?.content ?? [])
    .filter((c) => c.type === "tool_result" && c.tool_use_id === AGENT);
  assertEquals(results.length, 2, "the fork shape: two tool_results");
  return recs.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/** A stored harness_crash execution (the R-07 shape) with its run folder. */
async function stored(
  raw: string,
  exitCode = 0,
  stop: string | null = null,
  at?: string,
  timedOut = false,
) {
  const root = at ?? await Deno.realPath(await testTempDir());
  const store = new RecordStore(root);
  const c = await campaign();
  const base = execution(c);
  const e: ExecutionRecord = {
    ...base,
    manifest: manifest("plain", PROBE_ARM),
    termination: "harness_crash",
    telemetry: telemetry(null),
    validity: {
      incomplete_telemetry: ["cost_usd"],
      incomplete_observed: [],
      infra_exposed: true,
    },
    raw_log_path: `runs/${base.id}/raw.jsonl`,
  };
  const run = join(root, "runs", e.id);
  await Deno.mkdir(run, { recursive: true });
  await Deno.writeTextFile(join(run, "raw.jsonl"), raw);
  await Deno.writeTextFile(
    join(run, "sandbox.json"),
    JSON.stringify({
      v: 1,
      sandbox: {
        exitCode,
        started: true,
        startError: null,
        timedOut,
        interrupted: false,
        overflow: false,
      },
      stop_reason: stop,
      infra_reason: "harness log refused: raw.jsonl:27: second result for x",
      pricing_book_at: BOOK.at,
    }),
  );
  await store.writeExecution(e);
  const file = join(root, "executions", c.id, `${e.id}.json`);
  return { root, store, c, e, file, run };
}

const rederive = (
  store: RecordStore,
  e: ExecutionRecord,
  at = "2026-10-29T12:00:00.000Z",
) =>
  rederiveExecution({
    store,
    execution: e,
    reason: "R-10 fork parser fix",
    codeCommit: COMMIT,
    pricing: () => Promise.resolve(BOOK),
    now: () => new Date(at),
  });

const sha256 = async (path: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await Deno.readFile(path)),
    ),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.test("rederive (R-10): a stored fork run re-derives to completed with cost and a trace; the execution file is untouched and the store applies the overlay with its provenance", async () => {
  const s = await stored(await forkProbe());
  const before = await Deno.readTextFile(s.file);
  const r = await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
  assertEquals(await Deno.readTextFile(s.file), before);
  const [x] = await s.store.executions(s.c.id);
  assertEquals(x!.termination, "completed");
  assert(x!.telemetry.cost_usd! > 0);
  assertEquals(x!.telemetry.turns, 8);
  assertEquals(x!.validity.incomplete_telemetry.includes("cost_usd"), false);
  assertEquals(x!.rederived, {
    id: r.id,
    created_at: "2026-10-29T12:00:00.000Z",
    reason: "R-10 fork parser fix",
    code_commit: COMMIT,
    raw_sha256: await sha256(join(s.run, "raw.jsonl")),
    from_termination: "harness_crash",
  });
  // Identity is the stored record's.
  for (
    const k of [
      "arm",
      "arm_manifest_hash",
      "task_id",
      "campaign_id",
      "repeat",
      "workspace_hash",
      "manifest",
    ] as const
  ) assertEquals(x![k], s.e[k], k);
  const trace = (await Deno.readTextFile(join(s.root, x!.trace_path!)))
    .trim().split("\n").map((l) => JSON.parse(l));
  const fork = trace.find((t) => t.type === "tool_call" && t.tool === "Agent");
  assertEquals([fork.outcome, fork.agent], ["ok", "main"]);
  assertEquals(r.stream_problems, []);
  assertEquals(r.infra_reason, null);
});

Deno.test("rederive (R-10): a raw log without its result line stays harness_crash, whatever the exit code (Sol run 001 P1)", async () => {
  const raw = (await forkProbe()).trim().split("\n");
  assertEquals(JSON.parse(raw.at(-1)!).type, "result");
  for (const exit of [-1, 0]) {
    const s = await stored(raw.slice(0, -1).join("\n") + "\n", exit);
    const r = await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
    assertEquals(r.derived.termination, "harness_crash", `exit ${exit}`);
    assertEquals(r.derived.telemetry.cost_usd, null);
    assert(r.derived.validity.infra_exposed);
    const [x] = await s.store.executions(s.c.id);
    assertEquals([x!.termination, x!.rederived?.id], ["harness_crash", r.id]);
  }
});

Deno.test("deriveOutcome (Sol run 001 P1): no termination from the parse never derives completed, on exit 0 too", () => {
  const base = {
    manifest: manifest("plain"),
    declared: [] as const,
    started: true,
    preStart: false,
    setupError: null,
    stopReason: null,
    undrained: null,
    parseError: null,
    problems: [],
    orphansExempt: false,
    configInvalid: false,
    host: { lines: [], bad: [] },
  };
  const parsed = {
    telemetry: telemetry(null),
    observed: { harness_version: null, models: null, loaded_components: null },
    unobservable: [],
    didWork: true,
    termination: null,
    usageResetAt: null,
    imageSupport: null,
    traceEvents: 0,
  };
  for (const exitCode of [0, 1, null]) {
    assertEquals(
      deriveOutcome({
        ...base,
        sandbox: { exitCode, timedOut: false, startError: null },
        parsed,
      }).termination,
      "harness_crash",
      `exit ${exitCode}`,
    );
  }
});

Deno.test("deriveOutcome (R-11): a cap hit with a BC request still in flight is a timeout; backend_undrained without the cap stays harness_crash; other stop reasons still win", () => {
  const base = {
    manifest: manifest("plain"),
    declared: [] as const,
    started: true,
    preStart: false,
    setupError: null,
    parseError: null,
    problems: [],
    orphansExempt: false,
    configInvalid: false,
    host: { lines: [], bad: [] },
  };
  const parsed = {
    telemetry: telemetry(null),
    observed: { harness_version: null, models: null, loaded_components: null },
    unobservable: [],
    didWork: true,
    termination: null,
    usageResetAt: null,
    imageSupport: null,
    traceEvents: 0,
  };
  const at = (stopReason: string | null, timedOut: boolean) =>
    deriveOutcome({
      ...base,
      stopReason,
      undrained: stopReason === "backend_undrained"
        ? "backend request br_1 did not drain within 150 s of revoke"
        : null,
      sandbox: { exitCode: -1, timedOut, startError: null },
      parsed,
    });
  const capped = at("backend_undrained", true);
  assertEquals(capped.termination, "timeout");
  // the undrained request stays recorded (infra exposed, its reason kept)
  assert(capped.validity.infra_exposed);
  assert(capped.infraReasons.some((r) => r.includes("did not drain")));
  assertEquals(at("backend_undrained", false).termination, "harness_crash");
  assertEquals(at(null, true).termination, "timeout");
  for (
    const s of ["operator_interrupt", "capture_overflow", "runner_interrupted"]
  ) {
    assertEquals(at(s, true).termination, "harness_crash", s);
  }
});

Deno.test("deriveOutcome (R-11 Sol run 001 P2): a capped cell with backend_undrained derives exactly what the same capped cell derives without the stop reason, for every parse outcome", () => {
  const base = {
    manifest: manifest("plain"),
    declared: [] as const,
    started: true,
    preStart: false,
    setupError: null,
    parseError: null,
    problems: [],
    orphansExempt: false,
    configInvalid: false,
    host: { lines: [], bad: [] },
    sandbox: { exitCode: -1, timedOut: true, startError: null },
  };
  for (const t of [null, ...TERMINATIONS]) {
    const parsed = {
      telemetry: telemetry(null),
      observed: {
        harness_version: null,
        models: null,
        loaded_components: null,
      },
      unobservable: [],
      didWork: true,
      termination: t,
      usageResetAt: null,
      imageSupport: null,
      traceEvents: 0,
    };
    const plain = deriveOutcome({
      ...base,
      stopReason: null,
      undrained: null,
      parsed,
    });
    const undrained = deriveOutcome({
      ...base,
      stopReason: "backend_undrained",
      undrained: "backend request did not drain",
      parsed,
    });
    assertEquals(undrained.termination, plain.termination, `parse ${t}`);
  }
  // As since M1-22 (5c24d3cb): a rejected rate limit outranks the cap on
  // both paths, so the campaign's usage_limited retry policy applies.
  const limited = {
    telemetry: telemetry(null),
    observed: { harness_version: null, models: null, loaded_components: null },
    unobservable: [],
    didWork: true,
    termination: "usage_limited" as const,
    usageResetAt: null,
    imageSupport: null,
    traceEvents: 0,
  };
  for (const stopReason of [null, "backend_undrained"]) {
    assertEquals(
      deriveOutcome({
        ...base,
        stopReason,
        undrained: stopReason ? "backend request did not drain" : null,
        parsed: limited,
      }).termination,
      "usage_limited",
      String(stopReason),
    );
  }
});

Deno.test("rederive (R-11): a stored cap hit with an undrained BC request and no result line re-derives to timeout, never completed", async () => {
  const raw = (await forkProbe()).trim().split("\n").slice(0, -1);
  for (const exit of [0, -1]) {
    const s = await stored(
      raw.join("\n") + "\n",
      exit,
      "backend_undrained",
      undefined,
      true,
    );
    const r = await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
    assertEquals(r.derived.termination, "timeout", `exit ${exit}`);
    assertEquals(r.from_termination, "harness_crash");
    assert(r.derived.validity.infra_exposed);
    assertEquals((await s.store.executions(s.c.id))[0]!.termination, "timeout");
  }
  // without the cap, an undrained request is still not a parse outcome
  const crash = await stored(await forkProbe(), 0, "backend_undrained");
  await assertRejects(
    () => rederive(crash.store, crash.e),
    ValidationError,
    "stopped for backend_undrained",
  );
});

Deno.test("rederive (R-10): the reader refuses an overlay whose raw.jsonl changed", async () => {
  const s = await stored(await forkProbe());
  await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
  await Deno.writeTextFile(join(s.run, "raw.jsonl"), "\n", { append: true });
  await assertRejects(
    () => s.store.executions(s.c.id),
    ValidationError,
    "raw.jsonl sha256 is",
  );
  await assertRejects(
    () => s.store.allExecutions(),
    ValidationError,
    "it was derived from",
  );
});

Deno.test("rederive (R-10): an overlay can carry no identity field and must belong to its execution", async () => {
  const s = await stored(await forkProbe());
  const r = await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
  const dir = join(s.root, "rederivations", s.e.id);
  const put = async (o: unknown) => {
    const id = crypto.randomUUID();
    await Deno.writeTextFile(
      join(dir, `${id}.json`),
      JSON.stringify({ ...(o as object), id }),
    );
    return id;
  };
  const cases: [unknown, string][] = [
    [{ ...r, arm: "skills" }, "arm"],
    [{ ...r, derived: { ...r.derived, arm: "skills" } }, "arm"],
    [
      { ...r, derived: { ...r.derived, workspace_hash: "0".repeat(64) } },
      "workspace_hash",
    ],
    [{ ...r, account: "other" }, "account"],
    [{ ...r, campaign_id: "00000000-0000-4000-8000-000000000009" }, "campaign"],
    [
      { ...r, from_termination: "completed" },
      "derived from termination completed",
    ],
    [
      { ...r, created_at: "2026-09-01T00:00:00.000Z" },
      "created before the execution ended",
    ],
  ];
  for (const [o, msg] of cases) {
    const id = await put(o);
    await assertRejects(() => s.store.executions(s.c.id), ValidationError, msg);
    await Deno.remove(join(dir, `${id}.json`));
  }
  await s.store.executions(s.c.id);
});

Deno.test("rederive (R-10): overlays are write-once and kept; the newest applies", async () => {
  const s = await stored(await forkProbe());
  const e = (await s.store.executions(s.c.id))[0]!;
  const first = await rederive(s.store, e, "2026-10-29T12:00:00.000Z");
  const again = (await s.store.executions(s.c.id))[0]!;
  assertEquals(again.rederived!.id, first.id);
  // A second re-derivation starts from the stored record's own termination.
  const second = await rederive(s.store, again, "2026-10-29T13:00:00.000Z");
  assertEquals(second.from_termination, "harness_crash");
  const kept: RederivationRecord[] = await s.store.rederivations(s.e.id);
  assertEquals(kept.map((x) => x.id), [first.id, second.id]);
  assertEquals((await s.store.executions(s.c.id))[0]!.rederived!.id, second.id);
  await assertRejects(
    () => s.store.writeRederivation(first),
    ValidationError,
    "record is immutable",
  );
  await assertRejects(
    () => s.store.writeExecution(again),
    ValidationError,
    "never written back",
  );
});

Deno.test("rederive (R-10): outcomes the parse does not decide are refused", async () => {
  const stop = await stored(await forkProbe(), 0, "operator_interrupt");
  await assertRejects(
    () => rederive(stop.store, stop.e),
    ValidationError,
    "stopped for operator_interrupt",
  );
  const setup = await stored(await forkProbe());
  await assertRejects(
    () => rederive(setup.store, { ...setup.e, termination: "setup_failed" }),
    ValidationError,
    "setup_failed is not decided by the parse",
  );
  assertEquals(await stop.store.rederivations(stop.e.id), []);
});

Deno.test("rederiveTargets (R-10): by default every execution whose log the parser refused, once; named ids must be in the campaign", async () => {
  const s = await stored(await forkProbe());
  assertEquals(
    (await rederiveTargets(s.store, s.c.id, [])).map((e) => e.id),
    [s.e.id],
  );
  await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
  assertEquals(await rederiveTargets(s.store, s.c.id, []), []);
  assertEquals(
    (await rederiveTargets(s.store, s.c.id, [s.e.id])).map((e) => e.id),
    [s.e.id],
  );
  await assertRejects(
    () => rederiveTargets(s.store, s.c.id, [crypto.randomUUID()]),
    ValidationError,
    "not in campaign",
  );
});

Deno.test("rederive (Sol run 001 P1): an execution file that carries `rederived` is refused on read, overlay or not", async () => {
  const s = await stored(await forkProbe());
  await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
  const overlaid = (await s.store.executions(s.c.id))[0]!;
  // A copy of the overlaid record into a fresh store's executions/.
  const forged = await stored(await forkProbe());
  await Deno.writeTextFile(
    forged.file,
    JSON.stringify({ ...overlaid, id: forged.e.id }),
  );
  await assertRejects(
    () => forged.store.executions(forged.c.id),
    ValidationError,
    "rederived",
  );
  await assertRejects(
    () => forged.store.execution(forged.e.id),
    ValidationError,
    "rederived",
  );
});

Deno.test("RecordStore.execution (R-10): one execution by id with its overlay applied and checked; null when absent", async () => {
  const s = await stored(await forkProbe());
  assertEquals((await s.store.execution(s.e.id))!.termination, "harness_crash");
  await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
  assertEquals((await s.store.execution(s.e.id))!.termination, "completed");
  assertEquals(await s.store.execution(crypto.randomUUID()), null);
  await Deno.writeTextFile(join(s.run, "raw.jsonl"), "\n", { append: true });
  await assertRejects(
    () => s.store.execution(s.e.id),
    ValidationError,
    "raw.jsonl sha256 is",
  );
});

Deno.test("recordCellProblems (Sol run 001 P2): the record-mode cell is read through the store: its overlay applies and a changed raw log is refused", async () => {
  const repo = await Deno.realPath(await testTempDir());
  const cells = join(repo, "results", "harness", "cells");
  await Deno.mkdir(cells, { recursive: true });
  const s = await stored(await forkProbe(), 0, null, cells);
  // The stored record says harness_crash (a crash outcome).
  assert(
    (await recordCellProblems(repo, s.e.id)).some((p) =>
      p.includes("ended harness_crash")
    ),
  );
  await rederive(s.store, (await s.store.executions(s.c.id))[0]!);
  assert(
    !(await recordCellProblems(repo, s.e.id)).some((p) => p.includes("ended ")),
    "the overlay's completed is what the check sees",
  );
  await Deno.writeTextFile(join(s.run, "raw.jsonl"), "\n", { append: true });
  const p = await recordCellProblems(repo, s.e.id);
  assert(p.some((x) => x.includes("raw.jsonl sha256 is")), p.join("; "));
});

Deno.test("recordCellProblems (Sol run 002 P2): an overlay folder that cannot be checked (not NotFound) refuses the cell, never the lenient read", async () => {
  const repo = await Deno.realPath(await testTempDir());
  const cells = join(repo, "results", "harness", "cells");
  await Deno.mkdir(cells, { recursive: true });
  const s = await stored(await forkProbe(), 0, null, cells);
  const real = Deno.stat;
  Object.defineProperty(Deno, "stat", {
    value: (p: string | URL) =>
      String(p).includes("rederivations")
        ? Promise.reject(
          new Deno.errors.PermissionDenied("stubbed: access denied"),
        )
        : real(p),
    configurable: true,
    writable: true,
  });
  try {
    const p = await recordCellProblems(repo, s.e.id);
    assert(
      p.some((x) =>
        x.includes("execution record refused") &&
        x.includes("stubbed: access denied")
      ),
      p.join("; "),
    );
  } finally {
    Object.defineProperty(Deno, "stat", {
      value: real,
      configurable: true,
      writable: true,
    });
  }
});
