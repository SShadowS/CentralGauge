/**
 * Q-06: the production SqlCostRunner. It calls the real `judge()` (the inputs
 * `computeIn` builds) on the harness lane while `bc.runHarnessTests` is wrapped
 * to measure, and keeps only the measurements: the judgment and its log are
 * discarded, never written or published. `productionRunner` opens the harness
 * environment (`openHarnessEnv`: bench lock, private-root lock, coord lease
 * check) and closes it at the end of the step.
 */
import { join } from "@std/path";
import type { BcLane, HarnessBc } from "../../src/harness/bc-lane.ts";
import type { HarnessEnv } from "../../src/harness/execution.ts";
import { loadTaskAt } from "../../src/harness/task-rev.ts";
import { currentScorerFingerprint, judge } from "../../src/harness/verdict.ts";
import { TEST_APP } from "../../src/harness/verdict-workspace.ts";
import { sha256Hex } from "./analyze-campaign.ts";
import type { ScenarioRunResult } from "./sql-cost-scenario.ts";
import { envRunner as rerunRunner } from "./test-rerun-runner.ts";
import type {
  ScenarioRequest,
  SqlCostCall,
  SqlCostRequest,
  SqlCostRunner,
  SqlCostRunnerResult,
} from "./sql-cost.ts";

/** What the runner reads of the opened harness environment. */
export type SqlCostEnv = Pick<
  HarnessEnv,
  | "lane"
  | "symbols"
  | "symbolStore"
  | "onPrem"
  | "deploy"
  | "buildCache"
  | "harnessCommit"
>;

/**
 * `bc` with `runHarnessTests` measuring. Each successful run is recorded by
 * codeunit in `sink`, the LAST run of a codeunit winning (an infra retry reruns
 * a codeunit on another container; the oracle codeunits run once, in G). A
 * result without measurements throws: never numbers-less.
 */
export function measuringBc(
  bc: HarnessBc,
  sink: Map<number, SqlCostCall>,
): HarnessBc {
  return {
    compileProject: (c, p) => bc.compileProject(c, p),
    harnessCompilerIdentity: (c) => bc.harnessCompilerIdentity(c),
    packageTarget: (f) => bc.packageTarget(f),
    listHarnessApps: (c) => bc.listHarnessApps(c),
    syncHarnessApps: (c, p) => bc.syncHarnessApps(c, p),
    setHttpClientAllowed: (c, id, a) => bc.setHttpClientAllowed(c, id, a),
    async runHarnessTests(container, codeunit) {
      const r = await bc.runHarnessTests(container, codeunit, {
        measure: true,
      });
      if (!r.measurements) {
        throw new Error(`run of ${codeunit} returned no measurements`);
      }
      sink.set(codeunit, {
        codeunit,
        container,
        rows: r.results.map((t) => ({
          procedure: t.name,
          outcome: t.passed ? "pass" : "fail",
        })),
        measurements: r.measurements,
      });
      return r;
    },
  };
}

/**
 * Run `fn` with the lane's `bc` swapped, restored after. The lane's internals
 * (locks, load counters) stay one set, which a derived lane object would split;
 * the step runs one execution at a time (jobs 1).
 */
export async function withBc<T>(
  lane: BcLane,
  bc: HarnessBc,
  fn: () => Promise<T>,
): Promise<T> {
  const slot = lane as unknown as { bc: HarnessBc };
  const prior = slot.bc;
  slot.bc = bc;
  try {
    return await fn();
  } finally {
    slot.bc = prior;
  }
}

export interface SqlCostContext {
  repo: string;
  rev: string;
  /** The campaign results folder (`judgments/<execution>/` holds the oracle hash). */
  results: string;
  /** Where tasks at `rev` are extracted. */
  taskCache: string;
}

async function oracleHashOf(
  results: string,
  executionId: string,
  judgmentId: string | null,
): Promise<string> {
  if (!judgmentId) throw new Error("no selected judgment");
  const dir = join(results, "judgments", executionId);
  for await (const f of Deno.readDir(dir)) {
    const j = JSON.parse(await Deno.readTextFile(join(dir, f.name))) as {
      id?: string;
      task_oracle_hash?: string;
    };
    if (j.id === judgmentId && typeof j.task_oracle_hash === "string") {
      return j.task_oracle_hash;
    }
  }
  throw new Error(`judgment ${judgmentId} not found in ${dir}`);
}

export async function envRunner(
  env: SqlCostEnv,
  workRoot: string,
  ctx: SqlCostContext,
): Promise<SqlCostRunner> {
  await Deno.mkdir(workRoot, { recursive: true });
  /** Artifact URL plus the BCH pin; the URL's query (a SAS token) is dropped. */
  const bcVersion = async (container: string) =>
    (await env.lane.bc.harnessCompilerIdentity(container)).replace(
      /\?[^|]*/,
      "",
    );

  async function run(req: SqlCostRequest): Promise<SqlCostRunnerResult> {
    const workDir = join(workRoot, crypto.randomUUID().slice(0, 8));
    await Deno.mkdir(workDir, { recursive: true });
    try {
      const at = await loadTaskAt(ctx.repo, req.task, ctx.rev, ctx.taskCache);
      const oracleHash = await oracleHashOf(
        ctx.results,
        req.executionId,
        req.judgmentId,
      );
      const calls = new Map<number, SqlCostCall>();
      // The same inputs computeIn builds; the output is read and dropped.
      const { judgment } = await withBc(
        env.lane,
        measuringBc(env.lane.bc, calls),
        () =>
          judge(env.lane, {
            executionId: req.executionId,
            workspaceHash: req.workspaceHash,
            task: at.task,
            oracleHash,
            pristine: req.start,
            artifact: req.artifact,
            symbolIds: new Set(env.symbols.map((s) => s.app_id.toLowerCase())),
            workDir,
            lock: { store: env.symbolStore, packages: env.symbols },
            onPrem: env.onPrem,
            deploy: env.deploy,
            harnessCommit: env.harnessCommit,
            ...(env.buildCache ? { buildCache: env.buildCache } : {}),
          }),
      );
      // The oracle is what scoreChange runs as fail_to_pass.
      const oracle = judgment.scorers.find((s) => s.name === "fail_to_pass");
      const container = judgment.verdict_container;
      if (!container) {
        throw new Error("the measured judgment ran on no container");
      }
      return {
        verdict: judgment.verdict,
        oracle_codeunits: [
          ...new Set((oracle?.tests ?? []).map((t) => t.codeunit)),
        ],
        calls: [...calls.values()],
        identity: { container, bc_version: await bcVersion(container) },
      };
    } finally {
      await Deno.remove(workDir, { recursive: true }).catch(() => {});
    }
  }

  /**
   * Phase 2: the scenario sources are the only sources of the Test app (a
   * synthetic test tree: the start tree's Test app.json plus the .al files), run
   * through the Q-04 test-rerun runner over the execution's final production
   * apps, with the same measuring bc swap as the judge run.
   */
  async function scenario(req: ScenarioRequest): Promise<ScenarioRunResult> {
    const dir = join(workRoot, `scenario-${crypto.randomUUID().slice(0, 8)}`);
    const test = join(dir, "test");
    try {
      await Deno.mkdir(join(test, TEST_APP), { recursive: true });
      await Deno.copyFile(
        join(req.start, TEST_APP, "app.json"),
        join(test, TEST_APP, "app.json"),
      );
      for (const f of req.files) {
        await Deno.writeTextFile(join(test, TEST_APP, f.name), f.text);
      }
      const calls = new Map<number, SqlCostCall>();
      const rerun = await rerunRunner(env, join(dir, "rerun"));
      const r = await withBc(
        env.lane,
        measuringBc(env.lane.bc, calls),
        () =>
          rerun.run({
            executionId: req.executionId,
            start: req.start,
            production: req.production,
            test,
            specs: req.specs,
          }),
      );
      return {
        compile: r.compile,
        rows: r.rows,
        measurements: [...calls.values()].flatMap((c) => c.measurements),
        identity: {
          container: r.identity.container,
          bc_version: r.identity.bc_version,
        },
      };
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  }

  return {
    // No commit (or `<HEAD>+dirty`), no sharing: an uncommitted harness never reuses a cache.
    id: `${
      env.harnessCommit && !env.harnessCommit.endsWith("+dirty")
        ? env.harnessCommit
        : `uncommitted-${crypto.randomUUID()}`
    }-${(await currentScorerFingerprint()).slice(0, 16)}`,
    env: async () => ({
      containers: await Promise.all(
        env.lane.containers.map(async (name) => ({
          name,
          bc_version: await bcVersion(name),
        })),
      ),
      symbols: await sha256Hex(
        JSON.stringify(
          [...env.symbols].sort((a, b) => a.app_id.localeCompare(b.app_id)),
        ),
      ),
    }),
    run,
    scenario,
  };
}

export interface ProductionOptions extends SqlCostContext {
  repoRoot: string;
  /** Records root of the opened environment: kept out of the campaign results. */
  resultsDir: string;
  containers: string[];
  /** `--coord-lease <container>=<token>` values. */
  coordLeases: string[];
  symbolStore: string;
  privateRoot: string;
  lineage: string | null;
}

/** Opens the harness environment for this step; `close()` releases it. */
export async function productionRunner(
  o: ProductionOptions,
): Promise<SqlCostRunner> {
  const [{ openHarnessEnv }, { parseCoordLease }] = await Promise.all([
    import("../../cli/commands/harness-env.ts"),
    import("../../cli/commands/harness-command.ts"),
  ]);
  const leases = new Map(o.coordLeases.map(parseCoordLease));
  const h = await openHarnessEnv({
    repoRoot: o.repoRoot,
    resultsDir: o.resultsDir,
    containers: o.containers,
    backendPort: 3210,
    // The backend is never asked for a grant here; no provider credential is read.
    secretsSource: join(o.privateRoot, "no-secrets"),
    symbolStore: o.symbolStore,
    privateRoot: o.privateRoot,
    credentialLedger: null,
    command: "analyze-campaign --sql-cost",
    supervised: false,
    ...(o.lineage ? { lineage: o.lineage } : {}),
    ...(leases.size > 0 ? { coordLeases: leases } : {}),
  });
  const work = join(o.privateRoot, "work", `sql-cost-${crypto.randomUUID()}`);
  try {
    const runner = await envRunner(h.env, work, o);
    return {
      ...runner,
      close: async () => {
        await Deno.remove(work, { recursive: true }).catch(() => {});
        await h.close();
      },
    };
  } catch (err) {
    await h.close();
    throw err;
  }
}
