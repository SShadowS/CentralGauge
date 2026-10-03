// Task set v2 screening (spec 2026-10-03-harness-v2-design.md sections 3
// and 12 finding 2): candidate registry, seals, held-out pick, screening
// history, pilot tally, strata and the pre-specified selection.
// Owner: lane-infra.
//
// Nothing here reads an arm difference: a tally pools both arms, and select()
// sees only stratum, kind, coupling and size.

import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { z } from "zod";
import type { TaskIdentity } from "../../src/harness/identity.ts";
import type { JudgmentRecord } from "../../src/harness/records.ts";
import type { Cell } from "../../src/harness/stats.ts";
import { ValidationError } from "../../src/errors.ts";
import { loadCampaignData } from "../../src/harness/campaign.ts";
import { hashJson, sha256Hex } from "../../src/harness/hash.ts";
import {
  loadSymbolsLock,
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import { validateCampaignRecords } from "../../src/harness/integrity.ts";
import { cellsFromRecords } from "../../src/harness/outcome.ts";
import {
  CampaignRecordSchema,
  compareInstant,
  RecordStore,
} from "../../src/harness/records.ts";
import {
  HarnessTaskSchema,
  loadTask,
  TASK_KINDS,
} from "../../src/harness/task.ts";

export type Kind = (typeof TASK_KINDS)[number];
export const STRATA = ["easy", "intermediate", "hard"] as const;
export type Stratum = (typeof STRATA)[number];
export type Status =
  | Stratum
  | "dead"
  | "saturated"
  | "broken"
  | "incomplete"
  | "unscreenable"
  | "unscreened"
  | "unsealed"
  | "held_out";

export const REGISTRY_PATH = "harness-tasks/v2/screening.yml";
export const SEALS_PATH = "harness-tasks/v2/seals.yml";
export const START_TAG = "harness-v2-screen-start";
export const SCREEN_PREFIX = "v2-screen-";

const taskId = z.string().regex(/^HX-\d{3}$/, "must look like HX-007");
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase slug");

export const RulesSchema = z.strictObject({
  /** The two screening arms (plain, realistic+LSP); order is irrelevant. */
  arms: z.tuple([slug, slug]),
  repeats: z.number().int().positive(),
  easy_share: z.number().min(0).max(1),
  hard_share: z.number().min(0).max(1),
  kind_min: z.number().int().min(0),
  kind_max_share: z.number().gt(0).max(1),
  required_coupling: z.array(z.string().min(1)).min(1),
  coupling_min: z.number().int().min(1),
  large_min_share: z.number().min(0).max(1),
  /** Strata a short stratum borrows from, in order. */
  borrow: z.strictObject({
    easy: z.array(z.enum(STRATA)),
    intermediate: z.array(z.enum(STRATA)),
    hard: z.array(z.enum(STRATA)),
  }),
});
export type Rules = z.output<typeof RulesSchema>;

export const CandidateSchema = z.strictObject({
  id: taskId,
  /** Author's difficulty prior, recorded before any pilot outcome. */
  prior: z.enum(STRATA),
  size: z.strictObject({
    objects: z.number().int().min(1),
    files: z.number().int().min(1),
    /** "<Object>.<Procedure>" the solution must find and reuse, or null. */
    reuse: z.string().min(1).nullable(),
    /** Event or interface the agent must follow through the refapp, or null. */
    traces: z.string().min(1).nullable(),
  }),
  /** A dropped candidate this one redesigns (new id, fresh screening). */
  supersedes: taskId.nullable().default(null),
  /** Decision file confirming a broken oracle: the one field set after sealing. */
  broken: z.string().min(1).nullable().default(null),
});
export type Candidate = z.output<typeof CandidateSchema>;

export const ScreeningSchema = z.strictObject({
  v: z.literal(1),
  rules: RulesSchema,
  candidates: z.array(CandidateSchema).default([]),
}).superRefine((s, ctx) => {
  const ids = s.candidates.map((c) => c.id);
  const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  if (dup.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: `duplicate candidate ${dup.join(", ")}`,
      path: ["candidates"],
    });
  }
  for (const c of s.candidates) {
    if (c.supersedes !== null && !ids.includes(c.supersedes)) {
      ctx.addIssue({
        code: "custom",
        message: `${c.id} supersedes unknown ${c.supersedes}`,
        path: ["candidates"],
      });
    }
  }
});
export type Screening = z.output<typeof ScreeningSchema>;

const hex = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`));

/**
 * One ledger entry per seal (appendix section 9): the seal tag as published
 * (tag object, commit, push time), the drand chain and round fixed by rule
 * AFTER the push, its randomness, and the hash of the previous entry.
 * Appended, never edited; the first is START_TAG.
 */
export const SealEntrySchema = z.strictObject({
  tag: z.string().regex(/^harness-v2-screen-[a-z0-9-]+$/)
    .refine((t) => !t.endsWith("-ledger"), "a -ledger tag is not a seal"),
  tag_object: hex(40),
  commit: hex(40),
  pushed_at: z.iso.datetime(),
  drand_chain: hex(64),
  drand_round: z.number().int().positive(),
  round_time: z.iso.datetime(),
  randomness: hex(64),
  prev: z.union([z.literal("genesis"), hex(64)]),
}).refine(
  (e) => Date.parse(e.round_time) >= Date.parse(e.pushed_at) + 600_000,
  "the drand round must be at least 10 minutes after the push",
);
export type SealEntry = z.output<typeof SealEntrySchema>;

export const SealsSchema = z.strictObject({
  v: z.literal(2),
  seals: z.array(SealEntrySchema).min(1),
}).superRefine((s, ctx) => {
  if (s.seals[0]!.tag !== START_TAG) {
    ctx.addIssue({
      code: "custom",
      message: `first seal must be ${START_TAG}`,
      path: ["seals"],
    });
  }
  const tags = s.seals.map((x) => x.tag);
  if (new Set(tags).size !== tags.length) {
    ctx.addIssue({
      code: "custom",
      message: "duplicate seal",
      path: ["seals"],
    });
  }
});
export type Seals = z.output<typeof SealsSchema>;

/** Rank seed of a seal: the sealed commit plus the beacon drawn after it. */
export const seedOf = (commit: string, randomness: string): string =>
  `${commit}:${randomness}`;

/** Chain link: the next entry's `prev` (appendix section 9). */
export const entryHash = (e: SealEntry): Promise<string> =>
  hashJson({ seal_entry: e });

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** What the repository says about each seal, read by loadLedgerAnchors. */
export interface LedgerAnchors {
  /** `git rev-parse <tag>` and `<tag>^{commit}`; absent when the tag is missing. */
  refs: Map<string, { tag_object: string; commit: string }>;
  /** seals.yml entries at the seal tag's commit; null when the file is absent there. */
  atSeal: Map<string, SealEntry[] | null>;
  /** seals.yml entries at `<tag>-ledger`; null when that tag is missing. */
  atLedger: Map<string, SealEntry[] | null>;
  /**
   * Round 3: every `harness-v2-screen-*-ledger` tag found on origin or locally,
   * discovered independently of HEAD, mapped to seals.yml at that tag (null if absent).
   */
  published: Map<string, SealEntry[] | null>;
  /**
   * Run 002: problems found while reading the anchors (a local tag object
   * that differs from origin's, a tag that is not annotated).
   */
  problems?: string[];
}

/**
 * The ledger at HEAD is append-only and anchored (round 2 finding 3): each
 * entry hashes its predecessor; each seal tag still names the recorded tag
 * object and commit; the ledger committed at the seal tag holds exactly the
 * entries before it; the ledger committed at its -ledger tag holds this
 * entry byte for byte. Rewriting, re-chaining or reordering any entry, or
 * moving any tag, is reported.
 */
export async function ledgerProblems(
  head: SealEntry[],
  a: LedgerAnchors,
): Promise<string[]> {
  const out: string[] = [...(a.problems ?? [])];
  for (const [i, e] of head.entries()) {
    const prev = i === 0 ? "genesis" : await entryHash(head[i - 1]!);
    if (e.prev !== prev) {
      out.push(`${e.tag}: prev does not hash the entry before it`);
    }
    // A lightweight tag has no tag object of its own (run 002).
    if (e.tag_object === e.commit) out.push(`${e.tag}: not an annotated tag`);
    const r = a.refs.get(e.tag);
    if (!r || r.tag_object !== e.tag_object || r.commit !== e.commit) {
      out.push(
        `${e.tag}: tag does not resolve to the recorded tag object and commit`,
      );
    }
    const before = a.atSeal.get(e.tag) ?? null;
    if (
      i === 0
        ? before !== null && before.length > 0
        : !sameJson(before, head.slice(0, i))
    ) {
      out.push(
        `${e.tag}: ledger before it differs from the one committed at ${e.tag}`,
      );
    }
    const led = a.atLedger.get(e.tag) ?? null;
    if (led === null) out.push(`${e.tag}: no ${e.tag}-ledger tag`);
    else if (led.length !== i + 1 || !sameJson(led[i], e)) {
      out.push(`${e.tag}: entry differs from ${e.tag}-ledger`);
    }
  }
  // Round 3 (orchestrator): anchors are discovered independently of HEAD, so a
  // truncated ledger (a published seal dropped to re-seal under a new beacon) is
  // refused. Every published `<seal>-ledger` tag must be a prefix of HEAD.
  for (const [ledgerTag, led] of a.published) {
    const seal = ledgerTag.replace(/-ledger$/, "");
    if (!head.some((e) => e.tag === seal)) {
      out.push(
        `${seal}: published ${ledgerTag} but the HEAD ledger has no ${seal} entry`,
      );
    }
    if (led === null || !sameJson(led, head.slice(0, led.length))) {
      out.push(
        `${ledgerTag}: HEAD ledger does not extend the ledger committed at ${ledgerTag}`,
      );
    }
  }
  return [...new Set(out)];
}

/**
 * A screening campaign may run a task only after the beacon round of the
 * seal that first sealed it (publication before screening, round 2 finding 3).
 */
export function chronologyProblems(
  campaigns: { id: string; created_at: string; tasks: string[] }[],
  firstRoundTime: Map<string, string>,
): string[] {
  return campaigns.flatMap((c) =>
    c.tasks.flatMap((t) => {
      const at = firstRoundTime.get(t);
      if (at === undefined) {
        return [`campaign ${c.id} ran ${t}, which no seal holds`];
      }
      return Date.parse(c.created_at) > Date.parse(at) ? [] : [
        `campaign ${c.id} (${c.created_at}) ran ${t} before its seal beacon (${at})`,
      ];
    })
  );
}

/** Spec section 3 quota 1, size clause. */
export const isLarge = (c: Candidate): boolean =>
  (c.size.objects >= 3 && c.size.files >= 2) || c.size.reuse !== null ||
  c.size.traces !== null;

/** Problems when `now` is not an append-only extension of the registry at seal `tag`. */
export function appendOnlyProblems(
  tag: string,
  sealed: Screening,
  now: Screening,
): string[] {
  const out: string[] = [];
  if (JSON.stringify(sealed.rules) !== JSON.stringify(now.rules)) {
    out.push(`rules changed after ${tag}`);
  }
  const byId = new Map(now.candidates.map((c) => [c.id, c]));
  for (const c of sealed.candidates) {
    const n = byId.get(c.id);
    if (!n) {
      out.push(`${c.id} removed after ${tag}`);
    } else if (
      JSON.stringify({ ...n, broken: null }) !==
        JSON.stringify({ ...c, broken: null })
    ) {
      out.push(`${c.id} changed after ${tag} (only broken may be set)`);
    }
  }
  return out;
}

/** Every task folder sealed at `tag` must have the same git tree now. */
export function treeProblems(
  tag: string,
  sealed: Map<string, string>,
  now: Map<string, string>,
): string[] {
  return [...sealed].filter(([id, tree]) => now.get(id) !== tree)
    .map(([id]) => `${id} task folder changed after ${tag}`);
}

/** A campaign ran exactly the current (sealed) task contents. */
export function identityProblems(
  campaign: string,
  ran: TaskIdentity[],
  current: TaskIdentity[],
): string[] {
  const cur = new Map(current.map((t) => [t.id, t]));
  return ran.flatMap((t) => {
    const c = cur.get(t.id);
    return c && c.visible === t.visible && c.oracle === t.oracle
      ? []
      : [`${t.id}: campaign ${campaign} ran other task contents`];
  });
}

const enc = new TextEncoder();

/** Rank key per id: sha256("<seed>:<id>"), compared as hex strings. */
export async function ranks(
  seed: string,
  ids: string[],
): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const id of ids) m.set(id, await sha256Hex(enc.encode(`${seed}:${id}`)));
  return m;
}

function byRank(rank: Map<string, string>) {
  return (a: string, b: string): number => {
    const ra = rank.get(a), rb = rank.get(b);
    if (ra === undefined || rb === undefined) {
      throw new ValidationError(`no rank for ${ra === undefined ? a : b}`, [
        a,
        b,
      ]);
    }
    return ra < rb ? -1 : ra > rb ? 1 : a.localeCompare(b);
  };
}

export interface TaskMeta {
  id: string;
  kind: Kind;
  coupling: string[];
  large: boolean;
}

/**
 * One held-out task per kind (task.ts order). Combinations are tried in
 * rank order (an odometer over each kind's ranked list, the last kind
 * turning fastest); the first one with at least ceil(4 * large_min_share)
 * large tasks and every required coupling style wins (spec 3 item 4: the
 * held-out tasks follow the same quotas).
 */
export function pickHeldOut(
  meta: TaskMeta[],
  rank: Map<string, string>,
  rules: Rules,
): string[] {
  const lists = TASK_KINDS.map((k) => {
    const l = meta.filter((m) => m.kind === k)
      .sort((a, b) => byRank(rank)(a.id, b.id));
    if (l.length === 0) {
      throw new ValidationError(`no ${k} candidate for the held-out set`, [k]);
    }
    return l;
  });
  const largeMin = Math.ceil(lists.length * rules.large_min_share);
  const idx = lists.map(() => 0);
  for (;;) {
    const set = idx.map((i, k) => lists[k]![i]!);
    if (
      set.filter((m) => m.large).length >= largeMin &&
      rules.required_coupling.every((c) =>
        set.some((m) => m.coupling.includes(c))
      )
    ) {
      return set.map((m) => m.id);
    }
    let k = idx.length - 1;
    while (k >= 0 && ++idx[k]! === lists[k]!.length) idx[k--] = 0;
    if (k < 0) {
      throw new ValidationError("no held-out set meets the quotas", [
        "held_out",
      ]);
    }
  }
}

export interface Tally {
  solved: number;
  scored: number;
  complete: boolean;
}

/** Pooled solved/scored per task over both arms, repeats 1..rules.repeats. */
export function tally(cells: Cell[], rules: Rules): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const c of cells) {
    if (!rules.arms.includes(c.arm)) {
      throw new ValidationError(
        `cell ${c.task}/${c.repeat}/${c.arm}: arm is not a screening arm`,
        [c.arm],
      );
    }
    const t = out.get(c.task) ?? { solved: 0, scored: 0, complete: false };
    if (c.status === "scored" && c.repeat <= rules.repeats) {
      t.scored++;
      if (c.pass) t.solved++;
    }
    out.set(c.task, t);
  }
  const want = rules.arms.length * rules.repeats;
  for (const t of out.values()) t.complete = t.scored === want;
  return out;
}

export interface ScreenCampaign {
  id: string;
  experiment: string;
  created_at: string;
  cells: Cell[];
}

/**
 * Every screening campaign, oldest first. One campaign per experiment, no
 * duplicate ids. A task may be screened again only while its previous screen
 * is incomplete, and at most twice; the newest screen replaces all its cells.
 */
export function screeningHistory(
  campaigns: ScreenCampaign[],
  rules: Rules,
): { cells: Cell[]; screens: Map<string, number>; problems: string[] } {
  const problems: string[] = [];
  const ids = campaigns.map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate campaign id");
  const exps = campaigns.map((c) => c.experiment);
  for (const x of new Set(exps.filter((e, i) => exps.indexOf(e) !== i))) {
    problems.push(`experiment ${x} has more than one campaign`);
  }
  const latest = new Map<string, Cell[]>();
  const screens = new Map<string, number>();
  const order = [...campaigns].sort((a, b) =>
    compareInstant(a.created_at, b.created_at) || a.id.localeCompare(b.id)
  );
  for (const c of order) {
    for (const t of new Set(c.cells.map((x) => x.task))) {
      const prev = latest.get(t);
      if (prev && tally(prev, rules).get(t)!.complete) {
        problems.push(
          `${t} rescreened in ${c.experiment} after a complete screen`,
        );
      }
      const n = (screens.get(t) ?? 0) + 1;
      if (n > 2) {
        problems.push(`${t} screened ${n} times (at most one rescreen)`);
      }
      screens.set(t, n);
      latest.set(t, c.cells.filter((x) => x.task === t));
    }
  }
  return { cells: [...latest.values()].flat(), screens, problems };
}

/** Stratum boundaries on the pooled count of `total` scored cells. */
export function stratumOf(
  solved: number,
  total: number,
): Stratum | "dead" | "saturated" {
  if (solved === 0) return "dead";
  if (solved === total) return "saturated";
  if (solved === total - 1) return "easy";
  if (solved === 1) return "hard";
  return "intermediate";
}

export function classify(
  s: Screening,
  sealed: Set<string>,
  heldOut: string[],
  tallies: Map<string, Tally>,
  screens: Map<string, number>,
): Map<string, Status> {
  const total = s.rules.arms.length * s.rules.repeats;
  const status = new Map<string, Status>();
  for (const c of s.candidates) {
    const t = tallies.get(c.id);
    status.set(
      c.id,
      heldOut.includes(c.id)
        ? "held_out"
        : c.broken !== null
        ? "broken"
        : !sealed.has(c.id)
        ? "unsealed"
        : !t
        ? "unscreened"
        : !t.complete
        ? ((screens.get(c.id) ?? 0) >= 2 ? "unscreenable" : "incomplete")
        : stratumOf(t.solved, total),
    );
  }
  return status;
}

/** A held-out task, or a task never sealed, must have no pilot cell. */
export function contaminationProblems(
  status: Map<string, Status>,
  screened: Iterable<string>,
): string[] {
  return [...screened].flatMap((t) => {
    const s = status.get(t);
    return s === undefined
      ? [`${t} was screened but is not a registry candidate`]
      : s === "held_out"
      ? [`${t} is held out but was screened`]
      : s === "unsealed"
      ? [`${t} was screened before it was sealed`]
      : [];
  });
}

const REDESIGNABLE = new Set<Status>(["dead", "saturated", "broken"]);

/** Only a dropped candidate may be redesigned (round 2 finding 2). */
export function supersedeProblems(
  s: Screening,
  status: Map<string, Status>,
): string[] {
  return s.candidates.flatMap((c) => {
    if (c.supersedes === null) return [];
    const st = status.get(c.supersedes);
    return st !== undefined && REDESIGNABLE.has(st) ? [] : [
      `${c.id} supersedes ${c.supersedes}, which is ${st}: only a dead, saturated or broken candidate may be redesigned`,
    ];
  });
}

export interface Eligible {
  id: string;
  stratum: Stratum;
  kind: Kind;
  coupling: string[];
  large: boolean;
}

export interface Selection {
  n: number;
  targets: Record<Stratum, number>;
  selected: string[];
  by_stratum: Record<Stratum, string[]>;
  deviations: string[];
  shortfalls: string[];
}

/** Stratum sizes for n: easy and hard rounded half up, the rest intermediate. */
export function targets(n: number, r: Rules): Record<Stratum, number> {
  const easy = Math.round(r.easy_share * n);
  const hard = Math.round(r.hard_share * n);
  return { easy, intermediate: n - easy - hard, hard };
}

/**
 * The pre-specified greedy selection. Candidates are visited in rank order;
 * phases: kind minimum, required coupling styles, size share, fill, then a
 * short stratum borrows from its listed strata. A candidate fits while its
 * stratum and its kind (cap floor(kind_max_share * n)) have room. Every
 * quota is evaluated once, on the final selection.
 * ponytail: greedy, not exhaustive; a shortfall it reports may have a
 * feasible combination. Pre-registered as is; the too-few rule handles it.
 */
export function select(
  pool: Eligible[],
  n: number,
  r: Rules,
  rank: Map<string, string>,
): Selection {
  const target = targets(n, r);
  const kindMax = Math.floor(r.kind_max_share * n);
  const largeMin = Math.ceil(r.large_min_share * n);
  const order = [...pool].sort((a, b) => byRank(rank)(a.id, b.id));
  const chosen: Eligible[] = [];
  const slot = new Map<string, Stratum>();
  const deviations: string[] = [];
  const count = (f: (e: Eligible) => boolean) => chosen.filter(f).length;
  const inStratum = (s: Stratum) => count((e) => slot.get(e.id) === s);
  const kindRoom = (e: Eligible) => count((x) => x.kind === e.kind) < kindMax;
  const fits = (e: Eligible) =>
    !chosen.includes(e) && kindRoom(e) &&
    inStratum(e.stratum) < target[e.stratum];
  const add = (e: Eligible, s: Stratum) => {
    chosen.push(e);
    slot.set(e.id, s);
  };
  const fill = (need: () => boolean, pred: (e: Eligible) => boolean) => {
    while (need()) {
      const e = order.find((x) => fits(x) && pred(x));
      if (!e) return;
      add(e, e.stratum);
    }
  };
  const quotas: [string, (e: Eligible) => boolean, number][] = [
    ...TASK_KINDS.map((k): [string, (e: Eligible) => boolean, number] => [
      `kind ${k}`,
      (e) => e.kind === k,
      r.kind_min,
    ]),
    ...r.required_coupling.map((
      s,
    ): [string, (e: Eligible) => boolean, number] => [
      `coupling ${s}`,
      (e) => e.coupling.includes(s),
      r.coupling_min,
    ]),
    ["large", (e) => e.large, largeMin],
  ];
  for (const [, pred, min] of quotas) fill(() => count(pred) < min, pred);
  fill(() => chosen.length < n, () => true);
  for (const s of STRATA) {
    for (const from of r.borrow[s]) {
      while (inStratum(s) < target[s]) {
        const e = order.find((x) =>
          !chosen.includes(x) && x.stratum === from && kindRoom(x)
        );
        if (!e) break;
        add(e, s);
        deviations.push(`${e.id} (${from}) fills the ${s} stratum`);
      }
    }
  }
  const shortfalls = [
    ...quotas.filter(([, pred, min]) => count(pred) < min)
      .map(([what, pred, min]) => `${what}: ${count(pred)} of ${min}`),
    ...STRATA.filter((s) => inStratum(s) < target[s])
      .map((s) => `stratum ${s}: ${inStratum(s)} of ${target[s]}`),
  ];
  const ids = (f: (e: Eligible) => boolean) =>
    chosen.filter(f).map((e) => e.id).sort();
  return {
    n,
    targets: target,
    selected: ids(() => true),
    by_stratum: {
      easy: ids((e) => slot.get(e.id) === "easy"),
      intermediate: ids((e) => slot.get(e.id) === "intermediate"),
      hard: ids((e) => slot.get(e.id) === "hard"),
    },
    deviations,
    shortfalls,
  };
}

/** `tasks:` glob of an experiment that runs exactly these ids. */
export const tasksGlob = (ids: string[]): string =>
  ids.length === 1
    ? `harness-tasks/tasks/${ids[0]}`
    : `harness-tasks/tasks/{${[...ids].sort().join(",")}}`;

// ---- I/O ----

async function git(root: string, args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new ValidationError(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr).trim()}`,
      args,
    );
  }
  return new TextDecoder().decode(out.stdout);
}

export const commitOf = async (root: string, rev: string): Promise<string> =>
  (await git(root, ["rev-parse", "--verify", `${rev}^{commit}`])).trim();

async function yamlAt<T extends z.ZodType>(
  root: string,
  rev: string,
  path: string,
  schema: T,
): Promise<z.output<T>> {
  const r = schema.safeParse(
    parse(await git(root, ["show", `${rev}:${path}`])),
  );
  if (!r.success) {
    const errors = r.error.issues.map((i) =>
      `${i.path.join(".")}: ${i.message}`
    );
    throw new ValidationError(
      `${path} at ${rev}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return r.data;
}

/** Tree id of every task folder at `rev`. */
export async function treesAt(
  root: string,
  rev: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (
    const line of (await git(root, ["ls-tree", rev, "harness-tasks/tasks/"]))
      .split("\n")
  ) {
    const m = line.match(
      /^040000 tree ([0-9a-f]+)\tharness-tasks\/tasks\/(HX-\d{3})$/,
    );
    if (m) out.set(m[2]!, m[1]!);
  }
  return out;
}

/** kind, coupling and size of each candidate at `rev`. */
export async function metaAt(
  root: string,
  rev: string,
  s: Screening,
  ids: string[],
): Promise<TaskMeta[]> {
  const out: TaskMeta[] = [];
  for (const id of ids) {
    const t = HarnessTaskSchema.parse(
      parse(
        await git(root, ["show", `${rev}:harness-tasks/tasks/${id}/task.yml`]),
      ),
    );
    const c = s.candidates.find((x) => x.id === id)!;
    out.push({ id, kind: t.kind, coupling: t.coupling, large: isLarge(c) });
  }
  return out;
}

export interface SealState {
  tag: string;
  commit: string;
  seed: string;
  round_time: string;
  screening: Screening;
  trees: Map<string, string>;
}

async function tryGit(root: string, args: string[]): Promise<string | null> {
  try {
    return (await git(root, args)).trim();
  } catch (err) {
    if (err instanceof ValidationError) return null;
    throw err;
  }
}

/** Tag resolutions and the ledger as committed at each seal tag and -ledger tag. */
export async function loadLedgerAnchors(
  root: string,
  head: SealEntry[],
): Promise<LedgerAnchors> {
  const problems = new Set<string>();
  const a: LedgerAnchors = {
    refs: new Map(),
    atSeal: new Map(),
    atLedger: new Map(),
    published: new Map(),
  };
  // Run 002: null only on a confirmed path absence (the commit is readable,
  // the path is not in it); any other git failure throws.
  const ledgerAt = async (rev: string): Promise<SealEntry[] | null> => {
    if (
      await tryGit(root, ["cat-file", "-e", `${rev}:${SEALS_PATH}`]) === null
    ) {
      await git(root, ["cat-file", "-e", `${rev}^{commit}`]);
      return null;
    }
    const text = await git(root, ["show", `${rev}:${SEALS_PATH}`]);
    return SealsSchema.parse(parse(text)).seals;
  };
  // Independent of HEAD, origin is authoritative (run 002): the tag object
  // origin advertises is the one read, for seal and ledger tags alike; a local
  // tag that names another object is a problem. The object is fetched when
  // absent (no local ref is written). If origin cannot be reached the check
  // throws (never treated as "no tags").
  const origin = new Map<string, string>();
  for (
    const line of (await git(root, [
      "ls-remote",
      "--tags",
      "origin",
      "refs/tags/harness-v2-screen-*",
    ])).split("\n")
  ) {
    const m = line.trim().match(/^([0-9a-f]{40})\trefs\/tags\/(\S+)$/);
    if (m && !m[2]!.endsWith("^{}")) origin.set(m[2]!, m[1]!);
  }
  const localRef = (t: string) =>
    tryGit(root, ["rev-parse", "--verify", "--quiet", `refs/tags/${t}`]);
  for (const [t, obj] of [...origin].sort(([x], [y]) => x.localeCompare(y))) {
    const local = await localRef(t);
    if (local !== null && local !== obj) {
      problems.add(
        `${t}: local tag object ${local} differs from origin ${obj}`,
      );
    }
    if (await tryGit(root, ["cat-file", "-e", obj]) === null) {
      await git(root, ["fetch", "--no-tags", "origin", `refs/tags/${t}`]);
      await git(root, ["cat-file", "-e", obj]);
    }
  }
  /** Tag object of `t` (origin's, else the local one), null when neither has it. */
  const resolve = async (t: string): Promise<string | null> => {
    const obj = origin.get(t) ?? await localRef(t);
    if (obj === null) return null;
    if ((await git(root, ["cat-file", "-t", obj])).trim() !== "tag") {
      problems.add(`${t}: not an annotated tag`);
    }
    return obj;
  };
  const local = (await git(root, ["tag", "-l", "harness-v2-screen-*-ledger"]))
    .split("\n").map((t) => t.trim());
  const names = new Set(
    [...origin.keys(), ...local].filter((t) => t.endsWith("-ledger")),
  );
  for (const t of [...names].sort()) {
    const obj = await resolve(t);
    a.published.set(t, obj === null ? null : await ledgerAt(`${obj}^{commit}`));
  }
  for (const e of head) {
    const obj = await resolve(e.tag);
    if (obj === null) {
      a.atSeal.set(e.tag, null);
    } else {
      const commit =
        (await git(root, ["rev-parse", "--verify", `${obj}^{commit}`])).trim();
      a.refs.set(e.tag, { tag_object: obj, commit });
      a.atSeal.set(e.tag, await ledgerAt(commit));
    }
    const led = await resolve(`${e.tag}-ledger`);
    a.atLedger.set(
      e.tag,
      led === null ? null : await ledgerAt(`${led}^{commit}`),
    );
  }
  a.problems = [...problems];
  return a;
}

/** Every seal of the HEAD ledger, plus every ledger problem (never trusted unverified). */
export async function loadSeals(
  root: string,
): Promise<{ seals: SealState[]; problems: string[] }> {
  const ledger = (await yamlAt(root, "HEAD", SEALS_PATH, SealsSchema)).seals;
  const problems = await ledgerProblems(
    ledger,
    await loadLedgerAnchors(root, ledger),
  );
  const out: SealState[] = [];
  for (const s of ledger) {
    // The recorded commit; ledgerProblems reports it when the tag disagrees.
    const commit = s.commit;
    const screening = await yamlAt(
      root,
      commit,
      REGISTRY_PATH,
      ScreeningSchema,
    );
    const all = await treesAt(root, commit);
    out.push({
      tag: s.tag,
      commit,
      seed: seedOf(commit, s.randomness),
      round_time: s.round_time,
      screening,
      trees: new Map(
        screening.candidates.map((c) => [c.id, all.get(c.id) ?? "(missing)"]),
      ),
    });
  }
  return { seals: out, problems };
}

/** Every campaign of every v2-screen-* experiment, with cells and the identities it ran. */
export async function loadScreenCampaigns(
  resultsDir: string,
  rules: Rules,
): Promise<{ campaigns: ScreenCampaign[]; ran: Map<string, TaskIdentity[]> }> {
  const store = new RecordStore(resultsDir);
  const campaigns: ScreenCampaign[] = [];
  const ran = new Map<string, TaskIdentity[]>();
  const dir = join(resultsDir, "campaigns");
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".json")) continue;
    const c = CampaignRecordSchema.parse(
      JSON.parse(await Deno.readTextFile(join(dir, e.name))),
    );
    if (!c.experiment.id.startsWith(SCREEN_PREFIX)) continue;
    const arms = [c.experiment.baseline, ...c.experiment.variants].sort();
    if (
      arms.join() !== [...rules.arms].sort().join() ||
      c.experiment.repeats !== rules.repeats
    ) {
      throw new ValidationError(
        `campaign ${c.id} (${c.experiment.id}) does not run the screening arms x ${rules.repeats}`,
        [c.id],
      );
    }
    const data = await loadCampaignData(store, c);
    await validateCampaignRecords(data);
    const byExecution = new Map<string, JudgmentRecord[]>();
    for (const j of data.judgments) {
      byExecution.set(j.execution_id, [
        ...(byExecution.get(j.execution_id) ?? []),
        j,
      ]);
    }
    campaigns.push({
      id: c.id,
      experiment: c.experiment.id,
      created_at: c.created_at,
      cells: cellsFromRecords(c, data.executions, byExecution),
    });
    ran.set(c.id, c.task_set.tasks);
  }
  return { campaigns, ran };
}

async function main(): Promise<number> {
  const a = parseArgs(Deno.args, {
    string: ["results-dir", "out", "n"],
    default: {
      "results-dir": "results/harness",
      out: "harness-tasks/v2/selection.json",
    },
  });
  const cmd = String(a._[0] ?? "");
  const root = Deno.cwd();
  if (
    (await git(root, ["status", "--porcelain", "--", "harness-tasks"])).trim()
  ) {
    console.error(colors.red("[FAIL] harness-tasks has uncommitted changes"));
    return 1;
  }
  const { seals, problems: ledgerIssues } = await loadSeals(root);
  if (ledgerIssues.length > 0) {
    for (const p of ledgerIssues) console.error(colors.red(`[FAIL] ${p}`));
    return 1;
  }
  const start = seals[0]!;
  const startIds = start.screening.candidates.map((c) => c.id);
  const heldOut = pickHeldOut(
    await metaAt(root, start.commit, start.screening, startIds),
    await ranks(start.seed, startIds),
    start.screening.rules,
  ).sort();
  if (cmd === "heldout") {
    console.log(`held_out: ${heldOut.join(", ")}`);
    console.log(
      `tasks: "${tasksGlob(startIds.filter((id) => !heldOut.includes(id)))}"`,
    );
    return 0;
  }
  if (cmd !== "status" && cmd !== "select") {
    console.error("usage: screening.ts heldout | status | select --n <N>");
    return 1;
  }
  const head = await commitOf(root, "HEAD");
  const now = await yamlAt(root, head, REGISTRY_PATH, ScreeningSchema);
  const headTrees = await treesAt(root, head);
  // The seal where each candidate first appears fixes its metadata and seed.
  const firstSeal = new Map<string, SealState>();
  for (const s of seals) {
    for (const c of s.screening.candidates) {
      if (!firstSeal.has(c.id)) firstSeal.set(c.id, s);
    }
  }
  const sealedIds = [...firstSeal.keys()];
  const current = await taskSetIdentity(
    root,
    await Promise.all(
      sealedIds.map((id) => loadTask(join(root, "harness-tasks", "tasks", id))),
    ),
    await loadSymbolsLock(root),
  );
  const { campaigns, ran } = await loadScreenCampaigns(
    a["results-dir"],
    now.rules,
  );
  const hist = screeningHistory(campaigns, now.rules);
  const tallies = tally(hist.cells, now.rules);
  const status = classify(
    now,
    new Set(sealedIds),
    heldOut,
    tallies,
    hist.screens,
  );
  const problems = [
    ...seals.flatMap((s) => [
      ...appendOnlyProblems(s.tag, s.screening, now),
      ...treeProblems(s.tag, s.trees, headTrees),
    ]),
    ...[...ran].flatMap(([id, t]) => identityProblems(id, t, current.tasks)),
    ...chronologyProblems(
      campaigns.map((c) => ({
        id: c.id,
        created_at: c.created_at,
        tasks: (ran.get(c.id) ?? []).map((t) => t.id),
      })),
      new Map([...firstSeal].map(([id, s]) => [id, s.round_time])),
    ),
    ...hist.problems,
    ...contaminationProblems(status, tallies.keys()),
    ...supersedeProblems(now, status),
  ];
  for (const p of problems) console.error(colors.red(`[FAIL] ${p}`));
  if (problems.length > 0) return 1;
  for (const [id, s] of status) {
    const t = tallies.get(id);
    console.log(`${id} ${s}${t ? ` ${t.solved}/${t.scored}` : ""}`);
  }
  const rescreen = [...status].filter(([, s]) =>
    s === "incomplete" || s === "unscreened"
  ).map(([id]) => id);
  if (rescreen.length > 0) {
    console.log(`next screen tasks: "${tasksGlob(rescreen)}"`);
  }
  if (cmd === "status") return 0;
  const n = Number(a.n);
  if (!Number.isInteger(n) || n < 1) {
    console.error(colors.red("[FAIL] --n must be a positive integer"));
    return 1;
  }
  if (rescreen.length > 0 || [...status.values()].includes("unsealed")) {
    console.error(
      colors.red("[FAIL] select needs every candidate sealed and screened"),
    );
    return 1;
  }
  const pool: Eligible[] = [];
  const rank = new Map<string, string>();
  for (const s of seals) {
    const ids = s.screening.candidates.map((c) => c.id).filter((id) =>
      firstSeal.get(id) === s &&
      (STRATA as readonly string[]).includes(status.get(id)!)
    );
    for (const m of await metaAt(root, s.commit, s.screening, ids)) {
      pool.push({ ...m, stratum: status.get(m.id) as Stratum });
    }
    for (const [id, k] of await ranks(s.seed, ids)) rank.set(id, k);
  }
  const selection = select(pool, n, now.rules, rank);
  const ok = selection.shortfalls.length === 0;
  await Deno.writeTextFile(
    a.out,
    JSON.stringify(
      {
        v: 1,
        status: ok ? "ok" : "too_few",
        head,
        seals: seals.map((s) => ({ tag: s.tag, commit: s.commit })),
        campaigns: campaigns.map((c) => ({
          id: c.id,
          experiment: c.experiment,
        })),
        held_out: heldOut,
        confirmatory_tasks: tasksGlob(selection.selected),
        held_out_tasks: tasksGlob(heldOut),
        candidates: Object.fromEntries(
          [...status].map((
            [id, s],
          ) => [id, { status: s, ...(tallies.get(id) ?? {}) }]),
        ),
        selection,
      },
      null,
      2,
    ) + "\n",
  );
  for (const d of selection.deviations) {
    console.log(colors.yellow(`[WARN] ${d}`));
  }
  for (const s of selection.shortfalls) {
    console.error(colors.red(`[FAIL] ${s}`));
  }
  console.log(
    ok
      ? colors.green(`[OK] ${selection.selected.length} tasks -> ${a.out}`)
      : colors.red(`[FAIL] too few candidates -> ${a.out}`),
  );
  return ok ? 0 : 2;
}

if (import.meta.main) Deno.exit(await main());
