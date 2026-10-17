/**
 * H-09: judging is decoupled from agent slots. A campaign's agent slot frees
 * once the execution is published; judgments run from a judge queue on their
 * own lane (its own containers). An executed-but-unjudged execution is judged
 * on resume, never executed again. A deferred judgment equals the inline one.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { runCampaign, type RunOptions } from "../../../src/harness/campaign.ts";
import {
  type CellRef,
  judgeDeferred,
  runCell,
} from "../../../src/harness/execution.ts";
import type {
  ExecutionRecord,
  JudgmentRecord,
} from "../../../src/harness/records.ts";
import type { FakeBc } from "./fake-bc.ts";
import { write } from "./refapp-fixture.ts";
import {
  CATALOG,
  cellFor,
  makeEnv,
  mockImageBehavior,
  type TestEnv,
} from "./runtime-fixture.ts";

async function experiment(t: TestEnv, id: string, repeats = 1) {
  await write(
    t.harnessRoot,
    `experiments/${id}.yml`,
    `id: ${id}
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: mock-positive
variants: [mock-naive-a]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: ${repeats}
`,
  );
}

async function mockEnv(): Promise<TestEnv> {
  const t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  return t;
}

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  dryRun: false,
  concurrency: 1,
  seed: 7,
  maxPauseMs: 0,
  ...over,
});

const io = () => ({
  log: () => {},
  sleep: () => Promise.resolve(),
  catalog: CATALOG,
});

/** The fake BC with every call held until `open()`. */
function heldBc(bc: FakeBc) {
  let open!: () => void;
  const gate = new Promise<void>((r) => open = r);
  const held = new Proxy(bc, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      return typeof v === "function"
        ? async (...a: unknown[]) => {
          await gate;
          return v.apply(target, a);
        }
        : v;
    },
  });
  return { held, open };
}

async function campaignExecutions(t: TestEnv, id: string) {
  const c = (await t.env.store.campaigns(id))[0];
  return c ? await t.env.store.executions(c.id) : [];
}

const judgmentsOf = async (t: TestEnv, es: ExecutionRecord[]) =>
  (await Promise.all(es.map((e) => t.env.store.judgments(e.id)))).flat();

Deno.test("H-09: an agent slot never waits on judging: with the judge lane held every cell executes, then each execution gets exactly one judgment on the judge lane", async () => {
  const t = await mockEnv();
  await experiment(t, "contract");
  const { held, open } = heldBc(t.bc);
  t.env.judgeLane = new BcLane(held, ["J1"]);
  const run = runCampaign(t.env, "contract", opts(), io());
  let es: ExecutionRecord[] = [];
  for (let i = 0; i < 400 && es.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 25));
    es = await campaignExecutions(t, "contract");
  }
  const judgedWhileHeld = (await judgmentsOf(t, es)).length;
  open();
  const s = await run;
  assertEquals(es.length, 2, "both cells executed while judging was held");
  assertEquals(judgedWhileHeld, 0);
  const js = await judgmentsOf(t, await campaignExecutions(t, "contract"));
  assertEquals(js.map((j) => j.verdict).sort(), ["fail", "pass"]);
  assertEquals(js.map((j) => j.verdict_container), ["J1", "J1"]);
  // The summary is counted after the judge queue drained.
  assertEquals([s.ran, s.judged, s.unscored], [2, 2, 0]);
});

Deno.test("H-09: without a judge lane the queue judges on the agent lane; the results equal the coupled path", async () => {
  const t = await mockEnv();
  await experiment(t, "contract");
  const s = await runCampaign(t.env, "contract", opts(), io());
  const es = await campaignExecutions(t, "contract");
  const js = await judgmentsOf(t, es);
  assertEquals(js.map((j) => j.verdict).sort(), ["fail", "pass"]);
  assertEquals(js.map((j) => j.verdict_container), ["C1", "C1"]);
  assertEquals([s.ran, s.judged, s.unscored], [2, 2, 0]);
});

Deno.test("H-09: an executed-but-unjudged execution is judged on resume and never executed again", async () => {
  const t = await mockEnv();
  await experiment(t, "contract");
  await runCampaign(t.env, "contract", opts(), io());
  const [e] = await campaignExecutions(t, "contract");
  const before = (await t.env.store.judgments(e!.id))[0]!;
  // A crash after publication, before the judge queue reached it.
  await Deno.remove(join(t.env.resultsRoot, "judgments", e!.id), {
    recursive: true,
  });
  const runs = t.docker.runs.length;
  const s = await runCampaign(t.env, "contract", opts(), io());
  assertEquals([s.ran, t.docker.runs.length], [0, runs], "nothing executed");
  assertEquals((await campaignExecutions(t, "contract")).length, 2);
  const after = await t.env.store.judgments(e!.id);
  assertEquals(after.length, 1);
  assertEquals(after[0]!.verdict, before.verdict);
});

Deno.test("H-09 review: a judge refusal inside a campaign is thrown after the queue drained; nothing is judged on another oracle", async () => {
  const t = await mockEnv();
  await experiment(t, "contract");
  const behave = t.docker.behavior;
  const test = join(
    t.repo.tasksDir,
    "HX-001",
    "oracle",
    "src",
    "Oracle.Test.al",
  );
  // The task's tests are edited while the campaign runs.
  t.docker.behavior = async (call, run) => {
    await Deno.writeTextFile(test, "// edited mid-campaign\n", {
      append: true,
    });
    return await behave(call, run);
  };
  await assertRejects(
    () => runCampaign(t.env, "contract", opts(), io()),
    ConfigurationError,
    "changed since the run",
  );
  const es = await campaignExecutions(t, "contract");
  assert(es.length >= 1);
  assertEquals(await judgmentsOf(t, es), []);
});

/** Every .al text under `dir`. */
async function alText(dir: string): Promise<string> {
  let out = "";
  for await (const e of Deno.readDir(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) out += await alText(p);
    else if (e.name.endsWith(".al")) out += await Deno.readTextFile(p);
  }
  return out;
}

Deno.test("H-09 run 002: judgeDeferred judges the snapshot it validated; an oracle edited after the check never reaches a compile", async () => {
  await using t = await makeEnv();
  const queued: { cell: CellRef; e: ExecutionRecord }[] = [];
  const r = await runCell({
    ...t.env,
    judgeLater: (cell, e) => void queued.push({ cell, e }),
  }, await cellFor(t));
  const e = r.executions[0]!;
  const test = join(
    t.repo.tasksDir,
    "HX-001",
    "oracle",
    "src",
    "Oracle.Test.al",
  );
  const original = await Deno.readTextFile(test);
  // The checks have passed by the judge's first compile: the task is edited then.
  const after: string[] = [];
  t.bc.onCompile = async (dir) => {
    if (
      after.length === 0 && !(await Deno.readTextFile(test)).includes("TOCTOU")
    ) {
      await Deno.writeTextFile(test, original + "// TOCTOU\n");
    }
    after.push(await alText(dir));
  };
  try {
    await judgeDeferred(t.env, queued[0]!.cell, e);
  } finally {
    t.bc.onCompile = null;
    await Deno.writeTextFile(test, original);
  }
  assert(after.length > 1, "compiles ran after the edit");
  assertEquals(after.filter((s) => s.includes("TOCTOU")).length, 0);
});

Deno.test("H-09 run 003: a sibling suspended between admission and its cell (in its prior-executions read) never starts the cell once another worker threw", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", 2);
  const behave = t.docker.behavior;
  let started = 0;
  t.docker.behavior = (call, run) => {
    started++;
    return behave(call, run);
  };
  // Call 1 is the resume sweep, 2 and 3 the two workers' admission reads:
  // the later worker is held in its read until the other one has thrown.
  const store = t.env.store;
  const read = store.executions.bind(store);
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => release = r);
  const safety = setTimeout(() => release(), 10_000);
  store.executions = async (id: string) => {
    const n = ++reads;
    const out = await read(id);
    if (n >= 3) await gate;
    return out;
  };
  let drafts = 0;
  t.env.hooks = {
    beforeDraft: () => {
      if (++drafts !== 1) return Promise.resolve();
      // The throw reaches the campaign well before the held read returns.
      setTimeout(() => release(), 1000);
      return Promise.reject(new Error("runner killed"));
    },
  };
  try {
    await assertRejects(
      () => runCampaign(t.env, "contract", opts({ concurrency: 2 }), io()),
      Error,
      "runner killed",
    );
  } finally {
    clearTimeout(safety);
  }
  assertEquals(started, 1, "the held sibling started no cell");
});

Deno.test("H-09 run 002: a worker's throw stops admissions and settles the sibling workers before the campaign rejects", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", 2);
  const behave = t.docker.behavior;
  let started = 0;
  let active = 0;
  t.docker.behavior = async (call, run) => {
    const n = ++started;
    active++;
    try {
      // The first run ends at once; its sibling is still in its sandbox.
      if (n > 1) await new Promise((r) => setTimeout(r, 1500));
      return await behave(call, run);
    } finally {
      active--;
    }
  };
  let drafts = 0;
  t.env.hooks = {
    beforeDraft: () =>
      ++drafts === 1
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  await assertRejects(
    () => runCampaign(t.env, "contract", opts({ concurrency: 2 }), io()),
    Error,
    "runner killed",
  );
  assertEquals(active, 0, "no sibling sandbox still running at the rejection");
  const startedAtReject = started;
  await new Promise((r) => setTimeout(r, 2000));
  assertEquals(
    started,
    startedAtReject,
    "no cell admitted after the rejection",
  );
  // The thrown cell and the sibling's cell in flight; the sibling's second arm never starts.
  assertEquals(started, 2, "admissions stopped at the throw");
});

Deno.test("H-09: --judge-concurrency below 1 is refused before any record", async () => {
  const t = await mockEnv();
  await experiment(t, "contract");
  await assertRejects(
    () => runCampaign(t.env, "contract", opts({ judgeConcurrency: 0 }), io()),
    ConfigurationError,
    "judge concurrency",
  );
  assertEquals(await t.env.store.campaigns("contract"), []);
});

/** A judgment without what differs between two runs of the same scorer. */
const comparable = (j: JudgmentRecord) => {
  const { id: _i, started_at: _s, ended_at: _e, ...rest } = j;
  return rest;
};

Deno.test("H-09: a cell with judgeLater queues instead of judging; judgeDeferred then writes the judgment the inline path writes", async () => {
  await using t = await makeEnv();
  const inline = await runCell(t.env, await cellFor(t));
  const ref = (await t.env.store.judgments(inline.executions[0]!.id))[0]!;
  const queued: { cell: CellRef; e: ExecutionRecord }[] = [];
  const deferredEnv = {
    ...t.env,
    judgeLater: (cell: CellRef, e: ExecutionRecord) =>
      void queued.push({ cell, e }),
  };
  const r = await runCell(deferredEnv, await cellFor(t));
  const e = r.executions[0]!;
  assertEquals(queued.map((q) => q.e.id), [e.id]);
  assertEquals(await t.env.store.judgments(e.id), [], "nothing judged inline");
  const j = await judgeDeferred(t.env, queued[0]!.cell, e);
  assertEquals(await t.env.store.judgments(e.id), [j]);
  assertEquals(
    { ...comparable(j), execution_id: "", workspace_hash: "" },
    { ...comparable(ref), execution_id: "", workspace_hash: "" },
  );
});

Deno.test("H-09: judgeDeferred refuses when the restaged task differs from the one the agent ran on; nothing written", async () => {
  await using t = await makeEnv();
  const queued: { cell: CellRef; e: ExecutionRecord }[] = [];
  const r = await runCell({
    ...t.env,
    judgeLater: (cell, e) => void queued.push({ cell, e }),
  }, await cellFor(t));
  const e = r.executions[0]!;
  const side = join(t.env.resultsRoot, "runs", e.id, "sandbox.json");
  const text = await Deno.readTextFile(side);
  const json = JSON.parse(text);
  for (const pristine of ["0".repeat(64), undefined]) {
    await Deno.writeTextFile(
      side,
      JSON.stringify({ ...json, pristine_hash: pristine }),
    );
    await assertRejects(
      () => judgeDeferred(t.env, queued[0]!.cell, e),
      ConfigurationError,
      "pristine",
    );
    assertEquals(await t.env.store.judgments(e.id), []);
  }
  await Deno.writeTextFile(side, text);
  const j = await judgeDeferred(t.env, queued[0]!.cell, e);
  assert(j.verdict === "pass" || j.verdict === "fail", j.verdict);
});

Deno.test("H-09 review: judgeDeferred refuses when the oracle changed since the run (on disk, or another oracle recorded by the run); nothing written", async () => {
  await using t = await makeEnv();
  const queued: { cell: CellRef; e: ExecutionRecord }[] = [];
  const r = await runCell({
    ...t.env,
    judgeLater: (cell, e) => void queued.push({ cell, e }),
  }, await cellFor(t));
  const e = r.executions[0]!;
  const { cell } = queued[0]!;
  // The task's tests edited while the judgment waited in the queue.
  const test = join(
    t.repo.tasksDir,
    "HX-001",
    "oracle",
    "src",
    "Oracle.Test.al",
  );
  const original = await Deno.readTextFile(test);
  await Deno.writeTextFile(test, original + "// edited\n");
  await assertRejects(
    () => judgeDeferred(t.env, cell, e),
    ConfigurationError,
    "oracle",
  );
  await Deno.writeTextFile(test, original);
  // The run recorded another oracle than the cell's (or none).
  const side = join(t.env.resultsRoot, "runs", e.id, "sandbox.json");
  const text = await Deno.readTextFile(side);
  const json = JSON.parse(text);
  assertEquals(json.oracle_hash, cell.oracleHash, "the run records its oracle");
  for (const oracle of ["0".repeat(64), undefined]) {
    await Deno.writeTextFile(
      side,
      JSON.stringify({ ...json, oracle_hash: oracle }),
    );
    await assertRejects(
      () => judgeDeferred(t.env, cell, e),
      ConfigurationError,
      "oracle",
    );
  }
  assertEquals(await t.env.store.judgments(e.id), []);
  await Deno.writeTextFile(side, text);
  await judgeDeferred(t.env, cell, e);
  assertEquals((await t.env.store.judgments(e.id)).length, 1);
});
