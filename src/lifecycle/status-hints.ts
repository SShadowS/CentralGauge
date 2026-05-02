/**
 * Next-action hint generator for the lifecycle status command.
 *
 * Reads grouped state (one model → its four pipeline steps) and emits one
 * `Hint` record per model, prioritising the earliest blocking gap so a
 * single operator action unblocks the next stage. Severity levels gate
 * Plan G's CI workflow:
 *
 *   info  — purely informational (in-progress, no action needed yet)
 *   warn  — operator should run the suggested command
 *   error — reserved for invariant violations (none today)
 *
 * Hint copy policy: each hint includes a concrete shell command the
 * operator can paste. No "consider running" or "you may want to" — direct
 * imperative. The command strings are the user-facing API; renames here
 * MUST be coordinated with the corresponding `cycle` command flags
 * (`--to`, `--from`, `--force-rerun`).
 *
 * Order of precedence per model (first match wins):
 *
 *   1. bench missing               → cycle --to bench
 *   2. bench in-progress           → info, no action
 *   3. bench stale + no analyze    → cycle --force-rerun bench
 *   4. debug missing               → cycle --from debug-capture
 *   5. analyze missing             → cycle --from analyze
 *   6. analyze in-progress         → info, no action
 *   7. analyze stale               → cycle --force-rerun analyze
 *   8. publish missing             → cycle --from publish
 *   9. otherwise                   → no hint (fully current)
 *
 * @module src/lifecycle/status-hints
 */
import type { Hint, StateRow, Step } from "./status-types.ts";
import { isClockSkewed, STALE_DAYS } from "./status-renderer.ts";

interface ModelState {
  bench?: StateRow;
  debug?: StateRow;
  analyze?: StateRow;
  publish?: StateRow;
}

function groupByModel(rows: StateRow[]): Map<string, ModelState> {
  const out = new Map<string, ModelState>();
  for (const r of rows) {
    const slot = out.get(r.model_slug) ?? {};
    // We index `slot` by step name; the type guard via `Step` keeps the
    // dynamic write narrow for noUncheckedIndexedAccess.
    const stepKey = r.step as Step;
    if (stepKey === "cycle") {
      // cycle.* events are tracked in the event log but don't drive a
      // hint — they're orchestrator bookkeeping. Skip silently.
      continue;
    }
    const existing = slot[stepKey];
    if (!existing || r.last_event_id > existing.last_event_id) {
      slot[stepKey] = r;
    }
    out.set(r.model_slug, slot);
  }
  return out;
}

function isStale(r: StateRow | undefined): boolean {
  if (!r) return false;
  if (r.last_event_type.endsWith(".started")) return false;
  // Clamp negative ageDays to zero so a clock-skewed row doesn't get stale
  // (the dedicated clock-skew hint takes precedence in `hintFor`).
  const ageDays = Math.max(0, (Date.now() - r.last_ts) / (1000 * 60 * 60 * 24));
  return ageDays > STALE_DAYS;
}

/**
 * Detect a clock-skewed row across any of the model's tracked steps. Returns
 * the first skewed row encountered (priority: bench → debug → analyze →
 * publish) so the hint command identifies the offending row's slug.
 */
function findClockSkewedRow(st: ModelState): StateRow | undefined {
  for (const step of ["bench", "debug", "analyze", "publish"] as const) {
    const r = st[step];
    if (r && isClockSkewed(r.last_ts)) return r;
  }
  return undefined;
}

function isInProgress(r: StateRow | undefined): boolean {
  return !!r && r.last_event_type.endsWith(".started");
}

function isMissing(r: StateRow | undefined): boolean {
  return r === undefined;
}

function hintFor(model: string, st: ModelState): Hint | null {
  // 0. Clock-skew (future last_ts) — highest precedence so an absurd
  // future timestamp never gets masked by a downstream missing-step hint.
  // The matrix renderer flags the row as STALE in lockstep
  // (see `isClockSkewed` in status-renderer.ts).
  const skewed = findClockSkewedRow(st);
  if (skewed) {
    return {
      model_slug: model,
      severity: "info",
      text: `Future timestamp detected for ${model} (clock skew?). Re-poll: ` +
        `centralgauge lifecycle status --model ${model}`,
      command: `centralgauge lifecycle status --model ${model}`,
    };
  }
  // 1. bench missing → entry-point hint.
  if (isMissing(st.bench)) {
    return {
      model_slug: model,
      severity: "warn",
      text: `${model}: never benched against current task set`,
      command: `centralgauge cycle --llms ${model} --to bench`,
    };
  }
  // 2. bench in-progress.
  if (isInProgress(st.bench)) {
    return {
      model_slug: model,
      severity: "info",
      text: `${model}: bench in progress`,
      command: `centralgauge lifecycle status --model ${model} --json`,
    };
  }
  // 3. bench stale and no downstream analyze → re-bench before cascading.
  if (isStale(st.bench) && !st.analyze) {
    return {
      model_slug: model,
      severity: "warn",
      text:
        `${model}: bench stale (>${STALE_DAYS}d) and never analyzed; re-bench`,
      command: `centralgauge cycle --llms ${model} --force-rerun bench`,
    };
  }
  // 4. debug missing.
  if (isMissing(st.debug)) {
    return {
      model_slug: model,
      severity: "warn",
      text: `${model}: missing debug capture run`,
      command: `centralgauge cycle --llms ${model} --from debug-capture`,
    };
  }
  // 5. analyze missing.
  if (isMissing(st.analyze)) {
    return {
      model_slug: model,
      severity: "warn",
      text: `${model}: missing analysis run`,
      command: `centralgauge cycle --llms ${model} --from analyze`,
    };
  }
  // 6. analyze in-progress.
  if (isInProgress(st.analyze)) {
    return {
      model_slug: model,
      severity: "info",
      text: `${model}: analysis in progress`,
      command: `centralgauge lifecycle status --model ${model} --json`,
    };
  }
  // 7. analyze stale → re-analyze.
  if (isStale(st.analyze)) {
    return {
      model_slug: model,
      severity: "warn",
      text: `${model}: analysis stale (>${STALE_DAYS}d); re-analyze`,
      command: `centralgauge cycle --llms ${model} --force-rerun analyze`,
    };
  }
  // 8. publish missing.
  if (isMissing(st.publish)) {
    return {
      model_slug: model,
      severity: "warn",
      text: `${model}: analysis present but not published`,
      command: `centralgauge cycle --llms ${model} --from publish`,
    };
  }
  // 9. fully current.
  return null;
}

/**
 * Generate one hint per model with a non-trivial gap. Models that are fully
 * current produce no hint, keeping the operator's action list short.
 */
export function generateHints(rows: StateRow[]): Hint[] {
  const grouped = groupByModel(rows);
  const out: Hint[] = [];
  const sortedModels = Array.from(grouped.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  for (const [model, st] of sortedModels) {
    const h = hintFor(model, st);
    if (h) out.push(h);
  }
  return out;
}
