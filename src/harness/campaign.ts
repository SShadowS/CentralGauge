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

import { join, relative } from "@std/path";
import { globToRegExp } from "@std/path/posix";
import type { Catalog } from "../ingest/catalog/read.ts";
import type { AttemptRef, CellRef, HarnessEnv } from "./execution.ts";
import type { PriorExecution } from "./estimate.ts";
import type { CampaignRecords } from "./integrity.ts";
import type { RefappRef } from "./identity.ts";
import type { LoadedTask } from "./task.ts";
import { ConfigurationError } from "../errors.ts";
import { adapterFor } from "./adapters/mod.ts";
import { estimateArms, renderEstimate } from "./estimate.ts";
import { loadExperiment } from "./config.ts";
import { recoverInterrupted, runCell } from "./execution.ts";
import { resolveRefapp, taskSetIdentity } from "./identity.ts";
import {
  imageFacts,
  imageTag,
  mcpDefinitions,
  runtimeFacts,
} from "./images.ts";
import { validateCampaignRecords } from "./integrity.ts";
import { manifestHash, resolveManifest } from "./manifest.ts";
import { cellsFromRecords } from "./outcome.ts";
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
  & Pick<Partial<HarnessEnv>, "now">;

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
 * Placed cells share the one proxy on the sandbox gateway, which has no
 * per-execution isolation yet (M1-33c): refused until it does.
 */
export const PLACED_CONCURRENCY_REFUSAL =
  "--concurrency > 1 is refused while the egress marker places sandboxes: every placed cell uses the one egress proxy on the sandbox gateway, which has no per-execution isolation yet (M1-33c); run with --concurrency 1";

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
    const byExecution = new Map<string, JudgmentRecord[]>();
    for (const j of data.judgments) {
      byExecution.set(j.execution_id, [
        ...(byExecution.get(j.execution_id) ?? []),
        j,
      ]);
    }
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
  if (o.concurrency > 1 && (env.egress !== undefined || env.egressEnforced)) {
    throw new ConfigurationError(PLACED_CONCURRENCY_REFUSAL);
  }
  const { experiment, configs } = await loadExperiment(
    env.harnessRoot,
    experimentId,
  );
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

  const pattern = globToRegExp(experiment.tasks, { globstar: true });
  const tasks = (await loadTaskSet(
    join(env.repoRoot, "harness-tasks", "tasks"),
  )).filter((t) =>
    pattern.test(relative(env.repoRoot, t.dir).replaceAll("\\", "/"))
  );
  if (tasks.length === 0) {
    throw new ConfigurationError(
      `experiment ${experimentId}: tasks pattern ${experiment.tasks} matches no task`,
    );
  }
  const ids = await taskSetIdentity(env.repoRoot, tasks, env.symbols);
  const arms: CampaignRecord["arms"] = [];
  for (const config of configs) {
    const tag = imageTag(config.harness, config.harness_version);
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
    });
  }
  const expHash = await experimentHash(experiment);
  const campaigns = await env.store.campaigns(experimentId);
  let c = campaigns.find((x) =>
    x.experiment_hash === expHash && x.task_set.identity === ids.identity &&
    arms.every((a) =>
      x.arms.find((y) => y.config_id === a.config_id)?.manifest_hash ===
        a.manifest_hash
    )
  );
  let created = false;
  let data: CampaignRecords | null = null;
  if (!c) {
    if (campaigns.length > 0) {
      io.log(
        `[WARN] experiment, task set or arm manifests changed since campaign ${
          campaigns[0]!.id
        }: starting a new campaign`,
      );
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
    data = await loadCampaignData(env.store, c);
    await validateCampaignRecords(data);
  }
  const maxRepeat = o.repeats ?? experiment.repeats;
  const blocks = c.blocks.filter((b) => b.repeat <= maxRepeat)
    .slice(0, o.sample ?? Infinity);
  const summary: CampaignSummary = {
    // A dry run of a campaign that does not exist yet has no id.
    campaignId: created || campaigns.includes(c) ? c.id : null,
    created,
    planned: blocks.reduce((n, b) => n + b.order.length, 0),
    ran: 0,
    judged: 0,
    unscored: 0,
    paused: null,
  };
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
  for (;;) {
    let paused: string | null = null;
    let next = 0;
    // Workers take whole blocks: the arms of one block run one after another
    // in its recorded order (the matched pair), blocks run in parallel.
    const worker = async () => {
      while (paused === null && next < blocks.length) {
        const block = blocks[next++]!;
        for (const [i, arm] of block.order.entries()) {
          if (paused !== null) break;
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
    if (paused === null) return summary;
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
