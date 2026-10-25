/**
 * Q-06: the production SqlCostRunner. It calls the real `judge()` (the inputs
 * `computeIn` builds) on the harness lane while `bc.runHarnessTests` is wrapped
 * to measure, and keeps only the measurements: the judgment and its log are
 * discarded, never written or published. `productionRunner` opens the harness
 * environment (`openHarnessEnv`: bench lock, private-root lock, coord lease
 * check) and closes it at the end of the step.
 */
import { dirname, fromFileUrl, join } from "@std/path";
import type { WantedApp } from "../../src/harness/bc-apps.ts";
import type {
  BcLane,
  HarnessBc,
  MeasureResource,
  TestRow,
} from "../../src/harness/bc-lane.ts";
import type { HarnessEnv } from "../../src/harness/execution.ts";
import { hashFile } from "../../src/harness/hash.ts";
import { readAppJson } from "../../src/harness/staging.ts";
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
 * `bc` with `runHarnessTests` measuring. Every run that returns is appended to
 * `sink`, in order: an infra retry or a control rerun runs a codeunit again,
 * and which run is authoritative is decided against the judgment afterwards
 * (authoritativeCalls), never here. The raw rows map a result as bc-lane's
 * runTests does (no error text: not_run). A result without measurements
 * throws: never numbers-less.
 */
export function measuringBc(
  bc: HarnessBc,
  sink: SqlCostCall[],
): HarnessBc {
  return {
    compileProject: (c, p) => bc.compileProject(c, p),
    harnessCompilerIdentity: (c) => bc.harnessCompilerIdentity(c),
    packageTarget: (f) => bc.packageTarget(f),
    listHarnessApps: (c) => bc.listHarnessApps(c),
    syncHarnessApps: (c, p) => bc.syncHarnessApps(c, p),
    setHttpClientAllowed: (c, id, a) => bc.setHttpClientAllowed(c, id, a),
    ...(bc.buildSqlMeasureApp
      ? {
        buildSqlMeasureApp: (c: string, w: string) =>
          bc.buildSqlMeasureApp!(c, w),
      }
      : {}),
    async runHarnessTests(container, codeunit) {
      const r = await bc.runHarnessTests(container, codeunit, {
        measure: true,
      });
      if (!r.measurements) {
        throw new Error(`run of ${codeunit} returned no measurements`);
      }
      sink.push({
        codeunit,
        container,
        rows: r.results.map((t) => ({
          procedure: t.name,
          outcome: t.passed
            ? "pass"
            : t.error === undefined
            ? "not_run"
            : "fail",
        })),
        measurements: r.measurements,
      });
      return r;
    },
  };
}

/** The judgment's rows authoritativeCalls reads (JudgmentRecord.scorers). */
type JudgedScorer = { name: string; tests: readonly TestRow[] };

const keyOf = (codeunit: number, procedure: string) =>
  `${codeunit}|${procedure.toLowerCase()}`;

/**
 * Q-06 fail closed: the measured calls that are the judgment's own runs, with
 * the judgment's rows. Throws (no numbers) when:
 * - any scorer row is not a pass or a fail (infra, not_run: a missing or
 *   skipped procedure, error);
 * - the task declares no fail_to_pass oracle, or the fail_to_pass rows are not
 *   exactly the task-declared procedures, one row each;
 * - a judged codeunit has no single authoritative run: for G's codeunits
 *   (pass_to_pass and fail_to_pass) the run on the container of the last G
 *   deployment (the attempt that returned; earlier attempts were infra
 *   retries), for every other codeunit its only run;
 * - a declared oracle procedure lacks exactly one measurement in that run, or
 *   the measurement's success disagrees with the judgment's outcome.
 */
export function authoritativeCalls(
  /** The loaded task.yml (HarnessTask): its declared suites. */
  task: {
    pass_to_pass: readonly { codeunit: number }[];
    fail_to_pass:
      | {
        tests: readonly { codeunit: number; procedures: readonly string[] }[];
      }
      | null;
  },
  judgment: { scorers: readonly JudgedScorer[] },
  deployments: readonly { hold: string; container: string }[],
  calls: readonly SqlCostCall[],
): { oracle_codeunits: number[]; calls: SqlCostCall[] } {
  if (!task.fail_to_pass) throw new Error("task has no fail_to_pass oracle");
  for (const s of judgment.scorers) {
    for (const t of s.tests) {
      if (t.outcome !== "pass" && t.outcome !== "fail") {
        throw new Error(
          `${s.name} ${t.codeunit} ${t.procedure} is ${t.outcome} (${t.failure})`,
        );
      }
    }
  }
  const expected = new Set(
    task.fail_to_pass.tests.flatMap((x) =>
      x.procedures.map((p) => keyOf(x.codeunit, p))
    ),
  );
  const f2p = judgment.scorers.find((s) => s.name === "fail_to_pass")?.tests ??
    [];
  const seen = new Map<string, number>();
  for (const t of f2p) {
    const k = keyOf(t.codeunit, t.procedure);
    if (!expected.has(k)) {
      throw new Error(
        `fail_to_pass row ${t.codeunit} ${t.procedure} is not declared by the task`,
      );
    }
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const x of task.fail_to_pass.tests) {
    for (const p of x.procedures) {
      const n = seen.get(keyOf(x.codeunit, p)) ?? 0;
      if (n !== 1) {
        throw new Error(
          `oracle ${x.codeunit} ${p} has ${n} fail_to_pass rows, not 1`,
        );
      }
    }
  }
  const inG = new Set([
    ...task.pass_to_pass.map((x) => x.codeunit),
    ...task.fail_to_pass.tests.map((x) => x.codeunit),
  ]);
  const lastG = deployments.filter((d) => d.hold === "G").at(-1)?.container;
  if (lastG === undefined) throw new Error("the judgment has no G deployment");
  // Judged rows by codeunit, in the judgment's order.
  const rowsOf = new Map<number, TestRow[]>();
  for (const s of judgment.scorers) {
    for (const t of s.tests) {
      rowsOf.set(t.codeunit, [...rowsOf.get(t.codeunit) ?? [], t]);
    }
  }
  const out: SqlCostCall[] = [];
  for (const [codeunit, rows] of rowsOf) {
    const runs = calls.filter((c) =>
      c.codeunit === codeunit && (!inG.has(codeunit) || c.container === lastG)
    );
    if (runs.length !== 1) {
      throw new Error(
        `codeunit ${codeunit} has ${runs.length} measured runs${
          inG.has(codeunit) ? ` on ${lastG} (the final G deployment)` : ""
        }: the authoritative run cannot be decided`,
      );
    }
    const run = runs[0]!;
    for (const t of rows) {
      if (!expected.has(keyOf(t.codeunit, t.procedure))) continue;
      const mine = run.measurements.filter((m) =>
        keyOf(m.codeunit, m.procedure) === keyOf(t.codeunit, t.procedure)
      );
      if (mine.length !== 1) {
        throw new Error(
          `oracle ${t.codeunit} ${t.procedure} has ${mine.length} measurements, not 1`,
        );
      }
      if (mine[0]!.success !== (t.outcome === "pass")) {
        throw new Error(
          `oracle ${t.codeunit} ${t.procedure}: measured success ${
            mine[0]!.success
          } disagrees with the judgment's ${t.outcome}`,
        );
      }
    }
    // SOAP runs the whole codeunit; keep only the measurements of the
    // judgment's rows (an unselected sibling has no row). Duplicates of a row
    // stay, so sqlCostRows still rejects them.
    const rowKeys = new Set(rows.map((t) => keyOf(t.codeunit, t.procedure)));
    out.push({
      codeunit,
      container: run.container,
      rows: rows.map((t) => ({
        procedure: t.procedure,
        outcome: t.outcome as "pass" | "fail",
      })),
      measurements: run.measurements.filter((m) =>
        rowKeys.has(keyOf(m.codeunit, m.procedure))
      ),
    });
  }
  return {
    oracle_codeunits: [
      ...new Set(task.fail_to_pass.tests.map((x) => x.codeunit)),
    ],
    calls: out,
  };
}

/**
 * Q-06: the measure app as a deployment resource of the measured judgment and
 * of scenario reruns (deployAndTest's `measure`): built once per container
 * (bc.buildSqlMeasureApp: the pinned harness staged into its symbols), then
 * published, ledgered, trusted for removal and removed by every deployment
 * like the other harness apps.
 */
export async function measureResource(
  bc: HarnessBc,
  work: string,
): Promise<MeasureResource> {
  const root = fromFileUrl(
    new URL("../../infra/cg-sql-measure", import.meta.url),
  );
  const aj = await readAppJson(join(root, "app.json"));
  const built = new Map<string, Promise<WantedApp>>();
  const build = async (container: string): Promise<WantedApp> => {
    if (!bc.buildSqlMeasureApp) {
      throw new Error("this bc cannot build the measure app");
    }
    const file = await bc.buildSqlMeasureApp(
      container,
      join(work, `measure-${container}`),
    );
    const sha256 = await hashFile(dirname(file), file);
    return {
      id: aj.id.toLowerCase(),
      name: aj.name,
      publisher: aj.publisher,
      version: aj.version,
      stamp: sha256,
      file,
      role: "prereq",
      depends: [],
      sha256,
    };
  };
  return {
    id: aj.id.toLowerCase(),
    root,
    app(container) {
      let p = built.get(container);
      if (!p) {
        p = build(container);
        built.set(container, p);
        // A failed build is retried by the next deployment.
        p.catch(() => built.delete(container));
      }
      return p;
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
  // Built from the unwrapped bc, once per container for the whole step.
  const measure = await measureResource(
    env.lane.bc,
    join(workRoot, "measure-app"),
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
      const calls: SqlCostCall[] = [];
      // The same inputs computeIn builds, plus the measure app as a resource
      // of every deployment; the output is read and dropped.
      const { judgment, log } = await withBc(
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
            deploy: { ...env.deploy, measure },
            harnessCommit: env.harnessCommit,
            ...(env.buildCache ? { buildCache: env.buildCache } : {}),
          }),
      );
      const container = judgment.verdict_container;
      if (!container) {
        throw new Error("the measured judgment ran on no container");
      }
      // Fail closed: only the judgment's own runs, joined against the task's
      // declared oracle (the rows are the judgment's, never the raw SOAP flags).
      const { oracle_codeunits, calls: authoritative } = authoritativeCalls(
        at.task.task,
        judgment,
        log.deployments ?? [],
        calls,
      );
      return {
        verdict: judgment.verdict,
        oracle_codeunits,
        calls: authoritative,
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
      const calls: SqlCostCall[] = [];
      const rerun = await rerunRunner(env, join(dir, "rerun"), { measure });
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
        // Only the held run's container: an infra-retried attempt elsewhere is
        // not authoritative; a codeunit run twice there duplicates its
        // measurements, which scenarioRecord treats as unmeasured.
        measurements: calls.filter((c) => c.container === r.identity.container)
          .flatMap((c) => c.measurements),
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
