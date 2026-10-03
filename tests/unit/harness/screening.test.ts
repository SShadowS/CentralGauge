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
  identityProblems,
  isLarge,
  type Kind,
  ledgerProblems,
  pickHeldOut,
  ranks,
  REGISTRY_PATH,
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
