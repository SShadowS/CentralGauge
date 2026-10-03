import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { walk } from "@std/fs";
import { join } from "@std/path";
import { stringify } from "@std/yaml";
import {
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../../../src/errors.ts";
import {
  loadCampaignData,
  runCampaign,
  type RunOptions,
} from "../../../src/harness/campaign.ts";
import { loadExperiment } from "../../../src/harness/config.ts";
import { hashFile, sha256Hex } from "../../../src/harness/hash.ts";
import { PreregSchema, protocolSha } from "../../../src/harness/prereg.ts";
import { experimentHash } from "../../../src/harness/records.ts";
import { PROXY_ISOLATION } from "../../../src/harness/egress-proxy.ts";
import { imageTag, mcpLabel } from "../../../src/harness/images.ts";
import { validateCampaignRecords } from "../../../src/harness/integrity.ts";
import { buildReport } from "../../../src/harness/report.ts";
import { privatePaths, runCell } from "../../../src/harness/execution.ts";
import { mockAdapter } from "../../../src/harness/adapters/mock.ts";
import { EXECUTION_LABEL } from "../../../src/harness/sandbox.ts";
import { git, write } from "./refapp-fixture.ts";
import {
  CATALOG,
  cellFor,
  enforce,
  makeEnv,
  MOCK_IMAGE_ID,
  mockImageBehavior,
  type TestEnv,
} from "./runtime-fixture.ts";

async function experiment(
  t: TestEnv,
  id: string,
  baseline: string,
  variants: string[],
  vary = "[settings]",
  repeats = 1,
) {
  await write(
    t.harnessRoot,
    `experiments/${id}.yml`,
    `id: ${id}
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: ${baseline}
variants: [${variants.join(", ")}]
vary: ${vary}
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

function io() {
  const lines: string[] = [];
  return {
    lines,
    log: (l: string) => void lines.push(l),
    sleep: () => Promise.resolve(),
    catalog: CATALOG,
  };
}

Deno.test("dry run plans blocks x arms with the recorded order and writes nothing", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  const out = io();
  const s = await runCampaign(t.env, "contract", opts({ dryRun: true }), out);
  assertEquals([s.planned, s.ran, s.created], [2, 0, false]);
  assert(out.lines.some((l) => l.includes("HX-001#1")), out.lines.join("\n"));
  assertEquals(await t.env.store.campaigns("contract"), []);
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("dry run opens no container, even for an al-tools image; a real run still verifies the shipped definition", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  // The mock image claims al-tools but ships no definition (a lying label).
  const [key, value] = await mcpLabel(".");
  t.docker.addImage(imageTag("mock", "2"), MOCK_IMAGE_ID, {
    "centralgauge.harness": "mock",
    "centralgauge.harness.version": "2",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
    [key]: value,
  });
  const out = io();
  const s = await runCampaign(t.env, "contract", opts({ dryRun: true }), out);
  assertEquals(s.planned, 2);
  assertEquals(t.docker.reads, [], "no read container: no create, cp or rm");
  assertEquals(t.docker.runs.length, 0);
  assert(
    out.lines.some((l) =>
      l.includes(imageTag("mock", "2")) && l.includes("not verified")
    ),
    out.lines.join("\n"),
  );
  await assertRejects(
    () => runCampaign(t.env, "contract", opts(), io()),
    ConfigurationError,
    "cannot read the shipped",
  );
  assertEquals(t.docker.reads.length, 1, "the real run read the definition");
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("a full run judges every planned cell; resume after a kill reuses the campaign id and skips done cells", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  let n = 0;
  t.env.hooks = {
    beforeDraft: () =>
      ++n === 2
        ? Promise.reject(new Error("runner killed"))
        : Promise.resolve(),
  };
  await assertRejects(
    () => runCampaign(t.env, "contract", opts(), io()),
    Error,
    "runner killed",
  );
  t.env.hooks = {};
  const s = await runCampaign(t.env, "contract", opts(), io());
  const [c, ...more] = await t.env.store.campaigns("contract");
  assertEquals([s.created, s.campaignId, more.length], [false, c!.id, 0]);
  const data = await loadCampaignData(t.env.store, c!);
  await validateCampaignRecords(data);
  assertEquals(data.executions.length, 2, "the killed attempt was recovered");
  assertEquals(
    data.judgments.map((j) => j.verdict).sort(),
    ["fail", "pass"],
  );
  const again = await runCampaign(t.env, "contract", opts(), io());
  assertEquals([again.ran, t.docker.runs.length], [0, 2]);
});

Deno.test("a crash before work gets one auto_retry decided by ancestry; a second crash is final; a manual_rerun root may get its own retry", async () => {
  const t = await mockEnv();
  await experiment(t, "crashy", "mock-positive", ["mock-crash"]);
  const s = await runCampaign(t.env, "crashy", opts(), io());
  const c = (await t.env.store.campaigns("crashy"))[0]!;
  const crash = () =>
    t.env.store.executions(c.id).then((es) =>
      es.filter((e) => e.arm === "mock-crash").sort((a, b) =>
        a.attempt - b.attempt
      )
    );
  assertEquals((await crash()).map((e) => e.run_kind), [
    "planned",
    "auto_retry",
  ]);
  assertEquals(s.unscored, 2);
  await runCampaign(t.env, "crashy", opts(), io());
  assertEquals((await crash()).length, 2, "the second crash is final");
  // An operator rerun is a new root; its interrupted retry is resumed by the campaign.
  const cell = { ...(await cellFor(t, "mock-crash")), campaignId: c.id };
  const block = c.blocks[0]!;
  const ref = {
    ...cell,
    block,
    orderInBlock: block.order.indexOf("mock-crash"),
  };
  // Supervised: runCell withholds the manual root's retry; the campaign owes it.
  const manual = await runCell({ ...t.env, supervised: true }, ref, {
    attempt: 3,
    runKind: "manual_rerun",
    retryOf: null,
  }, await crash());
  assert(manual.withheld !== null);
  await runCampaign(t.env, "crashy", opts(), io());
  const all = await crash();
  assertEquals(all.map((e) => [e.attempt, e.run_kind]), [
    [1, "planned"],
    [2, "auto_retry"],
    [3, "manual_rerun"],
    [4, "auto_retry"],
  ]);
  await validateCampaignRecords(await loadCampaignData(t.env.store, c));
});

Deno.test("an unconfirmed sandbox termination stops the campaign with the intent kept; the next run recovers it before planning", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  const behave = t.docker.behavior;
  t.docker.behavior = (call, run) => {
    t.docker.lingering.add(call.name);
    return behave(call, run);
  };
  await assertRejects(
    () => runCampaign(t.env, "contract", opts(), io()),
    ContainerError,
    "termination not confirmed",
  );
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const intents = [...Deno.readDirSync(join(t.env.privateRoot, "intents"))];
  assertEquals(intents.length, 1);
  const id = intents[0]!.name.replace(".json", "");
  assertEquals(await t.env.store.executions(c.id), []);
  t.docker.lingering.clear();
  t.docker.behavior = behave;
  await runCampaign(t.env, "contract", opts(), io());
  const es = await t.env.store.executions(c.id);
  assert(es.some((e) => e.id === id), "the kept attempt was recovered");
  assertEquals(es.length, 2);
  await Deno.stat(privatePaths(t.env, id).intent).then(
    () => assert(false, "intent removed after recovery"),
    () => {},
  );
});

Deno.test("a credential-bearing arm is refused without egress enforcement; with it, the campaign runs unattended", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  await write(
    t.harnessRoot,
    "configs/cc-sonnet-effort.yml",
    `id: cc-sonnet-effort
harness: claude-code
harness_version: "2.1.282"
models: { main: anthropic/claude-sonnet-5 }
settings: { effort: high }
components: { instructions: bundles/env/instructions }
limits: { timeout_min: 30, max_budget_usd: 5 }
`,
  );
  await experiment(t, "cc", "cc-sonnet-plain", ["cc-sonnet-effort"]);
  await assertRejects(
    () => runCampaign(t.env, "cc", opts(), io()),
    ConfigurationError,
    "egress",
  );
  assertEquals(await t.env.store.campaigns("cc"), []);
  enforce(t); // M1-33: verified enforcement comes with its egress runtime
  const s = await runCampaign(t.env, "cc", opts(), io());
  assertEquals([s.ran, s.judged], [2, 2]);
});

Deno.test("tasks_meta.limits stores the task's own overrides; two arms with different limits against one task override get their own effective execution limits; reuse stays empty", async () => {
  const t = await mockEnv();
  await write(
    t.harnessRoot,
    "configs/mock-positive-long.yml",
    `id: mock-positive-long
harness: mock
harness_version: "2"
models: {}
settings: { mode: apply, variant: positive }
limits: { timeout_min: 60, max_budget_usd: 1 }
`,
  );
  await experiment(
    t,
    "limits",
    "mock-positive",
    ["mock-positive-long"],
    "[limits]",
  );
  await runCampaign(t.env, "limits", opts(), io());
  const c = (await t.env.store.campaigns("limits"))[0]!;
  assertEquals(c.tasks_meta.map((m) => m.limits), [{ timeout_min: 20 }]);
  assertEquals(c.reuse, []);
  const byArm = Object.fromEntries(
    (await t.env.store.executions(c.id)).map((
      e,
    ) => [e.arm, e.manifest.limits.timeout_min]),
  );
  assertEquals(byArm, { "mock-positive": 5, "mock-positive-long": 20 });
  assertEquals(
    c.arms.map((a) => [a.config_id, a.manifest.limits.timeout_min]).sort(),
    [["mock-positive", 5], ["mock-positive-long", 60]],
  );
});

Deno.test("an experiment whose variant differs outside vary is refused on the first run, with no records and no executions", async () => {
  const t = await mockEnv();
  await experiment(t, "bad", "mock-positive", ["mock-naive-a"], "[limits]");
  await assertRejects(
    () => runCampaign(t.env, "bad", opts(), io()),
    ValidationError,
    "mock-naive-a",
  );
  await assertRejects(
    () => runCampaign(t.env, "bad", opts({ dryRun: true }), io()),
    ValidationError,
  );
  assertEquals(await t.env.store.campaigns("bad"), []);
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("a usage limit with maxPauseMs 0 stops with a resume line; a resume before the persisted reset starts no attempt; after it the cell is retried as auto_retry", async () => {
  const t = await mockEnv();
  let clock = Date.now();
  t.env.now = () => new Date(clock);
  await experiment(t, "limits", "mock-positive", ["mock-usage"]);
  const out = io();
  const s = await runCampaign(t.env, "limits", opts(), out);
  assert(s.paused !== null && s.paused !== "unknown", String(s.paused));
  assert(
    out.lines.some((l) => l.includes("harness run limits")),
    out.lines.join("\n"),
  );
  const runs = t.docker.runs.length;
  const out2 = io();
  const early = await runCampaign(t.env, "limits", opts(), out2);
  assertEquals([t.docker.runs.length, early.ran, early.paused], [
    runs,
    0,
    s.paused,
  ]);
  assert(out2.lines.some((l) => l.includes("harness run limits")));
  clock = Date.parse(s.paused!) + 1000;
  // After the reset the account is no longer limited: the retry completes.
  t.docker.behavior = async (_call, run) => {
    await run.stdout('{"type":"mock_init","version":"2","mode":"apply"}');
    await run.stdout('{"type":"mock_done","status":"ok"}');
    return 0;
  };
  await runCampaign(t.env, "limits", opts(), io());
  const c = (await t.env.store.campaigns("limits"))[0]!;
  const usage = (await t.env.store.executions(c.id)).filter((e) =>
    e.arm === "mock-usage"
  ).sort((a, b) => a.attempt - b.attempt);
  assertEquals(usage.map((e) => e.run_kind), ["planned", "auto_retry"]);
  await validateCampaignRecords(await loadCampaignData(t.env.store, c));
});

Deno.test("a usage limit within maxPauseMs is waited out (also after a restart), then the cell is retried as auto_retry", async () => {
  const t = await mockEnv();
  let clock = Date.now();
  t.env.now = () => new Date(clock);
  await experiment(t, "limits", "mock-positive", ["mock-usage"]);
  await runCampaign(t.env, "limits", opts(), io());
  // Restart before the reset, now allowed to wait: the persisted reset is waited out.
  const waits: number[] = [];
  const out = {
    ...io(),
    sleep: (ms: number) => {
      waits.push(ms);
      clock += ms;
      // The mock is always limited: stop the second wait to end the test.
      return waits.length > 1
        ? Promise.reject(new Error("stop waiting"))
        : Promise.resolve();
    },
  };
  await assertRejects(
    () => runCampaign(t.env, "limits", opts({ maxPauseMs: 2 * 3600_000 }), out),
    Error,
    "stop waiting",
  );
  assert(waits[0]! > 0 && waits[0]! <= 2 * 3600_000, String(waits[0]));
  const c = (await t.env.store.campaigns("limits"))[0]!;
  const usage = (await t.env.store.executions(c.id)).filter((e) =>
    e.arm === "mock-usage"
  ).sort((a, b) => a.attempt - b.attempt);
  assertEquals(usage.map((e) => e.run_kind), ["planned", "auto_retry"]);
});

Deno.test("concurrency runs whole blocks in parallel; the arms of one block run one after another in the planned order", async () => {
  const t = await mockEnv();
  await experiment(
    t,
    "contract",
    "mock-positive",
    ["mock-naive-a"],
    "[settings]",
    2,
  );
  const events: { id: string; at: "start" | "end"; t: number }[] = [];
  const behave = t.docker.behavior;
  t.docker.behavior = async (call, run) => {
    const id = call.labels.get(EXECUTION_LABEL)!;
    events.push({ id, at: "start", t: performance.now() });
    const code = await behave(call, run);
    events.push({ id, at: "end", t: performance.now() });
    return code;
  };
  await runCampaign(t.env, "contract", opts({ concurrency: 2 }), io());
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const es = await t.env.store.executions(c.id);
  assertEquals(es.length, 4);
  const span = (id: string) => ({
    start: events.find((e) => e.id === id && e.at === "start")!.t,
    end: events.find((e) => e.id === id && e.at === "end")!.t,
  });
  for (const b of c.blocks) {
    const mine = es.filter((e) => e.block === b.index).sort((x, y) =>
      span(x.id).start - span(y.id).start
    );
    assertEquals(mine.map((e) => e.arm), b.order, "planned order");
    assert(
      span(mine[0]!.id).end <= span(mine[1]!.id).start,
      "arms of one block never overlap",
    );
  }
  const first = es.filter((e) => e.block === 0).map((e) => span(e.id));
  const second = es.filter((e) => e.block === 1).map((e) => span(e.id));
  assert(
    Math.min(...second.map((x) => x.start)) <
      Math.max(...first.map((x) => x.end)),
    "the two blocks ran in parallel",
  );
});

Deno.test("runCampaign: concurrency > 1 with placed sandboxes is refused before any write (M1-33c)", async () => {
  const t = await mockEnv();
  const files = async () => {
    const out: string[] = [];
    for await (const e of walk(t.env.resultsRoot)) out.push(e.path);
    return out.sort();
  };
  const before = await files();
  await assertRejects(
    () =>
      runCampaign(
        { ...t.env, egress: {} as NonNullable<typeof t.env.egress> },
        "contract",
        opts({ concurrency: 2 }),
        io(),
      ),
    ConfigurationError,
    "--concurrency",
  );
  assertEquals(await files(), before);
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("runCampaign: concurrency > 1 with enforced egress (no placement object) is refused too (M1-33c review)", async () => {
  const t = await mockEnv();
  await assertRejects(
    () =>
      runCampaign(
        { ...t.env, egressEnforced: true },
        "contract",
        opts({ concurrency: 2 }),
        io(),
      ),
    ConfigurationError,
    "--concurrency",
  );
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("runCampaign (M1-33e): above concurrency 1 a placed environment needs env.proxyIsolation exactly PROXY_ISOLATION, checked before any write alongside the refusal", async () => {
  const t = await mockEnv();
  const placed = { ...t.env, egress: {} as NonNullable<typeof t.env.egress> };
  const refused = async (env: typeof t.env) =>
    (await assertRejects(
      () => runCampaign(env, "contract", opts({ concurrency: 2 }), io()),
      ConfigurationError,
      "--concurrency",
    )).message;
  // Not set on a placed environment (fail closed), lower, higher, non-integer.
  assertStringIncludes(await refused(placed), "proxy_isolation missing");
  for (const v of [1, 3, 2.5, "2"]) {
    assertStringIncludes(
      await refused({ ...placed, proxyIsolation: v }),
      `proxy_isolation ${JSON.stringify(v)}`,
    );
  }
  assertStringIncludes(
    await refused({ ...t.env, egressEnforced: true, proxyIsolation: 1 }),
    "proxy_isolation 1",
  );
  // The exact version passes the gate; the M1-33c refusal still stands.
  const ok = await refused({ ...placed, proxyIsolation: PROXY_ISOLATION });
  assertEquals(ok.includes("proxy_isolation"), false, ok);
  assertEquals(t.docker.runs.length, 0);
});

const estimateLine = (lines: string[], arm: string) =>
  lines.find((l) => l.startsWith(`[DRY] estimate ${arm}:`));

Deno.test("dry-run estimate: a late rejudge does not change the verdict time (first judgment only)", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  await runCampaign(t.env, "contract", opts(), io());
  const before = io();
  await runCampaign(t.env, "contract", opts({ dryRun: true }), before);
  const line = estimateLine(before.lines, "mock-positive");
  assert(line?.includes("0 cells x 1 attempts"), before.lines.join("\n"));
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const e = (await t.env.store.executions(c.id)).find((x) =>
    x.arm === "mock-positive"
  )!;
  const [first] = await t.env.store.judgments(e.id);
  const at = (h: number) =>
    new Date(Date.parse(first!.ended_at) + h * 3600_000).toISOString();
  await t.env.store.writeJudgment({
    ...first!,
    id: crypto.randomUUID(),
    started_at: at(3),
    ended_at: at(5),
  });
  const after = io();
  await runCampaign(t.env, "contract", opts({ dryRun: true }), after);
  assertEquals(estimateLine(after.lines, "mock-positive"), line);
});

Deno.test("dry-run estimate: a pending cell (automatic retry owed after mock-crash) counts as outstanding", async () => {
  const t = await mockEnv();
  await experiment(t, "crashy", "mock-positive", ["mock-crash"]);
  t.env.hooks = {
    after: async (step) => {
      if (
        step === "execution" &&
        (await t.env.store.allExecutions()).some((e) => e.arm === "mock-crash")
      ) throw new Error("runner killed");
    },
  };
  await assertRejects(
    () => runCampaign(t.env, "crashy", opts(), io()),
    Error,
    "runner killed",
  );
  t.env.hooks = {};
  const out = io();
  await runCampaign(t.env, "crashy", opts({ dryRun: true }), out);
  assert(
    estimateLine(out.lines, "mock-crash")?.startsWith(
      "[DRY] estimate mock-crash: 1 cells",
    ),
    out.lines.join("\n"),
  );
});

Deno.test("dry-run estimate: a second experiment sharing the baseline manifest borrows its samples", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  await experiment(t, "other", "mock-positive", ["mock-crash"]);
  await runCampaign(t.env, "contract", opts(), io());
  const out = io();
  await runCampaign(t.env, "other", opts({ dryRun: true }), out);
  const text = out.lines.join("\n");
  assert(
    estimateLine(out.lines, "mock-positive")?.includes(
      "1 cells x 1 attempts",
    ) && estimateLine(out.lines, "mock-positive")?.includes("(1 samples)"),
    text,
  );
  assert(
    estimateLine(out.lines, "mock-crash")?.includes("no prior executions"),
    text,
  );
  assert(out.lines.some((l) => l.startsWith("[DRY] total ")), text);
});

// ---- M5-03: stop files and the campaign pin ----

Deno.test("a stop file stops between cells; present at start runs nothing; resume keeps id, seed and order", async () => {
  const t = await mockEnv();
  await experiment(
    t,
    "contract",
    "mock-positive",
    ["mock-naive-a"],
    "[settings]",
    2,
  );
  const pause = join(t.repo.root, "pause.json"); // never created: the global pause is only checked
  const stop = join(t.repo.root, "stop-contract.json");
  await Deno.writeTextFile(stop, "{}");
  const idle = await runCampaign(
    t.env,
    "contract",
    opts({ stopFiles: [pause, stop] }),
    io(),
  );
  assertEquals([idle.ran, idle.stopped, t.docker.runs.length], [0, true, 0]);
  await Deno.remove(stop);
  let n = 0;
  t.env.hooks = {
    beforeDraft: async () => {
      if (++n === 1) await Deno.writeTextFile(stop, "{}");
    },
  };
  const out = io();
  const s = await runCampaign(
    t.env,
    "contract",
    opts({ stopFiles: [pause, stop] }),
    out,
  );
  assertEquals(
    [s.ran, s.stopped],
    [1, true],
    "the running cell finished, no new one started",
  );
  assert(
    out.lines.some((l) =>
      l.includes("resume with: centralgauge harness run contract")
    ),
  );
  const before = (await t.env.store.campaigns("contract"))[0]!;
  await Deno.remove(stop);
  t.env.hooks = {};
  const again = await runCampaign(
    t.env,
    "contract",
    opts({ stopFiles: [pause, stop], campaign: before.id }),
    io(),
  );
  const after = (await t.env.store.campaigns("contract"))[0]!;
  // The campaign the stopped-at-start call created is the one resumed.
  assertEquals([s.campaignId, before.id, again.campaignId], [
    idle.campaignId,
    idle.campaignId,
    idle.campaignId,
  ]);
  assertEquals([again.stopped, after.id, after.seed, after.blocks], [
    false,
    before.id,
    before.seed,
    before.blocks,
  ]);
});

Deno.test("--campaign refuses drift and unknown ids before any write", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  await runCampaign(t.env, "contract", opts(), io());
  const c = (await t.env.store.campaigns("contract"))[0]!;
  await experiment(
    t,
    "contract",
    "mock-positive",
    ["mock-naive-a"],
    "[settings]",
    2,
  ); // experiment hash changes
  await assertRejects(
    () => runCampaign(t.env, "contract", opts({ campaign: c.id }), io()),
    ConfigurationError,
    "experiment_hash",
  );
  await assertRejects(
    () =>
      runCampaign(
        t.env,
        "contract",
        opts({ campaign: "00000000-0000-0000-0000-000000000000" }),
        io(),
      ),
    ConfigurationError,
    "no campaign",
  );
  assertEquals((await t.env.store.campaigns("contract")).length, 1);
});

// ---- M5-04: manual rerun of an unscored cell ----

Deno.test("--rerun of an exhausted mock-crash cell writes one manual_rerun root plus its owed retry only; the report keeps both attempts' spend", async () => {
  const t = await mockEnv();
  await experiment(t, "crashy", "mock-positive", ["mock-crash"]);
  await runCampaign(t.env, "crashy", opts(), io());
  const c = (await t.env.store.campaigns("crashy"))[0]!;
  const before = await t.env.store.executions(c.id);
  const s = await runCampaign(
    t.env,
    "crashy",
    opts({ rerun: { task: "HX-001", repeat: 1, arm: "mock-crash" } }),
    io(),
  );
  const after = await t.env.store.executions(c.id);
  const fresh = after.filter((e) => !before.some((b) => b.id === e.id))
    .sort((a, b) => a.attempt - b.attempt);
  assertEquals(
    fresh.map((e) => [e.arm, e.attempt, e.run_kind, e.retry_of === null]),
    [["mock-crash", 3, "manual_rerun", true], [
      "mock-crash",
      4,
      "auto_retry",
      false,
    ]],
  );
  assertEquals([s.campaignId, s.created, s.ran], [c.id, false, 2]);
  const data = await loadCampaignData(t.env.store, c);
  await validateCampaignRecords(data);
  const rep = await buildReport(data, { resamples: 50, seed: 1 });
  const cell = rep.cells.find((x) => x.arm === "mock-crash")!;
  const crash = after.filter((e) => e.arm === "mock-crash");
  assertEquals([cell.attempts, cell.manual_reruns], [4, 1]);
  assertEquals(
    cell.known_spend_usd,
    [...crash].sort((a, b) => a.attempt - b.attempt)
      .reduce((n, e) => n + (e.telemetry.cost_usd ?? 0), 0),
  );
  // Both chains end terminally unscored. A manual chain replaces the planned
  // one only when scored or pending (outcome.ts cellsFromRecords), so the
  // planned chain's last member, attempt 2, is the used execution.
  const attempt2 = crash.find((e) => e.attempt === 2)!;
  assertEquals(
    [cell.status, cell.used_execution, cell.used_kind],
    ["unscored", attempt2.id, "planned"],
  );
});

Deno.test("--rerun refuses scored (pass and fail), pending, unrun and unknown cells before any container run", async () => {
  const t = await mockEnv();
  await experiment(
    t,
    "contract",
    "mock-positive",
    ["mock-naive-a"],
    "[settings]",
    2,
  );
  const rerun = (task: string, repeat: number, arm: string) =>
    opts({ rerun: { task, repeat, arm } });
  // No campaign yet: a rerun never creates one.
  await assertRejects(
    () =>
      runCampaign(t.env, "contract", rerun("HX-001", 1, "mock-positive"), io()),
    ConfigurationError,
    "no campaign",
  );
  assertEquals(await t.env.store.campaigns("contract"), []);
  await runCampaign(t.env, "contract", opts({ sample: 1 }), io());
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const first = c.blocks[0]!;
  const second = c.blocks[1]!;
  const runs = t.docker.runs.length;
  const count = async () => (await t.env.store.executions(c.id)).length;
  const n = await count();
  const refused = async (r: RunOptions, message: string) => {
    await assertRejects(
      () => runCampaign(t.env, "contract", r, io()),
      ConfigurationError,
      message,
    );
    assertEquals([t.docker.runs.length, await count()], [runs, n], message);
  };
  await refused(
    rerun(first.task_id, first.repeat, "mock-positive"),
    "is scored",
  );
  await refused(
    rerun(first.task_id, first.repeat, "mock-naive-a"),
    "is scored",
  );
  await refused(
    rerun(second.task_id, second.repeat, "mock-positive"),
    "is unrun",
  );
  await refused(rerun("HX-999", 1, "mock-positive"), "no such cell");
  await refused(rerun(first.task_id, 9, "mock-positive"), "no such cell");
  await refused(rerun(first.task_id, 1, "mock-nope"), "no such cell");

  const u = await mockEnv();
  u.env.now = () => new Date(Date.now());
  await experiment(u, "limits", "mock-positive", ["mock-usage"]);
  const paused = await runCampaign(u.env, "limits", opts(), io());
  assert(paused.paused !== null && paused.paused !== "unknown");
  const uRuns = u.docker.runs.length;
  const uCamp = (await u.env.store.campaigns("limits"))[0]!;
  const uCount = (await u.env.store.executions(uCamp.id)).length;
  await assertRejects(
    () =>
      runCampaign(
        u.env,
        "limits",
        opts({ rerun: { task: "HX-001", repeat: 1, arm: "mock-usage" } }),
        io(),
      ),
    ConfigurationError,
    "is pending",
  );
  assertEquals(
    [u.docker.runs.length, (await u.env.store.executions(uCamp.id)).length],
    [uRuns, uCount],
  );
});

Deno.test("--rerun composes with --campaign, --dry-run and --stop-file; refuses --sample and --repeats", async () => {
  const t = await mockEnv();
  await experiment(t, "crashy", "mock-positive", ["mock-crash"]);
  await runCampaign(t.env, "crashy", opts(), io());
  const c = (await t.env.store.campaigns("crashy"))[0]!;
  const rerun = { task: "HX-001", repeat: 1, arm: "mock-crash" };
  const count = async () => (await t.env.store.executions(c.id)).length;
  const n = await count();
  const runs = t.docker.runs.length;
  for (const over of [{ sample: 1 }, { repeats: 1 }]) {
    await assertRejects(
      () => runCampaign(t.env, "crashy", opts({ rerun, ...over }), io()),
      ConfigurationError,
      "--rerun runs one cell",
    );
  }
  await assertRejects(
    () =>
      runCampaign(
        t.env,
        "crashy",
        opts({ rerun, campaign: "00000000-0000-0000-0000-000000000000" }),
        io(),
      ),
    ConfigurationError,
    "no campaign",
  );
  const dry = io();
  const d = await runCampaign(
    t.env,
    "crashy",
    opts({ rerun, dryRun: true }),
    dry,
  );
  assertEquals([d.campaignId, d.planned, d.ran], [c.id, 1, 0]);
  assert(
    dry.lines.some((l) =>
      l.includes("[DRY] rerun HX-001#1 mock-crash as attempt 3")
    ),
    dry.lines.join("\n"),
  );
  const stop = join(t.repo.root, "stop-crashy.json");
  await Deno.writeTextFile(stop, "{}");
  const stopped = await runCampaign(
    t.env,
    "crashy",
    opts({ rerun, campaign: c.id, stopFiles: [stop] }),
    io(),
  );
  assertEquals([stopped.stopped, stopped.ran], [true, 0]);
  assertEquals([await count(), t.docker.runs.length], [n, runs]);
  await Deno.remove(stop);
  const s = await runCampaign(
    t.env,
    "crashy",
    opts({ rerun, campaign: c.id, stopFiles: [stop] }),
    io(),
  );
  assertEquals([s.campaignId, s.ran, await count()], [c.id, 2, n + 2]);
});

// ---- M5-07a run 002: each arm's parser version is pinned in the campaign ----

Deno.test("M5-07a: a campaign pins each arm's parser; resume under the same parser, never under another", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  await runCampaign(t.env, "contract", opts(), io());
  const c = (await t.env.store.campaigns("contract"))[0]!;
  assertEquals(c.arms.map((a) => a.parser), [
    mockAdapter.parser,
    mockAdapter.parser,
  ]);
  const same = await runCampaign(
    t.env,
    "contract",
    opts({ campaign: c.id }),
    io(),
  );
  assertEquals([same.campaignId, same.created], [c.id, false]);
  const was = mockAdapter.parser;
  for (const other of ["mock-trace@0", "mock-trace@9"]) {
    mockAdapter.parser = other;
    try {
      await assertRejects(
        () => runCampaign(t.env, "contract", opts({ campaign: c.id }), io()),
        ConfigurationError,
        "arms[].parser",
      );
    } finally {
      mockAdapter.parser = was;
    }
  }
  assertEquals((await t.env.store.campaigns("contract")).length, 1);
});

Deno.test("M5-07a: a campaign recorded without parser versions is never resumed; an unpinned run starts a new one", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  await runCampaign(t.env, "contract", opts(), io());
  const c = (await t.env.store.campaigns("contract"))[0]!;
  // A record from before M5-07a: the arms carry no parser.
  const file = join(t.env.resultsRoot, "campaigns", `${c.id}.json`);
  const rec = JSON.parse(await Deno.readTextFile(file));
  for (const a of rec.arms) delete a.parser;
  await Deno.remove(file);
  await Deno.writeTextFile(file, JSON.stringify(rec));
  const legacy = (await t.env.store.campaigns("contract"))[0]!;
  assertEquals(legacy.arms.map((a) => a.parser), [undefined, undefined]);
  await assertRejects(
    () => runCampaign(t.env, "contract", opts({ campaign: c.id }), io()),
    ConfigurationError,
    "arms[].parser",
  );
  const s = await runCampaign(t.env, "contract", opts(), io());
  assertEquals(s.created, true);
  assert(s.campaignId !== c.id);
  assertEquals((await t.env.store.campaigns("contract")).length, 2);
});

// ---- M11-10: a pre-registered experiment binds its campaign to both approved stages ----

const PR_REL = "preregistration/prereg.yml";
const PR_STAGE_A = {
  v: 1,
  experiment: "prereg",
  protocol: {
    arms: ["mock-positive", "mock-naive-a"],
    contrasts: [
      {
        id: "C1",
        name: "naive against positive",
        baseline: "mock-positive",
        variant: "mock-naive-a",
      },
      {
        id: "C2",
        name: "positive against naive",
        baseline: "mock-naive-a",
        variant: "mock-positive",
      },
    ],
    interaction: null,
  },
  approval: "OWNER-APPROVED: stage A (2026-10-21T12:00:00Z)",
  population: "The mock task set.",
  primary_metric: "cost_per_solved_task",
  confirmatory: true,
  family: ["C1", "C2"],
  alpha: 0.05,
  test: {
    sides: "two",
    p_value: "percentile_bootstrap_plus_one",
    adjustment: "holm",
    direction: "sign_of_delta",
  },
  intervals: {
    reported: "per_contrast_unadjusted",
    beside: "bonferroni_same_draws",
  },
  bootstrap: { unit: "task", resamples: 1000, seed: 1, level: 0.95 },
  zero_solve: { rule: "suppress_any_undefined" },
  missing_pairs: "per_contrast_matched",
  held_out: {
    count: 0,
    rule: "none held out",
    seal: "harness-v2-screen-start",
    tasks: [],
    in_family: false,
  },
  measures: {
    fingerprint: "f".repeat(64),
    unknown_symbol_codes: ["AL0118"],
    ruleset_sha256: "d".repeat(64),
    canary_codes: ["AA0137"],
    workflow_execution: "used_execution",
    effort_execution: "every_attempt",
  },
  exploratory_metrics: ["pass_rate"],
  simulation: { script_sha256: "1".repeat(64), args: { sims: 10 } },
  design_rule: "the frozen rule",
  stage_a: null,
  experiment_hash: null,
  selection: null,
  design: null,
  power_simulation: null,
  compiler_identity: null,
  stage_b_approval: null,
  amendments: [],
};

async function gitOut(root: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).trim();
}

/** Commit the working prereg file and tag it (stage A or stage B). */
async function tagPrereg(t: TestEnv, tag: string, line: string) {
  await git(t.repo.root, "add", "harness");
  await git(t.repo.root, "commit", "-q", "-m", tag);
  await git(t.repo.root, "tag", "-a", tag, "-m", line);
  return await gitOut(t.repo.root, "rev-parse", tag);
}

/**
 * The pre-registered experiment and its stage-A file, committed and tagged
 * harness-v2-prereg-a, with the stage-A decision file outside the repo.
 */
async function preregEnv() {
  const t = await mockEnv();
  await write(
    t.harnessRoot,
    "experiments/prereg.yml",
    `id: prereg
hypothesis: Mock contract.
primary_metric: cost_per_solved_task
baseline: mock-positive
variants: [mock-naive-a]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
contrasts:
${
      PR_STAGE_A.protocol.contrasts.map((c) => `  - ${JSON.stringify(c)}`)
        .join("\n")
    }
preregistration: ${PR_REL}
`,
  );
  await write(t.harnessRoot, PR_REL, stringify(PR_STAGE_A));
  const approved = await protocolSha(PreregSchema.parse(PR_STAGE_A));
  const tagObject = await tagPrereg(
    t,
    "harness-v2-prereg-a",
    `protocol_sha256: ${approved}`,
  );
  const decisions = await Deno.makeTempDir();
  const decisionA = join(decisions, "2026-10-24-harness-v2-prereg-a.md");
  await Deno.writeTextFile(
    decisionA,
    `protocol_sha256: ${approved}\nfile_sha256: ${
      "f".repeat(64)
    }\ntag: harness-v2-prereg-a\ntag_object: ${tagObject}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`,
  );
  // A parseable stage-B decision for runs before stage B exists.
  const decisionB = join(decisions, "2026-11-06-harness-v2-prereg-b.md");
  await Deno.writeTextFile(
    decisionB,
    `stage_b_sha256: ${"0".repeat(64)}\ntag: harness-v2-prereg-b\ntag_object: ${
      "0".repeat(40)
    }\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`,
  );
  return { t, approved, decisionA, decisionB };
}

/**
 * Write the stage-B file (with selection and simulation JSON in the repo),
 * commit it, tag harness-v2-prereg-b and write the stage-B decision file.
 */
async function freezeStageB(
  p: Awaited<ReturnType<typeof preregEnv>>,
  over: Record<string, unknown> = {},
) {
  const { t } = p;
  const { experiment } = await loadExperiment(t.harnessRoot, "prereg");
  const selPath = "harness-tasks/v2/selection.json";
  await write(
    t.repo.root,
    selPath,
    JSON.stringify({
      v: 1,
      status: "ok",
      held_out: [],
      selection: { n: 1, selected: ["HX-001"] },
    }),
  );
  const simPath = "harness/preregistration/prereg.sim-b.json";
  await write(
    t.repo.root,
    simPath,
    JSON.stringify({
      ...PR_STAGE_A.simulation,
      zero_solve: PR_STAGE_A.zero_solve,
      decision: { design: { tasks: 1, repeats: 1 } },
    }),
  );
  const selSha = await hashFile(t.repo.root, join(t.repo.root, selPath));
  const doc = {
    ...PR_STAGE_A,
    stage_a: { sha256: p.approved },
    experiment_hash: await experimentHash(experiment),
    selection: {
      path: selPath,
      sha256: selSha,
      selected: ["HX-001"],
      held_out: [],
    },
    design: { tasks: 1, repeats: 1 },
    power_simulation: {
      inputs: [{ path: selPath, sha256: selSha }],
      output: {
        path: simPath,
        sha256: await hashFile(t.repo.root, join(t.repo.root, simPath)),
      },
    },
    compiler_identity: "artifact|bccontainerhelper 6.1.14",
    stage_b_approval: "OWNER-APPROVED: stage B (2026-10-29T12:00:00Z)",
    ...over,
  };
  const text = stringify(doc);
  await write(t.harnessRoot, PR_REL, text);
  const bSha = await sha256Hex(new TextEncoder().encode(text));
  const tagObject = await tagPrereg(
    t,
    "harness-v2-prereg-b",
    `stage_b_sha256: ${bSha}`,
  );
  await Deno.writeTextFile(
    p.decisionB,
    `stage_b_sha256: ${bSha}\ntag: harness-v2-prereg-b\ntag_object: ${tagObject}\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`,
  );
  return doc;
}

const preregOpts = (p: { decisionA: string; decisionB: string }) =>
  opts({ preregDecision: p.decisionA, preregBDecision: p.decisionB });

Deno.test("M11-10: a pre-registered experiment needs both decision files and a frozen stage B before any cell", async () => {
  const p = await preregEnv();
  for (const o of [opts(), opts({ preregDecision: p.decisionA })]) {
    await assertRejects(
      () => runCampaign(p.t.env, "prereg", o, io()),
      ConfigurationError,
      "--prereg-b-decision",
    );
  }
  await assertRejects(
    () =>
      runCampaign(
        p.t.env,
        "prereg",
        opts({ preregBDecision: p.decisionB }),
        io(),
      ),
    ConfigurationError,
    "--prereg-decision",
  );
  await assertRejects(
    () => runCampaign(p.t.env, "prereg", preregOpts(p), io()),
    ConfigurationError,
    "stage B is not frozen",
  );
  assertEquals(await p.t.env.store.campaigns("prereg"), []);
  assertEquals(p.t.docker.runs.length, 0);
});

Deno.test("M11-10: a clean stage B binds the campaign; an edited file refuses the resume", async () => {
  const p = await preregEnv();
  await freezeStageB(p);
  const s = await runCampaign(p.t.env, "prereg", preregOpts(p), io());
  assertEquals(s.created, true);
  const c = (await p.t.env.store.campaigns("prereg"))[0]!;
  assertEquals(c.preregistration?.path, PR_REL);
  assertEquals(c.preregistration?.protocol_sha256, p.approved);
  assertEquals(
    c.preregistration?.sha256,
    await hashFile(p.t.harnessRoot, join(p.t.harnessRoot, PR_REL)),
  );
  assertEquals(
    c.preregistration?.decision_sha256,
    await sha256Hex(await Deno.readFile(p.decisionA)),
  );
  assertEquals(
    c.preregistration?.stage_b_decision_sha256,
    await sha256Hex(await Deno.readFile(p.decisionB)),
  );
  const runs = p.t.docker.runs.length;
  await Deno.writeTextFile(
    join(p.t.harnessRoot, PR_REL),
    `${await Deno.readTextFile(join(p.t.harnessRoot, PR_REL))}# edited\n`,
  );
  await assertRejects(
    () => runCampaign(p.t.env, "prereg", preregOpts(p), io()),
    ConfigurationError,
    "preregistration changed",
  );
  assertEquals(p.t.docker.runs.length, runs);
});

Deno.test("M11-10: a stage B whose stage A and stage_a.sha256 were both edited is refused", async () => {
  const p = await preregEnv();
  const edited = PreregSchema.parse({ ...PR_STAGE_A, alpha: 0.1 });
  await freezeStageB(p, {
    alpha: 0.1,
    stage_a: { sha256: await protocolSha(edited) },
  });
  await assertRejects(
    () => runCampaign(p.t.env, "prereg", preregOpts(p), io()),
    ConfigurationError,
    "differs from the approved stage A",
  );
  assertEquals(await p.t.env.store.campaigns("prereg"), []);
  assertEquals(p.t.docker.runs.length, 0);
});

Deno.test("M11-10: a forged family amendment after the stage-B tag is refused (round 3 finding 1)", async () => {
  const p = await preregEnv();
  const doc = await freezeStageB(p);
  await write(
    p.t.harnessRoot,
    PR_REL,
    stringify({
      ...doc,
      family: ["C1"],
      amendments: [{
        key: "family",
        from: ["C1", "C2"],
        to: ["C1"],
        reason: "C2 unpowered",
        approval: "OWNER-APPROVED: drop C2 (2026-10-29T12:00:00Z)",
      }],
    }),
  );
  const err = await assertRejects(
    () => runCampaign(p.t.env, "prereg", preregOpts(p), io()),
    ConfigurationError,
  );
  assertStringIncludes(err.message, "not externally approved");
  assertStringIncludes(
    err.message,
    "differs from the externally approved stage-B bytes",
  );
  assertEquals(await p.t.env.store.campaigns("prereg"), []);
  assertEquals(p.t.docker.runs.length, 0);
});

Deno.test("M11-10: resume with an edited or swapped decision file is refused", async () => {
  const p = await preregEnv();
  await freezeStageB(p);
  await runCampaign(p.t.env, "prereg", preregOpts(p), io());
  const runs = p.t.docker.runs.length;
  for (const path of [p.decisionA, p.decisionB]) {
    const original = await Deno.readTextFile(path);
    // Still a parseable decision with the same anchor lines: only its bytes differ.
    await Deno.writeTextFile(path, `# swapped\n${original}`);
    await assertRejects(
      () => runCampaign(p.t.env, "prereg", preregOpts(p), io()),
      ConfigurationError,
      "preregistration changed",
    );
    await Deno.writeTextFile(path, original);
  }
  assertEquals(p.t.docker.runs.length, runs);
  assertEquals((await p.t.env.store.campaigns("prereg")).length, 1);
});

// M7-01: the placed-concurrency gate (decisions/2026-10-03-m7-concurrency.md).
const gated = async (over: Record<string, unknown> = {}) => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  enforce(t);
  Object.assign(t.env, { proxyIsolation: PROXY_ISOLATION, ...over });
  return t;
};
// Both arms of the experiment get the harness lines (only settings may vary).
const armConfig = async (t: TestEnv, harnessLines: string) => {
  for (
    const [id, variant] of [["mock-positive", "positive"], [
      "mock-naive-a",
      "naive:a",
    ]]
  ) {
    await write(
      t.harnessRoot,
      `configs/${id}.yml`,
      `id: ${id}
${harnessLines}
${
        harnessLines.includes("mock")
          ? "models: {}"
          : "models: { main: anthropic/claude-sonnet-5 }"
      }
settings: { mode: apply, variant: "${variant}" }
limits: { timeout_min: 5, max_budget_usd: 1 }
`,
    );
  }
};
const refusedGate = async (t: TestEnv, over: Partial<RunOptions> = {}) =>
  (await assertRejects(
    () =>
      runCampaign(
        t.env,
        "contract",
        opts({ concurrency: 2, ...over }),
        io(),
      ),
    ConfigurationError,
    "--concurrency",
  )).message;

Deno.test("M7-01: concurrency 2 with every condition met is allowed (plan and run)", async () => {
  const t = await gated();
  const s = await runCampaign(
    t.env,
    "contract",
    opts({ concurrency: 2, dryRun: true }),
    io(),
  );
  assertEquals(s.planned, 2);
  const ran = await runCampaign(
    t.env,
    "contract",
    opts({ concurrency: 2 }),
    io(),
  );
  assertEquals(ran.ran, s.planned);
});

Deno.test("M7-01: concurrency 3 is refused even when every other condition holds", async () => {
  const t = await gated();
  assertStringIncludes(
    await refusedGate(t, { concurrency: 3 }),
    "exceeds the placed maximum 2",
  );
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("M7-01: missing or wrong proxy_isolation is refused at concurrency 2", async () => {
  const t = await gated({ proxyIsolation: undefined });
  assertStringIncludes(await refusedGate(t), "proxy_isolation missing");
  for (const v of [1, 3, "2"]) {
    t.env.proxyIsolation = v;
    assertStringIncludes(
      await refusedGate(t),
      `proxy_isolation ${JSON.stringify(v)}`,
    );
  }
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("M7-01: placed but not enforced is refused at concurrency 2", async () => {
  const t = await gated({ egressEnforced: false });
  assertStringIncludes(await refusedGate(t), "not enforced");
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("M7-01: an arm on a frozen tag or below the H-01 revision is refused, naming the arm, before any write", async () => {
  const t = await gated();
  const before = await t.env.store.allExecutions();
  for (
    const [lines, want] of [
      ['harness: mock\nharness_version: "1"', "revision 1 is below"],
      [
        'harness: mock\nharness_version: "2"\nimage_revision: "1"',
        "revision 1 is below",
      ],
      [
        'harness: claude-code\nharness_version: "2.1.282"',
        "frozen image without image_revision",
      ],
      [
        'harness: pi\nharness_version: "0.87.1"\nimage_revision: "1"',
        "revision 1 is below the H-01 ContainerUser revision 2",
      ],
    ] as const
  ) {
    await armConfig(t, lines);
    const m = await refusedGate(t);
    assertStringIncludes(m, "arm mock-");
    assertStringIncludes(m, want);
  }
  assertEquals(await t.env.store.allExecutions(), before);
  assertEquals(t.docker.runs.length, 0);
  // A passing config still runs at concurrency 1 (the frozen-arm case at
  // concurrency 1 is the "review" test at the end of this file).
  await armConfig(t, 'harness: mock\nharness_version: "2"');
  const ok = await runCampaign(t.env, "contract", opts(), io());
  assertEquals(ok.ran, 2);
});

Deno.test("M7-01: resume applies the same gate before any record", async () => {
  const t = await gated();
  await runCampaign(t.env, "contract", opts(), io());
  const c = (await t.env.store.campaigns("contract"))[0]!;
  const before = await t.env.store.allExecutions();
  t.env.proxyIsolation = 1;
  assertStringIncludes(
    await refusedGate(t, { campaign: c.id }),
    "proxy_isolation 1",
  );
  t.env.proxyIsolation = PROXY_ISOLATION;
  await armConfig(t, 'harness: mock\nharness_version: "1"');
  assertStringIncludes(
    await refusedGate(t, { campaign: c.id }),
    "arm mock-",
  );
  assertEquals(await t.env.store.allExecutions(), before);
});

Deno.test("M7-01 review: mock's revision is its harness_version, so image_revision cannot lift a frozen mock; an unknown harness is refused whatever its revision", async () => {
  const t = await gated();
  await armConfig(
    t,
    'harness: mock\nharness_version: "1"\nimage_revision: "2"',
  );
  const m = await refusedGate(t);
  assertStringIncludes(m, "arm mock-");
  assertStringIncludes(m, "revision 1 is below");
  await armConfig(
    t,
    'harness: other\nharness_version: "9"\nimage_revision: "5"',
  );
  assertStringIncludes(await refusedGate(t), "no H-01 ContainerUser revision");
  assertEquals(t.docker.runs.length, 0);
});

Deno.test("M7-01 review: concurrency 1 never looks at the arm revision (a frozen claude-code arm still plans)", async () => {
  const t = await gated();
  const frozen = 'harness: claude-code\nharness_version: "2.1.282"';
  await armConfig(t, frozen);
  const plan = await runCampaign(
    t.env,
    "contract",
    opts({ dryRun: true }),
    io(),
  );
  assertEquals(plan.planned, 2);
  // The same arms are refused the moment concurrency is 2.
  assertStringIncludes(
    await refusedGate(t, { dryRun: true }),
    "frozen image without image_revision",
  );
});
