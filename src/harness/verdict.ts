/**
 * Verdict pipeline (spec 1a section 7): scorers on a reconstructed
 * workspace, per-procedure results. A BC fault rejudges on another
 * container (BcLane); when every container fails, the scorers that did not
 * finish are null and the verdict is unscored (spec 1a section 8). The
 * agent is never re-run for a verdict-side fault.
 */

import { dirname, join } from "@std/path";
import type { TestResult } from "../container/types.ts";
import type { InfraRetryRecord } from "../tasks/interfaces.ts";
import type { WantedApp } from "./bc-apps.ts";
import type {
  DeployContext,
  HarnessBc,
  LockedSymbols,
  Prepared,
} from "./bc-lane.ts";
import type { JudgmentRecord } from "./records.ts";
import type { StagedApp } from "./staging.ts";
import type { LoadedTask } from "./task.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import {
  InfraRetriesExhaustedError,
  NoEligibleContainersError,
} from "../parallel/errors.ts";
import { CASCADE_CODES } from "../stats/omission.ts";
import {
  type BcLane,
  buildApps,
  deployAndTest,
  prepareApps,
  scorerPassed,
  type TestMessage,
  type TestRow,
  type TestSpec,
} from "./bc-lane.ts";
import { hashFile } from "./hash.ts";
import { JudgmentRecordSchema, scorerFingerprint } from "./records.ts";
import { readAppGraph, readAppJson } from "./staging.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
  TEST_APP,
} from "./verdict-workspace.ts";

/**
 * The full scorer suite, recorded on every judgment whatever the task kind,
 * so one suite version has one fingerprint (Part 1 refuses mixed
 * fingerprints in a comparison). Bump a version when a scorer's semantics
 * change; judgments with another fingerprint are superseded (rejudge).
 */
export const SCORER_SUITE: Record<string, string> = {
  build: "1",
  pass_to_pass: "1",
  fail_to_pass: "1",
  mutant_kill: "1",
};
type ScorerName = "build" | "pass_to_pass" | "fail_to_pass" | "mutant_kill";

export function currentScorerFingerprint(): Promise<string> {
  return scorerFingerprint(SCORER_SUITE);
}

/** A judgment that needs no rejudge: current suite and not unscored. */
export async function isCurrentJudgment(j: JudgmentRecord): Promise<boolean> {
  return j.verdict !== "unscored" &&
    j.scorer_fingerprint === await currentScorerFingerprint();
}

/**
 * The codes a failed build is attributed to, sorted and unique. The
 * compiler's generic "AL0000 App generation failed" trailer is ignored next
 * to other codes and kept when alone (decision 2026-09-25-gate-al0000, as
 * gate-core missingFeatureOnly). Either way the build has failed.
 */
export function buildFailureCodes(codes: string[]): string[] {
  const all = [...new Set(codes)].sort();
  const real = all.filter((c) => !CASCADE_CODES.has(c));
  return real.length > 0 ? real : all;
}

export interface JudgeInput {
  executionId: string;
  workspaceHash: string;
  task: LoadedTask;
  /** The oracle hash this judgment is recorded against (campaign or current). */
  oracleHash: string;
  /** Staged workspace of this task: trusted. */
  pristine: string;
  /** Frozen workspace in the store. */
  artifact: string;
  symbolIds: ReadonlySet<string>;
  workDir: string;
  lock: LockedSymbols;
  /** The removal allowlist's trusted roots (pristine, oracle) are set by judge, never by the caller. */
  deploy: Pick<DeployContext, "ledgerRoot">;
}

export interface VerdictSpans {
  reconstruct_ms: number;
  compile_ms: number;
  queue_ms: number;
  provisioning_ms: number;
  candidate_publish_ms: number;
  test_ms: number;
  total_ms: number;
}

export interface VerdictLog {
  v: 1;
  judgment_id: string;
  execution_id: string;
  violations: string[];
  diagnostics: { app: string; code: string; message: string }[];
  test_messages: TestMessage[];
  notes: string[];
  spans: VerdictSpans;
  containers: string[];
  infra_retries: InfraRetryRecord[];
  per_app_compiles: number;
  error: string | null;
}

interface Scorer {
  name: string;
  passed: boolean | null;
  tests: TestRow[];
}

/** Scorer state for one judgment: unfinished scorers become null on infra. */
export class Scores {
  readonly list: Scorer[];
  private readonly done = new Set<string>();
  constructor(names: readonly string[]) {
    this.list = names.map((name) => ({ name, passed: false, tests: [] }));
  }
  has(name: ScorerName): boolean {
    return this.list.some((s) => s.name === name);
  }
  set(name: ScorerName, passed: boolean | null, tests: TestRow[] = []): void {
    const s = this.list.find((x) => x.name === name);
    // Never a silent drop: a result for a scorer the task does not list is a harness bug.
    if (!s) throw new Error(`scorer ${name} is not in this task's scorers`);
    s.passed = passed;
    s.tests = tests;
    this.done.add(name);
  }
  /** Every scorer not yet decided fails (after a build failure or violation). */
  failRest(): void {
    for (const s of this.list) {
      if (!this.done.has(s.name)) this.set(s.name as ScorerName, false);
    }
  }
  /** Every scorer not yet decided is unscored (infra on every container). */
  nullRest(): void {
    for (const s of this.list) {
      if (!this.done.has(s.name)) this.set(s.name as ScorerName, null);
    }
  }
}

export interface JudgeContext {
  lane: BcLane;
  i: JudgeInput;
  scores: Scores;
  log: VerdictLog;
  deploy: DeployContext;
}

function recordBuild(ctx: JudgeContext, prep: Prepared, label: string): void {
  ctx.log.spans.compile_ms += prep.compile_ms;
  ctx.log.per_app_compiles += prep.per_app_compiles;
  for (const b of prep.built) {
    for (const d of b.diagnostics) {
      ctx.log.diagnostics.push({
        app: `${label}/${b.folder}`,
        code: d.code,
        message: d.message,
      });
    }
  }
  const failed = prep.built.filter((b) => !b.ok);
  if (failed.length > 0) {
    ctx.log.notes.push(
      `build failed: ${
        failed.map((b) =>
          `${b.folder} ${
            buildFailureCodes(b.diagnostics.map((d) => d.code)).join(",") ||
            "(no diagnostics)"
          }`
        ).join("; ")
      }`,
    );
  }
}

/**
 * The lane's BC with agent-added test runs made agent-owned: a throw, a
 * hang (timeout), zero results or a missing discovered procedure becomes a
 * failed, not-run procedure (runtime_error), never infra. The agent
 * controls that code, so it must not reroute or unscore the verdict.
 * Every such event is noted.
 */
export function agentTestsBc(
  bc: HarnessBc,
  discovered: ReadonlyMap<number, readonly string[]>,
  notes: string[],
): HarnessBc {
  return {
    compileProject: (c, p) => bc.compileProject(c, p),
    harnessCompilerIdentity: (c) => bc.harnessCompilerIdentity(c),
    listHarnessApps: (c) => bc.listHarnessApps(c),
    syncHarnessApps: (c, p) => bc.syncHarnessApps(c, p),
    async runHarnessTests(c, codeunit): Promise<TestResult> {
      const procs = discovered.get(codeunit);
      if (!procs) throw new Error(`codeunit ${codeunit} is not agent-added`);
      let r: TestResult | null = null;
      try {
        r = await bc.runHarnessTests(c, codeunit);
      } catch (err) {
        notes.push(
          `agent-added test codeunit ${codeunit} did not complete on ${c}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      const byName = new Map(
        (r?.results ?? []).map((x) => [x.name.toLowerCase(), x]),
      );
      const results = procs.map((name) => {
        const x = byName.get(name.toLowerCase());
        if (x) return x;
        if (r) {
          notes.push(
            `agent-added test ${codeunit} ${name} reported no result on ${c}`,
          );
        }
        // No error text: runTests records it as not_run, runtime_error.
        return { name, passed: false, duration: 0 };
      });
      const passed = results.filter((x) => x.passed).length;
      return {
        success: passed === results.length,
        totalTests: results.length,
        passedTests: passed,
        failedTests: results.length - passed,
        duration: r?.duration ?? 0,
        results,
        output: "",
      };
    },
  };
}

/** Publish + test on one held container; spans and retries go to the log. */
export async function runHeld(
  ctx: JudgeContext,
  wanted: WantedApp[],
  tests: TestSpec[],
  cleanupIds: string[],
  bc: HarnessBc = ctx.lane.bc,
): Promise<{ rows: TestRow[] }> {
  const held = await ctx.lane.exclusive(
    {
      taskId: ctx.i.task.task.id,
      variantId: ctx.i.executionId,
      attemptNumber: 1,
    },
    (c) =>
      deployAndTest(bc, c, {
        wanted,
        tests,
        cleanupIds,
        ctx: ctx.deploy,
      }),
  );
  const s = ctx.log.spans;
  s.queue_ms += held.queue_ms;
  s.provisioning_ms += held.result.deployed.provisioning_ms;
  s.candidate_publish_ms += held.result.deployed.candidate_publish_ms;
  s.test_ms += held.result.test_ms;
  ctx.log.containers.push(held.container);
  ctx.log.infra_retries.push(...held.retries);
  ctx.log.test_messages.push(...held.result.messages);
  if (held.result.cleanupError) {
    // The lane quarantined the container inside the held region (round 3 B4).
    ctx.log.notes.push(
      `quarantined ${held.container}: ${held.result.cleanupError}`,
    );
  }
  return { rows: held.result.rows };
}

async function buildOracle(
  ctx: JudgeContext,
  prep: Prepared,
): Promise<WantedApp | null> {
  const dir = join(ctx.i.task.dir, "oracle");
  const aj = await readAppJson(join(dir, "app.json"));
  const workspaceIds = new Set(prep.wanted.map((w) => w.id));
  const deps = aj.dependencies.map((d) => d.id.toLowerCase());
  const app: StagedApp = {
    folder: "oracle",
    id: aj.id.toLowerCase(),
    name: aj.name,
    publisher: aj.publisher,
    version: aj.version,
    idRanges: aj.idRanges,
    depends: [],
    // Checked against the lock by buildApps, so BCH never fills a gap from its cache.
    external: deps.filter((id) => !workspaceIds.has(id)).sort(),
  };
  // Through the lane's admission for that container (round 2 item 5).
  const [b] = await ctx.lane.compileOn(
    prep.container,
    (c) =>
      buildApps(ctx.lane.bc, c, {
        srcDir: ctx.i.task.dir,
        apps: [app],
        versions: new Map([["oracle", aj.version]]),
        outDir: join(ctx.i.workDir, "oracle-build"),
        lock: ctx.i.lock,
        prebuilt: new Map(prep.wanted.map((w) => [w.id, w.file])),
      }),
  );
  if (!b) throw new Error("oracle build returned no result");
  ctx.log.spans.compile_ms += b.compile_ms;
  if (b.attempted) ctx.log.per_app_compiles++;
  for (const d of b.diagnostics) {
    ctx.log.diagnostics.push({
      app: "oracle",
      code: d.code,
      message: d.message,
    });
  }
  if (!b.ok || b.file === null) {
    ctx.log.notes.push(
      `oracle build failed: ${
        buildFailureCodes(b.diagnostics.map((d) => d.code)).join(",") ||
        "(no diagnostics)"
      }`,
    );
    return null;
  }
  return {
    id: app.id,
    name: app.name,
    publisher: app.publisher,
    version: aj.version,
    // Trusted, not the agent's: a publish failure is infra (reroute), never a model defect.
    stamp: await hashFile(dirname(b.file), b.file),
    file: b.file,
    role: "prereq",
    depends: deps.filter((id) => workspaceIds.has(id)),
  };
}

/** feature, bugfix, refactor: build, pass_to_pass, fail_to_pass. */
async function scoreChange(ctx: JudgeContext): Promise<void> {
  const { i, scores, log } = ctx;
  const t = i.task.task;
  const tr = performance.now();
  const vw = await buildVerdictWorkspace({
    pristine: i.pristine,
    artifact: i.artifact,
    out: join(i.workDir, "verdict"),
    symbolIds: i.symbolIds,
  });
  log.spans.reconstruct_ms = performance.now() - tr;
  log.violations = vw.violations;
  if (vw.violations.length > 0) return scores.failRest();

  const prep = await prepareApps(ctx.lane, {
    pristine: i.pristine,
    pristineApps: await readAppGraph(i.pristine),
    candidateDir: vw.dir,
    candidateApps: vw.apps,
    changed: vw.changed,
    workDir: join(i.workDir, "apps"),
    lock: i.lock,
  });
  recordBuild(ctx, prep, "candidate");
  if (!prep.buildOk) return scores.failRest();
  scores.set("build", true);

  const p2p: TestSpec[] = [];
  const agent: TestSpec[] = [];
  const testPageRows: TestRow[] = [];
  if (scores.has("pass_to_pass")) {
    for (const r of t.pass_to_pass) {
      p2p.push({
        codeunit: r.codeunit,
        procedures: r.procedures,
        target: "candidate",
      });
    }
    const added = await addedTestCodeunits(
      join(i.pristine, TEST_APP),
      join(vw.dir, TEST_APP),
    );
    for (const a of added) {
      if (a.testPage) {
        const message =
          "TestPage tests are not supported by the harness test runner";
        for (
          const procedure of a.procedures.length > 0
            ? a.procedures
            : ["(TestPage)"]
        ) {
          testPageRows.push({
            codeunit: a.codeunit,
            procedure,
            target: "candidate",
            outcome: "not_run",
            failure: "runtime_error",
          });
          log.test_messages.push({
            codeunit: a.codeunit,
            procedure,
            target: "candidate",
            message,
          });
        }
        continue;
      }
      if (a.procedures.length === 0) {
        // Nothing to run; running it would report zero results (infra) on every container.
        log.notes.push(
          `added test codeunit ${a.codeunit} (${TEST_APP}/${a.file}) has no [Test] procedure: not run`,
        );
        continue;
      }
      // Run last, in their own hold (agentTestsBc): agent code cannot unscore the verdict.
      agent.push({
        codeunit: a.codeunit,
        procedures: a.procedures,
        target: "candidate",
      });
    }
  }
  const wanted = [...prep.wanted];
  const cleanup = [...prep.candidateIds];
  const f2p: TestSpec[] = [];
  if (t.fail_to_pass) {
    const oracle = await buildOracle(ctx, prep);
    if (oracle === null) {
      scores.set(
        "fail_to_pass",
        false,
        t.fail_to_pass.tests.flatMap((x) =>
          x.procedures.map((p) => ({
            codeunit: x.codeunit,
            procedure: p,
            target: "candidate",
            outcome: "not_run" as const,
            failure: "compile" as const,
          }))
        ),
      );
    } else {
      wanted.push(oracle);
      cleanup.push(oracle.id);
      for (const x of t.fail_to_pass.tests) {
        f2p.push({
          codeunit: x.codeunit,
          procedures: x.procedures,
          target: "candidate",
        });
      }
    }
  }
  // Trusted suites first (visible pass_to_pass and the oracle), then agent-added codeunits.
  let rows: TestRow[] = [];
  if (p2p.length + f2p.length > 0) {
    rows =
      (await runHeld(ctx, wanted, [...p2p, ...f2p], [...cleanup].reverse()))
        .rows;
  }
  // Visible and oracle codeunits live in disjoint bands (80000-84999, 85000-89999).
  const oracleUnits = new Set(f2p.map((s) => s.codeunit));
  if (f2p.length > 0) {
    const r = rows.filter((x) => oracleUnits.has(x.codeunit));
    scores.set("fail_to_pass", scorerPassed(r), r);
  }
  if (scores.has("pass_to_pass")) {
    let agentRows: TestRow[] = [];
    if (agent.length > 0) {
      const discovered = new Map(agent.map((a) => [a.codeunit, a.procedures!]));
      agentRows = (await runHeld(
        ctx,
        prep.wanted,
        agent,
        [...prep.candidateIds].reverse(),
        agentTestsBc(ctx.lane.bc, discovered, log.notes),
      )).rows;
    }
    const r = [
      ...rows.filter((x) => !oracleUnits.has(x.codeunit)),
      ...agentRows,
      ...testPageRows,
    ];
    // Never a pass on zero rows (scorerPassed); only TestPage rows fail.
    scores.set("pass_to_pass", scorerPassed(r), r);
  }
  scores.failRest();
}

/** Implemented in M1-18; until then a test-authoring task is refused loudly. */
export function scoreTestAuthoring(_ctx: JudgeContext): Promise<void> {
  return Promise.reject(new Error("mutant_kill is implemented in M1-18"));
}

export async function judge(
  lane: BcLane,
  i: JudgeInput,
  now: () => Date = () => new Date(),
): Promise<{ judgment: JudgmentRecord; log: VerdictLog }> {
  const started_at = now().toISOString();
  const t0 = performance.now();
  const log: VerdictLog = {
    v: 1,
    judgment_id: crypto.randomUUID(),
    execution_id: i.executionId,
    violations: [],
    diagnostics: [],
    test_messages: [],
    notes: [],
    spans: {
      reconstruct_ms: 0,
      compile_ms: 0,
      queue_ms: 0,
      provisioning_ms: 0,
      candidate_publish_ms: 0,
      test_ms: 0,
      total_ms: 0,
    },
    containers: [],
    infra_retries: [],
    per_app_compiles: 0,
    error: null,
  };
  const scores = new Scores(i.task.task.scorers);
  const deploy: DeployContext = {
    ledgerRoot: i.deploy.ledgerRoot,
    // Both trusted staging outputs: the oracle id must be removable at cleanup.
    trustedRoots: i.task.task.fail_to_pass
      ? [i.pristine, join(i.task.dir, "oracle")]
      : [i.pristine],
  };
  const ctx: JudgeContext = { lane, i, scores, log, deploy };
  try {
    if (i.task.task.kind === "test-authoring") await scoreTestAuthoring(ctx);
    else await scoreChange(ctx);
  } catch (err) {
    if (
      !(err instanceof InfraRetriesExhaustedError) &&
      !(err instanceof NoEligibleContainersError) && !isInfraError(err)
    ) {
      throw err;
    }
    log.error = err instanceof Error ? err.message : String(err);
    scores.nullRest();
  }
  log.spans.total_ms = performance.now() - t0;
  const list = scores.list;
  const verdict = list.some((s) => s.passed === null)
    ? "unscored"
    : list.every((s) => s.passed)
    ? "pass"
    : "fail";
  const judgment = JudgmentRecordSchema.parse({
    v: 1,
    id: log.judgment_id,
    execution_id: i.executionId,
    workspace_hash: i.workspaceHash,
    task_id: i.task.task.id,
    task_oracle_hash: i.oracleHash,
    scorer_versions: SCORER_SUITE,
    scorer_fingerprint: await currentScorerFingerprint(),
    scorers: list,
    verdict,
    verdict_container: log.containers.at(-1) ?? null,
    started_at,
    ended_at: now().toISOString(),
  });
  return { judgment, log };
}

/** Write-once side file results/harness/verdicts/<judgment-id>.json. */
export async function writeVerdictLog(
  resultsRoot: string,
  log: VerdictLog,
): Promise<void> {
  const dir = join(resultsRoot, "verdicts");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `${log.judgment_id}.json`),
    JSON.stringify(log, null, 2) + "\n",
    { createNew: true },
  );
}
