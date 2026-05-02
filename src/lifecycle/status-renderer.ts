/**
 * Lifecycle status matrix renderer. Pure function — produces an ANSI string
 * from a flat list of `StateRow` records.
 *
 * Symbol vocabulary (CLAUDE.md mandates `@std/fmt/colors` over emoji):
 *
 *   OK     green   recent terminal completion (`.completed`/`.captured`)
 *   STALE  yellow  terminal completion older than {@link STALE_DAYS} days
 *   …      yellow  in-progress (`.started` with no terminal pair recorded)
 *   --     gray    no event for this (model, step) combination yet
 *
 * Layout: model column is {@link MODEL_COL_WIDTH} chars (truncated with
 * Unicode ellipsis when wider), each step column is {@link STEP_COL_WIDTH}
 * chars centred. The total width is constrained to fit 80-col terminals
 * with slack — the renderer's tests assert this invariant explicitly.
 *
 * @module src/lifecycle/status-renderer
 */
import * as colors from "@std/fmt/colors";
import type { StateRow, Step } from "./status-types.ts";

export interface RenderOptions {
  /** Apply ANSI colours and emit the legend line. Defaults to `true`. */
  color?: boolean;
  /** Render the matrix in a dimmed style — used for the `--legacy` section. */
  dim?: boolean;
}

/** Steps shown as columns; `cycle.*` events are tracked but not rendered. */
const DISPLAY_STEPS: readonly Step[] = ["bench", "debug", "analyze", "publish"];

/** Threshold past which a terminal `.completed` row flips to STALE. */
export const STALE_DAYS = 14;

/**
 * Tolerance for normal clock-jitter between machines (ms). A `last_ts` up to
 * this far in the future is treated as "now" — past this, the cell is flagged
 * as clock-skewed and rendered STALE so an absurd future timestamp can't
 * silently render OK.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * Detect a materially-future timestamp. Exported so `status-hints.ts` can
 * compute the same predicate (single source of truth — drift between the
 * renderer's STALE flag and the hint generator's clock-skew hint would
 * confuse operators).
 */
export function isClockSkewed(
  lastTs: number,
  now: number = Date.now(),
): boolean {
  return lastTs > now + CLOCK_SKEW_TOLERANCE_MS;
}

const MODEL_COL_WIDTH = 40;
const STEP_COL_WIDTH = 8;
const TOTAL_WIDTH = MODEL_COL_WIDTH + STEP_COL_WIDTH * DISPLAY_STEPS.length;

interface CellSummary {
  sym: string;
  state: "ok" | "stale" | "in_progress" | "missing";
}

function summarizeCell(row: StateRow | undefined): CellSummary {
  if (!row) return { sym: "--", state: "missing" };
  if (row.last_event_type.endsWith(".started")) {
    return { sym: "…", state: "in_progress" };
  }
  // Clock-skew belt-and-suspenders: a future last_ts (clock skew across
  // machines, or a future-bug in event ingestion) would otherwise render as
  // OK because `Date.now() - r.last_ts` is negative and `negative > STALE_DAYS`
  // is false. Surface it as STALE so the operator notices.
  if (isClockSkewed(row.last_ts)) return { sym: "STALE", state: "stale" };
  // Clamp to zero so any near-future timestamp within the tolerance window is
  // treated as "now" (avoiding negative ageDays leaking elsewhere if this
  // helper is reused).
  const ageDays = Math.max(
    0,
    (Date.now() - row.last_ts) / (1000 * 60 * 60 * 24),
  );
  if (ageDays > STALE_DAYS) return { sym: "STALE", state: "stale" };
  return { sym: "OK", state: "ok" };
}

function colorize(
  text: string,
  state: CellSummary["state"],
  color: boolean,
): string {
  if (!color) return text;
  switch (state) {
    case "ok":
      return colors.green(text);
    case "stale":
      return colors.yellow(text);
    case "in_progress":
      return colors.yellow(text);
    case "missing":
      return colors.gray(text);
  }
}

function visibleLength(s: string): number {
  // The renderer never emits ANSI mid-string except via colorize, but be
  // defensive — strip ANSI before measuring for layout.
  // deno-lint-ignore no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncate(s: string, width: number): string {
  if (s.length <= width) return s.padEnd(width);
  // The Unicode ellipsis is 1 visible char; reserve one column for it.
  return s.slice(0, width - 1) + "…";
}

function center(s: string, width: number): string {
  const visible = visibleLength(s);
  const pad = width - visible;
  if (pad <= 0) return s;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

/**
 * Group rows by model_slug, then by step. Each (model, step) keeps the
 * single row with the highest `last_event_id` — the worker's
 * `v_lifecycle_state` view already collapses to one per group, but we
 * re-collapse defensively in case a caller passes raw events (the snapshot
 * tests rely on this for fixture composition).
 */
function groupRows(rows: StateRow[]): Map<string, Map<Step, StateRow>> {
  const out = new Map<string, Map<Step, StateRow>>();
  for (const r of rows) {
    const inner = out.get(r.model_slug) ?? new Map<Step, StateRow>();
    const prev = inner.get(r.step);
    if (!prev || r.last_event_id > prev.last_event_id) {
      inner.set(r.step, r);
    }
    out.set(r.model_slug, inner);
  }
  return out;
}

/**
 * Render the per-model lifecycle status matrix.
 *
 * @param rows  Flat list of (model, step) state rows. Order is irrelevant.
 * @param opts  Color / dim options. Defaults to color-on, dim-off.
 * @returns ANSI string suitable for `console.log`.
 */
export function renderMatrix(
  rows: StateRow[],
  opts: RenderOptions = {},
): string {
  const color = opts.color ?? true;
  const dim = opts.dim ?? false;
  const grouped = groupRows(rows);
  const models = Array.from(grouped.keys()).sort();

  const lines: string[] = [];

  // Header
  const headerCells = ["MODEL".padEnd(MODEL_COL_WIDTH)];
  for (const step of DISPLAY_STEPS) {
    headerCells.push(center(step.toUpperCase(), STEP_COL_WIDTH));
  }
  const header = headerCells.join("");
  lines.push(dim && color ? colors.dim(header) : header);
  lines.push("-".repeat(TOTAL_WIDTH));

  if (models.length === 0) {
    lines.push("(no rows)");
  }

  for (const model of models) {
    const cells = grouped.get(model)!;
    const cols: string[] = [truncate(model, MODEL_COL_WIDTH)];
    for (const step of DISPLAY_STEPS) {
      const sum = summarizeCell(cells.get(step));
      const colored = colorize(sum.sym, sum.state, color);
      cols.push(center(colored, STEP_COL_WIDTH));
    }
    const line = cols.join("");
    lines.push(dim && color ? colors.dim(line) : line);
  }

  // Legend (color mode only — plain mode is for piping/grep where the legend
  // adds noise).
  if (color) {
    lines.push("");
    const legend = [
      colors.gray("Legend:"),
      `${colors.green("OK")} ok`,
      `${colors.yellow("STALE")} >${STALE_DAYS}d`,
      `${colors.yellow("…")} in-progress`,
      `${colors.gray("--")} missing`,
    ].join("  ");
    lines.push(legend);
  }

  return lines.join("\n");
}
