/**
 * Append-only spend record for dashboard model calls.
 *
 * The bench has had a live cost display since its own dashboard shipped
 * (`cli/dashboard/page.ts` renders a running total). The authoring dashboard
 * had none: `createModelCaller` discarded the adapter's `usage`, so a quick
 * run over five models spent real money and reported nothing, and there was
 * no way to answer "what did this week of authoring cost" afterwards.
 *
 * One JSON object per model call, appended. Deliberately not a database: it
 * has to survive a killed process, be readable with `tail`, and never block
 * a run. Anything that wants aggregates reads the file.
 *
 * NOT a billing record. `estimatedCost` is the adapter's own estimate from
 * the catalog's per-token rates; it will not reconcile to a provider
 * statement exactly, and it cannot see spend that never went through these
 * adapters (Claude Code subagents, `pi_ask`) at all.
 *
 * @module dashboard/cost-ledger
 */

import type { TokenUsage } from "../llm/types.ts";

/** Default location. Relative paths resolve against the process cwd. */
export const DEFAULT_COST_LEDGER = "results/model-costs.jsonl";

export interface CostLedgerEntry {
  /** ISO timestamp of the call's completion. */
  at: string;
  /** What spent the money: a draft id for a quick run. */
  draftId: string;
  model: string;
  /** `"quick-run"` today; escalation fix attempts will add their own. */
  kind: string;
  promptTokens: number;
  completionTokens: number;
  /** The adapter's own estimate, USD. Absent when it did not report one. */
  costUsd?: number;
}

/**
 * Appends one entry. Never throws: a spend record that can break a run is
 * worse than one with a gap in it, and the caller is mid-run with a real
 * result in hand.
 *
 * Returns whether the write landed, so a caller that wants to warn can.
 */
export async function recordCost(
  entry: CostLedgerEntry,
  path: string = DEFAULT_COST_LEDGER,
): Promise<boolean> {
  try {
    const dir = path.replace(/[/\\][^/\\]*$/, "");
    if (dir && dir !== path) {
      await Deno.mkdir(dir, { recursive: true });
    }
    await Deno.writeTextFile(path, JSON.stringify(entry) + "\n", {
      append: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Records every response in a finished run that reported usage. Responses
 * that errored before billing carry no usage and are skipped rather than
 * written as zero, so a gap in the ledger means "no tokens billed" and a
 * zero means "billed nothing".
 */
export async function recordRunCosts(
  draftId: string,
  responses: ReadonlyArray<{ model: string; usage?: TokenUsage }>,
  path: string = DEFAULT_COST_LEDGER,
): Promise<void> {
  const at = new Date().toISOString();
  for (const r of responses) {
    if (!r.usage) continue;
    await recordCost({
      at,
      draftId,
      model: r.model,
      kind: "quick-run",
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
      ...(r.usage.estimatedCost !== undefined
        ? { costUsd: r.usage.estimatedCost }
        : {}),
    }, path);
  }
}

/** Running total of a ledger file, USD. `0` when the file is absent. */
export async function ledgerTotal(
  path: string = DEFAULT_COST_LEDGER,
): Promise<{ totalUsd: number; calls: number }> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return { totalUsd: 0, calls: 0 };
  }
  let totalUsd = 0;
  let calls = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as CostLedgerEntry;
      totalUsd += e.costUsd ?? 0;
      calls++;
    } catch {
      // A truncated final line from a killed process is expected; skip it
      // rather than failing the whole read.
    }
  }
  return { totalUsd, calls };
}
