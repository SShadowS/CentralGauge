import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RecordStore } from "../../../src/harness/records.ts";
import {
  buildProgress,
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
      if (e.isDirectory) await walk(p);
      else out.push(`${p}:${(await Deno.stat(p)).size}`);
    }
  };
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
