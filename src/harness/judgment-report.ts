/**
 * H-35 S2.5: what reports say about judgments beyond the verdict (design-r2
 * 8, r3 9, r4 6, r5 5): per-scorer states, the policy gate, the four
 * populations, and a rejudge's frozen pairing with its reason flags and the
 * old x new verdict matrix. A v1 field with no v2 counterpart is
 * `unavailable`, never inferred from the new environment.
 */

import { join } from "@std/path";
import type { JudgmentRecord } from "./records.ts";
import { ValidationError } from "../errors.ts";
import { hashJson } from "./hash.ts";
import { violationRule } from "./verdict.ts";

type Scorer = JudgmentRecord["scorers"][number];
type Row = Scorer["tests"][number];

export const G_SCORERS = ["build", "pass_to_pass", "fail_to_pass"] as const;
const A_SCORERS = ["agent_tests", "mutant_kill"];
const isG = (name: string) => (G_SCORERS as readonly string[]).includes(name);

export type ScorerCount =
  | "pass"
  | "fail"
  | "not_measured"
  | "unscored"
  | "unavailable";

/** What a judgment's write-once verdict log shows (r3 6.2), when it has one. */
export interface LogEvidence {
  violations?: readonly string[];
  diagnostics?: readonly unknown[];
}

/**
 * One scorer as reports count it. v2 by its state. v1 has none: a failure
 * with no rows (other than build) is a legacy synthetic failure (failRest
 * after an earlier one), never an observed fail (r5 6.1). Orch Sol r1 #7: a
 * v1 build failure whose log lists violations and no compile diagnostics
 * was a policy rejection before any compile: unavailable too.
 */
export function scorerCount(
  j: JudgmentRecord,
  s: Scorer,
  log?: LogEvidence,
): ScorerCount {
  if (s.passed === null) {
    return s.state === "not_measured" ? "not_measured" : "unscored";
  }
  if (j.v === 1 && !s.passed && s.tests.length === 0) {
    if (s.name !== "build") return "unavailable";
    if (
      (log?.violations?.length ?? 0) > 0 &&
      (log?.diagnostics?.length ?? 0) === 0
    ) return "unavailable";
  }
  return s.passed ? "pass" : "fail";
}

const measured = (
  j: JudgmentRecord,
  s: Scorer | undefined,
  log?: LogEvidence,
) => s !== undefined && ["pass", "fail"].includes(scorerCount(j, s, log));

/** G (G' for test-authoring) of one judgment: measured, passed, or v1. */
function gOf(
  j: JudgmentRecord,
): "passed" | "failed" | "not_measured" | "unavailable" {
  if (j.v === 1) return "unavailable";
  const g = j.scorers.filter((s) => isG(s.name));
  if (g.length === 0 || g.some((s) => s.state !== "measured")) {
    return "not_measured";
  }
  return g.every((s) => s.passed) ? "passed" : "failed";
}

export interface GPopulation {
  measured: number;
  passed: number;
  not_measured: number;
  unavailable: number;
}

/** One arm's scoring summary over its cells (r4 6.2 populations). */
export interface ScoringSummary {
  arm: string;
  /** The declared denominator: every planned cell. */
  total: number;
  /** Cells with a selected judgment. */
  judged: number;
  /** Of them v1: scorer state, policy and env_fp are unavailable. */
  legacy: number;
  scorers: Record<string, Record<ScorerCount, number>>;
  /** Change tasks: G passes / G measured, "conditional on G measured". */
  g: GPopulation;
  /** Test-authoring G': trusted-reference validation, never pooled with `g`. */
  reference: GPopulation;
  /**
   * Cells per gate result; `by_rule` counts cells per `side/rule` (v1:
   * `legacy/rule`). A v1 judgment is failed (from log) when its verdict log
   * lists violations, else unavailable (r3 6.2).
   */
  policy: {
    compliant: number;
    failed: number;
    failed_from_log: number;
    unavailable: number;
    by_rule: Record<string, number>;
  };
  /** Verdict passes (which implies policy-compliant) / total. */
  composite: { passed: number; total: number };
  /** Cells left unscored by infra. */
  infra: number;
  /** Cells with eligible agent tests, and the verdict log's notes. */
  agent_tests: {
    submitted: number;
    not_submitted: number;
    credit_excluded: number;
  };
}

export interface ScoringCell {
  arm: string;
  task: string;
  status: string;
  judgment: JudgmentRecord | null;
}

/**
 * Per arm, in first-seen order. `notes` and `violations` are a judgment's
 * verdict log notes and violations (undefined: no log).
 */
export function summarizeScoring(
  cells: readonly ScoringCell[],
  kindOf: (task: string) => string,
  notes: (judgmentId: string) => readonly string[] | undefined = () =>
    undefined,
  violations: (judgmentId: string) => readonly string[] | undefined = () =>
    undefined,
  /** The verdict log's compile diagnostics (orch Sol r1 #7). */
  diagnostics: (judgmentId: string) => readonly unknown[] | undefined = () =>
    undefined,
): ScoringSummary[] {
  const out = new Map<string, ScoringSummary>();
  const pop = (): GPopulation => ({
    measured: 0,
    passed: 0,
    not_measured: 0,
    unavailable: 0,
  });
  for (const c of cells) {
    let s = out.get(c.arm);
    if (!s) {
      s = {
        arm: c.arm,
        total: 0,
        judged: 0,
        legacy: 0,
        scorers: {},
        g: pop(),
        reference: pop(),
        policy: {
          compliant: 0,
          failed: 0,
          failed_from_log: 0,
          unavailable: 0,
          by_rule: {},
        },
        composite: { passed: 0, total: 0 },
        infra: 0,
        agent_tests: { submitted: 0, not_submitted: 0, credit_excluded: 0 },
      };
      out.set(c.arm, s);
    }
    s.total++;
    s.composite.total++;
    const j = c.judgment;
    if (c.status === "unscored" || j?.verdict === "unscored") s.infra++;
    if (!j) continue;
    s.judged++;
    if (j.v === 1) s.legacy++;
    if (j.verdict === "pass") s.composite.passed++;
    for (const sc of j.scorers) {
      const row = s.scorers[sc.name] ??= {
        pass: 0,
        fail: 0,
        not_measured: 0,
        unscored: 0,
        unavailable: 0,
      };
      row[
        scorerCount(j, sc, {
          violations: violations(j.id) ?? [],
          diagnostics: diagnostics(j.id) ?? [],
        })
      ]++;
    }
    const g = gOf(j);
    const p = kindOf(c.task) === "test-authoring" ? s.reference : s.g;
    if (g === "passed" || g === "failed") {
      p.measured++;
      if (g === "passed") p.passed++;
    } else p[g]++;
    const logged = j.policy ? [] : violations(j.id) ?? [];
    if (!j.policy && logged.length > 0) {
      s.policy.failed_from_log++;
      for (
        const k of new Set(logged.map((v) => `legacy/${violationRule(v)}`))
      ) {
        s.policy.by_rule[k] = (s.policy.by_rule[k] ?? 0) + 1;
      }
    } else if (!j.policy) s.policy.unavailable++;
    else if (j.policy.passed) s.policy.compliant++;
    else {
      s.policy.failed++;
      for (
        const k of new Set(
          j.policy.violations.map((v) => `${v.side}/${v.rule}`),
        )
      ) s.policy.by_rule[k] = (s.policy.by_rule[k] ?? 0) + 1;
    }
    const agent = j.scorers.find((x) => x.name === "agent_tests");
    if (agent && agent.tests.length > 0) s.agent_tests.submitted++;
    const ns = notes(j.id) ?? [];
    if (ns.includes("agent_tests: not_submitted")) {
      s.agent_tests.not_submitted++;
    }
    if (
      ns.some((x) => /^agent_tests: credit_excluded: [1-9]/.test(x))
    ) s.agent_tests.credit_excluded++;
  }
  return [...out.values()];
}

// ---- Paired rejudge (r4 6.1, r5 5.2) ----

export const PAIR_FLAGS = [
  "unchanged",
  "newly_measured",
  "attribution_only",
  "agent_test_outcome_change",
  "helper_as_written",
  "trusted_row_change",
  "policy",
  "policy_attribution_recovered",
  "infra",
] as const;
export type PairFlag = typeof PAIR_FLAGS[number];

const rowsKey = (ss: readonly Scorer[]) =>
  ss.flatMap((s) =>
    s.tests.map((t) =>
      [s.name, t.codeunit, t.procedure, t.target, t.outcome, t.failure].join(
        "|",
      )
    )
  ).sort().join("\n");
const outcomeKey = (ss: readonly Scorer[]) =>
  `${ss.map((s) => `${s.name}:${s.passed}`).sort().join()}\n${rowsKey(ss)}`;
/** Rows as a set, whatever scorer reported them (agent rows moved scorer). */
const rowSet = (rows: readonly Row[]) =>
  rows.map((t) =>
    [t.codeunit, t.procedure, t.target, t.outcome, t.failure].join("|")
  ).sort().join("\n");
const byName = (j: JudgmentRecord, name: string) =>
  j.scorers.find((s) => s.name === name);

/**
 * A judgment with pass_to_pass keeping only the trusted shipped rows, and
 * the rows it dropped (the agent's, as run before H-35).
 */
function splitShipped(
  j: JudgmentRecord,
  trusted?: {
    pass_to_pass: readonly {
      codeunit: number;
      procedures: readonly string[];
    }[];
  },
): [JudgmentRecord, Row[]] {
  if (!trusted) return [j, []];
  const isShipped = (r: Row) =>
    trusted.pass_to_pass.some((t) =>
      t.codeunit === r.codeunit && t.procedures.includes(r.procedure)
    );
  const moved: Row[] = [];
  const scorers = j.scorers.map((s) => {
    if (s.name !== "pass_to_pass") return s;
    moved.push(...s.tests.filter((r) => !isShipped(r)));
    return { ...s, tests: s.tests.filter(isShipped) };
  });
  return [{ ...j, scorers }, moved];
}
const failing = (j: JudgmentRecord) =>
  j.scorers.filter((s) => s.passed === false).map((s) => s.name).sort().join();
const violationsKey = (j: JudgmentRecord) =>
  j.policy!.violations.map((v) => `${v.side}/${v.rule}/${v.detail}`).sort()
    .join("\n");

/**
 * The nonexclusive reason flags of one pair (frozen old -> new judgment).
 * `unchanged` is the verdict and the G rows; it can co-occur with an A
 * change. `policy` needs both sides known: v2, or a v1 old side whose
 * verdict log (`oldLog`) lists violations (failed from log, r3 6.2); then
 * only the gate result is compared, their detail formats differ. A v1 old
 * side with no log evidence is unknown, so its v2 counterpart is
 * `policy_attribution_recovered`, never a change.
 * `helper_as_written`: the old pass_to_pass suite predates version 6 (the
 * helper as written, H-35) and a shipped row that did not pass then passes
 * now (the H-32 class).
 *
 * Orch Sol r1 #3: before H-35 the agent's tests ran in pass_to_pass. With
 * the task's trusted descriptor (`trusted`), an old judgment's pass_to_pass
 * rows are split: the shipped ones stay G, the rest are agent rows and are
 * compared with the new side's agent rows. Without it nothing is split.
 */
export function pairFlags(
  oldIn: JudgmentRecord,
  neuIn: JudgmentRecord,
  oldLog?: LogEvidence,
  trusted?: {
    pass_to_pass: readonly {
      codeunit: number;
      procedures: readonly string[];
    }[];
  },
): PairFlag[] {
  const flags = new Set<PairFlag>();
  const [old, oldAgent] = splitShipped(oldIn, trusted);
  const [neu, neuAgent] = splitShipped(neuIn, trusted);
  const gOld = old.scorers.filter((s) => isG(s.name));
  const gNew = neu.scorers.filter((s) => isG(s.name));
  const same = old.verdict === neu.verdict;
  if (same && rowsKey(gOld) === rowsKey(gNew)) flags.add("unchanged");
  if (
    G_SCORERS.some((n) =>
      measured(neu, byName(neu, n)) && !measured(old, byName(old, n), oldLog)
    )
  ) flags.add("newly_measured");
  if (same && failing(old) !== failing(neu)) flags.add("attribution_only");
  const aOf = (j: JudgmentRecord) =>
    j.scorers.filter((s) => A_SCORERS.includes(s.name));
  const aRows = (j: JudgmentRecord, moved: readonly Row[]) =>
    rowSet([...aOf(j).flatMap((s) => s.tests), ...moved]);
  const sameNames = aOf(old).map((s) => s.name).join() ===
    aOf(neu).map((s) => s.name).join();
  if (
    aRows(old, oldAgent) !== aRows(neu, neuAgent) ||
    (sameNames && outcomeKey(aOf(old)) !== outcomeKey(aOf(neu)))
  ) flags.add("agent_test_outcome_change");
  const p2pOld = byName(old, "pass_to_pass");
  const p2pNew = byName(neu, "pass_to_pass");
  const passesNow = (r: Row) =>
    p2pNew?.tests.some((n) =>
      n.codeunit === r.codeunit && n.procedure === r.procedure &&
      n.target === r.target && n.outcome === "pass"
    ) ?? false;
  if (
    Number(old.scorer_versions["pass_to_pass"]) < 6 &&
    Number(neu.scorer_versions["pass_to_pass"]) >= 6 &&
    p2pOld?.tests.some((r) => r.outcome !== "pass" && passesNow(r))
  ) flags.add("helper_as_written");
  if (
    G_SCORERS.some((n) => {
      const a = byName(old, n);
      const b = byName(neu, n);
      return measured(old, a, oldLog) && measured(neu, b) &&
        rowsKey([a!]) !== rowsKey([b!]);
    })
  ) flags.add("trusted_row_change");
  const fromLog = !old.policy && (oldLog?.violations?.length ?? 0) > 0;
  if (old.policy && neu.policy) {
    if (
      old.policy.passed !== neu.policy.passed ||
      violationsKey(old) !== violationsKey(neu)
    ) flags.add("policy");
  } else if (fromLog && neu.policy) {
    if (neu.policy.passed) flags.add("policy");
  } else if (!old.policy && neu.policy) {
    flags.add("policy_attribution_recovered");
  }
  if (old.verdict === "unscored" || neu.verdict === "unscored") {
    flags.add("infra");
  }
  return PAIR_FLAGS.filter((f) => flags.has(f));
}

export type OldVerdict = "pass" | "fail" | "unscored" | "legacy_unknown";
type NewVerdict = "pass" | "fail" | "unscored";

/**
 * Old verdict x new verdict, every pair in exactly one cell. An old judgment
 * on an oracle with no task descriptor (legacy_unknown_task) is its own row.
 */
export function transitionMatrix(
  pairs: readonly {
    old: JudgmentRecord;
    new: JudgmentRecord;
    oldUnknown?: boolean;
  }[],
): Record<OldVerdict, Record<NewVerdict, number>> {
  const row = () => ({ pass: 0, fail: 0, unscored: 0 });
  const mx = {
    pass: row(),
    fail: row(),
    unscored: row(),
    legacy_unknown: row(),
  };
  for (const p of pairs) {
    mx[p.oldUnknown ? "legacy_unknown" : p.old.verdict][p.new.verdict]++;
  }
  return mx;
}

// ---- Pairing storage (r5 5.1) ----

export interface PairingCell {
  execution_id: string;
  /** "<arm> <task> <repeat>", for the report. */
  cell: string;
  workspace_hash: string;
  old_judgment_id: string;
  scorer_fingerprint: string;
}

/** The frozen left side: content-addressed, written once, never rewritten. */
export interface Pairing {
  cohort: { campaign: string; started_at: string };
  cells: PairingCell[];
}

export interface Completion {
  execution_id: string;
  new_judgment_id: string;
  at: string;
}

const pairingFile = (root: string, digest: string, ext = ".json") =>
  join(root, "pairings", `${digest}${ext}`);

/** Writes the left side once (idempotent for the same content); its digest. */
export async function freezePairing(
  resultsRoot: string,
  p: Pairing,
): Promise<string> {
  const digest = await hashJson(p);
  await Deno.mkdir(join(resultsRoot, "pairings"), { recursive: true });
  try {
    await Deno.writeTextFile(
      pairingFile(resultsRoot, digest),
      JSON.stringify(p, null, 2),
      { createNew: true },
    );
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    await loadPairing(resultsRoot, digest);
  }
  return digest;
}

/** Reads the left side and its completions; refuses a changed left side. */
export async function loadPairing(
  resultsRoot: string,
  digest: string,
): Promise<{ pairing: Pairing; completions: Completion[] }> {
  const pairing = JSON.parse(
    await Deno.readTextFile(pairingFile(resultsRoot, digest)),
  ) as Pairing;
  if (await hashJson(pairing) !== digest) {
    const msg = `pairing ${digest} changed since it was frozen`;
    throw new ValidationError(msg, [msg]);
  }
  let text = "";
  try {
    text = await Deno.readTextFile(
      pairingFile(resultsRoot, digest, ".completions.jsonl"),
    );
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  const completions = text.split(/\r?\n/).filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Completion);
  return { pairing, completions };
}

/** Appends one new-side judgment for a frozen cell. */
export async function appendCompletion(
  resultsRoot: string,
  digest: string,
  c: Completion,
): Promise<void> {
  const { pairing, completions } = await loadPairing(resultsRoot, digest);
  if (!pairing.cells.some((x) => x.execution_id === c.execution_id)) {
    const msg = `execution ${c.execution_id} is not in pairing ${digest}`;
    throw new ValidationError(msg, [msg]);
  }
  // Orch Sol r1 #2: one new judgment per cell. A repeat is a no-op;
  // another judgment is a conflict, refused.
  const prior = completions.find((x) => x.execution_id === c.execution_id);
  if (prior?.new_judgment_id === c.new_judgment_id) return;
  if (prior) {
    const msg =
      `conflicting completion for execution ${c.execution_id} in pairing ${digest}: ${prior.new_judgment_id} already, not ${c.new_judgment_id}`;
    throw new ValidationError(msg, [msg]);
  }
  await Deno.writeTextFile(
    pairingFile(resultsRoot, digest, ".completions.jsonl"),
    `${JSON.stringify(c)}\n`,
    { append: true },
  );
}

/**
 * Each frozen cell is completed (its latest completion's judgment and the
 * old one are found and both are of the cell: its execution and workspace,
 * the old one under its frozen fingerprint), mismatched (named: either is
 * of another cell), conflicting (named: completions name different new
 * judgments), missing (named: a judgment is not in the store) or pending
 * (no completion yet). Nothing is dropped or silently resolved.
 */
export function reconcilePairing(
  p: Pairing,
  completions: readonly Completion[],
  judgment: (id: string) => JudgmentRecord | undefined,
): {
  completed: (PairingCell & { old: JudgmentRecord; new: JudgmentRecord })[];
  pending: string[];
  missing: string[];
  mismatched: string[];
  conflicting: string[];
} {
  const named = new Map<string, Set<string>>();
  for (const c of completions) {
    const s = named.get(c.execution_id) ?? new Set<string>();
    s.add(c.new_judgment_id);
    named.set(c.execution_id, s);
  }
  const r = {
    completed: [] as (PairingCell & {
      old: JudgmentRecord;
      new: JudgmentRecord;
    })[],
    pending: [] as string[],
    missing: [] as string[],
    mismatched: [] as string[],
    conflicting: [] as string[],
  };
  const ofCell = (cell: PairingCell, j: JudgmentRecord) =>
    j.execution_id === cell.execution_id &&
    j.workspace_hash === cell.workspace_hash;
  for (const cell of p.cells) {
    const ids = named.get(cell.execution_id);
    if (!ids) {
      r.pending.push(cell.cell);
      continue;
    }
    if (ids.size > 1) {
      r.conflicting.push(cell.cell);
      continue;
    }
    const c = { new_judgment_id: [...ids][0]! };
    const old = judgment(cell.old_judgment_id);
    const neu = judgment(c.new_judgment_id);
    if (!old || !neu) r.missing.push(cell.cell);
    else if (
      !ofCell(cell, old) || !ofCell(cell, neu) ||
      old.scorer_fingerprint !== cell.scorer_fingerprint
    ) r.mismatched.push(cell.cell);
    else r.completed.push({ ...cell, old, new: neu });
  }
  return r;
}

export interface PairingReport {
  digest: string;
  cohort: Pairing["cohort"];
  /** Completed pairs: the matrix sums to this. */
  pairs: number;
  pending: string[];
  missing: string[];
  /** Completions whose judgments are not of their cell (reconcilePairing). */
  mismatched: string[];
  /** Cells whose completions name different new judgments (orch Sol r1 #2). */
  conflicting: string[];
  matrix: Record<OldVerdict, Record<"pass" | "fail" | "unscored", number>>;
  /** Pairs per flag; flags are nonexclusive, so they need not sum to `pairs`. */
  flags: Record<PairFlag, number>;
  cells: { cell: string; old: string; new: string; flags: PairFlag[] }[];
}

/** A frozen pairing's report; `oldUnknown`: the old oracle has no descriptor. */
export function pairingReport(
  digest: string,
  p: Pairing,
  completions: readonly Completion[],
  judgment: (id: string) => JudgmentRecord | undefined,
  oldUnknown: (old: JudgmentRecord) => boolean,
  /** An old judgment's verdict log (v1 policy from log, r3 6.2). */
  oldLog: (
    old: JudgmentRecord,
  ) => LogEvidence | undefined = () => undefined,
  /** The old judgment's trusted task descriptor (orch Sol r1 #3), if known. */
  trustedOf: (old: JudgmentRecord) =>
    | {
      pass_to_pass: readonly {
        codeunit: number;
        procedures: readonly string[];
      }[];
    }
    | undefined = () => undefined,
): PairingReport {
  const r = reconcilePairing(p, completions, judgment);
  const flags = Object.fromEntries(PAIR_FLAGS.map((f) => [f, 0])) as Record<
    PairFlag,
    number
  >;
  const cells = r.completed.map((c) => {
    const fs = pairFlags(c.old, c.new, oldLog(c.old), trustedOf(c.old));
    for (const f of fs) flags[f]++;
    return {
      cell: c.cell,
      old: oldUnknown(c.old) ? "legacy_unknown" : c.old.verdict,
      new: c.new.verdict,
      flags: fs,
    };
  });
  return {
    digest,
    cohort: p.cohort,
    pairs: r.completed.length,
    pending: r.pending,
    missing: r.missing,
    mismatched: r.mismatched,
    conflicting: r.conflicting,
    matrix: transitionMatrix(
      r.completed.map((c) => ({
        old: c.old,
        new: c.new,
        oldUnknown: oldUnknown(c.old),
      })),
    ),
    flags,
    cells,
  };
}

export function renderPairing(r: PairingReport): string {
  const out = [
    `Pairing ${r.digest} (campaign ${r.cohort.campaign}, frozen ${r.cohort.started_at})`,
    `  ${r.pairs} completed, ${r.pending.length} pending, ${r.missing.length} missing`,
  ];
  if (r.pending.length > 0) out.push(`  pending: ${r.pending.join(", ")}`);
  if (r.missing.length > 0) out.push(`  missing: ${r.missing.join(", ")}`);
  if (r.mismatched.length > 0) {
    out.push(
      `  mismatched (a judgment not of its cell): ${r.mismatched.join(", ")}`,
    );
  }
  if (r.conflicting.length > 0) {
    out.push(
      `  conflicting (completions name different judgments): ${
        r.conflicting.join(", ")
      }`,
    );
  }
  out.push("  old -> new verdict (completed pairs):");
  for (const [old, row] of Object.entries(r.matrix)) {
    out.push(
      `    ${
        Object.entries(row).map(([neu, n]) => `${old} -> ${neu} ${n}`).join(
          ", ",
        )
      }`,
    );
  }
  out.push(
    `  flags (nonexclusive): ${
      Object.entries(r.flags).map(([f, n]) => `${f} ${n}`).join(", ")
    }`,
  );
  return out.join("\n");
}
