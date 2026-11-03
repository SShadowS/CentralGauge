// H-53: rolling subscription accounts (a campaign's account pool). Labels
// only: no token file is ever read here or written to a record.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import {
  loadCampaignData,
  runCampaign,
  type RunOptions,
} from "../../../src/harness/campaign.ts";
import { privatePaths } from "../../../src/harness/execution.ts";
import {
  type AccountAddition,
  AccountAdditionSchema,
  accountPool,
  type CampaignRecord,
  type ExecutionRecord,
  RecordStore,
} from "../../../src/harness/records.ts";
import { buildReport, renderReport } from "../../../src/harness/report.ts";
import { EXECUTION_LABEL } from "../../../src/harness/sandbox.ts";
import { testTempDir } from "../../utils/temp-dir.ts";
import { write } from "./refapp-fixture.ts";
import {
  CATALOG,
  makeEnv,
  mockImageBehavior,
  type TestEnv,
} from "./runtime-fixture.ts";

const CID = "00000000-0000-4000-8000-0000000000c1";
const campaign = (accounts?: string[]) =>
  ({ id: CID, ...(accounts ? { accounts } : {}) }) as unknown as CampaignRecord;
const addition = (
  seq: string,
  added: string[],
  over: Partial<AccountAddition> = {},
): AccountAddition => ({
  v: 1,
  campaign_id: CID,
  seq,
  added,
  by: "owner",
  at: "2026-11-03T08:00:00.000Z",
  reason: "spread load over equivalent accounts",
  ...over,
});

Deno.test("account pool (H-53): the pool is the campaign's labels then each addition, in order", () => {
  assertEquals(accountPool(campaign(["maxpriv2"]), []), ["maxpriv2"]);
  assertEquals(
    accountPool(campaign(["maxpriv2"]), [
      addition("001", ["work", "maxpriv"]),
      addition("002", ["max"]),
    ]),
    ["maxpriv2", "work", "maxpriv", "max"],
  );
  assertEquals(accountPool(campaign(), []), null);
});

Deno.test("account pool (H-53): a gap, a repeated label, another campaign's addition or an unlabelled campaign is refused", () => {
  const c = campaign(["maxpriv2"]);
  const cases: [string, CampaignRecord, AccountAddition[], string][] = [
    ["gap", c, [addition("002", ["work"])], "001"],
    [
      "gap after 001",
      c,
      [addition("001", ["work"]), addition("003", ["max"])],
      "002",
    ],
    ["label in campaign", c, [addition("001", ["maxpriv2"])], "maxpriv2"],
    [
      "label in an earlier addition",
      c,
      [addition("001", ["work"]), addition("002", ["work"])],
      "work",
    ],
    [
      "another campaign",
      c,
      [addition("001", ["work"], {
        campaign_id: "00000000-0000-4000-8000-0000000000c2",
      })],
      "campaign",
    ],
    [
      "unlabelled campaign",
      campaign(),
      [addition("001", ["work"])],
      "unlabelled",
    ],
  ];
  for (const [label, camp, adds, why] of cases) {
    const err = assertThrows(() => accountPool(camp, adds), ValidationError);
    if (!err.message.includes(why)) {
      throw new Error(`${label}: ${err.message} lacks "${why}"`);
    }
  }
});

Deno.test("account pool (H-53): an addition needs a non-empty by and reason, slug labels, no duplicates", () => {
  AccountAdditionSchema.parse(addition("001", ["work"]));
  for (
    const bad of [
      addition("001", ["work"], { by: " " }),
      addition("001", ["work"], { reason: "" }),
      addition("001", ["Work"]),
      addition("001", []),
      addition("001", ["work", "work"]),
      addition("1", ["work"]),
    ]
  ) {
    assertThrows(() => AccountAdditionSchema.parse(bad));
  }
});

Deno.test("account pool (H-53): additions are write-once records, read back in seq order", async () => {
  const root = await testTempDir();
  const store = new RecordStore(root);
  assertEquals(await store.accountAdditions(CID), []);
  await store.writeAccountAddition(addition("002", ["max"]));
  await store.writeAccountAddition(addition("001", ["work"]));
  assertEquals(
    (await store.accountAdditions(CID)).map((a) => a.seq),
    ["001", "002"],
  );
  await assertRejects(
    () => store.writeAccountAddition(addition("001", ["maxpriv"])),
    ValidationError,
    "immutable",
  );
  // The file name is the seq; a record filed under another name is refused.
  await Deno.writeTextFile(
    join(root, "account-pools", CID, "003.json"),
    JSON.stringify(addition("004", ["maxpriv"])),
  );
  await assertRejects(() => store.accountAdditions(CID), ValidationError);
});

// ---- campaign runs on the mock image ----
async function poolEnv(
  labels: string[],
  repeats = 2,
  variant = "mock-naive-a",
) {
  const t = await makeEnv();
  t.env.supervised = false;
  let clock = Date.now();
  t.env.now = () => new Date(clock);
  const limited = new Set<string>();
  /** Seconds to each label's reset (default 3600); null: the limit names no reset. */
  const resetIn = new Map<string, number | null>();
  const real = mockImageBehavior();
  // The fake limit signal: the label the attempt's intent names (never a token).
  t.docker.behavior = async (call, run) => {
    const id = call.labels.get(EXECUTION_LABEL)!;
    const intent = JSON.parse(
      await Deno.readTextFile(privatePaths(t.env, id).intent),
    ) as { account?: string };
    if (intent.account && limited.has(intent.account)) {
      await run.stdout(
        JSON.stringify({
          type: "mock_init",
          version: "2",
          mode: "usage-limit",
        }),
      );
      const s = resetIn.has(intent.account)
        ? resetIn.get(intent.account)!
        : 3600;
      await run.stdout(JSON.stringify({
        type: "mock_usage_limit",
        ...(s === null ? {} : { resets_at: Math.floor(clock / 1000) + s }),
      }));
      return 2;
    }
    return await real(call, run);
  };
  await write(
    t.harnessRoot,
    "experiments/pool.yml",
    `id: pool
hypothesis: Mock contract.
primary_metric: pass_rate
baseline: mock-positive
variants: [${variant}]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: ${repeats}
`,
  );
  const dir = t.env.secretAccounts[0]!.dir;
  const as = (...ls: string[]) => {
    t.env.secretAccounts = ls.map((label) => ({ label, dir }));
  };
  as(...labels);
  return {
    t,
    limited,
    resetIn,
    as,
    tick: (ms: number) => void (clock += ms),
    now: () => clock,
  };
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
/** In run order: the campaign's block order, then the arm's place, then attempt (the test clock is frozen). */
const executions = async (t: TestEnv) => {
  const [c] = await t.env.store.campaigns("pool");
  const pos = (e: ExecutionRecord) =>
    c!.blocks.findIndex((b) => b.index === e.block);
  return (await t.env.store.executions(c!.id)).sort((a, b) =>
    pos(a) - pos(b) || a.order_in_block - b.order_in_block ||
    a.attempt - b.attempt
  );
};
const ADD = { reason: "spread load", by: "owner" };

Deno.test("pool (H-53): each block stays on one label, blocks round-robin; every execution records its label and why", async () => {
  const { t } = await poolEnv(["work", "maxpriv2"]);
  const s = await runCampaign(t.env, "pool", opts(), io());
  assertEquals(s.paused, null);
  const es = await executions(t);
  assertEquals(es.length, 4);
  const byBlock = new Map<number, ExecutionRecord[]>();
  for (const e of es) {
    byBlock.set(e.block, [...(byBlock.get(e.block) ?? []), e]);
  }
  const labels = [...byBlock.values()].map((b) => {
    assertEquals(new Set(b.map((e) => e.account)).size, 1);
    assertEquals(b.map((e) => e.account_choice), [
      "round_robin",
      "block_pair",
    ]);
    return b[0]!.account;
  });
  assertEquals(labels.sort(), ["maxpriv2", "work"]);
});

Deno.test("pool (H-53): a single-label campaign records no account_choice (unchanged)", async () => {
  const { t } = await poolEnv(["maxpriv2"]);
  await runCampaign(t.env, "pool", opts(), io());
  for (const e of await executions(t)) {
    assertEquals(e.account, "maxpriv2");
    assert(!("account_choice" in e), JSON.stringify(e));
  }
});

Deno.test("pool (H-53): a limited label is parked; the cell reruns at once on another label, the run never pauses while one has headroom", async () => {
  const { t, limited } = await poolEnv(["work", "maxpriv2"]);
  limited.add("work");
  const out = io();
  const s = await runCampaign(t.env, "pool", opts(), out);
  assertEquals(s.paused, null);
  const es = await executions(t);
  // One limited execution (the first, on work); its retry and every later
  // cell run on maxpriv2.
  assertEquals(es.filter((e) => e.termination === "usage_limited").length, 1);
  assertEquals([es[0]!.account, es[0]!.termination], ["work", "usage_limited"]);
  assertEquals([es[1]!.account, es[1]!.account_choice, es[1]!.retry_of], [
    "maxpriv2",
    "retry_after_limit",
    es[0]!.id,
  ]);
  for (const e of es.slice(1)) assertEquals(e.account, "maxpriv2");
  assertEquals(es.length, 5);
  assert(
    out.lines.some((l) => l.includes("work") && l.includes("parked")),
    out.lines.join("\n"),
  );
  // Reports show executions per label.
  const [c] = await t.env.store.campaigns("pool");
  const text = renderReport(
    await buildReport(await loadCampaignData(t.env.store, c!)),
  );
  assertStringIncludes(text, "work: 1 execution(s), 1 usage_limited");
  assertStringIncludes(text, "maxpriv2: 4 execution(s), 0 usage_limited");
});

Deno.test("pool (H-53): only when every label is limited does the run pause, until the earliest reset, naming each parked label; a restart honours recorded parks", async () => {
  const { t, limited, tick } = await poolEnv(["work", "maxpriv2"]);
  limited.add("work");
  limited.add("maxpriv2");
  const out = io();
  const s = await runCampaign(t.env, "pool", opts(), out);
  assert(s.paused !== null && s.paused !== "unknown", String(s.paused));
  const es = await executions(t);
  assertEquals(es.map((e) => e.account), ["work", "maxpriv2"]);
  const pause = out.lines.find((l) => l.includes("[PAUSE]"))!;
  assertStringIncludes(pause, "work until");
  assertStringIncludes(pause, "maxpriv2 until");
  // A restart before the resets: both labels stay parked from the records.
  limited.clear();
  const again = await runCampaign(t.env, "pool", opts(), io());
  assertEquals([again.ran, again.paused !== null], [0, true]);
  // After the resets the owed retry runs.
  tick(2 * 3600_000);
  const after = await runCampaign(t.env, "pool", opts(), io());
  assertEquals(after.paused, null);
  const all = await executions(t);
  assertEquals(all[2]!.retry_of, all[1]!.id);
  assertEquals(all.filter((e) => e.termination === "usage_limited").length, 2);
});

Deno.test("pool (H-53): a resume adds labels only with a reason and who, appended after the pool; a drop, rename or reorder stays refused", async () => {
  const { t, as } = await poolEnv(["maxpriv2"], 1);
  await runCampaign(t.env, "pool", opts(), io());
  const [c] = await t.env.store.campaigns("pool");
  as("maxpriv2", "work");
  await assertRejects(
    () => runCampaign(t.env, "pool", opts(), io()),
    ConfigurationError,
    "--add-accounts-reason",
  );
  // A dry run checks it and writes nothing.
  await runCampaign(
    t.env,
    "pool",
    opts({ dryRun: true, addAccounts: ADD }),
    io(),
  );
  assertEquals(await t.env.store.accountAdditions(c!.id), []);
  await runCampaign(t.env, "pool", opts({ addAccounts: ADD }), io());
  const [a] = await t.env.store.accountAdditions(c!.id);
  assertEquals(
    [a!.seq, a!.added, a!.by, a!.reason],
    ["001", ["work"], "owner", "spread load"],
  );
  // The pool now matches without flags; flags with nothing new are refused.
  await runCampaign(t.env, "pool", opts(), io());
  await assertRejects(
    () => runCampaign(t.env, "pool", opts({ addAccounts: ADD }), io()),
    ConfigurationError,
    "no new --secrets-dir label",
  );
  for (
    const bad of [
      ["maxpriv2"],
      ["work", "maxpriv2"],
      ["maxpriv2", "max"],
      ["max", "maxpriv2", "work"],
    ]
  ) {
    as(...bad);
    await assertRejects(
      () => runCampaign(t.env, "pool", opts({ addAccounts: ADD }), io()),
      ConfigurationError,
      "accounts",
      bad.join(","),
    );
  }
  as("maxpriv2", "work", "max", "maxpriv");
  await runCampaign(
    t.env,
    "pool",
    opts({ addAccounts: { reason: "two more", by: "owner" } }),
    io(),
  );
  assertEquals(
    (await t.env.store.accountAdditions(c!.id)).map((x) => x.added),
    [["work"], ["max", "maxpriv"]],
  );
});

Deno.test("pool (H-53): an addition needs a reason and who, never starts a campaign; --ignore-usage-reset is refused on a pool", async () => {
  const { t, as } = await poolEnv(["maxpriv2"], 1);
  await assertRejects(
    () => runCampaign(t.env, "pool", opts({ addAccounts: ADD }), io()),
    ConfigurationError,
    "existing campaign",
  );
  await runCampaign(t.env, "pool", opts(), io());
  as("maxpriv2", "work");
  for (const add of [{ reason: "x", by: " " }, { reason: " ", by: "owner" }]) {
    await assertRejects(
      () => runCampaign(t.env, "pool", opts({ addAccounts: add }), io()),
      ConfigurationError,
    );
  }
  await runCampaign(t.env, "pool", opts({ addAccounts: ADD }), io());
  await assertRejects(
    () => runCampaign(t.env, "pool", opts({ ignoreUsageReset: "fresh" }), io()),
    ConfigurationError,
    "pool",
  );
});

// ---- Sol r1 (H-53): concurrency, --rerun, failed resume, reset kinds, ties ----

Deno.test("pool (H-53, Sol r1): concurrency 2: once a label is parked no cell starts on it; every cell runs once", async () => {
  const { t, limited } = await poolEnv(["work", "maxpriv2"], 3);
  limited.add("work");
  const s = await runCampaign(t.env, "pool", opts({ concurrency: 2 }), io());
  assertEquals(s.paused, null);
  const es = await executions(t);
  const lim = es.filter((e) => e.termination === "usage_limited");
  assertEquals(lim.length, 1);
  assertEquals(lim[0]!.account, "work");
  // Every other execution ran on maxpriv2, and each cell has one completed execution.
  for (const e of es.filter((e) => e.id !== lim[0]!.id)) {
    assertEquals([e.account, e.termination], ["maxpriv2", "completed"]);
  }
  const [c] = await t.env.store.campaigns("pool");
  assertEquals(es.length, c!.blocks.length * 2 + 1);
});

Deno.test("pool (H-53, Sol r1): a pooled --rerun takes a pool label; its limit parks the label without pausing, and the owed retry runs on a free label", async () => {
  // mock-crash exhausts its retries: an unscored cell, which --rerun accepts.
  const { t, limited } = await poolEnv(
    ["work", "maxpriv2"],
    1,
    "mock-crash",
  );
  await runCampaign(t.env, "pool", opts(), io());
  const es = await executions(t);
  assertEquals(new Set(es.map((e) => e.account)), new Set(["work"]));
  limited.add("work");
  const out = io();
  const s = await runCampaign(
    t.env,
    "pool",
    opts({ rerun: { task: es[0]!.task_id, repeat: 1, arm: "mock-crash" } }),
    out,
  );
  assertEquals(s.paused, null);
  const re = (await executions(t)).find((e) => e.run_kind === "manual_rerun")!;
  assertEquals([re.account, re.account_choice, re.termination], [
    "work",
    "block_pair",
    "usage_limited",
  ]);
  assert(
    out.lines.some((l) => l.includes("[POOL] account work parked")),
    out.lines.join("\n"),
  );
  // A plain resume runs its owed retry on maxpriv2.
  await runCampaign(t.env, "pool", opts(), io());
  const retry = (await executions(t)).find((e) => e.retry_of === re.id)!;
  assertEquals([retry.account, retry.account_choice], [
    "maxpriv2",
    "retry_after_limit",
  ]);
});

Deno.test("pool (H-53, Sol r1): a resume refused after the pool check (env pin) writes no addition", async () => {
  const { t, as } = await poolEnv(["maxpriv2"], 1);
  await runCampaign(t.env, "pool", opts(), io());
  const [c] = await t.env.store.campaigns("pool");
  as("maxpriv2", "work");
  t.env.bindCampaign = () => Promise.reject(new Error("env pin mismatch"));
  await assertRejects(
    () => runCampaign(t.env, "pool", opts({ addAccounts: ADD }), io()),
    Error,
    "env pin mismatch",
  );
  assertEquals(await t.env.store.accountAdditions(c!.id), []);
});

Deno.test("pool (H-53, Sol r1): a limit with no reset parks its label for the rest of the run", async () => {
  const { t, limited, resetIn } = await poolEnv(["work", "maxpriv2"], 3);
  limited.add("work");
  resetIn.set("work", null);
  const out = io();
  const s = await runCampaign(t.env, "pool", opts(), out);
  assertEquals(s.paused, null);
  const es = await executions(t);
  assertEquals(es.filter((e) => e.account === "work").length, 1);
  assert(
    out.lines.some((l) => l.includes("account work parked until unknown")),
    out.lines.join("\n"),
  );
});

Deno.test("pool (H-53, Sol r1): with every label parked the run waits for the earliest reset, not the latest", async () => {
  const { t, limited, resetIn, now } = await poolEnv(["work", "maxpriv2"], 1);
  limited.add("work");
  limited.add("maxpriv2");
  resetIn.set("work", 7200);
  resetIn.set("maxpriv2", 3600);
  const waits: number[] = [];
  const out = {
    ...io(),
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.reject(new Error("stop waiting"));
    },
  };
  await assertRejects(
    () => runCampaign(t.env, "pool", opts({ maxPauseMs: 3 * 3600_000 }), out),
    Error,
    "stop waiting",
  );
  assertEquals(waits.length, 1);
  // maxpriv2 resets first: about an hour, never two.
  assert(waits[0]! <= 3600_000 && waits[0]! > 3599_000, String(waits[0]));
  assert(now() > 0);
});

Deno.test("pool (H-53, Sol r1): three labels, equal start times: the next arm follows the retry's label, not the parked parent's", async () => {
  const { t, limited } = await poolEnv(["work", "maxpriv2", "max"], 1);
  limited.add("work");
  await runCampaign(t.env, "pool", opts(), io());
  const es = await executions(t);
  assertEquals(es.map((e) => [e.account, e.account_choice]), [
    ["work", "round_robin"],
    ["maxpriv2", "retry_after_limit"],
    ["maxpriv2", "block_pair"],
  ]);
});
