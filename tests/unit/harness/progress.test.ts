import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  type ExecutionRecord,
  RecordStore,
} from "../../../src/harness/records.ts";
import {
  buildProgress,
  progressSnapshot,
  renderProgress,
} from "../../../src/harness/progress.ts";
import { testTempDir } from "../../utils/temp-dir.ts";
import { campaign, execution, judgment, telemetry } from "./fixtures.ts";

const at = (m: number) => `2026-10-01T10:${String(m).padStart(2, "0")}:00.000Z`;

async function setup() {
  const root = await testTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  await store.writeCampaign(c);
  return { root, store, c };
}

async function tree(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for await (const e of Deno.readDir(d)) {
      const p = join(d, e.name);
      const st = await Deno.stat(p);
      out.push(
        `${p}:${e.isDirectory ? "dir" : st.size}:${st.mtime?.getTime()}`,
      );
      if (e.isDirectory) await walk(p);
    }
  };
  const rst = await Deno.stat(root);
  out.push(`${root}:root:${rst.mtime?.getTime()}`);
  await walk(root);
  return out.sort();
}

Deno.test("progress: counts, retries, terminations, cost, wall, tasks", async () => {
  const { root, store, c } = await setup();
  const tel = (cost: number, wall: number) => ({
    ...telemetry(cost),
    wall_ms: wall,
  });
  const e1 = execution(c, { task: "HX-001", arm: "plain" }, {
    telemetry: tel(1, 1000),
    termination: "timeout",
  });
  const e1r = execution(
    c,
    {
      task: "HX-001",
      arm: "plain",
      attempt: 2,
      run_kind: "auto_retry",
      retry_of: e1.id,
    },
    { telemetry: { ...tel(2, 3000), reported_cost_usd: 2.5 } },
  );
  const e2 = execution(c, { task: "HX-001", arm: "skills" }, {
    telemetry: tel(4, 5000),
  });
  const e3 = execution(c, { task: "HX-002", arm: "plain" }, {
    telemetry: tel(1, 1000),
  });
  for (const e of [e1, e1r, e2, e3]) await store.writeExecution(e);
  await store.writeJudgment(judgment(c, e1r, true));
  await store.writeJudgment(judgment(c, e2, null));
  // e3 has no judgments dir at all: not judged.

  const p = await buildProgress(root, c.id);
  assertEquals(p.planned_cells, 4);
  assertEquals(p.finished_cells, 3);
  assertEquals(p.started.executions, 4);
  assertEquals(p.started.in_flight, null);
  assertEquals(p.started.estimate, true);
  assertEquals(p.executions.by_run_kind, {
    planned: 3,
    auto_retry: 1,
    manual_rerun: 0,
  });
  assertEquals(p.judged_cells, 2);
  assertEquals(p.unscored_cells, 1);
  assertEquals(p.pass_cells, 1);
  assertEquals(p.fail_cells, 0);
  assertEquals(p.terminations, { timeout: 1, completed: 3 });
  assertEquals(p.arms["plain"]!.cost_usd, 4);
  assertEquals(p.arms["plain"]!.reported_cost_usd, 2.5);
  assertEquals(p.arms["skills"]!.reported_cost_usd, null);
  assertEquals(p.arms["plain"]!.finished, 2);
  // latest execution of each cell: (3000 + 1000) / 2
  assertEquals(p.arms["plain"]!.mean_wall_ms, 2000);
  assertEquals(p.arms["skills"]!.mean_wall_ms, 5000);
  assertEquals(p.tasks["HX-001"], { plain: 1, skills: 1 });
  assertEquals(p.tasks["HX-002"], { plain: 1, skills: 0 });
  assertEquals(p.tasks_planned["HX-002"], 1);
  assertEquals(p.unreadable, []);
  const text = renderProgress(p);
  assertStringIncludes(text, "estimate");
  assertEquals(text.includes("—"), false);
});

Deno.test("progress: resolves campaign id or experiment id, newest wins", async () => {
  const { root, store, c } = await setup();
  const newer = await campaign({
    id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-10-02T10:00:00.000Z",
  });
  await store.writeCampaign(newer);
  assertEquals((await buildProgress(root, c.id)).campaign_id, c.id);
  assertEquals(
    (await buildProgress(root, "skills-vs-plain")).campaign_id,
    newer.id,
  );
  assertEquals(
    (await buildProgress(root, "skills-vs-plain", { campaign: c.id }))
      .campaign_id,
    c.id,
  );
  await assertRejects(() => buildProgress(root, "nope"), Error, "nope");
});

Deno.test("progress: observed concurrency, ETA and --concurrency override", async () => {
  const { root, store, c } = await setup();
  const mk = (task: string, arm: string, s: number, e: number) =>
    execution(c, { task, arm }, {
      started_at: at(s),
      ended_at: at(e),
      telemetry: { ...telemetry(1), wall_ms: 60000 },
    });
  // two overlap (0-10, 5-15), then one alone (20-30)
  for (
    const e of [
      mk("HX-001", "plain", 0, 10),
      mk("HX-001", "skills", 5, 15),
      mk("HX-002", "plain", 20, 30),
    ]
  ) await store.writeExecution(e);
  const p = await buildProgress(root, c.id);
  assertEquals(p.eta.source, "observed");
  assertEquals(p.eta.concurrency, 2);
  assertEquals(p.eta.ms, (1 * 60000) / 2);
  const f = await buildProgress(root, c.id, { concurrency: 1 });
  assertEquals(f.eta.source, "flag");
  assertEquals(f.eta.ms, 60000);
  assertEquals(f.eta.estimate, true);
});

Deno.test("progress: nothing finished gives null ETA", async () => {
  const { root, c } = await setup();
  const p = await buildProgress(root, c.id);
  assertEquals(p.eta.ms, null);
  assertEquals(p.eta.concurrency, 1);
  assertEquals(p.finished_cells, 0);
});

Deno.test("progress: partial and temp files are listed, store untouched", async () => {
  const { root, store, c } = await setup();
  const e = execution(c);
  await store.writeExecution(e);
  const dir = join(root, "executions", c.id);
  await Deno.writeTextFile(
    join(dir, "00000000-0000-4000-9000-0000000000ff.json"),
    '{"v":2,"id"',
  );
  await Deno.writeTextFile(join(dir, "x.json.tmp-123"), "{}");
  const before = await tree(root);
  const p = await buildProgress(root, c.id);
  assertEquals(p.finished_cells, 1);
  assertEquals(p.unreadable.length, 2);
  assertStringIncludes(renderProgress(p), "unreadable");
  assertEquals(await tree(root), before);
});

Deno.test("progress: a missing results dir creates nothing", async () => {
  const root = join(await testTempDir(), "absent");
  await assertRejects(() => buildProgress(root, "x"), Error);
  assertEquals(await Deno.stat(root).then(() => true, () => false), false);
});

const writeAll = async (store: RecordStore, es: ExecutionRecord[]) => {
  for (const e of es) await store.writeExecution(e);
};

Deno.test("progress (r2 #1): a truncated or vanished requested campaign is named, not 'unknown'", async () => {
  const { root, c } = await setup();
  await Deno.writeTextFile(join(root, "campaigns", `${c.id}.json`), '{"v":1,');
  const err = await assertRejects(() => buildProgress(root, c.id), Error);
  assertStringIncludes(err.message, `campaign ${c.id} unreadable`);
  assertEquals((err as { code?: string }).code !== "HARNESS_NO_CAMPAIGN", true);
  // r3: the campaign-id path returns a snapshot with the reason, no numbers.
  const snap = await progressSnapshot(root, c.id);
  assertEquals("campaign_unreadable" in snap, true);
  if (!("campaign_unreadable" in snap)) return;
  assertEquals(snap.campaign_id, c.id);
  assertStringIncludes(snap.campaign_unreadable.reason, "Invalid record");
  assertEquals(snap.unreadable[0], snap.campaign_unreadable);
  const text = renderProgress(snap);
  assertStringIncludes(text, "[WARN]");
  assertEquals(text.includes("planned"), false);
  // An experiment id whose campaigns are all unreadable keeps the error and lists them.
  await assertRejects(
    () => buildProgress(root, "skills-vs-plain"),
    Error,
    `${c.id}.json`,
  );
  await Deno.remove(join(root, "campaigns", `${c.id}.json`));
  await assertRejects(() => buildProgress(root, c.id), Error, "No campaign");
  await assertRejects(() => progressSnapshot(root, c.id), Error, "No campaign");
});

Deno.test("progress (r3): re-derivation temp files are listed, not applied", async () => {
  const { root, store, c } = await setup();
  const e = execution(c);
  await store.writeExecution(e);
  const dir = join(root, "rederivations", e.id);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "r.json.tmp-abc"), "{}");
  const p = await buildProgress(root, c.id);
  assertEquals(p.unreadable.length, 1);
  assertEquals(p.unreadable[0]!.reason, "temp file (not applied)");
  assertEquals(p.unreadable[0]!.path, join(dir, "r.json.tmp-abc"));
  assertEquals(p.finished_cells, 1);
});

Deno.test("progress (r2 #2): null cost is counted as missing, not as zero spend", async () => {
  const { root, store, c } = await setup();
  await writeAll(store, [
    execution(c, { arm: "plain" }, {
      telemetry: telemetry(null),
      validity: {
        incomplete_telemetry: ["cost_usd"],
        incomplete_observed: [],
        infra_exposed: false,
      },
    }),
    execution(c, { arm: "skills" }, { telemetry: telemetry(2) }),
  ]);
  const p = await buildProgress(root, c.id);
  assertEquals(p.arms["plain"]!.cost_missing, 1);
  assertEquals(p.arms["skills"]!.cost_missing, 0);
  const text = renderProgress(p);
  assertStringIncludes(text, "estimated");
  assertStringIncludes(text, "(1 without cost)");
});

Deno.test("progress (r2 #4): executions that do not fit the plan are skipped and listed", async () => {
  const { root, store, c } = await setup();
  await writeAll(store, [
    execution(c, { task: "HX-001" }, { block: 99 }),
    execution(c, { task: "HX-001" }, { task_id: "HX-002" }),
    execution(c, { task: "HX-001" }, { arm: "toString" }),
    execution(c, { task: "HX-001", arm: "skills" }),
  ]);
  const p = await buildProgress(root, c.id);
  assertEquals(p.finished_cells, 1);
  assertEquals(p.started.executions, 1);
  assertEquals(p.unreadable.length, 3);
  assertEquals(p.tasks["HX-001"], { plain: 0, skills: 1 });
});

Deno.test("progress (r2 #5): the latest judgment is the one RecordStore orders last (started_at)", async () => {
  const { root, store, c } = await setup();
  const e = execution(c);
  await store.writeExecution(e);
  await store.writeJudgment(
    judgment(c, e, true, { started_at: at(12), ended_at: at(30) }),
  );
  await store.writeJudgment(
    judgment(c, e, false, { started_at: at(20), ended_at: at(25) }),
  );
  const p = await buildProgress(root, c.id);
  assertEquals([p.pass_cells, p.fail_cells], [0, 1]);
});

Deno.test("progress (r2 #6): policy-unscored latest execution is unscored; a retry replaces it", async () => {
  const { root, store, c } = await setup();
  const bad = execution(c, {}, {
    termination: "setup_failed",
    did_work: false,
    started_at: at(1),
    ended_at: at(2),
  });
  await store.writeExecution(bad);
  let p = await buildProgress(root, c.id);
  assertEquals(
    [p.unscored_policy_cells, p.unscored_cells, p.awaiting_judgment_cells],
    [1, 1, 0],
  );
  await store.writeExecution(
    execution(c, { attempt: 2, run_kind: "auto_retry", retry_of: bad.id }, {
      started_at: at(3),
      ended_at: at(4),
    }),
  );
  p = await buildProgress(root, c.id);
  assertEquals(
    [p.unscored_policy_cells, p.unscored_cells, p.awaiting_judgment_cells],
    [0, 0, 1],
  );
});

Deno.test("progress (r2 #7): concurrency must be a positive integer", async () => {
  const { root, c } = await setup();
  for (const n of [0, -1, 1.5, NaN]) {
    await assertRejects(
      () => buildProgress(root, c.id, { concurrency: n }),
      Error,
      "concurrency",
    );
  }
});

Deno.test("progress (r2 #9): sub-millisecond overlap counts as concurrent", async () => {
  const { root, store, c } = await setup();
  const t = (f: string) => `2026-10-01T10:00:00.${f}Z`;
  await writeAll(store, [
    execution(c, { arm: "plain" }, {
      started_at: t("000100"),
      ended_at: t("000900"),
    }),
    execution(c, { arm: "skills" }, {
      started_at: t("000500"),
      ended_at: t("000700"),
    }),
  ]);
  assertEquals((await buildProgress(root, c.id)).eta.concurrency, 2);
});

Deno.test("progress (r2 #11): a manual rerun replaces a judged pass with an awaiting cell", async () => {
  const { root, store, c } = await setup();
  const first = execution(c, {}, { started_at: at(1), ended_at: at(2) });
  await store.writeExecution(first);
  await store.writeJudgment(judgment(c, first, true));
  let p = await buildProgress(root, c.id);
  assertEquals([p.pass_cells, p.awaiting_judgment_cells], [1, 0]);
  await store.writeExecution(
    execution(c, { run_kind: "manual_rerun", attempt: 2 }, {
      started_at: at(5),
      ended_at: at(6),
    }),
  );
  p = await buildProgress(root, c.id);
  assertEquals([p.pass_cells, p.awaiting_judgment_cells], [0, 1]);
  assertEquals(p.finished_cells, 1);
  assertEquals(p.executions.by_run_kind.manual_rerun, 1);
});

Deno.test("progress (r2 #11): several repeats and the null wall_ms fallback", async () => {
  const root = await testTempDir();
  const store = new RecordStore(root);
  const c = await campaign({ repeats: 2 });
  await store.writeCampaign(c);
  await writeAll(store, [
    execution(c, { task: "HX-001", repeat: 1 }),
    execution(c, { task: "HX-001", repeat: 2 }),
  ]);
  const p = await buildProgress(root, c.id);
  assertEquals(p.planned_cells, 8);
  assertEquals(p.tasks_planned["HX-001"], 2);
  assertEquals(p.tasks["HX-001"], { plain: 2, skills: 0 });
  assertEquals(p.arms["plain"]!.planned, 4);
  // fixture wall_ms is null: started 10:01, ended 10:11
  assertEquals(p.arms["plain"]!.mean_wall_ms, 600000);
});

Deno.test("progress (r2 #12): --campaign must belong to the experiment and exist", async () => {
  const { root, store, c } = await setup();
  const other = await campaign({
    id: "00000000-0000-4000-8000-000000000009",
    experiment: { ...c.experiment, id: "other-exp" },
  });
  await store.writeCampaign(other);
  await assertRejects(
    () => buildProgress(root, "skills-vs-plain", { campaign: other.id }),
    Error,
  );
  await assertRejects(
    () =>
      buildProgress(root, "skills-vs-plain", {
        campaign: "00000000-0000-4000-8000-0000000000aa",
      }),
    Error,
  );
});

Deno.test("progress (r2 #12): the JSON top-level contract", async () => {
  const { root, c } = await setup();
  assertEquals(Object.keys(await buildProgress(root, c.id)).sort(), [
    "arms",
    "awaiting_judgment_cells",
    "campaign_id",
    "eta",
    "executions",
    "experiment_id",
    "fail_cells",
    "finished_cells",
    "judged_cells",
    "pass_cells",
    "planned_cells",
    "started",
    "tasks",
    "tasks_planned",
    "terminations",
    "unknown_cells",
    "unreadable",
    "unscored_cells",
    "unscored_policy_cells",
  ]);
});
