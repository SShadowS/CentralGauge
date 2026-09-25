/**
 * `centralgauge harness` (spec 1a section 10): `validate`, `report`,
 * `cell`, `judge-fixture`, `images build` and `symbols lock`. `run`,
 * `rejudge` and `qualify` come in M1-24b.
 *
 * @module cli/commands/harness
 */
import * as colors from "@std/fmt/colors";
import { join, relative, resolve } from "@std/path";
import { globToRegExp } from "@std/path/posix";
import { Command, EnumType } from "@cliffy/command";
import type {
  HarnessConfig,
  LoadedExperiment,
  VaryKey,
} from "../../src/harness/config.ts";
import type { JudgingContext } from "../../src/harness/outcome.ts";
import type {
  ArtifactRecord,
  JudgmentRecord,
} from "../../src/harness/records.ts";
import type { HarnessReport } from "../../src/harness/report.ts";
import type { LoadedTask } from "../../src/harness/task.ts";
import type { HarnessAdapter } from "../../src/harness/adapter.ts";
import type { CellResult } from "../../src/harness/execution.ts";
import type { ImageFacts } from "../../src/harness/images.ts";
import type { ManifestReader } from "../../src/harness/symbols.ts";
import type { DockerCli } from "../../src/harness/sandbox.ts";
import type { EnvOptions, OpenEnv } from "./harness-env.ts";
import { canonicalJSON } from "../../shared/canonical.ts";
import {
  CentralGaugeError,
  ConfigurationError,
  ValidationError,
} from "../../src/errors.ts";
import {
  checkModelsInCatalog,
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
import { RecordStore } from "../../src/harness/records.ts";
import { buildReport, renderReport } from "../../src/harness/report.ts";
import { loadTaskSet } from "../../src/harness/task.ts";
import { adapterFor } from "../../src/harness/adapters/mod.ts";
import { runCell } from "../../src/harness/execution.ts";
import { freezeWorkspace, safeCopyTree } from "../../src/harness/fsutil.ts";
import { hashTree } from "../../src/harness/hash.ts";
import {
  BASE_IMAGE,
  hasBaseLayers,
  IMAGE_LABELS,
  imageFacts,
  imageTag,
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
import { judge, writeVerdictLog } from "../../src/harness/verdict.ts";
import { readCatalog } from "../../src/ingest/catalog/read.ts";
import { openHarnessEnv } from "./harness-env.ts";

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
  return buildReport({ campaign, executions, artifacts, judgments }, {
    resamples: opts.resamples,
    seed: opts.seed,
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
  const config = await loadConfig(join(o.root, "harness"), configId);
  await checkModelsInCatalog([config], join(o.root, "site", "catalog"));
  const catalog = await readCatalog(join(o.root, "site", "catalog"));
  const adapter = adapterFor(config.harness);
  const h = await open(
    envOptions(
      o,
      join(o.resultsDir, "cells"),
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
  try {
    const env = {
      ...h.env,
      stop: stop.signal,
      ...(o.qualifyManifest
        ? { qualifyManifest: await loadQualifyManifest(o.qualifyManifest) }
        : {}),
    };
    cellGate(adapter, env, isTerminal);
    const facts = runtimeFacts(
      config,
      await imageFacts(
        env.docker,
        imageTag(config.harness, config.harness_version),
      ),
      adapter,
      catalog,
    );
    const armManifest = await resolveManifest(env.harnessRoot, config, facts);
    const at = await loadTaskAt(
      o.root,
      taskId,
      o.rev,
      join(env.privateRoot, "work", `task-${crypto.randomUUID().slice(0, 8)}`),
    );
    const ids = await taskSetIdentity(o.root, [at.task], env.symbols);
    if (adapter.credentialBearing && !env.egressEnforced) {
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
    await h.close();
  }
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
    const code = await docker.build([
      "build",
      "-f",
      join(images, "base", "Dockerfile.windows"),
      "--build-arg",
      `SERVERCORE=${pin}`,
      "-t",
      BASE_IMAGE,
      join(images, "base"),
    ]);
    if (code !== 0) {
      throw new ConfigurationError(`base image build failed (exit ${code})`);
    }
    const img = await docker.inspectImage(BASE_IMAGE) as { Id?: string } | null;
    if (!img?.Id) {
      throw new ConfigurationError(`${BASE_IMAGE} is missing after the build`);
    }
    console.log(`${colors.green("[OK]")} ${BASE_IMAGE} = ${img.Id}`);
    return { digest: img.Id, base_digest: pin, harness: "base", version: "1" };
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
  const f = await imageFacts(docker, tag);
  console.log(`${colors.green("[OK]")} ${tag} = ${f.digest} (base ${base.Id})`);
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
  };
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

export function registerHarnessCommand(cli: Command): void {
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
