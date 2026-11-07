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
import type {
  AccountRetirement,
  CampaignRecord,
  ExecutionRecord,
  JudgmentRecord,
} from "../../src/harness/records.ts";
import type { Cell } from "../../src/harness/stats.ts";
import { ValidationError } from "../../src/errors.ts";
import { loadCampaignData } from "../../src/harness/campaign.ts";
import { hashJson, sha256Hex } from "../../src/harness/hash.ts";
import {
  loadSymbolsLock,
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import { validateCampaignRecords } from "../../src/harness/integrity.ts";
import {
  accountCounts,
  checkOneEnvironment,
} from "../../src/harness/report.ts";
import { descriptorLoader } from "../../src/harness/task-oracle.ts";
import {
  campaignJudging,
  cellsFromRecords,
  selectJudgment,
} from "../../src/harness/outcome.ts";
import {
  CampaignRecordSchema,
  compareInstant,
  outcomePolicy,
  RecordStore,
  retryChains,
} from "../../src/harness/records.ts";
import {
  HarnessTaskSchema,
  loadTask,
  TASK_KINDS,
} from "../../src/harness/task.ts";
// H-68: a static import cycle (prescreen.ts imports this module). Neither
// module uses the other's bindings at top level, so evaluation order is safe;
// a dynamic import inside main() deadlocked on this module's top-level await.
import { evaluatePrescreen, PRESCREEN_PREFIX } from "./prescreen.ts";

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
  | "held_out"
  /** H-68: a non-audited pre-screen reject of a filter round (prescreen.ts). */
  | "provisionally_saturated";

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

/**
 * H-68: a protocol amendment (prescreen.ts). Each round names the seal whose
 * candidates it covers; a round is fixed by the registry committed at that
 * seal. Not part of `rules`, so appending it is no append-only problem.
 */
export const AmendmentSchema = z.strictObject({
  id: z.literal("prescreen"),
  decision: z.string().min(1),
  rounds: z.array(z.strictObject({
    seal: z.string().regex(/^harness-v2-screen-[a-z0-9-]+$/),
    mode: z.enum(["calibration", "filter"]),
  })),
});
export type Amendment = z.output<typeof AmendmentSchema>;

export const ScreeningSchema = z.strictObject({
  v: z.literal(1),
  rules: RulesSchema,
  candidates: z.array(CandidateSchema).default([]),
  amendments: z.array(AmendmentSchema).default([]),
}).superRefine((s, ctx) => {
  const aids = s.amendments.map((a) => a.id);
  if (new Set(aids).size !== aids.length) {
    ctx.addIssue({
      code: "custom",
      message: "duplicate amendment",
      path: ["amendments"],
    });
  }
  for (const a of s.amendments) {
    const seals = a.rounds.map((r) => r.seal);
    if (new Set(seals).size !== seals.length) {
      ctx.addIssue({
        code: "custom",
        message: `${a.id}: duplicate round seal`,
        path: ["amendments"],
      });
    }
    if (a.rounds.length > 0 && a.rounds[0]!.mode !== "calibration") {
      ctx.addIssue({
        code: "custom",
        message: `${a.id}: the first round must be calibration`,
        path: ["amendments"],
      });
    }
  }
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

export interface Excluded {
  execution: string;
  task: string;
  reason: "harness_crash";
}

/**
 * H-29 (decision 2026-10-18-screening-crash-cells): a cell whose counted
 * execution ended in harness_crash never counts, whatever its verdict, so its
 * task is incomplete and gets its one rescreen. Screening only: records and
 * the report are unchanged.
 */
export function excludeCrashCells(
  cells: (Cell & { used_execution: string | null })[],
  executions: Pick<ExecutionRecord, "id" | "termination">[],
): { cells: Cell[]; excluded: Excluded[] } {
  const crashed = new Set(
    executions.filter((e) => e.termination === "harness_crash").map((e) =>
      e.id
    ),
  );
  const excluded: Excluded[] = [];
  const out = cells.map((c) => {
    if (c.used_execution === null || !crashed.has(c.used_execution)) return c;
    excluded.push({
      execution: c.used_execution,
      task: c.task,
      reason: "harness_crash",
    });
    return {
      ...c,
      status: "unscored" as const,
      pass: null,
      reason: "harness_crash",
    };
  });
  return { cells: out, excluded };
}

/** Status lines for excluded cells: execution, task, reason; never the arm. */
export function excludedLines(excluded: Excluded[]): string[] {
  return excluded.map((x) => `excluded ${x.execution} ${x.task} ${x.reason}`);
}

/**
 * Tasks the next screen must run: incomplete or never screened. H-51: a
 * candidate in `ruled` (flagged by --stratify-env) waits for a ruling instead.
 */
export function rescreenTasks(
  status: Map<string, Status>,
  ruled: { has(id: string): boolean } = new Set(),
): string[] {
  return [...status].filter(([id, s]) =>
    (s === "incomplete" || s === "unscreened") && !ruled.has(id)
  ).map(([id]) => id);
}

export interface ScreenCampaign {
  id: string;
  experiment: string;
  created_at: string;
  cells: EnvCell[];
  /** H-29: cells excluded because their execution ended in harness_crash. */
  excluded?: Excluded[];
  /** M8-02b: problems found in the campaign's raw records (manualRerunProblems). */
  problems?: string[];
  /** H-53: executions and usage limits per account label. */
  accounts?: ReturnType<typeof accountCounts>;
  /** H-61: accounts retired from the campaign's pool. */
  retirements?: readonly AccountRetirement[];
  /** H-68: per task, when its last counted judgment ended (completionTimes). */
  completed_at?: Record<string, string>;
}

/** H-68: per task, the latest end of a counted judgment of its cells. */
export function completionTimes(
  cells: readonly { task: string; judgment_id: string | null }[],
  judgments: readonly JudgmentRecord[],
): Record<string, string> {
  const byId = new Map(judgments.map((j) => [j.id, j]));
  const out: Record<string, string> = {};
  for (const c of cells) {
    const j = c.judgment_id ? byId.get(c.judgment_id) : undefined;
    if (!j) continue;
    const prev = out[c.task];
    if (prev === undefined || compareInstant(prev, j.ended_at) < 0) {
      out[c.task] = j.ended_at;
    }
  }
  return out;
}

/** H-53: per account label over every campaign (status prints it, triage reads it). */
export function accountLines(campaigns: readonly ScreenCampaign[]): string[] {
  const all = new Map<string, { executions: number; usage_limited: number }>();
  for (const c of campaigns) {
    for (const [l, a] of Object.entries(c.accounts ?? {})) {
      const t = all.get(l) ?? { executions: 0, usage_limited: 0 };
      t.executions += a.executions;
      t.usage_limited += a.usage_limited;
      all.set(l, t);
    }
  }
  const retired = new Map(
    campaigns.flatMap((c) => c.retirements ?? []).map((r) => [r.label, r]),
  );
  for (const l of retired.keys()) {
    if (!all.has(l)) all.set(l, { executions: 0, usage_limited: 0 });
  }
  return [...all].sort(([a], [b]) => a < b ? -1 : 1).map((
    [l, a],
  ) =>
    `account ${l}: ${a.executions} execution(s), ${a.usage_limited} usage_limited${
      retired.has(l)
        ? ` [RETIRED by ${retired.get(l)!.by} ${retired.get(l)!.at}: ${
          retired.get(l)!.reason
        }]`
        : ""
    }`
  );
}

/**
 * M8-02b: a cell with two or more SCORED manual reruns. cellsFromRecords
 * would let the newest replace the older scored result (outcome.ts
 * resolveChain + manual pick); the CLI never writes such records
 * (campaign.ts rerunTarget), hand-made ones can. "Scored" mirrors
 * resolveChain: the chain's last member is judged and its selected verdict
 * is not "unscored".
 */
export function manualRerunProblems(
  c: CampaignRecord,
  executions: ExecutionRecord[],
  judgments: JudgmentRecord[],
): string[] {
  const oracle = campaignJudging(c).oracle;
  const byCell = new Map<string, ExecutionRecord[]>();
  for (const e of executions) {
    const k = `${e.task_id}/${e.repeat}/${e.arm}`;
    byCell.set(k, [...(byCell.get(k) ?? []), e]);
  }
  return [...byCell].sort(([a], [b]) => a.localeCompare(b)).flatMap(
    ([label, cell]) => {
      const scored = retryChains(cell).chains.filter((ch) => {
        if (ch.root.run_kind !== "manual_rerun") return false;
        const last = ch.members[ch.members.length - 1]!;
        if (!outcomePolicy(last.termination, last.did_work).judge) {
          return false;
        }
        const j = selectJudgment(
          last,
          judgments,
          oracle.get(last.task_id) ?? "",
        );
        return j !== null && j.verdict !== "unscored";
      }).length;
      return scored > 1
        ? [`campaign ${c.id}: cell ${label} has ${scored} scored manual reruns`]
        : [];
    },
  );
}

/** H-68 r3: the outcome of a cell's first execution attempt. */
export type FirstAttempt = "pass" | "fail" | "live";

/**
 * H-68 r3: per planned cell (`task/repeat/arm`), its first execution
 * attempt's outcome (the planned root; an automatic retry or a manual rerun
 * is never read). Not started, or ended and not yet judged: live. r4: it
 * freezes on the attempt's first judgment (pass, else fail; an unscored one
 * is a fail, Q4), and a later rejudge never changes it. A crash (H-29) or an
 * unjudged ending (setup_failed, usage_limited): fail.
 */
export function firstAttempts(
  c: CampaignRecord,
  executions: ExecutionRecord[],
  judgments: JudgmentRecord[],
): Map<string, FirstAttempt> {
  const oracle = campaignJudging(c).oracle;
  const out = new Map<string, FirstAttempt>();
  for (const b of c.blocks) {
    for (const arm of b.order) {
      const root = executions.find((e) =>
        e.task_id === b.task_id && e.repeat === b.repeat && e.arm === arm &&
        e.run_kind === "planned"
      );
      const key = `${b.task_id}/${b.repeat}/${arm}`;
      if (!root) {
        out.set(key, "live");
      } else if (
        root.termination === "harness_crash" ||
        !outcomePolicy(root.termination, root.did_work).judge
      ) {
        out.set(key, "fail");
      } else {
        // r4: the FIRST judgment (earliest ended_at, then id), never the
        // latest selectJudgment would count, so a rejudge cannot move it.
        const o = oracle.get(root.task_id) ?? "";
        const j = judgments.filter((x) =>
          x.execution_id === root.id && x.task_id === root.task_id &&
          x.workspace_hash === root.workspace_hash && x.task_oracle_hash === o
        ).sort((a, b) =>
          compareInstant(a.ended_at, b.ended_at) || (a.id < b.id ? -1 : 1)
        )[0];
        out.set(
          key,
          !j ? "live" : j.verdict === "pass" ? "pass" : "fail",
        );
      }
    }
  }
  return out;
}

/**
 * Every screening campaign, oldest first. One campaign per experiment, no
 * duplicate ids. A task may be screened again only while its previous screen
 * is incomplete, and at most twice; the newest screen replaces all its cells.
 */
export function screeningHistory(
  campaigns: ScreenCampaign[],
  rules: Rules,
): {
  cells: EnvCell[];
  screens: Map<string, number>;
  problems: string[];
  /** H-29: the excluded cells of each task's counted (newest) screen. */
  excluded: Excluded[];
} {
  const problems: string[] = [];
  const ids = campaigns.map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate campaign id");
  const exps = campaigns.map((c) => c.experiment);
  for (const x of new Set(exps.filter((e, i) => exps.indexOf(e) !== i))) {
    problems.push(`experiment ${x} has more than one campaign`);
  }
  for (const c of campaigns) problems.push(...(c.problems ?? []));
  const latest = new Map<string, EnvCell[]>();
  const latestExcluded = new Map<string, Excluded[]>();
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
      latestExcluded.set(t, (c.excluded ?? []).filter((x) => x.task === t));
    }
  }
  return {
    cells: [...latest.values()].flat(),
    screens,
    problems,
    excluded: [...latestExcluded.values()].flat(),
  };
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
  /** H-68: non-audited pre-screen rejects of filter rounds (prescreen.ts). */
  provisional: { has(id: string): boolean } = new Set(),
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
        : provisional.has(c.id)
        ? "provisionally_saturated"
        : !t
        ? "unscreened"
        : !t.complete
        ? ((screens.get(c.id) ?? 0) >= 2 ? "unscreenable" : "incomplete")
        : stratumOf(t.solved, total),
    );
  }
  return status;
}

/**
 * H-51: a cell plus its environment, the counted v2 judgment's env_fp
 * ("(none)" when that is unknown, as checkOneEnvironment; "(no container)"
 * when the judgment recorded env_none, H-63), "(v1)" for a
 * legacy judgment (no env_fp, so never pooled with one), null without a
 * counted judgment (such a cell is never scored).
 */
export type EnvCell = Cell & {
  env?: string | null;
  /** H-68 r3: the loader's firstAttempts outcome (pre-screen verdicts read it). */
  first?: FirstAttempt;
  /** H-68 r3: manual reruns of the cell (CellRecord.manual_reruns). */
  manual_reruns?: number;
};

export function cellEnvs<T extends { judgment_id: string | null }>(
  cells: T[],
  judgments: readonly JudgmentRecord[],
): (T & { env: string | null })[] {
  const byId = new Map(judgments.map((j) => [j.id, j]));
  return cells.map((c) => {
    const j = c.judgment_id ? byId.get(c.judgment_id) : undefined;
    return {
      ...c,
      env: !j ? null : j.v === 2
        ? j.provenance?.env_fp ??
          (j.provenance?.env_none !== undefined ? "(no container)" : "(none)")
        : "(v1)",
    };
  });
}

export interface EnvStratum {
  env: string;
  status: Status;
  solved: number;
  scored: number;
}

const RESOLVED = new Set<Status>([...STRATA, "dead", "saturated"]);
const FROM_TALLY = new Set<Status>([...RESOLVED, "incomplete", "unscreenable"]);

/**
 * H-51 `--stratify-env`: classify with pooled verdicts computed per env_fp,
 * never across one. A candidate whose cells span more than one env_fp gets
 * a status per stratum and is flagged when they disagree or when no stratum
 * has enough cells for a status; its own status is then "incomplete", and
 * the caller keeps it out of the next screen (the orchestrator rules).
 */
export function stratifyByEnv(
  s: Screening,
  sealed: Set<string>,
  heldOut: string[],
  cells: EnvCell[],
  screens: Map<string, number>,
  /** H-68: as classify. */
  provisional: { has(id: string): boolean } = new Set(),
): {
  status: Map<string, Status>;
  strata: Map<string, EnvStratum[]>;
  flagged: Map<string, string>;
} {
  const status = classify(
    s,
    sealed,
    heldOut,
    tally(cells, s.rules),
    screens,
    provisional,
  );
  const strata = new Map<string, EnvStratum[]>();
  const flagged = new Map<string, string>();
  const envs = new Map<string, Set<string>>();
  for (const c of cells) {
    if (c.env == null) continue;
    envs.set(c.task, (envs.get(c.task) ?? new Set()).add(c.env));
  }
  for (const [id, set] of envs) {
    if (set.size < 2 || !status.has(id)) continue;
    const per = [...set].sort().map((env): EnvStratum => {
      // An env-less cell is never scored; it joins every stratum of its task.
      const t = tally(
        cells.filter((c) => c.task === id && (c.env ?? env) === env),
        s.rules,
      ).get(id)!;
      const st = classify(s, sealed, heldOut, new Map([[id, t]]), screens)
        .get(id)!;
      return { env, status: st, solved: t.solved, scored: t.scored };
    });
    strata.set(id, per);
    if (!FROM_TALLY.has(status.get(id)!)) continue;
    const reason = new Set(per.map((p) => p.status)).size > 1
      ? "strata disagree"
      : RESOLVED.has(per[0]!.status)
      ? null
      : "no stratum has enough cells for a status";
    status.set(id, reason === null ? per[0]!.status : "incomplete");
    if (reason !== null) flagged.set(id, reason);
  }
  return { status, strata, flagged };
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

const REDESIGNABLE = new Set<Status>([
  "dead",
  "saturated",
  "broken",
  "provisionally_saturated",
]);

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

async function git(
  root: string,
  args: string[],
  /** M8-02b run 002: any stderr output is a failure even when git exits 0. */
  strict = false,
): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const err = new TextDecoder().decode(out.stderr).trim();
  if (!out.success || (strict && err !== "")) {
    throw new ValidationError(`git ${args.join(" ")}: ${err}`, args);
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
  // M8-02b: null only when the readable tree at `rev` has no seals.yml entry
  // (ls-tree throws on an unreadable commit or tree). A path entry whose blob
  // cannot be read throws in `git show`, as does any other git failure.
  // Run 002: the traversal must also be error-free; git reports an unreadable
  // intermediate tree on stderr (git 2.55 also exits 1, other versions may
  // exit 0), so any stderr from ls-tree is a throw, never an absence.
  const ledgerAt = async (rev: string): Promise<SealEntry[] | null> => {
    if (
      (await git(root, ["ls-tree", rev, "--", SEALS_PATH], true)).trim() === ""
    ) {
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
  /** H-35: where a legacy task descriptor is recovered from (git history). */
  repoRoot = ".",
  /** H-51: cells carry their env_fp and a mix is stratified, not refused. */
  stratifyEnv = false,
  /** H-68: the experiment prefix read (prescreen.ts reads PRESCREEN_PREFIX). */
  prefix = SCREEN_PREFIX,
  /** H-68: the repeats each campaign must run (a pre-screen runs 1). */
  repeats = rules.repeats,
): Promise<{ campaigns: ScreenCampaign[]; ran: Map<string, TaskIdentity[]> }> {
  const store = new RecordStore(resultsDir);
  const campaigns: ScreenCampaign[] = [];
  const ran = new Map<string, TaskIdentity[]>();
  // H-35 S3.3: the screening pools campaigns, so one environment across all.
  const counted: { judgment_id: string | null }[] = [];
  const judged: JudgmentRecord[] = [];
  const dir = join(resultsDir, "campaigns");
  // M8-15c: no campaigns directory yet (nothing screened) is no campaigns.
  const st = await Deno.lstat(dir).catch((err) => {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  });
  if (st === null) return { campaigns, ran };
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".json")) continue;
    const c = CampaignRecordSchema.parse(
      JSON.parse(await Deno.readTextFile(join(dir, e.name))),
    );
    if (!c.experiment.id.startsWith(prefix)) continue;
    const arms = [c.experiment.baseline, ...c.experiment.variants].sort();
    if (
      arms.join() !== [...rules.arms].sort().join() ||
      c.experiment.repeats !== repeats
    ) {
      throw new ValidationError(
        `campaign ${c.id} (${c.experiment.id}) does not run the screening arms x ${repeats}`,
        [c.id],
      );
    }
    const data = await loadCampaignData(store, c);
    // H-35 S2.5: scorer names checked against the task preimage store.
    await validateCampaignRecords(data, {
      descriptor: descriptorLoader(resultsDir, repoRoot),
      resultsRoot: resultsDir,
    });
    const byExecution = new Map<string, JudgmentRecord[]>();
    for (const j of data.judgments) {
      byExecution.set(j.execution_id, [
        ...(byExecution.get(j.execution_id) ?? []),
        j,
      ]);
    }
    const records = cellsFromRecords(c, data.executions, byExecution);
    counted.push(...records);
    judged.push(...data.judgments);
    const { cells, excluded } = excludeCrashCells(records, data.executions);
    const envs = cellEnvs(records, data.judgments);
    const first = firstAttempts(c, data.executions, data.judgments);
    campaigns.push({
      id: c.id,
      experiment: c.experiment.id,
      created_at: c.created_at,
      // excludeCrashCells keeps order, so cells[i] is records[i].
      cells: cells.map((x, i) => ({
        ...x,
        env: envs[i]!.env,
        // Both come from campaign.blocks, so every cell has an entry.
        first: first.get(`${x.task}/${x.repeat}/${x.arm}`) ?? "live",
        manual_reruns: records[i]!.manual_reruns,
      })),
      excluded,
      problems: manualRerunProblems(c, data.executions, data.judgments),
      accounts: accountCounts(data.executions),
      retirements: data.retirements ?? [],
      completed_at: completionTimes(records, data.judgments),
    });
    ran.set(c.id, c.task_set.tasks);
  }
  if (!stratifyEnv) checkOneEnvironment(counted, judged);
  return { campaigns, ran };
}

/**
 * The next full screen: rescreenTasks without candidates waiting for a
 * ruling (H-51) or for a filter-round audit (H-68).
 */
export function nextScreenTasks(
  status: Map<string, Status>,
  flagged: { has(id: string): boolean },
  ps: { waiting: { has(id: string): boolean } },
): string[] {
  return rescreenTasks(status, {
    has: (id) => flagged.has(id) || ps.waiting.has(id),
  });
}

/** Why select must not run yet, or null (the H-51 ruling check comes first). */
export function selectRefusal(
  rescreen: string[],
  ps: { waiting: ReadonlySet<string>; missing: ReadonlySet<string> },
  status: Map<string, Status>,
): string | null {
  if (
    rescreen.length > 0 || ps.waiting.size > 0 ||
    [...status.values()].includes("unsealed")
  ) {
    return "select needs every candidate sealed and screened";
  }
  return ps.missing.size > 0
    ? `select needs a finished pre-screen of every calibration candidate: "${
      tasksGlob([...ps.missing])
    }"`
    : null;
}

export interface Opened {
  /** Uncommitted harness-tasks or ledger problems; nothing else is loaded then. */
  problems: string[];
  seals: SealState[];
  heldOut: string[];
  startIds: string[];
}

/** The committed state every command starts from: clean tree, verified ledger, held-out set. */
export async function openScreening(root: string): Promise<Opened> {
  const none = { seals: [], heldOut: [], startIds: [] };
  if (
    (await git(root, ["status", "--porcelain", "--", "harness-tasks"])).trim()
  ) {
    return { problems: ["harness-tasks has uncommitted changes"], ...none };
  }
  const { seals, problems } = await loadSeals(root);
  if (problems.length > 0) return { problems, ...none };
  const start = seals[0]!;
  const startIds = start.screening.candidates.map((c) => c.id);
  const heldOut = pickHeldOut(
    await metaAt(root, start.commit, start.screening, startIds),
    await ranks(start.seed, startIds),
    start.screening.rules,
  ).sort();
  return { problems: [], seals, heldOut, startIds };
}

/**
 * The full screening gate (status and select; H-68: prescreen.ts status
 * too): loads both campaign kinds, classifies, and collects every problem.
 */
export async function screeningGate(
  root: string,
  { seals, heldOut }: Opened,
  resultsDir: string,
  stratifyEnv: boolean,
) {
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
    resultsDir,
    now.rules,
    root,
    stratifyEnv,
  );
  // H-68: the pre-screen. Its campaigns never enter the history; it yields
  // the filter rounds' provisional rejects and the candidates waiting for a
  // pre-screen or an audit.
  const pre = await loadScreenCampaigns(
    resultsDir,
    now.rules,
    root,
    stratifyEnv,
    PRESCREEN_PREFIX,
    1,
  );
  const ps = await evaluatePrescreen({
    now,
    seals,
    heldOut,
    prescreens: pre.campaigns,
    full: campaigns,
  });
  const hist = screeningHistory(campaigns, now.rules);
  const tallies = tally(hist.cells, now.rules);
  // H-51: without --stratify-env, the pooled classify as before (a mixed
  // env_fp was refused above).
  const { status, strata, flagged } = stratifyEnv
    ? stratifyByEnv(
      now,
      new Set(sealedIds),
      heldOut,
      hist.cells,
      hist.screens,
      ps.provisional,
    )
    : {
      status: classify(
        now,
        new Set(sealedIds),
        heldOut,
        tallies,
        hist.screens,
        ps.provisional,
      ),
      strata: new Map<string, EnvStratum[]>(),
      flagged: new Map<string, string>(),
    };
  const problems = [
    ...seals.flatMap((s) => [
      ...appendOnlyProblems(s.tag, s.screening, now),
      ...treeProblems(s.tag, s.trees, headTrees),
    ]),
    ...[...ran, ...pre.ran].flatMap(([id, t]) =>
      identityProblems(id, t, current.tasks)
    ),
    ...chronologyProblems(
      [...campaigns, ...pre.campaigns].map((c) => ({
        id: c.id,
        created_at: c.created_at,
        tasks: (ran.get(c.id) ?? pre.ran.get(c.id) ?? []).map((t) => t.id),
      })),
      new Map([...firstSeal].map(([id, s]) => [id, s.round_time])),
    ),
    ...hist.problems,
    ...contaminationProblems(status, tallies.keys()),
    ...supersedeProblems(now, status),
    ...ps.problems,
  ];
  return {
    head,
    now,
    firstSeal,
    campaigns,
    ps,
    hist,
    tallies,
    status,
    strata,
    flagged,
    problems,
  };
}

async function main(): Promise<number> {
  const a = parseArgs(Deno.args, {
    string: ["results-dir", "out", "n"],
    boolean: ["stratify-env"],
    default: {
      "results-dir": "results/harness",
      out: "harness-tasks/v2/selection.json",
    },
  });
  const cmd = String(a._[0] ?? "");
  const root = Deno.cwd();
  const opened = await openScreening(root);
  if (opened.problems.length > 0) {
    for (const p of opened.problems) console.error(colors.red(`[FAIL] ${p}`));
    return 1;
  }
  const { seals, heldOut, startIds } = opened;
  if (cmd === "heldout") {
    console.log(`held_out: ${heldOut.join(", ")}`);
    console.log(
      `tasks: "${tasksGlob(startIds.filter((id) => !heldOut.includes(id)))}"`,
    );
    return 0;
  }
  if (cmd !== "status" && cmd !== "select") {
    console.error(
      "usage: screening.ts heldout | status [--stratify-env] | select --n <N> [--stratify-env]",
    );
    return 1;
  }
  const {
    head,
    now,
    firstSeal,
    campaigns,
    ps,
    hist,
    tallies,
    status,
    strata,
    flagged,
    problems,
  } = await screeningGate(
    root,
    opened,
    a["results-dir"],
    a["stratify-env"],
  );
  for (const p of problems) console.error(colors.red(`[FAIL] ${p}`));
  if (problems.length > 0) return 1;
  for (const [id, s] of status) {
    const t = tallies.get(id);
    const per = strata.get(id);
    // H-51: a candidate spanning env_fp shows each stratum, never a pooled count.
    console.log(`${id} ${s}${per ? "" : t ? ` ${t.solved}/${t.scored}` : ""}`);
    for (const p of per ?? []) {
      console.log(
        `  env ${p.env.slice(0, 12)} ${p.status} ${p.solved}/${p.scored}`,
      );
    }
  }
  for (const l of excludedLines(hist.excluded)) console.log(l);
  for (const l of accountLines(campaigns)) console.log(l);
  for (const [id, why] of flagged) {
    console.log(colors.yellow(`[FLAG] ${id}: ${why}; needs a ruling`));
  }
  if (ps.provisional.size > 0) {
    console.log(`provisionally saturated: "${tasksGlob([...ps.provisional])}"`);
  }
  if (ps.waiting.size > 0) {
    console.log(colors.yellow(
      `[WAIT] pre-screen audit pending: "${tasksGlob([...ps.waiting])}"`,
    ));
  }
  if (ps.missing.size > 0) {
    console.log(colors.yellow(
      `[WAIT] calibration pre-screen missing: "${tasksGlob([...ps.missing])}"`,
    ));
  }
  const rescreen = nextScreenTasks(status, flagged, ps);
  if (rescreen.length > 0) {
    console.log(`next screen tasks: "${tasksGlob(rescreen)}"`);
  }
  if (cmd === "status") return 0;
  if (flagged.size > 0) {
    console.error(colors.red(
      `[FAIL] select needs a ruling on ${[...flagged.keys()].join(", ")}`,
    ));
    return 1;
  }
  const n = Number(a.n);
  if (!Number.isInteger(n) || n < 1) {
    console.error(colors.red("[FAIL] --n must be a positive integer"));
    return 1;
  }
  const refusal = selectRefusal(rescreen, ps, status);
  if (refusal !== null) {
    console.error(colors.red(`[FAIL] ${refusal}`));
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
