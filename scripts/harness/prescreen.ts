// H-68: the screening pre-screen (owner decision
// decisions/2026-11-06-m8-wave2-round0-and-prescreen.md, design note H-68).
// One attempt per arm, repeat 1; both pass -> provisionally saturated,
// otherwise eligible for the full screen. Calibration rounds (one or more,
// first; H-69) fully screen every candidate to measure the false-kill rate,
// pooled over them; later rounds (filter) skip the full screen for the
// rejects outside a seeded 20% audit.
//
// Pre-screen campaigns are experiments `v2-prescreen-<n>`: screening.ts's
// default loader never reads them, so their cells never reach the screening
// history, a stratum, the selection or a confirmatory result.
// Owner: lane-infra.

import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import type {
  Amendment,
  EnvCell,
  FirstAttempt,
  Rules,
  ScreenCampaign,
  Screening,
  SealState,
  Status,
} from "./screening.ts";
import { ValidationError } from "../../src/errors.ts";
import { compareInstant } from "../../src/harness/records.ts";
import {
  contaminationProblems,
  openScreening,
  ranks,
  screeningGate,
  STRATA,
  tally,
  tasksGlob,
} from "./screening.ts";

export const PRESCREEN_PREFIX = "v2-prescreen-";
export const AMENDMENT_ID = "prescreen";
/** Owner decisions authorising the pre-screen (the SIM_SCRIPT_CHANGES pattern). */
export const PRESCREEN_DECISIONS: readonly string[] = [
  "decisions/2026-11-06-m8-wave2-round0-and-prescreen.md",
];
export const AUDIT_SHARE = 0.2;

/** "pending": an attempt is live or not started, so no verdict yet (r1). */
export type Verdict = "provisionally_saturated" | "eligible" | "pending";
/** A verdict that will not change: what an audit and the false-kill rate count. */
type Final = Exclude<Verdict, "pending">;
const finalOf = (v: Verdict | undefined): Final | undefined =>
  v === "pending" ? undefined : v;
export type Mode = Amendment["rounds"][number]["mode"];
export interface Round {
  seal: string;
  mode: Mode;
}
export type SealView = Pick<SealState, "tag" | "seed" | "screening">;

const prescreenOf = (s: Screening): Amendment | undefined =>
  s.amendments.find((a) => a.id === AMENDMENT_ID);

/**
 * r3: a cell's first execution attempt (the loader's firstAttempts). A cell
 * without it (a hand-built one) is read from its status: scored and passing
 * is a pass, pending or unrun is live, anything else (a crash-excluded or
 * unscored cell) a fail.
 */
const firstOf = (c: EnvCell): FirstAttempt =>
  c.first ??
    (c.status === "scored" && c.pass === true
      ? "pass"
      : c.status === "pending" || c.status === "unrun"
      ? "live"
      : "fail");

/**
 * Per task, from each repeat-1 cell's FIRST execution attempt only (r3): a
 * later attempt, automatic retry or manual rerun, never changes it. Both
 * arms' first attempts passed: provisionally saturated. Otherwise a live
 * first attempt makes it pending, whatever the other arm did. Otherwise
 * eligible: a crashed, unjudged or failed first attempt, or a missing arm
 * (fail closed: it only adds a full screen). A foreign arm throws.
 */
export function prescreenVerdict(
  cells: EnvCell[],
  rules: Rules,
): Map<string, Verdict> {
  const passed = new Map<string, Set<string>>();
  const live = new Set<string>();
  for (const c of cells) {
    if (!rules.arms.includes(c.arm)) {
      throw new ValidationError(
        `pre-screen cell ${c.task}/${c.repeat}/${c.arm}: arm is not a screening arm`,
        [c.arm],
      );
    }
    const p = passed.get(c.task) ?? new Set<string>();
    if (c.repeat === 1 && firstOf(c) === "pass") p.add(c.arm);
    if (c.repeat === 1 && firstOf(c) === "live") live.add(c.task);
    passed.set(c.task, p);
  }
  return new Map(
    [...passed].map(([t, p]) => [
      t,
      rules.arms.every((a) => p.has(a))
        ? "provisionally_saturated"
        : live.has(t)
        ? "pending"
        : "eligible",
    ]),
  );
}

/** r3: tasks with an automatically retried repeat-1 cell (no manual rerun). */
export const retriedTasks = (cells: EnvCell[]): Set<string> =>
  new Set(
    cells.filter((c) =>
      c.repeat === 1 && c.attempts > 1 && (c.manual_reruns ?? 0) === 0
    ).map((c) => c.task),
  );

/** HEAD's registry must carry a prescreen amendment naming a whitelisted decision. */
export function amendmentGate(
  now: Screening,
  decisions: readonly string[] = PRESCREEN_DECISIONS,
): string[] {
  const a = prescreenOf(now);
  if (!a) {
    return [
      "screening.yml has no prescreen amendment: pre-screen data and modes are refused",
    ];
  }
  return decisions.includes(a.decision) ? [] : [
    `the prescreen amendment names ${a.decision}, which is not an owner decision authorising the pre-screen (${
      decisions.join(", ")
    })`,
  ];
}

/** HEAD extends the amendment committed at seal `tag`: rounds appended only. */
export function amendmentProblems(
  tag: string,
  sealed: Screening,
  now: Screening,
): string[] {
  const s = prescreenOf(sealed);
  if (!s) return [];
  const n = prescreenOf(now);
  if (!n) return [`prescreen amendment removed after ${tag}`];
  const same = n.decision === s.decision &&
    JSON.stringify(n.rounds.slice(0, s.rounds.length)) ===
      JSON.stringify(s.rounds);
  return same ? [] : [
    `prescreen amendment changed after ${tag} (rounds may only be appended)`,
  ];
}

export type RoundOf = ({ ok: true } & Round) | { ok: false; problem: string };

/**
 * The round of seal `s`, read from the registry committed at `s`; null when
 * it has none. A filter round counts only after a real calibration round: an
 * earlier ledger seal whose OWN frozen registry declares itself calibration
 * (r1: a seal that does not exist or comes later is none; r2: an entry for
 * an earlier seal that appears only in a later registry is none).
 */
export function sealRound(s: SealView, seals: SealView[]): RoundOf | null {
  const own = (x: SealView) =>
    prescreenOf(x.screening)?.rounds.find((r) => r.seal === x.tag);
  const r = own(s);
  if (!r) return null;
  const here = seals.findIndex((x) => x.tag === s.tag);
  if (
    r.mode === "filter" &&
    !seals.slice(0, Math.max(here, 0)).some((a) =>
      own(a)?.mode === "calibration"
    )
  ) {
    return {
      ok: false,
      problem:
        `${s.tag}: a filter round needs an earlier calibration round on a sealed seal`,
    };
  }
  return { ok: true, seal: r.seal, mode: r.mode };
}

/**
 * A candidate's round is its first seal's (sealRound), so it is fixed before
 * any outcome exists. A round added later (HEAD only) is ignored.
 */
export function roundOf(id: string, seals: SealView[]): RoundOf {
  const first = seals.find((s) =>
    s.screening.candidates.some((c) => c.id === id)
  );
  if (!first) return { ok: false, problem: `${id} is not sealed` };
  return sealRound(first, seals) ?? {
    ok: false,
    problem: `${id}: its first seal ${first.tag} has no pre-screen round`,
  };
}

export interface Audit {
  /** The seal's provisional rejects, sorted. */
  rejects: string[];
  /** ceil(AUDIT_SHARE * rejects) lowest under the domain-tagged rank, sorted. */
  audited: string[];
}

/**
 * The filter-round audit of one seal: null (pending) until every candidate
 * has a final verdict (a pending one is none). The rank seed carries a domain
 * tag, so the audit is not select()'s rank order (which would audit exactly
 * the best-ranked rejects).
 */
export async function auditSample(
  seed: string,
  candidates: string[],
  verdicts: Map<string, Verdict>,
): Promise<Audit | null> {
  if (candidates.some((id) => !finalOf(verdicts.get(id)))) return null;
  const rejects = candidates.filter((id) =>
    verdicts.get(id) === "provisionally_saturated"
  ).sort();
  const rank = await ranks(`${seed}:prescreen-audit`, rejects);
  const audited = [...rejects].sort((a, b) => {
    const ra = rank.get(a)!, rb = rank.get(b)!;
    return ra < rb ? -1 : ra > rb ? 1 : a.localeCompare(b);
  }).slice(0, Math.ceil(AUDIT_SHARE * rejects.length)).sort();
  return { rejects, audited };
}

// A function, not a top-level Set: this module is evaluated before
// screening.ts when screening.ts is the entry point (import cycle).
const resolved = (s: Status | undefined): boolean =>
  s === "dead" || s === "saturated" ||
  (STRATA as readonly (Status | undefined)[]).includes(s);

export interface FalseKill {
  /** Resolved provisional rejects whose full screen is not saturated. */
  k: number;
  /** Resolved provisional rejects. */
  n: number;
  /** Provisional rejects whose full screen has not resolved (broken excluded). */
  pending: number;
  /** Provisional rejects that are broken: never full-screened, never resolvable. */
  broken: number;
  table: Record<
    Final,
    { saturated: number; other: number; pending: number; broken: number }
  >;
}

/**
 * The false-kill rate over `ids` (those without a verdict are skipped): a
 * full screen is resolved when its status is a stratum, dead or saturated.
 * Run 002: a broken candidate stays in the population but is counted apart
 * (never resolvable), not as pending; any other status is pending.
 */
export function falseKill(
  ids: string[],
  verdicts: Map<string, Verdict>,
  status: Map<string, Status>,
): FalseKill {
  const row = () => ({ saturated: 0, other: 0, pending: 0, broken: 0 });
  const table = { provisionally_saturated: row(), eligible: row() };
  for (const id of ids) {
    const v = finalOf(verdicts.get(id));
    if (v === undefined) continue;
    const s = status.get(id);
    table[v][
      s === "saturated"
        ? "saturated"
        : resolved(s)
        ? "other"
        : s === "broken"
        ? "broken"
        : "pending"
    ]++;
  }
  const p = table.provisionally_saturated;
  return {
    k: p.other,
    n: p.saturated + p.other,
    pending: p.pending,
    broken: p.broken,
    table,
  };
}

export interface PrescreenState {
  verdicts: Map<string, Verdict>;
  /** Round of each pre-screened task that has one. */
  rounds: Map<string, Round>;
  /** Per filter-round seal: its audit, or null while pending. */
  audits: Map<string, Audit | null>;
  /** Non-audited rejects of filter rounds: classify's `provisional`. */
  provisional: Set<string>;
  /**
   * Filter-round candidates while their seal's audit is pending (all but the
   * eligible ones): kept out of the next full screen, and select refuses.
   */
  waiting: Set<string>;
  /**
   * Calibration-round candidates without a finished pre-screen: select
   * refuses (r1), but the full screen may run first (r2).
   */
  missing: Set<string>;
  /**
   * r3: tasks with an automatically retried pre-screen cell. Retries follow
   * only an unjudged first attempt (retryProblem), so these are eligible.
   */
  retried: Set<string>;
  problems: string[];
}

/**
 * Everything the pre-screen decides, from HEAD's registry, the seal ledger,
 * the held-out ids, the pre-screen campaigns and the full-screen campaigns
 * (the latter only for the filter-round ordering rule).
 */
export async function evaluatePrescreen(input: {
  now: Screening;
  seals: SealView[];
  heldOut: string[];
  prescreens: ScreenCampaign[];
  full: ScreenCampaign[];
  decisions?: readonly string[];
}): Promise<PrescreenState> {
  const { now, seals, heldOut, prescreens, full } = input;
  const out: PrescreenState = {
    verdicts: new Map(),
    rounds: new Map(),
    audits: new Map(),
    provisional: new Set(),
    waiting: new Set(),
    missing: new Set(),
    retried: new Set(),
    problems: seals.flatMap((s) => amendmentProblems(s.tag, s.screening, now)),
  };
  const gate = amendmentGate(now, input.decisions);
  if (gate.length > 0) {
    if (prescreens.length > 0) out.problems.push(...gate);
    return out;
  }
  for (const c of prescreens) {
    out.problems.push(...(c.problems ?? []), ...(c.first_problems ?? []));
    // r3: a manual rerun (run_kind manual_rerun, as manualRerunProblems
    // counts it) of a pre-screen cell is refused, scored or not.
    for (const x of c.cells) {
      if ((x.manual_reruns ?? 0) > 0) {
        out.problems.push(
          `pre-screen cell ${x.task}/${x.repeat}/${x.arm} was manually rerun (no pre-screen rerun)`,
        );
      }
    }
  }
  const byTask = new Map<string, ScreenCampaign[]>();
  for (const c of prescreens) {
    for (const t of new Set(c.cells.map((x) => x.task))) {
      byTask.set(t, [...(byTask.get(t) ?? []), c]);
    }
  }
  for (const [t, cs] of byTask) {
    if (cs.length > 1) {
      out.problems.push(
        `${t} pre-screened ${cs.length} times (no pre-screen rerun)`,
      );
    }
  }
  const sealed = new Set(
    seals.flatMap((s) => s.screening.candidates.map((c) => c.id)),
  );
  const where = new Map<string, Status>(now.candidates.map((c) => [
    c.id,
    heldOut.includes(c.id)
      ? "held_out"
      : !sealed.has(c.id)
      ? "unsealed"
      : "unscreened",
  ]));
  const refused = contaminationProblems(where, byTask.keys());
  out.problems.push(...refused.map((p) => `pre-screen: ${p}`));
  for (const t of byTask.keys()) {
    if (where.get(t) !== "unscreened") continue;
    const r = roundOf(t, seals);
    if (r.ok) out.rounds.set(t, { seal: r.seal, mode: r.mode });
    else out.problems.push(r.problem);
  }
  const counted = prescreens.flatMap((c) => c.cells).filter((x) =>
    out.rounds.has(x.task)
  );
  out.verdicts = prescreenVerdict(counted, now.rules);
  out.retried = retriedTasks(counted);
  // Q8: in a filter round the pre-screen must come before any complete full
  // screen. Run 003: judged on the FIRST completion time alone
  // (completionTimes), so once the screen was ever complete the refusal
  // holds even if a later unscored rejudge leaves the current tally
  // incomplete. Without a completion time (a hand-built campaign), the
  // current tally and the campaign's creation decide.
  const completeBefore = (f: ScreenCampaign, t: string, at: string) => {
    const first = f.completed_at?.[t];
    return first !== undefined
      ? compareInstant(first, at) < 0
      : tally(f.cells.filter((x) => x.task === t), now.rules).get(t)
            ?.complete === true && compareInstant(f.created_at, at) < 0;
  };
  for (const [t, r] of out.rounds) {
    if (r.mode !== "filter") continue;
    for (const p of byTask.get(t)!) {
      const f = full.find((f) => completeBefore(f, t, p.created_at));
      if (f) {
        out.problems.push(
          `${t} pre-screened in ${p.experiment} after a complete full screen in ${f.experiment}`,
        );
      }
    }
  }
  const firstSeal = new Map<string, string>();
  for (const s of seals) {
    for (const c of s.screening.candidates) {
      if (!firstSeal.has(c.id)) firstSeal.set(c.id, s.tag);
    }
  }
  for (const s of seals) {
    const round = sealRound(s, seals);
    if (round === null) continue;
    // r1: an invalid round is a problem and filters nothing.
    if (!round.ok) {
      out.problems.push(round.problem);
      continue;
    }
    const pop = s.screening.candidates.map((c) => c.id).filter((id) =>
      firstSeal.get(id) === s.tag && !heldOut.includes(id)
    );
    if (round.mode === "calibration") {
      for (const id of pop) {
        if (!finalOf(out.verdicts.get(id))) out.missing.add(id);
      }
      continue;
    }
    const audit = await auditSample(s.seed, pop, out.verdicts);
    out.audits.set(s.tag, audit);
    for (const id of pop) {
      if (audit === null) {
        if (out.verdicts.get(id) !== "eligible") out.waiting.add(id);
      } else if (audit.rejects.includes(id) && !audit.audited.includes(id)) {
        out.provisional.add(id);
      }
    }
  }
  out.problems = [...new Set(out.problems)];
  return out;
}

const fkLines = (label: string, fk: FalseKill, extra = ""): string[] => [
  `${label} false-kill: ${fk.k}/${fk.n} (pending ${fk.pending})${extra}`,
  ...(["provisionally_saturated", "eligible"] as const).map((v) =>
    `  pre-screen ${v}: full saturated ${fk.table[v].saturated}, other ${
      fk.table[v].other
    }, pending ${fk.table[v].pending}`
  ),
  `  broken, never resolvable: ${
    fk.table.provisionally_saturated.broken + fk.table.eligible.broken
  }`,
];

/** `prescreen.ts status`: verdicts, rounds, audits and the false-kill rate. */
async function main(): Promise<number> {
  const a = parseArgs(Deno.args, {
    string: ["results-dir"],
    boolean: ["stratify-env"],
    default: { "results-dir": "results/harness" },
  });
  if (String(a._[0] ?? "") !== "status") {
    console.error(
      "usage: prescreen.ts status [--results-dir DIR] [--stratify-env]",
    );
    return 1;
  }
  const root = Deno.cwd();
  // r1: the same gate as `screening.ts status` (uncommitted tree, ledger,
  // append-only, trees, identities, chronology, screening history,
  // --stratify-env strata, contamination, pre-screen problems).
  const opened = await openScreening(root);
  const g = opened.problems.length > 0 ? null : await screeningGate(
    root,
    opened,
    a["results-dir"],
    a["stratify-env"],
  );
  const r = g === null
    ? prescreenReport(opened.problems, new Map(), null)
    : prescreenReport(g.problems, g.status, g.ps);
  for (const p of r.err) console.error(colors.red(`[FAIL] ${p}`));
  for (const l of r.out) console.log(l);
  return r.ok ? 0 : 1;
}

/**
 * The `status` output. With any gate problem, only the problems: no verdict,
 * false-kill or audit line is printed from outcomes the gate refuses.
 */
export function prescreenReport(
  problems: string[],
  status: Map<string, Status>,
  ps: PrescreenState | null,
): { ok: boolean; out: string[]; err: string[] } {
  if (problems.length > 0 || ps === null) {
    return { ok: false, out: [], err: problems };
  }
  const out: string[] = [];
  for (
    const [id, v] of [...ps.verdicts].sort(([x], [y]) => x.localeCompare(y))
  ) {
    const r = ps.rounds.get(id)!;
    out.push(`${id} ${v} ${r.mode} ${r.seal} full: ${status.get(id)}`);
  }
  const ids = (mode: Mode, seal?: string) =>
    [...ps.rounds].filter(([, r]) =>
      r.mode === mode && (seal === undefined || r.seal === seal)
    ).map(([id]) => id);
  // H-69: the rate pools every calibration round; each seal's table follows.
  out.push(
    ...fkLines(
      "calibration",
      falseKill(ids("calibration"), ps.verdicts, status),
      `, missing pre-screen: ${ps.missing.size}`,
    ),
  );
  const calSeals = [
    ...new Set(
      [...ps.rounds.values()].filter((r) => r.mode === "calibration").map((
        r,
      ) => r.seal),
    ),
  ].sort();
  for (const seal of calSeals) {
    out.push(
      ...fkLines(
        `calibration ${seal}`,
        falseKill(ids("calibration", seal), ps.verdicts, status),
      ),
    );
  }
  for (const [seal, audit] of ps.audits) {
    out.push(
      audit === null
        ? `[WAIT] filter ${seal}: audit pending until every candidate has a finished pre-screen`
        : `filter ${seal}: ${audit.audited.length} of ${audit.rejects.length} rejects audited${
          audit.audited.length > 0 ? `: "${tasksGlob(audit.audited)}"` : ""
        }`,
    );
  }
  const audited = [...ps.audits.values()].flatMap((x) => x?.audited ?? []);
  if (ps.audits.size > 0) {
    out.push(
      ...fkLines("filter (audited)", falseKill(audited, ps.verdicts, status)),
    );
  }
  if (ps.provisional.size > 0) {
    out.push(`provisionally saturated: "${tasksGlob([...ps.provisional])}"`);
  }
  const retried = [...ps.retried].filter((id) =>
    ps.verdicts.get(id) === "eligible"
  ).sort();
  if (retried.length > 0) {
    out.push(
      `retried pre-screen (first attempt not scored) -> eligible: ${
        retried.join(", ")
      }`,
    );
  }
  return { ok: true, out, err: [] };
}

if (import.meta.main) Deno.exit(await main());
