/**
 * Judgment selection and the join from immutable records to per-cell
 * results (spec 1a section 8, owner rules
 * H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md). The termination
 * policy and retry-chain grouping live in records.ts (M1-07) so M1-07b can
 * validate them.
 *
 * - Chains are resolved by `retry_of` ancestry. The planned chain (planned
 *   root plus its automatic retries) resolves by its last member.
 * - A manual rerun roots its own chain. A manual chain never replaces a
 *   scored planned-chain result; it is used only when the planned chain has
 *   none, newest manual root first, and the cell records which execution
 *   was used.
 * - Every attempt's spend (all chains) stays in the cell.
 * - Judgments are selected in an explicit, complete judging context: same
 *   execution, task and workspace, and the context's oracle for the task.
 *   Newest `ended_at` wins, ties broken by the larger judgment id.
 */

import { ValidationError } from "../errors.ts";
import {
  type CampaignRecord,
  compareInstant,
  type ExecutionRecord,
  type JudgmentRecord,
  outcomePolicy,
  type RetryChain,
  retryChains,
  retryProblem,
  type RunKind,
} from "./records.ts";
import type { Cell, CellStatus } from "./stats.ts";

/** Which oracle each task is judged against. Must cover every task. */
export interface JudgingContext {
  source: "campaign" | "current";
  oracle: Map<string, string>;
}

export function campaignJudging(c: CampaignRecord): JudgingContext {
  return {
    source: "campaign",
    oracle: new Map(c.task_set.tasks.map((t) => [t.id, t.oracle])),
  };
}

/** Refuse a judging context that has no oracle for a campaign task. */
export function checkJudging(c: CampaignRecord, ctx: JudgingContext): void {
  const missing = c.task_set.tasks.filter((t) => !ctx.oracle.has(t.id))
    .map((t) => t.id);
  if (missing.length > 0) {
    throw new ValidationError(
      `${ctx.source} judging context has no oracle for ${missing.join(", ")}`,
      missing,
    );
  }
}

export function selectJudgment(
  e: ExecutionRecord,
  judgments: JudgmentRecord[],
  oracle: string,
): JudgmentRecord | null {
  let best: JudgmentRecord | null = null;
  const ids = new Set<string>();
  for (const j of judgments) {
    if (
      j.execution_id !== e.id || j.task_id !== e.task_id ||
      j.workspace_hash !== e.workspace_hash || j.task_oracle_hash !== oracle
    ) continue;
    // Two candidates under one id cannot be ordered: refuse, never pick.
    if (ids.has(j.id)) {
      throw new ValidationError(
        `duplicate judgment id ${j.id} for execution ${e.id}`,
        [j.id],
      );
    }
    ids.add(j.id);
    const d = best === null ? 1 : compareInstant(j.ended_at, best.ended_at);
    if (d > 0 || (d === 0 && j.id > best!.id)) best = j;
  }
  return best;
}

/** A Cell plus the provenance the report shows. */
export interface CellRecord extends Cell {
  used_execution: string | null;
  used_kind: RunKind | null;
  judgment_id: string | null;
  oracle_hash: string | null;
  scorer_fingerprint: string | null;
  manual_reruns: number;
}

interface Resolved {
  status: CellStatus;
  pass: boolean | null;
  judgment: JudgmentRecord | null;
}

function resolveChain(
  chain: RetryChain,
  judgments: (e: ExecutionRecord) => JudgmentRecord[],
  oracle: string,
): Resolved {
  const last = chain.members[chain.members.length - 1]!;
  const policy = outcomePolicy(last.termination, last.did_work);
  if (policy.judge) {
    const j = selectJudgment(last, judgments(last), oracle);
    if (j && j.verdict !== "unscored") {
      return { status: "scored", pass: j.verdict === "pass", judgment: j };
    }
    // No compatible verdict yet, or a verdict-side infra fault awaiting a
    // rejudge on another container (spec 1a section 8).
    return { status: "pending", pass: null, judgment: j };
  }
  if (policy.retry === "once" && chain.members.length > 1) {
    const parent = chain.members[chain.members.length - 2]!;
    if (outcomePolicy(parent.termination, parent.did_work).retry === "once") {
      // The one automatic retry was used and failed the same way.
      return { status: "unscored", pass: null, judgment: null };
    }
  }
  return { status: "pending", pass: null, judgment: null };
}

/** One CellRecord per planned (block, arm). */
export function cellsFromRecords(
  campaign: CampaignRecord,
  executions: ExecutionRecord[],
  judgments: Map<string, JudgmentRecord[]>,
  judging: JudgingContext = campaignJudging(campaign),
): CellRecord[] {
  checkJudging(campaign, judging);
  const key = (task: string, repeat: number, arm: string) =>
    `${task}\u0000${repeat}\u0000${arm}`;
  const byCell = new Map<string, ExecutionRecord[]>();
  for (const b of campaign.blocks) {
    for (const arm of b.order) byCell.set(key(b.task_id, b.repeat, arm), []);
  }
  for (const e of executions) {
    const cell = byCell.get(key(e.task_id, e.repeat, e.arm));
    // A foreign or unplanned execution is refused, never silently dropped.
    if (e.campaign_id !== campaign.id || !cell) {
      throw new ValidationError(
        `execution ${e.id} (${e.task_id}/${e.repeat}/${e.arm}) is not in campaign ${campaign.id}`,
        [e.id],
      );
    }
    cell.push(e);
  }
  const js = (e: ExecutionRecord) => judgments.get(e.id) ?? [];
  const cells: CellRecord[] = [];
  for (const b of campaign.blocks) {
    for (const arm of b.order) {
      const all = byCell.get(key(b.task_id, b.repeat, arm)) ?? [];
      const label = `${b.task_id}/${b.repeat}/${arm}`;
      if (new Set(all.map((e) => e.attempt)).size !== all.length) {
        throw new ValidationError(
          `duplicate attempt numbers in cell ${label}`,
          [
            label,
          ],
        );
      }
      const { chains, orphans } = retryChains(all);
      if (orphans.length > 0) {
        throw new ValidationError(`broken retry chain in cell ${label}`, [
          label,
        ]);
      }
      // A disallowed automatic retry would replace its parent's result.
      for (const { members } of chains) {
        for (let i = 1; i < members.length; i++) {
          const problem = retryProblem(
            members[i - 1]!,
            members[i]!,
            members[i - 2],
          );
          if (problem) {
            throw new ValidationError(`${problem} in cell ${label}`, [label]);
          }
        }
      }
      // Sum in attempt order (unique per cell, checked above): float
      // addition is not associative, so input order must not leak in.
      const known = [...all].sort((x, y) => x.attempt - y.attempt)
        .map((e) => e.telemetry.cost_usd);
      const knownSum = known.reduce<number>((a, c) => a + (c ?? 0), 0);
      const cell: CellRecord = {
        task: b.task_id,
        arm,
        repeat: b.repeat,
        status: all.length === 0 ? "unrun" : "pending",
        pass: null,
        spend_usd: known.includes(null) ? null : knownSum,
        known_spend_usd: knownSum,
        attempts: all.length,
        used_execution: null,
        used_kind: null,
        judgment_id: null,
        oracle_hash: null,
        scorer_fingerprint: null,
        manual_reruns: all.filter((e) => e.run_kind === "manual_rerun").length,
      };
      const oracle = judging.oracle.get(b.task_id)!;
      const use = (chain: RetryChain, r: Resolved) => {
        const last = chain.members[chain.members.length - 1]!;
        cell.status = r.status;
        cell.pass = r.pass;
        cell.used_execution = last.id;
        cell.used_kind = chain.root.run_kind;
        cell.judgment_id = r.judgment?.id ?? null;
        cell.oracle_hash = r.judgment?.task_oracle_hash ?? null;
        cell.scorer_fingerprint = r.judgment?.scorer_fingerprint ?? null;
      };
      const planned = chains.find((c) => c.root.run_kind === "planned");
      if (all.length > 0 && !planned) {
        throw new ValidationError(`no planned execution in cell ${label}`, [
          label,
        ]);
      }
      if (planned) use(planned, resolveChain(planned, js, oracle));
      if (cell.status !== "scored") {
        const manual = chains.filter((c) => c.root.run_kind === "manual_rerun")
          .sort((x, y) => y.root.attempt - x.root.attempt)
          .map((m) => ({ m, r: resolveChain(m, js, oracle) }));
        const scored = manual.find((x) => x.r.status === "scored");
        // A terminally unscored planned result is not final while a manual
        // rerun is still pending: the newest pending one keeps it pending.
        const pending = cell.status === "unscored"
          ? manual.find((x) => x.r.status === "pending")
          : undefined;
        const pick = scored ?? pending;
        if (pick) use(pick.m, pick.r);
      }
      cells.push(cell);
    }
  }
  return cells;
}
