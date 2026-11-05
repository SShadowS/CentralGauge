// H-62: several --rerun cells in one invocation, through the normal scheduler.
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
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

Deno.test("rerun-multi: cells of different blocks overlap at --concurrency 2; cells of one block run in the given order, never overlapping; all are manual_rerun and judged", async () => {
  const f = await crashy(["mock-positive"], 3);
  // Make each block's mock-positive cell terminally unscored (rejudge budget spent).
  for (const e of await f.t.env.store.executions(f.c.id)) {
    if (e.arm !== "mock-positive") continue;
    const [j] = await f.t.env.store.judgments(e.id);
    for (let i = 0; i < 3; i++) {
      const at = new Date(Date.now() + 1000 + i).toISOString();
      await f.t.env.store.writeJudgment({
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
