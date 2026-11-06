// H-68: the screening pre-screen (design note H-68, decision
// 2026-11-06-m8-wave2-round0-and-prescreen). Pure logic only: no git, no
// results dir, nothing read from the coordination share.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import type { Cell } from "../../../src/harness/stats.ts";
import type {
  Candidate,
  Rules,
  ScreenCampaign,
  Screening,
  Status,
} from "../../../scripts/harness/screening.ts";
import { ValidationError } from "../../../src/errors.ts";
import {
  amendmentGate,
  amendmentProblems,
  auditSample,
  evaluatePrescreen,
  falseKill,
  PRESCREEN_DECISIONS,
  PRESCREEN_PREFIX,
  prescreenVerdict,
  roundOf,
  type SealView,
} from "../../../scripts/harness/prescreen.ts";
import {
  ranks,
  RulesSchema,
  SCREEN_PREFIX,
  ScreeningSchema,
} from "../../../scripts/harness/screening.ts";

const RULES: Rules = RulesSchema.parse({
  arms: ["cc-v2-plain", "cc-v2-realistic-lsp"],
  repeats: 3,
  easy_share: 0.2,
  hard_share: 0.2,
  kind_min: 2,
  kind_max_share: 0.4,
  required_coupling: ["single-instance", "temporary-table", "commit-behavior"],
  coupling_min: 1,
  large_min_share: 0.5,
  borrow: {
    easy: ["intermediate"],
    intermediate: ["hard", "easy"],
    hard: ["intermediate"],
  },
});
const [PLAIN, LSP] = RULES.arms;
const DECISION = PRESCREEN_DECISIONS[0]!;

const C = (id: string): Candidate => ({
  id,
  prior: "intermediate",
  size: { objects: 3, files: 2, reuse: null, traces: null },
  supersedes: null,
  broken: null,
});
type Round = { seal: string; mode: "calibration" | "filter" };
const S = (
  ids: string[],
  rounds: Round[] | null = null,
  decision = DECISION,
): Screening =>
  ScreeningSchema.parse({
    v: 1,
    rules: RULES,
    candidates: ids.map(C),
    ...(rounds === null
      ? {}
      : { amendments: [{ id: "prescreen", decision, rounds }] }),
  });

const cell = (
  task: string,
  arm: string,
  pass: boolean | null,
  repeat = 1,
  status: Cell["status"] = pass === null ? "unscored" : "scored",
): Cell => ({
  task,
  arm,
  repeat,
  status,
  pass,
  spend_usd: 0,
  known_spend_usd: 0,
  attempts: 1,
});
/** One pre-screen per task: one cell per arm, repeat 1. */
const pre = (task: string, plain: boolean, lsp: boolean): Cell[] => [
  cell(task, PLAIN, plain),
  cell(task, LSP, lsp),
];
const six = (task: string, solved: number): Cell[] =>
  [0, 1, 2, 3, 4, 5].map((i) =>
    cell(task, RULES.arms[i % 2]!, i < solved, Math.floor(i / 2) + 1)
  );
const camp = (
  id: string,
  created_at: string,
  cells: Cell[],
  experiment = `${PRESCREEN_PREFIX}${id}`,
): ScreenCampaign => ({ id, experiment, created_at, cells });

const START = "harness-v2-screen-start";
const W5 = "harness-v2-screen-w5";
const W6 = "harness-v2-screen-w6";
const W7 = "harness-v2-screen-w7";
const CAL5: Round = { seal: W5, mode: "calibration" };
const FIL6: Round = { seal: W6, mode: "filter" };

/**
 * start: HX-001 (before the amendment). w5: HX-002 (calibration).
 * w6: HX-003..HX-008 (filter). w7: HX-009, whose registry has no w7 round.
 */
const SEALS: SealView[] = [
  { tag: START, seed: "seed-start", screening: S(["HX-001"]) },
  { tag: W5, seed: "seed-w5", screening: S(["HX-001", "HX-002"], [CAL5]) },
  {
    tag: W6,
    seed: "seed-w6",
    screening: S(
      ["HX-001", "HX-002", "HX-003", "HX-004", "HX-005", "HX-006", "HX-007"],
      [CAL5, FIL6],
    ),
  },
  {
    tag: W7,
    seed: "seed-w7",
    screening: S(
      [
        "HX-001",
        "HX-002",
        "HX-003",
        "HX-004",
        "HX-005",
        "HX-006",
        "HX-007",
        "HX-009",
      ],
      [CAL5, FIL6],
    ),
  },
];
const ALL = SEALS[3]!.screening.candidates.map((c) => c.id);
/** HEAD adds a w7 round after the fact: it must be ignored. */
const HEAD = S([...ALL, "HX-010"], [CAL5, FIL6, { seal: W7, mode: "filter" }]);

Deno.test("prefixes: pre-screen and screen experiment prefixes are disjoint", () => {
  assertEquals(PRESCREEN_PREFIX, "v2-prescreen-");
  assert(!PRESCREEN_PREFIX.startsWith(SCREEN_PREFIX));
  assert(!SCREEN_PREFIX.startsWith(PRESCREEN_PREFIX));
});

Deno.test("prescreenVerdict: both arms scored and passing is provisionally saturated; anything else is eligible", () => {
  const v = prescreenVerdict([
    ...pre("HX-001", true, true),
    ...pre("HX-002", true, false),
    ...pre("HX-003", false, true),
    ...pre("HX-004", false, false),
    // crash-excluded (excludeCrashCells makes it unscored) and unscored
    cell("HX-005", PLAIN, true),
    cell("HX-005", LSP, null, 1, "unscored"),
    // a missing arm
    cell("HX-006", PLAIN, true),
    // not yet run
    cell("HX-007", PLAIN, true),
    cell("HX-007", LSP, null, 1, "pending"),
    // repeat 2 is never read: a pre-screen is repeat 1 only
    ...pre("HX-008", true, true),
    cell("HX-008", LSP, false, 2),
    cell("HX-009", PLAIN, true, 2),
    cell("HX-009", LSP, true, 2),
  ], RULES);
  assertEquals(Object.fromEntries(v), {
    "HX-001": "provisionally_saturated",
    "HX-002": "eligible",
    "HX-003": "eligible",
    "HX-004": "eligible",
    "HX-005": "eligible",
    "HX-006": "eligible",
    "HX-007": "eligible",
    "HX-008": "provisionally_saturated",
    "HX-009": "eligible",
  });
});

Deno.test("prescreenVerdict: a foreign arm throws", () => {
  assertThrows(
    () => prescreenVerdict([cell("HX-001", "cc-other", true)], RULES),
    ValidationError,
    "not a screening arm",
  );
});

Deno.test("roundOf: the mode comes from the registry committed at the candidate's first seal", () => {
  assertEquals(roundOf("HX-002", SEALS), {
    ok: true,
    seal: W5,
    mode: "calibration",
  });
  assertEquals(roundOf("HX-005", SEALS), {
    ok: true,
    seal: W6,
    mode: "filter",
  });
  // Before the amendment: no round at its first seal.
  assertEquals(roundOf("HX-001", SEALS), {
    ok: false,
    problem: `HX-001: its first seal ${START} has no pre-screen round`,
  });
  // HEAD's w7 round is not in the w7 registry, so it is ignored.
  assertEquals(roundOf("HX-009", SEALS), {
    ok: false,
    problem: `HX-009: its first seal ${W7} has no pre-screen round`,
  });
  assertEquals(roundOf("HX-010", SEALS), {
    ok: false,
    problem: "HX-010 is not sealed",
  });
});

Deno.test("amendmentGate: a missing or unlisted amendment refuses; a whitelisted one passes", () => {
  assertEquals(amendmentGate(HEAD), []);
  assertEquals(amendmentGate(S(ALL)), [
    "screening.yml has no prescreen amendment: pre-screen data and modes are refused",
  ]);
  assertEquals(amendmentGate(S(ALL, [CAL5], "decisions/other.md")), [
    `the prescreen amendment names decisions/other.md, which is not an owner decision authorising the pre-screen (${DECISION})`,
  ]);
  // The whitelist is the code's, not the caller's.
  assertEquals(
    amendmentGate(S(ALL, [CAL5], "decisions/other.md"), ["decisions/other.md"]),
    [],
  );
});

Deno.test("amendmentProblems: rounds may be appended, never edited or removed", () => {
  const sealed = S(ALL, [CAL5]);
  assertEquals(amendmentProblems(W5, S(ALL), S(ALL)), []);
  assertEquals(amendmentProblems(W5, S(ALL), S(ALL, [CAL5])), []);
  assertEquals(amendmentProblems(W5, sealed, S(ALL, [CAL5, FIL6])), []);
  assertEquals(amendmentProblems(W5, sealed, S(ALL)), [
    `prescreen amendment removed after ${W5}`,
  ]);
  for (
    const now of [
      S(ALL, [{ seal: W5, mode: "calibration" }, FIL6], "decisions/x.md"),
      S(ALL, [{ seal: W6, mode: "calibration" }]),
      S(ALL, []),
    ]
  ) {
    assertEquals(amendmentProblems(W5, sealed, now), [
      `prescreen amendment changed after ${W5} (rounds may only be appended)`,
    ]);
  }
});

Deno.test("auditSample: ceil(20%) of the rejects, the lowest under the domain-tagged rank", async () => {
  const ps = (ids: string[]) =>
    new Map(ids.map((id) => [id, "provisionally_saturated" as const]));
  for (const [n, m] of [[1, 1], [5, 1], [6, 2], [10, 2], [11, 3]] as const) {
    const ids = Array.from({ length: n }, (_, i) => `HX-${100 + i}`);
    const a = await auditSample("seed-w6", ids, ps(ids));
    assertEquals(a?.rejects, ids);
    assertEquals(a?.audited.length, m, `${m} of ${n}`);
  }
  // Eligible candidates are not rejects; no rejects is no audit.
  const v = new Map([
    ["HX-001", "eligible" as const],
    ["HX-002", "provisionally_saturated" as const],
  ]);
  assertEquals(await auditSample("s", ["HX-001", "HX-002"], v), {
    rejects: ["HX-002"],
    audited: ["HX-002"],
  });
  assertEquals(
    await auditSample("s", ["HX-001"], new Map([["HX-001", "eligible"]])),
    { rejects: [], audited: [] },
  );
});

Deno.test("auditSample: deterministic, domain-separated from select's rank, pending until every candidate has a verdict", async () => {
  const ids = ["HX-101", "HX-102", "HX-103", "HX-104", "HX-105", "HX-106"];
  const v = new Map(ids.map((id) => [id, "provisionally_saturated" as const]));
  const seed = "c0ffee:beac0n";
  const lowest = async (s: string) =>
    [...await ranks(s, ids)].sort(([, a], [, b]) => a < b ? -1 : 1).slice(0, 2)
      .map(([id]) => id).sort();
  const a = await auditSample(seed, [...ids].reverse(), v);
  assertEquals(a, await auditSample(seed, ids, v));
  assertEquals(a!.audited, await lowest(`${seed}:prescreen-audit`));
  // Without the tag the audit would be select()'s best-ranked rejects.
  assertNotEquals(a!.audited, await lowest(seed));
  assertNotEquals(a, await auditSample("other", ids, v));
  // One candidate of the seal without a verdict: pending.
  assertEquals(await auditSample(seed, [...ids, "HX-107"], v), null);
});

Deno.test("falseKill: k/n over resolved provisional rejects, pending counted apart, full 2x2", () => {
  const verdicts = new Map([
    ["HX-001", "provisionally_saturated" as const],
    ["HX-002", "provisionally_saturated" as const],
    ["HX-003", "provisionally_saturated" as const],
    ["HX-004", "provisionally_saturated" as const],
    ["HX-005", "eligible" as const],
    ["HX-006", "eligible" as const],
    ["HX-007", "eligible" as const],
  ]);
  const status = new Map<string, Status>([
    ["HX-001", "saturated"],
    ["HX-002", "saturated"],
    ["HX-003", "intermediate"],
    ["HX-004", "unscreened"],
    ["HX-005", "saturated"],
    ["HX-006", "dead"],
    ["HX-007", "incomplete"],
    ["HX-008", "hard"],
  ]);
  // HX-008 has no verdict: not part of the table.
  const fk = falseKill(
    [
      "HX-001",
      "HX-002",
      "HX-003",
      "HX-004",
      "HX-005",
      "HX-006",
      "HX-007",
      "HX-008",
    ],
    verdicts,
    status,
  );
  assertEquals(fk, {
    k: 1,
    n: 3,
    pending: 1,
    table: {
      provisionally_saturated: { saturated: 2, other: 1, pending: 1 },
      eligible: { saturated: 1, other: 1, pending: 1 },
    },
  });
});

const AT = (d: number) => `2026-11-${String(d).padStart(2, "0")}T00:00:00Z`;
const input = (
  prescreens: ScreenCampaign[],
  extra: Partial<Parameters<typeof evaluatePrescreen>[0]> = {},
) => ({
  now: HEAD,
  seals: SEALS,
  heldOut: ["HX-007"],
  prescreens,
  full: [],
  ...extra,
});

Deno.test("evaluatePrescreen: held-out, unsealed, unknown, duplicate and round-less pre-screens are refused", async () => {
  const r = await evaluatePrescreen(input([
    camp("p1", AT(10), [
      ...pre("HX-002", true, true),
      ...pre("HX-007", true, true),
      ...pre("HX-010", true, true),
      ...pre("HX-099", true, true),
      ...pre("HX-001", true, true),
    ]),
    camp("p2", AT(11), pre("HX-002", true, false)),
  ]));
  assertEquals(r.problems, [
    "HX-002 pre-screened 2 times (no pre-screen rerun)",
    "pre-screen: HX-007 is held out but was screened",
    "pre-screen: HX-010 was screened before it was sealed",
    "pre-screen: HX-099 was screened but is not a registry candidate",
    `HX-001: its first seal ${START} has no pre-screen round`,
  ]);
});

Deno.test("evaluatePrescreen: without a whitelisted amendment, pre-screen data is refused and no mode applies", async () => {
  const now = S([...ALL, "HX-010"]);
  const sealsNo = SEALS.map((s) => ({
    ...s,
    screening: S(s.screening.candidates.map((c) => c.id)),
  }));
  const none = await evaluatePrescreen(input([], { now, seals: sealsNo }));
  assertEquals(none.problems, []);
  assertEquals([none.provisional.size, none.waiting.size, none.verdicts.size], [
    0,
    0,
    0,
  ]);
  const some = await evaluatePrescreen(
    input([camp("p1", AT(10), pre("HX-002", true, true))], {
      now,
      seals: sealsNo,
    }),
  );
  assertEquals(some.problems, [
    "screening.yml has no prescreen amendment: pre-screen data and modes are refused",
  ]);
  assertEquals(some.verdicts.size, 0);
  // A sealed amendment that HEAD drops is reported.
  const dropped = await evaluatePrescreen(input([], { now }));
  assert(dropped.problems.includes(`prescreen amendment removed after ${W5}`));
});

Deno.test("evaluatePrescreen (Q8): a filter-round pre-screen after a complete full screen is refused; calibration has no order", async () => {
  const full = [
    camp(
      "f1",
      AT(5),
      [...six("HX-003", 6), ...six("HX-002", 6)],
      "v2-screen-9",
    ),
  ];
  const r = await evaluatePrescreen(input([
    camp("p1", AT(10), [
      ...pre("HX-003", true, true),
      ...pre("HX-002", true, true),
    ]),
  ], { full }));
  assertEquals(r.problems, [
    "HX-003 pre-screened in v2-prescreen-p1 after a complete full screen in v2-screen-9",
  ]);
  // An incomplete earlier full screen, or one created after, is fine.
  const ok = await evaluatePrescreen(input([
    camp("p1", AT(10), pre("HX-003", true, true)),
  ], {
    full: [
      camp("f1", AT(5), six("HX-003", 6).slice(0, 5), "v2-screen-9"),
      camp("f2", AT(12), six("HX-003", 6), "v2-screen-10"),
    ],
  }));
  assertEquals(ok.problems, []);
});

Deno.test("evaluatePrescreen: a filter round holds back its rejects until every candidate has a verdict, then keeps the non-audited ones provisional", async () => {
  // w6 filter candidates: HX-003..HX-006 (HX-007 is held out).
  const partial = await evaluatePrescreen(input([
    camp("p1", AT(10), [
      ...pre("HX-003", true, true),
      ...pre("HX-004", true, true),
      ...pre("HX-005", true, false),
      ...pre("HX-002", true, true),
    ]),
  ]));
  assertEquals(partial.problems, []);
  assertEquals(partial.audits.get(W6), null);
  assertEquals(partial.provisional, new Set());
  // Rejects and unverdicted candidates wait; the eligible one goes to the full screen.
  assertEquals(partial.waiting, new Set(["HX-003", "HX-004", "HX-006"]));
  // The calibration round never filters.
  assertEquals(partial.audits.has(W5), false);

  const done = await evaluatePrescreen(input([
    camp("p1", AT(10), [
      ...pre("HX-003", true, true),
      ...pre("HX-004", true, true),
      ...pre("HX-005", true, false),
      ...pre("HX-002", true, true),
    ]),
    camp("p2", AT(11), pre("HX-006", true, true)),
  ]));
  assertEquals(done.problems, []);
  const rejects = ["HX-003", "HX-004", "HX-006"];
  const want = await auditSample(
    "seed-w6",
    ["HX-003", "HX-004", "HX-005", "HX-006"],
    done.verdicts,
  );
  assertEquals(done.audits.get(W6), want);
  assertEquals(want!.rejects, rejects);
  assertEquals(want!.audited.length, 1);
  assertEquals(
    done.provisional,
    new Set(rejects.filter((id) => !want!.audited.includes(id))),
  );
  assertEquals(done.waiting, new Set());
  assertEquals(done.rounds.get("HX-002"), { seal: W5, mode: "calibration" });
});
