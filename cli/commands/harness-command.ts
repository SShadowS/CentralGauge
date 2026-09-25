/**
 * `centralgauge harness` (spec 1a section 10). Part 1: `validate` and
 * `report`. `run`, `cell`, `rejudge` and `images build` come in Part 2.
 *
 * @module cli/commands/harness
 */
import * as colors from "@std/fmt/colors";
import { join, relative } from "@std/path";
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
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import { RecordStore } from "../../src/harness/records.ts";
import { buildReport, renderReport } from "../../src/harness/report.ts";
import { loadTaskSet } from "../../src/harness/task.ts";

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

  // deno-lint-ignore no-explicit-any
  (cli as any).command("harness", parent);
}
