// H-62: several --rerun cells in one invocation, through the normal scheduler.
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import { runCampaign, type RunOptions } from "../../../src/harness/campaign.ts";
import { parseRerunFile } from "../../../cli/commands/harness-command.ts";
import { EXECUTION_LABEL } from "../../../src/harness/sandbox.ts";
import { write } from "./refapp-fixture.ts";
import {
  CATALOG,
  makeEnv,
  mockImageBehavior,
  type TestEnv,
} from "./runtime-fixture.ts";

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  dryRun: false,
  concurrency: 1,
  seed: 7,
  maxPauseMs: 0,
  ...over,
});
function io() {
  const lines: string[] = [];
  return {
    lines,
    log: (l: string) => void lines.push(l),
    sleep: () => Promise.resolve(),
    catalog: CATALOG,
  };
}
const cell = (task: string, repeat: number, arm: string) => ({
  task,
  repeat,
  arm,
});

/** A campaign whose arms are all mock-crash style (unscored) over `repeats` blocks. */
async function crashy(
  variants: string[],
  repeats: number,
  baseline = "mock-crash",
) {
  const t = await makeEnv();
  t.env.supervised = false;
  const real = mockImageBehavior();
  const runs: { id: string; start: number; end: number }[] = [];
  let active = 0;
  let maxActive = 0;
  let tick = 0;
  t.docker.behavior = async (call, run) => {
    const id = call.labels.get(EXECUTION_LABEL);
    if (!id || !hold.on) return await real(call, run);
    const rec = { id, start: ++tick, end: 0 };
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 15));
    try {
      return await real(call, run);
    } finally {
      active--;
      rec.end = ++tick;
      runs.push(rec);
    }
  };
  const hold = { on: false };
  await write(
    t.harnessRoot,
    "experiments/rr.yml",
    `id: rr
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: ${baseline}
variants: [${variants.join(", ")}]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: ${repeats}
`,
  );
  await runCampaign(t.env, "rr", opts(), io());
  const [c] = await t.env.store.campaigns("rr");
  return { t, c: c!, runs, hold, maxActive: () => maxActive };
}
const count = async (t: TestEnv, id: string) =>
  (await t.env.store.executions(id)).length;
const manual = async (t: TestEnv, id: string) =>
  (await t.env.store.executions(id)).filter((e) =>
    e.run_kind === "manual_rerun"
  );

/** Make each block's mock-positive cell terminally unscored (rejudge budget spent). */
async function spendBudget(t: TestEnv, campaignId: string) {
  for (const e of await t.env.store.executions(campaignId)) {
    if (e.arm !== "mock-positive") continue;
    const [j] = await t.env.store.judgments(e.id);
    for (let i = 0; i < 3; i++) {
      const at = new Date(Date.now() + 1000 + i).toISOString();
      await t.env.store.writeJudgment({
        ...j!,
        id: crypto.randomUUID(),
        scorers: j!.scorers.map((s) => ({
          ...s,
          passed: null,
          ...(s.state ? { state: "unscored" as const } : {}),
        })),
        verdict: "unscored",
        started_at: at,
        ended_at: at,
      });
    }
  }
}

Deno.test("rerun-multi: cells of different blocks overlap at --concurrency 2; cells of one block run in the given order, never overlapping; all are manual_rerun and judged", async () => {
  const f = await crashy(["mock-positive"], 3);
  await spendBudget(f.t, f.c.id);
  const cells = f.c.blocks.flatMap((b) =>
    [...b.order].reverse().map((arm) => cell(b.task_id, b.repeat, arm))
  );
  const before = await count(f.t, f.c.id);
  f.hold.on = true;
  const out = io();
  const s = await runCampaign(
    f.t.env,
    "rr",
    opts({ concurrency: 2, reruns: cells, campaign: f.c.id }),
    out,
  );
  assertEquals(s.planned, cells.length);
  const man = await manual(f.t, f.c.id);
  const skipped = out.lines.filter((l) => l.startsWith("[SKIP]")).length;
  assertEquals(man.length + skipped, cells.length, out.lines.join("\n"));
  assert(man.length >= 3, "several cells ran");
  assert(f.maxActive() >= 2, "blocks overlapped");
  assert((await count(f.t, f.c.id)) > before);
  const exec = new Map(
    (await f.t.env.store.executions(f.c.id)).map((e) => [e.id, e]),
  );
  // Same block: the manual reruns follow the given (reversed) arm order, no overlap.
  for (const b of f.c.blocks) {
    const mine = f.runs.filter((r) => {
      const e = exec.get(r.id);
      return e && e.block === b.index && e.run_kind === "manual_rerun";
    }).sort((a, z) => a.start - z.start);
    for (let k = 1; k < mine.length; k++) {
      assert(mine[k - 1]!.end < mine[k]!.start, "one block never overlaps");
    }
    const seq = mine.map((r) => exec.get(r.id)!.arm);
    const want = [...b.order].reverse().filter((a) => seq.includes(a));
    assertEquals(seq, want);
  }
  // The judge queue judged the mock-positive manual reruns (they complete).
  const positives = man.filter((e) => e.arm === "mock-positive");
  assertEquals(positives.length, 3);
  for (const e of positives) {
    assert((await f.t.env.store.judgments(e.id)).length > 0, e.id);
  }
});

Deno.test("rerun-multi: one invalid cell (unknown or scored) refuses the whole invocation before any run or record; a duplicate is refused", async () => {
  const f = await crashy(["mock-positive"], 2);
  const [b1, b2] = f.c.blocks;
  const good = cell(b1!.task_id, b1!.repeat, "mock-crash");
  const runs = f.t.docker.runs.length;
  const n = await count(f.t, f.c.id);
  const refused = async (reruns: ReturnType<typeof cell>[], why: string) => {
    await assertRejects(
      () => runCampaign(f.t.env, "rr", opts({ reruns }), io()),
      ConfigurationError,
      why,
    );
    assertEquals([f.t.docker.runs.length, await count(f.t, f.c.id)], [runs, n]);
  };
  await refused([good, cell("HX-999", 1, "mock-crash")], "no such cell");
  await refused(
    [good, cell(b2!.task_id, b2!.repeat, "mock-positive")],
    "is scored",
  );
  await refused([good, good], "twice");
  // --rerun and reruns combine (flag cells first); a duplicate across them is refused too.
  await assertRejects(
    () =>
      runCampaign(f.t.env, "rr", opts({ rerun: good, reruns: [good] }), io()),
    ConfigurationError,
    "twice",
  );
  const s = await runCampaign(
    f.t.env,
    "rr",
    opts({
      rerun: good,
      reruns: [cell(b2!.task_id, b2!.repeat, "mock-crash")],
    }),
    io(),
  );
  assertEquals((await manual(f.t, f.c.id)).length, 2);
  assertEquals(s.planned, 2);
});

Deno.test("rerun-multi: --sample and --repeats are refused with reruns; the dry run prints one line per cell and writes nothing", async () => {
  const f = await crashy(["mock-positive"], 2);
  const cells = f.c.blocks.map((b) => cell(b.task_id, b.repeat, "mock-crash"));
  const n = await count(f.t, f.c.id);
  for (const over of [{ sample: 1 }, { repeats: 1 }]) {
    await assertRejects(
      () => runCampaign(f.t.env, "rr", opts({ reruns: cells, ...over }), io()),
      ConfigurationError,
      "--rerun runs only the named cells",
    );
  }
  const dry = io();
  const s = await runCampaign(
    f.t.env,
    "rr",
    opts({ reruns: cells, dryRun: true }),
    dry,
  );
  assertEquals([s.planned, s.ran], [2, 0]);
  assertEquals(dry.lines.filter((l) => l.startsWith("[DRY] rerun ")).length, 2);
  assertEquals(await count(f.t, f.c.id), n);
});

Deno.test("rerun-multi: a cell that became scored between validation and its turn is skipped with [SKIP]; the rest runs", async () => {
  const f = await crashy(["mock-positive"], 2);
  const [b1, b2] = f.c.blocks;
  const cells = [
    cell(b1!.task_id, b1!.repeat, "mock-crash"),
    cell(b2!.task_id, b2!.repeat, "mock-crash"),
  ];
  // While the first cell runs, another invocation scores the second: copy a scored
  // mock-positive judgment onto the second cell's arm by making it look done.
  const real = f.t.docker.behavior!;
  let swapped = false;
  f.t.docker.behavior = async (call, run) => {
    if (!swapped && call.labels.get(EXECUTION_LABEL)) {
      swapped = true;
      const all = await f.t.env.store.executions(f.c.id);
      const donor = all.find((e) =>
        e.block === b2!.index && e.arm === "mock-positive"
      )!;
      const target = all.filter((e) =>
        e.block === b2!.index && e.arm === "mock-crash"
      ).sort((a, z) => z.attempt - a.attempt)[0]!;
      const [dj] = await f.t.env.store.judgments(donor.id);
      // Another invocation's scored manual rerun of the cell: copy the donor.
      const copy = {
        ...donor,
        id: crypto.randomUUID(),
        arm: target.arm,
        order_in_block: target.order_in_block,
        attempt: target.attempt + 1,
        run_kind: "manual_rerun" as const,
        retry_of: null,
      };
      await f.t.env.store.writeExecution(copy);
      await f.t.env.store.writeJudgment({
        ...dj!,
        id: crypto.randomUUID(),
        execution_id: copy.id,
      });
    }
    return await real(call, run);
  };
  const out = io();
  await runCampaign(f.t.env, "rr", opts({ reruns: cells }), out);
  assert(
    out.lines.some((l) =>
      l.startsWith("[SKIP] rerun") && l.includes("is scored now")
    ),
    out.lines.join("\n"),
  );
  // The first cell's rerun plus the injected one; the skipped cell ran nothing.
  assertEquals((await manual(f.t, f.c.id)).length, 2);
});

Deno.test("rerun-multi: an empty reruns list is refused, not run as a normal campaign", async () => {
  const f = await crashy(["mock-positive"], 2);
  const n = await count(f.t, f.c.id);
  await assertRejects(
    () => runCampaign(f.t.env, "rr", opts({ reruns: [] }), io()),
    ConfigurationError,
    "names no cell",
  );
  assertEquals(await count(f.t, f.c.id), n);
});

Deno.test("rerun-multi: a same-list relaunch skips the cells an earlier invocation finished (scored) and runs the rest", async () => {
  const f = await crashy(["mock-positive"], 3);
  await spendBudget(f.t, f.c.id);
  const cells = f.c.blocks.map((b) =>
    cell(b.task_id, b.repeat, "mock-positive")
  );
  // The first invocation stops before its second cell.
  let calls = 0;
  const first = await runCampaign(
    f.t.env,
    "rr",
    opts({ reruns: cells, stopRequested: () => Promise.resolve(++calls >= 3) }),
    io(),
  );
  assertEquals([first.stopped, (await manual(f.t, f.c.id)).length], [true, 1]);
  const out = io();
  const second = await runCampaign(f.t.env, "rr", opts({ reruns: cells }), out);
  assertEquals(second.planned, 3);
  const skips = out.lines.filter((l) => l.startsWith("[SKIP] rerun"));
  assertEquals(skips.length, 1, out.lines.join("\n"));
  assert(skips[0]!.includes(`${cells[0]!.task}:1:mock-positive`));
  assert(skips[0]!.includes("is scored now"));
  // Each cell holds exactly one manual rerun.
  const man = await manual(f.t, f.c.id);
  assertEquals(man.map((e) => e.block).sort(), f.c.blocks.map((b) => b.index));
  // Any other non-unscored cell is still refused (scored without a manual rerun).
  await assertRejects(
    () =>
      runCampaign(
        f.t.env,
        "rr",
        opts({
          reruns: [cell(cells[0]!.task, 1, "mock-crash"), {
            ...cells[0]!,
            arm: "mock-nope",
          }],
        }),
        io(),
      ),
    ConfigurationError,
    "no such cell",
  );
});

Deno.test("rerun-multi: a cell still unscored after an earlier manual rerun runs again on a relaunch, as the next manual attempt", async () => {
  const f = await crashy(["mock-positive"], 1);
  const b = f.c.blocks[0]!;
  const list = [cell(b.task_id, b.repeat, "mock-crash")];
  const out = io();
  await runCampaign(f.t.env, "rr", opts({ reruns: list }), out);
  await runCampaign(f.t.env, "rr", opts({ reruns: list }), out);
  assert(!out.lines.some((l) => l.startsWith("[SKIP]")), out.lines.join("\n"));
  assertEquals(
    (await manual(f.t, f.c.id)).map((e) => e.attempt).sort(),
    [3, 5],
  );
});

Deno.test("rerun-multi: an invalid cell refuses the invocation; recovery of an interrupted execution may publish its record, nothing else is written for the rerun cells", async () => {
  const f = await crashy(["mock-positive"], 2);
  const [b1] = f.c.blocks;
  const good = cell(b1!.task_id, b1!.repeat, "mock-crash");
  // A rerun whose container termination is unconfirmed leaves its intent behind.
  const behave = f.t.docker.behavior!;
  f.t.docker.behavior = (call, run) => {
    f.t.docker.lingering.add(call.name);
    return behave(call, run);
  };
  await assertRejects(
    () => runCampaign(f.t.env, "rr", opts({ reruns: [good] }), io()),
    Error,
    "termination not confirmed",
  );
  f.t.docker.lingering.clear();
  f.t.docker.behavior = behave;
  const intents = join(f.t.env.privateRoot, "intents");
  const left = [...Deno.readDirSync(intents)].map((e) => e.name);
  assertEquals(left.length, 1);
  const interrupted = left[0]!.replace(".json", "");
  const before = (await f.t.env.store.executions(f.c.id)).map((e) => e.id);
  const runs = f.t.docker.runs.length;
  await assertRejects(
    () =>
      runCampaign(
        f.t.env,
        "rr",
        opts({ reruns: [good, cell("HX-999", 1, "mock-crash")] }),
        io(),
      ),
    ConfigurationError,
    "no such cell",
  );
  const after = (await f.t.env.store.executions(f.c.id)).map((e) => e.id);
  assertEquals(
    after.filter((id) => !before.includes(id)),
    [interrupted],
    "only the recovered record appeared",
  );
  assertEquals(f.t.docker.runs.length, runs, "nothing was started");
  assertEquals([...Deno.readDirSync(intents)].length, 0, "no new intent");
});

/** Polls until `ready()` or 20 s; then a short settle so the other worker's state lands. */
async function until(ready: () => boolean) {
  for (let i = 0; i < 2000 && !ready(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 100));
}

Deno.test("rerun-multi: a worker suspended inside the stop check does not start once the other worker has stopped the run", async () => {
  const f = await crashy(["mock-positive"], 2);
  const cells = f.c.blocks.map((b) => cell(b.task_id, b.repeat, "mock-crash"));
  const n = await count(f.t, f.c.id);
  let calls = 0;
  let stopSeen = false;
  const stopRequested = async () => {
    const k = ++calls;
    if (k === 2) return stopSeen = true; // worker A: the stop
    if (k === 3) await until(() => stopSeen); // worker B: suspended, then "no stop"
    return false;
  };
  const s = await runCampaign(
    f.t.env,
    "rr",
    opts({ concurrency: 2, reruns: cells, stopRequested }),
    io(),
  );
  assertEquals(s.stopped, true);
  assertEquals(await count(f.t, f.c.id), n, "neither worker started a cell");
});

Deno.test("rerun-multi: one cell on a fixed judge keeps the legacy refusal message; several cells use the new one", async () => {
  const f = await crashy(["mock-positive"], 2);
  const [b1, b2] = f.c.blocks;
  const one = cell(b1!.task_id, b1!.repeat, "mock-crash");
  await assertRejects(
    () => runCampaign(f.t.env, "rr", opts({ rerun: one, sample: 1 }), io()),
    ConfigurationError,
    "--rerun runs one cell: --sample and --repeats do not apply",
  );
  await assertRejects(
    () =>
      runCampaign(
        f.t.env,
        "rr",
        opts({
          rerun: one,
          reruns: [cell(b2!.task_id, b2!.repeat, "mock-crash")],
          sample: 1,
        }),
        io(),
      ),
    ConfigurationError,
    "--rerun runs only the named cells",
  );
});

Deno.test("rerun-multi: the judge queue fails during a multi-cell rerun: admission stops, the in-flight cell settles and the failure is rethrown", async () => {
  const f = await crashy(["mock-positive"], 3);
  await spendBudget(f.t, f.c.id);
  const cells = f.c.blocks.map((b) =>
    cell(b.task_id, b.repeat, "mock-positive")
  );
  let failed = false;
  const lane = f.t.env.lane as unknown as Record<string, unknown>;
  for (const k of ["compile", "compileOn", "exclusive"]) {
    lane[k] = () => {
      failed = true;
      return Promise.reject(new Error("injected judge failure"));
    };
  }
  let calls = 0;
  const stopRequested = async () => {
    // The third check is the one before the second cell: wait for the judge to fail.
    if (++calls === 3) await until(() => failed);
    return false;
  };
  await assertRejects(
    () =>
      runCampaign(f.t.env, "rr", opts({ reruns: cells, stopRequested }), io()),
    Error,
    "injected judge failure",
  );
  assert(failed, "the judge ran and failed");
  assertEquals((await manual(f.t, f.c.id)).length, 1, "no new admission");
});

Deno.test("rerun-multi: a starved judge queue admits nothing new: a worker held at the admission barrier until starvation does not start", async () => {
  const f = await crashy(["mock-positive"], 3);
  await spendBudget(f.t, f.c.id);
  const cells = f.c.blocks.map((b) =>
    cell(b.task_id, b.repeat, "mock-positive")
  );
  let invalidated = false;
  f.t.env.judgePooled = {
    width: () => 0,
    refresh: () => Promise.resolve(),
    invalidate: () => void (invalidated = true),
    poll: () => {},
    bounds: { waitMs: 30, pollMs: 10 },
  };
  let calls = 0;
  const stopRequested = async () => {
    // The check before the second cell is held until the queue has starved.
    if (++calls === 3) await until(() => invalidated);
    return false;
  };
  const s = await runCampaign(
    f.t.env,
    "rr",
    opts({ reruns: cells, stopRequested }),
    io(),
  );
  assert(invalidated, "the queue starved");
  assertEquals(s.starved, true);
  assertEquals(
    (await manual(f.t, f.c.id)).length,
    1,
    "no cell after starvation",
  );
  assertEquals(s.owed, 1);
});

Deno.test("rerun-multi: --rerun-file parsing: comments and blanks ignored, a bad line refused with its number", () => {
  assertEquals(
    parseRerunFile("# the list\n\nHX-001:1:mock-crash\r\n  \nHX-002:2:a\n"),
    [cell("HX-001", 1, "mock-crash"), cell("HX-002", 2, "a")],
  );
  assertThrows(
    () => parseRerunFile("HX-001:1:a\n\nHX-001:x:a\n"),
    ValidationError,
    "line 3",
  );
});
