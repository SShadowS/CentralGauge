import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
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
import { imageTag, mcpLabel } from "../../../src/harness/images.ts";
import { validateCampaignRecords } from "../../../src/harness/integrity.ts";
import { privatePaths, runCell } from "../../../src/harness/execution.ts";
import { EXECUTION_LABEL } from "../../../src/harness/sandbox.ts";
import { write } from "./refapp-fixture.ts";
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
  t.docker.addImage(imageTag("mock", "1"), MOCK_IMAGE_ID, {
    "centralgauge.harness": "mock",
    "centralgauge.harness.version": "1",
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
      l.includes(imageTag("mock", "1")) && l.includes("not verified")
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
harness_version: "1"
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
    await run.stdout('{"type":"mock_init","version":"1","mode":"apply"}');
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
