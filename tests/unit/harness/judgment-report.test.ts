import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import type { JudgmentRecord } from "../../../src/harness/records.ts";
import {
  appendCompletion,
  failedFsChecks,
  freezePairing,
  loadPairing,
  pairFlags,
  type Pairing,
  pairingReport,
  readVerdictLog,
  reconcilePairing,
  renderPairing,
  scorerCount,
  summarizeScoring,
  transitionMatrix,
} from "../../../src/harness/judgment-report.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

type Scorer = JudgmentRecord["scorers"][number];
type Row = Scorer["tests"][number];

const row = (
  codeunit: number,
  procedure: string,
  outcome: Row["outcome"] = "pass",
): Row => ({
  codeunit,
  procedure,
  target: "candidate",
  outcome,
  failure: outcome === "pass" ? null : "assertion",
});

let n = 0;
/** A v2 judgment: `scorers` as given, the verdict derived as the record does. */
function v2(
  scorers: Scorer[],
  policy: JudgmentRecord["policy"] = { passed: true, violations: [] },
): JudgmentRecord {
  const verdict = !policy!.passed || scorers.some((s) => s.passed === false)
    ? "fail"
    : scorers.some((s) => s.passed === null)
    ? "unscored"
    : "pass";
  return {
    v: 2,
    id: `00000000-0000-4000-b000-${String(++n).padStart(12, "0")}`,
    execution_id: "00000000-0000-4000-a000-000000000001",
    workspace_hash: "a".repeat(64),
    task_id: "HX-001",
    task_oracle_hash: "b".repeat(64),
    scorer_versions: { build: "4", pass_to_pass: "6", fail_to_pass: "4" },
    scorer_fingerprint: "c".repeat(64),
    scorers,
    verdict,
    verdict_container: "C1",
    started_at: "2026-10-19T10:00:00.000Z",
    ended_at: "2026-10-19T10:01:00.000Z",
    policy,
    provenance: {
      harness_commit: null,
      production_manifest: null,
      env_fp: null,
    },
  };
}

/** A v1 judgment (legacy-6 suite): no state, policy or provenance. */
function v1(scorers: Omit<Scorer, "state">[]): JudgmentRecord {
  const verdict = scorers.some((s) => s.passed === false)
    ? "fail"
    : scorers.some((s) => s.passed === null)
    ? "unscored"
    : "pass";
  return {
    v: 1,
    id: `00000000-0000-4000-b000-${String(++n).padStart(12, "0")}`,
    execution_id: "00000000-0000-4000-a000-000000000001",
    workspace_hash: "a".repeat(64),
    task_id: "HX-001",
    task_oracle_hash: "b".repeat(64),
    scorer_versions: { build: "3", pass_to_pass: "5", fail_to_pass: "3" },
    scorer_fingerprint: "d".repeat(64),
    scorers,
    verdict,
    verdict_container: "C1",
    started_at: "2026-10-01T10:00:00.000Z",
    ended_at: "2026-10-01T10:01:00.000Z",
  };
}

const m = (name: string, passed: boolean, tests: Row[] = []): Scorer => ({
  name,
  passed,
  state: "measured",
  tests,
});
const nm = (name: string): Scorer => ({
  name,
  passed: null,
  state: "not_measured",
  tests: [],
});
const un = (name: string): Scorer => ({
  name,
  passed: null,
  state: "unscored",
  tests: [],
});
const P2P = [row(80010, "ShippedPasses")];
const F2P = [row(85000, "FixWorks")];
const AGENT = [row(81000, "AgentTest")];

Deno.test("H-35 S2.5 scorerCount: v2 by state; a v1 failure with no rows after another failure is a synthetic, unavailable, never an observed fail", () => {
  const j = v2([m("build", true), nm("agent_tests"), un("pass_to_pass")]);
  assertEquals(
    j.scorers.map((s) => scorerCount(j, s)),
    ["pass", "not_measured", "unscored"],
  );
  const old = v1([
    { name: "build", passed: false, tests: [] },
    { name: "pass_to_pass", passed: false, tests: [] },
    { name: "fail_to_pass", passed: false, tests: [row(85000, "F", "fail")] },
    { name: "mutant_kill", passed: null, tests: [] },
  ]);
  assertEquals(
    old.scorers.map((s) => scorerCount(old, s)),
    ["fail", "unavailable", "fail", "unscored"],
  );
});

Deno.test("H-35 S2.5 summarizeScoring: four populations, per-scorer states, policy by side and rule, v1 fields unavailable, test-authoring apart", () => {
  const prodViolation = {
    passed: false,
    violations: [{
      side: "production" as const,
      rule: "dynamic_object_access",
      detail: "x",
    }],
  };
  const testViolation = {
    passed: false,
    violations: [{
      side: "test" as const,
      rule: "test_lifecycle",
      detail: "y",
    }],
  };
  const cells = [
    // change task, G pass, A pass: composite pass.
    {
      arm: "a",
      task: "T1",
      status: "scored",
      judgment: v2([
        m("build", true),
        m("pass_to_pass", true, P2P),
        m("fail_to_pass", true, F2P),
        m("agent_tests", true, AGENT),
      ]),
    },
    // change task, Test-side violation: G measured and passing, A not measured.
    {
      arm: "a",
      task: "T2",
      status: "scored",
      judgment: v2([
        m("build", true),
        m("pass_to_pass", true, P2P),
        m("fail_to_pass", true, F2P),
        nm("agent_tests"),
      ], testViolation),
    },
    // change task, production-side violation: nothing measured.
    {
      arm: "a",
      task: "T3",
      status: "scored",
      judgment: v2([
        nm("build"),
        nm("pass_to_pass"),
        nm("fail_to_pass"),
        nm("agent_tests"),
      ], prodViolation),
    },
    // change task, infra: unscored.
    {
      arm: "a",
      task: "T4",
      status: "unscored",
      judgment: v2([
        m("build", true),
        un("pass_to_pass"),
        un("fail_to_pass"),
        un("agent_tests"),
      ]),
    },
    // test-authoring: G' passes, mutant_kill fails.
    {
      arm: "a",
      task: "T5",
      status: "scored",
      judgment: v2([
        m("build", true),
        m("pass_to_pass", true, P2P),
        m("mutant_kill", false, [row(81000, "K", "pass")]),
      ]),
    },
    // legacy v1: state, policy and G measurement unavailable.
    {
      arm: "a",
      task: "T6",
      status: "scored",
      judgment: v1([{ name: "build", passed: true, tests: [] }]),
    },
    // planned, never judged.
    { arm: "a", task: "T7", status: "unrun", judgment: null },
  ];
  const kind = (t: string) => t === "T5" ? "test-authoring" : "bugfix";
  const [s] = summarizeScoring(
    cells,
    kind,
    (id) =>
      id === cells[0]!.judgment!.id ? ["agent_tests: credit_excluded: 2"] : [],
  );
  assert(s);
  assertEquals(s.arm, "a");
  assertEquals([s.total, s.judged, s.legacy], [7, 6, 1]);
  assertEquals(s.scorers["build"], {
    pass: 5, // T6's v1 build pass is an observed pass
    fail: 0,
    not_measured: 1,
    unscored: 0,
    unavailable: 0,
  });
  assertEquals(s.scorers["agent_tests"], {
    pass: 1,
    fail: 0,
    not_measured: 2,
    unscored: 1,
    unavailable: 0,
  });
  assertEquals(s.scorers["mutant_kill"]!.fail, 1);
  // Change tasks only; T6 is v1 (unavailable), T7 unjudged.
  assertEquals(s.g, {
    measured: 2,
    passed: 2,
    not_measured: 2,
    unavailable: 1,
  });
  assertEquals(s.reference, {
    measured: 1,
    passed: 1,
    not_measured: 0,
    unavailable: 0,
  });
  assertEquals(s.policy, {
    compliant: 3,
    failed: 2,
    failed_from_log: 0,
    unavailable: 1,
    by_rule: {
      "production/dynamic_object_access": 1,
      "test/test_lifecycle": 1,
    },
  });
  // T1 passes; T6 (v1) passes as a verdict too: composite is verdict-based.
  assertEquals(s.composite, { passed: 2, total: 7 });
  assertEquals(s.infra, 1);
  assertEquals(s.agent_tests, {
    submitted: 1,
    not_submitted: 0,
    credit_excluded: 1,
  });
});

Deno.test("H-35 S2.5 pairFlags: unchanged with an A change; newly measured; attribution only; trusted rows; infra", () => {
  const g = (tests = P2P) => [
    m("build", true),
    m("pass_to_pass", true, tests),
    m("fail_to_pass", true, F2P),
  ];
  // Same verdict and G rows, A rows differ: unchanged and an A change.
  assertEquals(
    pairFlags(
      v2([...g(), m("agent_tests", true, AGENT)]),
      v2([...g(), m("agent_tests", true, [...AGENT, row(81000, "More")])]),
    ),
    ["unchanged", "agent_test_outcome_change"],
  );
  // The old build failed (agent Test code), now G is measured and the
  // failure moved to agent_tests.
  const oldFail = v2([
    m("build", false),
    nm("pass_to_pass"),
    nm("fail_to_pass"),
    nm("agent_tests"),
  ]);
  const newFail = v2([...g(), m("agent_tests", false, AGENT)]);
  assertEquals(pairFlags(oldFail, newFail), [
    "newly_measured",
    "attribution_only",
    "agent_test_outcome_change",
  ]);
  // G rows measured in both and different.
  assertEquals(
    pairFlags(
      v2(g()),
      v2(
        g([row(80010, "ShippedPasses", "fail")]).map((s) =>
          s.name === "pass_to_pass" ? { ...s, passed: false } : s
        ),
      ),
    ),
    ["trusted_row_change"], // the verdict changed: not attribution only
  );
  assertEquals(
    pairFlags(v2([m("build", true), un("pass_to_pass")]), v2(g())),
    ["newly_measured", "infra"],
  );
});

Deno.test("H-35 S2.5 pairFlags: policy only when both sides are known; unknown to known is attribution recovered; helper as written", () => {
  const ok = [
    m("build", true),
    m("pass_to_pass", true, P2P),
    m("fail_to_pass", true, F2P),
  ];
  const failed = {
    passed: false,
    violations: [{
      side: "test" as const,
      rule: "test_lifecycle",
      detail: "y",
    }],
  };
  assert(pairFlags(v2(ok), v2(ok, failed)).includes("policy"));
  const legacy = v1([
    { name: "build", passed: true, tests: [] },
    // The shipped row that now passes (orch Sol r1 #3: the same row).
    {
      name: "pass_to_pass",
      passed: false,
      tests: [row(80010, "ShippedPasses", "fail")],
    },
    { name: "fail_to_pass", passed: true, tests: F2P },
  ]);
  const flags = pairFlags(legacy, v2(ok, failed));
  assert(flags.includes("policy_attribution_recovered"));
  assert(!flags.includes("policy"));
  // The old p2p suite predates the helper as written (6) and its failing
  // shipped row passes now.
  assert(flags.includes("helper_as_written"));
  assert(!pairFlags(legacy, legacy).includes("helper_as_written"));
});

Deno.test("H-35 S2.5 transitionMatrix: every pair in exactly one cell, legacy_unknown its own row", () => {
  const pass = v2([m("build", true)]);
  const fail = v2([m("build", false)]);
  const uns = v2([un("build")]);
  const mx = transitionMatrix([
    { old: pass, new: pass },
    { old: fail, new: pass },
    { old: uns, new: fail },
    { old: pass, new: uns, oldUnknown: true },
  ]);
  assertEquals(mx.pass.pass, 1);
  assertEquals(mx.fail.pass, 1);
  assertEquals(mx.unscored.fail, 1);
  assertEquals(mx.legacy_unknown.unscored, 1);
  const total = Object.values(mx).flatMap((r) => Object.values(r))
    .reduce((a, b) => a + b, 0);
  assertEquals(total, 4);
});

Deno.test("H-35 S2.5 pairing: frozen once by digest, completions append, a changed file is refused, cells completed, pending or missing", async () => {
  const root = await Deno.realPath(await testTempDir());
  const ids = ["e1", "e2", "e3"];
  // Each cell's old judgment is of its own execution (Sol r1 #1).
  const olds = new Map(
    ids.map((id) => [id, { ...v2([m("build", true)]), execution_id: id }]),
  );
  const cell = (id: string) => ({
    execution_id: id,
    cell: `a ${id} 1`,
    workspace_hash: "a".repeat(64),
    old_judgment_id: olds.get(id)!.id,
    scorer_fingerprint: olds.get(id)!.scorer_fingerprint,
  });
  const p: Pairing = {
    cohort: { campaign: "c1", started_at: "2026-10-19T10:00:00.000Z" },
    cells: ids.map(cell),
  };
  const digest = await freezePairing(root, p);
  assertEquals(await freezePairing(root, p), digest, "idempotent");
  const fresh = { ...v2([m("build", false)]), execution_id: "e1" };
  await appendCompletion(root, digest, {
    execution_id: "e1",
    new_judgment_id: fresh.id,
    at: "2026-10-19T11:00:00.000Z",
  });
  await appendCompletion(root, digest, {
    execution_id: "e2",
    new_judgment_id: "00000000-0000-4000-b000-ffffffffffff",
    at: "2026-10-19T11:00:00.000Z",
  });
  const loaded = await loadPairing(root, digest);
  const byId = new Map([...olds.values(), fresh].map((j) => [j.id, j]));
  const r = reconcilePairing(
    loaded.pairing,
    loaded.completions,
    (id) => byId.get(id),
  );
  assertEquals(r.completed.map((c) => c.execution_id), ["e1"]);
  assertEquals(r.missing, ["a e2 1"]);
  assertEquals(r.pending, ["a e3 1"]);
  // A rewritten frozen file is refused at load.
  const file = join(root, "pairings", `${digest}.json`);
  const text = await Deno.readTextFile(file);
  await Deno.writeTextFile(file, text.replace("c1", "c2"));
  await assertRejects(
    () => loadPairing(root, digest),
    ValidationError,
    "changed since it was frozen",
  );
  // A completion for a cell the frozen cohort lacks is refused.
  await Deno.writeTextFile(file, text);
  await assertRejects(
    () =>
      appendCompletion(root, digest, {
        execution_id: "e9",
        new_judgment_id: fresh.id,
        at: "2026-10-19T11:00:00.000Z",
      }),
    ValidationError,
    "not in pairing",
  );
});

Deno.test("H-35 S2.5 pairingReport: matrix over completed pairs, flag totals, pending and missing named, rendered", () => {
  // Every judgment is of its cell's execution (Sol r1 #1).
  const of = (j: JudgmentRecord, e: string) => ({ ...j, execution_id: e });
  const olds = [
    of(v2([m("build", true)]), "1"),
    of(v1([{ name: "build", passed: true, tests: [] }]), "2"),
    of(v2([m("build", true)]), "3"),
    of(v2([m("build", true)]), "4"),
  ];
  const news = [
    of(v2([m("build", false)]), "1"),
    of(v2([m("build", true)]), "2"),
  ];
  const cell = (old: JudgmentRecord) => ({
    execution_id: old.execution_id,
    cell: `a T ${old.execution_id}`,
    workspace_hash: "a".repeat(64),
    old_judgment_id: old.id,
    scorer_fingerprint: old.scorer_fingerprint,
  });
  const p: Pairing = {
    cohort: { campaign: "c1", started_at: "2026-10-19T10:00:00.000Z" },
    cells: olds.map(cell),
  };
  const done = (id: string, judgmentId: string) => ({
    execution_id: id,
    new_judgment_id: judgmentId,
    at: "2026-10-19T11:00:00.000Z",
  });
  const byId = new Map([...olds, ...news].map((j) => [j.id, j]));
  const r = pairingReport(
    "d".repeat(64),
    p,
    [done("1", news[0]!.id), done("2", news[1]!.id), done("3", "gone")],
    (id) => byId.get(id),
    (j) => j.v === 1,
  );
  assertEquals(r.pairs, 2);
  assertEquals(r.matrix.pass.fail, 1);
  assertEquals(r.matrix.legacy_unknown.pass, 1);
  assertEquals(r.missing, ["a T 3"]);
  assertEquals(r.pending, ["a T 4"]);
  assertEquals(r.flags.policy_attribution_recovered, 1);
  assertEquals(r.flags.unchanged, 1); // pair 2: pass, no G rows either side
  const text = renderPairing(r);
  assert(text.includes("2 completed, 1 pending, 1 missing"));
  assert(text.includes("missing: a T 3"));
  assert(text.includes("legacy_unknown -> pass 1"));
});

Deno.test("H-35 run 002 Sol r1 #1: a completion naming another execution's judgment, another workspace, or an old judgment off its frozen fingerprint is mismatched (named), never a completed pair", () => {
  const of = (j: JudgmentRecord, e: string) => ({ ...j, execution_id: e });
  const o1 = of(v2([m("build", false)]), "E1");
  const o2 = of(v2([m("build", false)]), "E2");
  const o3 = of(v2([m("build", false)]), "E3");
  const n2 = of(v2([m("build", true)]), "E2");
  const n3 = {
    ...of(v2([m("build", true)]), "E3"),
    workspace_hash: "f".repeat(64),
  };
  const cell = (old: JudgmentRecord, fp = old.scorer_fingerprint) => ({
    execution_id: old.execution_id,
    cell: `a T ${old.execution_id}`,
    workspace_hash: "a".repeat(64),
    old_judgment_id: old.id,
    scorer_fingerprint: fp,
  });
  const o4 = of(v2([m("build", false)]), "E4");
  const n4 = of(v2([m("build", true)]), "E4");
  const p: Pairing = {
    cohort: { campaign: "c1", started_at: "2026-10-19T10:00:00.000Z" },
    cells: [cell(o1), cell(o2), cell(o3), cell(o4, "0".repeat(64))],
  };
  const byId = new Map([o1, o2, o3, o4, n2, n3, n4].map((j) => [j.id, j]));
  const at = "2026-10-19T11:00:00.000Z";
  const r = reconcilePairing(p, [
    // E1 completed with E2's passing judgment.
    { execution_id: "E1", new_judgment_id: n2.id, at },
    { execution_id: "E2", new_judgment_id: n2.id, at },
    { execution_id: "E3", new_judgment_id: n3.id, at },
    { execution_id: "E4", new_judgment_id: n4.id, at },
  ], (id) => byId.get(id));
  assertEquals(r.completed.map((c) => c.execution_id), ["E2"]);
  assertEquals(r.mismatched, ["a T E1", "a T E3", "a T E4"]);
});

Deno.test("H-35 run 002 Sol r1 #5: a v1 judgment whose verdict log lists violations is policy failed (from log), never unavailable; in pairs its policy is known", () => {
  const legacy = v1([{ name: "build", passed: false, tests: [] }]);
  const plain = v1([{ name: "build", passed: true, tests: [] }]);
  const logged = new Map([[legacy.id, ["test_lifecycle: Agent.Test.al"]]]);
  const [s] = summarizeScoring(
    [
      { arm: "a", task: "T1", status: "scored", judgment: legacy },
      { arm: "a", task: "T2", status: "scored", judgment: plain },
    ],
    () => "bugfix",
    () => [],
    (id) => logged.get(id),
  );
  assertEquals(s!.policy, {
    compliant: 0,
    failed: 0,
    failed_from_log: 1,
    unavailable: 1,
    by_rule: { "legacy/test_lifecycle": 1 },
  });
  const gateFailed = v2([m("build", true)], {
    passed: false,
    violations: [{ side: "test", rule: "test_lifecycle", detail: "x" }],
  });
  const gatePassed = v2([m("build", true)]);
  const failedOld = { violations: ["test_lifecycle: Agent.Test.al"] };
  // Both sides failed the gate: no policy change, and nothing "recovered".
  const same = pairFlags(legacy, gateFailed, failedOld);
  assert(!same.includes("policy"));
  assert(!same.includes("policy_attribution_recovered"));
  // The log-proven failure now passes the gate: a proven policy change.
  assert(pairFlags(legacy, gatePassed, failedOld).includes("policy"));
  // No log evidence: unknown -> known.
  assert(
    pairFlags(plain, gatePassed).includes("policy_attribution_recovered"),
  );
});

// ---- H-35 run 002 orchestrator Sol r1 ----

Deno.test("H-35 orch Sol r1 #2: a conflicting completion is refused at append, a repeat is a no-op, and a conflict already on disk is named at report time", async () => {
  const root = await Deno.realPath(await testTempDir());
  const old = { ...v2([m("build", true)]), execution_id: "E1" };
  const j1 = { ...v2([m("build", true)]), execution_id: "E1" };
  const j2 = { ...v2([m("build", false)]), execution_id: "E1" };
  const p: Pairing = {
    cohort: { campaign: "c1", started_at: "2026-10-19T10:00:00.000Z" },
    cells: [{
      execution_id: "E1",
      cell: "a T E1",
      workspace_hash: "a".repeat(64),
      old_judgment_id: old.id,
      scorer_fingerprint: old.scorer_fingerprint,
    }],
  };
  const digest = await freezePairing(root, p);
  const at = "2026-10-19T11:00:00.000Z";
  await appendCompletion(root, digest, {
    execution_id: "E1",
    new_judgment_id: j1.id,
    at,
  });
  await appendCompletion(root, digest, {
    execution_id: "E1",
    new_judgment_id: j1.id,
    at,
  });
  await assertRejects(
    () =>
      appendCompletion(root, digest, {
        execution_id: "E1",
        new_judgment_id: j2.id,
        at,
      }),
    ValidationError,
    "conflicting completion",
  );
  const loaded = await loadPairing(root, digest);
  assertEquals(loaded.completions.length, 1);
  // A conflict written by other means is named, never resolved silently.
  const byId = new Map([old, j1, j2].map((j) => [j.id, j]));
  const r = reconcilePairing(p, [
    { execution_id: "E1", new_judgment_id: j1.id, at },
    { execution_id: "E1", new_judgment_id: j2.id, at },
  ], (id) => byId.get(id));
  assertEquals(r.completed, []);
  assertEquals(r.conflicting, ["a T E1"]);
});

Deno.test("H-35 orch Sol r1 #3: v1 pass_to_pass rows are split by the trusted descriptor: an agent row that moved to agent_tests is no trusted or agent change; helper_as_written needs a shipped row that now passes", () => {
  const trusted = {
    pass_to_pass: [{ codeunit: 80010, procedures: ["ShippedPasses"] }],
  };
  const shipped = row(80010, "ShippedPasses");
  const agent = row(81000, "AgentTest");
  const old = v1([
    { name: "build", passed: true, tests: [] },
    { name: "pass_to_pass", passed: true, tests: [shipped, agent] },
    { name: "fail_to_pass", passed: true, tests: F2P },
  ]);
  const neu = v2([
    m("build", true),
    m("pass_to_pass", true, [shipped]),
    m("fail_to_pass", true, F2P),
    m("agent_tests", true, [agent]),
  ]);
  const flags = pairFlags(old, neu, undefined, trusted);
  assert(flags.includes("unchanged"), flags.join());
  assert(!flags.includes("trusted_row_change"), flags.join());
  assert(!flags.includes("helper_as_written"), flags.join());
  assert(!flags.includes("agent_test_outcome_change"), flags.join());
  // The H-32 class: the shipped row failed under the merged helper and
  // passes now.
  const broken = v1([
    { name: "build", passed: true, tests: [] },
    {
      name: "pass_to_pass",
      passed: false,
      tests: [row(80010, "ShippedPasses", "fail"), agent],
    },
    { name: "fail_to_pass", passed: true, tests: F2P },
  ]);
  assert(
    pairFlags(broken, neu, undefined, trusted).includes("helper_as_written"),
  );
});

Deno.test("H-35 orch Sol r1 #7: a v1 build failure that its log shows as a policy rejection (violations, no compile diagnostics) is unavailable, never an observed fail; with diagnostics it is a fail", () => {
  const rejected = v1([{ name: "build", passed: false, tests: [] }]);
  const compiled = v1([{ name: "build", passed: false, tests: [] }]);
  const violations = new Map([[rejected.id, ["test_lifecycle: x"]], [
    compiled.id,
    ["test_lifecycle: x"],
  ]]);
  const diagnostics = new Map([[compiled.id, [{
    app: "Rental",
    code: "AL0118",
    message: "x",
  }]]]);
  assertEquals(
    scorerCount(rejected, rejected.scorers[0]!, {
      violations: violations.get(rejected.id)!,
      diagnostics: [],
    }),
    "unavailable",
  );
  const [s] = summarizeScoring(
    [
      { arm: "a", task: "T1", status: "scored", judgment: rejected },
      { arm: "a", task: "T2", status: "scored", judgment: compiled },
    ],
    () => "bugfix",
    () => [],
    (id) => violations.get(id),
    (id) => diagnostics.get(id) ?? [],
  );
  assertEquals(s!.scorers["build"]!.unavailable, 1);
  assertEquals(s!.scorers["build"]!.fail, 1);
  // In a pair, the rejected build is not measured before: newly measured now.
  const now = v2([m("build", true)]);
  assert(
    pairFlags(rejected, now, {
      violations: violations.get(rejected.id)!,
      diagnostics: [],
    }).includes("newly_measured"),
  );
});

Deno.test("H-35 orch Sol r1 #4: task-applicable denominators are over planned cells, judged or not; a task whose applicability is unknown is counted apart", () => {
  const applicable = new Map([
    ["T1", ["build", "pass_to_pass", "fail_to_pass", "agent_tests"]],
    ["T5", ["build", "pass_to_pass", "mutant_kill"]],
  ]);
  const [s] = summarizeScoring(
    [
      // An unjudged change-task cell: agent_tests applies although unjudged.
      { arm: "a", task: "T1", status: "unrun", judgment: null },
      {
        arm: "a",
        task: "T5",
        status: "scored",
        judgment: v2([
          m("build", true),
          m("pass_to_pass", true, P2P),
          m("mutant_kill", false, [row(81000, "K", "pass")]),
        ]),
      },
      { arm: "a", task: "T9", status: "unrun", judgment: null },
    ],
    (t) => t === "T5" ? "test-authoring" : "bugfix",
    () => [],
    () => [],
    () => [],
    (t) => applicable.get(t),
  );
  assertEquals(s!.total, 3);
  assertEquals(s!.applicable, {
    build: 2,
    pass_to_pass: 2,
    fail_to_pass: 1,
    agent_tests: 1,
    mutant_kill: 1,
  });
  assertEquals(s!.applicability_unknown, 1);
});

Deno.test("H-45 (a): pairingReport discloses a failed L4 check on either side of a completed pair; a log of another judgment or none discloses nothing", () => {
  const of = (j: JudgmentRecord, e: string) => ({ ...j, execution_id: e });
  const o1 = of(v2([m("build", false)]), "E1");
  const n1 = of(v2([m("build", false)]), "E1");
  const o2 = of(v2([m("build", true)]), "E2");
  const n2 = of(v2([m("build", true)]), "E2");
  const o3 = of(v2([m("build", true)]), "E3");
  const n3 = of(v2([m("build", true)]), "E3");
  const cell = (old: JudgmentRecord) => ({
    execution_id: old.execution_id,
    cell: `a T ${old.execution_id}`,
    workspace_hash: "a".repeat(64),
    old_judgment_id: old.id,
    scorer_fingerprint: old.scorer_fingerprint,
  });
  const p: Pairing = {
    cohort: { campaign: "c1", started_at: "2026-10-19T10:00:00.000Z" },
    cells: [cell(o1), cell(o2), cell(o3)],
  };
  const at = "2026-10-19T11:00:00.000Z";
  const completions = [
    { execution_id: "E1", new_judgment_id: n1.id, at },
    { execution_id: "E2", new_judgment_id: n2.id, at },
    { execution_id: "E3", new_judgment_id: n3.id, at },
  ];
  const byId = new Map([o1, n1, o2, n2, o3, n3].map((j) => [j.id, j]));
  const failed = {
    container: "Cronus284",
    ok: false,
    diff: [],
    errors: ["before: fs-capture expired|676|1056"],
  };
  const clean = { container: "Cronus282", ok: true, diff: [], errors: [] };
  const log = (j: JudgmentRecord, fs_checks: unknown[], id = j.id) => ({
    judgment_id: id,
    execution_id: j.execution_id,
    fs_checks,
  });
  const logs = new Map<string, unknown>([
    [o1.id, log(o1, [failed])],
    [n1.id, log(n1, [clean])],
    // Recovered pass on the new side: a failed check, then a clean one.
    [n2.id, log(n2, [failed, clean])],
    // Names another judgment: not o3's evidence.
    [o3.id, log(o3, [failed], n3.id)],
  ]);
  const r = pairingReport(
    "d".repeat(64),
    p,
    completions,
    (id) => byId.get(id),
    () => false,
    undefined,
    undefined,
    (j) => logs.get(j.id),
  );
  const checks = [{
    container: "Cronus284",
    differences: 0,
    errors: ["before: fs-capture expired|676|1056"],
  }];
  assertEquals(r.l4_failed, [
    { cell: "a T E1", side: "old", judgment: o1.id, verdict: "fail", checks },
    { cell: "a T E2", side: "new", judgment: n2.id, verdict: "pass", checks },
  ]);
  const text = renderPairing(r);
  assert(text.includes("L4 checks failed"));
  assert(
    text.includes(
      `a T E2 new ${n2.id} (pass): Cronus284 0 differences; before: fs-capture expired|676|1056`,
    ),
  );
  const none = pairingReport(
    "d".repeat(64),
    p,
    completions,
    (id) => byId.get(id),
    () => false,
  );
  assertEquals("l4_failed" in none, false);
  assertEquals(renderPairing(none).includes("L4 checks failed"), false);
});

Deno.test("H-45 (a) Sol r2: failedFsChecks never throws on malformed values; a failed check's odd fields are shown as JSON", () => {
  const j = v2([m("build", true)]);
  const odd = { toString: null };
  assertEquals(
    failedFsChecks(j, {
      judgment_id: j.id,
      execution_id: j.execution_id,
      fs_checks: [
        { ok: false, container: odd, diff: "x", errors: [odd, "after: e"] },
        null,
        "ok",
        { ok: true, container: "C1", diff: [], errors: [] },
      ],
    }),
    [{
      container: '{"toString":null}',
      differences: 0,
      errors: ['{"toString":null}', "after: e"],
    }],
  );
});

Deno.test("H-45 (a) Sol r2: readVerdictLog: a missing log is undefined, any other read failure throws (never a silent omission)", async () => {
  const root = await testTempDir();
  await Deno.mkdir(join(root, "verdicts", "j2.json"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "verdicts", "j3.json"),
    JSON.stringify({ judgment_id: "j3" }),
  );
  assertEquals(await readVerdictLog(root, "j1"), undefined);
  assertEquals(await readVerdictLog(root, "j3"), { judgment_id: "j3" });
  await assertRejects(() => readVerdictLog(root, "j2"));
  await Deno.writeTextFile(join(root, "verdicts", "j4.json"), "{cut");
  await assertRejects(() => readVerdictLog(root, "j4"), SyntaxError);
});
