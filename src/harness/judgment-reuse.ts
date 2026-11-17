/**
 * H-104: a judgment reused by reference. qualify's mock cell takes the
 * judge-fixture verdict when every judge input matches (reusableJudgment) and
 * records a reuse marker beside the execution; judgmentOwed treats an
 * execution with a marker that still holds as judged.
 */
import { basename, dirname, join } from "@std/path";
import type { ExecutionRecord, JudgmentRecord } from "./records.ts";
import { JudgmentRecordSchema } from "./records.ts";

/** H-104: the judge inputs a reused judgment must match. */
export interface JudgeInputs {
  task_id: string;
  /** visibleInputHash: the task's visible files, refapp and symbols (the pristine tree). */
  task_visible_hash: string;
  workspace_hash: string;
  task_oracle_hash: string;
  scorer_fingerprint: string;
  env_fp: string | null;
  harness_commit: string | null;
}

/** H-104: a judge-fixture judgment with its provenance's visible-input hash. */
export interface FixtureJudgment {
  judgment: JudgmentRecord;
  task_visible_hash: string;
}

/**
 * H-104: a judgment stands for a fresh one of `x` when every judge input
 * matches. Unknown (null) env_fp or harness commit, an unscored verdict or a
 * v1 record never match: the caller judges.
 */
export function reusableJudgment(f: FixtureJudgment, x: JudgeInputs): boolean {
  const j = f.judgment;
  return j.v === 2 && j.verdict !== "unscored" && !j.forced &&
    x.env_fp !== null && x.harness_commit !== null &&
    j.task_id === x.task_id &&
    f.task_visible_hash === x.task_visible_hash &&
    j.workspace_hash === x.workspace_hash &&
    j.task_oracle_hash === x.task_oracle_hash &&
    j.scorer_fingerprint === x.scorer_fingerprint &&
    j.provenance?.env_fp === x.env_fp &&
    j.provenance.harness_commit === x.harness_commit;
}

/** H-104 run 002: the reuse marker of an execution, beside its published run files. */
export const reuseMarkerPath = (resultsRoot: string, executionId: string) =>
  join(resultsRoot, "runs", executionId, "judgment-reuse.json");

/**
 * H-109: the results root a marker's fixture paths are relative to. qualify
 * records under <results>/qualify/<sha256> while judge-fixture writes under
 * <results>/fixtures, so a qualify root resolves to <results>; any other root
 * is its own.
 */
export function fixturesRootOf(resultsRoot: string): string {
  const parent = dirname(resultsRoot);
  return basename(parent) === "qualify" &&
      /^[0-9a-f]{64}$/.test(basename(resultsRoot))
    ? dirname(parent)
    : resultsRoot;
}

/**
 * H-104 run 002: an execution judged by reference. Paths are relative to
 * fixturesRootOf(results root), POSIX; `inputs` are the eight matched judge
 * inputs.
 */
export interface ReuseMarker {
  v: 1;
  execution_id: string;
  judgment_id: string;
  judgment_path: string;
  provenance_path: string;
  inputs: JudgeInputs;
}

/** H-104 run 002: written once; an existing marker is never replaced. */
export async function writeReuseMarker(
  resultsRoot: string,
  m: ReuseMarker,
): Promise<void> {
  const path = reuseMarkerPath(resultsRoot, m.execution_id);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(m, null, 2) + "\n", {
    createNew: true,
  });
}

/** A marker path: under the results root's fixtures, never outside it. */
const fixturePath = (p: unknown): p is string =>
  typeof p === "string" && p.startsWith("fixtures/") &&
  !p.split("/").includes("..");

/**
 * H-104 run 002: an execution with a holding reuse marker is judged by
 * reference. It holds while the marker names this execution and its task,
 * workspace and visible inputs, and the referenced judgment (same id) and its
 * provenance still match the marker's inputs (reusableJudgment). Anything
 * missing, unreadable or different: false (the execution is owed).
 */
export async function reusedByReference(
  resultsRoot: string,
  e: ExecutionRecord,
): Promise<boolean> {
  try {
    const m = JSON.parse(
      await Deno.readTextFile(reuseMarkerPath(resultsRoot, e.id)),
    ) as ReuseMarker;
    const x = m.inputs;
    if (
      m.v !== 1 || m.execution_id !== e.id ||
      !fixturePath(m.judgment_path) || !fixturePath(m.provenance_path) ||
      x.task_id !== e.task_id || x.workspace_hash !== e.workspace_hash ||
      x.task_visible_hash !== e.task_visible_hash
    ) return false;
    const root = fixturesRootOf(resultsRoot);
    const j = JudgmentRecordSchema.parse(
      JSON.parse(await Deno.readTextFile(join(root, m.judgment_path))),
    );
    const p = JSON.parse(
      await Deno.readTextFile(join(root, m.provenance_path)),
    ) as { task_visible_hash?: unknown };
    return j.id === m.judgment_id && typeof p.task_visible_hash === "string" &&
      reusableJudgment(
        { judgment: j, task_visible_hash: p.task_visible_hash },
        x,
      );
  } catch {
    return false;
  }
}
