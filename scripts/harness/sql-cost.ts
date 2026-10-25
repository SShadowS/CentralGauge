/**
 * Q-06: SQL cost per [Test] on the oracle run.
 *
 * Re-judges each execution (the real judge, on the harness lane) with the SOAP
 * runner switched to the CG SQL Measure service, and records statements and ms
 * per test. The judgment and its log are discarded: nothing is written or
 * published. The container work is behind the injected `SqlCostRunner`
 * (sql-cost-runner.ts); this module is pure logic, validation, the
 * per-execution cache, the aggregation and the outputs.
 *
 * Fail closed: an execution is listed under `failed`, with no numbers, when the
 * measured verdict differs from the verdict of the judgment the report selects,
 * when any test row lacks a measurement, when any row is infra or not_run, or
 * when an oracle codeunit never ran. The numbers include a constant framework
 * overhead per test, so they compare solutions of one task; they are never
 * totalled across tasks.
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
import type { SqlMeasurement } from "../../src/container/types.ts";
import { SQL_MEASURE_APP_VERSION } from "../../src/container/soap-test-client.ts";

/** Bump when a row is computed differently from the same runner output, or validation tightens. */
export const SQL_COST_DERIVATION = 1;

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

export interface SqlCostRunner {
  /** Names the cache folder (harness commit + scorer). */
  id: string;
  env(): Promise<RunnerEnv>;
  run(req: SqlCostRequest): Promise<SqlCostRunnerResult>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------- rows

export interface SqlCostRow {
  id: string;
  task: string;
  arm: string;
  repeat: number;
  codeunit: number;
  procedure: string;
  oracle: boolean;
  outcome: "pass" | "fail";
  /** null = the whole test method. */
  segment: string | null;
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
      if (mine.filter((m) => m.segment === null).length !== 1) {
        throw new Error(
          `${c.codeunit} ${r.procedure} lacks exactly one whole-test measurement`,
        );
      }
      // The whole-test row first, its segments after it.
      for (
        const m of [
          ...mine.filter((m) => m.segment === null),
          ...mine.filter((m) => m.segment !== null),
        ]
      ) {
        out.push({
          id: e.id,
          task: e.task,
          arm: e.arm,
          repeat: e.repeat,
          codeunit: c.codeunit,
          procedure: r.procedure,
          oracle: oracle.has(c.codeunit),
          outcome: r.outcome as "pass" | "fail",
          segment: m.segment,
          statements: m.statements,
          ms: m.ms,
        });
      }
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
      (r.segment === null || typeof r.segment === "string") &&
      Number.isFinite(r.statements) && Number.isFinite(r.ms)
    );
}

// ---------------------------------------------------------------- aggregation

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const spread = (xs: number[]) => ({
  median: median(xs),
  min: Math.min(...xs),
  max: Math.max(...xs),
});

const stat = (xs: { statements: number; ms: number }[]) => ({
  n: xs.length,
  statements: spread(xs.map((x) => x.statements)),
  ms: spread(xs.map((x) => x.ms)),
});

type Stat = ReturnType<typeof stat>;
export type SqlCostSummary = Record<
  string,
  Record<string, { procedures: Record<string, Stat>; execution_sum: Stat }>
>;

/**
 * Per task and arm, oracle rows only: per procedure (a segment is its own key,
 * `codeunit.procedure#segment`) the n and median/min/max of statements and ms
 * across repeats; and the same over the per-execution sum of the oracle
 * whole-test rows. Never a total across tasks or across a task's arms.
 */
export function sqlCostSummary(rows: SqlCostRow[]): SqlCostSummary {
  const out: SqlCostSummary = {};
  const oracle = rows.filter((r) => r.oracle);
  for (const task of [...new Set(oracle.map((r) => r.task))].sort()) {
    out[task] = {};
    const ofTask = oracle.filter((r) => r.task === task);
    for (const arm of [...new Set(ofTask.map((r) => r.arm))].sort()) {
      const rs = ofTask.filter((r) => r.arm === arm);
      const procedures: Record<string, Stat> = {};
      const names = [
        ...new Set(
          rs.map((r) =>
            `${r.codeunit}.${r.procedure}${
              r.segment === null ? "" : `#${r.segment}`
            }`
          ),
        ),
      ].sort();
      for (const name of names) {
        procedures[name] = stat(
          rs.filter((r) =>
            `${r.codeunit}.${r.procedure}${
              r.segment === null ? "" : `#${r.segment}`
            }` === name
          ),
        );
      }
      const sums = new Map<string, { statements: number; ms: number }>();
      for (const r of rs.filter((r) => r.segment === null)) {
        const s = sums.get(r.id) ?? { statements: 0, ms: 0 };
        s.statements += r.statements;
        s.ms += r.ms;
        sums.set(r.id, s);
      }
      out[task]![arm] = { procedures, execution_sum: stat([...sums.values()]) };
    }
  }
  return out;
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
  /** Test seam: the measurement app version the cache keys on. */
  measureVersion?: string | undefined;
}): Promise<{ failed: { id: string; error: string }[]; rows: SqlCostRow[] }> {
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
  const stampOf = async (r: Row, start: StartTree): Promise<DoneStamp> => ({
    build: o.runner.id,
    rev: o.rev,
    hash: o.hashOf.get(r.id)!,
    derive: SQL_COST_DERIVATION,
    bind: {
      inputs: await sha256Hex(
        JSON.stringify([
          start.id,
          o.hashOf.get(r.id),
          r.verdict,
          r.judgment_id,
          envHash,
          version,
        ]),
      ),
    },
  });
  const stamps = new Map<string, DoneStamp>();
  const failed: { id: string; error: string }[] = [];
  await pool(o.jobs, todo, async (r) => {
    try {
      const start = await o.startOf(r.task);
      const stamp = await stampOf(r, start);
      stamps.set(r.id, stamp);
      if (validRows(await readDone<unknown>(execDir, r.id, stamp))) return;
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
    } catch (err) {
      const error = (err as Error).message;
      failed.push({ id: r.id, error });
      console.error(`[WARN] sql-cost ${r.id}: ${error}`);
    }
  });
  const all: SqlCostRow[] = [];
  for (const id of [...stamps.keys()].sort()) {
    const prior = await readDone<unknown>(execDir, id, stamps.get(id)!);
    if (validRows(prior)) all.push(...prior);
    else if (!failed.some((f) => f.id === id)) {
      failed.push({ id, error: "row not readable after the run" });
    }
  }
  await Deno.mkdir(o.dir, { recursive: true });
  await writeAtomic(
    join(o.dir, "executions.json"),
    JSON.stringify(all, null, 1),
  );
  await writeAtomic(
    join(o.dir, "executions.csv"),
    csv(all.map((r) => ({
      id: r.id,
      task: r.task,
      arm: r.arm,
      repeat: r.repeat,
      codeunit: r.codeunit,
      procedure: r.procedure,
      segment: r.segment ?? "",
      oracle: r.oracle ? "oracle" : "other",
      outcome: r.outcome,
      statements: r.statements,
      ms: r.ms,
    }))),
  );
  await writeAtomic(
    join(o.dir, "summary.json"),
    JSON.stringify(
      {
        note:
          "Oracle rows only. Per task and arm, never totalled across tasks. Numbers include a constant framework overhead per test.",
        measure_app_version: version,
        failed,
        tasks: sqlCostSummary(all),
      },
      null,
      1,
    ),
  );
  console.error(
    `[OK] sql-cost: ${
      todo.length - failed.length
    } of ${todo.length} executions (${failed.length} failed) -> ${o.dir}`,
  );
  return { failed, rows: all };
}
