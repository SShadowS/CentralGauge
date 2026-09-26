// Usage: deno run --allow-read --allow-write scripts/harness/report-charts.ts --out <dir>
//          [--report <path> ...] [--ledger <path>]
// Turns the explicitly selected `harness report --json` outputs into slide
// charts (SVG) and typed CSVs (arms, comparisons, provenance; ledger with a
// ledger). Adds no metric: every number comes from the report or the ledger.
// A ledger with no report (no experiment has a headline) writes ledger.csv
// only, every action scoped not_reported. Refuses a run with neither, an
// existing non-empty --out, duplicate reports, a report whose partial marker
// contradicts it and a ledger that disagrees with the reports.

import * as colors from "@std/fmt/colors";
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../../src/errors.ts";
import {
  type HarnessReport,
  partialOf,
  partialText,
} from "../../src/harness/report.ts";

/**
 * A real id, never a template placeholder (M6-02a F12: `<task#repeat:arm>`
 * came from the handoff template): no space, `<>{}`, and no `#` or `:`,
 * which delimit the ledger.csv key `task#repeat:arm`.
 */
const Id = z.string().regex(
  /^[^\s<>{}#:]+$/,
  "must be a real id: non-empty, no whitespace, <, >, {, }, # or :",
);
/** Free text (a decision path), but never empty or a placeholder. */
const Text = z.string().regex(
  /^[^<>{}]+$/,
  "must be non-empty with no <, >, { or } (placeholder)",
);

const Action = {
  experiment: Id,
  campaign: Id,
  task: Id,
  repeat: z.number().int().positive(), // >= 1, like an execution record (M6-02b)
  arm: Id,
  execution: Id,
};

/** Typed source for cash and actions (plan B10; schema rulings 2026-09-27). */
export const Ledger = z.strictObject({
  v: z.literal(1),
  paid_total_usd: z.number().nonnegative(),
  openrouter_actual_usd: z.number().nonnegative(),
  openrouter_balance_readings: z.array(
    z.strictObject({ at: z.iso.datetime(), balance_usd: z.number() }),
  ).min(1),
  claude_code_cash_usd: z.literal(0),
  /** Ruling 3: totals of every experiment, headline or not. */
  experiments: z.array(z.strictObject({
    id: Id,
    attempted_cells: z.number().int().nonnegative(),
    executions: z.number().int().nonnegative(),
    paid_usd: z.number().nonnegative().nullable(),
  })),
  manual_reruns: z.array(z.strictObject({ ...Action, decision: Text })),
  rejudges: z.array(
    z.strictObject({ ...Action, judgment: Id, decision: Text }),
  ),
  pi_stop: z.strictObject({
    fired: z.boolean(),
    experiment: Id.nullable(),
    at: z.iso.datetime().nullable(),
    last_complete_repeat: z.number().int().positive().nullable(),
    decision: Text.nullable(),
  }),
});
export type Ledger = z.infer<typeof Ledger>;

type Scope = "reported" | "excluded_repeat" | "not_reported";
type Report = HarnessReport;
type Comparison = Report["comparisons"][number];
export interface OutFile {
  name: string;
  content: string;
}

const OPENROUTER_TOPUP_USD = 60;
const W = 960;
const H = 540;
const PALETTE = ["#4E79A7", "#F28E2B", "#59A14F", "#B07AA1", "#76B7B2"];

function fail(msg: string): never {
  throw new ValidationError(msg, [msg]);
}

// --- formatting ---

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const csv = (head: string[], rows: (string | number | boolean | null)[][]) =>
  [head.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") +
  "\n";

const pct = (x: number | null) =>
  x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
/** List-price dollars are estimates, never cash (run 002 fix 2). */
const EST = "est. (list price)";
const money = (x: number) =>
  `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(3)} ${EST}`;
const usd = (x: number | null) => x === null ? "n/a" : money(x);
const share = (x: number) =>
  x > 0 && x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`;
const METRIC = {
  pass_rate: {
    title: "Pass rate",
    value: pct,
    num: (x: number) => x.toFixed(2),
  },
  cost_per_solved_task: {
    title: "Cost per solved task",
    value: usd,
    num: money,
  },
} as const;

function costNullReason(a: Report["arms"][number]): string {
  if (a.cost_per_solved_task !== null) return "";
  if (a.scored_cells === 0) return "no scored cells";
  if (a.pass_rate === 0) return "no solves";
  return "no eligible cost cohort";
}

export function verdictText(c: Comparison): string {
  if (c.distinguishable === null) return "CI suppressed";
  return c.distinguishable ? "distinguishable" : "not distinguishable";
}

/** Unscored cells' spend per arm (ruling 4); null when any cost is unknown. */
function unscoredSpend(r: Report, arm: string) {
  const cs = r.cells.filter((c) => c.arm === arm && c.status === "unscored");
  const unknown = cs.filter((c) => c.spend_usd === null).length;
  return {
    usd: unknown > 0 ? null : cs.reduce((s, c) => s + c.spend_usd!, 0),
    reason: unknown > 0
      ? `${arm}: ${unknown} of ${cs.length} unscored cells with unknown cost`
      : "",
  };
}

const prefix = (r: Report) =>
  `${r.experiment.id}__${r.campaign.id.slice(0, 8)}__${r.judging.source}`;
const armList = (
  r: Report,
) => [r.experiment.baseline, ...r.experiment.variants];

// --- ledger ---

interface Scoped {
  kind: "manual_rerun" | "rejudge";
  a: Ledger["manual_reruns"][number] & { judgment?: string };
  scope: Scope;
}

function checkLedger(reports: Report[], raw: unknown) {
  const parsed = Ledger.safeParse(raw);
  if (!parsed.success) {
    fail(`ledger does not match the schema: ${z.prettifyError(parsed.error)}`);
  }
  const l = parsed.data;
  const scopeOf = (a: Scoped["a"]): Scope => {
    const rs = reports.filter((r) => r.campaign.id === a.campaign);
    if (rs.length === 0) return "not_reported";
    for (const r of rs) {
      if (r.experiment.id !== a.experiment) {
        fail(
          `ledger action on campaign ${a.campaign} names experiment ${a.experiment}, the report says ${r.experiment.id}`,
        );
      }
    }
    if (!rs.some((r) => a.repeat <= r.repeats.reported)) {
      return "excluded_repeat";
    }
    if (!rs.every((r) => armList(r).includes(a.arm))) {
      fail(`ledger action names arm ${a.arm}, not in campaign ${a.campaign}`);
    }
    return "reported";
  };
  const actions: Scoped[] = [
    ...l.manual_reruns.map((a) => ({
      kind: "manual_rerun" as const,
      a,
      scope: scopeOf(a),
    })),
    ...l.rejudges.map((a) => ({
      kind: "rejudge" as const,
      a,
      scope: scopeOf(a),
    })),
  ];
  const reportedCount = (
    kind: Scoped["kind"],
    r: Report,
    arm: string,
  ) =>
    actions.filter((x) =>
      x.kind === kind && x.scope === "reported" &&
      x.a.campaign === r.campaign.id && x.a.arm === arm &&
      x.a.repeat <= r.repeats.reported
    ).length;
  for (const r of reports) {
    for (const c of r.coverage) {
      const n = reportedCount("manual_rerun", r, c.arm);
      if (n !== c.manual_reruns) {
        fail(
          `ledger manual reruns disagree with the report for ${r.experiment.id} / ${r.campaign.id} / ${c.arm}: ledger ${n}, report ${c.manual_reruns}`,
        );
      }
    }
  }
  const latest = [...l.openrouter_balance_readings].sort((a, b) =>
    Date.parse(a.at) - Date.parse(b.at)
  ).at(-1)!;
  const expected = OPENROUTER_TOPUP_USD - latest.balance_usd;
  if (Math.abs(expected - l.openrouter_actual_usd) > 1e-9) {
    fail(
      `openrouter_actual_usd ${l.openrouter_actual_usd} is not ${OPENROUTER_TOPUP_USD} minus the latest balance ${latest.balance_usd} (${latest.at})`,
    );
  }
  if (l.paid_total_usd < l.openrouter_actual_usd) {
    fail(
      `ledger paid_total_usd ${l.paid_total_usd} is below openrouter_actual_usd ${l.openrouter_actual_usd}`,
    );
  }
  const s = l.pi_stop;
  if (s.fired) {
    if (s.experiment === null || s.at === null || s.decision === null) {
      fail("pi_stop fired but lacks its experiment, time or decision");
    }
    for (const r of reports.filter((r) => r.experiment.id === s.experiment)) {
      if (r.repeats.reported !== s.last_complete_repeat) {
        fail(
          `pi_stop: report of ${s.experiment} reports ${r.repeats.reported} repeats, the last complete repeat is ${
            s.last_complete_repeat ?? "none"
          }`,
        );
      }
    }
  } else if (
    s.experiment !== null || s.at !== null ||
    s.last_complete_repeat !== null || s.decision !== null
  ) {
    fail(
      "pi_stop did not fire but carries an experiment, time, repeat or decision",
    );
  }
  const ids = l.experiments.map((e) => e.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup !== undefined) fail(`ledger lists duplicate experiment ${dup}`);
  for (const r of reports) {
    const e = l.experiments.find((e) => e.id === r.experiment.id);
    if (!e) fail(`ledger has no totals for experiment ${r.experiment.id}`);
    // The ledger covers every repeat; a report never holds more (run 002 fix 4).
    const attempted = r.arms.reduce((s, a) => s + a.attempted_cells, 0);
    const executions = r.coverage.reduce((s, c) => s + c.executions, 0);
    if (e.attempted_cells < attempted) {
      fail(
        `ledger ${e.id}.attempted_cells ${e.attempted_cells} is below the report's ${attempted}`,
      );
    }
    if (e.executions < executions) {
      fail(
        `ledger ${e.id}.executions ${e.executions} is below the report's ${executions}`,
      );
    }
  }
  return { l, actions, reportedCount };
}

function ledgerCsv(l: Ledger, actions: Scoped[]): string {
  const scalar = (
    experiment: string,
    key: string,
    value: unknown,
  ) => ["scalar", experiment, "", key, value as string, "all", ""];
  const rows = [
    scalar("", "paid_total_usd", l.paid_total_usd),
    scalar("", "openrouter_actual_usd", l.openrouter_actual_usd),
    scalar("", "claude_code_cash_usd", l.claude_code_cash_usd),
    ...([
      "fired",
      "experiment",
      "at",
      "last_complete_repeat",
      "decision",
    ] as const)
      .map((k) => scalar("", `pi_stop.${k}`, l.pi_stop[k])),
    ...l.experiments.flatMap((e) => [
      scalar(e.id, `${e.id}.attempted_cells`, e.attempted_cells),
      scalar(e.id, `${e.id}.executions`, e.executions),
      scalar(e.id, `${e.id}.paid_usd`, e.paid_usd),
    ]),
    ...actions.map(({ kind, a, scope }) => [
      kind,
      a.experiment,
      a.campaign,
      `${a.task}#${a.repeat}:${a.arm}`,
      kind === "rejudge" ? `${a.execution}/${a.judgment}` : a.execution,
      scope,
      a.decision,
    ]),
  ];
  return csv(
    ["kind", "experiment", "campaign", "key", "value", "scope", "decision"],
    rows,
  );
}

// --- SVG ---

interface Line {
  text: string;
  size?: number;
  bold?: boolean;
  fill?: string;
}

function header(r: Report, title: string): Line[] {
  const lines: Line[] = [
    { text: title, size: 20, bold: true },
    {
      text:
        `${r.experiment.id} | campaign ${r.campaign.id} | judging ${r.judging.source} ${
          r.judging.identity.slice(0, 12)
        } | ${r.campaign.tasks} tasks`,
    },
  ];
  if (partialOf(r) !== null) {
    lines.push({ text: partialText(r), bold: true, fill: "#C0392B" });
  }
  if (r.provisional) {
    lines.push({ text: "PROVISIONAL", bold: true, fill: "#C0392B" });
  }
  if (r.repeats.reported < r.repeats.planned) {
    const sum = (f: (c: Report["coverage"][number]) => number) =>
      r.coverage.reduce((s, c) => s + f(c), 0);
    const invalid = sum((c) => c.excluded_trace_invalid);
    lines.push({
      text:
        `Repeats reported ${r.repeats.reported} of ${r.repeats.planned}; excluded ${
          sum((c) => c.excluded_cells)
        } cells, $${sum((c) => c.excluded_known_spend_usd).toFixed(2)} ${EST}${
          invalid > 0
            ? `, ${invalid} invalid trace${invalid === 1 ? "" : "s"}`
            : ""
        }`,
      fill: "#C0392B",
    });
  }
  return lines;
}

const BAR_X = 480;
/** Conservative width estimate: 0.6 em per character (run 002 fix 1). */
const EM_PER_CHAR = 0.6;
const charsFit = (px: number, size: number) =>
  Math.floor(px / (size * EM_PER_CHAR));

/** Greedy word wrap; a word longer than the budget is split. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let word of text.split(" ")) {
    while (word.length > max) {
      if (cur) lines.push(cur), cur = "";
      lines.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= max) cur += " " + word;
    else lines.push(cur), cur = word;
  }
  if (cur || lines.length === 0) lines.push(cur);
  return lines;
}

interface Bar {
  label: string;
  value: number | null;
  max: number;
  color: string;
}

/** Text lines, then labelled horizontal bars, then footer lines. */
function svg(top: Line[], bars: Bar[], bottom: Line[]): string {
  const out: string[] = [];
  let y = 0;
  const line = (l: Line, t: string, x: number) =>
    out.push(
      `<text x="${x}" y="${y}" font-size="${l.size ?? 13}"${
        l.bold ? ' font-weight="bold"' : ""
      } fill="${l.fill ?? "#222"}">${esc(t)}</text>`,
    );
  const text = (l: Line, x = 24) => {
    const size = l.size ?? 13;
    for (const t of wrap(l.text, charsFit(W - x - 24, size))) {
      y += size + 8;
      line(l, t, x);
    }
  };
  top.forEach((l) => text(l));
  y += 8;
  const rowH = 22;
  for (const b of bars) {
    y += rowH;
    const len = b.value === null || b.max <= 0
      ? 0
      : Math.max(0, Math.min(1, b.value / b.max)) * 420;
    out.push(
      `<rect x="${BAR_X}" y="${y - 14}" width="${
        len.toFixed(1)
      }" height="16" fill="${b.color}"/>`,
    );
    // The label stays left of the bar; extra lines push the next row down.
    wrap(b.label, charsFit(BAR_X - 24 - 8, 13)).forEach((t, i) => {
      if (i > 0) y += 17;
      line({ text: t }, t, 24);
    });
  }
  y += 8;
  bottom.forEach((l) => text(l));
  const height = Math.max(H, y + 16);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="Segoe UI, Arial, sans-serif">\n<rect width="100%" height="100%" fill="#fff"/>\n${
    out.join("\n")
  }\n</svg>\n`;
}

function deltaLine(c: Comparison): string {
  const f = METRIC[c.metric].num;
  const cohort =
    `over ${c.pairs} matched pairs, ${c.tasks} tasks (${c.tasks_dropped} dropped)`;
  const tail = "; bars are per-arm, the delta is over matched pairs";
  const who = `${c.variant} vs ${c.baseline}:`;
  if (c.delta === null) {
    const why = c.pairs === 0
      ? "no matched pairs"
      : "no solved task in the matched pairs";
    return `${who} delta n/a (${why}) ${cohort}${tail}`;
  }
  const ci = c.ci === null
    ? `CI suppressed (${share(c.undefined_share)} undefined)`
    : `[${f(c.ci[0])}, ${f(c.ci[1])}] ${verdictText(c)}`;
  return `${who} delta ${f(c.delta)} ${ci} ${cohort}${tail}`;
}

const reasonsOf = (e: Partial<Record<string, number>>) =>
  Object.entries(e).sort(([a], [b]) => a < b ? -1 : 1)
    .map(([k, v]) => `${k} ${v}`).join(", ") || "none";

function primaryChart(
  r: Report,
  ledger: { excludedActions: number; paid: number | null } | null,
): string {
  const m = r.experiment.primary_metric;
  const other = m === "pass_rate" ? "cost_per_solved_task" : "pass_rate";
  const arms = r.arms;
  const values = arms.map((a) => a[m]);
  const max = m === "pass_rate"
    ? 1
    : Math.max(0, ...values.filter((v): v is number => v !== null));
  const bars = arms.map((a, i) => {
    const v = a[m];
    const why = m === "pass_rate" ? "no scored cells" : costNullReason(a);
    return {
      label: `${a.arm}: ${v === null ? `n/a (${why})` : METRIC[m].value(v)} (${
        METRIC[other].title.toLowerCase()
      } ${METRIC[other].value(a[other])})`,
      value: v,
      max,
      color: PALETTE[i % PALETTE.length]!,
    };
  });
  const bottom: Line[] = [
    ...r.comparisons.filter((c) => c.metric === m).flatMap((c) => [
      { text: deltaLine(c), size: 12 },
      {
        text: `  unmatched pairs: ${c.baseline} ${
          reasonsOf(c.excluded.baseline)
        }; ${c.variant} ${reasonsOf(c.excluded.variant)}`,
        size: 12,
      },
    ]),
    ...arms.map((a) => {
      const cov = r.coverage.find((c) => c.arm === a.arm);
      return {
        text:
          `${a.arm}: scored ${a.scored_cells}/${a.planned_cells}, unscored ${a.unscored_cells}, pending ${a.pending_cells}, unknown-cost ${a.unknown_spend_cells}, excluded ${
            cov?.excluded_cells ?? "n/a"
          }`,
        size: 12,
      };
    }),
  ];
  if (ledger !== null) {
    bottom.push({
      text: `Paid for ${r.experiment.id}: ${
        ledger.paid === null
          ? "n/a (not paid)"
          : `$${ledger.paid.toFixed(2)} cash`
      } (ledger.csv)`,
      size: 12,
    });
  }
  if (ledger !== null && ledger.excludedActions > 0) {
    bottom.push({
      text: `${ledger.excludedActions} excluded action(s) (ledger.csv)`,
      size: 12,
    });
  }
  return svg(
    [
      ...header(r, `${METRIC[m].title} (primary)`),
      { text: r.experiment.hypothesis, size: 12, fill: "#555" },
    ],
    bars,
    bottom,
  );
}

function outcomeChart(r: Report): string {
  const bars = r.arms.flatMap((a, i) => {
    const color = PALETTE[i % PALETTE.length]!;
    return [
      {
        label: `${a.arm}: pass rate ${pct(a.pass_rate)}`,
        value: a.pass_rate,
        max: 1,
        color,
      },
      {
        label: `${a.arm}: pass^k ${pct(a.pass_k)} over ${a.pass_k_tasks} tasks`,
        value: a.pass_k,
        max: 1,
        color,
      },
    ];
  });
  return svg(
    // Exploratory as a chart (plan M6-02); only the primary chart says primary.
    header(r, "Outcome: pass rate and pass^k (exploratory)"),
    bars,
    [],
  );
}

function tasksChart(r: Report): string {
  const tasks = [...new Set(r.cells.map((c) => c.task))].sort();
  const bars = tasks.flatMap((t) =>
    r.arms.map((a, i) => {
      const s = r.cells.filter((c) =>
        c.task === t && c.arm === a.arm && c.status === "scored"
      );
      const v = s.length === 0
        ? null
        : s.filter((c) => c.pass).length / s.length;
      return {
        label: `${t} ${a.arm}: ${
          v === null ? "n/a (no scored cells)" : pct(v)
        }`,
        value: v,
        max: 1,
        color: PALETTE[i % PALETTE.length]!,
      };
    })
  );
  return svg(header(r, "Per-task pass rate (exploratory)"), bars, []);
}

// --- entry ---

export function renderCharts(reports: Report[], ledger?: Ledger): OutFile[] {
  const seen = new Set<string>();
  for (const r of reports) {
    const key = `${r.experiment.id}|${r.campaign.id}|${r.judging.source}`;
    if (seen.has(key)) {
      fail(
        `duplicate report: ${r.experiment.id}, campaign ${r.campaign.id}, judging ${r.judging.source}`,
      );
    }
    seen.add(key);
    // `partial` is absent from reports made before M6-02a; present, it must agree.
    const want = JSON.stringify(partialOf(r));
    if (r.partial !== undefined && JSON.stringify(r.partial) !== want) {
      fail(
        `report ${key} has partial ${
          JSON.stringify(r.partial)
        }, its provisional and repeats give ${want}`,
      );
    }
  }
  const names = reports.map(prefix);
  if (new Set(names).size !== names.length) {
    fail(`duplicate output name among ${names.join(", ")}`);
  }
  const lg = ledger === undefined ? null : checkLedger(reports, ledger);
  // No headline at all (F1): the ledger alone, every action not_reported.
  if (reports.length === 0) {
    if (lg === null) fail("at least one --report or a --ledger is required");
    return [{ name: "ledger.csv", content: ledgerCsv(lg.l, lg.actions) }];
  }
  const files: OutFile[] = [];
  for (const r of reports) {
    const p = prefix(r);
    const excluded = lg === null ? null : {
      excludedActions: lg.actions.filter((x) =>
        x.a.experiment === r.experiment.id && x.scope !== "reported"
      ).length,
      paid: lg.l.experiments.find((e) =>
        e.id === r.experiment.id
      )!.paid_usd,
    };
    files.push(
      { name: `${p}-primary.svg`, content: primaryChart(r, excluded) },
      { name: `${p}-outcome.svg`, content: outcomeChart(r) },
      { name: `${p}-tasks.svg`, content: tasksChart(r) },
    );
  }
  const id = (r: Report) => [r.experiment.id, r.campaign.id, r.judging.source];
  files.push({
    name: "arms.csv",
    content: csv(
      [
        "experiment",
        "campaign",
        "judging",
        "arm",
        "planned_cells",
        "attempted_cells",
        "scored_cells",
        "unscored_cells",
        "pending_cells",
        "unrun_cells",
        "unknown_spend_cells",
        "unknown_spend_terminal_cells",
        "total_spend_usd",
        "pending_spend_usd",
        "unscored_spend_usd",
        "campaign_raw_spend_usd",
        "excluded_cells",
        "excluded_known_spend_usd",
        "cost_per_solved_task",
        "cost_null_reason",
        "pass_rate",
        "pass_k",
        "pass_k_tasks",
        "infra_exposed",
        "manual_reruns",
        "rejudges",
        "provisional",
      ],
      reports.flatMap((r) =>
        r.arms.map((a) => {
          const cov = r.coverage.find((c) => c.arm === a.arm);
          const unscored = unscoredSpend(r, a.arm).usd;
          return [
            ...id(r),
            a.arm,
            a.planned_cells,
            a.attempted_cells,
            a.scored_cells,
            a.unscored_cells,
            a.pending_cells,
            a.unrun_cells,
            a.unknown_spend_cells,
            a.unknown_spend_terminal_cells,
            a.total_spend_usd,
            a.pending_spend_usd,
            unscored === null ? "" : unscored,
            cov?.campaign_raw_spend_usd ?? null,
            cov?.excluded_cells ?? null,
            cov?.excluded_known_spend_usd ?? null,
            a.cost_per_solved_task,
            costNullReason(a),
            a.pass_rate,
            a.pass_k,
            a.pass_k_tasks,
            cov?.infra_exposed ?? null,
            cov?.manual_reruns ?? null,
            lg === null ? null : lg.reportedCount("rejudge", r, a.arm),
            r.provisional,
          ];
        })
      ),
    ),
  });
  const excl = (e: Partial<Record<string, number>>) =>
    Object.entries(e).sort(([a], [b]) => a < b ? -1 : 1)
      .map(([k, v]) => `${k}=${v}`).join(";") || "none";
  files.push({
    name: "comparisons.csv",
    content: csv(
      [
        "experiment",
        "campaign",
        "judging",
        "metric",
        "label",
        "baseline",
        "variant",
        "pairs",
        "tasks",
        "tasks_dropped",
        "excluded_baseline",
        "excluded_variant",
        "delta",
        "ci_lo",
        "ci_hi",
        "level",
        "undefined_share",
        "distinguishable",
        "verdict_text",
      ],
      reports.flatMap((r) =>
        r.comparisons.map((c) => [
          ...id(r),
          c.metric,
          c.label,
          c.baseline,
          c.variant,
          c.pairs,
          c.tasks,
          c.tasks_dropped,
          excl(c.excluded.baseline),
          excl(c.excluded.variant),
          c.delta,
          c.ci?.[0] ?? null,
          c.ci?.[1] ?? null,
          c.level,
          c.undefined_share,
          c.distinguishable,
          verdictText(c),
        ])
      ),
    ),
  });
  files.push({
    name: "provenance.csv",
    content: csv(
      [
        "experiment",
        "campaign",
        "judging",
        "judging_identity",
        "task_set_identity",
        "tasks",
        "repeats_planned",
        "repeats_reported",
        "resamples",
        "seed",
        "provisional",
        "unscored_spend_null_reason",
      ],
      reports.map((r) => [
        ...id(r),
        r.judging.identity,
        r.campaign.task_set_identity,
        r.campaign.tasks,
        r.repeats.planned,
        r.repeats.reported,
        r.comparisons[0]?.resamples ?? null,
        r.comparisons[0]?.seed ?? null,
        r.provisional,
        armList(r).map((a) => unscoredSpend(r, a).reason).filter((x) => x)
          .join("; "),
      ]),
    ),
  });
  if (lg !== null) {
    files.push({ name: "ledger.csv", content: ledgerCsv(lg.l, lg.actions) });
  }
  return files;
}

export async function main(args: string[]): Promise<number> {
  const a = parseArgs(args, {
    string: ["out", "ledger"],
    collect: ["report"],
  });
  const reports = (a.report as string[] | undefined) ?? [];
  if (!a.out) throw new Error("--out <dir> is required");
  if (reports.length === 0 && !a.ledger) {
    throw new Error("at least one --report or a --ledger is required");
  }
  try {
    for await (const _ of Deno.readDir(a.out)) {
      throw new Error(`--out ${a.out} exists and is not empty`);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const parsed = await Promise.all(
    reports.map(async (p) => JSON.parse(await Deno.readTextFile(p)) as Report),
  );
  const ledger = a.ledger
    ? JSON.parse(await Deno.readTextFile(a.ledger)) as Ledger
    : undefined;
  const files = renderCharts(parsed, ledger);
  await Deno.mkdir(a.out, { recursive: true });
  for (const f of files) {
    await Deno.writeTextFile(join(a.out, f.name), f.content);
    console.log(`${colors.green("[OK]")} ${join(a.out, f.name)}`);
  }
  return 0;
}

if (import.meta.main) {
  try {
    Deno.exit(await main(Deno.args));
  } catch (e) {
    console.error(
      `${colors.red("[FAIL]")} ${e instanceof Error ? e.message : String(e)}`,
    );
    Deno.exit(1);
  }
}
