/**
 * Verdict pipeline (spec 1a section 7): scorers on a reconstructed
 * workspace, per-procedure results. A BC fault rejudges on another
 * container (BcLane); when every container fails, the scorers that did not
 * finish are null; the verdict is fail if any scorer failed, else unscored
 * (spec 1a section 8, decision 2026-09-25-verdict-fail-wins). The agent is
 * never re-run for a verdict-side fault.
 */

import { dirname, join } from "@std/path";
import type { TestResult } from "../container/types.ts";
import type { InfraRetryRecord } from "../tasks/interfaces.ts";
import type { WantedApp } from "./bc-apps.ts";
import type {
  BuildCache,
  DeployContext,
  DeployTestResult,
  HarnessBc,
  Held,
  LockedSymbols,
  Prepared,
} from "./bc-lane.ts";
import type { JudgmentRecord } from "./records.ts";
import type { BcEgressRecord } from "./environment.ts";
import type {
  FsCheckRecord,
  ResetMechanism,
  ResetRecord,
  VerifyRecord,
} from "./reset.ts";
import type { StagedApp } from "./staging.ts";
import type { LoadedTask } from "./task.ts";
import { ContainerError, ValidationError } from "../errors.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import {
  InfraRetriesExhaustedError,
  NoEligibleContainersError,
} from "../parallel/errors.ts";
import { CASCADE_CODES } from "../stats/omission.ts";
import {
  type BcLane,
  buildApps,
  CleanupFailedError,
  CLOUD_POLICY,
  DECLARED_POLICY,
  deployAndTest,
  effectiveBuildKey,
  isCascadeDiagnostic,
  lockDigestOf,
  prepareApps,
  type ProductionManifest,
  productionManifest,
  scorerPassed,
  type TestMessage,
  type TestRow,
  type TestSpec,
  throwIfCrashed,
} from "./bc-lane.ts";
import { safeCopyTree } from "./fsutil.ts";
import { envFpOf } from "./environment.ts";
import { hashFile, hashTree } from "./hash.ts";
import {
  type InfraSignature,
  JudgmentRecordSchema,
  type PolicyViolation,
  scorerFingerprint,
  type ScorerState,
  verdictOf,
} from "./records.ts";
import { applyOverlay, readAppGraph, readAppJson } from "./staging.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
  type ReconstructOptions,
  TEST_APP,
  type VerdictWorkspace,
} from "./verdict-workspace.ts";

/**
 * The full scorer suite, recorded on every judgment whatever the task kind,
 * so one suite version has one fingerprint (Part 1 refuses mixed
 * fingerprints in a comparison). Bump a version when a scorer's semantics
 * change; judgments with another fingerprint are superseded (rejudge).
 */
export const SCORER_SUITE: Record<string, string> = {
  // 2: plain procedures added to a shipped helper codeunit are kept in the
  // verdict Test app, which every scorer builds (H-21; all four bumped).
  // 3: the shipped helper is merged with the agent's additions, shipped
  // members always as shipped, and internalsVisibleTo naming the Test app is
  // kept (H-30, owner 2026-10-18 "merge, shipped wins"; all four bumped).
  // 4: G builds the pristine Test app, never the agent's (H-35).
  build: "4",
  // 2: a change task's agent-added tests include those extracted from
  // shipped test codeunits (M4-17a); the task's shipped rows are unchanged.
  // 3: added helper procedures kept (H-21).
  // 4: a thrown or timed-out agent-added test is rerun behind a trusted control
  // (H-26, decision 2026-09-25-agent-suite-infra item 3).
  // 5: helper merge, shipped wins (H-30).
  // 6: shipped rows only, on G; agent-added tests moved to agent_tests (H-35).
  pass_to_pass: "6",
  // 2: added helper procedures kept (H-21). 3: helper merge (H-30).
  // 4: the oracle runs on G, without agent Test code (H-35).
  fail_to_pass: "4",
  // 2: agent-suite rules (decision 2026-09-25-agent-suite-infra).
  // 3: [Test] procedures added to shipped test codeunits are extracted into
  // a generated codeunit, with the credit rules (M4-17a).
  // 4: added helper procedures kept (H-21). 5: helper merge (H-30).
  // 6: the helper as written (H-35).
  mutant_kill: "6",
  // 1: harness-defined, every kind but test-authoring: the agent's own tests
  // on A (agent Test, no shipped test codeunits), H-26 rerun policy (H-35).
  agent_tests: "1",
};
type ScorerName =
  | "build"
  | "pass_to_pass"
  | "fail_to_pass"
  | "mutant_kill"
  | "agent_tests";

/**
 * H-35 (design-r2 3): a judgment's scorers. `agent_tests` is harness-defined,
 * not in task.yml (the scorer list is in every task's oracle hash), so it is
 * added here for every kind but test-authoring.
 */
export function effectiveScorers(
  task: { kind: string; scorers: readonly string[] },
): string[] {
  return task.kind === "test-authoring"
    ? [...task.scorers]
    : [...task.scorers, "agent_tests"];
}

/**
 * H-35 (design-r3 6.3): every scorer suite that ever shipped (the git history
 * of SCORER_SUITE, oldest first) with the judgment record version it goes
 * with. A judgment's scorer_versions must equal exactly one; a missing
 * agent_tests is legacy only for an exact legacy suite.
 */
export const KNOWN_SUITES: readonly {
  id: string;
  v: 1 | 2;
  versions: Readonly<Record<string, string>>;
}[] = [
  ...[
    ["1", "1", "1", "1"],
    ["1", "1", "1", "2"],
    ["1", "2", "1", "3"],
    ["2", "3", "2", "4"],
    ["2", "4", "2", "4"],
    ["3", "5", "3", "5"],
  ].map(([build, p2p, f2p, mk], i) => ({
    id: `legacy-${i + 1}`,
    v: 1 as const,
    versions: {
      build: build!,
      pass_to_pass: p2p!,
      fail_to_pass: f2p!,
      mutant_kill: mk!,
    },
  })),
  { id: "h35", v: 2, versions: SCORER_SUITE },
];

const sameVersions = (
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => b[k] === v);

/** The known suite these versions are, or null (an unknown combination). */
export function suiteOf(
  versions: Readonly<Record<string, string>>,
): (typeof KNOWN_SUITES)[number] | null {
  return KNOWN_SUITES.find((s) => sameVersions(s.versions, versions)) ?? null;
}

/**
 * H-35 (design-r2 3): the scorer names a judgment under these versions must
 * carry for this task descriptor: the task's list under a legacy suite, the
 * effective set (agent_tests added) under the H-35 suite; null when the
 * versions are no known suite.
 */
export function expectedScorers(
  task: { kind: string; scorers: readonly string[] },
  versions: Readonly<Record<string, string>>,
): string[] | null {
  const suite = suiteOf(versions);
  if (!suite) return null;
  return suite.v === 1 ? [...task.scorers] : effectiveScorers(task);
}

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

// H-04: the crash rule lives in bc-lane (inside the compile reroute boundary, H-04b).
export { isCascadeDiagnostic };

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
  /** H-35 S3: `reset` is required: no judge deployment without a reset. */
  deploy: Pick<DeployContext, "ledgerRoot"> & {
    reset: ResetMechanism;
    /** H-35 S3 L2b: the admitted NST egress state, recorded in the log. */
    bcEgress?: BcEgressRecord | null;
  };
  /** H-27: the run's shared build cache (task-fixed builds are reused across cells); none = no reuse. */
  buildCache?: BuildCache;
  /** H-35 provenance: the harness commit judging (null when unknown). */
  harnessCommit?: string | null;
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
  /**
   * H-35 (design-r2 4.2): every deployment of the judgment, in order.
   * Absent in a log written before H-35.
   */
  deployments?: DeploymentRecord[];
  /**
   * H-35 S3 (design-r3 2.4): every reset of the judgment, failed ones
   * included, in order. Absent in a log written before S3.
   */
  resets?: ResetRecord[];
  /**
   * H-35 S3 (design-r4 2): every post-cleanup inventory check, in order. A
   * failed one quarantined its container. Absent in a log written before.
   */
  verifies?: VerifyRecord[];
  /**
   * H-35 S3 L4 (decisions/2026-10-20-h-35-l4-scope.md): every deployment's
   * fsDigest(W) comparison, in order. A failed one was never measured (infra)
   * and quarantined its container. Scope: differences in the declared roots'
   * file/stream contents and recorded metadata between the two observation
   * points, minus the lineage's exclusions; not a complete write history.
   */
  fs_checks?: FsCheckRecord[];
  /**
   * H-35 S3 L2b: the NST egress state the run was admitted under, and its
   * declared override (`--unverified-bc-egress-ok`); null: not recorded.
   */
  bc_egress?: BcEgressRecord | null;
}

/** H-35 (design-r2 4.2): one hold's deployment: what was published where. */
export interface DeploymentRecord {
  /** G, A, control, G', A_ref, A_0, A_m:<name>. */
  hold: string;
  container: string;
  apps: {
    id: string;
    name: string;
    version: string;
    role: string;
    file_sha256: string;
    build_key: string | null;
    source_tree_hash: string | null;
  }[];
  /**
   * H-35 S3.3 (design-r4 5.2): the container's environment fingerprint,
   * null when the reset mechanism carries no lineage (absent before S3).
   */
  env_fp?: string | null;
}

/**
 * H-35 S3.3 (design-r4 5.1, ruling 2026-10-19 (a)): env_fp v1 =
 * hashJson(the lineage's compatibility identity, the mechanism, the symbols
 * lock digest, the container's live compiler identity). Null without a
 * lineage. Image digest, SQL edition, fs baseline and egress join the
 * lineage's compat with `harness baseline create` (a new env_fp).
 */
async function envFp(
  ctx: JudgeContext,
  container: string,
): Promise<string | null> {
  const compat = ctx.i.deploy.reset.compat;
  if (!compat) return null;
  // The same formula admission checks (environment.ts).
  return await envFpOf({
    compat,
    mechanism: ctx.i.deploy.reset.id,
    lockDigest: await lockDigestOf(ctx.i.lock),
    compiler: await ctx.lane.bc.harnessCompilerIdentity(container),
  });
}

/** Records one hold's deployment (every package carries its digest). */
async function recordDeployment(
  ctx: JudgeContext,
  hold: string,
  container: string,
  wanted: WantedApp[],
): Promise<void> {
  const env_fp = await envFp(ctx, container);
  (ctx.log.deployments ??= []).push({
    hold,
    container,
    env_fp,
    apps: wanted.map((w) => {
      if (!w.sha256) throw new Error(`harness bug: ${w.name} has no digest`);
      return {
        id: w.id,
        name: w.name,
        version: w.version,
        role: w.role,
        file_sha256: w.sha256,
        build_key: w.build_key ?? null,
        source_tree_hash: w.source ?? null,
      };
    }),
  });
}

interface Scorer {
  name: string;
  passed: boolean | null;
  /** H-35 v2 (design-r2 3). */
  state: ScorerState;
  tests: TestRow[];
}

/** Scorer state for one judgment: unfinished scorers become null on infra. */
export class Scores {
  readonly list: Scorer[];
  private readonly done = new Set<string>();
  constructor(names: readonly string[]) {
    this.list = names.map((name) => ({
      name,
      passed: false,
      state: "measured" as ScorerState,
      tests: [],
    }));
  }
  has(name: ScorerName): boolean {
    return this.list.some((s) => s.name === name);
  }
  /** A result: null is infra (unscored), a boolean is measured. */
  set(name: ScorerName, passed: boolean | null, tests: TestRow[] = []): void {
    this.put(name, passed, passed === null ? "unscored" : "measured", tests);
  }
  /** H-35 (design-r2 5): the policy gate stopped this scorer. */
  notMeasured(name: ScorerName): void {
    this.put(name, null, "not_measured", []);
  }
  private put(
    name: ScorerName,
    passed: boolean | null,
    state: ScorerState,
    tests: TestRow[],
  ): void {
    const s = this.list.find((x) => x.name === name);
    // Never a silent drop: a result for a scorer the task does not list is a harness bug.
    if (!s) throw new Error(`scorer ${name} is not in this task's scorers`);
    s.passed = passed;
    s.state = state;
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
  /** Every scorer not yet decided is stopped by the gate (a production-side violation). */
  notMeasuredRest(): void {
    for (const s of this.list) {
      if (!this.done.has(s.name)) this.notMeasured(s.name as ScorerName);
    }
  }
}

/** The stable rule codes the H-35 policy rules emit as `<rule>: ...`. */
const RULE_CODES = new Set([
  "unreadable_test",
  "test_lifecycle",
  "isolation_disabled",
  "dependency_not_allowed",
  "unreadable",
  "test_detection_ref",
  "dynamic_object_access",
]);

/** H-35 (design-r2 5): a workspace violation's stable rule code. */
export function violationRule(v: string): string {
  const m = /^([a-z_]+): /.exec(v);
  if (m && RULE_CODES.has(m[1]!)) return m[1]!;
  if (v.startsWith("workspace ")) return "workspace_freeze";
  if (/link refused|link, reparse point/.test(v)) return "link_refused";
  if (/case-ambiguous|case alias/.test(v)) return "case_alias";
  if (/collides with shipped/.test(v)) return "test_collision";
  if (/ changed from |idRanges changed|app\.json missing/.test(v)) {
    return "identity_changed";
  }
  if (/is missing$/.test(v)) return "app_missing";
  return "app_validation";
}

export interface JudgeContext {
  lane: BcLane;
  i: JudgeInput;
  scores: Scores;
  log: VerdictLog;
  deploy: DeployContext;
  /** H-35 policy gate: violations by side and rule (design-r2 5). */
  policy: PolicyViolation[];
  /** H-35: the digest of the judgment's production manifest, once built. */
  manifest: string | null;
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
 * The lane's BC with agent-added test runs made agent-owned: zero results or
 * a missing discovered procedure becomes a failed, not-run procedure
 * (runtime_error), never infra. A throw or a hang (timeout) is noted and
 * filled in the same way; `onThrow` is told which codeunit threw where, so
 * the caller can treat it as ambiguous and rerun it (H-26, runAgentTests).
 */
export function agentTestsBc(
  bc: HarnessBc,
  discovered: ReadonlyMap<number, readonly string[]>,
  notes: string[],
  onThrow?: (container: string, codeunit: number) => void,
): HarnessBc {
  return {
    compileProject: (c, p) => bc.compileProject(c, p),
    harnessCompilerIdentity: (c) => bc.harnessCompilerIdentity(c),
    packageTarget: (f) => bc.packageTarget(f),
    listHarnessApps: (c) => bc.listHarnessApps(c),
    syncHarnessApps: (c, p) => bc.syncHarnessApps(c, p),
    setHttpClientAllowed: (c, id, a) => bc.setHttpClientAllowed(c, id, a),
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
        onThrow?.(c, codeunit);
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

/**
 * mutant_kill's view of agent-authored suites (decision
 * 2026-09-25-agent-suite-infra). A completed run (a result set came back)
 * with a missing or zero-result agent procedure is the agent's failure: the
 * procedure is filled in as not run (runtime_error), never infra. A thrown
 * or timed-out run is ambiguous and stays infra (ContainerError), so the lane
 * reruns it on another container behind a fresh trusted control. Trusted
 * codeunits (the control) pass through unchanged: their missing or zero
 * results stay infra.
 */
export function agentSuiteBc(
  bc: HarnessBc,
  discovered: ReadonlyMap<number, readonly string[]>,
): HarnessBc {
  return {
    compileProject: (c, p) => bc.compileProject(c, p),
    harnessCompilerIdentity: (c) => bc.harnessCompilerIdentity(c),
    packageTarget: (f) => bc.packageTarget(f),
    listHarnessApps: (c) => bc.listHarnessApps(c),
    syncHarnessApps: (c, p) => bc.syncHarnessApps(c, p),
    setHttpClientAllowed: (c, id, a) => bc.setHttpClientAllowed(c, id, a),
    async runHarnessTests(c, codeunit): Promise<TestResult> {
      const procs = discovered.get(codeunit);
      if (!procs) return await bc.runHarnessTests(c, codeunit);
      let r: TestResult;
      try {
        r = await bc.runHarnessTests(c, codeunit);
      } catch (err) {
        throw new ContainerError(
          `agent suite ${codeunit} did not complete on ${c}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          c,
          "test",
        );
      }
      const byName = new Map(r.results.map((x) => [x.name.toLowerCase(), x]));
      // No error text: runTests records a filled-in procedure as not_run, runtime_error.
      const results = procs.map((name) =>
        byName.get(name.toLowerCase()) ?? { name, passed: false, duration: 0 }
      );
      const passed = results.filter((x) => x.passed).length;
      return {
        success: passed === results.length,
        totalTests: results.length,
        passedTests: passed,
        failedTests: results.length - passed,
        duration: r.duration,
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
  hold: string,
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
        ctx: holdContext(ctx, hold, wanted),
      }),
  );
  return { rows: accountHeld(ctx, held) };
}

/**
 * One hold's deployment context: each attempt (an infra retry included) is
 * recorded as it starts deploying, whatever its outcome (Sol r1 #3).
 */
function holdContext(
  ctx: JudgeContext,
  hold: string,
  wanted: WantedApp[],
): DeployContext {
  return {
    ...ctx.deploy,
    onDeploy: (c) => recordDeployment(ctx, hold, c, wanted),
  };
}

/** H-35: the trusted control of an agent rerun: G's deployment and its shipped specs. */
interface Control {
  wanted: WantedApp[];
  specs: TestSpec[];
  cleanupIds: string[];
}

/**
 * agent_tests (H-35; pass_to_pass's agent rows before): the agent's test
 * codeunits on A (H-26), per codeunit. A codeunit that completes on the first
 * run keeps those rows.
 * `rerun` null (agent_tests already fails): a thrown codeunit is the
 * agent's failure (agentTestsBc), and an infra fault of the whole run adds
 * no rows, so it cannot unscore that fail. The same holds when a completed
 * agent codeunit failed. Else a codeunit that throws or times out is
 * ambiguous (decision 2026-09-25-agent-suite-infra item 3): the whole agent
 * suite is rerun once, in order, on another container, right after the
 * trusted control (G with the shipped pass_to_pass specs, which passed on
 * it) passes there, and only the ambiguous codeunits take the rerun's
 * results. One that throws again is the agent's failure, noted with both
 * containers. A failing control, no other container or no control leaves
 * infra rows for the ambiguous codeunits: agent_tests is unscored, never a
 * fail. The rerun is recorded in infra_retries.
 */
async function runAgentTests(
  ctx: JudgeContext,
  prep: Prepared,
  agent: TestSpec[],
  rerun: { control: Control | null } | null,
): Promise<TestRow[]> {
  const discovered = new Map(agent.map((a) => [a.codeunit, a.procedures!]));
  const notes = ctx.log.notes;
  const cleanupIds = [...prep.candidateIds].reverse();
  const ids = {
    taskId: ctx.i.task.task.id,
    variantId: ctx.i.executionId,
    attemptNumber: 1,
  };
  const inOrder = (rs: TestRow[]) =>
    agent.flatMap((a) => rs.filter((r) => r.codeunit === a.codeunit));
  const infraRowsFor = (codeunits: ReadonlySet<number>): TestRow[] =>
    agent.filter((a) => codeunits.has(a.codeunit)).flatMap((a) =>
      a.procedures!.map((p) => ({
        codeunit: a.codeunit,
        procedure: p,
        target: a.target,
        outcome: "not_run" as const,
        failure: "infra" as const,
      }))
    );
  const infraNote = (what: string, err: unknown) => {
    if (err instanceof InfraRetriesExhaustedError) {
      ctx.log.infra_retries.push(...err.retries);
    }
    notes.push(
      `agent_tests: ${what} infra: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  };

  const threw: { container: string; codeunit: number }[] = [];
  let first: Held<DeployTestResult>;
  try {
    first = await ctx.lane.exclusive(ids, (c) =>
      deployAndTest(
        agentTestsBc(
          ctx.lane.bc,
          discovered,
          notes,
          (container, codeunit) => threw.push({ container, codeunit }),
        ),
        c,
        {
          wanted: prep.wanted,
          tests: agent,
          cleanupIds,
          ctx: holdContext(ctx, "A", prep.wanted),
        },
      ));
  } catch (err) {
    if (!infraThrown(err)) throw err;
    infraNote("agent-added tests", err);
    return rerun ? infraRowsFor(new Set(discovered.keys())) : [];
  }
  const rows = accountHeld(ctx, first);
  const ambiguous = new Set(
    threw.filter((t) => t.container === first.container).map((t) => t.codeunit),
  );
  const kept = rows.filter((r) => !ambiguous.has(r.codeunit));
  // A completed agent failure decides agent_tests already (Sol r2b P1): a
  // hang elsewhere is the agent's too, with no rerun that could unscore it.
  if (
    !rerun || ambiguous.size === 0 || kept.some((r) => r.outcome !== "pass")
  ) {
    return rows;
  }
  const control = rerun.control;
  if (!control) {
    notes.push(
      `agent_tests: no trusted control to rerun agent-added codeunits ${
        [...ambiguous].join(", ")
      } against: unscored`,
    );
    return inOrder([...kept, ...infraRowsFor(ambiguous)]);
  }
  // The rerun repeats the whole agent suite in its order (Sol r2b P1: the
  // same execution context as the first run), but only the ambiguous
  // codeunits take its results: completed first-run results stand.
  const again: number[] = [];
  let rerunOn = "";
  const t0 = performance.now();
  const record = (outcome: "succeeded" | "infra_again") =>
    ctx.log.infra_retries.push({
      retryNumber: 1,
      originalContainerName: first.container,
      retryContainerName: rerunOn,
      fingerprint: "h26-agent-test-rerun",
      signatureLabel: `agent-added codeunits ${
        [...ambiguous].join(", ")
      } did not complete`,
      durationMs: Math.round(performance.now() - t0),
      outcome,
      cause: "failure",
    });
  try {
    const second = await ctx.lane.exclusive(
      ids,
      async (c) => {
        rerunOn = c;
        const ctl = await deployAndTest(ctx.lane.bc, c, {
          wanted: control.wanted,
          tests: control.specs,
          cleanupIds: control.cleanupIds,
          ctx: holdContext(ctx, "control", control.wanted),
        });
        const s = ctx.log.spans;
        s.provisioning_ms += ctl.deployed.provisioning_ms;
        s.candidate_publish_ms += ctl.deployed.candidate_publish_ms;
        s.test_ms += ctl.test_ms;
        if (ctl.cleanupError) {
          throw new CleanupFailedError(
            new Error("trusted control"),
            ctl.cleanupError,
            c,
          );
        }
        if (scorerPassed(ctl.rows) !== true) {
          throw new ContainerError(
            `trusted control did not pass on ${c} before the agent rerun${
              ctl.messages.length > 0
                ? `: ${ctl.messages.map((m) => m.message).join("; ")}`
                : ""
            }`,
            c,
            "test",
          );
        }
        notes.push(
          `agent_tests: agent-added codeunits ${
            [...ambiguous].join(", ")
          } rerun on ${c} after a passing trusted control`,
        );
        return await deployAndTest(
          agentTestsBc(ctx.lane.bc, discovered, notes, (_c, cu) => {
            again.push(cu);
          }),
          c,
          {
            wanted: prep.wanted,
            tests: agent,
            cleanupIds,
            ctx: holdContext(ctx, "A", prep.wanted),
          },
        );
      },
      undefined,
      { maxInfraRetries: 0, exclude: [first.container] },
    );
    record("succeeded");
    const rerunRows = accountHeld(ctx, second).filter((r) =>
      ambiguous.has(r.codeunit)
    );
    // Rows of a codeunit that threw again are already not_run, runtime_error.
    for (const cu of new Set(again.filter((cu) => ambiguous.has(cu)))) {
      notes.push(
        `agent_tests: agent-added test codeunit ${cu} did not complete on ${first.container} and on ${second.container} (the trusted control passed on ${second.container}): the agent's failure`,
      );
    }
    return inOrder([...kept, ...rerunRows]);
  } catch (err) {
    if (!infraThrown(err)) throw err;
    // Only a rerun that was dispatched is a retry (none with no eligible container).
    if (rerunOn) record("infra_again");
    infraNote("agent-added test rerun", err);
    return inOrder([...kept, ...infraRowsFor(ambiguous)]);
  }
}

/** A held run's spans, containers, retries and messages go to the verdict log. */
function accountHeld(
  ctx: JudgeContext,
  held: Held<DeployTestResult>,
): TestRow[] {
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
  return held.result.rows;
}

async function buildOracle(
  ctx: JudgeContext,
  prep: Prepared,
  graph: StagedApp[],
): Promise<WantedApp | null> {
  const dir = join(ctx.i.task.dir, "oracle");
  const aj = await readAppJson(join(dir, "app.json"));
  const workspaceIds = new Set(prep.wanted.map((w) => w.id));
  const deps = aj.dependencies.map((d) => d.id.toLowerCase());
  const folderOf = new Map(graph.map((a) => [a.id.toLowerCase(), a.folder]));
  const app: StagedApp = {
    folder: "oracle",
    id: aj.id.toLowerCase(),
    name: aj.name,
    publisher: aj.publisher,
    version: aj.version,
    idRanges: aj.idRanges,
    // Workspace dependencies by folder, like a candidate: their declared
    // symbols join the oracle's restore closure (M1-40b).
    depends: deps.filter((id) => workspaceIds.has(id)).map((id) =>
      folderOf.get(id)!
    ),
    // Checked against the lock by buildApps, so BCH never fills a gap from its cache.
    external: deps.filter((id) => !workspaceIds.has(id)).sort(),
  };
  // Through the lane's admission for that container (round 2 item 5).
  const [b] = await ctx.lane.compileOn(
    prep.container,
    async (c) => {
      const r = await buildApps(ctx.lane.bc, c, {
        srcDir: ctx.i.task.dir,
        apps: [app],
        versions: new Map([["oracle", aj.version]]),
        outDir: join(ctx.i.workDir, "oracle-build"),
        lock: ctx.i.lock,
        prebuilt: new Map(
          prep.wanted.map((w) => [folderOf.get(w.id.toLowerCase())!, w.file]),
        ),
        graph,
        policy: DECLARED_POLICY,
        ...(ctx.i.buildCache
          ? { cache: ctx.i.buildCache, prebuiltKeys: prep.keys }
          : {}),
      });
      // H-04b: inside compileOn, so a crashed oracle build reroutes.
      throwIfCrashed(r, c, "oracle");
      return r;
    },
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
    // S2.4: the deployment record's digest, key and source.
    sha256: await hashFile(dirname(b.file), b.file),
    ...(b.build_key ? { build_key: b.build_key } : {}),
    source: await hashTree(dir, "task"),
    file: b.file,
    role: "prereq",
    depends: deps.filter((id) => workspaceIds.has(id)),
  };
}

/**
 * feature, bugfix, refactor (H-35, design-r2 1 and 5). G = the candidate
 * production + the pristine Test app + the oracle: build, pass_to_pass (the
 * shipped rows) and fail_to_pass. A = the same production + the agent's Test
 * as written, without the shipped test codeunits: agent_tests. G reads no
 * agent Test file, so its violations are production-side and fail every
 * scorer; one only A has is Test-side: G is measured, agent_tests fails.
 */
async function scoreChange(ctx: JudgeContext): Promise<void> {
  const { i, scores, log } = ctx;
  const t = i.task.task;
  const tr = performance.now();
  const workspace = (name: string, o: Partial<ReconstructOptions>) =>
    buildVerdictWorkspace({
      productionAllow: i.task.task.production_allow,
      pristine: i.pristine,
      artifact: i.artifact,
      out: join(i.workDir, name),
      symbolIds: i.symbolIds,
      ...o,
    });
  const gw = await workspace("verdict", { rawTest: true });
  const aw = await workspace("verdict-agent", { dropShippedTests: true });
  log.spans.reconstruct_ms = performance.now() - tr;
  const production = new Set(gw.violations);
  const testSide = aw.violations.filter((v) => !production.has(v));
  log.violations = [...gw.violations, ...testSide];
  // Tests the agent added to shipped codeunits are discovered below as the
  // generated codeunit (addedTestCodeunits); why any were not is noted here.
  log.notes.push(...aw.notes);
  ctx.policy.push(
    ...gw.violations.map((detail) => ({
      side: "production" as const,
      rule: violationRule(detail),
      detail,
    })),
    ...testSide.map((detail) => ({
      side: "test" as const,
      rule: violationRule(detail),
      detail,
    })),
  );
  // A production-side violation: G and A are not measured, the gate fails.
  if (gw.violations.length > 0) return scores.notMeasuredRest();
  // Sol r1 #4: decided now, so infra in G cannot unscore a policy failure.
  if (testSide.length > 0 && scores.has("agent_tests")) {
    scores.notMeasured("agent_tests");
  }

  const pristineApps = await readAppGraph(i.pristine);
  const prepare = (
    w: VerdictWorkspace,
    name: string,
    label: string,
    production?: ProductionManifest,
  ) =>
    prepareApps(ctx.lane, {
      pristine: i.pristine,
      pristineApps,
      candidateDir: w.dir,
      candidateApps: w.apps,
      changed: w.changed,
      versionPlan: "judge",
      policy: CLOUD_POLICY,
      workDir: join(i.workDir, name),
      lock: i.lock,
      label,
      ...(production ? { production } : {}),
      ...(i.buildCache ? { cache: i.buildCache } : {}),
    });
  const prep = await prepare(gw, "apps", "candidate");
  recordBuild(ctx, prep, "candidate");
  if (!prep.buildOk) return scores.failRest();
  await assertPristineTest(ctx, prep, gw.apps);
  scores.set("build", true);
  // H-35 (design-r3 3.2): A publishes exactly G's production packages.
  const manifest = await productionManifest(prep, gw.dir);
  log.notes.push(`production manifest: ${manifest.digest}`);
  ctx.manifest = manifest.digest;

  const p2p: TestSpec[] = scores.has("pass_to_pass")
    ? t.pass_to_pass.map((r) => ({
      codeunit: r.codeunit,
      procedures: r.procedures,
      target: "candidate",
    }))
    : [];
  const wanted = [...prep.wanted];
  const cleanup = [...prep.candidateIds];
  const f2p: TestSpec[] = [];
  if (t.fail_to_pass) {
    const oracle = await buildOracle(ctx, prep, gw.apps);
    if (oracle === null) {
      // H-26: the reason, next to the tests it stops (reports read test_messages).
      const diags = log.diagnostics.filter((d) => d.app === "oracle");
      const codes = buildFailureCodes(diags.map((d) => d.code));
      const first = diags.find((d) => codes.includes(d.code));
      for (
        const codeunit of new Set(t.fail_to_pass.tests.map((x) => x.codeunit))
      ) {
        log.test_messages.push({
          codeunit,
          procedure: "(oracle build)",
          target: "candidate",
          message: `oracle does not compile against the candidate: ${
            codes.join(",") || "(no diagnostics)"
          }${first ? ` ${first.message}` : ""}`.slice(0, 2000),
        });
      }
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
  // G: trusted code only, every trusted suite in one hold.
  let rows: TestRow[] = [];
  if (p2p.length + f2p.length > 0) {
    rows = (await runHeld(
      ctx,
      wanted,
      [...p2p, ...f2p],
      [...cleanup].reverse(),
      "G",
    ))
      .rows;
  }
  // Visible and oracle codeunits live in disjoint bands (80000-84999, 85000-89999).
  const oracleUnits = new Set(f2p.map((s) => s.codeunit));
  if (f2p.length > 0) {
    const r = rows.filter((x) => oracleUnits.has(x.codeunit));
    scores.set("fail_to_pass", scorerPassed(r), r);
  }
  const shipped = rows.filter((x) => !oracleUnits.has(x.codeunit));
  if (scores.has("pass_to_pass")) {
    // Never a pass on zero rows (scorerPassed).
    scores.set("pass_to_pass", scorerPassed(shipped), shipped);
  }
  if (scores.has("agent_tests")) {
    // G's deployment without the oracle, with the shipped specs, is the
    // control of an agent rerun; only when those passed on this candidate.
    const control = p2p.length > 0 && scorerPassed(shipped) === true
      ? {
        wanted: prep.wanted,
        specs: p2p,
        cleanupIds: [...prep.candidateIds].reverse(),
      }
      : null;
    await scoreAgentTests(
      ctx,
      aw,
      testSide,
      control,
      async (w, name, label) => {
        const a = await prepare(w, name, label, manifest);
        if (a.buildOk) {
          assertSameProduction(
            prep.wanted,
            a.wanted,
            new Set(
              prep.built.filter((b) => b.folder !== TEST_APP).map((b) => b.id),
            ),
          );
        }
        return a;
      },
    );
  }
  scores.failRest();
}

/**
 * H-35 (design-r2 4.2): G deployed the pristine Test app. Its recorded source
 * is the pristine tree, its key recomputes from the pristine app and G's
 * production keys, and with a build cache the key's entry is the package G
 * deployed. A mismatch is a harness bug, never a score.
 */
async function assertPristineTest(
  ctx: JudgeContext,
  prep: Prepared,
  graph: StagedApp[],
): Promise<void> {
  const { i } = ctx;
  const app = graph.find((a) => a.folder === TEST_APP);
  if (!app) return;
  const bug = (what: string): never => {
    throw new Error(
      `harness bug: G's Test ${what} is not the pristine Test app's`,
    );
  };
  // Orch Sol r1 #5: by the deployed set, so a Test app built as an
  // unaffected prerequisite (not in prep.built) is checked too.
  const w = prep.wanted.find((x) => x.id === app.id);
  if (!w) return bug("deployment");
  if (w.source !== await hashTree(join(i.pristine, TEST_APP), "task")) {
    bug("source");
  }
  const { key } = await effectiveBuildKey(
    await ctx.lane.bc.harnessCompilerIdentity(prep.container),
    {
      srcDir: i.pristine,
      app,
      version: w.version,
      // Dependencies key on their adopted cache keys, else their files, as
      // buildApps keyed the Test app.
      files: prep.files,
      keys: prep.keys,
      lock: i.lock,
      graph,
      policy: CLOUD_POLICY,
      stageDir: join(i.workDir, "identity-g"),
    },
  );
  if (w.build_key !== key) bug("build key");
  // Only an entry the build adopted is a claim (run 002 Sol r2 #2): a
  // refused, unwritten or unreadable entry is not, the cache being
  // best-effort (H-27 r2).
  if (!i.buildCache || prep.keys.get(TEST_APP) !== key) return;
  const cached = await i.buildCache.get(key).catch(() => null);
  if (cached && await hashFile(dirname(cached), cached) !== w.sha256) {
    bug("cached package");
  }
}

/**
 * H-35 (design-r3 3.2): A publishes G's production packages, the same id,
 * build key and digest each. A harness bug otherwise.
 */
export function assertSameProduction(
  g: readonly WantedApp[],
  a: readonly WantedApp[],
  production: ReadonlySet<string>,
): void {
  for (const id of production) {
    const x = g.find((w) => w.id === id);
    const y = a.find((w) => w.id === id);
    if (!x || !y || x.build_key !== y.build_key || x.sha256 !== y.sha256) {
      throw new Error(`harness bug: A's production package ${id} is not G's`);
    }
  }
}

/** H-35: agent_tests on A (design-r2 3; the H-26 rerun policy unchanged). */
async function scoreAgentTests(
  ctx: JudgeContext,
  aw: VerdictWorkspace,
  testSide: string[],
  control: Control | null,
  prepare: (
    w: VerdictWorkspace,
    name: string,
    label: string,
  ) => Promise<Prepared>,
): Promise<void> {
  const { i, scores, log } = ctx;
  // S2 records this as not_measured behind the policy gate.
  if (testSide.length > 0) return scores.notMeasured("agent_tests");
  const agent: TestSpec[] = [];
  const testPageRows: TestRow[] = [];
  const added = await addedTestCodeunits(
    join(i.pristine, TEST_APP),
    join(aw.dir, TEST_APP),
    new Set(aw.excluded),
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
    agent.push({
      codeunit: a.codeunit,
      procedures: a.procedures,
      target: "candidate",
    });
  }
  if (aw.creditExcluded > 0) {
    log.notes.push(`agent_tests: credit_excluded: ${aw.creditExcluded}`);
  }
  const notRun = (failure: "compile" | "infra") =>
    agent.flatMap((a) =>
      a.procedures!.map((p) => ({
        codeunit: a.codeunit,
        procedure: p,
        target: "candidate",
        outcome: "not_run" as const,
        failure,
      }))
    );
  let prepA: Prepared;
  try {
    prepA = await prepare(aw, "apps-agent", "agent Test");
  } catch (err) {
    // G is measured: infra building A unscores agent_tests only.
    if (!infraThrown(err)) throw err;
    if (err instanceof InfraRetriesExhaustedError) {
      log.infra_retries.push(...err.retries);
    }
    log.notes.push(
      `agent_tests: agent-added tests infra: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    const r = [...notRun("infra"), ...testPageRows];
    // No row at all: unscored, never a pass or a fail on nothing.
    return scores.set("agent_tests", r.length ? scorerPassed(r) : null, r);
  }
  recordBuild(ctx, prepA, "agent");
  // orch Sol r1 #1: A compiles first, also with no agent test to run: an
  // agent Test app that does not build fails agent_tests.
  if (!prepA.buildOk) {
    log.notes.push("agent_tests: the agent Test app does not compile");
    return scores.set("agent_tests", false, [
      ...notRun("compile"),
      ...testPageRows,
    ]);
  }
  if (agent.length + testPageRows.length === 0) {
    if (aw.creditExcluded === 0) log.notes.push("agent_tests: not_submitted");
    return scores.set("agent_tests", true, []);
  }
  if (agent.length === 0) {
    return scores.set("agent_tests", scorerPassed(testPageRows), testPageRows);
  }
  // A TestPage row fails agent_tests already: a hang must not unscore that.
  const rows = await runAgentTests(
    ctx,
    prepA,
    agent,
    testPageRows.length === 0 ? { control } : null,
  );
  const r = [...rows, ...testPageRows];
  scores.set("agent_tests", scorerPassed(r), r);
}

const isTestPath = (rel: string) =>
  rel === TEST_APP || rel.startsWith(`${TEST_APP}/`);
const infraThrown = (err: unknown) =>
  err instanceof InfraRetriesExhaustedError ||
  err instanceof NoEligibleContainersError || isInfraError(err);

export type MutantOutcome = "killed" | "survived" | "infra";

/** Per mutant (M4 gate parity): any infra row is infra; else an assertion failure kills; else it survived. */
export function mutantOutcome(rows: readonly TestRow[]): MutantOutcome {
  if (rows.length === 0 || rows.some((r) => r.failure === "infra")) {
    return "infra";
  }
  if (rows.some((r) => r.outcome === "fail" && r.failure === "assertion")) {
    return "killed";
  }
  return "survived";
}

/**
 * test-authoring: production is the reference (staged + correct/); only the
 * agent's Test\\ changes are kept. pass_to_pass runs on the reference; the
 * submitted suite runs on the reference, on mutant 0 (staged production)
 * and on every named mutant.
 *
 * mutant_kill eligibility (M4-17a, scorer version 3). Agent tests are the
 * test codeunits in new Test files plus the [Test] procedures added to
 * shipped test codeunits, which are extracted into generated codeunits
 * (84990-84999). Shipped test codeunits never run as agent tests, and the
 * reference and mutant builds leave every shipped test codeunit out of the
 * Test app. A test procedure is ineligible (removed from a new file or not
 * extracted, never run, never counted, with a note), as is anything that
 * reaches such a procedure, when it:
 * - has a body equal, after normalizeAlBody, to a shipped [Test] body;
 * - calls a shipped [Test] or names or numbers a shipped test codeunit
 *   (any integer literal equal to its id counts), or uses a global of that
 *   type;
 * - runs a codeunit by a non-literal id: Codeunit.Run whose first argument
 *   is not an integer literal or Codeunit::<name or literal> (so
 *   Codeunit.Run(80000 + 10) or a variable set by Evaluate is out);
 * - uses any of these identifiers (DISPATCH_IDS in verdict-workspace.ts):
 *   AllObj, AllObjWithCaption, "Codeunit Metadata", RecordRef, Variant,
 *   StartSession, CreateTask, EnqueueBackgroundTask, RunCodeunit,
 *   TestRunner, "Test Method Line", "AL Test Suite".
 *
 * Known limit: this over-rejects on purpose. A test that uses a Variant, for
 * example with the LibraryVariableStorage pattern (Enqueue/Dequeue into a
 * Variant for handlers), is ineligible even when it is harmless.
 *
 * If an unremovable agent object is rejected (a table or extension trigger,
 * a codeunit the parser cannot read, any TestRunner codeunit), no agent test
 * runs or counts. A TestPage test is refused, and no eligible agent test
 * means mutant_kill fails.
 */
export async function scoreTestAuthoring(ctx: JudgeContext): Promise<void> {
  const { i, scores, log } = ctx;
  const t = i.task.task;
  if (t.mutants.includes("0")) {
    throw new ValidationError(`${t.id}: mutant name "0" is reserved`, ["0"]);
  }
  const tr = performance.now();
  const reference = join(i.workDir, "reference");
  await safeCopyTree(i.pristine, reference);
  await applyOverlay(join(i.task.dir, "correct"), reference, {
    exclude: isTestPath,
  });
  const pristineApps = await readAppGraph(i.pristine);
  const prepare = (
    dir: string,
    apps: StagedApp[],
    changed: string[],
    name: string,
    label: string,
    production?: ProductionManifest,
  ) =>
    prepareApps(ctx.lane, {
      pristine: i.pristine,
      pristineApps,
      candidateDir: dir,
      candidateApps: apps,
      changed,
      versionPlan: "judge",
      policy: CLOUD_POLICY,
      workDir: join(i.workDir, name),
      lock: i.lock,
      label,
      ...(production ? { production } : {}),
      ...(i.buildCache ? { cache: i.buildCache } : {}),
    });

  // A_ref: the reference production plus the agent's Test as written,
  // without the shipped test codeunits (M4-17a run 002). Every violation is
  // Test-side here (production is the reference): G' stays measured.
  const vw = await buildVerdictWorkspace({
    productionAllow: i.task.task.production_allow,
    pristine: i.pristine,
    artifact: i.artifact,
    out: join(i.workDir, "verdict"),
    productionFrom: reference,
    symbolIds: i.symbolIds,
    dropShippedTests: true,
  });
  log.spans.reconstruct_ms = performance.now() - tr;
  log.violations = vw.violations;
  // Tests the agent added to shipped codeunits are discovered below as the
  // generated codeunit (addedTestCodeunits); why any were not is noted here.
  log.notes.push(...vw.notes);
  // Sol r1 #4: decided before G', so infra there cannot unscore it. S2
  // records it as not_measured behind the policy gate.
  // Production is the reference here: every violation is Test-side.
  ctx.policy.push(
    ...vw.violations.map((detail) => ({
      side: "test" as const,
      rule: violationRule(detail),
      detail,
    })),
  );
  if (vw.violations.length > 0) scores.notMeasured("mutant_kill");

  // H-35 G' first: the reference production plus the pristine Test app, raw
  // (no agent file: a subscriber or install trigger in agent code could act
  // on a shipped test). It decides build, and pass_to_pass by a real run in
  // its own hold, whatever the submission (M1-18 review items 1 and 2).
  const sw = await buildVerdictWorkspace({
    productionAllow: i.task.task.production_allow,
    pristine: i.pristine,
    artifact: i.pristine,
    out: join(i.workDir, "p2p"),
    productionFrom: reference,
    symbolIds: i.symbolIds,
    rawTest: true,
  });
  const sp = await prepare(
    sw.dir,
    sw.apps,
    sw.changed,
    "apps-p2p",
    "pass_to_pass",
  );
  recordBuild(ctx, sp, "pass_to_pass");
  if (!sp.buildOk) {
    throw new ValidationError(
      `${t.id}: the reference with the shipped tests does not build`,
      [t.id],
    );
  }
  // Orch Sol r1 #5: G' deploys the pristine Test app too.
  await assertPristineTest(ctx, sp, sw.apps);
  scores.set("build", true);
  // H-35 (design-r3 3.3): A_ref publishes exactly G' production packages.
  const manifest = await productionManifest(sp, sw.dir);
  log.notes.push(`production manifest: ${manifest.digest}`);
  ctx.manifest = manifest.digest;
  let control: { prep: Prepared; specs: TestSpec[] } | null = null;
  if (scores.has("pass_to_pass")) {
    const p2p: TestSpec[] = t.pass_to_pass.map((r) => ({
      codeunit: r.codeunit,
      procedures: r.procedures,
      target: "reference",
    }));
    try {
      const r = (await runHeld(
        ctx,
        sp.wanted,
        p2p,
        [...sp.candidateIds].reverse(),
        "G'",
      )).rows;
      scores.set("pass_to_pass", scorerPassed(r), r);
      // Known to pass: the trusted control for agent-suite reruns.
      if (scorerPassed(r) === true) control = { prep: sp, specs: p2p };
    } catch (err) {
      if (!infraThrown(err)) throw err;
      log.error = err instanceof Error ? err.message : String(err);
      return scores.nullRest();
    }
  }

  if (vw.violations.length > 0) return scores.failRest();
  const prep = await prepare(
    vw.dir,
    vw.apps,
    vw.changed,
    "apps-reference",
    "reference",
    manifest,
  );
  recordBuild(ctx, prep, "reference");

  const added = await addedTestCodeunits(
    join(i.pristine, TEST_APP),
    join(vw.dir, TEST_APP),
    new Set(vw.excluded),
  );
  const unsupported = added.filter((a) => a.testPage);
  if (unsupported.length > 0) {
    for (const u of unsupported) {
      log.test_messages.push({
        codeunit: u.codeunit,
        procedure: "(TestPage)",
        target: "reference",
        message: "TestPage tests are not supported by the harness test runner",
      });
    }
    scores.set("mutant_kill", false);
    return scores.failRest();
  }
  const agent = added.filter((a) => a.procedures.length > 0);
  for (const a of added.filter((x) => x.procedures.length === 0)) {
    log.notes.push(`codeunit ${a.codeunit} has no [Test] procedure`);
  }
  if (agent.length === 0) {
    log.notes.push("mutant_kill: no agent test codeunit discovered");
    scores.set("mutant_kill", false);
    return scores.failRest();
  }
  const specs = (target: string): TestSpec[] =>
    agent.map((a) => ({
      codeunit: a.codeunit,
      procedures: a.procedures,
      target,
    }));
  const notRunRows = (target: string, failure: "infra" | "compile") =>
    agent.flatMap((a) =>
      a.procedures.map((p) => ({
        codeunit: a.codeunit,
        procedure: p,
        target,
        outcome: "not_run" as const,
        failure,
      }))
    );
  const infraRows = (target: string): TestRow[] => notRunRows(target, "infra");
  if (!prep.buildOk) {
    scores.set("mutant_kill", false, notRunRows("reference", "compile"));
    return scores.failRest();
  }

  // Agent-suite runs (decision 2026-09-25-agent-suite-infra): a completed
  // run with a missing procedure is the agent's (agentSuiteBc). A thrown run
  // is rerun once, on another container (the lane excludes the failed one),
  // only when a trusted control exists: there the shipped pass_to_pass build
  // is deployed and must pass first, then the agent build. Without
  // pass_to_pass there is no control and a thrown run stays infra.
  const discovered = new Map(agent.map((a) => [a.codeunit, a.procedures]));
  const suiteBc = agentSuiteBc(ctx.lane.bc, discovered);
  const agentRun = async (p: Prepared, target: string): Promise<TestRow[]> => {
    const hold = target === "reference"
      ? "A_ref"
      : target === "mutant:0"
      ? "A_0"
      : `A_m:${target.slice("mutant:".length)}`;
    let attempt = 0;
    const held = await ctx.lane.exclusive(
      { taskId: t.id, variantId: i.executionId, attemptNumber: 1 },
      async (c) => {
        if (attempt++ > 0 && control) {
          const ctl = await deployAndTest(ctx.lane.bc, c, {
            wanted: control.prep.wanted,
            tests: control.specs,
            cleanupIds: [...control.prep.candidateIds].reverse(),
            ctx: holdContext(ctx, "control", control.prep.wanted),
          });
          if (ctl.cleanupError) {
            throw new CleanupFailedError(
              new Error("trusted control"),
              ctl.cleanupError,
              c,
            );
          }
          if (scorerPassed(ctl.rows) !== true) {
            throw new ContainerError(
              `trusted control did not pass on ${c} before the agent rerun`,
              c,
              "test",
            );
          }
          log.notes.push(
            `${target}: agent suite rerun on ${c} after a passing trusted control`,
          );
        }
        return await deployAndTest(suiteBc, c, {
          wanted: p.wanted,
          tests: specs(target),
          cleanupIds: [...p.candidateIds].reverse(),
          ctx: holdContext(ctx, hold, p.wanted),
        });
      },
      undefined,
      { maxInfraRetries: control ? 1 : 0 },
    );
    return accountHeld(ctx, held);
  };

  let mkRows: TestRow[];
  try {
    mkRows = await agentRun(prep, "reference");
  } catch (err) {
    if (!infraThrown(err)) throw err;
    log.notes.push(
      `reference: agent suite infra after reroutes: ${
        err instanceof Error ? err.message : err
      }`,
    );
    scores.set("mutant_kill", null, infraRows("reference"));
    return scores.failRest();
  }
  const onRef = scorerPassed(mkRows);
  if (onRef !== true) {
    scores.set("mutant_kill", onRef, mkRows);
    return scores.failRest();
  }

  const outcomes: MutantOutcome[] = [];
  for (const m of ["0", ...t.mutants]) {
    const target = `mutant:${m}`;
    const allRows = (
      failure: TestRow["failure"],
      procedureOverride?: string,
    ): TestRow[] =>
      agent.flatMap((a) =>
        a.procedures.map((p) => ({
          codeunit: a.codeunit,
          procedure: procedureOverride ?? p,
          target,
          outcome: "not_run" as const,
          failure,
        }))
      );
    try {
      let production = i.pristine;
      if (m !== "0") {
        production = join(i.workDir, `mutant-src-${m}`);
        await safeCopyTree(reference, production);
        await applyOverlay(join(i.task.dir, "mutants", m), production, {
          exclude: isTestPath,
        });
      }
      const mv = await buildVerdictWorkspace({
        productionAllow: i.task.task.production_allow,
        pristine: i.pristine,
        artifact: i.artifact,
        out: join(i.workDir, `mutant-${m}`),
        productionFrom: production,
        symbolIds: i.symbolIds,
        dropShippedTests: true,
      });
      const mp = await prepare(
        mv.dir,
        mv.apps,
        mv.changed,
        `apps-mutant-${m}`,
        target,
      );
      recordBuild(ctx, mp, target);
      if (!mp.buildOk) {
        mkRows.push(...allRows("compile"));
        outcomes.push("survived"); // not a kill
        continue;
      }
      const rows = await agentRun(mp, target);
      mkRows.push(...rows);
      outcomes.push(mutantOutcome(rows));
    } catch (err) {
      if (!infraThrown(err)) throw err;
      log.notes.push(
        `${target}: infra after reroutes: ${
          err instanceof Error ? err.message : err
        }`,
      );
      mkRows.push(...allRows("infra"));
      outcomes.push("infra");
    }
  }
  const passed = outcomes.includes("survived")
    ? false
    : outcomes.includes("infra")
    ? null
    : true;
  scores.set("mutant_kill", passed, mkRows);
  scores.failRest();
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
    deployments: [],
    resets: [],
    verifies: [],
    fs_checks: [],
    bc_egress: i.deploy.bcEgress ?? null,
  };
  const scores = new Scores(effectiveScorers(i.task.task));
  const deploy: DeployContext = {
    ledgerRoot: i.deploy.ledgerRoot,
    // Both trusted staging outputs: the oracle id must be removable at cleanup.
    trustedRoots: i.task.task.fail_to_pass
      ? [i.pristine, join(i.task.dir, "oracle")]
      : [i.pristine],
    // H-35 S3: every judge deployment is preceded by a reset.
    reset: i.deploy.reset,
    onReset: (r) => log.resets!.push(r),
    onVerify: (v) => log.verifies!.push(v),
    onFsCheck: (f) => log.fs_checks!.push(f),
  };
  const ctx: JudgeContext = {
    lane,
    i,
    scores,
    log,
    deploy,
    policy: [],
    manifest: null,
  };
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
  // H-35 v2 (design-r2 5, design-r3 6.2): the gate, then the scorers.
  const policy = { passed: ctx.policy.length === 0, violations: ctx.policy };
  const verdict = verdictOf(list, policy);
  // H-35 S3.3 (design-r4 5.2): a judgment is of one environment. Routing
  // makes a mix impossible; until it does this is the fail-closed backstop.
  const envs = new Set((log.deployments ?? []).map((d) => d.env_fp ?? null));
  if (envs.size > 1) {
    throw new Error(
      `harness bug: deployments of one judgment span environments (${
        [...envs].map((e) => e?.slice(0, 12) ?? "none").join(", ")
      })`,
    );
  }
  const judgment = JudgmentRecordSchema.parse({
    v: 2,
    policy,
    provenance: {
      harness_commit: i.harnessCommit ?? null,
      production_manifest: ctx.manifest,
      // Null with no deployment or no lineage; never inferred.
      env_fp: [...envs][0] ?? null,
    },
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

/**
 * C-03 run 002: the infra signature a judgment's verdict log records, else
 * null; both need 0 test rows in every scorer. `judge_error`: judge caught
 * an infra error (log.error set).
 * `build_failed_no_diagnostics_no_tests`: a candidate "build failed:" note
 * (recordBuild's), no diagnostics at all and no test result in any scorer
 * (a build starved of host memory). The log must be this judgment's; a
 * missing or malformed log has no signature (fail closed).
 */
export function infraSignature(
  j: JudgmentRecord,
  log: unknown,
): InfraSignature | null {
  if (typeof log !== "object" || log === null) return null;
  const l = log as Partial<Record<keyof VerdictLog, unknown>>;
  if (l.judgment_id !== j.id || l.execution_id !== j.execution_id) return null;
  // Run 003: a real test row means the judge got far enough to score (an
  // error after oracle rows can hide a genuine FAIL): never a signature.
  if (!j.scorers.every((s) => s.tests.length === 0)) return null;
  if (typeof l.error === "string" && l.error.trim() !== "") {
    return "judge_error";
  }
  if (
    Array.isArray(l.notes) &&
    l.notes.some((n) =>
      typeof n === "string" && n.startsWith("build failed: ")
    ) &&
    // H-04: a dependent's cascade entry is no diagnostic of its own.
    Array.isArray(l.diagnostics) &&
    l.diagnostics.every((d) =>
      typeof d === "object" && d !== null &&
      typeof d.code === "string" && typeof d.message === "string" &&
      isCascadeDiagnostic(d)
    )
  ) {
    return "build_failed_no_diagnostics_no_tests";
  }
  return null;
}
