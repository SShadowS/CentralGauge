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
  byInstant,
  type CampaignRecord,
  CampaignRecordSchema,
  compareInstant,
  type ExecutionRecord,
  JudgmentRecordSchema,
  outcomePolicy,
  readRecord,
  RecordStore,
  type RunKind,
  StoredExecutionSchema,
  TMP,
} from "./records.ts";

export interface Unreadable {
  path: string;
  reason: string;
}

export interface ArmStats {
  planned: number;
  finished: number;
  /** Estimated cost of the executions that report one (see cost_missing). */
  cost_usd: number;
  /** Executions with no cost_usd, or whose re-derivation failed. */
  cost_missing: number;
  reported_cost_usd: number | null;
  mean_wall_ms: number | null;
}

export interface Progress {
  campaign_id: string;
  experiment_id: string;
  planned_cells: number;
  finished_cells: number;
  /** Finished cells whose latest execution has a judgment. */
  judged_cells: number;
  /** Policy-unscored cells plus cells whose latest verdict is unscored. */
  unscored_cells: number;
  /** Of unscored_cells: the latest execution is never judged (outcome policy). */
  unscored_policy_cells: number;
  /** Finished cells the policy sends to judging that have no judgment yet. */
  awaiting_judgment_cells: number;
  /** No judgment and the outcome is unknown (re-derivation refused). */
  unknown_cells: number;
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
  /** "unknown" = a re-derivation could not be applied. */
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

/** No numbers: the requested campaign record itself does not read. */
export interface UnavailableProgress {
  campaign_id: string;
  campaign_unreadable: Unreadable;
  unreadable: Unreadable[];
}

class CampaignUnreadable extends CentralGaugeError {
  constructor(
    readonly campaignId: string,
    readonly entry: Unreadable,
    /** Every diagnostic collected during resolution (includes `entry`). */
    readonly all: Unreadable[],
  ) {
    super(
      `campaign ${campaignId} unreadable: ${entry.reason} (${entry.path})`,
      "HARNESS_CAMPAIGN_UNREADABLE",
    );
  }
}

/** buildProgress, but an unreadable requested campaign id gives a snapshot. */
export async function progressSnapshot(
  root: string,
  id: string,
  opts: Parameters<typeof buildProgress>[2] = {},
): Promise<Progress | UnavailableProgress> {
  try {
    return await buildProgress(root, id, opts);
  } catch (err) {
    if (!(err instanceof CampaignUnreadable)) throw err;
    return {
      campaign_id: err.campaignId,
      campaign_unreadable: err.entry,
      unreadable: err.all,
    };
  }
}

const reason = (e: unknown) => e instanceof Error ? e.message : String(e);
const first = (e: unknown) => reason(e).split("\n")[0]!;

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
      bad.push({ path, reason: first(err) });
    }
  }
  return out;
}

/** Most executions whose [started, ended] intervals overlap, at least 1. */
function observedConcurrency(execs: ExecutionRecord[]): number {
  const ev = execs.flatMap((e) =>
    [
      [e.started_at, 1],
      [e.ended_at, -1],
    ] as const
  );
  // Exact instants; ends before starts on an exact tie.
  ev.sort((a, b) => compareInstant(a[0], b[0]) || a[1] - b[1]);
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
  const dir = join(root, "campaigns");
  const all = await readTolerant(
    root,
    dir,
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
  if (found) return found;
  // A requested campaign whose file exists but does not read is not "unknown".
  for (const want of [campaignOpt ?? id]) {
    const u = bad.find((b) => b.path === join(dir, `${want}.json`));
    if (u) throw new CampaignUnreadable(want, u, [...bad]);
  }
  throw new CentralGaugeError(
    `No campaign or experiment ${id}${
      campaignOpt ? ` (campaign ${campaignOpt})` : ""
    } in ${root}${
      bad.length > 0
        ? `; unreadable: ${
          bad.map((b) => `${b.path} (${b.reason})`).join("; ")
        }`
        : ""
    }`,
    "HARNESS_NO_CAMPAIGN",
  );
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export async function buildProgress(
  root: string,
  id: string,
  opts: { campaign?: string | undefined; concurrency?: number | undefined } =
    {},
): Promise<Progress> {
  const { concurrency: flag } = opts;
  if (flag !== undefined && !(Number.isInteger(flag) && flag > 0)) {
    throw new CentralGaugeError(
      `concurrency must be a positive integer, got ${flag}`,
      "HARNESS_BAD_CONCURRENCY",
    );
  }
  const unreadable: Unreadable[] = [];
  const c = await resolveCampaign(root, id, opts.campaign, unreadable);
  const stored = await readTolerant(
    root,
    join(root, "executions", c.id),
    StoredExecutionSchema,
    (stem) => ({ id: stem, campaign_id: c.id }),
    unreadable,
  );

  const armIds = c.arms.map((a) => a.config_id);
  const arms = new Map<string, ArmStats>(
    armIds.map((a) => [a, {
      planned: c.blocks.length,
      finished: 0,
      cost_usd: 0,
      cost_missing: 0,
      reported_cost_usd: null,
      mean_wall_ms: null,
    }]),
  );
  const tasks = new Map<string, Map<string, number>>(
    c.tasks_meta.map((t) => [t.id, new Map(armIds.map((a) => [a, 0]))]),
  );
  const tasksPlanned = new Map<string, number>(
    c.tasks_meta.map(
      (t) => [t.id, c.blocks.filter((b) => b.task_id === t.id).length],
    ),
  );

  // Each execution must fit the plan before anything is aggregated.
  const store = new RecordStore(root);
  const refused = new Set<string>();
  const execs: ExecutionRecord[] = [];
  for (const s of stored) {
    const path = join(root, "executions", c.id, `${s.id}.json`);
    const block = c.blocks.find((b) => b.index === s.block);
    const misfit = !block
      ? `block ${s.block} is not in the plan`
      : block.task_id !== s.task_id || block.repeat !== s.repeat
      ? `block ${s.block} is ${block.task_id} repeat ${block.repeat}, not ${s.task_id} repeat ${s.repeat}`
      : !arms.has(s.arm)
      ? `arm ${s.arm} is not an arm of the campaign`
      : null;
    if (misfit) {
      unreadable.push({ path, reason: `not in the plan: ${misfit}` });
      continue;
    }
    // Overlay temp files are never applied by RecordStore; say so.
    const rdir = join(root, "rederivations", s.id);
    try {
      for await (const f of Deno.readDir(rdir)) {
        if (f.name.includes(TMP)) {
          unreadable.push({
            path: join(rdir, f.name),
            reason: "temp file (not applied)",
          });
        }
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        unreadable.push({ path: rdir, reason: first(err) });
      }
    }
    // R-10: re-derivations as `report` applies them. A refused overlay keeps
    // the stored record (its cell is finished) but its outcome is unknown.
    try {
      execs.push(await store.applyRederivation(s));
    } catch (err) {
      refused.add(s.id);
      execs.push(s);
      unreadable.push({ path, reason: `re-derivation: ${first(err)}` });
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

  const by_run_kind: Record<RunKind, number> = {
    planned: 0,
    auto_retry: 0,
    manual_rerun: 0,
  };
  const terminations = new Map<string, number>();
  for (const e of execs) {
    by_run_kind[e.run_kind]++;
    const s = arms.get(e.arm)!;
    const term = refused.has(e.id) ? "unknown" : e.termination;
    terminations.set(term, (terminations.get(term) ?? 0) + 1);
    if (refused.has(e.id) || e.telemetry.cost_usd === null) s.cost_missing++;
    else s.cost_usd += e.telemetry.cost_usd;
    if (!refused.has(e.id) && e.telemetry.reported_cost_usd != null) {
      s.reported_cost_usd = (s.reported_cost_usd ?? 0) +
        e.telemetry.reported_cost_usd;
    }
  }

  const walls = new Map<string, number[]>(armIds.map((a) => [a, []]));
  let judged = 0,
    unscoredPolicy = 0,
    unscoredVerdict = 0,
    awaiting = 0,
    unknown = 0;
  let pass = 0, fail = 0;
  for (const e of latest.values()) {
    arms.get(e.arm)!.finished++;
    walls.get(e.arm)!.push(wallOf(e));
    tasks.get(e.task_id)!.set(e.arm, tasks.get(e.task_id)!.get(e.arm)! + 1);
    const js = await readTolerant(
      root,
      join(root, "judgments", e.id),
      JudgmentRecordSchema,
      (stem) => ({ id: stem, execution_id: e.id }),
      unreadable,
    );
    // RecordStore.judgments order: started_at, then id; the last is latest.
    const j = js.sort(byInstant((x) => x.started_at)).at(-1);
    if (!j) {
      // No judgment: an unvalidated outcome is unknown, never guessed from policy.
      if (refused.has(e.id)) unknown++;
      else if (!outcomePolicy(e.termination, e.did_work).judge) {
        unscoredPolicy++;
      } else awaiting++;
      continue;
    }
    judged++;
    if (j.verdict === "unscored") unscoredVerdict++;
    else if (j.verdict === "pass") pass++;
    else fail++;
  }
  for (const [a, s] of arms) s.mean_wall_ms = mean(walls.get(a)!);

  const planned = c.blocks.length * armIds.length;
  const finished = latest.size;
  const concurrency = flag ?? observedConcurrency(execs);
  const meanAll = mean([...walls.values()].flat());
  return {
    campaign_id: c.id,
    experiment_id: c.experiment.id,
    planned_cells: planned,
    finished_cells: finished,
    judged_cells: judged,
    unscored_cells: unscoredPolicy + unscoredVerdict,
    unscored_policy_cells: unscoredPolicy,
    awaiting_judgment_cells: awaiting,
    unknown_cells: unknown,
    pass_cells: pass,
    fail_cells: fail,
    started: {
      executions: execs.length,
      estimate: true,
      in_flight: null,
      note: "not in results store; counts published executions only",
    },
    executions: { total: execs.length, by_run_kind },
    terminations: Object.fromEntries(terminations),
    arms: Object.fromEntries(arms),
    tasks: Object.fromEntries(
      [...tasks].map(([t, row]) => [t, Object.fromEntries(row)]),
    ),
    tasks_planned: Object.fromEntries(tasksPlanned),
    eta: {
      ms: meanAll === null
        ? null
        : ((planned - finished) * meanAll) / concurrency,
      concurrency,
      source: flag !== undefined ? "flag" : "observed",
      estimate: true,
    },
    unreadable,
  };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const secs = (ms: number | null) =>
  ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`;

export function renderProgress(p: Progress | UnavailableProgress): string {
  if ("campaign_unreadable" in p) {
    return [
      `${colors.cyan("[Progress]")} campaign ${p.campaign_id}`,
      ...p.unreadable.map((u) =>
        `${colors.yellow("[WARN]")} ${
          u === p.campaign_unreadable
            ? "campaign record unreadable, no numbers: "
            : "unreadable "
        }${u.path}: ${u.reason}`
      ),
    ].join("\n");
  }
  const L: string[] = [];
  L.push(
    `${
      colors.cyan("[Progress]")
    } campaign ${p.campaign_id} (experiment ${p.experiment_id})`,
  );
  L.push(
    `${
      colors.cyan("[Cells]")
    } planned ${p.planned_cells}, finished ${p.finished_cells}, judged ${p.judged_cells} (pass ${p.pass_cells}, fail ${p.fail_cells}), unscored ${p.unscored_cells} (${p.unscored_policy_cells} by policy), awaiting judgment ${p.awaiting_judgment_cells}, unknown ${p.unknown_cells}`,
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
      `${colors.cyan("[Arm]")} ${a}: ${s.finished}/${s.planned} cells, ${
        s.cost_missing > 0
          ? `estimated cost ${usd(s.cost_usd)} (${s.cost_missing} without cost)`
          : `estimated cost ${usd(s.cost_usd)}`
      }${
        s.reported_cost_usd === null
          ? ""
          : `, reported cost ${usd(s.reported_cost_usd)}`
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
