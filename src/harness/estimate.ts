/**
 * Dry-run estimate (plan M5-02, spec 1a section 6): time and paid spend of
 * the outstanding cells of each arm, from prior executions of the same arm
 * manifest in any campaign. Pure: the caller reads the records.
 */

export interface PriorExecution {
  arm_manifest_hash: string;
  /** `${campaign_id}:${task}#${repeat}` */
  cell: string;
  /** ended_at - started_at of the execution */
  exec_ms: number;
  /** FIRST judgment of the execution only (a later rejudge is ignored) */
  verdict_ms: number | null;
  /** telemetry.cost_usd */
  list_cost_usd: number | null;
  /** telemetry.reported_cost_usd */
  paid_cost_usd: number | null;
}

export interface ArmPlan {
  arm: string;
  manifest_hash: string;
  paid: boolean;
  outstanding_cells: number;
}

export interface ArmEstimate extends ArmPlan {
  samples: number;
  cells_sampled: number;
  attempts_per_cell: number | null;
  exec_ms_mean: number | null;
  verdict_ms_mean: number | null;
  unknown_list_cost: number;
  unknown_paid_cost: number;
  projected_ms: number | null;
  projected_paid_usd: number | null;
  /** samples > 0, verdict mean known, and (paid => unknown_paid_cost === 0) */
  complete: boolean;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const known = (xs: (number | null)[]): number[] =>
  xs.filter((x): x is number => x !== null);

export function estimateArms(
  arms: ArmPlan[],
  prior: PriorExecution[],
): ArmEstimate[] {
  return arms.map((a) => {
    const mine = prior.filter((p) => p.arm_manifest_hash === a.manifest_hash);
    const samples = mine.length;
    const cells_sampled = new Set(mine.map((p) => p.cell)).size;
    const attempts = samples === 0 ? null : samples / cells_sampled;
    const exec = mean(mine.map((p) => p.exec_ms));
    const verdict = mean(known(mine.map((p) => p.verdict_ms)));
    const paid = mean(known(mine.map((p) => p.paid_cost_usd)));
    const unknown_paid_cost = mine.filter((p) => p.paid_cost_usd === null)
      .length;
    const per = a.outstanding_cells * (attempts ?? 0);
    return {
      ...a,
      samples,
      cells_sampled,
      attempts_per_cell: attempts,
      exec_ms_mean: exec,
      verdict_ms_mean: verdict,
      unknown_list_cost: mine.filter((p) => p.list_cost_usd === null).length,
      unknown_paid_cost,
      projected_ms: exec === null || verdict === null
        ? null
        : per * (exec + verdict),
      projected_paid_usd: a.paid && paid !== null ? per * paid : null,
      complete: samples > 0 && verdict !== null &&
        (!a.paid || unknown_paid_cost === 0),
    };
  });
}

const hours = (ms: number) => (ms / 3_600_000).toFixed(1);
const usd = (x: number) => `$${x.toFixed(2)}`;

export function renderEstimate(es: ArmEstimate[]): string[] {
  const lines = es.map((e) => {
    const head = `[DRY] estimate ${e.arm}: ${e.outstanding_cells} cells`;
    if (e.samples === 0) {
      return `${head}; no prior executions of this manifest`;
    }
    const reasons: string[] = [];
    if (e.verdict_ms_mean === null) reasons.push("no verdict time");
    if (e.paid && e.unknown_paid_cost > 0) {
      reasons.push(
        `${e.unknown_paid_cost} of ${e.samples} executions without a paid cost`,
      );
    }
    const time = e.projected_ms === null
      ? ""
      : ` x ${Number(e.attempts_per_cell!.toFixed(2))} attempts x ${
        ((e.exec_ms_mean! + e.verdict_ms_mean!) / 60_000).toFixed(1)
      } min = ${hours(e.projected_ms)} h`;
    const tail = reasons.length > 0
      ? `; INCOMPLETE (${reasons.join(", ")})`
      : e.paid
      ? `; paid ${usd(e.projected_paid_usd!)}`
      : "";
    return `${head}${time}${tail} (${e.samples} samples)`;
  });
  const times = es.map((e) => e.projected_ms);
  const total = times.includes(null)
    ? "unknown"
    : `${hours(times.reduce<number>((a, b) => a + b!, 0))} h`;
  const paidArms = es.filter((e) => e.paid);
  const paid = paidArms.length === 0
    ? "none (no paid arm)"
    : paidArms.every((e) => e.complete)
    ? usd(paidArms.reduce((a, e) => a + e.projected_paid_usd!, 0))
    : "unknown";
  lines.push(`[DRY] total ${total} at concurrency 1; paid projected ${paid}`);
  return lines;
}
