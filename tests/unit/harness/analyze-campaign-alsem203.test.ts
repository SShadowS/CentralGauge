// A-03b: al-sem 2.0.3 (looseFingerprint counting, test_quality, digest --tests).
// Fixture shapes are copied from real 2.0.3 output on a synthetic app
// (H:\Temp3\harness-spike\a03b-shapes), trimmed to the fields the runner reads.
import { assertEquals, assertThrows } from "@std/assert";
import {
  alsemEnvelope,
  type AlsemFinding,
  alsemSummary,
  checkedAch,
  coverageExtras,
  digestTouches,
  introducedFindings,
  introducedFindingsFp,
  pooledCoverage,
  pooledTestQuality,
  type TestProc,
  testQualityCounts,
} from "../../../scripts/harness/analyze-campaign.ts";

const f = (
  fingerprint: string,
  looseFingerprint: string,
  o: Partial<AlsemFinding> = {},
): AlsemFinding => ({
  detector: "d3-missing-setloadfields",
  severity: "medium",
  confidence: "likely",
  object: "Shape Calc",
  routine: "R",
  file: "Prod/src/Calc.Codeunit.al",
  line: 1,
  app: "Prod",
  fingerprint,
  looseFingerprint,
  ...o,
});

/** The rule as the maintainers state it: sum over k of max(0, after(k) - before(k)). */
const rule = (a: AlsemFinding[], b: AlsemFinding[]) => {
  const n = (xs: AlsemFinding[]) => {
    const m = new Map<string, number>();
    for (const x of xs) {
      m.set(x.looseFingerprint, (m.get(x.looseFingerprint) ?? 0) + 1);
    }
    return m;
  };
  const [before, after] = [n(a), n(b)];
  let s = 0;
  for (const [k, v] of after) s += Math.max(0, v - (before.get(k) ?? 0));
  return s;
};
const total = (xs: { count: number }[]) => xs.reduce((s, x) => s + x.count, 0);

Deno.test("introducedFindings: a finding that moved to another routine (new fingerprint, same looseFingerprint) is not new", () => {
  const start = [f("fp-old", "L1", { routine: "SumNames" })];
  const final = [f("fp-moved", "L1", { routine: "SumNamesMoved" })];
  assertEquals(introducedFindings(start, final), []);
  // The fingerprint-based count keeps its A-03 meaning: the moved one is new.
  assertEquals(total(introducedFindingsFp(start, final)), 1);
});

Deno.test("introducedFindings: looseFingerprint is not unique, new = sum of max(0, after - before) per key", () => {
  const start = [f("a", "L1")];
  const final = [f("b", "L1"), f("c", "L1"), f("d", "L2")];
  const got = introducedFindings(start, final);
  assertEquals(total(got), 2); // L1: 2 - 1 = 1, L2: 1 - 0 = 1
  assertEquals(total(got), rule(start, final));
  // Fewer on one key never offsets more on another.
  const s2 = [f("a", "L1"), f("b", "L1")];
  const f2 = [f("c", "L1"), f("d", "L2")];
  assertEquals(total(introducedFindings(s2, f2)), 1);
  assertEquals(total(introducedFindings(s2, f2)), rule(s2, f2));
});

Deno.test("introducedFindings: names the new ones by pairing on both keys first, then on looseFingerprint", () => {
  // final lists the new one first; loose-only pairing in order would name the unchanged one.
  const start = [f("fp1", "L")];
  const final = [f("fp2", "L", { line: 5 }), f("fp1", "L", { line: 9 })];
  const got = introducedFindings(start, final);
  assertEquals(got.map((x) => [x.fingerprint, x.count]), [["fp2", 1]]);
  // Second phase: the leftover start (fp-x) pairs with the leftover final on loose.
  const s2 = [f("fp1", "L"), f("fp-x", "M")];
  const f2 = [f("fp1", "L"), f("fp-y", "M"), f("fp-z", "M")];
  assertEquals(
    introducedFindings(s2, f2).map((x) => [x.fingerprint, x.count]),
    [["fp-z", 1]],
  );
  assertEquals(total(introducedFindings(s2, f2)), rule(s2, f2));
});

Deno.test("introducedFindings: counts equal the rule on a mixed set; fixed findings are not introduced", () => {
  const start = [f("a", "L1"), f("b", "L2"), f("c", "L2"), f("d", "L3")];
  const final = [f("a2", "L1"), f("b", "L2"), f("e", "L4"), f("e2", "L4")];
  assertEquals(total(introducedFindings(start, final)), rule(start, final));
  assertEquals(total(introducedFindings(start, final)), 2);
  assertEquals(total(introducedFindings([], final)), final.length);
  assertEquals(introducedFindings(start, []), []);
  // The Test app's findings are paired on the same keys; app comes from the final side.
  const t = introducedFindings([], [f("t", "LT", { app: "Test" })]);
  assertEquals(t.map((x) => x.app), ["Test"]);
});

// ---------------------------------------------------------------- test_quality

const proc = (
  name: string,
  reach: number,
  o: Partial<Record<string, unknown>> = {},
) => ({
  path: "Test/src/CalcTests.Codeunit.al",
  line: 9,
  object_type: "Codeunit",
  object_name: "Shape Calc Tests",
  object_id: 50200,
  object_stable_id: "c6a1e000-0000-4000-8000-0000000000ff/Codeunit/50200",
  procedure_name: name,
  routine_id: `c6a1e000-0000-4000-8000-0000000000ff:Codeunit:50200#${name}`,
  assert_count: reach,
  assert_count_reachable: reach,
  zero_assert: reach === 0,
  has_asserterror: false,
  are_equal: { total: 0, literal_expected: 0, expression_expected: 0 },
  ...o,
});

const ach = (
  procs: ReturnType<typeof proc>[],
  over: Record<string, unknown> = {},
) =>
  JSON.stringify({
    metrics: [],
    findings: [],
    summary: {},
    test_quality: {
      procedures: procs,
      codeunits: [],
      workspace: {
        test_procedures: procs.length,
        assert_count: procs.reduce((s, p) => s + p.assert_count, 0),
        assert_count_reachable: procs.reduce(
          (s, p) => s + p.assert_count_reachable,
          0,
        ),
        zero_assert_procedures: procs.filter((p) => p.zero_assert).length,
        asserterror_procedures: procs.filter((p) => p.has_asserterror).length,
        are_equal: { total: 0, literal_expected: 0, expression_expected: 0 },
      },
    },
    ...over,
  });

Deno.test("checkedAch: reads test_quality (2.0.3 shape), strict: missing or malformed fails closed", () => {
  const ok = checkedAch(
    ach([
      proc("TestViaHelper", 2, { assert_count: 0 }),
      proc("TestErr", 1, { has_asserterror: true }),
    ]),
  );
  assertEquals(ok.test_quality.procedures.length, 2);
  assertEquals(ok.test_quality.procedures[0]!.assert_count_reachable, 2);
  const bad: [string, string][] = [
    ["no test_quality (a 2.0.2 output)", ach([], { test_quality: undefined })],
    ["test_quality not an object", ach([], { test_quality: [] })],
    [
      "procedures not an array",
      ach([], { test_quality: { procedures: {}, workspace: {} } }),
    ],
    [
      "a procedure without are_equal",
      ach([proc("T", 1, { are_equal: undefined })]),
    ],
    [
      "zero_assert as a number",
      ach([proc("T", 1, { zero_assert: 0 })]),
    ],
    [
      "assert_count_reachable as a string",
      ach([proc("T", 1, { assert_count_reachable: "1" })]),
    ],
    [
      "no object_stable_id",
      ach([proc("T", 1, { object_stable_id: undefined })]),
    ],
    [
      "workspace totals disagree with the procedures",
      (() => {
        const d = JSON.parse(ach([proc("T", 1)]));
        d.test_quality.workspace.assert_count_reachable = 5;
        return JSON.stringify(d);
      })(),
    ],
  ];
  for (const [what, text] of bad) {
    assertThrows(() => checkedAch(text), Error, "", what);
  }
  // No tests at all is a valid, empty block.
  assertEquals(checkedAch(ach([])).test_quality.procedures, []);
});

const tp = (
  name: string,
  reach: number,
  o: Partial<TestProc> = {},
): TestProc => ({
  path: "Test/src/CalcTests.Codeunit.al",
  line: 1,
  object_stable_id: "c6a1e000-0000-4000-8000-0000000000ff/Codeunit/50200",
  procedure_name: name,
  routine_id: `rid-${name}`,
  assert_count_reachable: reach,
  zero_assert: reach === 0,
  has_asserterror: false,
  are_equal: { total: 0, literal_expected: 0, expression_expected: 0 },
  ...o,
});

Deno.test("testQualityCounts: introduced (not in start) or changed (digest root) [Test] procedures, Test app only", () => {
  const start = [tp("Keep", 1), tp("Edited", 1), tp("Gone", 3)];
  const final = [
    tp("Keep", 9, { zero_assert: false }), // unchanged by the patch: not scored, even if numbers differ
    tp("Edited", 2, {
      are_equal: { total: 2, literal_expected: 1, expression_expected: 1 },
    }),
    tp("NewZero", 0),
    tp("NewErr", 1, {
      has_asserterror: true,
      are_equal: { total: 1, literal_expected: 1, expression_expected: 0 },
    }),
    // another app's procedure is not the Test app's
    tp("Elsewhere", 7, { path: "Core/src/X.al" }),
  ];
  const c = testQualityCounts(start, final, new Set(["rid-Edited"]));
  assertEquals(c, {
    new_test_procs: 2,
    scored: 3,
    assert_reachable: 3,
    zero_assert: 1,
    asserterror: 1,
    areequal_total: 3,
    areequal_literal: 2,
  });
});

Deno.test("testQualityCounts: no procedure introduced or changed is all zeros; a changed procedure without routine_id joins on (path, line)", () => {
  assertEquals(testQualityCounts([tp("A", 1)], [tp("A", 1)], new Set()), {
    new_test_procs: 0,
    scored: 0,
    assert_reachable: 0,
    zero_assert: 0,
    asserterror: 0,
    areequal_total: 0,
    areequal_literal: 0,
  });
  const a = tp("A", 1, { routine_id: null, line: 5 });
  const b = tp("A", 4, { routine_id: null, line: 5 });
  const same = testQualityCounts([a], [b], new Set());
  assertEquals(same.new_test_procs, 0);
  const moved = testQualityCounts([a], [
    tp("A", 4, { routine_id: null, line: 9 }),
  ], new Set());
  assertEquals(moved.new_test_procs, 1);
});

// ---------------------------------------------------------------- digest --tests

const DIGEST_ENTRIES = [{
  routine: { stableId: "r1", anchor: { file: "ws:Prod/A.al" } },
  effects: [],
}, {
  // the covered entry "m" of COVERAGE carries no anchor of its own: it maps through here
  routine: { stableId: "m", anchor: { file: "ws:Prod/M.al" } },
  effects: [],
}];
const COVERAGE = {
  changedRoutines: 3,
  coverage: {
    reasons: ["dependency-code"],
    status: "partial",
    testsCallingDependencyCode: 3,
    testsWithUnresolvedTraversal: 0,
  },
  covered: [{
    display: "Mul",
    reachedFrom: ["t"],
    stableId: "m",
    viaEvent: false,
  }],
  coveredChangedRoutines: 1,
  excludedTestCode: 0,
  ratio: 0.3333333333333333,
  testProceduresConsidered: 6,
  uncovered: [
    {
      anchor: { file: "ws:Prod/A.al", line: 3 },
      display: "A",
      reason: "no-path",
      stableId: "a",
    },
    {
      anchor: { file: "ws:Prod/B.al", line: 4 },
      display: "B",
      reason: "no-path",
      stableId: "b",
    },
  ],
};
const digest = (testCoverage?: unknown) => ({
  entries: DIGEST_ENTRIES,
  summary: {},
  changedRootsDiagnostics: [],
  ...(testCoverage === undefined ? {} : { testCoverage }),
});
const env = (payload: unknown) => ({
  alsemVersion: "2.0.3",
  schemaVersion: "1.6.0",
  kind: "digest",
  diagnostics: [],
  payload,
});

Deno.test("digestTouches: testCoverage ratio, covered and uncovered counts; absent lists are empty; ratio null with no changed routine", () => {
  const t = digestTouches(digest(COVERAGE));
  assertEquals(
    [
      t.test_changed_routines,
      t.test_covered_routines,
      t.test_uncovered_routines,
      t.test_coverage_ratio,
      t.test_coverage_status,
    ],
    [3, 1, 2, 1 / 3, "partial"],
  );
  // 2.0.3 leaves `covered` / `uncovered` out when empty.
  const { covered: _c, uncovered: _u, ...none } = COVERAGE;
  const e = digestTouches(
    digest({
      ...none,
      changedRoutines: 0,
      coveredChangedRoutines: 0,
      ratio: null,
    }),
  );
  assertEquals(
    [
      e.test_changed_routines,
      e.test_covered_routines,
      e.test_uncovered_routines,
      e.test_coverage_ratio,
    ],
    [0, 0, 0, null],
  );
  // No digest at all (an execution with no patch): nothing changed, no ratio.
  const n = digestTouches({ entries: [] });
  assertEquals([
    n.test_changed_routines,
    n.test_coverage_ratio,
    n.test_coverage_status,
  ], [0, null, null]);
});

// A-03b smoke: al-sem excludes only [Test] procedures, so test-app helpers and
// non-[Test] procedures of test codeunits are in its testCoverage counts.
const mixedCoverage = () => ({
  entries: [
    ...DIGEST_ENTRIES,
    {
      routine: { stableId: "p1", anchor: { file: "ws:Prod/P.al" } },
      effects: [],
    },
    {
      routine: { stableId: "pu", anchor: { file: "ws:Prod/U.al" } },
      effects: [],
    },
    {
      routine: { stableId: "h1", anchor: { file: "ws:Test/Lib.Codeunit.al" } },
      effects: [],
    },
  ],
  summary: {},
  changedRootsDiagnostics: [],
  testCoverage: {
    changedRoutines: 5,
    coverage: { reasons: [], status: "complete" },
    covered: [
      { display: "P", reachedFrom: ["t"], stableId: "p1", viaEvent: false },
      {
        display: "Helper",
        reachedFrom: ["t"],
        stableId: "h1",
        viaEvent: false,
      },
    ] as Record<string, unknown>[],
    coveredChangedRoutines: 2,
    ratio: 0.4,
    uncovered: [
      // no own anchor: maps through entries (production)
      { display: "U", reason: "no-path", stableId: "pu" },
      // a non-[Test] procedure inside a test codeunit
      {
        anchor: { file: "ws:Test/T.Codeunit.al", line: 9 },
        display: "Setup",
        reason: "no-path",
        stableId: "tn",
      },
      // an interface method has no body
      {
        anchor: { file: "ws:Prod/I.Interface.al", line: 2 },
        display: "Send",
        reason: "declaration-only",
        stableId: "pd",
      },
    ] as Record<string, unknown>[],
  },
});

Deno.test("digestTouches: test coverage counts production routines only (Test/ helpers and non-[Test] test-codeunit procedures are out), al-sem's raw values are kept", () => {
  const t = digestTouches(mixedCoverage());
  assertEquals(
    [
      t.test_changed_routines,
      t.test_covered_routines,
      t.test_uncovered_routines,
      t.test_coverage_ratio,
      t.test_declaration_only,
    ],
    [2, 1, 1, 0.5, 1],
  );
  assertEquals(
    [
      t.test_changed_routines_raw,
      t.test_covered_routines_raw,
      t.test_uncovered_routines_raw,
      t.test_coverage_ratio_raw,
    ],
    [5, 2, 3, 0.4],
  );
});

Deno.test("digestTouches: declaration-only is matched on the reason, not the name, and leaves the denominator; only declaration-only left gives a null ratio", () => {
  const p = mixedCoverage();
  p.testCoverage.covered = [];
  p.testCoverage.coveredChangedRoutines = 0;
  p.testCoverage.ratio = 0;
  p.testCoverage.uncovered = [{
    anchor: { file: "ws:Prod/I.Interface.al", line: 2 },
    display: "declaration-only",
    reason: "no-path",
    stableId: "pd",
  }, {
    anchor: { file: "ws:Prod/I.Interface.al", line: 3 },
    display: "Send",
    reason: "declaration-only",
    stableId: "pd2",
  }];
  const t = digestTouches(p);
  assertEquals(
    [
      t.test_changed_routines,
      t.test_uncovered_routines,
      t.test_declaration_only,
    ],
    [1, 1, 1],
  );
  p.testCoverage.uncovered = p.testCoverage.uncovered.slice(1);
  const d = digestTouches(p);
  assertEquals(
    [d.test_changed_routines, d.test_coverage_ratio, d.test_declaration_only],
    [0, null, 1],
  );
});

Deno.test("digestTouches: a covered or uncovered stableId that maps to no file throws", () => {
  const c = mixedCoverage();
  c.testCoverage.covered[0]!["stableId"] = "ghost";
  assertThrows(() => digestTouches(c), Error, "ghost");
  const u = mixedCoverage();
  u.testCoverage.uncovered[0]!["stableId"] = "ghost2";
  assertThrows(() => digestTouches(u), Error, "ghost2");
});

Deno.test("coverageExtras: declaration-only and raw sums; partial-status share among executions with a coverage status", () => {
  const m = (o: Record<string, number | null>) => o as never;
  const x = coverageExtras([
    {
      metrics: m({
        test_declaration_only: 1,
        test_changed_routines_raw: 5,
        test_covered_routines_raw: 2,
      }),
      touches: { test_coverage_status: "partial" },
    },
    {
      metrics: m({
        test_declaration_only: 0,
        test_changed_routines_raw: 3,
        test_covered_routines_raw: 3,
      }),
      touches: { test_coverage_status: "complete" },
    },
    {
      metrics: m({
        test_declaration_only: 0,
        test_changed_routines_raw: 0,
        test_covered_routines_raw: 0,
      }),
      touches: { test_coverage_status: null },
    },
  ]);
  assertEquals(x, {
    declaration_only: 1,
    partial_status_share: 0.5,
    raw: { changed_routines: 8, covered_routines: 5, ratio: 5 / 8 },
  });
  assertEquals(coverageExtras([]).partial_status_share, null);
});

Deno.test("alsemEnvelope digest with --tests: testCoverage is required and consistent, else fails closed", () => {
  const ok = alsemEnvelope(env(digest(COVERAGE)), "digest", { tests: true });
  assertEquals(ok.schemaVersion, "1.6.0");
  const bad: [string, unknown][] = [
    ["no testCoverage (digest run without --tests)", digest()],
    ["testCoverage not an object", digest([])],
    ["no changedRoutines", digest({ ...COVERAGE, changedRoutines: undefined })],
    ["ratio as a string", digest({ ...COVERAGE, ratio: "0.3" })],
    [
      "ratio disagrees with covered / changed",
      digest({ ...COVERAGE, ratio: 0.9 }),
    ],
    ["null ratio with changed routines", digest({ ...COVERAGE, ratio: null })],
    [
      "covered list disagrees with the count",
      digest({ ...COVERAGE, coveredChangedRoutines: 2, ratio: 2 / 3 }),
    ],
    ["covered not an array", digest({ ...COVERAGE, covered: {} })],
    ["no coverage.status", digest({ ...COVERAGE, coverage: {} })],
  ];
  for (const [what, p] of bad) {
    assertThrows(
      () => alsemEnvelope(env(p), "digest", { tests: true }),
      Error,
      "",
      what,
    );
  }
  // Without the flag a plain digest is still fine (no schema change in 2.0.3).
  assertEquals(alsemEnvelope(env(digest()), "digest").kind, "digest");
});

Deno.test("alsemEnvelope: an analyze finding without looseFingerprint (2.0.2 output) is invalid; the schemaVersions are unchanged and strict", () => {
  const finding = {
    detector: "d1",
    severity: "high",
    confidence: { level: "likely" },
    primaryLocation: { file: "ws:Core/A.al" },
    fingerprint: "fp",
    looseFingerprint: "lfp",
  };
  const a = (findings: unknown[], v = "1.0.0") => ({
    alsemVersion: "2.0.3",
    schemaVersion: v,
    kind: "analyze-report",
    diagnostics: [],
    payload: { findings },
  });
  assertEquals(
    alsemEnvelope(a([finding]), "analyze-report").schemaVersion,
    "1.0.0",
  );
  const { looseFingerprint: _l, ...old } = finding;
  assertThrows(
    () => alsemEnvelope(a([old]), "analyze-report"),
    Error,
    "looseFingerprint",
  );
  assertThrows(
    () =>
      alsemEnvelope(a([{ ...finding, looseFingerprint: 7 }]), "analyze-report"),
    Error,
    "looseFingerprint",
  );
  assertThrows(
    () => alsemEnvelope(a([finding], "1.1.0"), "analyze-report"),
    Error,
    "schemaVersion",
  );
});

// ---------------------------------------------------------------- summary + aggregation

Deno.test("alsemSummary: new rule drives new / curated columns, the fingerprint rule is kept as _fp columns; test quality and coverage columns", () => {
  const nf = (count: number, o: Partial<AlsemFinding> = {}) => ({
    ...f("x", "y", { detector: "d1-db-op-in-loop", severity: "high", ...o }),
    count,
  });
  const zero = {
    abi: 0,
    schema: 0,
    events: 0,
    permissions: 0,
    capabilities: 0,
    by_kind: {},
    critical_or_high: 0,
  };
  const m = alsemSummary({
    introduced: [nf(1)], // looseFingerprint rule: 1 new high likely
    introduced_fp: [nf(3, { fingerprint: "p" })], // fingerprint rule: moved ones count too
    deltas: [],
    unused: [],
    blast: { total: {}, production: zero, test: zero },
    touches: digestTouches(digest(COVERAGE)),
    changed_prod_lines: 20,
    testQuality: {
      new_test_procs: 2,
      scored: 4,
      assert_reachable: 6,
      zero_assert: 1,
      asserterror: 2,
      areequal_total: 5,
      areequal_literal: 4,
    },
  });
  assertEquals(m.alsem_new_findings, 1);
  assertEquals(m.alsem_new_findings_fp, 3);
  assertEquals([m.curated_weighted, m.curated_density], [3, 15]);
  assertEquals([m.curated_weighted_fp, m.curated_density_fp], [9, 45]);
  assertEquals(
    [
      m.new_test_procs,
      m.test_procs_scored,
      m.test_assert_reachable_mean,
      m.test_zero_assert_share,
      m.test_asserterror_share,
      m.test_areequal_literal_share,
    ],
    [2, 4, 1.5, 0.25, 0.5, 0.8],
  );
  assertEquals(
    [
      m.test_changed_routines,
      m.test_covered_routines,
      m.test_uncovered_routines,
      m.test_coverage_ratio,
    ],
    [3, 1, 2, 1 / 3],
  );
  // Nothing scored: the shares and the mean are null, not 0.
  const e = alsemSummary({
    introduced: [],
    introduced_fp: [],
    deltas: [],
    unused: [],
    blast: { total: {}, production: zero, test: zero },
    touches: digestTouches({ entries: [] }),
    testQuality: {
      new_test_procs: 0,
      scored: 0,
      assert_reachable: 0,
      zero_assert: 0,
      asserterror: 0,
      areequal_total: 0,
      areequal_literal: 0,
    },
  });
  assertEquals(
    [
      e.test_assert_reachable_mean,
      e.test_zero_assert_share,
      e.test_areequal_literal_share,
      e.test_coverage_ratio,
    ],
    [null, null, null, null],
  );
});

Deno.test("pooledTestQuality / pooledCoverage: sums over executions, shares from the pooled counts, null when the denominator is 0", () => {
  const m = (o: Record<string, number | null>) => o as never;
  const q = pooledTestQuality([
    m({
      new_test_procs: 1,
      test_procs_scored: 2,
      test_assert_reachable_sum: 4,
      test_zero_assert_procs: 1,
      test_asserterror_procs: 0,
      test_areequal_total: 2,
      test_areequal_literal: 1,
    }),
    m({
      new_test_procs: 2,
      test_procs_scored: 2,
      test_assert_reachable_sum: 2,
      test_zero_assert_procs: 0,
      test_asserterror_procs: 2,
      test_areequal_total: 0,
      test_areequal_literal: 0,
    }),
  ]);
  assertEquals(q, {
    new_test_procs: 3,
    procs_scored: 4,
    assert_reachable_mean: 1.5,
    zero_assert_share: 0.25,
    asserterror_share: 0.5,
    areequal_literal_share: 0.5,
  });
  assertEquals(pooledTestQuality([]).assert_reachable_mean, null);
  const c = pooledCoverage([
    m({
      test_changed_routines: 3,
      test_covered_routines: 1,
      test_uncovered_routines: 2,
    }),
    m({
      test_changed_routines: 0,
      test_covered_routines: 0,
      test_uncovered_routines: 0,
    }),
    m({
      test_changed_routines: 1,
      test_covered_routines: 1,
      test_uncovered_routines: 0,
    }),
  ]);
  assertEquals(c, {
    changed_routines: 4,
    covered_routines: 2,
    uncovered_routines: 2,
    ratio: 0.5,
  });
  assertEquals(pooledCoverage([]).ratio, null);
});
