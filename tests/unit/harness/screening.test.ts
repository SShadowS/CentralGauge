import { assert, assertEquals, assertThrows } from "@std/assert";
import type { Cell } from "../../../src/harness/stats.ts";
import { ValidationError } from "../../../src/errors.ts";
import { readYaml } from "../../../src/harness/yaml.ts";
import {
  appendOnlyProblems,
  type Candidate,
  chronologyProblems,
  classify,
  contaminationProblems,
  type Eligible,
  entryHash,
  excludeCrashCells,
  excludedLines,
  identityProblems,
  isLarge,
  type Kind,
  ledgerProblems,
  pickHeldOut,
  ranks,
  REGISTRY_PATH,
  rescreenTasks,
  type Rules,
  RulesSchema,
  type Screening,
  screeningHistory,
  ScreeningSchema,
  type SealEntry,
  SealsSchema,
  seedOf,
  select,
  type Status,
  type Stratum,
  stratumOf,
  supersedeProblems,
  tally,
  targets,
  tasksGlob,
  treeProblems,
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

const C = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  prior: "intermediate",
  size: { objects: 3, files: 2, reuse: null, traces: null },
  supersedes: null,
  broken: null,
  ...extra,
});
const S = (candidates: Candidate[], rules: Rules = RULES): Screening =>
  ScreeningSchema.parse({ v: 1, rules, candidates });

const cell = (
  task: string,
  arm: string,
  repeat: number,
  pass: boolean | null,
): Cell => ({
  task,
  arm,
  repeat,
  status: pass === null ? "pending" : "scored",
  pass,
  spend_usd: 0,
  known_spend_usd: 0,
  attempts: 1,
});
const six = (task: string, solved: number): Cell[] =>
  [0, 1, 2, 3, 4, 5].map((i) =>
    cell(task, RULES.arms[i % 2]!, Math.floor(i / 2) + 1, i < solved)
  );
const incomplete = (task: string): Cell[] => [
  ...six(task, 0).slice(0, 5),
  cell(task, RULES.arms[1], 3, null),
];

const E = (
  id: string,
  stratum: Stratum,
  kind: Kind,
  extra: Partial<Eligible> = {},
): Eligible => ({ id, stratum, kind, coupling: [], large: false, ...extra });
const rankOf = (pool: { id: string }[]) =>
  new Map(pool.map((e, i) => [e.id, String(i).padStart(4, "0")]));
const KINDS4: Kind[] = ["feature", "bugfix", "refactor", "test-authoring"];

/** HX-101..110 intermediate, 111..114 easy, 115..118 hard; kinds cycle by id. */
function basePool(): Eligible[] {
  const out: Eligible[] = [];
  let n = 100;
  const add = (stratum: Stratum, count: number) => {
    for (let i = 0; i < count; i++) {
      n++;
      out.push(E(`HX-${n}`, stratum, KINDS4[n % 4]!, { large: n % 2 === 0 }));
    }
  };
  add("intermediate", 10);
  add("easy", 4);
  add("hard", 4);
  out[0]!.coupling = ["single-instance"];
  out[1]!.coupling = ["temporary-table"];
  out[10]!.coupling = ["commit-behavior"];
  return out;
}
const loose = (extra: Partial<Rules> = {}): Rules => ({
  ...RULES,
  kind_min: 0,
  required_coupling: ["single-instance"],
  large_min_share: 0,
  ...extra,
});

Deno.test("committed registry: rules are the pre-registered values", async () => {
  const s = await readYaml(REGISTRY_PATH, ScreeningSchema);
  assertEquals(s.rules, RULES);
});

Deno.test("targets: easy and hard round half up, the rest intermediate", () => {
  assertEquals(targets(24, RULES), { easy: 5, intermediate: 14, hard: 5 });
  assertEquals(targets(30, RULES), { easy: 6, intermediate: 18, hard: 6 });
  assertEquals(targets(40, RULES), { easy: 8, intermediate: 24, hard: 8 });
});

Deno.test("stratumOf: exact boundaries on six pooled cells", () => {
  assertEquals([0, 1, 2, 3, 4, 5, 6].map((s) => stratumOf(s, 6)), [
    "dead",
    "hard",
    "intermediate",
    "intermediate",
    "intermediate",
    "easy",
    "saturated",
  ]);
});

Deno.test("tally pools both arms; a pending cell makes the task incomplete, never a fail", () => {
  const t = tally([...six("HX-007", 4), ...incomplete("HX-008")], RULES);
  assertEquals(t.get("HX-007"), { solved: 4, scored: 6, complete: true });
  assertEquals(t.get("HX-008"), { solved: 0, scored: 5, complete: false });
  const sealed = new Set(["HX-007", "HX-008"]);
  const st = classify(
    S([C("HX-007"), C("HX-008")]),
    sealed,
    [],
    t,
    new Map([["HX-007", 1], ["HX-008", 1]]),
  );
  assertEquals(st.get("HX-007"), "intermediate");
  assertEquals(st.get("HX-008"), "incomplete");
  assertEquals(
    classify(S([C("HX-008")]), sealed, [], t, new Map([["HX-008", 2]])).get(
      "HX-008",
    ),
    "unscreenable",
  );
});

Deno.test("tally refuses a cell of a foreign arm", () => {
  assertThrows(
    () => tally([cell("HX-007", "cc-v2-mcp", 1, true)], RULES),
    ValidationError,
    "not a screening arm",
  );
});

Deno.test("classify: held-out, broken and unsealed win over any tally", () => {
  const done = { solved: 3, scored: 6, complete: true };
  const st = classify(
    S([
      C("HX-007"),
      C("HX-008", { broken: "decisions/x.md" }),
      C("HX-009"),
      C("HX-010"),
    ]),
    new Set(["HX-007", "HX-008", "HX-009"]),
    ["HX-007"],
    new Map([["HX-007", done], ["HX-008", done], ["HX-010", done]]),
    new Map(),
  );
  assertEquals([...st.values()], [
    "held_out",
    "broken",
    "unscreened",
    "unsealed",
  ]);
});

Deno.test("contaminationProblems: a screened held-out, unsealed or unknown task is refused", () => {
  const st = new Map<string, Status>([
    ["HX-007", "held_out"],
    ["HX-008", "unsealed"],
    ["HX-009", "intermediate"],
  ]);
  assertEquals(
    contaminationProblems(st, ["HX-007", "HX-008", "HX-009", "HX-099"]),
    [
      "HX-007 is held out but was screened",
      "HX-008 was screened before it was sealed",
      "HX-099 was screened but is not a registry candidate",
    ],
  );
});

Deno.test("screeningHistory: one rescreen of an incomplete task replaces its cells", () => {
  const h = screeningHistory([
    {
      id: "c2",
      experiment: "v2-screen-2",
      created_at: "2026-10-27T00:00:00Z",
      cells: six("HX-008", 3),
    },
    {
      id: "c1",
      experiment: "v2-screen-1",
      created_at: "2026-10-25T00:00:00Z",
      cells: [...six("HX-007", 2), ...incomplete("HX-008")],
    },
  ], RULES);
  assertEquals(h.problems, []);
  assertEquals(h.screens, new Map([["HX-007", 1], ["HX-008", 2]]));
  assertEquals(tally(h.cells, RULES).get("HX-008")!.solved, 3);
});

Deno.test("screeningHistory: selective reruns are refused", () => {
  const at = (d: number) => `2026-10-2${d}T00:00:00Z`;
  const h = screeningHistory([
    {
      id: "c1",
      experiment: "v2-screen-1",
      created_at: at(1),
      cells: [...six("HX-007", 0), ...incomplete("HX-008")],
    },
    {
      id: "c2",
      experiment: "v2-screen-1",
      created_at: at(2),
      cells: six("HX-007", 3),
    },
    {
      id: "c3",
      experiment: "v2-screen-2",
      created_at: at(3),
      cells: incomplete("HX-008"),
    },
    {
      id: "c4",
      experiment: "v2-screen-3",
      created_at: at(4),
      cells: six("HX-008", 3),
    },
    { id: "c4", experiment: "v2-screen-4", created_at: at(5), cells: [] },
  ], RULES);
  assertEquals(h.problems, [
    "duplicate campaign id",
    "experiment v2-screen-1 has more than one campaign",
    "HX-007 rescreened in v2-screen-1 after a complete screen",
    "HX-008 screened 3 times (at most one rescreen)",
  ]);
});

Deno.test("ScreeningSchema refuses duplicate ids and an unknown supersedes", () => {
  assert(
    !ScreeningSchema.safeParse({
      v: 1,
      rules: RULES,
      candidates: [C("HX-007"), C("HX-007")],
    }).success,
  );
  assert(
    !ScreeningSchema.safeParse({
      v: 1,
      rules: RULES,
      candidates: [C("HX-008", { supersedes: "HX-099" })],
    }).success,
  );
});

const SEAL0: SealEntry = {
  tag: "harness-v2-screen-start",
  tag_object: "1".repeat(40),
  commit: "2".repeat(40),
  pushed_at: "2026-10-21T10:00:00Z",
  drand_chain: "c".repeat(64),
  drand_round: 100,
  round_time: "2026-10-21T10:10:30Z",
  randomness: "a".repeat(64),
  prev: "genesis",
};
const sealW4 = async (prev: SealEntry): Promise<SealEntry> => ({
  ...SEAL0,
  tag: "harness-v2-screen-w4",
  tag_object: "3".repeat(40),
  commit: "4".repeat(40),
  pushed_at: "2026-10-27T10:00:00Z",
  drand_round: 300,
  round_time: "2026-10-27T10:10:30Z",
  randomness: "b".repeat(64),
  prev: await entryHash(prev),
});

Deno.test("SealsSchema: the start seal comes first; randomness is 64 hex; ledger tags are not seals", () => {
  assert(SealsSchema.safeParse({ v: 2, seals: [SEAL0] }).success);
  assert(
    !SealsSchema.safeParse({
      v: 2,
      seals: [{ ...SEAL0, tag: "harness-v2-screen-w4" }],
    }).success,
  );
  assert(
    !SealsSchema.safeParse({ v: 2, seals: [{ ...SEAL0, randomness: "x" }] })
      .success,
  );
  assert(
    !SealsSchema.safeParse({
      v: 2,
      seals: [SEAL0, { ...SEAL0, tag: "harness-v2-screen-start-ledger" }],
    }).success,
  );
  assert(
    !SealsSchema.safeParse({
      v: 2,
      seals: [{ ...SEAL0, round_time: "2026-10-21T10:05:00Z" }],
    }).success,
    "the round must be at least 10 minutes after the push",
  );
  assertEquals(seedOf("abc", SEAL0.randomness), `abc:${SEAL0.randomness}`);
});

Deno.test("ledgerProblems: the seal ledger is append-only, hash-chained and anchored by its tags", async () => {
  const w4 = await sealW4(SEAL0);
  const anchors = (head: SealEntry[]) => ({
    refs: new Map(
      head.map((e) => [e.tag, { tag_object: e.tag_object, commit: e.commit }]),
    ),
    atSeal: new Map<string, SealEntry[] | null>([[SEAL0.tag, null], [w4.tag, [
      SEAL0,
    ]]]),
    atLedger: new Map<string, SealEntry[] | null>([[SEAL0.tag, [SEAL0]], [
      w4.tag,
      [SEAL0, w4],
    ]]),
    published: new Map<string, SealEntry[] | null>([
      [`${SEAL0.tag}-ledger`, [SEAL0]],
      [`${w4.tag}-ledger`, [SEAL0, w4]],
    ]),
  });
  assertEquals(await ledgerProblems([SEAL0, w4], anchors([SEAL0, w4])), []);
  // Round 3: truncation. Both ledger tags are published, HEAD drops w4 to re-seal
  // its candidates under a new beacon. Must be refused.
  const p0 = await ledgerProblems([SEAL0], anchors([SEAL0, w4]));
  assert(
    p0.includes(
      "harness-v2-screen-w4: published harness-v2-screen-w4-ledger but the HEAD ledger has no harness-v2-screen-w4 entry",
    ),
    p0.join("\n"),
  );
  assert(
    p0.includes(
      "harness-v2-screen-w4-ledger: HEAD ledger does not extend the ledger committed at harness-v2-screen-w4-ledger",
    ),
    p0.join("\n"),
  );
  // An earlier entry rewritten at HEAD (randomness ground after the fact).
  const forged = { ...SEAL0, randomness: "f".repeat(64) };
  const p1 = await ledgerProblems([forged, w4], anchors([SEAL0, w4]));
  assert(
    p1.includes("harness-v2-screen-w4: prev does not hash the entry before it"),
    p1.join("\n"),
  );
  assert(
    p1.includes(
      "harness-v2-screen-start: entry differs from harness-v2-screen-start-ledger",
    ),
    p1.join("\n"),
  );
  // Rewritten AND re-chained: the ledger tags still hold the original bytes.
  const rechained = await sealW4(forged);
  const p2 = await ledgerProblems([forged, rechained], anchors([SEAL0, w4]));
  assert(
    p2.includes(
      "harness-v2-screen-start: entry differs from harness-v2-screen-start-ledger",
    ),
    p2.join("\n"),
  );
  assert(
    p2.includes(
      "harness-v2-screen-w4: ledger before it differs from the one committed at harness-v2-screen-w4",
    ),
    p2.join("\n"),
  );
  // A moved seal tag, and an entry without its ledger tag.
  const moved = anchors([SEAL0, w4]);
  moved.refs.set(w4.tag, { tag_object: w4.tag_object, commit: "9".repeat(40) });
  moved.atLedger.set(w4.tag, null);
  const p3 = await ledgerProblems([SEAL0, w4], moved);
  assert(
    p3.includes(
      "harness-v2-screen-w4: tag does not resolve to the recorded tag object and commit",
    ),
    p3.join("\n"),
  );
  assert(
    p3.includes("harness-v2-screen-w4: no harness-v2-screen-w4-ledger tag"),
    p3.join("\n"),
  );
});

Deno.test("chronologyProblems: a campaign created before its tasks' seal beacon is refused", () => {
  const first = new Map([["HX-007", SEAL0.round_time], [
    "HX-043",
    "2026-10-27T10:10:30Z",
  ]]);
  assertEquals(
    chronologyProblems([{
      id: "c1",
      created_at: "2026-10-25T08:00:00Z",
      tasks: ["HX-007"],
    }], first),
    [],
  );
  assertEquals(
    chronologyProblems([{
      id: "c2",
      created_at: "2026-10-25T08:00:00Z",
      tasks: ["HX-007", "HX-043"],
    }], first),
    ["campaign c2 (2026-10-25T08:00:00Z) ran HX-043 before its seal beacon (2026-10-27T10:10:30Z)"],
  );
  assertEquals(
    chronologyProblems([{
      id: "c3",
      created_at: "2026-10-25T08:00:00Z",
      tasks: ["HX-099"],
    }], first),
    ["campaign c3 ran HX-099, which no seal holds"],
  );
});

Deno.test("appendOnlyProblems: only appends and broken are allowed after a seal", () => {
  const sealed = S([C("HX-007"), C("HX-008")]);
  assertEquals(
    appendOnlyProblems(
      "harness-v2-screen-start",
      sealed,
      S([C("HX-007", { broken: "decisions/b.md" }), C("HX-008"), C("HX-009")]),
    ),
    [],
  );
  assertEquals(
    appendOnlyProblems(
      "harness-v2-screen-start",
      sealed,
      S([C("HX-007", { prior: "hard" })], { ...RULES, kind_min: 1 }),
    ),
    [
      "rules changed after harness-v2-screen-start",
      "HX-007 changed after harness-v2-screen-start (only broken may be set)",
      "HX-008 removed after harness-v2-screen-start",
    ],
  );
});

Deno.test("treeProblems and identityProblems bind tasks and campaigns to the sealed contents", () => {
  assertEquals(
    treeProblems(
      "harness-v2-screen-w4",
      new Map([["HX-043", "t1"], ["HX-044", "t2"]]),
      new Map([["HX-043", "t1"], ["HX-044", "t9"]]),
    ),
    ["HX-044 task folder changed after harness-v2-screen-w4"],
  );
  const id = (v: string) => ({
    id: "HX-007",
    refapp_commit: "c",
    visible: v.repeat(64),
    oracle: "b".repeat(64),
  });
  assertEquals(identityProblems("c1", [id("a")], [id("a")]), []);
  assertEquals(identityProblems("c1", [id("a")], [id("c")]), [
    "HX-007: campaign c1 ran other task contents",
  ]);
});

Deno.test("supersedeProblems: a redesign may replace only a dead, saturated or broken candidate", () => {
  const s = S([
    C("HX-007"),
    C("HX-008"),
    C("HX-009", { supersedes: "HX-007" }),
    C("HX-010", { supersedes: "HX-008" }),
  ]);
  const st = new Map<string, Status>([["HX-007", "dead"], [
    "HX-008",
    "intermediate",
  ]]);
  assertEquals(supersedeProblems(s, st), [
    "HX-010 supersedes HX-008, which is intermediate: only a dead, saturated or broken candidate may be redesigned",
  ]);
});

Deno.test("isLarge: objects and files together, or reuse, or traces", () => {
  const sz = (
    objects: number,
    files: number,
    reuse: string | null = null,
    traces: string | null = null,
  ) => isLarge(C("HX-007", { size: { objects, files, reuse, traces } }));
  assertEquals(
    [
      sz(3, 2),
      sz(3, 1),
      sz(2, 2),
      sz(1, 1, "CGR Date Mgt.WorkingDays"),
      sz(1, 1, null, "OnAfterVehicleReturned"),
    ],
    [true, false, false, true, true],
  );
});

Deno.test("ranks: deterministic per seed, different across seeds", async () => {
  const a = await ranks("seed-a", ["HX-007", "HX-008"]);
  assertEquals(a, await ranks("seed-a", ["HX-008", "HX-007"]));
  assert(a.get("HX-007") !== (await ranks("seed-b", ["HX-007"])).get("HX-007"));
  assertEquals(a.get("HX-007")!.length, 64);
});

Deno.test("pickHeldOut: first-ranked per kind when it meets the quotas; a missing kind is refused", () => {
  const m = (id: string, kind: Kind, coupling: string[] = []) => ({
    id,
    kind,
    coupling,
    large: true,
  });
  const meta = [
    m("HX-007", "feature"),
    m("HX-008", "feature", ["single-instance"]),
    m("HX-009", "bugfix", ["temporary-table"]),
    m("HX-010", "refactor", ["commit-behavior"]),
    m("HX-011", "test-authoring"),
  ];
  const rank = new Map([["HX-007", "b"], ["HX-008", "a"], ["HX-009", "c"], [
    "HX-010",
    "d",
  ], ["HX-011", "e"]]);
  assertEquals(pickHeldOut(meta, rank, RULES), [
    "HX-008",
    "HX-009",
    "HX-010",
    "HX-011",
  ]);
  assertThrows(
    () => pickHeldOut(meta.slice(0, 4), rank, RULES),
    ValidationError,
    "test-authoring",
  );
});

Deno.test("pickHeldOut: the odometer moves to the next-ranked set that meets size and every required coupling style", () => {
  const m = (
    id: string,
    kind: Kind,
    large: boolean,
    coupling: string[] = [],
  ) => ({ id, kind, coupling, large });
  const meta = [
    m("HX-007", "feature", false, ["single-instance"]),
    m("HX-008", "bugfix", false, ["commit-behavior"]),
    m("HX-009", "refactor", true, ["temporary-table"]),
    m("HX-010", "test-authoring", false),
    m("HX-011", "test-authoring", true),
  ];
  const rank = new Map(meta.map((x, i) => [x.id, String(i)]));
  assertEquals(pickHeldOut(meta, rank, RULES), [
    "HX-007",
    "HX-008",
    "HX-009",
    "HX-011",
  ]);
  assertThrows(
    () => pickHeldOut(meta.slice(0, 4), rank, RULES),
    ValidationError,
    "no held-out set meets the quotas",
  );
});

Deno.test("select: fills every stratum and quota, pinned ids", () => {
  const pool = basePool();
  const sel = select(pool, 10, RULES, rankOf(pool));
  assertEquals(sel.selected, [
    "HX-101",
    "HX-102",
    "HX-104",
    "HX-105",
    "HX-106",
    "HX-108",
    "HX-111",
    "HX-112",
    "HX-115",
    "HX-116",
  ]);
  assertEquals(sel.by_stratum.easy, ["HX-111", "HX-112"]);
  assertEquals(sel.by_stratum.hard, ["HX-115", "HX-116"]);
  assertEquals(sel.deviations, []);
  assertEquals(sel.shortfalls, []);
});

Deno.test("select: input order never changes the result", () => {
  const pool = basePool();
  const rank = rankOf(pool);
  assertEquals(
    select([...pool].reverse(), 10, RULES, rank),
    select(pool, 10, RULES, rank),
  );
});

Deno.test("select: the kind cap holds", () => {
  const pool = [
    ...["HX-201", "HX-202", "HX-203", "HX-204", "HX-205", "HX-206"].map((id) =>
      E(id, "intermediate", "feature")
    ),
    E("HX-207", "intermediate", "bugfix"),
    E("HX-208", "easy", "refactor"),
    E("HX-209", "hard", "refactor"),
  ];
  pool[0]!.coupling = ["single-instance"];
  assertEquals(select(pool, 5, loose(), rankOf(pool)).selected, [
    "HX-201",
    "HX-202",
    "HX-207",
    "HX-208",
    "HX-209",
  ]);
});

Deno.test("select: rank breaks a tie", () => {
  const rules = loose({ kind_max_share: 1 });
  const pool = [
    E("HX-301", "intermediate", "feature", { coupling: ["single-instance"] }),
    E("HX-302", "intermediate", "feature", { coupling: ["single-instance"] }),
  ];
  assertEquals(
    select(pool, 1, rules, new Map([["HX-301", "b"], ["HX-302", "a"]]))
      .selected,
    ["HX-302"],
  );
  assertEquals(
    select(pool, 1, rules, new Map([["HX-301", "a"], ["HX-302", "b"]]))
      .selected,
    ["HX-301"],
  );
});

Deno.test("select: a short stratum borrows from intermediate and records it", () => {
  const pool = [
    ...basePool().filter((e) => e.stratum === "intermediate"),
    E("HX-111", "easy", "feature"),
  ];
  const sel = select(pool, 5, loose(), rankOf(pool));
  assertEquals(sel.selected, [
    "HX-101",
    "HX-102",
    "HX-103",
    "HX-104",
    "HX-111",
  ]);
  assertEquals(sel.by_stratum.hard, ["HX-104"]);
  assertEquals(sel.deviations, [
    "HX-104 (intermediate) fills the hard stratum",
  ]);
  assertEquals(sel.shortfalls, []);
});

Deno.test("select: quotas are judged on the final set, after borrowing", () => {
  // Easy-large candidates exceed easy capacity, intermediate is empty,
  // hard-small fill hard; borrowing easy into intermediate meets "large".
  const rules = loose({ kind_max_share: 1, large_min_share: 0.5 });
  const pool = [
    E("HX-401", "easy", "feature", {
      large: true,
      coupling: ["single-instance"],
    }),
    E("HX-402", "easy", "feature", { large: true }),
    E("HX-403", "easy", "feature", { large: true }),
    E("HX-404", "easy", "feature", { large: true }),
    E("HX-405", "hard", "feature"),
    E("HX-406", "hard", "feature"),
  ];
  const sel = select(pool, 5, rules, rankOf(pool));
  assertEquals(sel.selected, [
    "HX-401",
    "HX-402",
    "HX-403",
    "HX-405",
    "HX-406",
  ]);
  assertEquals(sel.deviations, [
    "HX-406 (hard) fills the intermediate stratum",
    "HX-402 (easy) fills the intermediate stratum",
    "HX-403 (easy) fills the intermediate stratum",
  ]);
  assertEquals(sel.shortfalls, []);
});

Deno.test("select: too few candidates is a shortfall, never a smaller set reported as ok", () => {
  const pool = basePool().slice(0, 5);
  const sel = select(pool, 10, RULES, rankOf(pool));
  assert(sel.shortfalls.some((s) => s.startsWith("stratum intermediate")));
  assert(sel.shortfalls.includes("coupling commit-behavior: 0 of 1"));
  assert(sel.selected.length < 10);
});

Deno.test("tasksGlob: exact ids", () => {
  assertEquals(
    tasksGlob(["HX-009", "HX-007"]),
    "harness-tasks/tasks/{HX-007,HX-009}",
  );
  assertEquals(tasksGlob(["HX-007"]), "harness-tasks/tasks/HX-007");
});

// ---- Run 002 (review M8-02-001): history order, and ledger anchors read
// from real git repos with a local bare origin (nothing leaves the machine).

import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import { stringify } from "@std/yaml";
import { loadLedgerAnchors } from "../../../scripts/harness/screening.ts";
import { tempDir } from "./temp-dirs.ts";

const START = "harness-v2-screen-start";

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return new TextDecoder().decode(out.stdout).trim();
}

/** Scratch repo + bare origin: the start seal and its -ledger tag, both pushed. */
async function sealedRepo(opts: { lightweight?: boolean } = {}) {
  const dir = await tempDir({ prefix: "cg-screening-" });
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  await Deno.mkdir(join(repo, "harness-tasks", "tasks", "HX-007"), {
    recursive: true,
  });
  await Deno.mkdir(join(repo, "harness-tasks", "v2"), { recursive: true });
  await sh(dir, "init", "-q", "--bare", origin);
  await sh(repo, "init", "-q");
  await sh(repo, "remote", "add", "origin", origin);
  await Deno.writeTextFile(
    join(repo, "harness-tasks", "tasks", "HX-007", "task.yml"),
    "id: HX-007\n",
  );
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "seal");
  await sh(repo, "tag", ...(opts.lightweight ? [] : ["-a", "-m", "s"]), START);
  await sh(repo, "push", "-q", "origin", START);
  const entry: SealEntry = {
    ...SEAL0,
    tag_object: await sh(repo, "rev-parse", `refs/tags/${START}`),
    commit: await sh(repo, "rev-parse", `${START}^{commit}`),
  };
  const writeLedger = async (seals: SealEntry[], msg: string) => {
    await Deno.writeTextFile(
      join(repo, "harness-tasks", "v2", "seals.yml"),
      stringify({ v: 2, seals }),
    );
    await sh(repo, "add", "-A");
    await sh(repo, "commit", "-q", "-m", msg);
  };
  await writeLedger([entry], "ledger");
  await sh(repo, "tag", "-a", "-m", "l", `${START}-ledger`);
  await sh(repo, "push", "-q", "origin", `${START}-ledger`);
  return { repo, entry, writeLedger };
}

Deno.test("screeningHistory (run 002): campaigns sort by instant, not as text", () => {
  const h = screeningHistory([
    {
      id: "c1",
      experiment: "v2-screen-2",
      created_at: "2026-10-25T00:00:00.100Z",
      cells: six("HX-008", 3),
    },
    {
      id: "c2",
      experiment: "v2-screen-1",
      created_at: "2026-10-25T00:00:00Z",
      cells: incomplete("HX-008"),
    },
  ], RULES);
  assertEquals(h.problems, []);
  assertEquals(tally(h.cells, RULES).get("HX-008"), {
    solved: 3,
    scored: 6,
    complete: true,
  });
});

Deno.test("loadLedgerAnchors (run 002): origin is authoritative; a moved local -ledger tag is a problem", async () => {
  const { repo, entry, writeLedger } = await sealedRepo();
  assertEquals(
    await ledgerProblems([entry], await loadLedgerAnchors(repo, [entry])),
    [],
  );
  // Rewrite the ledger and move the LOCAL -ledger tag onto it; origin keeps
  // the original tag object.
  const forged = { ...entry, randomness: "f".repeat(64) };
  await writeLedger([forged], "rewrite");
  await sh(repo, "tag", "-f", "-a", "-m", "moved", `${START}-ledger`);
  const p = await ledgerProblems(
    [forged],
    await loadLedgerAnchors(repo, [forged]),
  );
  assert(
    p.some((x) =>
      x.startsWith(`${START}-ledger: local tag object `) &&
      x.includes("differs from origin")
    ),
    p.join("\n"),
  );
  assert(
    p.includes(`${START}: entry differs from ${START}-ledger`),
    p.join("\n"),
  );
});

Deno.test("loadLedgerAnchors (run 002): an unreadable rev is not treated as an absent ledger", async () => {
  const { repo, entry } = await sealedRepo();
  const c = await sh(repo, "rev-parse", `${START}-ledger^{commit}`);
  await Deno.remove(join(repo, ".git", "objects", c.slice(0, 2), c.slice(2)));
  await assertRejects(() => loadLedgerAnchors(repo, [entry]), ValidationError);
});

Deno.test("loadLedgerAnchors (run 002): a lightweight seal tag is a problem", async () => {
  const { repo, entry } = await sealedRepo({ lightweight: true });
  assertEquals(entry.tag_object, entry.commit);
  const p = await ledgerProblems(
    [entry],
    await loadLedgerAnchors(repo, [entry]),
  );
  assert(p.includes(`${START}: not an annotated tag`), p.join("\n"));
});

// ---- M8-02b (review M8-02-002): absence is read from the tree; two scored
// manual reruns of one cell are a problem.

import { manualRerunProblems } from "../../../scripts/harness/screening.ts";
import { campaign, execution, judgment } from "./fixtures.ts";

Deno.test("loadLedgerAnchors (M8-02b): a ledger in the start seal's tree whose blob is missing is never absent", async () => {
  const dir = await tempDir({ prefix: "cg-screening-" });
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  await Deno.mkdir(join(repo, "harness-tasks", "v2"), { recursive: true });
  await sh(dir, "init", "-q", "--bare", origin);
  await sh(repo, "init", "-q");
  await sh(repo, "remote", "add", "origin", origin);
  // The start seal's commit already holds a seals.yml (it must hold none).
  const seals = join(repo, "harness-tasks", "v2", "seals.yml");
  await Deno.writeTextFile(seals, "# ledger present at the start seal\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "seal");
  await sh(repo, "tag", "-a", "-m", "s", START);
  await sh(repo, "push", "-q", "origin", START);
  const blob = await sh(
    repo,
    "rev-parse",
    `${START}:harness-tasks/v2/seals.yml`,
  );
  const entry: SealEntry = {
    ...SEAL0,
    tag_object: await sh(repo, "rev-parse", `refs/tags/${START}`),
    commit: await sh(repo, "rev-parse", `${START}^{commit}`),
  };
  await Deno.writeTextFile(seals, stringify({ v: 2, seals: [entry] }));
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "ledger");
  await sh(repo, "tag", "-a", "-m", "l", `${START}-ledger`);
  await sh(repo, "push", "-q", "origin", `${START}-ledger`);
  // Delete the start seal's ledger blob (still loose: no gc, no repack).
  await Deno.remove(
    join(repo, ".git", "objects", blob.slice(0, 2), blob.slice(2)),
  );
  let problems: string[] | null = null;
  try {
    problems = await ledgerProblems(
      [entry],
      await loadLedgerAnchors(repo, [entry]),
    );
  } catch (err) {
    assert(err instanceof ValidationError, String(err));
  }
  assert(
    problems === null || problems.length > 0,
    "a missing ledger blob passed as an absent ledger",
  );
});

Deno.test("manualRerunProblems (M8-02b): two scored manual reruns of one cell are a problem", async () => {
  const c = await campaign();
  const limited = execution(c, {}, { termination: "usage_limited" });
  const m2 = execution(c, { attempt: 2, run_kind: "manual_rerun" });
  const m3 = execution(c, { attempt: 3, run_kind: "manual_rerun" });
  // One scored rerun, or a scored one plus an unscored one: fine.
  assertEquals(
    manualRerunProblems(c, [limited, m2], [judgment(c, m2, true)]),
    [],
  );
  assertEquals(
    manualRerunProblems(c, [limited, m2, m3], [
      judgment(c, m2, true),
      judgment(c, m3, null),
    ]),
    [],
  );
  assertEquals(
    manualRerunProblems(c, [limited, m3, m2], [
      judgment(c, m2, false),
      judgment(c, m3, true),
    ]),
    [`campaign ${c.id}: cell HX-001/1/plain has 2 scored manual reruns`],
  );
});

Deno.test("screeningHistory (M8-02b): a campaign's record problems are reported", () => {
  const h = screeningHistory([{
    id: "c1",
    experiment: "v2-screen-1",
    created_at: "2026-10-25T00:00:00Z",
    cells: six("HX-007", 3),
    problems: [
      "campaign c1: cell HX-007/1/cc-v2-plain has 2 scored manual reruns",
    ],
  }], RULES);
  assertEquals(h.problems, [
    "campaign c1: cell HX-007/1/cc-v2-plain has 2 scored manual reruns",
  ]);
});

Deno.test("loadLedgerAnchors (M8-02b run 002): a missing intermediate tree on the ledger path is never absent", async () => {
  const dir = await tempDir({ prefix: "cg-screening-" });
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  await Deno.mkdir(join(repo, "harness-tasks", "v2"), { recursive: true });
  await sh(dir, "init", "-q", "--bare", origin);
  await sh(repo, "init", "-q");
  await sh(repo, "remote", "add", "origin", origin);
  // The start seal's commit already holds a seals.yml (it must hold none).
  const seals = join(repo, "harness-tasks", "v2", "seals.yml");
  await Deno.writeTextFile(seals, "# ledger present at the start seal\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "seal");
  await sh(repo, "tag", "-a", "-m", "s", START);
  await sh(repo, "push", "-q", "origin", START);
  const v2Tree = await sh(repo, "rev-parse", `${START}:harness-tasks/v2`);
  const entry: SealEntry = {
    ...SEAL0,
    tag_object: await sh(repo, "rev-parse", `refs/tags/${START}`),
    commit: await sh(repo, "rev-parse", `${START}^{commit}`),
  };
  await Deno.writeTextFile(seals, stringify({ v: 2, seals: [entry] }));
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "ledger");
  await sh(repo, "tag", "-a", "-m", "l", `${START}-ledger`);
  await sh(repo, "push", "-q", "origin", `${START}-ledger`);
  // Delete the start seal's harness-tasks/v2 TREE object (loose; no gc).
  assert(
    v2Tree !== await sh(repo, "rev-parse", "HEAD:harness-tasks/v2"),
    "the ledger commit holds a different v2 tree",
  );
  await Deno.remove(
    join(repo, ".git", "objects", v2Tree.slice(0, 2), v2Tree.slice(2)),
  );
  let problems: string[] | null = null;
  try {
    problems = await ledgerProblems(
      [entry],
      await loadLedgerAnchors(repo, [entry]),
    );
  } catch (err) {
    assert(err instanceof ValidationError, String(err));
  }
  assert(
    problems === null || problems.length > 0,
    "a missing intermediate tree passed as an absent ledger",
  );
});

Deno.test("loadScreenCampaigns (M8-15c): a results dir without campaigns (none run yet) is no campaigns, not an error", async () => {
  const { loadScreenCampaigns } = await import(
    "../../../scripts/harness/screening.ts"
  );
  const root = await Deno.makeTempDir();
  try {
    for (const dir of [root, `${root}/never-created`]) {
      const r = await loadScreenCampaigns(dir, RULES);
      assertEquals([r.campaigns, [...r.ran]], [[], []]);
    }
    // A campaigns path that is a file is still an error.
    await Deno.writeTextFile(`${root}/campaigns`, "x");
    let threw = false;
    try {
      await loadScreenCampaigns(root, RULES);
    } catch {
      threw = true;
    }
    assert(threw, "a campaigns path that is not a directory is refused");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// H-29 (owner ruling 2026-10-18-screening-crash-cells): a cell whose counted
// execution ended in harness_crash never counts, whatever its verdict.
const used = (c: Cell, id: string) => ({ ...c, used_execution: id });
const crashed = (cells: Cell[], crash: Record<number, string>) => {
  const recs = cells.map((c, i) => used(c, crash[i] ?? `ok-${c.task}-${i}`));
  const ex = recs.map((c) => ({
    id: c.used_execution,
    termination: Object.values(crash).includes(c.used_execution)
      ? "harness_crash" as const
      : "completed" as const,
  }));
  return excludeCrashCells(recs, ex);
};

Deno.test("excludeCrashCells (H-29): a crash-ended passing cell does not count and its task is incomplete", () => {
  const r = crashed(six("HX-033", 6), { 4: "18de2b0f" });
  assertEquals(r.excluded, [
    { execution: "18de2b0f", task: "HX-033", reason: "harness_crash" },
  ]);
  assertEquals(tally(r.cells, RULES).get("HX-033"), {
    solved: 5,
    scored: 5,
    complete: false,
  });
});

Deno.test("excludeCrashCells (H-29): a crash-ended failing cell does not count and its task is incomplete", () => {
  const r = crashed(six("HX-032", 2), { 5: "ff14f5e5" });
  assertEquals(r.excluded, [
    { execution: "ff14f5e5", task: "HX-032", reason: "harness_crash" },
  ]);
  assertEquals(tally(r.cells, RULES).get("HX-032"), {
    solved: 2,
    scored: 5,
    complete: false,
  });
});

Deno.test("excludeCrashCells (H-29): completed cells still count", () => {
  const r = crashed(six("HX-007", 4), {});
  assertEquals(r.excluded, []);
  assertEquals(tally(r.cells, RULES).get("HX-007"), {
    solved: 4,
    scored: 6,
    complete: true,
  });
});

Deno.test("excludeCrashCells (H-29): a task with an excluded cell is listed for the next screen", () => {
  const r = crashed([...six("HX-031", 3), ...six("HX-007", 3)], {
    1: "e5404209",
  });
  const h = screeningHistory([{
    id: "c1",
    experiment: "v2-screen-1",
    created_at: "2026-10-18T00:00:00Z",
    cells: r.cells,
    excluded: r.excluded,
  }], RULES);
  assertEquals(h.excluded, r.excluded);
  const st = classify(
    S([C("HX-031"), C("HX-007")]),
    new Set(["HX-031", "HX-007"]),
    [],
    tally(h.cells, RULES),
    h.screens,
  );
  assertEquals(rescreenTasks(st), ["HX-031"]);
  assertEquals(excludedLines(r.excluded), [
    "excluded e5404209 HX-031 harness_crash",
  ]);
});

Deno.test("excludeCrashCells (H-29): one rescreen is allowed, a second rescreen of the now complete task is refused", () => {
  const at = (d: number) => `2026-10-${d}T00:00:00Z`;
  const first = crashed(six("HX-033", 6), { 0: "18de2b0f" });
  const h = screeningHistory([
    {
      id: "c1",
      experiment: "v2-screen-1",
      created_at: at(18),
      cells: first.cells,
    },
    {
      id: "c2",
      experiment: "v2-screen-2",
      created_at: at(20),
      cells: six("HX-033", 5),
    },
    {
      id: "c3",
      experiment: "v2-screen-3",
      created_at: at(22),
      cells: six("HX-033", 4),
    },
  ], RULES);
  assertEquals(h.problems, [
    "HX-033 rescreened in v2-screen-3 after a complete screen",
    "HX-033 screened 3 times (at most one rescreen)",
  ]);
  const ok = screeningHistory([
    {
      id: "c1",
      experiment: "v2-screen-1",
      created_at: at(18),
      cells: first.cells,
      excluded: first.excluded,
    },
    {
      id: "c2",
      experiment: "v2-screen-2",
      created_at: at(20),
      cells: six("HX-033", 5),
    },
  ], RULES);
  assertEquals(ok.problems, []);
  // The rescreen replaces the crash screen, so nothing is excluded any more.
  assertEquals(ok.excluded, []);
  assertEquals(tally(ok.cells, RULES).get("HX-033")!.solved, 5);
});

Deno.test("excludeCrashCells (H-29): on records, a judged crash-ended cell is excluded; a crash retried to completion counts", async () => {
  const { cellsFromRecords } = await import("../../../src/harness/outcome.ts");
  const c = await campaign();
  const crash = execution(c, { arm: "plain" }, {
    termination: "harness_crash",
    did_work: true,
  });
  const lost = execution(c, { arm: "skills" }, {
    termination: "harness_crash",
    did_work: false,
  });
  const retry = execution(c, {
    arm: "skills",
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: lost.id,
  });
  const ex = [crash, lost, retry];
  const js = [judgment(c, crash, true), judgment(c, retry, true)];
  const byExecution = new Map(js.map((j) => [j.execution_id, [j]]));
  const r = excludeCrashCells(cellsFromRecords(c, ex, byExecution), ex);
  assertEquals(r.excluded, [
    { execution: crash.id, task: "HX-001", reason: "harness_crash" },
  ]);
  const by = new Map(r.cells.map((x) => [`${x.task}/${x.arm}`, x]));
  assertEquals(
    [by.get("HX-001/plain")!.status, by.get("HX-001/plain")!.pass],
    ["unscored", null],
  );
  assertEquals(
    [by.get("HX-001/skills")!.status, by.get("HX-001/skills")!.pass],
    ["scored", true],
  );
});

// ---- H-51: --stratify-env. Two synthetic campaigns judged on different
// env_fp; pooled verdicts are computed per env_fp, never across one.

import {
  cellEnvs,
  type EnvCell,
  stratifyByEnv,
} from "../../../scripts/harness/screening.ts";

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);
const onEnv = (env: string | null, cells: Cell[]): EnvCell[] =>
  cells.map((c) => ({ ...c, env }));

Deno.test("cellEnvs (H-51): a cell's env is its counted v2 judgment's env_fp, (v1) for a legacy one, null without one", async () => {
  const c = await campaign();
  const e1 = execution(c, { arm: "plain" });
  const e2 = execution(c, { arm: "skills" });
  const v2 = (fp: string | null) => ({
    v: 2 as const,
    policy: { passed: true, violations: [] },
    provenance: { harness_commit: null, production_manifest: null, env_fp: fp },
  });
  const ja = judgment(c, e1, true, v2(FP_A));
  const jn = judgment(c, e2, true, v2(null));
  const jv1 = judgment(c, e2, true);
  // H-63: a judgment that touched no container is its own stratum.
  const jnc = judgment(c, e1, true, {
    ...v2(null),
    provenance: {
      harness_commit: null,
      production_manifest: null,
      env_fp: null,
      env_none: "no container touched: production policy violation",
    },
  });
  const cells = [
    { ...cell("HX-001", "plain", 1, true), judgment_id: ja.id },
    { ...cell("HX-001", "skills", 1, true), judgment_id: jn.id },
    { ...cell("HX-001", "skills", 2, true), judgment_id: jv1.id },
    { ...cell("HX-001", "skills", 3, null), judgment_id: null },
    { ...cell("HX-001", "plain", 2, true), judgment_id: jnc.id },
  ];
  assertEquals(
    cellEnvs(cells, [ja, jn, jv1, jnc]).map((x) => x.env),
    [FP_A, "(none)", "(v1)", null, "(no container)"],
  );
});

Deno.test("stratifyByEnv (H-51): one-env candidates keep the pooled status; a candidate spanning two env_fp gets a status per stratum and a flag", () => {
  // v2-screen-1 judged on FP_A; v2-screen-2 on FP_B. HX-002's cells span both.
  const hist = screeningHistory([
    {
      id: "c1",
      experiment: "v2-screen-1",
      created_at: "2026-10-20T00:00:00Z",
      cells: [
        ...onEnv(FP_A, six("HX-001", 1)),
        ...onEnv(FP_A, six("HX-002", 6).slice(0, 4)),
        ...onEnv(FP_B, six("HX-002", 6).slice(4)),
      ],
    },
    {
      id: "c2",
      experiment: "v2-screen-2",
      created_at: "2026-10-30T00:00:00Z",
      cells: [
        ...onEnv(FP_B, six("HX-003", 5)),
        ...onEnv(null, [cell("HX-003", RULES.arms[1], 4, null)]),
      ],
    },
  ], RULES);
  assertEquals(hist.problems, []);
  const s = S([C("HX-001"), C("HX-002"), C("HX-003")]);
  const sealed = new Set(["HX-001", "HX-002", "HX-003"]);
  const r = stratifyByEnv(s, sealed, [], hist.cells, hist.screens);
  assertEquals(r.status.get("HX-001"), "hard");
  // An env-less (never judged) cell joins no stratum of its own.
  assertEquals(r.status.get("HX-003"), "easy");
  assertEquals([...r.strata.keys()], ["HX-002"]);
  assertEquals(r.strata.get("HX-002"), [
    { env: FP_A, status: "incomplete", solved: 4, scored: 4 },
    { env: FP_B, status: "incomplete", solved: 2, scored: 2 },
  ]);
  assertEquals(
    r.flagged,
    new Map([["HX-002", "no stratum has enough cells for a status"]]),
  );
  // The orchestrator rules on a flagged candidate: it is never rescreened automatically.
  assertEquals(rescreenTasks(r.status, r.flagged).includes("HX-002"), false);
  assertEquals(rescreenTasks(r.status).includes("HX-002"), true);
});

Deno.test("stratifyByEnv (H-51): strata that disagree are flagged; held-out, broken and unsealed are never flagged", () => {
  const s = S([C("HX-001"), C("HX-002", { broken: "d.md" }), C("HX-003")]);
  const cells: EnvCell[] = [
    // HX-001: complete and saturated on FP_A, a further scored pair on FP_B.
    ...onEnv(FP_A, six("HX-001", 6)),
    ...onEnv(FP_B, [cell("HX-001", RULES.arms[0], 1, false)]),
    ...onEnv(FP_A, six("HX-002", 3).slice(0, 3)),
    ...onEnv(FP_B, six("HX-002", 3).slice(3)),
    ...onEnv(FP_A, six("HX-003", 3).slice(0, 3)),
    ...onEnv(FP_B, six("HX-003", 3).slice(3)),
  ];
  const r = stratifyByEnv(
    s,
    new Set(["HX-001", "HX-002"]),
    [],
    cells,
    new Map([["HX-001", 1], ["HX-002", 1], ["HX-003", 1]]),
  );
  assertEquals(r.flagged.get("HX-001"), "strata disagree");
  assertEquals(r.strata.get("HX-001")!.map((x) => x.status), [
    "saturated",
    "incomplete",
  ]);
  assertEquals(r.status.get("HX-002"), "broken");
  assertEquals(r.status.get("HX-003"), "unsealed");
  assertEquals(r.flagged.has("HX-002") || r.flagged.has("HX-003"), false);
});

// ---- H-53: executions per account label in screening status ----
import { accountLines } from "../../../scripts/harness/screening.ts";
import type { AccountCount } from "../../../src/harness/report.ts";

Deno.test("accountLines (H-53): executions and usage limits per label, summed over campaigns, labels sorted", () => {
  const c = (accounts: Record<string, AccountCount>) => ({
    id: "c",
    experiment: "screen-x",
    created_at: "2026-11-03T00:00:00.000Z",
    cells: [],
    accounts,
  });
  assertEquals(
    accountLines([
      c({ work: { executions: 3, usage_limited: 1, choices: {} } }),
      c({
        maxpriv2: { executions: 10, usage_limited: 0, choices: {} },
        work: { executions: 2, usage_limited: 0, choices: {} },
      }),
    ]),
    [
      "account maxpriv2: 10 execution(s), 0 usage_limited",
      "account work: 5 execution(s), 1 usage_limited",
    ],
  );
  assertEquals(accountLines([c({})]), []);
  // H-61: a retired label is marked on its line (with or without executions).
  const retired = {
    ...c({ work: { executions: 3, usage_limited: 0, choices: {} } }),
    retirements: [{
      v: 1 as const,
      campaign_id: "00000000-0000-4000-8000-0000000000c1",
      label: "work",
      by: "owner",
      at: "2026-11-04T08:00:00.000Z",
      reason: "setup fails",
    }],
  };
  assertEquals(accountLines([retired]), [
    "account work: 3 execution(s), 0 usage_limited [RETIRED by owner 2026-11-04T08:00:00.000Z: setup fails]",
  ]);
});

// ---- H-68: the pre-screen amendment (prescreen.ts holds its logic).

import { ExperimentSchema } from "../../../src/harness/config.ts";
import { SCREEN_PREFIX, STRATA } from "../../../scripts/harness/screening.ts";

Deno.test("ScreeningSchema (H-68): amendments default to none; a prescreen record needs a calibration first round and distinct seals", async () => {
  assertEquals(S([C("HX-007")]).amendments, []);
  // H-68 r1: the committed registry carries the amendment record; the
  // orchestrator appends its rounds when it seals.
  assertEquals((await readYaml(REGISTRY_PATH, ScreeningSchema)).amendments, [{
    id: "prescreen",
    decision: "decisions/2026-11-06-m8-wave2-round0-and-prescreen.md",
    rounds: [],
  }]);
  const amend = (a: unknown) =>
    ScreeningSchema.safeParse({
      v: 1,
      rules: RULES,
      candidates: [C("HX-007")],
      amendments: [a],
    }).success;
  const rec = (rounds: unknown[], extra: object = {}) => ({
    id: "prescreen",
    decision: "decisions/2026-11-06-m8-wave2-round0-and-prescreen.md",
    rounds,
    ...extra,
  });
  const cal = { seal: "harness-v2-screen-w5", mode: "calibration" };
  const fil = { seal: "harness-v2-screen-w6", mode: "filter" };
  assert(amend(rec([cal, fil])));
  assert(!amend(rec([fil])), "the first round must be calibration");
  assert(!amend(rec([cal, { ...fil, seal: cal.seal }])), "duplicate seal");
  assert(
    !amend(rec([cal], { id: "other" })),
    "the id is the literal prescreen",
  );
  assert(
    !amend(rec([{ ...cal, seal: "w5" }])),
    "a seal is a harness-v2-screen-* tag",
  );
  assert(
    !amend(rec([{ ...cal, mode: "skip" }])),
    "mode is calibration or filter",
  );
  assert(!amend(rec([cal], { extra: 1 })), "strict");
  assert(
    !ScreeningSchema.safeParse({
      v: 1,
      rules: RULES,
      candidates: [],
      amendments: [rec([cal]), rec([cal])],
    }).success,
    "one prescreen record",
  );
  // The amendment is not part of rules and is no append-only problem.
  assertEquals(
    appendOnlyProblems(
      "harness-v2-screen-w5",
      S([C("HX-007")]),
      ScreeningSchema.parse({
        v: 1,
        rules: RULES,
        candidates: [C("HX-007")],
        amendments: [rec([cal])],
      }),
    ),
    [],
  );
});

Deno.test("classify (H-68): a provisional reject is provisionally_saturated; held-out, broken and unsealed still win; default unchanged", () => {
  const s = S([
    C("HX-007"),
    C("HX-008"),
    C("HX-009", { broken: "decisions/x.md" }),
    C("HX-010"),
    C("HX-011"),
  ]);
  const sealed = new Set(["HX-007", "HX-008", "HX-009", "HX-011"]);
  const t = tally([...six("HX-008", 3), ...six("HX-011", 6)], RULES);
  const all = new Set(["HX-007", "HX-008", "HX-009", "HX-010", "HX-011"]);
  const st = classify(s, sealed, ["HX-007"], t, new Map(), all);
  assertEquals([...st.values()], [
    "held_out",
    "provisionally_saturated",
    "broken",
    "unsealed",
    "provisionally_saturated",
  ]);
  const plain = classify(s, sealed, ["HX-007"], t, new Map());
  assertEquals(plain, classify(s, sealed, ["HX-007"], t, new Map(), new Set()));
  assertEquals([...plain.values()], [
    "held_out",
    "intermediate",
    "broken",
    "unsealed",
    "saturated",
  ]);
});

Deno.test("classify (H-68): a provisional reject is never rescreened nor selectable, and may be redesigned", () => {
  const s = S([
    C("HX-007"),
    C("HX-008"),
    C("HX-009", { supersedes: "HX-007" }),
  ]);
  const st = classify(
    s,
    new Set(["HX-007", "HX-008", "HX-009"]),
    [],
    new Map(),
    new Map(),
    new Set(["HX-007"]),
  );
  assertEquals(st.get("HX-007"), "provisionally_saturated");
  assertEquals(rescreenTasks(st), ["HX-008", "HX-009"]);
  // The CLI's select pool takes STRATA statuses only.
  assert(!(STRATA as readonly string[]).includes(st.get("HX-007")!));
  assertEquals(supersedeProblems(s, st), []);
});

Deno.test("stratifyByEnv (H-68): a provisional reject keeps its status", () => {
  const s = S([C("HX-007")]);
  const r = stratifyByEnv(
    s,
    new Set(["HX-007"]),
    [],
    [],
    new Map(),
    new Set(["HX-007"]),
  );
  assertEquals(r.status.get("HX-007"), "provisionally_saturated");
});

Deno.test("loadScreenCampaigns (H-68): the default loader ignores v2-prescreen-* campaigns; the prefix and repeats parameters select them", async () => {
  const { loadScreenCampaigns } = await import(
    "../../../scripts/harness/screening.ts"
  );
  const { PRESCREEN_PREFIX } = await import(
    "../../../scripts/harness/prescreen.ts"
  );
  assert(!PRESCREEN_PREFIX.startsWith(SCREEN_PREFIX));
  const root = await Deno.makeTempDir();
  try {
    const c = await campaign({
      experiment: ExperimentSchema.parse({
        id: `${PRESCREEN_PREFIX}1`,
        hypothesis: "pre-screen",
        primary_metric: "cost_per_solved_task",
        baseline: "plain",
        variants: ["skills"],
        vary: ["skills"],
        tasks: "harness-tasks/tasks/*",
        repeats: 1,
      }),
    });
    await Deno.mkdir(`${root}/campaigns`);
    await Deno.writeTextFile(
      `${root}/campaigns/${c.id}.json`,
      JSON.stringify(c),
    );
    const r = await loadScreenCampaigns(root, RULES);
    assertEquals([r.campaigns, [...r.ran]], [[], []]);
    // Read with the pre-screen prefix it is checked against arms x 1.
    await assertRejects(
      () => loadScreenCampaigns(root, RULES, ".", false, PRESCREEN_PREFIX, 1),
      ValidationError,
      "does not run the screening arms x 1",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

import { completionTimes } from "../../../scripts/harness/screening.ts";

Deno.test("completionTimes (H-68 r1): a task completes when its last counted judgment ended", async () => {
  const c = await campaign();
  const e1 = execution(c, { arm: "plain" });
  const e2 = execution(c, { arm: "skills" });
  const j1 = { ...judgment(c, e1, true), ended_at: "2026-10-02T10:00:00.000Z" };
  const j2 = { ...judgment(c, e2, true), ended_at: "2026-10-03T09:00:00.000Z" };
  const old = {
    ...judgment(c, e1, true),
    id: "old",
    ended_at: "2026-10-09T00:00:00.000Z",
  };
  assertEquals(
    completionTimes([
      { task: "HX-001", judgment_id: j1.id },
      { task: "HX-001", judgment_id: j2.id },
      { task: "HX-002", judgment_id: null },
    ], [j1, j2, old]),
    { "HX-001": "2026-10-03T09:00:00.000Z" },
  );
});

import {
  nextScreenTasks,
  selectRefusal,
} from "../../../scripts/harness/screening.ts";

Deno.test("nextScreenTasks / selectRefusal (H-68 r2): a missing calibration pre-screen blocks select only; a pending audit blocks both", () => {
  const status = new Map<string, Status>([
    ["HX-007", "unscreened"],
    ["HX-008", "unscreened"],
    ["HX-009", "intermediate"],
  ]);
  const ps = (waiting: string[], missing: string[]) => ({
    waiting: new Set(waiting),
    missing: new Set(missing),
  });
  // HX-007 misses its calibration pre-screen: it still goes to the full screen.
  assertEquals(nextScreenTasks(status, new Map(), ps([], ["HX-007"])), [
    "HX-007",
    "HX-008",
  ]);
  // HX-008 waits for a filter audit: it does not.
  assertEquals(nextScreenTasks(status, new Map(), ps(["HX-008"], [])), [
    "HX-007",
  ]);
  // A flagged candidate waits for a ruling, as before.
  assertEquals(
    nextScreenTasks(
      status,
      new Map([["HX-007", "strata disagree"]]),
      ps([], []),
    ),
    ["HX-008"],
  );
  const done = new Map<string, Status>([["HX-007", "hard"], [
    "HX-009",
    "easy",
  ]]);
  assertEquals(selectRefusal([], ps([], []), done), null);
  assertEquals(
    selectRefusal([], ps([], ["HX-007"]), done),
    'select needs a finished pre-screen of every calibration candidate: "harness-tasks/tasks/HX-007"',
  );
  assertEquals(
    selectRefusal([], ps(["HX-009"], []), done),
    "select needs every candidate sealed and screened",
  );
  assertEquals(
    selectRefusal(["HX-008"], ps([], []), done),
    "select needs every candidate sealed and screened",
  );
  assertEquals(
    selectRefusal(
      [],
      ps([], []),
      new Map<string, Status>([["HX-010", "unsealed"]]),
    ),
    "select needs every candidate sealed and screened",
  );
});

import { firstAttempts } from "../../../scripts/harness/screening.ts";

Deno.test("firstAttempts (H-68 r3): each cell's first execution attempt, never a retry or a manual rerun", async () => {
  const c = await campaign({ repeats: 2 });
  const p1 = execution(c, { arm: "plain" });
  const m1 = execution(c, {
    arm: "plain",
    attempt: 2,
    run_kind: "manual_rerun",
  });
  const s1 = execution(c, { arm: "skills" }, {
    termination: "setup_failed",
    did_work: false,
  });
  const s2 = execution(c, {
    arm: "skills",
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: s1.id,
  });
  const p2 = execution(c, { task: "HX-002", arm: "plain" });
  const crash = execution(c, { repeat: 2, arm: "plain" }, {
    termination: "harness_crash",
    did_work: true,
  });
  const unscored = execution(c, { repeat: 2, arm: "skills" });
  const ex = [p1, m1, s1, s2, p2, crash, unscored];
  const js = [
    judgment(c, p1, true),
    judgment(c, m1, false),
    judgment(c, s2, true),
    judgment(c, crash, true),
    judgment(c, unscored, null),
  ];
  assertEquals(Object.fromEntries(firstAttempts(c, ex, js).first), {
    // judged pass; the manual rerun's fail is never read
    "HX-001/1/plain": "pass",
    // the first attempt failed setup; the automatic retry's pass is never read
    "HX-001/1/skills": "fail",
    // H-29: a crash-ended first attempt never counts
    "HX-001/2/plain": "fail",
    // r4: a first judgment that is unscored is a fail (Q4: eligible)
    "HX-001/2/skills": "fail",
    // ended, not judged yet
    "HX-002/1/plain": "live",
    // not started
    "HX-002/1/skills": "live",
    "HX-002/2/plain": "live",
    "HX-002/2/skills": "live",
  });
});

Deno.test("firstAttempts (H-68 r4): the first attempt freezes on its first judgment; a later rejudge never changes it", async () => {
  const c = await campaign();
  const unscored = execution(c, { arm: "plain" });
  const passed = execution(c, { arm: "skills" });
  const waiting = execution(c, { task: "HX-002", arm: "plain" });
  const ex = [unscored, passed, waiting];
  const at = (h: number) => ({
    started_at: `2026-10-01T${h}:00:00.000Z`,
    ended_at: `2026-10-01T${h}:30:00.000Z`,
  });
  const first = [
    judgment(c, unscored, null, at(11)),
    judgment(c, passed, true, at(11)),
  ];
  const before = Object.fromEntries(firstAttempts(c, ex, first).first);
  assertEquals(
    [before["HX-001/1/plain"], before["HX-001/1/skills"]],
    ["fail", "pass"],
  );
  // (c) no judgment yet: live (a pending verdict)
  assertEquals(before["HX-002/1/plain"], "live");
  // (a) a passing rejudge of the unscored one and (b) a failing rejudge of
  // the pass change nothing, so R and the audit sample cannot move.
  const rejudged = [
    ...first,
    judgment(c, unscored, true, at(13)),
    judgment(c, passed, false, at(13)),
  ];
  assertEquals(
    Object.fromEntries(firstAttempts(c, ex, rejudged).first),
    before,
  );
  // Input order is irrelevant: the earliest judgment is the first.
  assertEquals(
    Object.fromEntries(firstAttempts(c, ex, [...rejudged].reverse()).first),
    before,
  );
});

Deno.test("firstAttempts (H-68 r5): forced judgments never count; a judgment before its execution's end or an ambiguous first judgment is a problem", async () => {
  const c = await campaign();
  // Executions end 10:11 (fixture default).
  const e = execution(c, { arm: "plain" });
  const time = (hm: string) => ({
    started_at: `2026-10-01T${hm}:00.000Z`,
    ended_at: `2026-10-01T${hm}:00.000Z`,
  });
  const pass = judgment(c, e, true, time("10:20"));
  const forced = judgment(c, e, false, {
    ...time("10:15"),
    forced: {
      reason: "verdict build starved of memory",
      replaces: pass.id,
      basis: {
        kind: "decision",
        path: "2026-10-30-x.md",
        sha256: "a".repeat(64),
        approval: "OWNER-APPROVED: rejudge (2026-10-30T10:00:00Z)",
      },
    },
  });
  // A forced failing judgment backdated before the original pass: still a
  // pass, no problem, so R is unchanged.
  const f = firstAttempts(c, [e], [pass, forced]);
  assertEquals(f.first.get("HX-001/1/plain"), "pass");
  assertEquals(f.problems, []);
  // A judgment ending before its execution is a problem, never the first.
  const early = judgment(c, e, false, time("10:05"));
  const g = firstAttempts(c, [e], [pass, early]);
  assertEquals(g.problems, [
    `judgment ${early.id} ends before its execution`,
  ]);
  assertEquals(g.first.get("HX-001/1/plain"), "pass");
  // Two earliest judgments at the same instant that disagree: a problem.
  const tie = judgment(c, e, false, time("10:20"));
  assertEquals(firstAttempts(c, [e], [pass, tie]).problems, [
    `execution ${e.id}: ambiguous first judgment (${
      [pass.id, tie.id].sort().join(", ")
    } end together and disagree)`,
  ]);
  // The same instant and the same outcome is fine.
  const same = judgment(c, e, true, time("10:20"));
  const h = firstAttempts(c, [e], [pass, same]);
  assertEquals(h.problems, []);
  assertEquals(h.first.get("HX-001/1/plain"), "pass");
});
