import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { ValidationError } from "../../../src/errors.ts";
import {
  CampaignRecordSchema,
  ExecutionRecordSchema,
  JudgmentRecordSchema,
  outcomePolicy,
  planBlocks,
  RecordStore,
  retryChains,
  retryProblem,
} from "../../../src/harness/records.ts";
import { TaskSetIdentitySchema } from "../../../src/harness/identity.ts";
import { ResolvedManifestSchema } from "../../../src/harness/manifest.ts";
import {
  campaign,
  CAMPAIGN_ID,
  execution,
  judgment,
  telemetry,
} from "./fixtures.ts";

Deno.test("planBlocks: repeat-major, every block a permutation, seeded", () => {
  const arms = ["a", "b", "c"];
  const blocks = planBlocks(["HX-002", "HX-001"], 2, arms, 5);
  assertEquals(
    blocks.map((b) => `${b.repeat}:${b.task_id}`),
    ["1:HX-001", "1:HX-002", "2:HX-001", "2:HX-002"],
  );
  for (const b of blocks) assertEquals([...b.order].sort(), arms);
  assertEquals(planBlocks(["HX-001", "HX-002"], 2, arms, 5), blocks);
  const orders = new Set(
    planBlocks(["t1", "t2", "t3", "t4", "t5", "t6"], 3, arms, 5).map((b) =>
      b.order.join()
    ),
  );
  assert(orders.size > 1, "order must actually vary between blocks");
});

Deno.test("schemas: fixtures are valid", async () => {
  const c = await campaign({ repeats: 2 });
  CampaignRecordSchema.parse(c);
  const e = execution(c);
  ExecutionRecordSchema.parse(e);
  JudgmentRecordSchema.parse(judgment(c, e, true));
});

Deno.test("execution schema: loud on bad records", async () => {
  const c = await campaign();
  const e = execution(c);
  const bad: Array<[string, unknown]> = [
    ["unknown key", { ...e, extra: 1 }],
    ["unknown termination", { ...e, termination: "crashed" }],
    ["reported cost as primary", {
      ...e,
      telemetry: { ...telemetry(1), cost_source: "reported" },
    }],
    ["cost without pricing snapshot", {
      ...e,
      telemetry: { ...telemetry(1), pricing_snapshot: null },
    }],
    ["duplicate validity field", {
      ...e,
      validity: {
        incomplete_telemetry: ["turns", "turns"],
        infra_exposed: false,
      },
    }],
    ["planned attempt 2", { ...e, attempt: 2 }],
    ["auto_retry without parent", { ...e, attempt: 2, run_kind: "auto_retry" }],
  ];
  for (const [name, value] of bad) {
    assertThrows(
      () => ExecutionRecordSchema.parse(value),
      Error,
      undefined,
      name,
    );
  }
});

Deno.test("judgment schema: verdict must agree, failures must be classified", async () => {
  const c = await campaign();
  const j = judgment(c, execution(c), false);
  assertThrows(() => JudgmentRecordSchema.parse({ ...j, verdict: "pass" }));
  const test = (t: Record<string, unknown>) =>
    JudgmentRecordSchema.parse({
      ...j,
      scorers: [{ name: "mutant_kill", passed: false, tests: [t] }],
    });
  test({
    codeunit: 80001,
    procedure: "P",
    target: "mutant:0",
    outcome: "fail",
    failure: "assertion",
  });
  assertThrows(() =>
    test({
      codeunit: 80001,
      procedure: "P",
      target: "mutant:0",
      outcome: "fail",
      failure: null,
    })
  );
  assertThrows(() =>
    test({
      codeunit: 80001,
      procedure: "P",
      target: "other",
      outcome: "pass",
      failure: null,
    })
  );
});

Deno.test("campaign schema: coverage, uniqueness and arm set are enforced", async () => {
  const c = await campaign({ repeats: 2 });
  const cases: Array<[string, unknown, string]> = [
    [
      "provisional",
      { ...c, task_set: { ...c.task_set, provisional: true } },
      "provisional",
    ],
    ["duplicate block", {
      ...c,
      blocks: [...c.blocks.slice(0, -1), {
        ...c.blocks[0]!,
        index: c.blocks.length - 1,
      }],
    }, "duplicate block"],
    ["missing block", { ...c, blocks: c.blocks.slice(0, -1) }, "exactly once"],
    ["arm not in experiment", {
      ...c,
      arms: [c.arms[0]!, { ...c.arms[1]!, config_id: "other" }],
    }, "baseline and variants"],
    ["repeated arm in order", {
      ...c,
      blocks: c.blocks.map((b) => ({ ...b, order: ["plain", "plain"] })),
    }, "permutation"],
  ];
  for (const [name, value, needle] of cases) {
    const r = CampaignRecordSchema.safeParse(value);
    assert(!r.success, name);
    assert(r.error.issues.some((i) => i.message.includes(needle)), name);
  }
});

Deno.test("RecordStore: round trip, write-once, newest campaign first", async () => {
  const store = new RecordStore(await Deno.makeTempDir());
  const c = await campaign();
  await store.writeCampaign(c);
  await store.writeCampaign(
    await campaign({
      id: "00000000-0000-4000-8000-000000000002",
      created_at: "2026-10-02T00:00:00.000Z",
    }),
  );
  assertEquals(
    (await store.campaigns("skills-vs-plain")).map((x) => x.id),
    ["00000000-0000-4000-8000-000000000002", CAMPAIGN_ID],
  );
  const e = execution(c);
  await store.writeExecution(e);
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
  await assertRejects(
    () => store.writeExecution(e),
    ValidationError,
    "immutable",
  );
  assertEquals(
    await store.executions("00000000-0000-4000-8000-00000000dead"),
    [],
  );
});

Deno.test("RecordStore: two executions with identical workspaces keep separate artifacts and judgments", async () => {
  const store = new RecordStore(await Deno.makeTempDir());
  const c = await campaign();
  const same = "f".repeat(64);
  const e1 = execution(c, { arm: "plain" }, { workspace_hash: same });
  const e2 = execution(c, { arm: "skills" }, { workspace_hash: same });
  for (const e of [e1, e2]) {
    await store.writeArtifact({
      v: 1,
      execution_id: e.id,
      workspace_hash: same,
      stored_path: `workspaces/${same}`,
      created_at: "2026-10-01T10:12:00.000Z",
    });
  }
  await store.writeJudgment(judgment(c, e1, true));
  await store.writeJudgment(judgment(c, e2, false));
  assertEquals((await store.artifact(e2.id))!.execution_id, e2.id);
  assertEquals((await store.judgments(e1.id)).map((j) => j.verdict), ["pass"]);
  assertEquals((await store.judgments(e2.id)).map((j) => j.verdict), ["fail"]);
  assertEquals(
    await store.artifact("00000000-0000-4000-9000-00000000dead"),
    null,
  );
});

Deno.test("RecordStore: hand-edited or truncated records fail with the file name", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  await store.writeExecution(e);
  const path = join(root, "executions", CAMPAIGN_ID, `${e.id}.json`);
  const text = await Deno.readTextFile(path);
  await Deno.writeTextFile(path, text.replace('"completed"', '"done"'));
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    "termination",
  );
  await Deno.writeTextFile(path, text.slice(0, 40));
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    `${e.id}.json`,
  );
});

Deno.test("RecordStore: an interrupted publish leaves only a temp file, which reads ignore and sweep removes", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  const dir = join(root, "executions", CAMPAIGN_ID);
  await Deno.mkdir(dir, { recursive: true });
  // What a crash between the temp write and the link leaves behind.
  await Deno.writeTextFile(join(dir, `${e.id}.json.tmp-crash`), '{"v":1,');
  assertEquals(await store.executions(CAMPAIGN_ID), []);
  await store.writeExecution(e);
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
  assertEquals(await store.sweepTemp(), 1);
});

Deno.test("outcomePolicy: spec 1a section 8 table", () => {
  const judged = { judge: true, retry: "none" };
  assertEquals(outcomePolicy("completed", true), judged);
  assertEquals(outcomePolicy("timeout", true), judged);
  assertEquals(outcomePolicy("budget_exhausted", false), judged);
  assertEquals(outcomePolicy("refusal", false), judged);
  assertEquals(outcomePolicy("harness_crash", true), judged);
  assertEquals(outcomePolicy("harness_crash", false), {
    judge: false,
    retry: "once",
  });
  assertEquals(outcomePolicy("setup_failed", false), {
    judge: false,
    retry: "once",
  });
  assertEquals(outcomePolicy("usage_limited", true), {
    judge: false,
    retry: "after_usage_reset",
  });
});

Deno.test("retryChains: grouped by retry_of ancestry, not by label", async () => {
  const c = await campaign();
  const planned = execution(c);
  const manual = execution(c, { attempt: 2, run_kind: "manual_rerun" }, {
    termination: "setup_failed",
    did_work: false,
  });
  const retryOfManual = execution(c, {
    attempt: 3,
    run_kind: "auto_retry",
    retry_of: manual.id,
  });
  const { chains, orphans } = retryChains([retryOfManual, planned, manual]);
  assertEquals(orphans, []);
  assertEquals(
    chains.map((ch) => ch.members.map((m) => m.attempt)),
    [[1], [2, 3]],
  );
  const lost = execution(c, {
    attempt: 4,
    run_kind: "auto_retry",
    retry_of: "00000000-0000-4000-9000-00000000dead",
  });
  assertEquals(retryChains([planned, lost]).orphans, [lost]);
});

Deno.test("retryProblem: no retry after a judged ending, only one retry per failure kind", async () => {
  const c = await campaign();
  const done = execution(c);
  const setup = { termination: "setup_failed" as const, did_work: false };
  const failed = execution(c, {}, setup);
  const retry1 = execution(c, {
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: failed.id,
  }, setup);
  const retry2 = execution(c, {
    attempt: 3,
    run_kind: "auto_retry",
    retry_of: retry1.id,
  });
  assertEquals(retryProblem(failed, retry1, undefined), null);
  assert(retryProblem(done, retry1, undefined)!.includes("ended completed"));
  assert(retryProblem(retry1, retry2, failed)!.includes("one retry was used"));
  const limited = execution(c, {}, { termination: "usage_limited" });
  const again = execution(c, {
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: limited.id,
  }, {
    termination: "usage_limited",
  });
  assertEquals(retryProblem(again, retry2, limited), null);
});

Deno.test("schemas: cost declared incomplete cannot carry a value; reuse is refused in Part 1", async () => {
  const c = await campaign();
  const e = execution(c);
  assertThrows(() =>
    ExecutionRecordSchema.parse({
      ...e,
      validity: { incomplete_telemetry: ["cost_usd"], infra_exposed: false },
    })
  );
  // Missing turns alone keeps the cost usable.
  ExecutionRecordSchema.parse({
    ...e,
    validity: { incomplete_telemetry: ["turns"], infra_exposed: false },
  });
  const r = CampaignRecordSchema.safeParse({
    ...c,
    reuse: [{ campaign_id: c.id, execution_id: e.id }],
  });
  assert(!r.success);
  assert(
    r.error.issues.some((i) =>
      i.message.includes("not supported before Part 2")
    ),
  );
});

Deno.test("RecordStore: concurrent writers of one record, exactly one succeeds", async () => {
  const store = new RecordStore(await Deno.makeTempDir());
  const e = execution(await campaign());
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => store.writeExecution(e)),
  );
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
  assertEquals(await store.sweepTemp(), 0);
});

Deno.test("RecordStore: ids used as paths must be uuids, so reads cannot leave the store", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(join(root, "store"));
  for (const bad of ["..", "../campaigns", "a/b", "C:\\x"]) {
    await assertRejects(() => store.executions(bad), ValidationError, "id");
    await assertRejects(() => store.artifact(bad), ValidationError, "id");
    await assertRejects(() => store.judgments(bad), ValidationError, "id");
  }
});

Deno.test("RecordStore: a record filed under the wrong id fails with the file name", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e1 = execution(c);
  const e2 = execution(c, { arm: "skills" });
  const j = judgment(c, e1, true);
  await store.writeJudgment(j);
  // Hand-moved into another execution's folder.
  const dir2 = join(root, "judgments", e2.id);
  await Deno.mkdir(dir2, { recursive: true });
  await Deno.copyFile(
    join(root, "judgments", e1.id, `${j.id}.json`),
    join(dir2, `${j.id}.json`),
  );
  await assertRejects(() => store.judgments(e2.id), ValidationError, j.id);
  // Copied under another execution's file name.
  await store.writeExecution(e1);
  const other = "00000000-0000-4000-8000-0000000000ff";
  await Deno.mkdir(join(root, "executions", other));
  await Deno.copyFile(
    join(root, "executions", CAMPAIGN_ID, `${e1.id}.json`),
    join(root, "executions", other, `${e1.id}.json`),
  );
  await assertRejects(() => store.executions(other), ValidationError, e1.id);
});

Deno.test("planBlocks and campaign seed: limited to the mulberry32 range", async () => {
  assertThrows(() => planBlocks(["HX-001"], 1, ["a", "b"], 2 ** 32));
  assertThrows(() => planBlocks(["HX-001"], 1, ["a", "b"], -1));
  assertThrows(() => planBlocks(["HX-001"], 1, ["a", "b"], 1.5));
  const c = await campaign();
  assert(!CampaignRecordSchema.safeParse({ ...c, seed: 2 ** 32 }).success);
});

Deno.test("schemas: duplicate scorer names and duplicate task ids are refused", async () => {
  const c = await campaign();
  const j = judgment(c, execution(c), true);
  assertThrows(() =>
    JudgmentRecordSchema.parse({
      ...j,
      scorers: [...j.scorers, { name: "build", passed: true, tests: [] }],
    })
  );
  const t0 = c.task_set.tasks[0]!;
  const r = CampaignRecordSchema.safeParse({
    ...c,
    task_set: { ...c.task_set, tasks: [...c.task_set.tasks, t0] },
    tasks_meta: [...c.tasks_meta, c.tasks_meta[0]!],
  });
  assert(!r.success);
  assert(r.error.issues.some((i) => i.message.includes("duplicate task")));
});

Deno.test("schemas: hashes are lower-case hex, ids are lower-case uuids", async () => {
  const c = await campaign();
  const e = execution(c);
  for (const bad of ["g".repeat(64), "F".repeat(64), "../".repeat(21) + "x"]) {
    assertThrows(() =>
      ExecutionRecordSchema.parse({ ...e, workspace_hash: bad })
    );
  }
  assertThrows(() =>
    ExecutionRecordSchema.parse({ ...e, id: e.id.toUpperCase() })
  );
  const upper = CAMPAIGN_ID.replace("0001", "000A");
  assertThrows(() => CampaignRecordSchema.parse({ ...c, id: upper }));
  const store = new RecordStore(await Deno.makeTempDir());
  await assertRejects(() => store.executions(upper), ValidationError, "id");
});

Deno.test("schemas: raw_usage must be present; tasks_meta equals the task set as a set", async () => {
  const c = await campaign();
  const e = execution(c);
  const { raw_usage: _, ...noRaw } = e.telemetry;
  assertThrows(() => ExecutionRecordSchema.parse({ ...e, telemetry: noRaw }));
  const joined = c.task_set.tasks.map((t) => t.id).join(",");
  const r = CampaignRecordSchema.safeParse({
    ...c,
    tasks_meta: [{ ...c.tasks_meta[0]!, id: joined }],
  });
  assert(!r.success);
  assert(r.error.issues.some((i) => i.message.includes("tasks_meta")));
});

Deno.test("RecordStore: a record vanishing mid-listing is an error naming it", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  await store.writeExecution(e);
  await store.writeExecution(execution(c, { arm: "skills" }));
  const real = Deno.readFile;
  const s = stub(Deno, "readFile", (p, o) => {
    if (String(p).includes(e.id)) {
      return Promise.reject(new Deno.errors.NotFound("gone"));
    }
    return real(p, o);
  });
  try {
    await assertRejects(() => store.executions(CAMPAIGN_ID), Error, e.id);
  } finally {
    s.restore();
  }
});

Deno.test("RecordStore: unexpected entries and invalid UTF-8 fail loudly", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  await store.writeExecution(e);
  const dir = join(root, "executions", CAMPAIGN_ID);
  await Deno.writeTextFile(join(dir, "notes.txt"), "x");
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    "notes.txt",
  );
  await Deno.remove(join(dir, "notes.txt"));
  await Deno.mkdir(join(dir, "x.json"));
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    "x.json",
  );
  await Deno.remove(join(dir, "x.json"));
  const path = join(dir, `${e.id}.json`);
  const bytes = await Deno.readFile(path);
  const i = new TextDecoder().decode(bytes).indexOf("Cronus281");
  bytes[i] = 0xff;
  await Deno.remove(path);
  await Deno.writeFile(path, bytes);
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    `${e.id}.json`,
  );
});

Deno.test("RecordStore: linked records are refused", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  const outside = join(await Deno.makeTempDir(), "a.json");
  await Deno.writeTextFile(
    outside,
    JSON.stringify({
      v: 1,
      execution_id: e.id,
      workspace_hash: "a".repeat(64),
      stored_path: "x",
      created_at: "2026-10-01T10:12:00.000Z",
    }),
  );
  await Deno.mkdir(join(root, "artifacts"));
  try {
    await Deno.symlink(outside, join(root, "artifacts", `${e.id}.json`));
  } catch {
    console.log("symlink not permitted on this host; skipped");
    return;
  }
  await assertRejects(() => store.artifact(e.id), ValidationError, "link");
});

Deno.test("RecordStore: campaigns newest first by instant, lists sorted", async () => {
  const store = new RecordStore(await Deno.makeTempDir());
  // Same instant order differs from string order with mixed precision.
  const older = "00000000-0000-4000-8000-000000000003";
  const newer = "00000000-0000-4000-8000-000000000004";
  await store.writeCampaign(
    await campaign({ id: older, created_at: "2026-10-02T00:00:00Z" }),
  );
  await store.writeCampaign(
    await campaign({ id: newer, created_at: "2026-10-02T00:00:00.5Z" }),
  );
  assertEquals(
    (await store.campaigns("skills-vs-plain")).map((x) => x.id),
    [newer, older],
  );
  const c = await campaign();
  const late = execution(c, {}, { started_at: "2026-10-01T11:00:00.000Z" });
  const early = execution(c, { arm: "skills" }, {
    started_at: "2026-10-01T09:00:00.000Z",
  });
  await store.writeExecution(late);
  await store.writeExecution(early);
  assertEquals(
    (await store.executions(CAMPAIGN_ID)).map((x) => x.id),
    [early.id, late.id],
  );
  const j2 = judgment(c, late, true, {
    started_at: "2026-10-01T12:00:00.000Z",
  });
  const j1 = judgment(c, late, false, {
    started_at: "2026-10-01T11:30:00.000Z",
  });
  await store.writeJudgment(j2);
  await store.writeJudgment(j1);
  assertEquals((await store.judgments(late.id)).map((j) => j.id), [
    j1.id,
    j2.id,
  ]);
});

Deno.test("RecordStore: temp cleanup never fails a published write and never leaks on a failed one", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  const rm = stub(
    Deno,
    "remove",
    () => Promise.reject(new Deno.errors.PermissionDenied("AV holds it")),
  );
  try {
    await store.writeExecution(e);
  } finally {
    rm.restore();
  }
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
  assertEquals(await store.sweepTemp(), 1);
  const e2 = execution(c, { arm: "skills" });
  const sync = stub(
    Deno.FsFile.prototype,
    "sync",
    () => Promise.reject(new Error("disk full")),
  );
  try {
    await assertRejects(() => store.writeExecution(e2), Error, "disk full");
  } finally {
    sync.restore();
  }
  assertEquals(await store.sweepTemp(), 0);
  assertEquals(await store.executions(CAMPAIGN_ID), [e]);
});

Deno.test("RecordStore: a junctioned record folder is refused", async () => {
  const root = await Deno.makeTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  const e = execution(c);
  const elsewhere = new RecordStore(await Deno.makeTempDir());
  await elsewhere.writeExecution(e);
  await elsewhere.writeJudgment(judgment(c, e, true));
  await Deno.mkdir(join(root, "executions"));
  const type = Deno.build.os === "windows" ? "junction" : "dir";
  await Deno.symlink(
    join(elsewhere.root, "executions", CAMPAIGN_ID),
    join(root, "executions", CAMPAIGN_ID),
    { type },
  );
  await Deno.symlink(
    join(elsewhere.root, "judgments"),
    join(root, "judgments"),
    {
      type,
    },
  );
  await assertRejects(
    () => store.executions(CAMPAIGN_ID),
    ValidationError,
    "link",
  );
  await assertRejects(() => store.judgments(e.id), ValidationError, "link");
});

Deno.test("schemas: every embedded hash is 64 lower-case hex", async () => {
  const c = await campaign();
  const e = execution(c);
  const bad = "G".repeat(64);
  const t0 = c.task_set.tasks[0]!;
  for (
    const ts of [
      { ...c.task_set, identity: bad },
      { ...c.task_set, tasks: [{ ...t0, visible: bad }] },
      { ...c.task_set, tasks: [{ ...t0, oracle: bad }] },
    ]
  ) {
    assert(!TaskSetIdentitySchema.safeParse(ts).success);
    assertThrows(() => CampaignRecordSchema.parse({ ...c, task_set: ts }));
  }
  const skills = c.arms[1]!.manifest;
  const badComponent = {
    ...skills,
    skills: { path: "bundles/s", hash: bad, files: [] },
  };
  assert(!ResolvedManifestSchema.safeParse(badComponent).success);
  assertThrows(() =>
    ExecutionRecordSchema.parse({ ...e, manifest: badComponent })
  );
});

Deno.test("schemas: incomplete_telemetry names known fields; null cost must be declared", async () => {
  const c = await campaign();
  const e = execution(c);
  assertThrows(() =>
    ExecutionRecordSchema.parse({
      ...e,
      validity: { incomplete_telemetry: ["cost_us"], infra_exposed: false },
    })
  );
  assertThrows(() =>
    ExecutionRecordSchema.parse({ ...e, telemetry: telemetry(null) })
  );
  ExecutionRecordSchema.parse({
    ...e,
    telemetry: telemetry(null),
    validity: { incomplete_telemetry: ["cost_usd"], infra_exposed: false },
  });
});
