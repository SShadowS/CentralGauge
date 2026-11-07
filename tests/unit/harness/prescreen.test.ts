// H-68: the screening pre-screen (design note H-68, decision
// 2026-11-06-m8-wave2-round0-and-prescreen). Pure logic, plus one spawn of
// each CLI in a temp dir; nothing read from the coordination share.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
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
  prescreenReport,
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

Deno.test("prescreenVerdict: both arms scored and passing is provisionally saturated; a finished attempt otherwise is eligible; an unfinished one is pending", () => {
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
    // H-68 r1: live (pending) or not started (unrun) is no verdict yet,
    // even beside a finished failure
    cell("HX-007", PLAIN, true),
    cell("HX-007", LSP, null, 1, "pending"),
    // repeat 2 is never read: a pre-screen is repeat 1 only
    ...pre("HX-008", true, true),
    cell("HX-008", LSP, false, 2),
    cell("HX-009", PLAIN, true, 2),
    cell("HX-009", LSP, true, 2),
    cell("HX-010", PLAIN, true),
    cell("HX-010", LSP, null, 1, "unrun"),
    cell("HX-011", PLAIN, false),
    cell("HX-011", LSP, null, 1, "pending"),
    cell("HX-012", PLAIN, true),
    cell("HX-012", LSP, null, 2, "pending"),
  ], RULES);
  assertEquals(Object.fromEntries(v), {
    "HX-001": "provisionally_saturated",
    "HX-002": "eligible",
    "HX-003": "eligible",
    "HX-004": "eligible",
    "HX-005": "eligible",
    "HX-006": "eligible",
    "HX-007": "pending",
    "HX-008": "provisionally_saturated",
    "HX-009": "eligible",
    "HX-010": "pending",
    "HX-011": "pending",
    "HX-012": "eligible",
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
    broken: 0,
    table: {
      provisionally_saturated: {
        saturated: 2,
        other: 1,
        pending: 1,
        broken: 0,
      },
      eligible: { saturated: 1, other: 1, pending: 1, broken: 0 },
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

// ---- H-68 Sol self-check r1.

/** w6 filter candidates HX-003..HX-006 all pre-screened (HX-007 is held out). */
const filterCells = (hx006: Cell[]): Cell[] => [
  ...pre("HX-003", true, true),
  ...pre("HX-004", true, true),
  ...pre("HX-005", true, false),
  ...pre("HX-002", true, true),
  ...hx006,
];

Deno.test("r1 audit: a live or unrun attempt is no verdict, so a running campaign cannot finalize the sample", async () => {
  const ps = new Map([
    ["HX-101", "provisionally_saturated" as const],
    ["HX-102", "pending" as const],
  ]);
  assertEquals(await auditSample("s", ["HX-101", "HX-102"], ps), null);
  for (const status of ["pending", "unrun"] as const) {
    const live = await evaluatePrescreen(input([
      camp(
        "p1",
        AT(10),
        filterCells([
          cell("HX-006", PLAIN, true),
          cell("HX-006", LSP, null, 1, status),
        ]),
      ),
    ]));
    assertEquals(live.problems, []);
    assertEquals(live.verdicts.get("HX-006"), "pending");
    assertEquals(live.audits.get(W6), null, status);
    assertEquals(live.provisional, new Set());
    assertEquals(live.waiting, new Set(["HX-003", "HX-004", "HX-006"]));
  }
  // The same attempt, finished, draws the sample.
  const done = await evaluatePrescreen(input([
    camp("p1", AT(10), filterCells(pre("HX-006", true, true))),
  ]));
  // run 002 item 5: the exact audit, never just "not null" (undefined passes that).
  const w6 = ["HX-003", "HX-004", "HX-005", "HX-006"];
  assertEquals(
    done.audits.get(W6),
    await auditSample("seed-w6", w6, done.verdicts),
  );
  assertEquals(done.audits.get(W6)!.rejects, ["HX-003", "HX-004", "HX-006"]);
  assertEquals(done.audits.get(W6)!.audited.length, 1);
});

Deno.test("r1 falseKill: a pending pre-screen is not counted", () => {
  const fk = falseKill(
    ["HX-001", "HX-002"],
    new Map([
      ["HX-001", "pending" as const],
      ["HX-002", "provisionally_saturated" as const],
    ]),
    new Map<string, Status>([["HX-001", "intermediate"], [
      "HX-002",
      "saturated",
    ]]),
  );
  assertEquals([fk.k, fk.n, fk.pending], [0, 1, 0]);
});

Deno.test("r1 calibration coverage: every non-held-out candidate of a calibration seal needs a finished pre-screen before select", async () => {
  // w5 (calibration) holds HX-002.
  const none = await evaluatePrescreen(input([]));
  assertEquals(none.problems, []);
  assertEquals(none.missing, new Set(["HX-002"]));
  // r2: missing blocks select only; the full screen may run first.
  assert(!none.waiting.has("HX-002"));
  const live = await evaluatePrescreen(input([
    camp("p1", AT(10), [
      cell("HX-002", PLAIN, true),
      cell("HX-002", LSP, null, 1, "pending"),
    ]),
  ]));
  assertEquals(live.missing, new Set(["HX-002"]));
  const done = await evaluatePrescreen(input([
    camp("p1", AT(10), pre("HX-002", false, false)),
  ]));
  assertEquals(done.missing, new Set());
  assert(!done.waiting.has("HX-002"));
  // A held-out candidate of a calibration seal is never missing.
  const held = await evaluatePrescreen(input([], { heldOut: ["HX-002"] }));
  assertEquals(held.missing, new Set());
});

/** w6's own registry with these rounds; w5's has none (r2: no real calibration). */
const withW6Rounds = (rounds: Round[]): SealView[] =>
  SEALS.map((s) =>
    s.tag === W6
      ? { ...s, screening: S(s.screening.candidates.map((c) => c.id), rounds) }
      : s.tag === W5
      ? { ...s, screening: S(s.screening.candidates.map((c) => c.id)) }
      : s
  );

Deno.test("r1 fictitious calibration: a filter round needs an earlier calibration round on a seal of the ledger", async () => {
  const ghost = "harness-v2-screen-ghost";
  for (
    const rounds of [
      // a calibration entry naming a seal that does not exist
      [{ seal: ghost, mode: "calibration" as const }, FIL6],
      // a real calibration seal that comes after the filter seal
      [{ seal: W7, mode: "calibration" as const }, FIL6],
    ]
  ) {
    const seals = withW6Rounds(rounds);
    const now = S([...ALL, "HX-010"], rounds);
    assertEquals(roundOf("HX-003", seals), {
      ok: false,
      problem:
        `${W6}: a filter round needs an earlier calibration round on a sealed seal`,
    });
    const r = await evaluatePrescreen(input([
      camp("p1", AT(10), filterCells(pre("HX-006", true, true))),
    ], { seals, now }));
    assertEquals(r.audits.size, 0);
    assertEquals(r.provisional, new Set());
    assert(
      r.problems.includes(
        `${W6}: a filter round needs an earlier calibration round on a sealed seal`,
      ),
      r.problems.join("\n"),
    );
  }
  // The real ledger (calibration at w5 before w6) is valid.
  assertEquals(roundOf("HX-003", SEALS), {
    ok: true,
    seal: W6,
    mode: "filter",
  });
});

/** A cell as the loader builds it: `first` is its first execution attempt's outcome. */
const at1 = (
  c: Cell,
  first: "pass" | "fail" | "live",
  extra: { attempts?: number; manual_reruns?: number } = {},
) => ({ ...c, first, manual_reruns: 0, ...extra });

Deno.test("r3 first attempt: the verdict reads each cell's first execution attempt only; an automatic retry never changes it and is no problem", async () => {
  assertEquals(
    Object.fromEntries(prescreenVerdict([
      // first attempt passed; a later attempt (whatever it says) is ignored
      at1(cell("HX-002", PLAIN, true), "pass"),
      at1(cell("HX-002", LSP, false), "pass", { attempts: 2 }),
      // first attempt crashed (infra), the automatic retry passed: eligible
      at1(cell("HX-003", PLAIN, true), "pass"),
      at1(cell("HX-003", LSP, true), "fail", { attempts: 2 }),
      // the automatic retry is still running: the first attempt decided
      at1(cell("HX-004", PLAIN, true), "pass"),
      at1(cell("HX-004", LSP, null, 1, "pending"), "fail", { attempts: 2 }),
      // the first attempt itself is still live
      at1(cell("HX-005", PLAIN, true), "pass"),
      at1(cell("HX-005", LSP, null, 1, "pending"), "live"),
    ], RULES)),
    {
      "HX-002": "provisionally_saturated",
      "HX-003": "eligible",
      "HX-004": "eligible",
      "HX-005": "pending",
    },
  );
  const r = await evaluatePrescreen(input([
    camp("p1", AT(10), [
      at1(cell("HX-002", PLAIN, true), "pass"),
      at1(cell("HX-002", LSP, true), "fail", { attempts: 2 }),
    ]),
  ]));
  assertEquals(r.problems, []);
  assertEquals(r.verdicts.get("HX-002"), "eligible");
  assertEquals(r.retried, new Set(["HX-002"]));
  // A calibration candidate with a retried pre-screen is covered (finished).
  assertEquals(r.missing, new Set());
  const ok = prescreenReport([], new Map<string, Status>(), r);
  assert(
    ok.out.includes(
      "retried pre-screen (first attempt not scored) -> eligible: HX-002",
    ),
    ok.out.join("\n"),
  );
  const twice = (pass: boolean | null, status?: Cell["status"]) => ({
    ...cell("HX-002", LSP, pass, 1, status),
    attempts: 2,
  });
  // A duplicate pre-screen campaign stays a problem.
  const dup = await evaluatePrescreen(input([
    camp("p1", AT(10), [cell("HX-002", PLAIN, true), twice(true)]),
    camp("p2", AT(11), pre("HX-002", true, true)),
  ]));
  assertEquals(dup.problems, [
    "HX-002 pre-screened 2 times (no pre-screen rerun)",
  ]);
});

Deno.test("r2 calibration declared after the fact: the predecessor seal's own registry must declare its calibration round", async () => {
  // Seal w5's frozen registry has no round; w6 appends [w5: calibration, w6: filter].
  const seals = SEALS.map((s) =>
    s.tag === W5
      ? { ...s, screening: S(s.screening.candidates.map((c) => c.id)) }
      : s
  );
  const problem =
    `${W6}: a filter round needs an earlier calibration round on a sealed seal`;
  assertEquals(roundOf("HX-003", seals), { ok: false, problem });
  const r = await evaluatePrescreen(input([
    camp("p1", AT(10), filterCells(pre("HX-006", true, true))),
  ], { seals }));
  assert(r.problems.includes(problem), r.problems.join("\n"));
  assertEquals(r.audits.size, 0);
  assertEquals(r.provisional, new Set());
  // A genuine w5 calibration seal (its own registry declares it) stays valid.
  assertEquals(roundOf("HX-003", SEALS), {
    ok: true,
    seal: W6,
    mode: "filter",
  });
  const ok = await evaluatePrescreen(input([
    camp("p1", AT(10), filterCells(pre("HX-006", true, true))),
  ]));
  assertEquals(ok.problems, []);
  assertEquals(ok.audits.size, 1);
});

Deno.test("r1 Q8: the order is judged against the full screen's completion, not its creation", async () => {
  const full = (completed: string) => [{
    ...camp("f1", AT(5), six("HX-003", 6), "v2-screen-9"),
    completed_at: { "HX-003": completed },
  }];
  const p = [camp("p1", AT(10), pre("HX-003", true, true))];
  // Created before the pre-screen but completed after it: fine.
  assertEquals(
    (await evaluatePrescreen(input(p, { full: full(AT(12)) }))).problems,
    [],
  );
  assertEquals(
    (await evaluatePrescreen(input(p, { full: full(AT(8)) }))).problems,
    [
      "HX-003 pre-screened in v2-prescreen-p1 after a complete full screen in v2-screen-9",
    ],
  );
});

Deno.test("run 003 b: once the full screen was ever complete, a later pre-screen is refused even if a rejudge made the current tally incomplete", async () => {
  // Complete at T1 (AT(5)); an unscored rejudge at T3 leaves a cell pending
  // now; the pre-screen was created at T2 (AT(10)).
  const cells = six("HX-003", 6).map((x, i) =>
    i === 5 ? { ...x, status: "pending" as const, pass: null } : x
  );
  const full = [{
    ...camp("f1", AT(1), cells, "v2-screen-9"),
    completed_at: { "HX-003": AT(5) },
  }];
  const r = await evaluatePrescreen(input([
    camp("p1", AT(10), pre("HX-003", true, true)),
  ], { full }));
  assertEquals(r.problems, [
    "HX-003 pre-screened in v2-prescreen-p1 after a complete full screen in v2-screen-9",
  ]);
  // Never complete before the pre-screen: no refusal.
  const later = await evaluatePrescreen(input([
    camp("p1", AT(10), pre("HX-003", true, true)),
  ], { full: [{ ...full[0]!, completed_at: { "HX-003": AT(12) } }] }));
  assertEquals(later.problems, []);
});

Deno.test("r1 status report: with gate problems it prints them and no false-kill or audit numbers", () => {
  const ps = {
    verdicts: new Map([["HX-002", "provisionally_saturated" as const]]),
    rounds: new Map([["HX-002", CAL5]]),
    audits: new Map(),
    provisional: new Set<string>(),
    waiting: new Set<string>(),
    missing: new Set<string>(),
    retried: new Set<string>(),
    problems: [],
  };
  const status = new Map<string, Status>([["HX-002", "saturated"]]);
  const bad = prescreenReport(
    ["HX-002 screened 3 times (at most one rescreen)"],
    status,
    ps,
  );
  assertEquals(bad.ok, false);
  assertEquals(bad.err, ["HX-002 screened 3 times (at most one rescreen)"]);
  assertEquals(bad.out, []);
  const good = prescreenReport([], status, ps);
  assertEquals(good.ok, true);
  assert(
    good.out.includes(
      "calibration false-kill: 0/1 (pending 0), missing pre-screen: 0",
    ),
  );
});

Deno.test("r1 CLIs: screening.ts and prescreen.ts load as entry points and exit (no module cycle hang)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const run = async (script: string, args: string[]) => {
      const out = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-all",
          fromFileUrl(new URL(script, import.meta.url)),
          ...args,
        ],
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(60_000),
      }).output();
      return { code: out.code, err: new TextDecoder().decode(out.stderr) };
    };
    const pre = await run("../../../scripts/harness/prescreen.ts", []);
    assertEquals(pre.code, 1);
    assert(pre.err.includes("usage: prescreen.ts status"), pre.err);
    // Outside a git repository both fail fast on git, never on module load.
    for (const script of ["screening.ts", "prescreen.ts"]) {
      const r = await run(`../../../scripts/harness/${script}`, ["status"]);
      assertNotEquals(r.code, 0);
      assert(!/ReferenceError|before initialization/.test(r.err), r.err);
      assert(r.err.includes("git "), r.err);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const W8 = "harness-v2-screen-w8";
const SIX = ["HX-101", "HX-102", "HX-103", "HX-104", "HX-105", "HX-106"];
const FIL8: Round = { seal: W8, mode: "filter" };
/** start (HX-001), w5 calibration (HX-002), w8 filter (six candidates). */
const SEALS8: SealView[] = [
  { tag: START, seed: "seed-start", screening: S(["HX-001"]) },
  { tag: W5, seed: "seed-w5", screening: S(["HX-001", "HX-002"], [CAL5]) },
  {
    tag: W8,
    seed: "seed-w8",
    screening: S(["HX-001", "HX-002", ...SIX], [CAL5, FIL8]),
  },
];
const input8 = (cells: Cell[]) => ({
  now: S(["HX-001", "HX-002", ...SIX], [CAL5, FIL8]),
  seals: SEALS8,
  heldOut: [],
  prescreens: [camp("p1", AT(10), cells)],
  full: [],
});
/** The six w8 candidates in audit-rank order (A lowest .. F highest). */
const auditOrder = async () =>
  [...await ranks("seed-w8:prescreen-audit", SIX)].sort(([, a], [, b]) =>
    a < b ? -1 : 1
  ).map(([id]) => id);
const passing = (id: string) => [
  at1(cell(id, PLAIN, true), "pass"),
  at1(cell(id, LSP, true), "pass"),
];

Deno.test("r3 manual rerun: a manually rerun pre-screen cell is refused, scored or not; it cannot steer the audit", async () => {
  const order = await auditOrder();
  const [a, b, , , , f] = order;
  const base = [...pre("HX-002", false, false), ...SIX.flatMap(passing)];
  const ok = await evaluatePrescreen(input8(base));
  assertEquals(ok.problems, []);
  assertEquals(ok.audits.get(W8), { rejects: SIX, audited: [a!, b!].sort() });

  // A manual rerun of F (whatever its replacement says) is a visible refusal.
  for (const pass of [false, null]) {
    const rerun = base.map((c) =>
      c.task === f && c.arm === LSP
        ? at1(cell(f!, LSP, pass), "pass", { attempts: 2, manual_reruns: 1 })
        : c
    );
    const r = await evaluatePrescreen(input8(rerun));
    assertEquals(r.problems, [
      `pre-screen cell ${f}/1/${LSP} was manually rerun (no pre-screen rerun)`,
    ]);
    // Its first attempt passed, so F stays a reject: R and the audit hold.
    assertEquals(r.audits.get(W8), { rejects: SIX, audited: [a!, b!].sort() });
  }

  // An automatic retry on a cell whose first attempt passed changes nothing.
  const auto = base.map((c) =>
    c.task === f && c.arm === LSP
      ? at1(cell(f!, LSP, false), "pass", { attempts: 2 })
      : c
  );
  const r = await evaluatePrescreen(input8(auto));
  assertEquals(r.problems, []);
  assertEquals(r.verdicts.get(f!), "provisionally_saturated");
  assertEquals(r.audits.get(W8), { rejects: SIX, audited: [a!, b!].sort() });
});

Deno.test("r5 first-judgment problems from the loader are pre-screen problems", async () => {
  const r = await evaluatePrescreen(input([{
    ...camp("p1", AT(10), pre("HX-002", true, true)),
    first_problems: ["judgment j1 ends before its execution"],
  }]));
  assertEquals(r.problems, ["judgment j1 ends before its execution"]);
});

Deno.test("run 002 item 2: round 1 is calibration, every later round is filter; a mode-only edit to a sealed round is refused", () => {
  const parses = (rounds: Round[]) =>
    ScreeningSchema.safeParse({
      v: 1,
      rules: RULES,
      candidates: [],
      amendments: [{ id: "prescreen", decision: DECISION, rounds }],
    }).success;
  assert(parses([CAL5, FIL6]));
  assert(
    !parses([CAL5, { seal: W6, mode: "calibration" }]),
    "a calibration round after round 1",
  );
  assert(
    !parses([CAL5, FIL6, { seal: W7, mode: "calibration" }]),
    "a calibration round as round 3",
  );
  // A mode-only edit of a sealed round (built without the schema, which
  // would already refuse it) is an amendment change.
  const sealed = S(ALL, [CAL5, FIL6]);
  const edited: Screening = {
    ...sealed,
    amendments: [{
      id: "prescreen",
      decision: DECISION,
      rounds: [CAL5, { seal: W6, mode: "calibration" }],
    }],
  };
  assertEquals(amendmentProblems(W6, sealed, edited), [
    `prescreen amendment changed after ${W6} (rounds may only be appended)`,
  ]);
});

Deno.test("run 002 item 3: a broken candidate is a separate 'broken, never resolvable' FK line, never pending", () => {
  const verdicts = new Map([
    ["HX-001", "provisionally_saturated" as const],
    ["HX-002", "provisionally_saturated" as const],
    ["HX-003", "eligible" as const],
  ]);
  const status = new Map<string, Status>([
    ["HX-001", "saturated"],
    ["HX-002", "broken"],
    ["HX-003", "broken"],
  ]);
  const fk = falseKill(["HX-001", "HX-002", "HX-003"], verdicts, status);
  assertEquals(fk, {
    k: 0,
    n: 1,
    pending: 0,
    broken: 1,
    table: {
      provisionally_saturated: {
        saturated: 1,
        other: 0,
        pending: 0,
        broken: 1,
      },
      eligible: { saturated: 0, other: 0, pending: 0, broken: 1 },
    },
  });
  const ps = {
    verdicts,
    rounds: new Map([
      ["HX-001", CAL5],
      ["HX-002", CAL5],
      ["HX-003", CAL5],
    ]),
    audits: new Map(),
    provisional: new Set<string>(),
    waiting: new Set<string>(),
    missing: new Set<string>(),
    retried: new Set<string>(),
    problems: [],
  };
  const out = prescreenReport([], status, ps).out;
  assert(
    out.includes(
      "calibration false-kill: 0/1 (pending 0), missing pre-screen: 0",
    ),
    out.join("\n"),
  );
  assert(out.includes("  broken, never resolvable: 2"), out.join("\n"));
});
