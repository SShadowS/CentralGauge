// H-68: the screening pre-screen (owner decision
// decisions/2026-11-06-m8-wave2-round0-and-prescreen.md, design note H-68).
// One attempt per arm, repeat 1; both pass -> provisionally saturated,
// otherwise eligible for the full screen. Round 1 (calibration) fully screens
// every candidate to measure the false-kill rate; later rounds (filter) skip
// the full screen for the rejects outside a seeded 20% audit.
//
// Pre-screen campaigns are experiments `v2-prescreen-<n>`: screening.ts's
// default loader never reads them, so their cells never reach the screening
// history, a stratum, the selection or a confirmatory result.
// Owner: lane-infra.

import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import type { Cell } from "../../src/harness/stats.ts";
import type {
  Amendment,
  Rules,
  ScreenCampaign,
  Screening,
  SealState,
  Status,
} from "./screening.ts";
import { ValidationError } from "../../src/errors.ts";
import {
  loadSymbolsLock,
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import { compareInstant } from "../../src/harness/records.ts";
import { loadTask } from "../../src/harness/task.ts";
import {
  chronologyProblems,
  classify,
  commitOf,
  contaminationProblems,
  identityProblems,
  loadScreenCampaigns,
  loadSeals,
  metaAt,
  pickHeldOut,
  ranks,
  REGISTRY_PATH,
  screeningHistory,
  ScreeningSchema,
  STRATA,
  tally,
  tasksGlob,
  yamlAt,
} from "./screening.ts";

export const PRESCREEN_PREFIX = "v2-prescreen-";
export const AMENDMENT_ID = "prescreen";
/** Owner decisions authorising the pre-screen (the SIM_SCRIPT_CHANGES pattern). */
export const PRESCREEN_DECISIONS: readonly string[] = [
  "decisions/2026-11-06-m8-wave2-round0-and-prescreen.md",
];
export const AUDIT_SHARE = 0.2;

export type Verdict = "provisionally_saturated" | "eligible";
export type Mode = Amendment["rounds"][number]["mode"];
export interface Round {
  seal: string;
  mode: Mode;
}
export type SealView = Pick<SealState, "tag" | "seed" | "screening">;

const prescreenOf = (s: Screening): Amendment | undefined =>
  s.amendments.find((a) => a.id === AMENDMENT_ID);

/**
 * Per task: provisionally saturated exactly when both arms have a scored,
 * passing repeat-1 cell. Cells come after excludeCrashCells, so a crash, an
 * unscored or unrun cell or a missing arm is eligible (fail closed: it only
 * adds a full screen). A foreign arm throws.
 */
export function prescreenVerdict(
  cells: Cell[],
  rules: Rules,
): Map<string, Verdict> {
  const passed = new Map<string, Set<string>>();
  for (const c of cells) {
    if (!rules.arms.includes(c.arm)) {
      throw new ValidationError(
        `pre-screen cell ${c.task}/${c.repeat}/${c.arm}: arm is not a screening arm`,
        [c.arm],
      );
    }
    const p = passed.get(c.task) ?? new Set<string>();
    if (c.repeat === 1 && c.status === "scored" && c.pass === true) {
      p.add(c.arm);
    }
    passed.set(c.task, p);
  }
  return new Map(
    [...passed].map(([t, p]) => [
      t,
      rules.arms.every((a) => p.has(a))
        ? "provisionally_saturated"
        : "eligible",
    ]),
  );
}

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
 * A candidate's round is its first seal; its mode is read from the registry
 * committed at that seal, so it is fixed before any outcome exists. A round
 * added later (HEAD only) is ignored.
 */
export function roundOf(id: string, seals: SealView[]): RoundOf {
  const first = seals.find((s) =>
    s.screening.candidates.some((c) => c.id === id)
  );
  if (!first) return { ok: false, problem: `${id} is not sealed` };
  const r = prescreenOf(first.screening)?.rounds.find((x) =>
    x.seal === first.tag
  );
  return r ? { ok: true, seal: r.seal, mode: r.mode } : {
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
 * has a verdict. The rank seed carries a domain tag, so the audit is not
 * select()'s rank order (which would audit exactly the best-ranked rejects).
 */
export async function auditSample(
  seed: string,
  candidates: string[],
  verdicts: Map<string, Verdict>,
): Promise<Audit | null> {
  if (candidates.some((id) => !verdicts.has(id))) return null;
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

const RESOLVED = new Set<Status>([...STRATA, "dead", "saturated"]);

export interface FalseKill {
  /** Resolved provisional rejects whose full screen is not saturated. */
  k: number;
  /** Resolved provisional rejects. */
  n: number;
  /** Provisional rejects whose full screen has not resolved. */
  pending: number;
  table: Record<Verdict, { saturated: number; other: number; pending: number }>;
}

/**
 * The false-kill rate over `ids` (those without a verdict are skipped): a
 * full screen is resolved when its status is a stratum, dead or saturated;
 * any other status is pending.
 */
export function falseKill(
  ids: string[],
  verdicts: Map<string, Verdict>,
  status: Map<string, Status>,
): FalseKill {
  const row = () => ({ saturated: 0, other: 0, pending: 0 });
  const table = { provisionally_saturated: row(), eligible: row() };
  for (const id of ids) {
    const v = verdicts.get(id);
    if (v === undefined) continue;
    const s = status.get(id);
    table[v][
      s === "saturated"
        ? "saturated"
        : s !== undefined && RESOLVED.has(s)
        ? "other"
        : "pending"
    ]++;
  }
  const p = table.provisionally_saturated;
  return { k: p.other, n: p.saturated + p.other, pending: p.pending, table };
}

export interface PrescreenState {
  verdicts: Map<string, Verdict>;
  /** Round of each pre-screened task that has one. */
  rounds: Map<string, Round>;
  /** Per filter-round seal: its audit, or null while pending. */
  audits: Map<string, Audit | null>;
  /** Non-audited rejects of filter rounds: classify's `provisional`. */
  provisional: Set<string>;
  /** Filter-round candidates the full screen must not run yet (audit pending). */
  waiting: Set<string>;
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
    problems: seals.flatMap((s) => amendmentProblems(s.tag, s.screening, now)),
  };
  const gate = amendmentGate(now, input.decisions);
  if (gate.length > 0) {
    if (prescreens.length > 0) out.problems.push(...gate);
    return out;
  }
  for (const c of prescreens) out.problems.push(...(c.problems ?? []));
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
  out.verdicts = prescreenVerdict(
    prescreens.flatMap((c) => c.cells).filter((x) => out.rounds.has(x.task)),
    now.rules,
  );
  // Q8: in a filter round the pre-screen must come before any complete full screen.
  for (const [t, r] of out.rounds) {
    if (r.mode !== "filter") continue;
    for (const p of byTask.get(t)!) {
      const f = full.find((f) =>
        compareInstant(f.created_at, p.created_at) < 0 &&
        tally(f.cells.filter((x) => x.task === t), now.rules).get(t)?.complete
      );
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
    const round = prescreenOf(s.screening)?.rounds.find((r) =>
      r.seal === s.tag
    );
    if (round?.mode !== "filter") continue;
    const pop = s.screening.candidates.map((c) => c.id).filter((id) =>
      firstSeal.get(id) === s.tag && !heldOut.includes(id)
    );
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
  return out;
}

const fkLines = (label: string, fk: FalseKill): string[] => [
  `${label} false-kill: ${fk.k}/${fk.n} (pending ${fk.pending})`,
  ...(["provisionally_saturated", "eligible"] as const).map((v) =>
    `  pre-screen ${v}: full saturated ${fk.table[v].saturated}, other ${
      fk.table[v].other
    }, pending ${fk.table[v].pending}`
  ),
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
  const { seals, problems: ledgerIssues } = await loadSeals(root);
  const now = await yamlAt(
    root,
    await commitOf(root, "HEAD"),
    REGISTRY_PATH,
    ScreeningSchema,
  );
  const start = seals[0]!;
  const startIds = start.screening.candidates.map((c) => c.id);
  const heldOut = pickHeldOut(
    await metaAt(root, start.commit, start.screening, startIds),
    await ranks(start.seed, startIds),
    start.screening.rules,
  ).sort();
  const sealedIds = [
    ...new Set(seals.flatMap((s) => s.screening.candidates.map((c) => c.id))),
  ];
  const firstRound = new Map<string, string>();
  for (const s of seals) {
    for (const c of s.screening.candidates) {
      if (!firstRound.has(c.id)) firstRound.set(c.id, s.round_time);
    }
  }
  const current = await taskSetIdentity(
    root,
    await Promise.all(
      sealedIds.map((id) => loadTask(join(root, "harness-tasks", "tasks", id))),
    ),
    await loadSymbolsLock(root),
  );
  const load = (prefix?: string, repeats?: number) =>
    loadScreenCampaigns(
      a["results-dir"],
      now.rules,
      root,
      a["stratify-env"],
      prefix,
      repeats,
    );
  const full = await load();
  const pre = await load(PRESCREEN_PREFIX, 1);
  const ps = await evaluatePrescreen({
    now,
    seals,
    heldOut,
    prescreens: pre.campaigns,
    full: full.campaigns,
  });
  const hist = screeningHistory(full.campaigns, now.rules);
  const status = classify(
    now,
    new Set(sealedIds),
    heldOut,
    tally(hist.cells, now.rules),
    hist.screens,
    ps.provisional,
  );
  const problems = [
    ...ledgerIssues,
    ...[...pre.ran].flatMap(([id, t]) =>
      identityProblems(id, t, current.tasks)
    ),
    ...chronologyProblems(
      pre.campaigns.map((c) => ({
        id: c.id,
        created_at: c.created_at,
        tasks: (pre.ran.get(c.id) ?? []).map((t) => t.id),
      })),
      firstRound,
    ),
    ...ps.problems,
  ];
  for (const p of problems) console.error(colors.red(`[FAIL] ${p}`));
  if (problems.length > 0) return 1;
  for (
    const [id, v] of [...ps.verdicts].sort(([x], [y]) => x.localeCompare(y))
  ) {
    const r = ps.rounds.get(id)!;
    console.log(`${id} ${v} ${r.mode} ${r.seal} full: ${status.get(id)}`);
  }
  const ids = (mode: Mode) =>
    [...ps.rounds].filter(([, r]) => r.mode === mode).map(([id]) => id);
  for (
    const l of fkLines(
      "calibration",
      falseKill(ids("calibration"), ps.verdicts, status),
    )
  ) {
    console.log(l);
  }
  for (const [seal, audit] of ps.audits) {
    console.log(
      audit === null
        ? colors.yellow(
          `[WAIT] filter ${seal}: audit pending until every candidate has a pre-screen verdict`,
        )
        : `filter ${seal}: ${audit.audited.length} of ${audit.rejects.length} rejects audited${
          audit.audited.length > 0 ? `: "${tasksGlob(audit.audited)}"` : ""
        }`,
    );
  }
  const audited = [...ps.audits.values()].flatMap((x) => x?.audited ?? []);
  if (ps.audits.size > 0) {
    for (
      const l of fkLines(
        "filter (audited)",
        falseKill(audited, ps.verdicts, status),
      )
    ) {
      console.log(l);
    }
  }
  if (ps.provisional.size > 0) {
    console.log(`provisionally saturated: "${tasksGlob([...ps.provisional])}"`);
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main());
