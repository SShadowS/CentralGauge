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

import { exists } from "@std/fs";
import { join, relative } from "@std/path";
import { globToRegExp } from "@std/path/posix";
import type { Catalog } from "../ingest/catalog/read.ts";
import type { AttemptRef, CellRef, HarnessEnv } from "./execution.ts";
import type { PriorExecution } from "./estimate.ts";
import type { CampaignRecords } from "./integrity.ts";
import type { RefappRef } from "./identity.ts";
import type { LoadedTask } from "./task.ts";
import type { HarnessConfig } from "./config.ts";
import { ConfigurationError } from "../errors.ts";
import { adapterFor } from "./adapters/mod.ts";
import { proxyIsolationProblem } from "./egress.ts";
import { PROXY_ISOLATION } from "./egress-proxy.ts";
import { estimateArms, renderEstimate } from "./estimate.ts";
import { loadExperiment } from "./config.ts";
import { recoverInterrupted, runCell } from "./execution.ts";
import { loadSymbolsLock, resolveRefapp, taskSetIdentity } from "./identity.ts";
import {
  imageFacts,
  imageTag,
  mcpDefinitions,
  runtimeFacts,
} from "./images.ts";
import { validateCampaignRecords } from "./integrity.ts";
import { manifestHash, resolveManifest } from "./manifest.ts";
import { cellsFromRecords } from "./outcome.ts";
import { verifyPrereg } from "./prereg.ts";
import {
  type ArtifactRecord,
  type Block,
  type CampaignRecord,
  CampaignRecordSchema,
  compareInstant,
  type ExecutionRecord,
  experimentHash,
  type JudgmentRecord,
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
  /** Seed of a new campaign (default random); a resumed campaign keeps its own. */
  seed?: number;
  /** Longest usage-limit pause to wait out; 0 stops with a resume line. */
  maxPauseMs: number;
  /** Any of these present stops the campaign before its next cell. */
  stopFiles?: string[];
  /** Resume exactly this campaign; refused when it no longer matches, never created. */
  campaign?: string;
  /** Run exactly this unscored cell again as a manual_rerun; nothing else runs. */
  rerun?: { task: string; repeat: number; arm: string };
  /** M11-10: the stage-A decision file; required with a preregistration. */
  preregDecision?: string;
  /** M11-10: the stage-B decision file; required with a preregistration. */
  preregBDecision?: string;
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
  /** Of those, not judged or judged unscored. */
  unscored: number;
  /** Usage-limit reset (or "unknown") when the campaign stopped paused. */
  paused: string | null;
  /** A stop file stopped the campaign before its next cell. */
  stopped: boolean;
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
  const artifacts: ArtifactRecord[] = [];
  const judgments: JudgmentRecord[] = [];
  for (const e of executions) {
    const a = await store.artifact(e.id);
    if (a) artifacts.push(a);
    judgments.push(...await store.judgments(e.id));
  }
  return { campaign: c, executions, artifacts, judgments };
}

/**
 * The next attempt a cell is owed, by ancestry: planned when it has none;
 * otherwise an automatic retry of the newest chain's last execution when
 * its outcome allows one (retryProblem), else nothing (the cell is done).
 */
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
  & Pick<Partial<HarnessEnv>, "now" | "proxyIsolation">
  & {
    /**
     * The verified marker places sandboxes (a plan env has no egress runtime
     * to show it). With proxyIsolation, this is what the concurrency gate
     * sees on a dry run, the same inputs as the real environment's.
     */
    egressPlaced?: boolean;
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

/**
 * A manual rerun's cell and attempt: only an unscored cell is rerun (a
 * manual rerun never replaces a scored result, and a pending or unrun cell
 * is owed its planned or automatic attempt, not a manual one).
 */
function rerunTarget(
  c: CampaignRecord,
  data: CampaignRecords,
  r: NonNullable<RunOptions["rerun"]>,
): { block: Block; at: AttemptRef; prior: ExecutionRecord[] } {
  const label = `${r.task}:${r.repeat}:${r.arm}`;
  const block = c.blocks.find((b) =>
    b.task_id === r.task && b.repeat === r.repeat && b.order.includes(r.arm)
  );
  if (!block) {
    throw new ConfigurationError(`no such cell ${label} in campaign ${c.id}`);
  }
  const cell = cellsFromRecords(c, data.executions, judgmentsByExecution(data))
    .find((x) =>
      x.task === r.task && x.repeat === r.repeat && x.arm === r.arm
    )!;
  if (cell.status !== "unscored") {
    throw new ConfigurationError(
      `cell ${label} is ${cell.status}: only an unscored cell is rerun (a manual rerun never replaces a scored result)`,
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
    for (const cell of cellsFromRecords(c, data.executions, byExecution)) {
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
async function experimentTasks(
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
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) {
    throw new ConfigurationError(
      `concurrency must be a positive integer: ${o.concurrency}`,
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
  if (o.rerun && (o.sample !== undefined || o.repeats !== undefined)) {
    throw new ConfigurationError(
      "--rerun runs one cell: --sample and --repeats do not apply",
    );
  }
  const { experiment, configs } = await loadExperiment(
    env.harnessRoot,
    experimentId,
  );
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
  if (bearing.length > 0 && !env.egressEnforced) {
    throw new ConfigurationError(
      `${
        bearing.join(", ")
      } carry provider credentials: a campaign runs unattended and needs verified egress enforcement (authorized marker); use harness cell --supervised for a watched run`,
    );
  }
  const runEnv: HarnessEnv = { ...env, supervised: false };
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
  const arms: CampaignRecord["arms"] = [];
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
      config.components.mcp.length > 0
        ? await mcpDefinitions(env.repoRoot)
        : {},
    );
    const manifest = await resolveManifest(env.harnessRoot, config, facts);
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
  if (!c && o.rerun) {
    throw new ConfigurationError(
      `no campaign of experiment ${experimentId} matches the current experiment, task set and arm manifests: --rerun targets an existing campaign`,
    );
  }
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
    await validateCampaignRecords(data);
  }
  // Refused before any container run (and in a dry run).
  const rerun = o.rerun && data ? rerunTarget(c, data, o.rerun) : null;
  const maxRepeat = o.repeats ?? experiment.repeats;
  const blocks = c.blocks.filter((b) => b.repeat <= maxRepeat)
    .slice(0, o.sample ?? Infinity);
  const summary: CampaignSummary = {
    // A dry run of a campaign that does not exist yet has no id.
    campaignId: created || campaigns.includes(c) ? c.id : null,
    created,
    planned: rerun ? 1 : blocks.reduce((n, b) => n + b.order.length, 0),
    ran: 0,
    judged: 0,
    unscored: 0,
    paused: null,
    stopped: false,
  };
  if (o.dryRun && rerun) {
    io.log(
      `[DRY] rerun ${rerun.block.task_id}#${rerun.block.repeat} ${
        o.rerun!.arm
      } as attempt ${rerun.at.attempt} (manual_rerun)`,
    );
    return summary;
  }
  if (o.dryRun) {
    for (const b of blocks) {
      io.log(`${b.task_id}#${b.repeat}: ${b.order.join(" -> ")}`);
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
    return false;
  };
  if (await stopRequested()) return summary;
  if (rerun) {
    const arm = o.rerun!.arm;
    const r = await runCell(
      runEnv,
      cellRefFor(
        campaign,
        opened,
        rerun.block,
        arm,
        rerun.block.order.indexOf(arm),
      ),
      rerun.at,
      rerun.prior,
    );
    for (const e of r.executions) {
      summary.ran++;
      const j = (await env.store.judgments(e.id))[0];
      if (j && j.verdict !== "unscored") summary.judged++;
      else summary.unscored++;
    }
    if (r.pause) {
      // Its owed retry waits for the reset; a plain resume runs it.
      summary.paused = r.pause;
      io.log(
        `[PAUSE] usage limit until ${r.pause}; resume with: centralgauge harness run ${experimentId} --campaign ${campaign.id}`,
      );
    }
    return summary;
  }
  for (;;) {
    let paused: string | null = null;
    let next = 0;
    // Workers take whole blocks: the arms of one block run one after another
    // in its recorded order (the matched pair), blocks run in parallel.
    const worker = async () => {
      while (paused === null && !summary.stopped && next < blocks.length) {
        const block = blocks[next++]!;
        for (const [i, arm] of block.order.entries()) {
          if (paused !== null || summary.stopped) break;
          const prior = (await env.store.executions(campaign.id)).filter((
            e,
          ) => e.block === block.index && e.arm === arm);
          const at = nextAttempt(prior);
          if (!at) continue;
          // A usage limit survives a restart: no retry before its reset.
          const waitFor = at.runKind === "auto_retry"
            ? await pendingReset(env, prior.find((e) => e.id === at.retryOf)!)
            : null;
          if (waitFor !== null && Date.parse(waitFor) > now()) {
            paused = laterReset(paused, waitFor);
            break;
          }
          if (await stopRequested()) break;
          const r = await runCell(
            runEnv,
            cellRefFor(campaign, opened, block, arm, i),
            at,
            prior,
          );
          for (const e of r.executions) {
            summary.ran++;
            const j = (await env.store.judgments(e.id))[0];
            if (j && j.verdict !== "unscored") summary.judged++;
            else summary.unscored++;
          }
          if (r.pause) paused = laterReset(paused, r.pause);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(o.concurrency, blocks.length) }, worker),
    );
    if (paused === null || summary.stopped) return summary;
    const wait = paused === "unknown" ? Infinity : Date.parse(paused) - now();
    if (wait > o.maxPauseMs) {
      summary.paused = paused;
      io.log(
        `[PAUSE] usage limit until ${paused}; resume with: centralgauge harness run ${experimentId}`,
      );
      return summary;
    }
    io.log(
      `[PAUSE] usage limit until ${paused}; waiting ${Math.max(wait, 0)} ms`,
    );
    await io.sleep(Math.max(wait, 0));
  }
}
