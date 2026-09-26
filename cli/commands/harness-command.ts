/**
 * `centralgauge harness` (spec 1a section 10): `validate`, `report`,
 * `cell`, `judge-fixture`, `images build`, `symbols lock` and
 * `egress verify` (M1-33). `run`,
 * `rejudge` and `qualify` come in M1-24b.
 *
 * @module cli/commands/harness
 */
import * as colors from "@std/fmt/colors";
import { fromFileUrl, join, relative, resolve } from "@std/path";
import { globToRegExp } from "@std/path/posix";
import { Command, EnumType } from "@cliffy/command";
import { z } from "zod";
import type {
  HarnessConfig,
  LoadedExperiment,
  VaryKey,
} from "../../src/harness/config.ts";
import type { JudgingContext } from "../../src/harness/outcome.ts";
import type {
  ArtifactRecord,
  CampaignRecord,
  JudgmentRecord,
} from "../../src/harness/records.ts";
import type { HarnessReport } from "../../src/harness/report.ts";
import type { LoadedTask } from "../../src/harness/task.ts";
import type { HarnessAdapter } from "../../src/harness/adapter.ts";
import type {
  CampaignSummary,
  OpenedTasks,
  PlanEnv,
  RunOptions,
} from "../../src/harness/campaign.ts";
import type { CellResult, HarnessEnv } from "../../src/harness/execution.ts";
import type { QualifyManifest } from "../../src/harness/qualify.ts";
import type { ImageFacts } from "../../src/harness/images.ts";
import type { ManifestReader } from "../../src/harness/symbols.ts";
import type { DockerCli } from "../../src/harness/sandbox.ts";
import type { EnvOptions, OpenEnv } from "./harness-env.ts";
import type { EgressState, MarkerState } from "../../src/harness/egress.ts";
import { canonicalJSON } from "../../shared/canonical.ts";
import {
  CentralGaugeError,
  ConfigurationError,
  ValidationError,
} from "../../src/errors.ts";
import {
  checkModelsInCatalog,
  HarnessConfigSchema,
  loadConfig,
  loadExperiment,
  VARY_KEYS,
} from "../../src/harness/config.ts";
import {
  loadSymbolsLock,
  oracleHash,
  resolveRefapp,
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import {
  compareInstant,
  outcomePolicy,
  RecordStore,
} from "../../src/harness/records.ts";
import {
  buildReport,
  loadReportLogs,
  renderReport,
} from "../../src/harness/report.ts";
import { loadTraces } from "../../src/harness/trace-metrics.ts";
import { checkScenario } from "../../scripts/harness/stub-anthropic.mjs";
import { loadTaskSet } from "../../src/harness/task.ts";
import { adapterFor } from "../../src/harness/adapters/mod.ts";
import { rejudgeExecution, runCell } from "../../src/harness/execution.ts";
import {
  cellRefFor,
  loadCampaignData,
  PLACED_CONCURRENCY_REFUSAL,
  planCampaign,
  precheckCampaignPin,
  runCampaign,
} from "../../src/harness/campaign.ts";
import { validateCampaignRecords } from "../../src/harness/integrity.ts";
import {
  exists,
  freezeWorkspace,
  safeCopyTree,
} from "../../src/harness/fsutil.ts";
import { hashTree } from "../../src/harness/hash.ts";
import {
  authorizedMarkerProblems,
  collectEgressState,
  evaluatePreflight,
  hostsForRoutes,
  loadRecordedHosts,
  MARKER_FILE,
  MARKER_STATES,
  preflightExpect,
  ProbeEvidenceSchema,
  realEgressCollector,
  recordCellProblems,
  RECORDED_HOSTS_PATH,
  ROUTE_HOSTS,
  SANDBOX_NETWORK,
  sha256File,
  sha256Text,
  verifyEgressState,
} from "../../src/harness/egress.ts";
import { PROXY_ISOLATION } from "../../src/harness/egress-proxy.ts";
import {
  BASE_IMAGE,
  hasBaseLayers,
  IMAGE_LABELS,
  imageFacts,
  imageTag,
  mcpDefinitions,
  mcpFacts,
  mcpLabel,
  runtimeFacts,
} from "../../src/harness/images.ts";
import { manifestHash, resolveManifest } from "../../src/harness/manifest.ts";
import {
  loadQualifyManifest,
  variantAllowed,
} from "../../src/harness/qualify.ts";
import { realDocker } from "../../src/harness/sandbox.ts";
import { applyOverlay, TASK_SOURCES } from "../../src/harness/staging.ts";
import {
  altoolReader,
  buildSymbolsLock,
  defaultAltool,
  writeSymbolsLock,
} from "../../src/harness/symbols.ts";
import { loadTaskAt } from "../../src/harness/task-rev.ts";
import {
  currentScorerFingerprint,
  judge,
  mutantOutcome,
  writeVerdictLog,
} from "../../src/harness/verdict.ts";
import { readCatalog } from "../../src/ingest/catalog/read.ts";
import { markerPlaces, openHarnessEnv, openPlanEnv } from "./harness-env.ts";

/** Loud, file-naming failures are collected; anything else is a bug. */
function isProblem(err: unknown): err is Error {
  return err instanceof CentralGaugeError ||
    err instanceof Deno.errors.NotFound;
}

/** A config field a `vary` key names; lists sorted as the manifest sorts them. */
function varyField(c: HarnessConfig, k: VaryKey): string {
  const v = k in c.components
    ? (c.components as Record<string, unknown>)[k]
    : (c as unknown as Record<string, unknown>)[k];
  return canonicalJSON(Array.isArray(v) ? [...v].sort() : v);
}

/**
 * Static vary check on config values. Component content identity is
 * checked at report time on the resolved manifests.
 */
function varyProblems({ experiment: e, configs }: LoadedExperiment): string[] {
  const [base, ...variants] = configs;
  return variants.flatMap((v) => {
    const differing = VARY_KEYS.filter((k) =>
      varyField(base!, k) !== varyField(v, k)
    );
    const outside = differing.filter((k) => !e.vary.includes(k));
    if (outside.length > 0) {
      return [
        `variant ${v.id} differs from baseline ${base!.id} in ${
          outside.join(", ")
        }, outside vary [${e.vary.join(", ")}]`,
      ];
    }
    if (differing.length === 0) {
      return [
        `variant ${v.id} equals baseline ${base!.id} in every vary field [${
          e.vary.join(", ")
        }]`,
      ];
    }
    return [];
  });
}

type Problem = (file: string, err: unknown) => void;

/** Ids of a folder of <id>.yml files; any other entry is a problem. */
async function ymlIds(
  dir: string,
  what: string,
  problem: Problem,
): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".yml")) ids.push(e.name.slice(0, -4));
      else {
        problem(
          join(dir, e.name),
          new ValidationError(`not ${what} file (<id>.yml)`, [e.name]),
        );
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return ids.sort();
}

/**
 * Static validation: task.yml schemas and files, the symbols lock, task
 * hashes, the catalog, every config (model ids against the catalog) and
 * every experiment (its configs, `vary` on config values, its `tasks`
 * pattern). It does not run authoring gates, compile anything, or check
 * runtime comparability (image, MCP versions); those need Part 2. Every
 * problem is collected and every line names the file it came from; they
 * are thrown together as a ConfigurationError when all are config
 * problems, otherwise as a ValidationError.
 */
export async function validateHarness(repoRoot: string): Promise<string[]> {
  const lines: string[] = [];
  const problems: Array<{ config: boolean; lines: string[] }> = [];
  const problem: Problem = (file, err) => {
    if (!isProblem(err)) throw err;
    problems.push({
      config: err instanceof ConfigurationError,
      lines: err.message.split("\n").map((l) => l.trim()).filter((l) => l)
        .map((l) => (l.includes(file) ? l : `${file}: ${l}`)),
    });
  };

  const tasksDir = join(repoRoot, "harness-tasks", "tasks");
  let tasks: LoadedTask[] | null = null;
  try {
    tasks = await loadTaskSet(tasksDir);
    const ids = await taskSetIdentity(
      repoRoot,
      tasks,
      await loadSymbolsLock(repoRoot),
    );
    lines.push(
      `${colors.green("[OK]")} ${tasks.length} tasks, task set ${
        ids.identity.slice(0, 12)
      }${
        ids.provisional ? colors.yellow(" (provisional: no symbols lock)") : ""
      }`,
    );
  } catch (err) {
    problem(tasksDir, err);
  }

  // Always read the catalog; a bad catalog is one problem, not one per config.
  const catalogDir = join(repoRoot, "site", "catalog");
  const catalogFile = join(catalogDir, "models.yml");
  let catalogOk = true;
  try {
    await checkModelsInCatalog([], catalogDir);
  } catch (err) {
    catalogOk = false;
    problem(catalogFile, err);
  }
  const inCatalog = async (configs: HarnessConfig[]) => {
    if (catalogOk) await checkModelsInCatalog(configs, catalogDir);
  };

  const harnessRoot = join(repoRoot, "harness");
  const configsDir = join(harnessRoot, "configs");
  const configIds = await ymlIds(configsDir, "a config", problem);
  for (const id of configIds) {
    try {
      await inCatalog([await loadConfig(harnessRoot, id)]);
    } catch (err) {
      problem(join(configsDir, `${id}.yml`), err);
    }
  }

  const expDir = join(harnessRoot, "experiments");
  for (const name of await ymlIds(expDir, "an experiment", problem)) {
    const file = join(expDir, `${name}.yml`);
    const before = problems.length;
    let loaded: LoadedExperiment;
    try {
      loaded = await loadExperiment(harnessRoot, name);
      await inCatalog(loaded.configs);
    } catch (err) {
      problem(file, err);
      continue;
    }
    for (const p of varyProblems(loaded)) {
      problem(file, new ConfigurationError(p, file));
    }
    if (tasks !== null) {
      const pattern = loaded.experiment.tasks;
      const re = globToRegExp(pattern, { globstar: true });
      if (
        !tasks.some((t) =>
          re.test(relative(repoRoot, t.dir).replaceAll("\\", "/"))
        )
      ) {
        const p = `tasks pattern ${pattern} matches no task`;
        problem(file, new ValidationError(p, [p]));
      }
    }
    if (problems.length === before) {
      lines.push(
        `${
          colors.green("[OK]")
        } experiment ${name} (${loaded.configs.length} arms)`,
      );
    }
  }

  if (problems.length > 0) {
    const all = problems.flatMap((p) => p.lines);
    const message = problems.length === 1
      ? all.join("\n")
      : `${problems.length} problems:\n${all.join("\n")}`;
    throw problems.every((p) => p.config)
      ? new ConfigurationError(message, repoRoot)
      : new ValidationError(message, all);
  }
  lines.push(
    colors.dim(
      "Static checks only: no authoring gate, compile or runtime comparability.",
    ),
  );
  lines.push(
    `${
      colors.green("[OK]")
    } ${configIds.length} configs, model ids in ${catalogFile}`,
  );
  return lines;
}

export interface ReportOptions {
  resultsDir: string;
  campaign?: string | undefined;
  resamples: number;
  seed: number;
  /** "current" judges with the oracles of the working tree under `root`. */
  judging: "campaign" | "current";
  root: string;
  /** Report repeats 1..N only (M5-05); default all planned. */
  repeats?: number | undefined;
}

async function currentJudging(root: string): Promise<JudgingContext> {
  const tasks = await loadTaskSet(join(root, "harness-tasks", "tasks"));
  const ids = await taskSetIdentity(root, tasks, await loadSymbolsLock(root));
  return {
    source: "current",
    oracle: new Map(ids.tasks.map((t) => [t.id, t.oracle])),
  };
}

/**
 * Build the report for an experiment's newest (or named) campaign.
 * buildReport runs validateCampaignRecords first, so inconsistent records
 * are refused before any number.
 */
export async function harnessReport(
  experimentId: string,
  opts: ReportOptions,
): Promise<HarnessReport> {
  const store = new RecordStore(opts.resultsDir);
  const campaigns = await store.campaigns(experimentId);
  const campaign = opts.campaign
    ? campaigns.find((c) => c.id === opts.campaign)
    : campaigns[0];
  if (!campaign) {
    throw new CentralGaugeError(
      `No campaign${
        opts.campaign ? ` ${opts.campaign}` : ""
      } for experiment ${experimentId} in ${opts.resultsDir}`,
      "HARNESS_NO_CAMPAIGN",
    );
  }
  const executions = await store.executions(campaign.id);
  const artifacts: ArtifactRecord[] = [];
  const judgments: JudgmentRecord[] = [];
  for (const e of executions) {
    const a = await store.artifact(e.id);
    if (a) artifacts.push(a);
    judgments.push(...await store.judgments(e.id));
  }
  const records = { campaign, executions, artifacts, judgments };
  return buildReport(records, {
    resamples: opts.resamples,
    seed: opts.seed,
    ...(opts.repeats !== undefined ? { repeats: opts.repeats } : {}),
    logs: await loadReportLogs(opts.resultsDir, records),
    traces: await loadTraces(opts.resultsDir, executions),
    ...(opts.judging === "current"
      ? { judging: await currentJudging(opts.root) }
      : {}),
  });
}

export interface CellCliOptions {
  root: string;
  resultsDir: string;
  containers: string[];
  backendHost?: string | undefined;
  backendPort: number;
  secretsDir: string;
  symbolStore: string;
  privateDir: string;
  credentialLedger: string | null;
  supervised: boolean;
  repeat: number;
  rev: string | null;
  /** Qualification manifest naming the variants mock arms apply (M1-35). */
  qualifyManifest?: string | null;
  /** Stub-provider scenario (M2-08): no credential, records under <results>/stub-cells, never judged. */
  stubProvider?: string | null;
  /** Another image of the same harness (sha256 id); only with stubProvider. */
  image?: string | null;
  /** M1-34 Step 11: record the OAuth hosts (qualified marker, supervised Claude arm, ledger). */
  recordOAuthHosts?: boolean;
}

type Opener = (o: EnvOptions) => Promise<OpenEnv>;
type OnInterrupt = (cb: () => void) => () => void;

const sigint: OnInterrupt = (cb) => {
  Deno.addSignalListener("SIGINT", cb);
  return () => Deno.removeSignalListener("SIGINT", cb);
};

function envOptions(
  o: CellCliOptions,
  resultsDir: string,
  command: string,
): EnvOptions {
  return {
    repoRoot: o.root,
    resultsDir,
    containers: o.containers,
    backendHost: o.backendHost,
    backendPort: o.backendPort,
    secretsSource: o.secretsDir,
    symbolStore: o.symbolStore,
    privateRoot: o.privateDir,
    credentialLedger: o.credentialLedger,
    command,
    supervised: o.supervised,
  };
}

/** Who may run this arm now (egress decision, round 2 item 9). */
export function cellGate(
  adapter: HarnessAdapter,
  o: { supervised: boolean; egressEnforced: boolean },
  isTerminal: () => boolean,
): void {
  if (!adapter.credentialBearing || o.egressEnforced) return;
  if (!o.supervised) {
    throw new ConfigurationError(
      `${adapter.harness} carries credentials: pass --supervised until egress enforcement is verified`,
    );
  }
  if (!isTerminal()) {
    throw new ConfigurationError(
      "a supervised run must be started from an interactive terminal",
    );
  }
}

/** One cell; records under results/harness/cells (a complete results root). */
export async function harnessCell(
  configId: string,
  taskId: string,
  o: CellCliOptions,
  open: Opener = openHarnessEnv,
  isTerminal: () => boolean = () => Deno.stdin.isTerminal(),
  onInterrupt: OnInterrupt = sigint,
): Promise<CellResult> {
  const stubScenario = o.stubProvider ?? null;
  if (o.image && !stubScenario) {
    throw new ConfigurationError(
      "--image runs another image only in a stub cell: pass --stub-provider",
    );
  }
  if (o.image && !/^sha256:[0-9a-f]{64}$/.test(o.image)) {
    throw new ConfigurationError(
      `--image must be a sha256 image id: ${o.image}`,
    );
  }
  // Checked before anything opens: a bad scenario never reaches a sandbox.
  const scenario = stubScenario ? await readScenario(stubScenario) : null;
  const config = await loadConfig(join(o.root, "harness"), configId);
  await checkModelsInCatalog([config], join(o.root, "site", "catalog"));
  const catalog = await readCatalog(join(o.root, "site", "catalog"));
  const adapter = adapterFor(config.harness);
  const h = await open(
    envOptions(
      o,
      join(o.resultsDir, scenario ? "stub-cells" : "cells"),
      `harness cell ${configId} ${taskId}`,
    ),
  );
  const stop = new AbortController();
  const unhook = onInterrupt(() => {
    console.log(
      `${colors.yellow("[PAUSE]")} interrupt: stopping the sandbox now`,
    );
    stop.abort();
  });
  let stubDir: string | null = null;
  try {
    if (scenario !== null) {
      stubDir = join(
        h.env.privateRoot,
        "work",
        `stub-${crypto.randomUUID().slice(0, 8)}`,
      );
      await Deno.mkdir(stubDir, { recursive: true });
      await Deno.copyFile(
        STUB_SCRIPT,
        join(stubDir, "stub-anthropic.mjs"),
      );
      await Deno.writeTextFile(join(stubDir, "scenario.json"), scenario);
    }
    const env = {
      ...h.env,
      stop: stop.signal,
      ...(o.recordOAuthHosts ? { recordOAuthHosts: true } : {}),
      ...(o.qualifyManifest
        ? { qualifyManifest: await loadQualifyManifest(o.qualifyManifest) }
        : {}),
      ...(stubDir
        ? {
          stubProvider: {
            dir: stubDir,
            ...(o.image ? { imageOverride: o.image } : {}),
          },
        }
        : {}),
    };
    // A stub cell releases no credential: the supervision gate does not apply.
    if (!stubDir) cellGate(adapter, env, isTerminal);
    const facts = runtimeFacts(
      config,
      await imageFacts(
        env.docker,
        imageTag(config.harness, config.harness_version),
        env.owner,
      ),
      adapter,
      catalog,
      config.components.mcp.length > 0 ? await mcpDefinitions(o.root) : {},
    );
    const armManifest = await resolveManifest(env.harnessRoot, config, facts);
    const at = await loadTaskAt(
      o.root,
      taskId,
      o.rev,
      join(env.privateRoot, "work", `task-${crypto.randomUUID().slice(0, 8)}`),
    );
    const ids = await taskSetIdentity(o.root, [at.task], env.symbols);
    if (!stubDir && adapter.credentialBearing && !env.egressEnforced) {
      console.log(
        `${
          colors.yellow("[PAUSE]")
        } supervised run: watch network activity; press Ctrl+C on anything unexpected`,
      );
    }
    const r = await runCell(env, {
      campaignId: crypto.randomUUID(),
      block: { index: 0, task_id: taskId, repeat: o.repeat, order: [configId] },
      orderInBlock: 0,
      arm: configId,
      armManifest,
      armManifestHash: await manifestHash(armManifest),
      task: at.task,
      taskVisibleHash: ids.tasks[0]!.visible,
      oracleHash: ids.tasks[0]!.oracle,
      refapp: await resolveRefapp(o.root, at.task.task.refapp_version),
    });
    for (const e of r.executions) {
      const j = (await env.store.judgments(e.id))[0];
      console.log(
        `${colors.green("[OK]")} ${e.id} ${e.termination}${
          j ? `, verdict ${j.verdict}` : ""
        }, cost ${e.telemetry.cost_usd ?? "unknown"} USD`,
      );
    }
    if (r.withheld) console.log(`${colors.yellow("[WARN]")} ${r.withheld}`);
    if (r.stopped) console.log(`${colors.yellow("[WARN]")} ${r.stopped}`);
    return r;
  } finally {
    unhook();
    // The attempt persisted its mode; recovery never needs the stub dir.
    if (stubDir) {
      await Deno.remove(stubDir, { recursive: true }).catch(() => {});
    }
    await h.close();
  }
}

/** The stub ships with the harness code, not with the repository under test. */
const STUB_SCRIPT = fromFileUrl(
  new URL("../../scripts/harness/stub-anthropic.mjs", import.meta.url),
);

/** The stub scenario, checked with the stub's own validator (M2-04). */
async function readScenario(path: string): Promise<string> {
  const text = await Deno.readTextFile(path);
  try {
    checkScenario(JSON.parse(text));
  } catch (err) {
    throw new ConfigurationError(
      `stub scenario ${path}: ${err instanceof Error ? err.message : err}`,
    );
  }
  return text;
}

/** Judge a task variant without an agent; persists the complete judgment and its provenance; writes no execution. */
export async function harnessJudgeFixture(
  taskId: string,
  variant: string,
  o: CellCliOptions & { manifest: string | null },
  open: Opener = openHarnessEnv,
): Promise<JudgmentRecord> {
  if (!/^(correct|reference-tests|naive\/[A-Za-z0-9_-]+)$/.test(variant)) {
    throw new ConfigurationError(
      `variant must be correct, reference-tests or naive/<name>, got ${variant}`,
    );
  }
  if (o.manifest) {
    const why = variantAllowed(
      await loadQualifyManifest(o.manifest),
      taskId,
      variant,
      o.rev,
    );
    if (why) throw new ConfigurationError(why);
  }
  const command = `harness judge-fixture ${taskId} ${variant}${
    o.rev ? ` --rev ${o.rev}` : ""
  }`;
  const h = await open(envOptions(o, join(o.resultsDir, "fixtures"), command));
  const scratch = join(
    h.env.privateRoot,
    "work",
    `fixture-${crypto.randomUUID().slice(0, 8)}`,
  );
  try {
    await Deno.mkdir(join(scratch, "task"), { recursive: true });
    const at = await loadTaskAt(o.root, taskId, o.rev, join(scratch, "task"));
    const task = at.task;
    if (
      !await Deno.stat(join(task.dir, variant)).then(
        (s) => s.isDirectory,
        () => false,
      )
    ) {
      throw new ConfigurationError(
        `${taskId} has no variant ${variant}${o.rev ? ` at ${o.rev}` : ""}`,
      );
    }
    const refapp = await resolveRefapp(o.root, task.task.refapp_version);
    const staged = await TASK_SOURCES[task.task.source]({
      repoRoot: o.root,
      task,
      refapp,
      symbols: h.env.symbols,
      symbolStore: h.env.symbolStore,
      out: join(scratch, "stage"),
    });
    const ws = join(scratch, "ws");
    await safeCopyTree(staged.pristine, ws);
    await applyOverlay(join(task.dir, variant), ws);
    const frozen = await freezeWorkspace({
      resultsRoot: h.env.resultsRoot,
      privateRoot: h.env.privateRoot,
      workspace: ws,
      secrets: [],
      ...(h.env.scanReparsePoints
        ? { scanReparsePoints: h.env.scanReparsePoints }
        : {}),
    });
    const ids = await taskSetIdentity(o.root, [task], h.env.symbols);
    const { judgment, log } = await judge(h.env.lane, {
      executionId: crypto.randomUUID(),
      workspaceHash: frozen.workspace_hash,
      task,
      oracleHash: await oracleHash(task),
      pristine: staged.pristine,
      artifact: join(h.env.resultsRoot, frozen.stored_path),
      symbolIds: new Set(h.env.symbols.map((s) => s.app_id.toLowerCase())),
      workDir: join(scratch, "judge"),
      lock: { store: h.env.symbolStore, packages: h.env.symbols },
      deploy: h.env.deploy,
    }, h.env.now);
    const out = join(o.resultsDir, "fixtures", taskId, variant, judgment.id);
    await Deno.mkdir(out, { recursive: true });
    await Deno.writeTextFile(
      join(out, "judgment.json"),
      JSON.stringify(judgment, null, 2) + "\n",
    );
    await Deno.writeTextFile(
      join(out, "provenance.json"),
      JSON.stringify(
        {
          v: 1,
          task_id: taskId,
          variant,
          variant_tree_hash: await hashTree(join(task.dir, variant), "task"),
          rev: o.rev,
          task_commit: at.commit,
          task_tree: at.tree,
          task_visible_hash: ids.tasks[0]!.visible,
          oracle_hash: ids.tasks[0]!.oracle,
          refapp: { version: refapp.version, commit: refapp.commit },
          workspace_hash: frozen.workspace_hash,
          scorer_fingerprint: judgment.scorer_fingerprint,
          containers: log.containers,
          command,
        },
        null,
        2,
      ) + "\n",
    );
    await writeVerdictLog(h.env.resultsRoot, log);
    console.log(
      `${
        judgment.verdict === "pass"
          ? colors.green("[OK]")
          : colors.red("[FAIL]")
      } ${taskId} ${variant}: ${judgment.verdict} (${out})`,
    );
    return judgment;
  } finally {
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
    await h.close();
  }
}

async function servercorePin(root: string): Promise<string> {
  let pins: { servercore?: string };
  try {
    pins = JSON.parse(
      await Deno.readTextFile(join(root, "harness", "images", "pins.json")),
    );
  } catch {
    throw new ConfigurationError(
      "harness/images/pins.json is missing or unreadable (M1-26 resolves the servercore digest)",
    );
  }
  if (!pins.servercore || !/@sha256:[0-9a-f]{64}$/.test(pins.servercore)) {
    throw new ConfigurationError(
      `pins.json servercore must be pinned as <image>@sha256:<digest>, got ${pins.servercore}`,
    );
  }
  return pins.servercore;
}

/**
 * Base image from the digest pin; a harness image from the inspected base.
 * Provenance is checked, not asserted: the build gets the inspected base id
 * (never the tag), and the new image's layers must start with that id's
 * layers.
 */
export async function harnessImagesBuild(
  harness: string,
  o: { root: string; version?: string },
  docker: DockerCli = realDocker(),
): Promise<ImageFacts> {
  const images = join(o.root, "harness", "images");
  if (harness === "base") {
    const pin = await servercorePin(o.root);
    const [mk, mv] = await mcpLabel(o.root);
    const code = await docker.build([
      "build",
      "-f",
      join(images, "base", "Dockerfile.windows"),
      "--build-arg",
      `SERVERCORE=${pin}`,
      "--label",
      `${mk}=${mv}`,
      "-t",
      BASE_IMAGE,
      join(images, "base"),
    ]);
    if (code !== 0) {
      throw new ConfigurationError(`base image build failed (exit ${code})`);
    }
    const img = await docker.inspectImage(BASE_IMAGE) as {
      Id?: string;
      Config?: { Labels?: Record<string, string> | null };
    } | null;
    if (!img?.Id) {
      throw new ConfigurationError(`${BASE_IMAGE} is missing after the build`);
    }
    // The base carries no harness labels, so imageFacts does not apply; its
    // MCP labels are read back with the same parser and must match the build.
    const labels = img.Config?.Labels ?? {};
    const mcp = mcpFacts(BASE_IMAGE, labels);
    if (labels[mk] !== mv) {
      throw new ConfigurationError(
        `image ${BASE_IMAGE}: label ${mk} did not land on the built image (want "${mv}", got "${
          labels[mk] ?? ""
        }")`,
      );
    }
    console.log(`${colors.green("[OK]")} ${BASE_IMAGE} = ${img.Id}`);
    return {
      digest: img.Id,
      base_digest: pin,
      harness: "base",
      version: "1",
      mcp,
    };
  }
  if (!o.version) throw new ConfigurationError(`pass --version for ${harness}`);
  const base = await docker.inspectImage(BASE_IMAGE) as { Id?: string } | null;
  if (!base?.Id) {
    throw new ConfigurationError(
      "build the base image first: centralgauge harness images build base",
    );
  }
  const tag = imageTag(harness, o.version);
  const code = await docker.build([
    "build",
    "-f",
    join(images, harness, "Dockerfile.windows"),
    "--build-arg",
    // The inspected immutable id, never the tag: a tag moved between inspect
    // and build cannot change the base this image is recorded against.
    `BASE=${base.Id}`,
    "--label",
    `${IMAGE_LABELS.harness}=${harness}`,
    "--label",
    `${IMAGE_LABELS.version}=${o.version}`,
    "--label",
    `${IMAGE_LABELS.base}=${base.Id}`,
    "-t",
    tag,
    join(images, harness),
  ]);
  if (code !== 0) {
    throw new ConfigurationError(`${tag} build failed (exit ${code})`);
  }
  if (!await hasBaseLayers(docker, tag, base.Id)) {
    throw new ConfigurationError(
      `${tag} was not built on base ${base.Id}: the layers do not start with the base's layers`,
    );
  }
  // Same owner as a harness env (the hostname): a leftover read container is swept.
  const f = await imageFacts(docker, tag, Deno.hostname());
  console.log(`${colors.green("[OK]")} ${tag} = ${f.digest} (base ${base.Id})`);
  console.log(
    `  labels: ${IMAGE_LABELS.harness}=${f.harness} ${IMAGE_LABELS.version}=${f.version} ${IMAGE_LABELS.base}=${f.base_digest}`,
  );
  return f;
}

export async function harnessSymbolsLock(
  o: { root: string; from: string; store: string; altool?: string },
  read: ManifestReader = altoolReader(o.altool ?? defaultAltool(o.from)),
): Promise<number> {
  const lock = await buildSymbolsLock(o.from, o.store, read);
  await writeSymbolsLock(o.root, lock);
  return lock.packages.length;
}

interface CellCliFlags {
  resultsDir: string;
  containers: string;
  backendHost?: string;
  backendPort: number;
  secretsDir: string;
  symbolStore: string;
  privateDir?: string;
  credentialLedger?: string;
  supervised?: boolean;
  repeat?: number;
  rev?: string;
  qualifyManifest?: string;
  stubProvider?: string;
  image?: string;
  recordOauthHosts?: boolean;
}

/** Relative directories against the cwd; --containers split on commas; the ledger from the flag or CG_CREDENTIAL_LEDGER. */
function cliOpts(f: CellCliFlags): CellCliOptions {
  const cwd = Deno.cwd();
  const abs = (p: string) => resolve(cwd, p);
  const local = Deno.env.get("LOCALAPPDATA");
  const privateDir = f.privateDir ??
    (local ? join(local, "centralgauge", "harness") : null);
  if (!privateDir) {
    throw new ConfigurationError(
      "pass --private-dir (LOCALAPPDATA is not set)",
    );
  }
  const ledger = f.credentialLedger ?? Deno.env.get("CG_CREDENTIAL_LEDGER");
  return {
    root: cwd,
    resultsDir: abs(f.resultsDir),
    containers: f.containers.split(",").map((c) => c.trim()).filter(Boolean),
    backendHost: f.backendHost,
    backendPort: f.backendPort,
    secretsDir: abs(f.secretsDir),
    symbolStore: abs(f.symbolStore),
    privateDir: abs(privateDir),
    credentialLedger: ledger ? abs(ledger) : null,
    supervised: f.supervised === true,
    repeat: f.repeat ?? 1,
    rev: f.rev ?? null,
    qualifyManifest: f.qualifyManifest ? abs(f.qualifyManifest) : null,
    stubProvider: f.stubProvider ? abs(f.stubProvider) : null,
    image: f.image ?? null,
    recordOAuthHosts: f.recordOauthHosts === true,
  };
}

export interface RunCliOptions extends CellCliOptions {
  dryRun: boolean;
  sample?: number;
  repeats?: number;
  concurrency: number;
  seed?: number;
  /** Longest usage-limit pause to wait out; 0 stops with a resume line. */
  maxPauseMin: number;
  /** rejudge: skip the confirmation. */
  yes?: boolean;
  /** rejudge: only this execution. */
  execution?: string;
  /** run: any of these present stops the campaign before its next cell. */
  stopFiles?: string[];
  /** run: resume exactly this campaign; rejudge: this campaign, not the newest. */
  campaign?: string;
  /** run: rerun only this unscored cell as a manual_rerun. */
  rerun?: RerunCell;
}

type RerunCell = NonNullable<RunOptions["rerun"]>;

/** `--rerun <task:repeat:arm>`: a positive safe-integer repeat, non-empty task and arm. */
export function parseRerunCell(value: string): RerunCell {
  const m = /^([^:]+):([1-9][0-9]*):([^:]+)$/.exec(value);
  if (!m || !Number.isSafeInteger(Number(m[2]))) {
    throw new ValidationError(
      `--rerun expects <task:repeat:arm>, got ${value}`,
      [value],
    );
  }
  return { task: m[1]!, repeat: Number(m[2]), arm: m[3]! };
}

type Planner = (o: EnvOptions) => Promise<PlanEnv>;

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `harness run`: a campaign (spec 1a section 6); a dry run takes no lock and opens no container. */
export async function harnessRun(
  experimentId: string,
  o: RunCliOptions,
  open: Opener = openHarnessEnv,
  plan: Planner = (eo) => openPlanEnv(eo),
  sleep: (ms: number) => Promise<void> = sleepMs,
): Promise<CampaignSummary> {
  const catalogDir = join(o.root, "site", "catalog");
  const { configs } = await loadExperiment(
    join(o.root, "harness"),
    experimentId,
  );
  await checkModelsInCatalog(configs, catalogDir);
  const io = {
    log: (l: string) => console.log(l),
    sleep,
    catalog: await readCatalog(catalogDir),
  };
  const ro = {
    concurrency: o.concurrency,
    maxPauseMs: o.maxPauseMin * 60_000,
    ...(o.sample !== undefined ? { sample: o.sample } : {}),
    ...(o.repeats !== undefined ? { repeats: o.repeats } : {}),
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
    ...(o.stopFiles !== undefined ? { stopFiles: o.stopFiles } : {}),
    ...(o.campaign !== undefined ? { campaign: o.campaign } : {}),
    ...(o.rerun !== undefined ? { rerun: o.rerun } : {}),
  };
  const command = `harness run ${experimentId}`;
  // M1-33c: before any lock, sweep or recovery writes (runCampaign rechecks).
  if (
    o.concurrency > 1 &&
    await markerPlaces(join(o.root, "results", "harness"))
  ) {
    throw new ConfigurationError(PLACED_CONCURRENCY_REFUSAL);
  }
  // M5-03 review: the pin, read-only, before any lock, sweep or recovery (runCampaign rechecks, with the arm manifests).
  if (o.campaign !== undefined) {
    await precheckCampaignPin(
      o.root,
      new RecordStore(o.resultsDir),
      experimentId,
      o.campaign,
    );
  }
  if (o.dryRun) {
    const s = await planCampaign(
      await plan(envOptions(o, o.resultsDir, `${command} --dry-run`)),
      experimentId,
      ro,
      io,
    );
    console.log(
      `${colors.dim("[DRY]")} ${s.planned} cells in ${
        s.campaignId ? `campaign ${s.campaignId}` : "a new campaign"
      }; nothing written`,
    );
    return s;
  }
  const h = await open({
    ...envOptions(o, o.resultsDir, command),
    concurrency: o.concurrency,
  });
  try {
    const env = o.qualifyManifest
      ? {
        ...h.env,
        qualifyManifest: await loadQualifyManifest(o.qualifyManifest),
      }
      : h.env;
    const s = await runCampaign(
      env,
      experimentId,
      { ...ro, dryRun: false },
      io,
    );
    console.log(
      `${colors.green("[OK]")} campaign ${s.campaignId}${
        s.created ? " (new)" : ""
      }: ${s.ran} executions, ${s.judged} judged, ${s.unscored} unscored${
        s.paused ? `, paused until ${s.paused}` : ""
      }${s.stopped ? ", stopped by a stop file" : ""}`,
    );
    return s;
  } finally {
    await h.close();
  }
}

/** The newest judgment of an execution, by ended_at then id. */
function latestJudgment(js: JudgmentRecord[]): JudgmentRecord | undefined {
  return [...js].sort((a, b) =>
    compareInstant(b.ended_at, a.ended_at) || (a.id < b.id ? 1 : -1)
  )[0];
}

const askUser = (q: string) => confirm(q);

/** The campaign rejudge works on (named, else newest), with --execution in it. */
async function rejudgeTarget(
  store: RecordStore,
  experimentId: string,
  o: RunCliOptions,
): Promise<CampaignRecord> {
  const campaigns = await store.campaigns(experimentId);
  const c = o.campaign
    ? campaigns.find((x) => x.id === o.campaign)
    : campaigns[0];
  if (!c) {
    throw new ConfigurationError(
      `no campaign${
        o.campaign ? ` ${o.campaign}` : ""
      } for experiment ${experimentId} in ${o.resultsDir}`,
    );
  }
  if (
    o.execution &&
    !(await store.executions(c.id)).some((e) => e.id === o.execution)
  ) {
    throw new ConfigurationError(
      `execution ${o.execution} is not in campaign ${c.id}`,
    );
  }
  return c;
}

/**
 * `harness rejudge` (answer 15): judge stored executions again with the
 * current scorer suite and the current oracle (recorded as such in the
 * judgment's task_oracle_hash), never re-running the agent. Refused unless
 * the records validate, every campaign task is present, and each restaged
 * task has the execution's visible-input hash. Asks unless --yes.
 */
export async function harnessRejudge(
  experimentId: string,
  o: RunCliOptions,
  open: Opener = openHarnessEnv,
  ask: (question: string) => boolean = askUser,
): Promise<{ campaignId: string; rejudged: number }> {
  // M5-03 review: read-only, before any lock, sweep or recovery; again under the env.
  await rejudgeTarget(new RecordStore(o.resultsDir), experimentId, o);
  const h = await open(
    envOptions(o, o.resultsDir, `harness rejudge ${experimentId}`),
  );
  try {
    const env = h.env;
    const c = await rejudgeTarget(env.store, experimentId, o);
    const data = await loadCampaignData(env.store, c);
    await validateCampaignRecords(data);
    const tasks = new Map(
      (await loadTaskSet(join(o.root, "harness-tasks", "tasks"))).map((
        t,
      ) => [t.task.id, t]),
    );
    const missing = c.task_set.tasks.filter((t) => !tasks.has(t.id));
    if (missing.length > 0) {
      throw new ConfigurationError(
        `rejudge needs every campaign task; missing: ${
          missing.map((t) => t.id).join(", ")
        }`,
      );
    }
    const current = await currentScorerFingerprint();
    // Current identities of every campaign task: the oracle decides what is due.
    const ids = await taskSetIdentity(
      o.root,
      c.task_set.tasks.map((t) => tasks.get(t.id)!),
      env.symbols,
    );
    const byTask = new Map(ids.tasks.map((t) => [t.id, t]));
    // Due: never judged, unscored, an old scorer suite, or an old oracle (so
    // a planned result never stays on an oracle a manual rerun has left).
    const due = data.executions.filter((e) => {
      if (o.execution && e.id !== o.execution) return false;
      if (!outcomePolicy(e.termination, e.did_work).judge) return false;
      const j = latestJudgment(
        data.judgments.filter((x) => x.execution_id === e.id),
      );
      return !j || j.verdict === "unscored" ||
        j.scorer_fingerprint !== current ||
        j.task_oracle_hash !== byTask.get(e.task_id)!.oracle;
    });
    const used = [...new Set(due.map((e) => e.task_id))].map((id) =>
      tasks.get(id)!
    );
    const changed = due.filter((e) =>
      byTask.get(e.task_id)!.visible !== e.task_visible_hash
    );
    if (changed.length > 0) {
      throw new ConfigurationError(
        `restaged visible inputs differ from the execution's for ${
          [...new Set(changed.map((e) => e.task_id))].join(", ")
        }: rejudge refused (the task changed since those executions ran)`,
      );
    }
    if (due.length === 0) {
      console.log(
        `${colors.green("[OK]")} nothing to rejudge in campaign ${c.id}`,
      );
      return { campaignId: c.id, rejudged: 0 };
    }
    if (
      !o.yes &&
      !ask(
        `Rejudge ${due.length} execution(s) of campaign ${c.id} with the current scorer suite and the current oracle?`,
      )
    ) {
      console.log(`${colors.yellow("[SKIP]")} rejudge not confirmed`);
      return { campaignId: c.id, rejudged: 0 };
    }
    const opened: OpenedTasks = { tasks, refapps: new Map() };
    for (const t of used) {
      const v = t.task.refapp_version;
      if (!opened.refapps.has(v)) {
        opened.refapps.set(v, await resolveRefapp(o.root, v));
      }
    }
    for (const e of due) {
      const oracle = byTask.get(e.task_id)!.oracle;
      const cell = cellRefFor(
        c,
        opened,
        c.blocks[e.block]!,
        e.arm,
        e.order_in_block,
      );
      const j = await rejudgeExecution(env, cell, e, oracle);
      console.log(
        `${colors.green("[OK]")} ${e.id}: ${j.verdict} (current oracle ${
          oracle.slice(0, 12)
        })`,
      );
    }
    return { campaignId: c.id, rejudged: due.length };
  } finally {
    await h.close();
  }
}

/** Failing oracle rows, or the surviving mutants of mutant_kill (the verdict's own rule). */
function judgmentReasons(j: JudgmentRecord): string[] {
  const out: string[] = [];
  for (const s of j.scorers) {
    if (s.passed !== false) continue;
    if (s.name === "mutant_kill") {
      const mutants = [
        ...new Set(
          s.tests.map((t) => t.target).filter((x) => x.startsWith("mutant:")),
        ),
      ];
      for (const m of mutants) {
        const rows = s.tests.filter((t) => t.target === m);
        if (mutantOutcome(rows) === "survived") {
          out.push(`mutant_kill: ${m} survived`);
        }
      }
    } else {
      for (const t of s.tests) {
        if (t.outcome !== "pass") {
          out.push(
            `${s.name}: ${t.codeunit} ${t.procedure} (${t.target}) ${t.outcome}/${t.failure}`,
          );
        }
      }
    }
  }
  return out;
}

const posixRel = (from: string, to: string) =>
  relative(from, to).replaceAll("\\", "/");

/**
 * One mock cell (M1-35) applying a manifest variant at its rev: the pipeline
 * check beside judge-fixture. An internal mock arm, not a repo config.
 */
async function qualifyMockCell(
  env: HarnessEnv,
  root: string,
  taskId: string,
  variant: string,
  rev: string,
  manifest: QualifyManifest,
): Promise<{ execution_id: string; verdict: string }> {
  const config = HarnessConfigSchema.parse({
    id: "mock-qualify",
    harness: "mock",
    harness_version: "1",
    models: {},
    settings: {
      mode: "apply",
      variant: variant.startsWith("naive/")
        ? `naive:${variant.slice("naive/".length)}`
        : "positive",
    },
    limits: { timeout_min: 30, max_budget_usd: 1 },
  });
  const facts = runtimeFacts(
    config,
    await imageFacts(
      env.docker,
      imageTag(config.harness, config.harness_version),
      env.owner,
    ),
    adapterFor(config.harness),
    await readCatalog(join(root, "site", "catalog")),
  );
  const armManifest = await resolveManifest(env.harnessRoot, config, facts);
  const at = await loadTaskAt(
    root,
    taskId,
    rev,
    join(env.privateRoot, "work", `qualify-${crypto.randomUUID().slice(0, 8)}`),
  );
  const ids = await taskSetIdentity(root, [at.task], env.symbols);
  const r = await runCell(
    { ...env, supervised: false, qualifyManifest: manifest },
    {
      campaignId: crypto.randomUUID(),
      block: { index: 0, task_id: taskId, repeat: 1, order: [config.id] },
      orderInBlock: 0,
      arm: config.id,
      armManifest,
      armManifestHash: await manifestHash(armManifest),
      task: at.task,
      taskVisibleHash: ids.tasks[0]!.visible,
      oracleHash: ids.tasks[0]!.oracle,
      refapp: await resolveRefapp(root, at.task.task.refapp_version),
    },
  );
  const last = r.executions.at(-1)!;
  const j = latestJudgment(await env.store.judgments(last.id));
  return { execution_id: last.id, verdict: j?.verdict ?? "unscored" };
}

/**
 * `harness qualify --manifest` (the agreed M4-14/M4-15 contract): per task at
 * its rev, judge-fixture for the positive and every named naive variant plus
 * one mock cell each; index at results/harness/qualify/<manifest sha256>/.
 */
export async function harnessQualify(
  o: CellCliOptions & { manifest: string },
  open: Opener = openHarnessEnv,
): Promise<{ path: string; data: unknown }> {
  const m = await loadQualifyManifest(o.manifest);
  const sha = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await Deno.readFile(o.manifest)),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
  const out = join(o.resultsDir, "qualify", sha);
  const h = await open(
    envOptions(o, out, `harness qualify --manifest ${o.manifest}`),
  );
  // judge-fixture shares this environment (one lock, one backend).
  const shared: Opener = () =>
    Promise.resolve({ env: h.env, close: () => Promise.resolve() });
  try {
    const entries = [];
    for (const [taskId, t] of Object.entries(m.tasks).sort()) {
      for (
        const variant of [t.positive, ...t.naive.map((n) => `naive/${n}`)]
      ) {
        const j = await harnessJudgeFixture(taskId, variant, {
          ...o,
          rev: t.rev,
        }, shared);
        const dir = join(o.resultsDir, "fixtures", taskId, variant, j.id);
        entries.push({
          task: taskId,
          variant,
          rev: t.rev,
          judgment_path: posixRel(o.root, join(dir, "judgment.json")),
          provenance_path: posixRel(o.root, join(dir, "provenance.json")),
          verdict: j.verdict,
          expected: variant === t.positive ? "pass" : "fail",
          reasons: judgmentReasons(j),
          targets: [
            ...new Set(j.scorers.flatMap((s) => s.tests.map((x) => x.target))),
          ].sort(),
          mock_cell: await qualifyMockCell(
            h.env,
            o.root,
            taskId,
            variant,
            t.rev,
            m,
          ),
        });
      }
    }
    const data = {
      v: 1,
      manifest: o.manifest,
      manifest_sha256: sha,
      refapp_version: m.refapp_version,
      entries,
    };
    await Deno.mkdir(out, { recursive: true });
    const path = join(out, "index.json");
    await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n");
    const bad = entries.filter((e) =>
      e.verdict !== e.expected || e.mock_cell.verdict !== e.expected
    );
    console.log(
      `${bad.length === 0 ? colors.green("[OK]") : colors.red("[FAIL]")} ${
        entries.length - bad.length
      }/${entries.length} variants as expected (${path})`,
    );
    return { path, data };
  } finally {
    await h.close();
  }
}

/** Credentials M1-34 Step 10 rotates before authorization (names in the rotation record). */
export const ROTATED_CREDENTIALS = ["claude-oauth", "openrouter"] as const;

export interface EgressVerifyOptions {
  root: string;
  mark?: MarkerState;
  /** qualified: the in-sandbox probe record (`backend-probe.ts --enforced`). */
  probeEvidence?: string;
  /** authorized: the rotation record (Step 10: names and times, never values). */
  rotation?: string;
  /** authorized: the enforced supervised Claude Code cell's execution id (Step 11). */
  cell?: string;
  /** authorized: the evidence reference, e.g. M1-34/003. */
  evidence?: string;
}

const RotationSchema = z.object({
  v: z.literal(1),
  credentials: z.array(z.object({
    name: z.string().min(1),
    revoked_at: z.iso.datetime(),
    created_at: z.iso.datetime(),
  })),
}).strict();

const CellSchema = z.object({
  id: z.string(),
  manifest: z.object({ harness: z.string() }),
  termination: z.string(),
  started_at: z.iso.datetime(),
});

async function readJsonFile(path: string, what: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    throw new ConfigurationError(
      `cannot read the ${what} ${path}: ${(err as Error).message}`,
    );
  }
}

/** qualified: passing probe lines recorded on this network and interface. */
async function probeProblems(
  s: EgressState,
  path: string | undefined,
): Promise<string[]> {
  if (!path) {
    return [
      "qualified needs --probe-evidence: the in-sandbox probe evidence written by backend-probe.ts --enforced",
    ];
  }
  const r = ProbeEvidenceSchema.safeParse(
    await readJsonFile(path, "probe evidence"),
  );
  if (!r.success) {
    return [`probe evidence ${path} is invalid: ${r.error.issues[0]?.message}`];
  }
  const e = r.data;
  const p: string[] = [];
  if (
    e.network_id !== s.network?.id ||
    e.interface_index !== s.gatewayAdapter?.index
  ) {
    p.push(
      `probe evidence is for network ${e.network_id} on interface ${e.interface_index}, not the current network ${s.network?.id} on ${s.gatewayAdapter?.index}`,
    );
  }
  if (!e.hosts.includes("api.anthropic.com")) {
    p.push(
      "probe evidence must include the positive probe for api.anthropic.com",
    );
  }
  const lines = e.lines.map((l) => ({
    probe: l.probe,
    ok: l.ok,
    ...(l.error ? { error: l.error } : {}),
  }));
  p.push(
    ...evaluatePreflight(lines, preflightExpect(e.hosts)).map((x) =>
      `probe evidence: ${x}`
    ),
  );
  return p;
}

/** authorized: recorded rotation, recorded OAuth hosts, and a later clean enforced Claude cell. */
async function authorizationProblems(
  root: string,
  o: EgressVerifyOptions,
  qualifiedAt: string,
): Promise<{ problems: string[]; allowlist: string[] }> {
  const p: string[] = [];
  let allowlist: string[] = [];
  try {
    allowlist = hostsForRoutes(
      Object.keys(ROUTE_HOSTS),
      await loadRecordedHosts(root),
    );
  } catch (err) {
    p.push((err as Error).message);
  }
  if (!o.evidence?.trim()) {
    p.push("authorized needs --evidence <M1-34/nnn>");
  }
  if (!o.rotation) p.push("authorized needs --rotation <rotation record>");
  if (!o.cell) p.push("authorized needs --cell <execution id>");
  if (!o.rotation || !o.cell) return { problems: p, allowlist };
  const rot = RotationSchema.safeParse(
    await readJsonFile(o.rotation, "rotation record"),
  );
  let rotatedAt = "";
  if (!rot.success) {
    p.push(
      `rotation record ${o.rotation} is invalid: ${
        rot.error.issues[0]?.message
      }`,
    );
  } else {
    for (const name of ROTATED_CREDENTIALS) {
      if (!rot.data.credentials.some((c) => c.name === name)) {
        p.push(`rotation record lacks ${name}`);
      }
    }
    for (const c of rot.data.credentials) {
      for (const t of [c.revoked_at, c.created_at]) {
        if (t > rotatedAt) rotatedAt = t;
      }
    }
  }
  const cells = join(root, "results", "harness", "cells");
  let cellPath: string | null = null;
  try {
    for (const d of Deno.readDirSync(join(cells, "executions"))) {
      const f = join(cells, "executions", d.name, `${o.cell}.json`);
      if (d.isDirectory && await exists(f)) cellPath = f;
    }
  } catch { /* no cells yet */ }
  if (!cellPath) {
    p.push(`cell ${o.cell} not found under ${cells}`);
    return { problems: p, allowlist };
  }
  const cell = CellSchema.safeParse(await readJsonFile(cellPath, "execution"));
  if (!cell.success) {
    p.push(
      `execution ${cellPath} is invalid: ${cell.error.issues[0]?.message}`,
    );
    return { problems: p, allowlist };
  }
  const e = cell.data;
  p.push(...await recordCellProblems(root, o.cell));
  if (e.manifest.harness !== "claude-code") {
    p.push(`cell ${o.cell} ran ${e.manifest.harness}, not claude-code`);
  }
  if (e.termination !== "completed") {
    p.push(
      `cell ${o.cell} ended ${e.termination}; authorization needs a completed cell`,
    );
  }
  const started = new Date(e.started_at).getTime();
  if (started < new Date(qualifiedAt).getTime()) {
    p.push(
      `cell ${o.cell} started before the qualified marker (${qualifiedAt}): not an enforced cell`,
    );
  }
  if (rotatedAt && started < new Date(rotatedAt).getTime()) {
    p.push(
      `cell ${o.cell} started before the rotation (${rotatedAt}); it must start after the rotation`,
    );
  }
  let log: string;
  try {
    log = await Deno.readTextFile(join(cells, "runs", o.cell, "egress.jsonl"));
  } catch {
    p.push(`cell ${o.cell} has no egress.jsonl: not an enforced run`);
    return { problems: p, allowlist };
  }
  const decisions = log.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    try {
      return String(JSON.parse(l).decision);
    } catch {
      return "unreadable";
    }
  });
  if (decisions.includes("deny")) {
    p.push(`cell ${o.cell} egress.jsonl has a deny line`);
  }
  if (decisions.includes("unreadable")) {
    p.push(`cell ${o.cell} egress.jsonl has an unreadable line`);
  }
  if (!decisions.includes("allow")) {
    p.push(`cell ${o.cell} egress.jsonl has no allowed connection`);
  }
  return { problems: p, allowlist };
}

/**
 * Verify the effective egress policy (read-only, never elevated). With
 * mark, the marker moves one state forward (candidate, qualified,
 * authorized), each with its evidence (M1-34 Steps 3, 6, 12); a skip, a
 * downgrade or an overwrite is refused (the plan names no override: after
 * a revert, remove the marker file explicitly). Returns problems.
 */
export async function harnessEgressVerify(
  o: EgressVerifyOptions,
  collect: (markerPath: string) => Promise<EgressState> = (m) =>
    collectEgressState(realEgressCollector(m)),
): Promise<string[]> {
  const markerPath = join(o.root, "results", "harness", MARKER_FILE);
  const s = await collect(markerPath);
  if (!o.mark) {
    const p = verifyEgressState(s);
    if (s.marker?.state === "authorized" && await exists(markerPath)) {
      const m = await readJsonFile(markerPath, "egress marker") as Record<
        string,
        unknown
      >;
      p.push(...await authorizedMarkerProblems(o.root, m));
    }
    return p;
  }
  type Marker = { state?: string; marked_at?: string };
  const current = await exists(markerPath)
    ? await readJsonFile(markerPath, "egress marker") as Marker
    : null;
  const order: readonly string[] = MARKER_STATES;
  const at = current ? order.indexOf(String(current.state)) : -1;
  if (current && at < 0) {
    return [
      `egress marker ${markerPath} has an unknown state ${
        JSON.stringify(current.state)
      }`,
    ];
  }
  const want = order.indexOf(o.mark);
  if (want === at) {
    return [
      `marker is already ${o.mark}: refusing to overwrite (remove ${markerPath} explicitly to start over)`,
    ];
  }
  if (want < at) {
    return [
      `marker is ${
        current!.state
      }: refusing to downgrade to ${o.mark} (remove ${markerPath} explicitly to start over)`,
    ];
  }
  if (want > at + 1) {
    return [
      `marker is ${current?.state ?? "absent"}: mark ${order[at + 1]} first`,
    ];
  }
  const problems = verifyEgressState(
    o.mark === "candidate" ? { ...s, marker: null } : s,
  );
  if (problems.length > 0) return problems;
  if (!s.network || !s.gatewayAdapter) return ["nothing to mark"];
  const extra: Record<string, unknown> = {};
  if (o.mark === "qualified") {
    const p = await probeProblems(s, o.probeEvidence);
    if (p.length > 0) return p;
    extra["probe_evidence"] = o.probeEvidence;
    extra["probe_evidence_sha256"] = await sha256File(o.probeEvidence!);
  }
  if (o.mark === "authorized") {
    const a = await authorizationProblems(
      o.root,
      o,
      current?.marked_at ?? "",
    );
    if (a.problems.length > 0) return a.problems;
    const now = new Date().toISOString();
    const q = current as Record<string, unknown>;
    if (typeof q["probe_evidence"] !== "string") {
      return ["the qualified marker carries no probe_evidence reference"];
    }
    Object.assign(extra, {
      verified_at: now,
      evidence: o.evidence,
      probe_evidence: q["probe_evidence"],
      probe_evidence_sha256: q["probe_evidence_sha256"],
      recorded_hosts_sha256: await sha256File(
        join(o.root, ...RECORDED_HOSTS_PATH.split("/")),
      ),
      proxy_allowlist: a.allowlist,
      allowlist_sha256: await sha256Text(JSON.stringify(a.allowlist)),
      rotation: o.rotation,
      rotation_done: true,
      cell: o.cell,
    });
  }
  await Deno.mkdir(join(markerPath, ".."), { recursive: true });
  await Deno.writeTextFile(
    markerPath,
    JSON.stringify(
      {
        v: 1,
        state: o.mark,
        network: SANDBOX_NETWORK.name,
        network_id: s.network.id,
        interface_index: s.gatewayAdapter.index,
        // The proxy isolation model this marker was verified for (M1-33d).
        proxy_isolation: PROXY_ISOLATION,
        marked_at: new Date().toISOString(),
        ...extra,
      },
      null,
      2,
    ) + "\n",
  );
  return [];
}

/** Print a known failure as [FAIL] and set exit code 1; rethrow bugs. */
async function fail(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    if (!isProblem(err)) throw err;
    console.error(`${colors.red("[FAIL]")} ${err.message}`);
    Deno.exitCode = 1;
  }
}

export function registerHarnessCommand(
  cli: Command,
  open: Opener = openHarnessEnv,
): void {
  const parent = new Command().description(
    "Harness Bench: benchmark agent harness configs (spec 1a).",
  );

  parent
    .command(
      "validate",
      "Static validation of harness tasks, symbols lock, experiments and model ids (no containers)",
    )
    .option("--root <dir:string>", "Repository root", { default: "." })
    .action((opts) =>
      fail(async () => {
        for (const line of await validateHarness(opts.root)) console.log(line);
      })
    );

  parent
    .command(
      "report <experiment:string>",
      "Report primary metric and outcome for an experiment's campaign",
    )
    .type("judging", new EnumType(["campaign", "current"]))
    .option("--results-dir <dir:string>", "Harness records root", {
      default: "results/harness",
    })
    .option("--campaign <id:string>", "Campaign id (default: newest)")
    .option("--json", "Print the report as JSON")
    .option("--resamples <n:integer>", "Bootstrap resamples", {
      default: 2000,
    })
    .option("--seed <n:integer>", "Bootstrap seed", { default: 1 })
    .option(
      "--repeats <n:integer>",
      "Report repeats 1..N only, excluded work disclosed (default: all planned)",
    )
    .option(
      "--judging <source:judging>",
      "Oracles to judge with, named explicitly: the campaign's, or the working tree's (after an oracle fix and rejudge)",
      { required: true },
    )
    .option("--root <dir:string>", "Repository root for --judging current", {
      default: ".",
    })
    .action((opts, experiment: string) =>
      fail(async () => {
        const report = await harnessReport(experiment, {
          resultsDir: opts.resultsDir,
          campaign: opts.campaign,
          resamples: opts.resamples,
          seed: opts.seed,
          repeats: opts.repeats,
          judging: opts.judging,
          root: opts.root,
        });
        console.log(
          opts.json ? JSON.stringify(report, null, 2) : renderReport(report),
        );
      })
    );

  // Options shared by `cell` and `judge-fixture`.
  // deno-lint-ignore no-explicit-any
  const shared = (c: Command<any>) =>
    c
      .option("--results-dir <dir:string>", "Harness records root", {
        default: "results/harness",
      })
      .option(
        "--containers <names:string>",
        "BC containers (comma-separated; must be allocated to the campaign)",
        { default: "Cronus281" },
      )
      .option(
        "--backend-host <ip:string>",
        "Container-facing backend address (default: the nat gateway)",
      )
      .option("--backend-port <port:number>", "Backend port", {
        default: 3210,
      })
      .option(
        "--secrets-dir <dir:string>",
        "Operator secrets directory (provider credentials)",
        { required: true },
      )
      .option("--symbol-store <dir:string>", "Host symbol store", {
        default: "results/harness/symbols",
      })
      .option(
        "--private-dir <dir:string>",
        "Harness-private state (default: %LOCALAPPDATA%\\centralgauge\\harness)",
      )
      .option(
        "--credential-ledger <path:string>",
        "Shared credential reservation ledger (default: CG_CREDENTIAL_LEDGER)",
      )
      .option(
        "--rev <commit:string>",
        "Load the task from this git revision (default: the working tree)",
      );

  shared(
    parent.command(
      "cell <config:string> <task:string>",
      "Run one cell (records under results/harness/cells)",
    ),
  )
    .option(
      "--supervised",
      "Operator watches this credential-bearing run at the terminal (before egress enforcement)",
    )
    .option("--repeat <n:integer>", "Repeat index", { default: 1 })
    .option(
      "--qualify-manifest <path:string>",
      "Qualification manifest naming the variants mock arms apply",
    )
    .option(
      "--stub-provider <scenario:string>",
      "Scripted in-container Messages API (no credential; records under <results-dir>/stub-cells; never judged)",
    )
    .option(
      "--image <id:string>",
      "Run this image id of the same harness (only with --stub-provider)",
    )
    .option(
      "--record-oauth-hosts",
      "M1-34 Step 11: record the OAuth hosts into harness/egress/recorded-hosts.json (qualified marker, supervised Claude arm)",
    )
    .action((opts: CellCliFlags, config: string, task: string) =>
      fail(async () => void await harnessCell(config, task, cliOpts(opts)))
    );

  shared(
    parent.command(
      "judge-fixture <task:string> <variant:string>",
      "Judge correct/, reference-tests/ or naive/<name>/ without an agent",
    ),
  )
    .option(
      "--manifest <path:string>",
      "Qualification manifest shared with M4; refuses unlisted variants or revisions",
    )
    .action((
      opts: CellCliFlags & { manifest?: string },
      task: string,
      variant: string,
    ) =>
      fail(async () =>
        void await harnessJudgeFixture(task, variant, {
          ...cliOpts(opts),
          manifest: opts.manifest ? resolve(opts.manifest) : null,
        })
      )
    );

  type RunFlags = CellCliFlags & {
    dryRun?: boolean;
    sample?: number;
    repeats?: number;
    concurrency: number;
    seed?: number;
    maxPauseMin: number;
    yes?: boolean;
    execution?: string;
    stopFile?: string[];
    campaign?: string;
    rerun?: RerunCell;
  };
  const runOpts = (f: RunFlags): RunCliOptions => ({
    ...cliOpts(f),
    dryRun: f.dryRun === true,
    concurrency: f.concurrency,
    maxPauseMin: f.maxPauseMin,
    ...(f.sample !== undefined ? { sample: f.sample } : {}),
    ...(f.repeats !== undefined ? { repeats: f.repeats } : {}),
    ...(f.seed !== undefined ? { seed: f.seed } : {}),
    ...(f.yes ? { yes: true } : {}),
    ...(f.execution ? { execution: f.execution } : {}),
    ...(f.stopFile ? { stopFiles: f.stopFile.map((p) => resolve(p)) } : {}),
    ...(f.campaign ? { campaign: f.campaign } : {}),
    ...(f.rerun ? { rerun: f.rerun } : {}),
  });

  shared(
    parent.command(
      "run <experiment:string>",
      "Run (or resume) an experiment's campaign unattended",
    ),
  )
    .option(
      "--dry-run",
      "Print the plan; no lock, no container, nothing written",
    )
    .option("--sample <n:integer>", "Run only the first N blocks")
    .option("--repeats <n:integer>", "Run only repeats 1..N")
    .option("--concurrency <n:integer>", "Blocks run at once", { default: 1 })
    .option("--seed <n:integer>", "Seed of a new campaign's block order")
    .option(
      "--max-pause-min <n:number>",
      "Longest usage-limit pause to wait out; 0 stops with a resume line",
      { default: 0 },
    )
    .option(
      "--qualify-manifest <path:string>",
      "Qualification manifest naming the variants mock arms apply",
    )
    .option(
      "--stop-file <path:string>",
      "Stop before the next cell while this file exists (repeatable)",
      { collect: true },
    )
    .option(
      "--campaign <id:string>",
      "Resume exactly this campaign; refused if it no longer matches",
    )
    .type("cell", ({ value }) => parseRerunCell(value))
    .option(
      "--rerun <cell:cell>",
      "Rerun only this unscored cell (<task:repeat:arm>) as a manual rerun",
    )
    .action((opts: RunFlags, experiment: string) =>
      fail(async () => void await harnessRun(experiment, runOpts(opts), open))
    );

  shared(
    parent.command(
      "rejudge <experiment:string>",
      "Judge stored executions again with the current scorers and oracle",
    ),
  )
    .option("--execution <id:string>", "Only this execution")
    .option("--campaign <id:string>", "This campaign (default: newest)")
    .option("--yes", "Do not ask for confirmation")
    .action((
      opts: Omit<RunFlags, "concurrency" | "maxPauseMin">,
      experiment: string,
    ) =>
      fail(async () =>
        void await harnessRejudge(
          experiment,
          runOpts({ ...opts, concurrency: 1, maxPauseMin: 0 }),
          open,
        )
      )
    );

  shared(
    parent.command(
      "qualify",
      "Judge every manifest variant at its rev (judge-fixture plus one mock cell) and index the results",
    ),
  )
    .option("--manifest <path:string>", "Qualification manifest", {
      required: true,
    })
    .action((opts: CellCliFlags & { manifest: string }) =>
      fail(async () =>
        void await harnessQualify({
          ...cliOpts(opts),
          manifest: resolve(opts.manifest),
        })
      )
    );

  parent.command(
    "images",
    new Command()
      .description("Harness images")
      .command(
        "build <harness:string>",
        "Build the base image or a harness image",
      )
      .option("--version <v:string>", "Harness version (image tag and label)")
      .action((opts, harness) =>
        fail(async () =>
          void await harnessImagesBuild(harness, {
            root: Deno.cwd(),
            ...(opts.version ? { version: opts.version } : {}),
          })
        )
      ),
  );

  parent.command(
    "egress",
    new Command()
      .description("Egress enforcement (M1-33)")
      .command(
        "verify",
        "Verify the effective firewall, network and marker (read-only; ops apply the rules elevated)",
      )
      .type("marker", new EnumType([...MARKER_STATES]))
      .option(
        "--mark <state:marker>",
        "Move the marker one state forward (candidate, qualified, authorized) with its evidence",
      )
      .option(
        "--probe-evidence <path:string>",
        "qualified: the probe record from backend-probe.ts --enforced",
      )
      .option(
        "--rotation <path:string>",
        "authorized: the credential rotation record (names and times only)",
      )
      .option(
        "--cell <id:string>",
        "authorized: the enforced supervised Claude Code cell's execution id",
      )
      .option(
        "--evidence <ref:string>",
        "authorized: evidence reference (M1-34/nnn)",
      )
      .action((opts) =>
        fail(async () => {
          const problems = await harnessEgressVerify({
            root: Deno.cwd(),
            ...(opts.mark ? { mark: opts.mark as MarkerState } : {}),
            ...(opts.probeEvidence
              ? { probeEvidence: resolve(opts.probeEvidence) }
              : {}),
            ...(opts.rotation ? { rotation: resolve(opts.rotation) } : {}),
            ...(opts.cell ? { cell: opts.cell } : {}),
            ...(opts.evidence ? { evidence: opts.evidence } : {}),
          });
          for (const p of problems) {
            console.error(`${colors.red("[FAIL]")} ${p}`);
          }
          if (problems.length > 0) {
            Deno.exitCode = 1;
            return;
          }
          console.log(
            `${colors.green("[OK]")} egress policy verified${
              opts.mark ? `; marker ${opts.mark} written` : ""
            }`,
          );
        })
      ),
  );

  parent.command(
    "symbols",
    new Command()
      .description("Symbol packages")
      .command(
        "lock",
        "Write harness-tasks/symbols.lock.json from a compiler-cache symbols folder",
      )
      .option("--from <dir:string>", "Symbols folder", { required: true })
      .option("--store <dir:string>", "Host symbol store", {
        default: "results/harness/symbols",
      })
      .option(
        "--altool <path:string>",
        "altool.exe (default: next to the symbols folder)",
      )
      .action((opts) =>
        fail(async () => {
          const n = await harnessSymbolsLock({
            root: Deno.cwd(),
            from: resolve(opts.from),
            store: resolve(opts.store),
            ...(opts.altool ? { altool: resolve(opts.altool) } : {}),
          });
          console.log(`${colors.green("[OK]")} ${n} symbol packages locked`);
        })
      ),
  );

  // deno-lint-ignore no-explicit-any
  (cli as any).command("harness", parent);
}
