import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import type { JudgmentRecord } from "../../../src/harness/records.ts";
import {
  appendCompletion,
  freezePairing,
  loadPairing,
  pairFlags,
  type Pairing,
  pairingReport,
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
    { name: "pass_to_pass", passed: false, tests: [row(80010, "H", "fail")] },
    { name: "fail_to_pass", passed: true, tests: F2P },
  ]);
  const flags = pairFlags(legacy, v2(ok, failed));
  assert(flags.includes("policy_attribution_recovered"));
  assert(!flags.includes("policy"));
  // The old p2p suite predates the helper as written (6) and its rows changed.
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
  const old = v2([m("build", true)]);
  const cell = (id: string) => ({
    execution_id: id,
    cell: `a ${id} 1`,
    workspace_hash: "a".repeat(64),
    old_judgment_id: old.id,
    scorer_fingerprint: old.scorer_fingerprint,
  });
  const ids = ["e1", "e2", "e3"];
  const p: Pairing = {
    cohort: { campaign: "c1", started_at: "2026-10-19T10:00:00.000Z" },
    cells: ids.map(cell),
  };
  const digest = await freezePairing(root, p);
  assertEquals(await freezePairing(root, p), digest, "idempotent");
  const fresh = v2([m("build", false)]);
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
  const byId = new Map([old, fresh].map((j) => [j.id, j]));
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
  const pass = v2([m("build", true)]);
  const fail = v2([m("build", false)]);
  const legacy = v1([{ name: "build", passed: true, tests: [] }]);
  const cell = (id: string, old: JudgmentRecord) => ({
    execution_id: id,
    cell: `a T ${id}`,
    workspace_hash: "a".repeat(64),
    old_judgment_id: old.id,
    scorer_fingerprint: old.scorer_fingerprint,
  });
  const p: Pairing = {
    cohort: { campaign: "c1", started_at: "2026-10-19T10:00:00.000Z" },
    cells: [
      cell("1", pass),
      cell("2", legacy),
      cell("3", pass),
      cell("4", pass),
    ],
  };
  const done = (id: string, j: JudgmentRecord) => ({
    execution_id: id,
    new_judgment_id: j.id,
    at: "2026-10-19T11:00:00.000Z",
  });
  const byId = new Map([pass, fail, legacy].map((j) => [j.id, j]));
  const r = pairingReport(
    "d".repeat(64),
    p,
    [done("1", fail), done("2", pass), done("3", { ...pass, id: "gone" })],
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
