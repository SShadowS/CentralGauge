/**
 * Q-06: SQL cost per test on the oracle run, plus scale scenarios.
 *
 * Re-judges each execution (the real judge, on the harness lane) with the SOAP
 * runner switched to the CG SQL Measure service, and records statements and ms
 * per test. The judgment and its log are discarded: nothing is written or
 * published. Phase 2: for a task with scale scenarios (sql-cost-scenario.ts)
 * the scenario codeunits are then run over the execution's final production
 * apps and measured the same way; their outcome never touches the oracle part
 * or a verdict. The container work is behind the injected `SqlCostRunner`
 * (sql-cost-runner.ts); this module is pure logic, validation, the
 * per-execution cache, the aggregation and the outputs.
 *
 * Fail closed. The oracle part of an execution is listed under `failed`, with no
 * numbers, when the measured verdict differs from the verdict of the judgment
 * the report selects, when any test row lacks a measurement, when any row is
 * infra or not_run, or when an oracle codeunit never ran. A scenario that does
 * not compile, fails, or lacks a measurement is recorded (`scenario_failed`,
 * `scenario_unmeasured`) without numbers. The numbers include a constant
 * framework overhead per test, so they compare solutions of one task; they are
 * never totalled across tasks.
 */
import { join } from "@std/path";
import {
  csv,
  type DoneStamp,
  pool,
  readDone,
  type Row,
  sha256Hex,
  type StartTree,
  writeAtomic,
  writeDone,
} from "./analyze-campaign.ts";
import type { RunnerEnv } from "./test-rerun.ts";
import {
  parseScenarioSpecs,
  readScenarioFiles,
  type ScenarioFile,
  type ScenarioRecord,
  scenarioRecord,
  type ScenarioRunResult,
  scenarioSha,
  type ScenarioSpec,
  validScenarioRecord,
} from "./sql-cost-scenario.ts";
import type { SqlMeasurement } from "../../src/container/types.ts";
import { SQL_MEASURE_APP_VERSION } from "../../src/container/soap-test-client.ts";

/** Bump when a row is computed differently from the same runner output, or validation tightens. */
export const SQL_COST_DERIVATION = 2;

// ---------------------------------------------------------------- runner contract

export interface SqlCostCall {
  codeunit: number;
  container: string;
  /** One per test the TestResult listed. */
  rows: {
    procedure: string;
    outcome: "pass" | "fail" | "not_run" | "infra";
  }[];
  measurements: SqlMeasurement[];
}

export interface SqlCostRunnerResult {
  /** Verdict of the measured (discarded) judgment. */
  verdict: string | null;
  /** Codeunits the judgment ran as fail_to_pass: the oracle. */
  oracle_codeunits: number[];
  /** The last measured run of each codeunit. */
  calls: SqlCostCall[];
  identity: { container: string; bc_version: string };
}

export interface SqlCostRequest {
  executionId: string;
  task: string;
  workspaceHash: string;
  judgmentId: string | null;
  /** The task's start tree (the judge's pristine). */
  start: string;
  /** The frozen workspace `<results>/workspaces/<hash>`. */
  artifact: string;
}

export interface ScenarioRequest {
  executionId: string;
  task: string;
  /** The task's start tree. */
  start: string;
  /** The frozen workspace: supplies the production apps. */
  production: string;
  files: ScenarioFile[];
  specs: ScenarioSpec[];
}

export interface SqlCostRunner {
  /** Names the cache folder (harness commit + scorer). */
  id: string;
  env(): Promise<RunnerEnv>;
  run(req: SqlCostRequest): Promise<SqlCostRunnerResult>;
  /** Phase 2: absent = this runner cannot run scenarios. */
  scenario?(req: ScenarioRequest): Promise<ScenarioRunResult>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------- oracle rows

export interface SqlCostRow {
  id: string;
  task: string;
  arm: string;
  repeat: number;
  codeunit: number;
  procedure: string;
  oracle: boolean;
  outcome: "pass" | "fail";
  statements: number;
  ms: number;
}

const key = (codeunit: number, procedure: string) =>
  `${codeunit}|${procedure.toLowerCase()}`;

/** The rows of one execution, or a throw (fail closed). */
export function sqlCostRows(
  e: Pick<Row, "id" | "task" | "arm" | "repeat" | "verdict">,
  res: SqlCostRunnerResult,
): SqlCostRow[] {
  if (e.verdict === null || res.verdict !== e.verdict) {
    throw new Error(
      `measured verdict ${res.verdict} differs from the selected judgment's ${e.verdict}`,
    );
  }
  const ran = new Set(res.calls.map((c) => c.codeunit));
  for (const cu of res.oracle_codeunits) {
    if (!ran.has(cu)) throw new Error(`oracle codeunit ${cu} was not measured`);
  }
  const oracle = new Set(res.oracle_codeunits);
  const out: SqlCostRow[] = [];
  for (const c of res.calls) {
    const tests = new Map<string, "pass" | "fail">();
    for (const r of c.rows) {
      if (r.outcome === "infra" || r.outcome === "not_run") {
        throw new Error(`${c.codeunit} ${r.procedure} is ${r.outcome}`);
      }
      tests.set(key(c.codeunit, r.procedure), r.outcome);
    }
    for (const m of c.measurements) {
      if (
        m.codeunit !== c.codeunit || !tests.has(key(m.codeunit, m.procedure))
      ) {
        throw new Error(
          `measurement for ${m.codeunit} ${m.procedure} has no test row`,
        );
      }
    }
    for (const r of c.rows) {
      const mine = c.measurements.filter((m) =>
        key(m.codeunit, m.procedure) === key(c.codeunit, r.procedure)
      );
      if (mine.length !== 1) {
        throw new Error(
          `${c.codeunit} ${r.procedure} lacks exactly one measurement`,
        );
      }
      out.push({
        id: e.id,
        task: e.task,
        arm: e.arm,
        repeat: e.repeat,
        codeunit: c.codeunit,
        procedure: r.procedure,
        oracle: oracle.has(c.codeunit),
        outcome: r.outcome as "pass" | "fail",
        statements: mine[0]!.statements,
        ms: mine[0]!.ms,
      });
    }
  }
  return out;
}

function validRows(x: unknown): x is SqlCostRow[] {
  return Array.isArray(x) &&
    x.every((r) =>
      typeof r === "object" && r !== null &&
      typeof r.id === "string" && typeof r.task === "string" &&
      typeof r.arm === "string" && Number.isInteger(r.repeat) &&
      Number.isInteger(r.codeunit) && typeof r.procedure === "string" &&
      typeof r.oracle === "boolean" &&
      (r.outcome === "pass" || r.outcome === "fail") &&
      Number.isFinite(r.statements) && Number.isFinite(r.ms)
    );
}

// ---------------------------------------------------------------- aggregation

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const spread = (xs: number[]) =>
  xs.length === 0
    ? null
    : { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };

const stat = (xs: { statements: number; ms: number }[]) => ({
  n: xs.length,
  statements: spread(xs.map((x) => x.statements)),
  ms: spread(xs.map((x) => x.ms)),
});

type Stat = ReturnType<typeof stat>;

/** One execution's scenario record, with its identity. */
export type ScenarioEntry = ScenarioRecord & {
  id: string;
  task: string;
  arm: string;
  repeat: number;
};

export interface SqlCostCell {
  /** Oracle procedures, by `codeunit.procedure`. */
  procedures: Record<string, Stat>;
  execution_sum: Stat;
  /** Present when a scenario ran for this task and arm. */
  scenario?: {
    executions_ok: number;
    scenario_failed: number;
    scenario_unmeasured: number;
    methods: Record<string, Stat & { setup: boolean }>;
  };
}
export type SqlCostSummary = Record<string, Record<string, SqlCostCell>>;

/**
 * Per task and arm. Oracle rows only: per procedure the n and median/min/max of
 * statements and ms across repeats, and the same over the per-execution sum of
 * the oracle rows. Scenario methods: the same, over executions whose scenario
 * passed and was measured; failed and unmeasured scenarios are only counted.
 * Never a total across tasks or across a task's arms.
 */
export function sqlCostSummary(
  rows: SqlCostRow[],
  scenarios: ScenarioEntry[] = [],
): SqlCostSummary {
  const out: SqlCostSummary = {};
  const oracle = rows.filter((r) => r.oracle);
  const cells = new Set([
    ...oracle.map((r) => `${r.task}\0${r.arm}`),
    ...scenarios.map((s) => `${s.task}\0${s.arm}`),
  ]);
  for (const cell of [...cells].sort()) {
    const [task, arm] = cell.split("\0") as [string, string];
    const rs = oracle.filter((r) => r.task === task && r.arm === arm);
    const procedures: Record<string, Stat> = {};
    const name = (r: SqlCostRow) => `${r.codeunit}.${r.procedure}`;
    for (const n of [...new Set(rs.map(name))].sort()) {
      procedures[n] = stat(rs.filter((r) => name(r) === n));
    }
    const sums = new Map<string, { statements: number; ms: number }>();
    for (const r of rs) {
      const s = sums.get(r.id) ?? { statements: 0, ms: 0 };
      s.statements += r.statements;
      s.ms += r.ms;
      sums.set(r.id, s);
    }
    const c: SqlCostCell = {
      procedures,
      execution_sum: stat([...sums.values()]),
    };
    const ss = scenarios.filter((s) => s.task === task && s.arm === arm);
    if (ss.length > 0) {
      const ok = ss.filter((s) => s.status === "ok");
      const methods: Record<string, Stat & { setup: boolean }> = {};
      const all = ok.flatMap((s) => s.rows);
      const mname = (r: { codeunit: number; procedure: string }) =>
        `${r.codeunit}.${r.procedure}`;
      for (const n of [...new Set(all.map(mname))].sort()) {
        const mine = all.filter((r) => mname(r) === n);
        methods[n] = { ...stat(mine), setup: mine[0]!.setup };
      }
      c.scenario = {
        executions_ok: ok.length,
        scenario_failed: ss.filter((s) =>
          s.status === "scenario_failed"
        ).length,
        scenario_unmeasured: ss.filter((s) =>
          s.status === "scenario_unmeasured"
        ).length,
        methods,
      };
    }
    (out[task] ??= {})[arm] = c;
  }
  return out;
}

// ---------------------------------------------------------------- outputs

/** One output row (executions.json and executions.csv): an oracle test or a scenario method / outcome. */
function flatRows(
  rows: SqlCostRow[],
  scenarios: ScenarioEntry[],
): Record<string, string | number | boolean>[] {
  const base = (
    e: { id: string; task: string; arm: string; repeat: number },
  ) => ({ id: e.id, task: e.task, arm: e.arm, repeat: e.repeat });
  return [
    ...rows.map((r) => ({
      ...base(r),
      kind: "oracle",
      codeunit: r.codeunit,
      procedure: r.procedure,
      oracle: r.oracle ? "oracle" : "other",
      setup: false,
      outcome: r.outcome,
      scenario_outcome: "",
      error: "",
      statements: r.statements,
      ms: r.ms,
    })),
    ...scenarios.flatMap((s): Record<string, string | number | boolean>[] =>
      s.status === "ok"
        ? s.rows.map((r) => ({
          ...base(s),
          kind: "scenario",
          codeunit: r.codeunit,
          procedure: r.procedure,
          oracle: "",
          setup: r.setup,
          outcome: "pass",
          scenario_outcome: "ok",
          error: "",
          statements: r.statements,
          ms: r.ms,
        }))
        : [{
          ...base(s),
          kind: "scenario",
          codeunit: "",
          procedure: "",
          oracle: "",
          setup: false,
          outcome: "",
          scenario_outcome: s.status,
          error: s.error ?? "",
          statements: "",
          ms: "",
        }]
    ),
  ];
}

// ---------------------------------------------------------------- step

export async function sqlCostStep(o: {
  runner: SqlCostRunner;
  rows: Row[];
  /** Results folder: final workspaces are `<results>/workspaces/<hash>`. */
  results: string;
  hashOf: Map<string, string>;
  startOf: (task: string) => Promise<StartTree>;
  jobs: number;
  /** Output folder (`<out>/sql-cost`). */
  dir: string;
  rev: string;
  /** Only these tasks (`--sql-cost-task`); none = all. */
  tasks?: string[] | undefined;
  /** `infra/cg-sql-scale`: scale scenarios on a task that has `<task>/src`; absent = phase off. */
  scenarioRoot?: string | undefined;
  /** Test seam: the measurement app version the cache keys on. */
  measureVersion?: string | undefined;
}): Promise<{
  failed: { id: string; part: "oracle" | "scenario"; error: string }[];
  rows: SqlCostRow[];
  scenarios: ScenarioEntry[];
}> {
  const version = o.measureVersion ?? SQL_MEASURE_APP_VERSION;
  const execDir = join(
    o.dir,
    "cache",
    o.runner.id.replace(/[^A-Za-z0-9._-]/g, "_"),
    "exec",
  );
  await Deno.mkdir(execDir, { recursive: true });
  const env = await o.runner.env();
  const containers = [...env.containers].sort((a, b) =>
    a.name.localeCompare(b.name) || a.bc_version.localeCompare(b.bc_version)
  );
  const envHash = await sha256Hex(
    JSON.stringify({ symbols: env.symbols, containers }),
  );
  // test-authoring has no fail_to_pass oracle: nothing to measure.
  const todo = o.rows.filter((r) =>
    o.hashOf.has(r.id) && r.kind !== "test-authoring" &&
    (!o.tasks?.length || o.tasks.includes(r.task))
  );
  const inputs = (r: Row, start: StartTree) => [
    start.id,
    o.hashOf.get(r.id),
    r.verdict,
    r.judgment_id,
    envHash,
    version,
  ];
  const stampOf = async (
    r: Row,
    start: StartTree,
    extra: unknown[] = [],
  ): Promise<DoneStamp> => ({
    build: o.runner.id,
    rev: o.rev,
    hash: o.hashOf.get(r.id)!,
    derive: SQL_COST_DERIVATION,
    bind: {
      inputs: await sha256Hex(JSON.stringify([...inputs(r, start), ...extra])),
    },
  });
  // The scenario sources of each task, read once.
  const scenarioOf = new Map<
    string,
    Promise<
      { files: ScenarioFile[]; specs: ScenarioSpec[]; sha: string } | null
    >
  >();
  const scenarioFor = (task: string) => {
    if (!o.scenarioRoot) return Promise.resolve(null);
    if (!scenarioOf.has(task)) {
      scenarioOf.set(
        task,
        readScenarioFiles(o.scenarioRoot, task).then(async (files) =>
          files.length === 0 ? null : {
            files,
            specs: parseScenarioSpecs(files),
            sha: await scenarioSha(files),
          }
        ),
      );
    }
    return scenarioOf.get(task)!;
  };
  const stamps = new Map<string, DoneStamp>();
  const scenarioStamps = new Map<string, DoneStamp>();
  const failed: { id: string; part: "oracle" | "scenario"; error: string }[] =
    [];
  const fail = (id: string, part: "oracle" | "scenario", err: unknown) => {
    const error = (err as Error).message;
    failed.push({ id, part, error });
    console.error(`[WARN] sql-cost ${id} (${part}): ${error}`);
  };
  await pool(o.jobs, todo, async (r) => {
    const start = await o.startOf(r.task).catch((err) => {
      fail(r.id, "oracle", err);
      return null;
    });
    if (!start) return;
    // Part 1: the judge-measured oracle run.
    let oracleOk = false;
    try {
      const stamp = await stampOf(r, start);
      stamps.set(r.id, stamp);
      if (validRows(await readDone<unknown>(execDir, r.id, stamp))) {
        oracleOk = true;
      } else {
        const res = await o.runner.run({
          executionId: r.id,
          task: r.task,
          workspaceHash: o.hashOf.get(r.id)!,
          judgmentId: r.judgment_id,
          start: start.dir,
          artifact: join(o.results, "workspaces", o.hashOf.get(r.id)!),
        });
        const rows = sqlCostRows(r, res);
        if (
          !containers.some((c) =>
            c.name === res.identity.container &&
            c.bc_version === res.identity.bc_version
          )
        ) {
          throw new Error(
            `runner identity ${res.identity.container} (${res.identity.bc_version}) is not in its own env()`,
          );
        }
        // Written last and atomically: only a complete, valid result marks it done.
        await writeDone(execDir, r.id, stamp, rows);
        oracleOk = true;
      }
    } catch (err) {
      fail(r.id, "oracle", err);
    }
    // Part 2: the task's scale scenario, after a measured oracle run; its outcome
    // is recorded on its own and never reaches the oracle part or the verdict.
    if (!oracleOk) return;
    try {
      const sc = await scenarioFor(r.task);
      if (!sc) return;
      const stamp = await stampOf(r, start, ["scenario", sc.sha]);
      scenarioStamps.set(r.id, stamp);
      const sid = `${r.id}.scenario`;
      if (validScenarioRecord(await readDone<unknown>(execDir, sid, stamp))) {
        return;
      }
      if (!o.runner.scenario) {
        throw new Error("this runner cannot run scenarios");
      }
      const res = await o.runner.scenario({
        executionId: r.id,
        task: r.task,
        start: start.dir,
        production: join(o.results, "workspaces", o.hashOf.get(r.id)!),
        files: sc.files,
        specs: sc.specs,
      });
      if (
        res.compile.ok &&
        !containers.some((c) =>
          c.name === res.identity.container &&
          c.bc_version === res.identity.bc_version
        )
      ) {
        throw new Error(
          `runner identity ${res.identity.container} (${res.identity.bc_version}) is not in its own env()`,
        );
      }
      await writeDone(execDir, sid, stamp, scenarioRecord(sc.specs, res));
    } catch (err) {
      fail(r.id, "scenario", err);
    }
  });
  const all: SqlCostRow[] = [];
  const scenarios: ScenarioEntry[] = [];
  const byId = new Map(todo.map((r) => [r.id, r]));
  for (const id of [...stamps.keys()].sort()) {
    const prior = await readDone<unknown>(execDir, id, stamps.get(id)!);
    if (!validRows(prior)) {
      if (!failed.some((f) => f.id === id && f.part === "oracle")) {
        failed.push({
          id,
          part: "oracle",
          error: "row not readable after the run",
        });
      }
      continue;
    }
    all.push(...prior);
    const stamp = scenarioStamps.get(id);
    if (!stamp) continue;
    const sc = await readDone<unknown>(execDir, `${id}.scenario`, stamp);
    if (validScenarioRecord(sc)) {
      const r = byId.get(id)!;
      scenarios.push({ ...sc, id, task: r.task, arm: r.arm, repeat: r.repeat });
    } else if (!failed.some((f) => f.id === id && f.part === "scenario")) {
      failed.push({
        id,
        part: "scenario",
        error: "row not readable after the run",
      });
    }
  }
  await Deno.mkdir(o.dir, { recursive: true });
  const flat = flatRows(all, scenarios);
  await writeAtomic(
    join(o.dir, "executions.json"),
    JSON.stringify(flat, null, 1),
  );
  await writeAtomic(join(o.dir, "executions.csv"), csv(flat));
  await writeAtomic(
    join(o.dir, "summary.json"),
    JSON.stringify(
      {
        note:
          "Oracle rows and scenario methods, per task and arm, never totalled across tasks. Numbers include a constant framework overhead per test. Scenario outcomes never affect a verdict.",
        measure_app_version: version,
        failed,
        tasks: sqlCostSummary(all, scenarios),
      },
      null,
      1,
    ),
  );
  console.error(
    `[OK] sql-cost: ${todo.length} executions, ${failed.length} failed parts, ${scenarios.length} scenarios -> ${o.dir}`,
  );
  return { failed, rows: all, scenarios };
}
