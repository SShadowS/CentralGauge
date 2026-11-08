/**
 * Campaign runner (spec 1a sections 6 and 8; M1-23). A campaign fixes the
 * arms (resolved manifests with image ids), the task identities and a seeded
 * block plan; `harness run` resumes the newest campaign whose experiment,
 * task set and arm manifests are unchanged, and otherwise starts a new one.
 * No historical reuse (`reuse` stays empty). Cells run in block order;
 * retries are decided by ancestry (retryChains + retryProblem on the cell's
 * stored executions), never by label. A usage limit pauses the campaign; a
 * sandbox whose termination is not confirmed stops it (the intent is kept and
 * the next run recovers it before planning).
 */

import * as colors from "@std/fmt/colors";
import { exists } from "@std/fs";
import { join, relative } from "@std/path";
import { globToRegExp } from "@std/path/posix";
import type { Catalog } from "../ingest/catalog/read.ts";
import type { AttemptRef, CellRef, HarnessEnv } from "./execution.ts";
import type { BcEgressRecord } from "./environment.ts";
import type { PriorExecution } from "./estimate.ts";
import type { CampaignRecords } from "./integrity.ts";
import type { RefappRef } from "./identity.ts";
import type { LoadedTask } from "./task.ts";
import type { HarnessConfig } from "./config.ts";
import type { JudgeGate } from "./pool.ts";
import { ConfigurationError } from "../errors.ts";
import { PoolLostError } from "./bc-lane.ts";
import { secretFilesOf } from "./adapter.ts";
import { adapterFor } from "./adapters/mod.ts";
import { proxyIsolationProblem } from "./egress.ts";
import { PROXY_ISOLATION } from "./egress-proxy.ts";
import { estimateArms, renderEstimate } from "./estimate.ts";
import { loadExperiment } from "./config.ts";
import {
  checkAccountsSecrets,
  judgeDeferred,
  judgmentOwed,
  pickAccount,
  recoverInterrupted,
  runCell,
} from "./execution.ts";
import { loadSymbolsLock, resolveRefapp, taskSetIdentity } from "./identity.ts";
import { descriptorLoader, storeOraclePreimage } from "./task-oracle.ts";
import {
  imageFacts,
  imageTag,
  runtimeFacts,
  serverDefinitions,
} from "./images.ts";
import { validateCampaignRecords } from "./integrity.ts";
import { manifestHash, resolveManifest } from "./manifest.ts";
import { campaignJudging, cellsFromRecords } from "./outcome.ts";
import { currentScorerFingerprint } from "./verdict.ts";
import { verifyPrereg } from "./prereg.ts";
import {
  type AccountAddition,
  AccountAdditionSchema,
  accountPool,
  type AccountRetirement,
  AccountRetirementSchema,
  type ArtifactRecord,
  type Block,
  type CampaignRecord,
  CampaignRecordSchema,
  compareInstant,
  type ExecutionRecord,
  experimentHash,
  type JudgmentRecord,
  liveAccountPool,
  outcomePolicy,
  planBlocks,
  type RecordStore,
  retryChains,
  retryProblem,
} from "./records.ts";
import { loadTask, loadTaskSet } from "./task.ts";

export interface RunOptions {
  /** Run only the first N blocks of the selected plan (repeat-major). */
  sample?: number;
  /** Run only blocks with repeat <= N (default: the experiment's repeats). */
  repeats?: number;
  dryRun: boolean;
  /** Cells run at once (answer 17: default 1). */
  concurrency: number;
  /** H-09: judgments run at once (default: one per judge container). */
  judgeConcurrency?: number;
  /** Seed of a new campaign (default random); a resumed campaign keeps its own. */
  seed?: number;
  /** Longest usage-limit pause to wait out; 0 stops with a resume line. */
  maxPauseMs: number;
  /** Any of these present stops the campaign before its next cell. */
  stopFiles?: string[];
  /** Graceful stop of the environment (OpenEnv.stopRequested): checked with the stop files. */
  stopRequested?: () => Promise<boolean>;
  /** Resume exactly this campaign; refused when it no longer matches, never created. */
  campaign?: string;
  /** Run exactly this unscored cell again as a manual_rerun; nothing else runs. */
  rerun?: { task: string; repeat: number; arm: string };
  /** H-62: further cells to rerun in the same invocation (with `rerun`, after it). */
  reruns?: { task: string; repeat: number; arm: string }[];
  /** M11-10: the stage-A decision file; required with a preregistration. */
  preregDecision?: string;
  /** M11-10: the stage-B decision file; required with a preregistration. */
  preregBDecision?: string;
  /**
   * H-15 owner override: the reason. Retries owed to usage resets recorded
   * before this invocation run now; a limit hit during it still pauses.
   */
  ignoreUsageReset?: string;
  /**
   * H-53: a resume whose --secrets-dir labels extend the campaign's pool
   * records this addition (`--add-accounts-reason`, `--added-by`).
   */
  addAccounts?: { reason: string; by: string };
}

export interface CampaignSummary {
  /** null only for a dry run that would create a new campaign. */
  campaignId: string | null;
  created: boolean;
  /** Cells (block x arm) in the selected plan. */
  planned: number;
  /** Executions run by this invocation. */
  ran: number;
  /** Of those, judged pass or fail. */
  judged: number;
  /** Of those, judged unscored, or not judged and no longer owed a judgment. */
  unscored: number;
  /** Usage-limit reset (or "unknown") when the campaign stopped paused. */
  paused: string | null;
  /** A stop file stopped the campaign before its next cell. */
  stopped: boolean;
  /**
   * H-41 (9, 14): the `auto` judge queue starved (no member for the wait
   * bound) or stopped on an execution's unanswered-container bound; the CLI
   * exits 75.
   */
  starved?: boolean;
  /**
   * H-41: when starved, the campaign's executions still owed a judgment;
   * otherwise (R1-L1) those run now still owed one (another judge holds
   * its claim), absent when none.
   */
  owed?: number;
  /** R-08: containers quarantined during this invocation (absent when none). */
  quarantined?: number;
  /** R-08: members / joined containers of the lane of the latest quarantine. */
  poolSize?: number;
  poolTotal?: number;
}

export interface RunIO {
  log(line: string): void;
  sleep(ms: number): Promise<void>;
  catalog: Catalog;
}

/** The tasks and refapp refs a campaign's cells need, opened once. */
export interface OpenedTasks {
  tasks: Map<string, LoadedTask>;
  refapps: Map<string, RefappRef>;
}

export function cellRefFor(
  c: CampaignRecord,
  opened: OpenedTasks,
  block: Block,
  arm: string,
  orderInBlock: number,
): CellRef {
  const task = opened.tasks.get(block.task_id);
  const id = c.task_set.tasks.find((t) => t.id === block.task_id);
  const a = c.arms.find((x) => x.config_id === arm);
  if (!task || !id || !a) {
    throw new ConfigurationError(
      `campaign ${c.id}: block ${block.index} names task ${block.task_id} / arm ${arm} it does not hold`,
    );
  }
  return {
    campaignId: c.id,
    block,
    orderInBlock,
    arm,
    armManifest: a.manifest,
    armManifestHash: a.manifest_hash,
    task,
    taskVisibleHash: id.visible,
    oracleHash: id.oracle,
    refapp: opened.refapps.get(task.task.refapp_version)!,
  };
}

export async function loadCampaignData(
  store: RecordStore,
  c: CampaignRecord,
): Promise<CampaignRecords> {
  const executions = await store.executions(c.id);
  const retirements = await store.accountRetirements(c.id);
  const artifacts: ArtifactRecord[] = [];
  const judgments: JudgmentRecord[] = [];
  for (const e of executions) {
    const a = await store.artifact(e.id);
    if (a) artifacts.push(a);
    judgments.push(...await store.judgments(e.id));
  }
  return {
    campaign: c,
    executions,
    artifacts,
    judgments,
    ...(retirements.length > 0 ? { retirements } : {}),
  };
}

/**
 * H-61: retire an account label from a campaign's pool (explicit; the only
 * way a label leaves). The campaign must be labelled, the label live in its
 * effective pool, and two other labels must remain.
 */
export async function retireAccount(
  store: RecordStore,
  o: {
    campaign: string;
    label: string;
    reason: string;
    by: string;
    now?: () => Date;
  },
): Promise<AccountRetirement> {
  const c = await store.campaignById(o.campaign);
  if (!c) throw new ConfigurationError(`no campaign ${o.campaign}`);
  if (!c.accounts) {
    throw new ConfigurationError(
      `campaign ${c.id} is unlabelled (one --secrets-dir): it has no account to retire`,
    );
  }
  const retirements = await store.accountRetirements(c.id);
  const live = liveAccountPool(
    c,
    await store.accountAdditions(c.id),
    retirements,
  )!;
  if (retirements.some((r) => r.label === o.label)) {
    throw new ConfigurationError(
      `account ${o.label} is already retired from campaign ${c.id}`,
    );
  }
  if (!live.includes(o.label)) {
    throw new ConfigurationError(
      `account ${o.label} is not in campaign ${c.id}'s pool [${
        live.join(", ")
      }]`,
    );
  }
  // Two live labels stay: one alone would run unpooled, with no recorded
  // account-wide parks (H-53) and no account_choice.
  if (live.length < 3) {
    throw new ConfigurationError(
      `campaign ${c.id} has ${live.length} live account(s) [${
        live.join(", ")
      }]: retiring ${o.label} would leave fewer than 2`,
    );
  }
  const r = AccountRetirementSchema.parse({
    v: 1,
    campaign_id: c.id,
    label: o.label,
    by: o.by,
    at: (o.now ?? (() => new Date()))().toISOString(),
    reason: o.reason,
  });
  await store.writeAccountRetirement(r);
  return r;
}

/**
 * The next attempt a cell is owed, by ancestry: planned when it has none;
 * otherwise an automatic retry of the newest chain's last execution when
 * its outcome allows one (retryProblem), else nothing (the cell is done).
 */
/**
 * H-09: the campaign's judge queue, `width` judgments at once on the judge
 * lane. The first failure is kept: no new judgment starts, the agents start
 * no new cell, and drain() throws it once the running judgments ended.
 * H-33: stop() (an interrupt) also admits nothing new; drain() then waits
 * for the running judgments only.
 * H-41 (9, 14): gated on an `auto` pool, the width is the pool's members
 * now; it refreshes after each settle, on push and on the pool's poll. With
 * no member and work queued for the pool's wait bound (its own timer) it
 * starves: stopped, the refresh aborted, the epoch bumped. A PoolLostError
 * requeues W unchanged; W's 4th unanswered-only loss stops the queue
 * instead. drain() never waits on a pending refresh or setup.
 */
export function judgeQueue(
  env: HarnessEnv,
  width: number | JudgeGate,
  judge: (env: HarnessEnv, cell: CellRef, e: ExecutionRecord) => Promise<
    unknown
  > = judgeDeferred,
  /** H-41: --judge-concurrency over a gated width. */
  limit = Infinity,
) {
  const gate = typeof width === "number" ? null : width;
  const cap = () => Math.min(gate ? gate.width() : width as number, limit);
  type Job = { cell: CellRef; e: ExecutionRecord; uncertain: number };
  const jobs: Job[] = [];
  const idle: (() => void)[] = [];
  let active = 0;
  let failure: { err: unknown } | null = null;
  let stopped = false;
  let starved = false;
  let uncertain: { id: string; checks: number } | null = null;
  let told = false;
  let polling = false;
  let refreshing = false;
  let starve: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const settled = () =>
    active === 0 && (jobs.length === 0 || stopped || failure !== null);
  const wake = () => {
    if (!settled()) return;
    if (uncertain && !told) {
      told = true;
      console.log(
        `[STOP] ${uncertain.id}: ${uncertain.checks} unanswered container checks; ${jobs.length} stay owed`,
      );
    }
    for (const f of idle.splice(0)) f();
  };
  const starveNow = () => {
    starve = undefined;
    // A member being admitted right now is not "no member": the refresh's
    // own finally runs pump(false), which re-arms this timer if it joined none.
    if (refreshing) return;
    if (
      !gate || stopped || failure !== null || active > 0 ||
      jobs.length === 0 || gate.width() > 0
    ) {
      return pump();
    }
    starved = stopped = true;
    abort.abort();
    gate.invalidate();
    console.log(
      `[STOP] judging pool: no member for ${
        gate.bounds.waitMs / 60_000
      } min; ${jobs.length} stay owed`,
    );
    pump();
  };
  const start = (job: Job) => {
    active++;
    judge(env, job.cell, job.e)
      .catch((err) => {
        if (!(err instanceof PoolLostError)) return void (failure ??= { err });
        // W again, unchanged (no fence, its claim released by judgeOnce).
        if (err.unansweredOnly) job.uncertain++;
        if (job.uncertain > MAX_UNCERTAIN_REQUEUES && !stopped) {
          uncertain = { id: job.e.id, checks: job.uncertain };
          stopped = true;
        }
        jobs.push(job);
      })
      .finally(() => {
        active--;
        pump();
      });
  };
  const pump = (refresh = true) => {
    while (failure === null && !stopped && active < cap() && jobs.length > 0) {
      start(jobs.shift()!);
    }
    if (gate) {
      const want = failure === null && !stopped && jobs.length > 0;
      if (want !== polling) {
        polling = want;
        gate.poll(want ? () => pump() : null);
      }
      if (want && refresh && !refreshing) {
        refreshing = true;
        void gate.refresh(abort.signal).finally(() => {
          refreshing = false;
          pump(false);
        });
      }
      const empty = want && active === 0 && gate.width() === 0;
      if (empty && starve === undefined) {
        starve = setTimeout(starveNow, gate.bounds.waitMs);
      } else if (!empty && starve !== undefined) {
        clearTimeout(starve);
        starve = undefined;
      }
    }
    wake();
  };
  return {
    push(cell: CellRef, e: ExecutionRecord) {
      jobs.push({ cell, e, uncertain: 0 });
      pump();
    },
    failed: () => failure !== null,
    /** H-41: starved, or stopped by W's unanswered-container bound (exit 75). */
    starved: () => starved || uncertain !== null,
    stop() {
      stopped = true;
      pump(false);
    },
    async drain() {
      if (!settled()) await new Promise<void>((r) => idle.push(r));
      if (failure !== null) throw failure.err;
    },
  };
}

/** H-41 (14, R4-M1): unanswered-only pool losses requeue one W at most this often. */
export const MAX_UNCERTAIN_REQUEUES = 3;

/** H-09: an explicit --judge-concurrency is a positive integer (unset: one per judge container). */
export function checkJudgeConcurrency(n: number | undefined): void {
  if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
    throw new ConfigurationError(
      `judge concurrency must be a positive integer: ${n}`,
    );
  }
}

// H-09 judgmentOwed; H-41: in execution.ts, the commit protocol's due predicate.
export { judgmentOwed };

export function nextAttempt(prior: ExecutionRecord[]): AttemptRef | null {
  if (prior.length === 0) {
    return { attempt: 1, runKind: "planned", retryOf: null };
  }
  const newest = retryChains(prior).chains.map((ch) => ch.members)
    .sort((a, b) => b.at(-1)!.attempt - a.at(-1)!.attempt)[0];
  if (!newest) return null;
  const tail = newest.at(-1)!;
  if (outcomePolicy(tail.termination, tail.did_work).retry === "none") {
    return null;
  }
  const next: AttemptRef = {
    attempt: tail.attempt + 1,
    runKind: "auto_retry",
    retryOf: tail.id,
    // H-15: a chain run past an ignored reset keeps its provenance, never
    // across a newly hit limit (as in runCell).
    ...(tail.usage_reset_ignored && tail.termination !== "usage_limited"
      ? { usageResetIgnored: tail.usage_reset_ignored }
      : {}),
  };
  const candidate: ExecutionRecord = {
    ...tail,
    id: "(next automatic retry)",
    attempt: next.attempt,
    run_kind: "auto_retry",
    retry_of: tail.id,
  };
  return retryProblem(tail, candidate, newest.at(-2)) ? null : next;
}

/**
 * The persisted reset of a usage-limited execution (its published
 * sandbox.json), or null: not usage-limited, or the reset is unknown (a
 * restart is then the operator's retry, as before M1-23 run 002).
 */
async function pendingReset(
  env: HarnessEnv,
  e: ExecutionRecord,
): Promise<string | null> {
  if (e.termination !== "usage_limited") return null;
  const side = JSON.parse(
    await Deno.readTextFile(
      join(env.resultsRoot, "runs", e.id, "sandbox.json"),
    ),
  ) as { usage_reset_at?: string | null };
  return side.usage_reset_at ?? null;
}

/** The later of two resets; "unknown" wins (it cannot be waited out). */
function laterReset(a: string | null, b: string): string {
  if (a === null) return b;
  if (a === "unknown" || b === "unknown") return "unknown";
  return compareInstant(a, b) >= 0 ? a : b;
}

/** What a dry run reads: no lane, backend or container is opened. */
export type PlanEnv =
  & Pick<
    HarnessEnv,
    | "repoRoot"
    | "harnessRoot"
    | "resultsRoot"
    | "store"
    | "docker"
    | "symbols"
    | "egressEnforced"
  >
  & Pick<
    Partial<HarnessEnv>,
    "now" | "proxyIsolation" | "unverifiedEgressReason" | "secretAccounts"
  >
  & {
    /**
     * The verified marker places sandboxes (a plan env has no egress runtime
     * to show it). With proxyIsolation, this is what the concurrency gate
     * sees on a dry run, the same inputs as the real environment's.
     */
    egressPlaced?: boolean;
    /** H-35 S3 L2b: the lineage's NST egress, statically admitted (a plan env has no deploy). */
    bcEgress?: BcEgressRecord | null;
  };

/** A dry run: the plan and the egress refusal, without a lock or containers. */
export function planCampaign(
  env: PlanEnv,
  experimentId: string,
  o: Omit<RunOptions, "dryRun">,
  io: RunIO,
): Promise<CampaignSummary> {
  // runCampaign returns before any field outside PlanEnv is read when dryRun is set.
  return runCampaign(
    env as HarnessEnv,
    experimentId,
    { ...o, dryRun: true },
    io,
  );
}

/**
 * Most blocks that may share a placed environment's proxy at once. Owner
 * decision 2026-10-03 (decisions/2026-10-03-m7-concurrency.md, Option A):
 * concurrency 2; raising it is a separate decision.
 */
export const MAX_PLACED_CONCURRENCY = 2;

/**
 * The first image revision per harness that runs the agent as ContainerUser
 * (non-admin). H-01 (decisions/2026-10-02-h-01-image-revision.md; accepted
 * 2026-10-03-h-01-accepted.md): claude-code and pi r2 (image_revision), mock 2
 * (its real harness_version). ContainerAdministrator images (the frozen tags
 * without a revision) can spoof a sibling's IP (P2), so concurrent placed
 * cells may only run revisions at or above these.
 */
export const H01_CONTAINER_USER_REVISION: Readonly<Record<string, number>> = {
  "claude-code": 2,
  pi: 2,
  mock: 2,
};

/**
 * Concurrent placed cells need the conditions below; each failure is named.
 * Concurrency 1 is not gated here.
 */
export const PLACED_CONCURRENCY_REFUSAL =
  `--concurrency > 1 is refused while the egress marker places sandboxes unless ALL hold: concurrency <= ${MAX_PLACED_CONCURRENCY} (M7); the egress marker's proxy isolation version is exactly ${PROXY_ISOLATION} (M1-33e); egress is enforced (authorized marker); every arm runs an image at or above its H-01 ContainerUser revision (a frozen tag without image_revision is a ContainerAdministrator image); otherwise run with --concurrency 1`;

/** What the concurrency gate needs of an environment (runCampaign and the CLI both build it). */
export interface PlacedGate {
  /** Egress places sandboxes or is enforced. */
  placed: boolean;
  /** Egress is enforced (authorized marker). */
  enforced: boolean;
  /** The marker's proxy_isolation (missing is undefined). */
  proxyIsolation: unknown;
}

/** The gate's view of a campaign environment. */
export const placedGateOf = (
  env:
    & Pick<HarnessEnv, "egressEnforced" | "proxyIsolation">
    & Pick<Partial<HarnessEnv>, "egress">
    & Pick<PlanEnv, "egressPlaced">,
): PlacedGate => ({
  placed: env.egress !== undefined || env.egressEnforced ||
    env.egressPlaced === true,
  enforced: env.egressEnforced,
  proxyIsolation: env.proxyIsolation,
});

/**
 * Why concurrency above 1 is refused in a placed or enforced environment, or
 * null when every condition holds. Image checks need the loaded configs and
 * are skipped (not passed) when `configs` is undefined: call again with them.
 */
export function placedConcurrencyProblem(
  env: PlacedGate,
  concurrency: number,
  configs?: readonly HarnessConfig[],
): string | null {
  if (concurrency <= 1) return null;
  if (!env.placed) return null;
  if (concurrency > MAX_PLACED_CONCURRENCY) {
    return `concurrency ${concurrency} exceeds the placed maximum ${MAX_PLACED_CONCURRENCY}`;
  }
  const p = proxyIsolationProblem(env.proxyIsolation, concurrency);
  if (p) return `egress marker ${p}`;
  if (!env.enforced) {
    return "egress is placed but not enforced (no authorized marker)";
  }
  for (const c of configs ?? []) {
    const min = Object.hasOwn(H01_CONTAINER_USER_REVISION, c.harness)
      ? H01_CONTAINER_USER_REVISION[c.harness]
      : undefined;
    if (min === undefined) {
      return `arm ${c.id}: harness ${c.harness} has no H-01 ContainerUser revision`;
    }
    // mock's revision is its harness_version (H-01: mock 1 -> 2), whatever
    // image_revision says; every other harness's is image_revision.
    const revs = c.harness === "mock"
      ? [c.harness_version, ...(c.image_revision ? [c.image_revision] : [])]
      : [c.image_revision];
    for (const rev of revs) {
      if (rev === undefined) {
        return `arm ${c.id}: ${c.harness} ${c.harness_version} is a frozen image without image_revision (ContainerAdministrator); needs revision >= ${min}`;
      }
      if (!/^[1-9][0-9]*$/.test(rev) || Number(rev) < min) {
        return `arm ${c.id}: ${c.harness} image revision ${rev} is below the H-01 ContainerUser revision ${min}`;
      }
    }
  }
  return null;
}

/**
 * The concurrency refusal for `problem` (from placedConcurrencyProblem). Without
 * one (the CLI's up-front check, which cannot see the arm images) the
 * proxy_isolation gate's finding (M1-33e) leads when the marker's value is not
 * exactly PROXY_ISOLATION.
 */
export function placedConcurrencyRefusal(
  proxyIsolation: unknown,
  concurrency: number,
  problem?: string,
): ConfigurationError {
  const p = problem ??
    (() => {
      const q = proxyIsolationProblem(proxyIsolation, concurrency);
      return q ? `egress marker ${q}` : null;
    })();
  return new ConfigurationError(
    p ? `${p}; ${PLACED_CONCURRENCY_REFUSAL}` : PLACED_CONCURRENCY_REFUSAL,
  );
}

function judgmentsByExecution(
  data: CampaignRecords,
): Map<string, JudgmentRecord[]> {
  const byExecution = new Map<string, JudgmentRecord[]>();
  for (const j of data.judgments) {
    byExecution.set(j.execution_id, [
      ...(byExecution.get(j.execution_id) ?? []),
      j,
    ]);
  }
  return byExecution;
}

type RerunCell = NonNullable<RunOptions["rerun"]>;
type RerunItem = {
  r: RerunCell;
  key: string;
  block: Block;
  at: AttemptRef;
  i: number;
};
const rerunKey = (r: RerunCell) => `${r.task}:${r.repeat}:${r.arm}`;

const skipReason = (status: string) =>
  `cell is ${status} now${
    status === "pending" ? " (a plain resume runs its owed retry)" : ""
  }`;

/** The status of a listed cell that is not unscored but already holds a manual_rerun; else null. */
function rerunDoneStatus(
  c: CampaignRecord,
  data: CampaignRecords,
  r: RerunCell,
  scorer: string,
): string | null {
  const block = c.blocks.find((b) =>
    b.task_id === r.task && b.repeat === r.repeat && b.order.includes(r.arm)
  );
  if (
    !block ||
    !data.executions.some((e) =>
      e.block === block.index && e.arm === r.arm &&
      e.run_kind === "manual_rerun"
    )
  ) return null;
  const status = rerunCellStatus(c, data, r, scorer);
  return status === "unscored" ? null : status;
}

/** The cell's status as the report shows it. */
function rerunCellStatus(
  c: CampaignRecord,
  data: CampaignRecords,
  r: RerunCell,
  scorer: string,
) {
  return cellsFromRecords(
    c,
    data.executions,
    judgmentsByExecution(data),
    { ...campaignJudging(c), scorer },
  ).find((x) => x.task === r.task && x.repeat === r.repeat && x.arm === r.arm)!
    .status;
}

/**
 * A manual rerun's cell and attempt: only an unscored cell is rerun (a
 * manual rerun never replaces a scored result, and a pending or unrun cell
 * is owed its planned or automatic attempt, not a manual one).
 */
function rerunTarget(
  c: CampaignRecord,
  data: CampaignRecords,
  r: NonNullable<RunOptions["rerun"]>,
  /** H-04b: the current scorer fingerprint, so a rejudge-budget cell reads as the report shows it. */
  scorer: string,
): { block: Block; at: AttemptRef; prior: ExecutionRecord[] } {
  const label = rerunKey(r);
  const block = c.blocks.find((b) =>
    b.task_id === r.task && b.repeat === r.repeat && b.order.includes(r.arm)
  );
  if (!block) {
    throw new ConfigurationError(`no such cell ${label} in campaign ${c.id}`);
  }
  const status = rerunCellStatus(c, data, r, scorer);
  if (status !== "unscored") {
    throw new ConfigurationError(
      `cell ${label} is ${status}: only an unscored cell is rerun (a manual rerun never replaces a scored result)`,
    );
  }
  const prior = data.executions.filter((e) =>
    e.block === block.index && e.arm === r.arm
  );
  return {
    block,
    at: {
      attempt: Math.max(...prior.map((e) => e.attempt)) + 1,
      runKind: "manual_rerun",
      retryOf: null,
    },
    prior,
  };
}

/**
 * Estimate lines for a dry run: outstanding cells (unrun or pending) of the
 * selected blocks per arm, priced from every stored execution of the same
 * arm manifest. verdict_ms is the first judgment's own ended_at - started_at.
 */
async function dryRunEstimate(
  store: RecordStore,
  c: CampaignRecord,
  data: CampaignRecords | null,
  blocks: Block[],
): Promise<string[]> {
  const selected = new Set(blocks.map((b) => `${b.task_id}#${b.repeat}`));
  const outstanding = new Map<string, number>();
  if (data) {
    const byExecution = judgmentsByExecution(data);
    const judging = {
      ...campaignJudging(c),
      scorer: await currentScorerFingerprint(),
    };
    for (
      const cell of cellsFromRecords(c, data.executions, byExecution, judging)
    ) {
      if (
        selected.has(`${cell.task}#${cell.repeat}`) &&
        (cell.status === "unrun" || cell.status === "pending")
      ) outstanding.set(cell.arm, (outstanding.get(cell.arm) ?? 0) + 1);
    }
  } else {
    for (const b of blocks) {
      for (const arm of b.order) {
        outstanding.set(arm, (outstanding.get(arm) ?? 0) + 1);
      }
    }
  }
  const ms = (from: string, to: string) => Date.parse(to) - Date.parse(from);
  const prior: PriorExecution[] = [];
  for (const e of await store.allExecutions()) {
    const first = (await store.judgments(e.id))[0];
    prior.push({
      arm_manifest_hash: e.arm_manifest_hash,
      cell: `${e.campaign_id}:${e.task_id}#${e.repeat}`,
      exec_ms: ms(e.started_at, e.ended_at),
      verdict_ms: first ? ms(first.started_at, first.ended_at) : null,
      list_cost_usd: e.telemetry.cost_usd,
      paid_cost_usd: e.telemetry.reported_cost_usd,
    });
  }
  return renderEstimate(estimateArms(
    c.arms.map((a) => ({
      arm: a.config_id,
      manifest_hash: a.manifest_hash,
      // ponytail: provider prefix as the paid flag; add a config field if a paid non-OpenRouter route appears
      paid: Object.values(a.manifest.models).some((m) =>
        m.startsWith("openrouter/")
      ),
      outstanding_cells: outstanding.get(a.config_id) ?? 0,
    })),
    prior,
  ));
}

/** The tasks an experiment's pattern selects; none is refused. */
export async function experimentTasks(
  repoRoot: string,
  experimentId: string,
  experiment: CampaignRecord["experiment"],
): Promise<LoadedTask[]> {
  const pattern = globToRegExp(experiment.tasks, { globstar: true });
  const tasks = (await loadTaskSet(join(repoRoot, "harness-tasks", "tasks")))
    .filter((t) =>
      pattern.test(relative(repoRoot, t.dir).replaceAll("\\", "/"))
    );
  if (tasks.length === 0) {
    throw new ConfigurationError(
      `experiment ${experimentId}: tasks pattern ${experiment.tasks} matches no task`,
    );
  }
  return tasks;
}

/** The fields of a stored campaign that differ from the current ones; arms omitted are not compared. */
function campaignDrift(
  x: CampaignRecord,
  cur: {
    expHash: string;
    identity: string;
    arms?: {
      config_id: string;
      manifest_hash: string;
      parser?: string | undefined;
    }[];
  },
): string[] {
  const stored = (id: string) => x.arms.find((y) => y.config_id === id);
  return [
    ...(x.experiment_hash === cur.expHash ? [] : ["experiment_hash"]),
    ...(x.task_set.identity === cur.identity ? [] : ["task_set.identity"]),
    ...(!cur.arms ||
        cur.arms.every((a) =>
          x.arms.find((y) => y.config_id === a.config_id)?.manifest_hash ===
            a.manifest_hash
        )
      ? []
      : ["arms[].manifest_hash"]),
    // M5-07a: a parse under another parser version is not the campaign's; a
    // campaign that recorded none (before M5-07a) is refused, never assumed.
    ...(!cur.arms ||
        cur.arms.every((a) =>
          a.parser !== undefined &&
          stored(a.config_id)?.parser === a.parser
        )
      ? []
      : ["arms[].parser"]),
  ];
}

function pinned(
  campaigns: CampaignRecord[],
  experimentId: string,
  id: string,
): CampaignRecord {
  const named = campaigns.find((x) => x.id === id);
  if (!named) {
    throw new ConfigurationError(
      `no campaign ${id} for experiment ${experimentId}`,
    );
  }
  return named;
}

function refuseDrift(c: CampaignRecord, differs: string[]): void {
  if (differs.length > 0) {
    throw new ConfigurationError(
      `campaign ${c.id} does not match the current experiment: ${
        differs.join(", ")
      } differ`,
    );
  }
}

/**
 * The `--campaign` pin checked read-only, before any lock, sweep, recovery
 * or docker call: the campaign exists, and its experiment_hash and
 * task_set.identity match the repo's (with the symbols lock; without one the
 * open refuses anyway). arms[].manifest_hash needs image facts (docker), so
 * only runCampaign checks it, together with all of this again, under the env.
 */
export async function precheckCampaignPin(
  repoRoot: string,
  store: RecordStore,
  experimentId: string,
  campaignId: string,
): Promise<void> {
  const named = pinned(
    await store.campaigns(experimentId),
    experimentId,
    campaignId,
  );
  const symbols = await loadSymbolsLock(repoRoot);
  if (!symbols) return;
  const { experiment } = await loadExperiment(
    join(repoRoot, "harness"),
    experimentId,
  );
  const ids = await taskSetIdentity(
    repoRoot,
    await experimentTasks(repoRoot, experimentId, experiment),
    symbols,
  );
  refuseDrift(
    named,
    campaignDrift(named, {
      expHash: await experimentHash(experiment),
      identity: ids.identity,
    }),
  );
}

export async function runCampaign(
  env: HarnessEnv,
  experimentId: string,
  o: RunOptions,
  io: RunIO,
): Promise<CampaignSummary> {
  // R-08 Sol run 001 P2: the quarantine hooks this invocation installs end
  // with it; each lane gets its previous callback back, so a later runCell or
  // command on the same env never writes into this campaign's log or summary.
  const lanes = [...new Set([env.lane, env.judgeLane])].filter((l) => !!l);
  const previous = lanes.map((l) => l.onQuarantine);
  try {
    return await campaignInvocation(env, experimentId, o, io);
  } finally {
    lanes.forEach((l, i) => (l.onQuarantine = previous[i]));
  }
}

async function campaignInvocation(
  env: HarnessEnv,
  experimentId: string,
  o: RunOptions,
  io: RunIO,
): Promise<CampaignSummary> {
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) {
    throw new ConfigurationError(
      `concurrency must be a positive integer: ${o.concurrency}`,
    );
  }
  checkJudgeConcurrency(o.judgeConcurrency);
  // H-15 owner override (decisions/2026-10-15-p-01-egress-override.md).
  const ignoreReset = o.ignoreUsageReset?.trim();
  if (ignoreReset === "") {
    throw new ConfigurationError(
      "--ignore-usage-reset needs a non-empty reason",
    );
  }
  const addAccounts = o.addAccounts
    ? { reason: o.addAccounts.reason.trim(), by: o.addAccounts.by.trim() }
    : undefined;
  if (addAccounts && (addAccounts.reason === "" || addAccounts.by === "")) {
    throw new ConfigurationError(
      "--add-accounts-reason and --added-by both need non-empty text",
    );
  }
  // H-53: a pool moves a limited cell's retry to another label at once.
  if (ignoreReset !== undefined && (env.secretAccounts?.length ?? 0) > 1) {
    throw new ConfigurationError(
      "--ignore-usage-reset is for a single-account campaign: an account pool moves the retry to another label",
    );
  }
  if (ignoreReset !== undefined) {
    io.log(
      `[WARN] usage resets recorded before this run are ignored (owner override --ignore-usage-reset): ${ignoreReset}`,
    );
  }
  // A placed environment without env.proxyIsolation is missing (fail closed).
  // The cheap conditions first, before any read; the arm images below.
  const early = placedConcurrencyProblem(
    placedGateOf(env),
    o.concurrency,
  );
  if (early) {
    throw placedConcurrencyRefusal(env.proxyIsolation, o.concurrency, early);
  }
  const rerunCells = [...(o.rerun ? [o.rerun] : []), ...(o.reruns ?? [])];
  if (rerunCells.length === 0 && o.reruns !== undefined) {
    throw new ConfigurationError("--rerun names no cell");
  }
  if (
    rerunCells.length > 0 && (o.sample !== undefined || o.repeats !== undefined)
  ) {
    throw new ConfigurationError(
      rerunCells.length === 1
        ? "--rerun runs one cell: --sample and --repeats do not apply"
        : "--rerun runs only the named cells: --sample and --repeats do not apply",
    );
  }
  const seenCells = new Set<string>();
  for (const r of rerunCells) {
    if (seenCells.has(rerunKey(r))) {
      throw new ConfigurationError(`--rerun names cell ${rerunKey(r)} twice`);
    }
    seenCells.add(rerunKey(r));
  }
  const { experiment, configs } = await loadExperiment(
    env.harnessRoot,
    experimentId,
  );
  // H-02 (orchestrator ruling): the codex arm holds one ChatGPT credential, so
  // it runs with a single account; every account's copy would expire on its own.
  const accounts = env.secretAccounts?.length ?? 0;
  for (const c of accounts > 1 ? configs : []) {
    if (c.harness !== "pi") continue; // the codex route is pi's only
    const routes = Object.values(adapterFor(c.harness).providerRoutes(c));
    if (routes.includes("openai-codex:oauth")) {
      throw new ConfigurationError(
        `${c.id} runs on openai-codex:oauth with one --secrets-dir account, not ${accounts}`,
      );
    }
  }
  // Every arm's image, before any recovery, record or cell (new run and resume).
  const armProblem = placedConcurrencyProblem(
    placedGateOf(env),
    o.concurrency,
    configs,
  );
  if (armProblem) {
    throw placedConcurrencyRefusal(
      env.proxyIsolation,
      o.concurrency,
      armProblem,
    );
  }
  // Egress decision: a campaign runs unattended, so supervised campaigns do
  // not exist; a credential-bearing arm needs verified enforcement.
  const bearing = configs.filter((c) => adapterFor(c.harness).credentialBearing)
    .map((c) => c.id);
  // H-13 owner override (decisions/2026-10-15-p-01-egress-override.md).
  const override = env.unverifiedEgressReason;
  // H-35 S3 L2b: the judging lineage's NST egress override, if any (a dry
  // run's plan environment carries it as bcEgress, having no deploy).
  const bcOverride =
    (env.deploy?.bcEgress ?? (env as PlanEnv).bcEgress)?.override ||
    undefined;
  // R-02: the ordered labels the campaign pins (null: one unlabelled account).
  const labels = (env.secretAccounts ?? []).map((a) => a.label);
  const accountLabels = labels.some((l) => l !== null)
    ? labels.filter((l): l is string => l !== null)
    : null;
  if (override !== undefined) {
    if (override.trim() === "") {
      throw new ConfigurationError(
        "--unverified-egress-ok needs a non-empty reason",
      );
    }
    if (env.egressEnforced) {
      throw new ConfigurationError(
        "--unverified-egress-ok is refused: egress IS enforced (authorized marker); run without it",
      );
    }
    env = { ...env, unverifiedEgressReason: override.trim() };
    io.log(
      `[WARN] egress NOT enforced (owner override --unverified-egress-ok): ${override.trim()}`,
    );
  }
  if (bearing.length > 0 && !env.egressEnforced && !override) {
    throw new ConfigurationError(
      `${
        bearing.join(", ")
      } carry provider credentials: a campaign runs unattended and needs verified egress enforcement (authorized marker); use harness cell --supervised for a watched run`,
    );
  }
  // Every account dir holds every secret the arms need, before any cell.
  if (!o.dryRun) {
    // H-02: per arm route (a pi codex arm needs the codex file, not the OpenRouter key).
    for (const c of configs) {
      const a = adapterFor(c.harness);
      await checkAccountsSecrets(
        env.secretAccounts,
        secretFilesOf(a, { provider_routes: a.providerRoutes(c) }),
        c.limits.timeout_min,
      );
    }
  }
  let runEnv: HarnessEnv = { ...env, supervised: false };
  // H-15: the executions recorded before this invocation, taken before
  // recovery publishes any; only their resets are ignored, so a limit
  // recorded during this run (recovered or new) still pauses.
  const recordedBefore = new Set(
    ignoreReset === undefined || o.dryRun
      ? []
      : (await env.store.allExecutions()).map((e) => e.id),
  );
  if (!o.dryRun) {
    // Before planning: an interrupted attempt is completed (or stops the run).
    for (const e of await recoverInterrupted(runEnv, loadTask)) {
      io.log(
        `[WARN] recovered interrupted execution ${e.id} (${e.termination})`,
      );
    }
  }

  const tasks = await experimentTasks(env.repoRoot, experimentId, experiment);
  const ids = await taskSetIdentity(env.repoRoot, tasks, env.symbols);
  // H-35 (design-r4 4): every task version a campaign pins stays readable.
  for (const t of tasks) await storeOraclePreimage(env.resultsRoot, t);
  const arms: CampaignRecord["arms"] = [];
  let calibrationWaived = false;
  for (const config of configs) {
    const tag = imageTag(
      config.harness,
      config.harness_version,
      config.image_revision,
    );
    // A dry run opens no container: the shipped MCP definition is read (and
    // checked against its label) only by a real run, before any cell.
    const image = await imageFacts(
      env.docker,
      tag,
      o.dryRun ? null : env.owner,
    );
    if (o.dryRun && image.mcp && Object.keys(image.mcp).length > 0) {
      io.log(
        `[DRY] ${tag}: shipped MCP definition not verified (a real run reads it)`,
      );
    }
    const facts = runtimeFacts(
      config,
      image,
      adapterFor(config.harness),
      io.catalog,
      await serverDefinitions(env.repoRoot, config.components),
    );
    const manifest = await resolveManifest(env.harnessRoot, config, facts);
    // H-03: a tracked campaign image needs its M8-07c calibration (dry run too).
    // H-13b: the owner's egress override waives that level only; level 1
    // (dev qualification) is never waived.
    const adapter = adapterFor(config.harness);
    const why = adapter.unqualified?.(manifest, "campaign");
    if (why) {
      if (!override || adapter.unqualified?.(manifest, "dev")) {
        throw new ConfigurationError(`${config.id}: ${why}`);
      }
      calibrationWaived = true;
      io.log(
        `[WARN] ${config.id}: M8-07c campaign calibration waived (owner override --unverified-egress-ok): ${why}`,
      );
    }
    arms.push({
      config_id: config.id,
      manifest_hash: await manifestHash(manifest),
      manifest,
      parser: adapterFor(config.harness).parser,
    });
  }
  const expHash = await experimentHash(experiment);
  const campaigns = await env.store.campaigns(experimentId);
  const drift = (x: CampaignRecord) =>
    campaignDrift(x, { expHash, identity: ids.identity, arms });
  let c = campaigns.find((x) => drift(x).length === 0);
  if (o.campaign !== undefined) {
    // The pin: exactly the named campaign, unchanged; never a new one.
    const named = pinned(campaigns, experimentId, o.campaign);
    refuseDrift(named, drift(named));
    c = named;
  }
  let created = false;
  let data: CampaignRecords | null = null;
  // M11-10: both decision files are required with a preregistration; checked
  // before any cell, for a new campaign and a resume alike.
  const verify = () => {
    if (!o.preregDecision || !o.preregBDecision) {
      throw new ConfigurationError(
        "--prereg-decision and --prereg-b-decision are required for a pre-registered experiment",
      );
    }
    return verifyPrereg(
      env.repoRoot,
      env.harnessRoot,
      experiment,
      expHash,
      ids.tasks.map((t) => t.id),
      o.preregDecision,
      o.preregBDecision,
    );
  };
  const refusal = (problems: string[]) =>
    new ConfigurationError(
      `preregistration ${experiment.preregistration} refuses a confirmatory campaign:\n  ${
        problems.join("\n  ")
      }`,
    );
  if (!c && rerunCells.length > 0) {
    throw new ConfigurationError(
      `no campaign of experiment ${experimentId} matches the current experiment, task set and arm manifests: --rerun targets an existing campaign`,
    );
  }
  if (!c && addAccounts) {
    throw new ConfigurationError(
      "--add-accounts-reason adds labels to an existing campaign's pool; a new campaign takes its --secrets-dir labels as they are",
    );
  }
  /** H-53: the addition this resume records, after every resume check passes. */
  let addition: AccountAddition | null = null;
  if (!c) {
    if (campaigns.length > 0) {
      io.log(
        `[WARN] experiment, task set or arm manifests changed since campaign ${
          campaigns[0]!.id
        }: starting a new campaign`,
      );
    }
    let preregistration:
      | {
        path: string;
        sha256: string;
        protocol_sha256: string;
        decision_sha256: string;
        stage_b_decision_sha256: string;
      }
      | undefined;
    if (experiment.preregistration) {
      const v = await verify();
      if (v.problems.length > 0) throw refusal(v.problems);
      // Bound to the externally approved stage-B bytes and both decision files.
      preregistration = {
        path: experiment.preregistration,
        sha256: v.sha256,
        protocol_sha256: v.protocol_sha256,
        decision_sha256: v.decision_sha256,
        stage_b_decision_sha256: v.stage_b_decision_sha256,
      };
    }
    const seed = o.seed ??
      crypto.getRandomValues(new Uint32Array(1))[0]!;
    c = CampaignRecordSchema.parse({
      v: 1,
      id: crypto.randomUUID(),
      experiment,
      experiment_hash: expHash,
      created_at: (env.now ?? (() => new Date()))().toISOString(),
      seed,
      reuse: [],
      task_set: ids,
      // The task's own overrides; each execution derives its limits with forTask.
      tasks_meta: tasks.map((t) => ({
        id: t.task.id,
        kind: t.task.kind,
        coupling: t.task.coupling,
        limits: t.task.limits,
      })),
      arms,
      blocks: planBlocks(
        ids.tasks.map((t) => t.id),
        experiment.repeats,
        [experiment.baseline, ...experiment.variants],
        seed,
      ),
      ...(preregistration ? { preregistration } : {}),
      ...(override
        ? {
          egress_override: {
            egress_enforced: false,
            reason: override.trim(),
          },
        }
        : {}),
      ...(calibrationWaived ? { calibration_waived: true } : {}),
      ...(bcOverride ? { bc_egress_override: { reason: bcOverride } } : {}),
      ...(accountLabels ? { accounts: accountLabels } : {}),
    });
    // The checks a resume runs, before any record or execution (dry run too).
    await validateCampaignRecords({
      campaign: c,
      executions: [],
      artifacts: [],
      judgments: [],
    });
    if (!o.dryRun) {
      await env.store.writeCampaign(c);
      created = true;
    }
  } else {
    // H-13: a resume keeps the campaign's egress override state and reason, either way.
    if (c.egress_override?.reason !== override?.trim()) {
      throw new ConfigurationError(
        c.egress_override
          ? `campaign ${c.id} was created under --unverified-egress-ok (${c.egress_override.reason}): resume it with the flag and that reason`
          : `campaign ${c.id} was created without --unverified-egress-ok: resume it without the flag`,
      );
    }
    // H-35 S3 L2b: and its BC (NST) egress override state and reason.
    if (c.bc_egress_override?.reason !== bcOverride) {
      throw new ConfigurationError(
        c.bc_egress_override
          ? `campaign ${c.id} was created under --unverified-bc-egress-ok (${c.bc_egress_override.reason}): resume it with the flag and that reason`
          : `campaign ${c.id} was created without --unverified-bc-egress-ok: resume it without the flag`,
      );
    }
    // R-02: and its ordered account labels. H-53: the pinned list is the
    // campaign's labels plus each recorded addition; a resume may only append
    // new labels after it, with --add-accounts-reason and --added-by.
    const additions = await env.store.accountAdditions(c.id);
    const retirements = await env.store.accountRetirements(c.id);
    // H-61: a retired label is left out of the pin, and may not come back.
    const pinned = liveAccountPool(c, additions, retirements);
    for (const r of retirements) {
      if (accountLabels?.includes(r.label)) {
        throw new ConfigurationError(
          `label ${r.label} was retired from campaign ${c.id} (${r.reason}): leave out its --secrets-dir`,
        );
      }
    }
    const same = JSON.stringify(pinned) === JSON.stringify(accountLabels);
    const extends_ = pinned !== null && accountLabels !== null &&
      accountLabels.length > pinned.length &&
      pinned.every((l, i) => accountLabels[i] === l);
    if (!same && !(extends_ && addAccounts)) {
      throw new ConfigurationError(
        `campaign ${c.id} has accounts ${
          pinned ? `[${pinned.join(", ")}]` : "(one unlabelled --secrets-dir)"
        }, this run has accounts ${
          accountLabels
            ? `[${accountLabels.join(", ")}]`
            : "(one unlabelled --secrets-dir)"
        }: resume it with the same --secrets-dir labels in the same order${
          extends_
            ? "; to add the new labels to the pool pass --add-accounts-reason and --added-by"
            : pinned
            ? " (new labels may only be appended after them)"
            : ""
        }`,
      );
    }
    if (same && addAccounts) {
      throw new ConfigurationError(
        `--add-accounts-reason: no new --secrets-dir label beyond campaign ${c.id}'s pool [${
          pinned!.join(", ")
        }]`,
      );
    }
    if (!same) {
      addition = {
        v: 1,
        campaign_id: c.id,
        seq: String(additions.length + 1).padStart(3, "0"),
        added: accountLabels!.slice(pinned!.length),
        by: addAccounts!.by,
        at: (env.now ?? (() => new Date()))().toISOString(),
        reason: addAccounts!.reason,
      };
      // The full pool stays valid (a label twice is refused here too).
      accountPool(c, [...additions, AccountAdditionSchema.parse(addition)]);
      // (a retired label re-added is refused above: it is in accountLabels.)
    }
    // H-13b: and its calibration waiver state.
    if ((c.calibration_waived ?? false) !== calibrationWaived) {
      throw new ConfigurationError(
        c.calibration_waived
          ? `campaign ${c.id} was created with calibration_waived but its arms no longer need the waiver: start a new campaign`
          : `campaign ${c.id} was created without calibration_waived: it never resumes with the M8-07c calibration gate waived`,
      );
    }
    if (c.preregistration) {
      const v = await verify();
      const p = c.preregistration;
      if (
        v.sha256 !== p.sha256 || v.decision_sha256 !== p.decision_sha256 ||
        v.stage_b_decision_sha256 !== p.stage_b_decision_sha256
      ) {
        throw new ConfigurationError(
          `preregistration changed since campaign ${c.id} was created (document or decision file)`,
        );
      }
      if (v.problems.length > 0) throw refusal(v.problems);
    }
    data = await loadCampaignData(env.store, c);
    await validateCampaignRecords(data, {
      descriptor: descriptorLoader(env.resultsRoot, env.repoRoot),
      resultsRoot: env.resultsRoot,
    });
    // H-44 (D4): a campaign has one record version and new executions are
    // v3: before binding, a rerun target or any cell. Recovery (above),
    // reading, reporting and rejudging stay available.
    if (data.executions.some((e) => e.v < 3)) {
      throw new ConfigurationError(
        `campaign ${c.id} has executions recorded before H-44; new executions cannot join it. Start a fresh campaign under a new experiment id or a new --results-dir; existing results stay as they are`,
      );
    }
  }
  // H-13b: every execution of a waived campaign records it.
  if (calibrationWaived) runEnv = { ...runEnv, calibrationWaived: true };
  // H-41 (section 10): the campaign is final: its env pin, before the queue and any cell.
  if (!o.dryRun) await env.bindCampaign?.(c.id);
  // Refused before any container run (and in a dry run).
  // H-62: every named cell is validated before any claim or write.
  let reruns: RerunItem[] | null = null;
  if (rerunCells.length > 0 && data) {
    const scorer = await currentScorerFingerprint();
    reruns = [];
    for (const r of rerunCells) {
      // H-62: a cell an earlier rerun invocation already finished is skipped
      // (a relaunch on the same list is idempotent); any other non-unscored
      // cell is refused by rerunTarget as before.
      const done = rerunDoneStatus(c, data, r, scorer);
      if (done !== null) {
        io.log(
          o.dryRun
            ? `[DRY] rerun ${rerunKey(r)}: skipped, ${skipReason(done)}`
            : `[SKIP] rerun ${rerunKey(r)}: ${skipReason(done)}`,
        );
        continue;
      }
      const t = rerunTarget(c, data, r, scorer);
      reruns.push({
        r,
        key: rerunKey(r),
        block: t.block,
        at: t.at,
        i: t.block.order.indexOf(r.arm),
      });
    }
  }
  // H-53: the pool grows only once every resume refusal (env pin, rerun
  // target included) has passed.
  if (addition) {
    if (o.dryRun) {
      io.log(
        `[DRY] would add accounts [${
          addition.added.join(", ")
        }] to campaign ${c.id} (addition ${addition.seq}, by ${addition.by}): ${addition.reason}`,
      );
    } else {
      await env.store.writeAccountAddition(addition);
      io.log(
        `[POOL] accounts [${
          addition.added.join(", ")
        }] added to campaign ${c.id} (addition ${addition.seq}, by ${addition.by}): ${addition.reason}`,
      );
    }
  }
  const maxRepeat = o.repeats ?? experiment.repeats;
  const blocks = c.blocks.filter((b) => b.repeat <= maxRepeat)
    .slice(0, o.sample ?? Infinity);
  const summary: CampaignSummary = {
    // A dry run of a campaign that does not exist yet has no id.
    campaignId: created || campaigns.includes(c) ? c.id : null,
    created,
    planned: reruns
      ? rerunCells.length
      : blocks.reduce((n, b) => n + b.order.length, 0),
    ran: 0,
    judged: 0,
    unscored: 0,
    paused: null,
    stopped: false,
  };
  if (o.dryRun && reruns) {
    for (const x of reruns) {
      io.log(
        `[DRY] rerun ${x.block.task_id}#${x.block.repeat} ${x.r.arm} as attempt ${x.at.attempt} (manual_rerun)`,
      );
    }
    return summary;
  }
  if (o.dryRun) {
    for (const b of blocks) {
      const label = env.secretAccounts?.length
        ? pickAccount(env.secretAccounts, b.index).label
        : null;
      io.log(
        `${b.task_id}#${b.repeat}: ${b.order.join(" -> ")}${
          label ? ` [${label}]` : ""
        }`,
      );
    }
    for (const line of await dryRunEstimate(env.store, c, data, blocks)) {
      io.log(line);
    }
    return summary;
  }

  const opened: OpenedTasks = {
    tasks: new Map(tasks.map((t) => [t.task.id, t])),
    refapps: new Map(),
  };
  for (const t of tasks) {
    const v = t.task.refapp_version;
    if (!opened.refapps.has(v)) {
      opened.refapps.set(v, await resolveRefapp(env.repoRoot, v));
    }
  }
  const campaign = c;
  const now = () => (env.now ?? (() => new Date()))().getTime();
  // A stop file is checked before the first block and before each cell.
  const stopRequested = async () => {
    for (const path of o.stopFiles ?? []) {
      if (!await exists(path)) continue;
      if (!summary.stopped) {
        summary.stopped = true;
        io.log(
          `[PAUSE] stop file ${path} present; resume with: centralgauge harness run ${experimentId} --campaign ${campaign.id}`,
        );
      }
      return true;
    }
    // Graceful stop (signal or the environment's stop file): the same pause.
    if (await o.stopRequested?.()) {
      if (!summary.stopped) {
        summary.stopped = true;
        io.log(
          `[PAUSE] stop requested; resume with: centralgauge harness run ${experimentId} --campaign ${campaign.id}`,
        );
      }
      return true;
    }
    return false;
  };
  // R-08: a quarantine is loud in the log and counted in the summary.
  for (
    const lane of new Set([
      env.lane,
      env.judgeLane,
    ])
  ) {
    if (!lane) continue;
    // The lane that judges (the judge lane, else the one lane) is the judging pool.
    const pool = lane === (env.judgeLane ?? env.lane)
      ? "judging pool"
      : "agent pool";
    lane.onQuarantine = (container, reason) => {
      summary.quarantined = (summary.quarantined ?? 0) + 1;
      summary.poolSize = lane.members().length;
      summary.poolTotal = lane.containers.length;
      io.log(
        `${colors.red("[QUARANTINE]")} ${container}: ${
          reason.replace(/\s*[\r\n]+\s*/g, " ")
        } (${pool} ${summary.poolSize}/${summary.poolTotal})`,
      );
    };
  }
  if (await stopRequested()) return summary;
  // H-09: an agent slot frees once its execution is published; the judge
  // queue judges on the judge lane. Owed judgments (a crash after
  // publication) go first; they are judged, never executed again.
  // A dry run (the plan environment) has no lane: the default is read here.
  // H-41 (sections 8, 9): in auto mode the queue is gated on the pool (bound
  // above) and also judges a --rerun cell.
  const pooled = env.judgePooled;
  const queue = pooled
    ? judgeQueue(runEnv, pooled, judgeDeferred, o.judgeConcurrency)
    : judgeQueue(
      runEnv,
      o.judgeConcurrency ?? (env.judgeLane ?? env.lane).containers.length,
    );
  const agentEnv: HarnessEnv = { ...runEnv, judgeLater: queue.push };
  // H-41 (3, 9; R1-L1): an absent judgment still owed (starved, or another
  // judge holds its claim) is owed, not unscored, whether or not it starved.
  const count = async (e: ExecutionRecord) => {
    const j = (await env.store.judgments(e.id))[0];
    if (j && j.verdict !== "unscored") summary.judged++;
    else if (!j && await judgmentOwed(env, e)) {
      summary.owed = (summary.owed ?? 0) + 1;
    } else summary.unscored++;
  };
  const starvedOut = async () => {
    summary.starved = true;
    summary.owed = 0;
    for (const e of await env.store.executions(campaign.id)) {
      if (await judgmentOwed(env, e)) summary.owed++;
    }
    return summary;
  };
  // H-53: an account pool (2+ labels). A label is parked while a usage limit
  // on it has not reset (from the records, so a restart honours it; an
  // unknown reset hit in this run parks it until the run ends). A cell takes
  // its block's label while free, else the next free label round-robin; the
  // run pauses only when every label is parked.
  const pool = (env.secretAccounts?.length ?? 0) > 1
    ? env.secretAccounts!.map((a) => a.label!)
    : null;
  const parked = new Map<string, string>();
  if (pool) {
    for (const e of await env.store.executions(campaign.id)) {
      if (!e.account || !pool.includes(e.account)) continue;
      const r = await pendingReset(env, e);
      if (r !== null && Date.parse(r) > now()) {
        parked.set(e.account, laterReset(parked.get(e.account) ?? null, r));
      }
    }
  }
  const free = (l: string) => {
    const r = parked.get(l);
    return r === undefined || (r !== "unknown" && Date.parse(r) <= now());
  };
  let turn = 0;
  /** Synchronous: called right before runCell, with no await between. */
  const pickPooled = (
    blockLabel: string | null,
    afterLimit: boolean,
  ): HarnessEnv["accountChoice"] | null => {
    // H-61: a retired block label is not in the pool: fall to round-robin.
    if (blockLabel !== null && pool!.includes(blockLabel) && free(blockLabel)) {
      return {
        label: blockLabel,
        choice: afterLimit ? "retry_after_limit" : "block_pair",
      };
    }
    for (let k = 0; k < pool!.length; k++) {
      const l = pool![(turn + k) % pool!.length]!;
      if (!free(l)) continue;
      turn = (turn + k + 1) % pool!.length;
      return {
        label: l,
        choice: afterLimit ? "retry_after_limit" : "round_robin",
      };
    }
    return null;
  };
  /**
   * The block's label for its arm `i`, by ancestry alone (never start times):
   * the latest attempt of arm i's own chain if it has one, else of the
   * nearest preceding arm that ran.
   */
  const blockLabel = (all: ExecutionRecord[], block: Block, i: number) => {
    for (let k = i; k >= 0; k--) {
      const chain = all.filter((e) =>
        e.block === block.index && e.order_in_block === k &&
        e.account !== undefined
      );
      if (chain.length > 0) {
        return chain.reduce((a, b) => b.attempt > a.attempt ? b : a).account!;
      }
    }
    return null;
  };
  /** Every label parked: the earliest reset ("unknown" only if all are). */
  const earliestReset = () => {
    const known = [...parked.values()].filter((r) => r !== "unknown")
      .sort(compareInstant);
    return known[0] ?? "unknown";
  };
  const parkedNote = () =>
    [...parked].sort(([a], [b]) => a < b ? -1 : 1).map(([l, r]) =>
      `${l} until ${r}`
    ).join(", ");
  /** Parks the label after a limit; true when another label is free. */
  const park = (label: string, reset: string) => {
    parked.set(label, laterReset(parked.get(label) ?? null, reset));
    io.log(
      `[POOL] account ${label} parked until ${
        parked.get(label)
      }; the cell continues on the next free label`,
    );
    return pool!.some(free);
  };
  /** The cell env for a pooled label: inner retries stop once the label is parked. */
  const pooledEnv = (
    base: HarnessEnv,
    choice: NonNullable<HarnessEnv["accountChoice"]>,
  ): HarnessEnv => ({
    ...base,
    accountChoice: choice,
    accountUsable: () => free(choice.label),
  });
  const cellPrior = async (block: Block, arm: string) =>
    (await env.store.executions(campaign.id)).filter((e) =>
      e.block === block.index && e.arm === arm
    );
  /**
   * H-53: one pooled cell from `first`, its automatic retries included. Each
   * start takes a free label, picked after the last await before runCell; a
   * limit parks that label and the retry goes on at once on the next free
   * one; a yield (the label was parked by another cell) picks again. pause:
   * every label is parked (the earliest reset); null: the cell is done, or
   * `admit` refused (a stop or a halt).
   */
  const runPooled = async (
    base: HarnessEnv,
    block: Block,
    arm: string,
    i: number,
    first: AttemptRef,
    prior: ExecutionRecord[],
    /** Awaited first: a stop request ends the cell. */
    stop: () => Promise<boolean>,
    /** Synchronous, after the last await: a halt ends the cell. */
    halt: () => boolean,
  ): Promise<{
    executions: ExecutionRecord[];
    pause: string | null;
    /** With a pause: the attempt still to start (a manual rerun included) and its prior. */
    pending: { at: AttemptRef; prior: ExecutionRecord[] } | null;
  }> => {
    const executions: ExecutionRecord[] = [];
    let at: AttemptRef | null = first;
    let mine = prior;
    while (at) {
      const all = await env.store.executions(campaign.id);
      if (await stop()) break;
      // No await from here to runCell: the halt, the pick and the start.
      if (halt()) break;
      const retryOf = at.retryOf;
      const parent = mine.find((e) => e.id === retryOf);
      const choice = pickPooled(
        blockLabel(all, block, i),
        parent?.termination === "usage_limited",
      );
      if (!choice) {
        return {
          executions,
          pause: earliestReset(),
          pending: { at, prior: mine },
        };
      }
      const r = await runCell(
        pooledEnv(base, choice),
        cellRefFor(campaign, opened, block, arm, i),
        at,
        mine,
      );
      executions.push(...r.executions);
      if (r.pause) park(choice.label, r.pause);
      else if (!r.yielded) break;
      mine = await cellPrior(block, arm);
      at = nextAttempt(mine);
    }
    return { executions, pause: null, pending: null };
  };
  if (reruns) {
    // H-62: the named cells through a worker pool at --concurrency. Cells of
    // one block run one after another on one worker (the matched pair), in
    // the given order; blocks go to workers in first-appearance order.
    // One cell on a fixed judge keeps the legacy inline judging (runEnv).
    const base = rerunCells.length === 1 && !pooled ? runEnv : agentEnv;
    let remaining = reruns;
    const kept = new Map<
      string,
      { at: AttemptRef; prior: ExecutionRecord[] }
    >();
    const done: ExecutionRecord[] = [];
    let crashed: { err: unknown } | null = null;
    const halt = () =>
      crashed !== null || summary.stopped || queue.failed() || queue.starved();
    const todo = () => remaining.map((x) => x.key).join(" ");
    const hint = (extra: string) =>
      rerunCells.length > 1
        ? `${extra}; cells still to do (relaunch the same --rerun list, finished cells are skipped): ${todo()}`
        : extra;
    for (;;) {
      let stalled = false;
      let unpooledPause: string | null = null;
      const groups: (typeof reruns)[] = [];
      for (const x of remaining) {
        const g = groups.find((g) => g[0]!.block.index === x.block.index);
        if (g) g.push(x);
        else groups.push([x]);
      }
      let next = 0;
      const finish = (x: { key: string }) => {
        remaining = remaining.filter((y) => y.key !== x.key);
      };
      const worker = async () => {
        while (
          !stalled && unpooledPause === null && !summary.stopped && !halt() &&
          next < groups.length
        ) {
          for (const x of groups[next++]!) {
            if (stalled || unpooledPause !== null || summary.stopped) break;
            let target = kept.get(x.key) ?? null;
            if (!target) {
              // Still unscored at its turn? (an earlier invocation may have done it)
              const fresh = await loadCampaignData(env.store, campaign);
              const status = rerunCellStatus(
                campaign,
                fresh,
                x.r,
                await currentScorerFingerprint(),
              );
              if (status !== "unscored") {
                io.log(`[SKIP] rerun ${x.key}: ${skipReason(status)}`);
                finish(x);
                continue;
              }
              const t = rerunTarget(
                campaign,
                fresh,
                x.r,
                await currentScorerFingerprint(),
              );
              target = { at: t.at, prior: t.prior };
            }
            if (await stopRequested()) break;
            // After the last await: the shared admission state, right before the start.
            if (halt() || stalled || unpooledPause !== null) break;
            if (pool) {
              const r = await runPooled(
                base,
                x.block,
                x.r.arm,
                x.i,
                target.at,
                target.prior,
                stopRequested,
                halt,
              );
              done.push(...r.executions);
              if (r.pause !== null && r.pending !== null) {
                // Only an owed automatic retry of a started rerun is kept;
                // a manual attempt that never started is re-checked after the wait.
                if (r.pending.at.runKind !== "manual_rerun") {
                  kept.set(x.key, r.pending);
                }
                stalled = true;
                break;
              }
              finish(x);
              continue;
            }
            const r = await runCell(
              base,
              cellRefFor(campaign, opened, x.block, x.r.arm, x.i),
              target.at,
              target.prior,
            );
            done.push(...r.executions);
            finish(x);
            // Its owed retry waits for the reset; a plain resume runs it.
            if (r.pause) unpooledPause = laterReset(unpooledPause, r.pause);
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(o.concurrency, groups.length) },
          () =>
            worker().catch((err) => {
              crashed ??= { err };
              env.hooks?.workerThrew?.();
            }),
        ),
      );
      if (crashed !== null) {
        await queue.drain().catch((err) =>
          io.log(
            `[WARN] judge queue failed as well (some judgments not written): ${
              err instanceof Error ? err.message : err
            }`,
          )
        );
        throw (crashed as { err: unknown }).err;
      }
      await queue.drain();
      for (const e of done.splice(0)) {
        summary.ran++;
        await count(e);
      }
      if (queue.starved()) return await starvedOut();
      if (unpooledPause !== null) {
        summary.paused = unpooledPause;
        io.log(
          `[PAUSE] ${
            hint(
              `usage limit until ${unpooledPause}; resume with: centralgauge harness run ${experimentId} --campaign ${campaign.id}`,
            )
          }`,
        );
        return summary;
      }
      if (!stalled || summary.stopped) return summary;
      const reset = earliestReset();
      const wait = reset === "unknown" ? Infinity : Date.parse(reset) - now();
      if (wait > o.maxPauseMs) {
        summary.paused = reset;
        io.log(
          `[PAUSE] ${
            hint(
              `usage limit on every account (${parkedNote()}); resume with: centralgauge harness run ${experimentId} --campaign ${campaign.id}`,
            )
          }`,
        );
        return summary;
      }
      io.log(
        `[PAUSE] usage limit on every account (${parkedNote()}); waiting ${
          Math.max(wait, 0)
        } ms`,
      );
      await io.sleep(Math.max(wait, 0));
    }
  }
  for (const e of await env.store.executions(campaign.id)) {
    if (!await judgmentOwed(env, e)) continue;
    const block = campaign.blocks.find((b) => b.index === e.block)!;
    queue.push(cellRefFor(campaign, opened, block, e.arm, e.order_in_block), e);
  }
  const ran: ExecutionRecord[] = [];
  // H-09 run 002: the first worker's throw; no worker admits a cell after it.
  let crashed: { err: unknown } | null = null;
  // H-41 (9): a starved queue admits no new cell either.
  const halted = () => crashed !== null || queue.failed() || queue.starved();
  for (;;) {
    let paused: string | null = null;
    let next = 0;
    // Workers take whole blocks: the arms of one block run one after another
    // in its recorded order (the matched pair), blocks run in parallel.
    const worker = async () => {
      while (
        paused === null && !summary.stopped && !halted() &&
        next < blocks.length
      ) {
        const block = blocks[next++]!;
        for (let i = 0; i < block.order.length; i++) {
          const arm = block.order[i]!;
          if (paused !== null || summary.stopped || halted()) break;
          const all = await env.store.executions(campaign.id);
          const prior = all.filter((e) =>
            e.block === block.index && e.arm === arm
          );
          let at = nextAttempt(prior);
          if (!at) continue;
          if (pool) {
            const r = await runPooled(
              agentEnv,
              block,
              arm,
              i,
              at,
              prior,
              stopRequested,
              halted,
            );
            summary.ran += r.executions.length;
            ran.push(...r.executions);
            if (r.pause !== null) {
              paused = earliestReset();
              break;
            }
            continue;
          }
          // A usage limit survives a restart: no retry before its reset.
          const parent = at.retryOf;
          const waitFor = at.runKind === "auto_retry"
            ? await pendingReset(env, prior.find((e) => e.id === parent)!)
            : null;
          if (waitFor !== null && Date.parse(waitFor) > now()) {
            if (
              ignoreReset === undefined || parent === null ||
              !recordedBefore.has(parent)
            ) {
              paused = laterReset(paused, waitFor);
              break;
            }
            at = {
              ...at,
              usageResetIgnored: { reason: ignoreReset, reset_at: waitFor },
            };
          }
          if (await stopRequested()) break;
          // Run 003: again after every await since admission, right before the start.
          if (halted()) break;
          const r = await runCell(
            agentEnv,
            cellRefFor(campaign, opened, block, arm, i),
            at,
            prior,
          );
          summary.ran += r.executions.length;
          ran.push(...r.executions);
          if (r.pause) paused = laterReset(paused, r.pause);
        }
      }
    };
    // Every worker settles (its cell in flight ends) before the queue drains
    // and the caller tears the environment down.
    await Promise.all(
      Array.from(
        { length: Math.min(o.concurrency, blocks.length) },
        () =>
          worker().catch((err) => {
            crashed ??= { err };
            env.hooks?.workerThrew?.();
          }),
      ),
    );
    if (crashed !== null) {
      // The queued judgments of finished cells still land before the stop;
      // a judge failure as well is reported, the worker's error rethrown.
      await queue.drain().catch((err) =>
        io.log(
          `[WARN] judge queue failed as well (some judgments not written): ${
            err instanceof Error ? err.message : err
          }`,
        )
      );
      throw (crashed as { err: unknown }).err;
    }
    // Counted once judged: a judge failure stops the campaign here.
    await queue.drain();
    for (const e of ran.splice(0)) await count(e);
    if (queue.starved()) return await starvedOut();
    if (paused === null || summary.stopped) return summary;
    const wait = paused === "unknown" ? Infinity : Date.parse(paused) - now();
    // H-53: a pool pauses only with every label parked; name each.
    const what = pool
      ? `usage limit on every account (${parkedNote()})`
      : `usage limit until ${paused}`;
    if (wait > o.maxPauseMs) {
      summary.paused = paused;
      io.log(
        `[PAUSE] ${what}; resume with: centralgauge harness run ${experimentId}`,
      );
      return summary;
    }
    io.log(`[PAUSE] ${what}; waiting ${Math.max(wait, 0)} ms`);
    await io.sleep(Math.max(wait, 0));
  }
}
