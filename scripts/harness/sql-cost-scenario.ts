/**
 * Q-06 phase 2: scale scenarios for `--sql-cost`.
 *
 * `infra/cg-sql-scale/<task>/src/*.al` are plain test codeunits. For an execution
 * the step publishes them as the only sources of the Test app over the
 * execution's final production apps and measures every [Test] method in
 * declaration order (a setup method first, then one measured call per method).
 * A scenario only measures: its outcome is never part of a verdict.
 */
import { join } from "@std/path";
import { sha256Hex } from "./analyze-campaign.ts";
import type { SqlMeasurement } from "../../src/container/types.ts";

export interface ScenarioFile {
  name: string;
  text: string;
}

export interface ScenarioSpec {
  codeunit: number;
  /** [Test] procedure names, in declaration order. */
  procedures: string[];
}

/** The scenario sources of a task (sorted by file name); none when the folder is absent. */
export async function readScenarioFiles(
  root: string,
  task: string,
): Promise<ScenarioFile[]> {
  const dir = join(root, task, "src");
  const files: ScenarioFile[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.toLowerCase().endsWith(".al")) {
        files.push({
          name: e.name,
          text: await Deno.readTextFile(join(dir, e.name)),
        });
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** sha256 over the file names and bytes: part of the scenario cache key. */
export function scenarioSha(files: ScenarioFile[]): Promise<string> {
  return sha256Hex(JSON.stringify(files.map((f) => [f.name, f.text])));
}

// A string literal is blanked (so a [Test] inside one is not read); a line or block comment is dropped.
const NOISE = /'(?:[^']|'')*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const CODEUNIT = /^[ \t]*codeunit[ \t]+(\d+)\b/gim;
const TEST = /\[\s*Test\s*\]\s*(?:\[[^\]]*\]\s*)*procedure\s+("[^"]+"|\w+)/gi;

/**
 * The codeunit ids and their [Test] procedures, in file then declaration order.
 * Every codeunit must carry at least one [Test]; anything else throws, so a
 * malformed scenario is loud.
 */
export function parseScenarioSpecs(files: ScenarioFile[]): ScenarioSpec[] {
  const specs: ScenarioSpec[] = [];
  for (const f of files) {
    const text = f.text.replace(NOISE, (m) => m.startsWith("'") ? "''" : "");
    const heads = [...text.matchAll(CODEUNIT)].map((m) => ({
      at: m.index!,
      codeunit: Number(m[1]),
    }));
    if (heads.length === 0) throw new Error(`${f.name}: no codeunit`);
    const mine = heads.map((h) => ({ ...h, procedures: [] as string[] }));
    for (const m of text.matchAll(TEST)) {
      const owner = mine.filter((h) => h.at < m.index!).at(-1);
      if (!owner) throw new Error(`${f.name}: [Test] before any codeunit`);
      owner.procedures.push(m[1]!.replace(/^"|"$/g, ""));
    }
    for (const h of mine) {
      if (h.procedures.length === 0) {
        throw new Error(`${f.name}: codeunit ${h.codeunit} has no [Test]`);
      }
      specs.push({ codeunit: h.codeunit, procedures: h.procedures });
    }
  }
  return specs;
}

// ---------------------------------------------------------------- outcome

/** What the runner returns for one scenario run. */
export interface ScenarioRunResult {
  compile: { ok: boolean; diagnostics: string[] };
  rows: {
    codeunit: number;
    procedure: string;
    outcome: "pass" | "fail" | "not_run";
    failure: string | null;
    message: string | null;
  }[];
  measurements: SqlMeasurement[];
  identity: { container: string; bc_version: string };
}

export type ScenarioStatus = "ok" | "scenario_failed" | "scenario_unmeasured";

export interface ScenarioRow {
  codeunit: number;
  procedure: string;
  /** A method whose name starts with Setup builds data; it is not a measured call. */
  setup: boolean;
  statements: number;
  ms: number;
}

export interface ScenarioRecord {
  status: ScenarioStatus;
  error: string | null;
  /** Only when status is ok. */
  rows: ScenarioRow[];
}

const key = (codeunit: number, procedure: string) =>
  `${codeunit}|${procedure.toLowerCase()}`;

/**
 * The scenario's record. Fail closed: a compile failure or any non-passing row
 * (later rows count too) is `scenario_failed` with the text; a passing row with
 * no measurement is `scenario_unmeasured`; no numbers in either case. An infra
 * row throws (the run is retried, nothing is recorded).
 */
export function scenarioRecord(
  specs: ScenarioSpec[],
  res: ScenarioRunResult,
): ScenarioRecord {
  const none = { rows: [] as ScenarioRow[] };
  if (!res.compile.ok) {
    return {
      status: "scenario_failed",
      error: `compile failed: ${res.compile.diagnostics.join("; ")}`,
      ...none,
    };
  }
  const infra = res.rows.find((r) => r.failure === "infra");
  if (infra) throw new Error(`${infra.codeunit} ${infra.procedure} is infra`);
  const byKey = new Map(res.rows.map((r) => [key(r.codeunit, r.procedure), r]));
  const bad: string[] = [];
  for (const s of specs) {
    for (const p of s.procedures) {
      const r = byKey.get(key(s.codeunit, p));
      if (!r) bad.push(`${s.codeunit} ${p}: no result`);
      else if (r.outcome !== "pass") {
        bad.push(`${s.codeunit} ${p}: ${r.message ?? r.outcome}`);
      }
    }
  }
  if (bad.length > 0) {
    return { status: "scenario_failed", error: bad.join("\n"), ...none };
  }
  const rows: ScenarioRow[] = [];
  const unmeasured: string[] = [];
  for (const s of specs) {
    for (const p of s.procedures) {
      const m = res.measurements.filter((x) =>
        key(x.codeunit, x.procedure) === key(s.codeunit, p)
      );
      if (m.length !== 1) unmeasured.push(`${s.codeunit} ${p}`);
      else {
        rows.push({
          codeunit: s.codeunit,
          procedure: p,
          setup: p.startsWith("Setup"),
          statements: m[0]!.statements,
          ms: m[0]!.ms,
        });
      }
    }
  }
  if (unmeasured.length > 0) {
    return {
      status: "scenario_unmeasured",
      error: `no measurement: ${unmeasured.join(", ")}`,
      ...none,
    };
  }
  return { status: "ok", error: null, rows };
}

export function validScenarioRecord(x: unknown): x is ScenarioRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as ScenarioRecord;
  return (r.status === "ok" || r.status === "scenario_failed" ||
    r.status === "scenario_unmeasured") &&
    (r.error === null || typeof r.error === "string") &&
    Array.isArray(r.rows) &&
    r.rows.every((w) =>
      Number.isInteger(w.codeunit) && typeof w.procedure === "string" &&
      typeof w.setup === "boolean" && Number.isFinite(w.statements) &&
      Number.isFinite(w.ms)
    ) && (r.status === "ok" ? r.rows.length > 0 : r.rows.length === 0);
}
