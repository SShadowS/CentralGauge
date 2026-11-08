/**
 * H-78: live progress of a campaign, read from the results store only.
 * Read-only: no lock, no guardResultsDir, no directory created. A record that
 * cannot be read (partial write of a live run, stray temp file) is skipped and
 * listed instead of aborting.
 */

import { join } from "@std/path";
import * as colors from "@std/fmt/colors";
import { CentralGaugeError } from "../errors.ts";
import {
  type CampaignRecord,
  CampaignRecordSchema,
  compareInstant,
  type ExecutionRecord,
  JudgmentRecordSchema,
  readRecord,
  RecordStore,
  type RunKind,
  StoredExecutionSchema,
} from "./records.ts";

export interface Unreadable {
  path: string;
  reason: string;
}

export interface ArmStats {
  planned: number;
  finished: number;
  cost_usd: number;
  reported_cost_usd: number | null;
  mean_wall_ms: number | null;
}

export interface Progress {
  campaign_id: string;
  experiment_id: string;
  planned_cells: number;
  finished_cells: number;
  judged_cells: number;
  unscored_cells: number;
  pass_cells: number;
  fail_cells: number;
  /** ponytail: the store has no in-flight records; started = published. */
  started: {
    executions: number;
    estimate: true;
    in_flight: null;
    note: string;
  };
  executions: { total: number; by_run_kind: Record<RunKind, number> };
  terminations: Record<string, number>;
  arms: Record<string, ArmStats>;
  /** task id -> arm -> cells done (planned per arm is `tasks_planned`). */
  tasks: Record<string, Record<string, number>>;
  tasks_planned: Record<string, number>;
  eta: {
    ms: number | null;
    concurrency: number;
    source: "flag" | "observed";
    estimate: true;
  };
  unreadable: Unreadable[];
}

const reason = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Every record in `dir` that reads; the rest are listed, a missing dir is empty. */
async function readTolerant<T extends Parameters<typeof readRecord>[2]>(
  root: string,
  dir: string,
  schema: T,
  expect: (stem: string) => Record<string, string>,
  bad: Unreadable[],
): Promise<ReturnType<T["parse"]>[]> {
  const out: ReturnType<T["parse"]>[] = [];
  let names: string[];
  try {
    names = [];
    for await (const e of Deno.readDir(dir)) names.push(e.name);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return out;
    bad.push({ path: dir, reason: reason(err) });
    return out;
  }
  for (const name of names.sort()) {
    const path = join(dir, name);
    if (!name.endsWith(".json")) {
      bad.push({ path, reason: "not a record file (temp or foreign)" });
      continue;
    }
    try {
      out.push(
        await readRecord(
          root,
          path,
          schema,
          expect(name.slice(0, -5)),
        ) as ReturnType<T["parse"]>,
      );
    } catch (err) {
      bad.push({ path, reason: reason(err).split("\n")[0]! });
    }
  }
  return out;
}

/** Most executions whose [started, ended] intervals overlap, at least 1. */
function observedConcurrency(execs: ExecutionRecord[]): number {
  const ev = execs.flatMap((e) =>
    [
      [Date.parse(e.started_at), 1],
      [Date.parse(e.ended_at), -1],
    ] as const
  ).filter(([t]) => !Number.isNaN(t));
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends before starts on a tie
  let cur = 0, max = 1;
  for (const [, d] of ev) max = Math.max(max, cur += d);
  return max;
}

const wallOf = (e: ExecutionRecord) =>
  e.telemetry.wall_ms ?? (Date.parse(e.ended_at) - Date.parse(e.started_at));

/** Resolve a campaign id, else an experiment id (newest campaign, as `report`). */
async function resolveCampaign(
  root: string,
  id: string,
  campaignOpt: string | undefined,
  bad: Unreadable[],
): Promise<CampaignRecord> {
  const all = await readTolerant(
    root,
    join(root, "campaigns"),
    CampaignRecordSchema,
    (stem) => ({ id: stem }),
    bad,
  );
  const byId = campaignOpt ? undefined : all.find((c) => c.id === id);
  const found = byId ?? all.filter((c) => c.experiment.id === id)
    .filter((c) => !campaignOpt || c.id === campaignOpt)
    .sort((a, b) =>
      compareInstant(b.created_at, a.created_at) || (a.id < b.id ? 1 : -1)
    )[0];
  if (!found) {
    throw new CentralGaugeError(
      `No campaign or experiment ${id}${
        campaignOpt ? ` (campaign ${campaignOpt})` : ""
      } in ${root}`,
      "HARNESS_NO_CAMPAIGN",
    );
  }
  return found;
}

export async function buildProgress(
  root: string,
  id: string,
  opts: { campaign?: string | undefined; concurrency?: number | undefined } =
    {},
): Promise<Progress> {
  const unreadable: Unreadable[] = [];
  const c = await resolveCampaign(root, id, opts.campaign, unreadable);
  const stored = await readTolerant(
    root,
    join(root, "executions", c.id),
    StoredExecutionSchema,
    (stem) => ({ id: stem, campaign_id: c.id }),
    unreadable,
  );
  // R-10: apply re-derivations as `report` does. A refused overlay keeps the
  // stored record (its cell is still finished) but is listed and not costed.
  const store = new RecordStore(root);
  const refused = new Set<string>();
  const execs: ExecutionRecord[] = [];
  for (const s of stored) {
    try {
      execs.push(await store.applyRederivation(s));
    } catch (err) {
      refused.add(s.id);
      execs.push(s);
      unreadable.push({
        path: join(root, "executions", c.id, `${s.id}.json`),
        reason: `re-derivation: ${reason(err).split("\n")[0]}`,
      });
    }
  }

  const latest = new Map<string, ExecutionRecord>();
  for (const e of execs) {
    const k = `${e.block}|${e.arm}`;
    const cur = latest.get(k);
    if (
      !cur || e.attempt > cur.attempt ||
      (e.attempt === cur.attempt &&
        compareInstant(e.started_at, cur.started_at) > 0)
    ) latest.set(k, e);
  }

  const armIds = c.arms.map((a) => a.config_id);
  const taskIds = c.tasks_meta.map((t) => t.id);
  const repeatsPerTask = (t: string) =>
    c.blocks.filter((b) => b.task_id === t).length;
  const arms: Record<string, ArmStats> = {};
  for (const a of armIds) {
    arms[a] = {
      planned: c.blocks.length,
      finished: 0,
      cost_usd: 0,
      reported_cost_usd: null,
      mean_wall_ms: null,
    };
  }
  const by_run_kind: Record<RunKind, number> = {
    planned: 0,
    auto_retry: 0,
    manual_rerun: 0,
  };
  const terminations: Record<string, number> = {};
  for (const e of execs) {
    by_run_kind[e.run_kind]++;
    if (refused.has(e.id)) continue; // overlay refused: no cost, no termination
    terminations[e.termination] = (terminations[e.termination] ?? 0) + 1;
    const s = arms[e.arm];
    if (!s) continue;
    s.cost_usd += e.telemetry.cost_usd ?? 0;
    if (e.telemetry.reported_cost_usd != null) {
      s.reported_cost_usd = (s.reported_cost_usd ?? 0) +
        e.telemetry.reported_cost_usd;
    }
  }

  const tasks: Record<string, Record<string, number>> = {};
  const tasks_planned: Record<string, number> = {};
  for (const t of taskIds) {
    tasks[t] = Object.fromEntries(armIds.map((a) => [a, 0]));
    tasks_planned[t] = repeatsPerTask(t);
  }
  const walls: Record<string, number[]> = Object.fromEntries(
    armIds.map((a) => [a, []]),
  );
  let judged = 0, unscored = 0, pass = 0, fail = 0;
  for (const e of latest.values()) {
    if (!arms[e.arm]) continue;
    arms[e.arm]!.finished++;
    walls[e.arm]!.push(wallOf(e));
    if (tasks[e.task_id]) tasks[e.task_id]![e.arm]!++;
    const js = await readTolerant(
      root,
      join(root, "judgments", e.id),
      JudgmentRecordSchema,
      (stem) => ({ id: stem, execution_id: e.id }),
      unreadable,
    );
    const j = js.sort((a, b) =>
      compareInstant(a.ended_at, b.ended_at) || (a.id < b.id ? -1 : 1)
    ).at(-1);
    if (!j) continue;
    judged++;
    if (j.verdict === "unscored") unscored++;
    else if (j.verdict === "pass") pass++;
    else fail++;
  }
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  for (const a of armIds) arms[a]!.mean_wall_ms = mean(walls[a]!);

  const planned = c.blocks.length * armIds.length;
  const finished = latest.size;
  const source = opts.concurrency !== undefined ? "flag" : "observed";
  const concurrency = opts.concurrency ?? observedConcurrency(execs);
  const meanAll = mean(Object.values(walls).flat());
  return {
    campaign_id: c.id,
    experiment_id: c.experiment.id,
    planned_cells: planned,
    finished_cells: finished,
    judged_cells: judged,
    unscored_cells: unscored,
    pass_cells: pass,
    fail_cells: fail,
    started: {
      executions: execs.length,
      estimate: true,
      in_flight: null,
      note: "not in results store; counts published executions only",
    },
    executions: { total: execs.length, by_run_kind },
    terminations,
    arms,
    tasks,
    tasks_planned,
    eta: {
      ms: meanAll === null
        ? null
        : ((planned - finished) * meanAll) / concurrency,
      concurrency,
      source,
      estimate: true,
    },
    unreadable,
  };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const secs = (ms: number | null) =>
  ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`;

export function renderProgress(p: Progress): string {
  const L: string[] = [];
  L.push(
    `${
      colors.cyan("[Progress]")
    } campaign ${p.campaign_id} (experiment ${p.experiment_id})`,
  );
  L.push(
    `${
      colors.cyan("[Cells]")
    } planned ${p.planned_cells}, finished ${p.finished_cells}, judged ${p.judged_cells} (pass ${p.pass_cells}, fail ${p.fail_cells}, unscored ${p.unscored_cells})`,
  );
  const k = p.executions.by_run_kind;
  L.push(
    `${
      colors.cyan("[Executions]")
    } started (estimate) ${p.started.executions}; by kind planned ${k.planned}, auto_retry ${k.auto_retry}, manual_rerun ${k.manual_rerun}; in flight: ${p.started.in_flight} (${p.started.note})`,
  );
  L.push(
    `${colors.cyan("[Terminations]")} ${
      Object.entries(p.terminations).map(([t, n]) => `${t} ${n}`).join(", ") ||
      "none"
    }`,
  );
  for (const [a, s] of Object.entries(p.arms)) {
    L.push(
      `${colors.cyan("[Arm]")} ${a}: ${s.finished}/${s.planned} cells, cost ${
        usd(s.cost_usd)
      }${
        s.reported_cost_usd === null
          ? ""
          : ` (reported ${usd(s.reported_cost_usd)})`
      }, mean wall ${secs(s.mean_wall_ms)}`,
    );
  }
  const e = p.eta;
  L.push(
    `${colors.cyan("[ETA]")} (estimate) ${
      e.ms === null ? "n/a" : secs(e.ms)
    } at concurrency ${e.concurrency} (${e.source})`,
  );
  const arms = Object.keys(p.arms);
  for (const [t, row] of Object.entries(p.tasks)) {
    L.push(
      `${colors.cyan("[Task]")} ${t}: ${
        arms.map((a) => `${a} ${row[a]}/${p.tasks_planned[t]}`).join(", ")
      }`,
    );
  }
  for (const u of p.unreadable) {
    L.push(`${colors.yellow("[WARN]")} unreadable ${u.path}: ${u.reason}`);
  }
  return L.join("\n");
}
