# Harness Bench M6: analysis, data freeze and owner handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 4** applies the round-3 corrections of gpt-6-astra (`H:\cg-coord\reviews\M5-M6-plans\review3-gpt6astra.md`) as the owner directed: accepted with findings, no further review round. Earlier rounds: `review-gpt6astra.md`, `review2-gpt6astra.md`. Changes per round are listed at the end.

**Goal:** On 2026-10-16 hand the owner, for each talk experiment, the primary metric (cost per solved task with its delta, CI and cohort) next to pass rate, slide-ready charts, a sourced caveats register, and a hashed snapshot of the raw records that every number is bound to, then freeze the data.

**Architecture:** `harness report <exp> --json` already computes the metrics; M6 adds no metric code. Two scripts: `report-charts.ts` turns selected report JSON into SVG charts and three typed CSVs; `freeze-archive.ts` snapshots a results root with a fail-closed secret scan, SHA256SUMS and a binding manifest for derived files. Two documents (caveats register, handoff) are written by content. Scripts and templates are built and rehearsed this week on existing records.

**Tech Stack:** Deno + TypeScript, `@std/fs`, `@std/path`, `@std/assert`, Web Crypto SHA-256; SVG written as text.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a sections 1, 6, 8, 9). Binding: launch contract (dates, cut order item 3); `H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`; `2026-09-25-m3-rulings.md`; M5 plan `docs/superpowers/plans/2026-10-10-harness-campaigns.md` (report `--campaign`, `--repeats` fields from M5-05).

## What exists today (checked 2026-09-26)

- `harness report <exp> --judging campaign|current [--json] [--campaign id] [--results-dir dir] [--resamples 2000] [--seed 1]` (`cli/commands/harness-command.ts:1657`); `HarnessReport` (`src/harness/report.ts:81`): experiment, campaign, judging identity, `provisional`, `metric_labels`, `coverage`, `diffs`, `arms` (`ArmSummary`), `comparisons` (matched-pair delta, CI, `distinguishable`, `undefined_share`, exclusions, `tasks_dropped`), `flips` (only tasks whose arm pass rates differ, `report.ts:398-405`), `efficiency`, `slices`, `both_pass`, `cells`.
- It runs on existing records: `harness report mock-contract --results-dir H:\cg-coord\jobs\M1-30-1\results\harness --judging campaign --json` exits 0 (declared primary `pass_rate`, delta 1, CI [1, 1]; `cost_per_solved_task` null for the arm with no solves).
- Missing: charts, archive, caveats register, handoff.

## Global Constraints

- Primary metric: cost per solved task, list price from reported tokens for every harness; pass rate beside it; everything else labelled exploratory. A CI including zero shows the delta and interval **and** "not distinguishable", never "equal". A suppressed CI shows "CI suppressed" with the undefined share.
- The primary bars are per-arm figures over each arm's eligible cells; the delta is over matched pairs. Every primary chart and the handoff say so, with the pair and task counts.
- `provisional: false` does not mean complete coverage: unscored, unknown-cost and excluded cells are always shown.
- Secondary sections (efficiency, slices, both-pass) are cut order item 3: optional.
- Outputs only in the repo, `H:\cg-coord\` and `H:\Temp3\harness-spike\`; M6 deliverables in `H:\cg-coord\m6\`. No ingest, site, deploy or `sync-catalog --apply`.
- `--judging current` only after an oracle fix accepted in a decision that quotes the owner's approval (launch contract: oracles are never edited without the owner).
- Code: TDD, `deno test --allow-all <file>`, check/lint/fmt on touched files, `[OK]`/`[FAIL]` tags, no emoji, no em dash.

## Review Focus

1. **Two reports of one experiment** (campaign and current judging). Expected: distinct output names, no silent overwrite, duplicates refused. M6-02.
2. **Null or suppressed metrics.** Expected: "n/a" with the reason (no solves, no scored cells, no eligible cost cohort), never 0 or NaN. M6-02.
3. **Repeat cut.** Expected: reported vs planned repeats and excluded cells and spend on every chart and in the CSVs. M6-02.
4. **Secret scan cannot run** (secret file missing, unreadable, empty). Expected: operational failure, not clean. M6-03.
5. **Records change after the numbers were taken.** Expected: reports are generated from the verified snapshot and bound to its hash. M6-03, M6-06.

---

### Task M6-01: caveats register

**Lane:** content. **Deps:** none. **Date:** first version 10-02, final 10-15. **Startable now.**

**Files:** Create `H:\cg-coord\m6\caveats.md`.

- [ ] **Step 1: Inventory, not only keywords.** Read, whatever words they use: every decision file on metric rules (`m1-metric-rules`), provider pricing and routing (`pi-cache-ttl`, `m3-rulings`, the M5-01 arm decision), task selection, pilot and hardening (`m4-coverage-pilot`, `m4-freeze-loaded`, M4-14/M4-15 decisions), qualification (`m1-38-accepted`, `m2-13-*`, M3-09), egress and credentials (`egress`, `secrets-accepted-risk`, `m1-34-rulings`, M5-00 credential generations, `openrouter-backstop`), telemetry limits (`m2-15-accepted`, `m3-02-accepted`, `accept-M0-07`), snapshot and redaction (`snapshot-no-pause`, `redaction-scope`), and every M5 decision (go, quota stops, reruns, repeat cut, concurrency switch). Then `grep -il "caveat\|accepted risk\|owner-accepted\|residual risk\|limit\|disclos" H:\cg-coord\decisions\*.md` for anything missed.
- [ ] **Step 2: One table:** `id | caveat (one slide-ready sentence) | applies to (all, claude-code, pi, experiment id) | status (open, reduced, closed, dropped) | source path | owner action`. Closed and dropped rows stay, marked.
- [ ] **Step 3:** "Owner follow-ups after the freeze": post-campaign rotation of generation-2 credentials (separate from M1-34's pre-authorization rotation), firewall keep or revert, marker removal, OpenRouter balance.

**Acceptance (orchestrator):** every source path exists (`test -f` loop quoted); every decision file under `H:\cg-coord\decisions\` is either cited or listed under "checked, no caveat".

---

### Task M6-02: charts and typed CSVs

**Lane:** infra, strictly after M1-34c and M5-05 (same lane; reads M5-05's `repeats` fields). **Deps:** M5-05 for the repeat fields. **Date:** 10-05 to 10-08. **Startable now** for Steps 1 to 3 without the repeat fields; Step 4 after M5-05.

**Files:** Create `scripts/harness/report-charts.ts`, `tests/unit/harness/report-charts.test.ts`, `tests/fixtures/harness/report-mock-contract.json`.

**Interfaces:**
- `renderCharts(reports: HarnessReport[], ledger?: Ledger): { name: string; content: string }[]` (pure). Throws `ValidationError` on two reports with the same `(experiment.id, campaign.id, judging.source)`, and on a ledger that disagrees with the reports (below).
- Output names: prefix `<experiment>__<campaign id first 8>__<judging source>`; per report `<prefix>-primary.svg`, `<prefix>-outcome.svg`, `<prefix>-tasks.svg`; once for all reports `arms.csv`, `comparisons.csv`, `provenance.csv`, and `ledger.csv` when a ledger is given.
- CLI: `deno run --allow-read --allow-write scripts/harness/report-charts.ts --out <dir> --report <path> [--report <path> ...] [--ledger <path>]` (only the explicitly selected reports; refuses an existing non-empty `--out`).
- `arms.csv`: `experiment,campaign,judging,arm,planned_cells,attempted_cells,scored_cells,unscored_cells,pending_cells,unrun_cells,unknown_spend_cells,unknown_spend_terminal_cells,total_spend_usd,pending_spend_usd,campaign_raw_spend_usd,excluded_cells,excluded_known_spend_usd,cost_per_solved_task,cost_null_reason,pass_rate,pass_k,pass_k_tasks,infra_exposed,manual_reruns,provisional` (`total_spend_usd` and the other `*_spend_usd` are list-price estimates from the report, never cash; `manual_reruns` from `coverage[].manual_reruns`).
- `comparisons.csv`: `experiment,campaign,judging,metric,label,baseline,variant,pairs,tasks,tasks_dropped,excluded_baseline,excluded_variant,delta,ci_lo,ci_hi,level,undefined_share,distinguishable,verdict_text`.
- `provenance.csv`: `experiment,campaign,judging,judging_identity,task_set_identity,tasks,repeats_planned,repeats_reported,resamples,seed,provisional`.
- `cost_null_reason`: `no scored cells` when `scored_cells` is 0; `no solves` when `pass_rate` is 0; else `no eligible cost cohort`. `verdict_text`: `distinguishable`, `not distinguishable`, or `CI suppressed`. Null prints `n/a`. Fields with `,` or `"` are quoted CSV; SVG text escapes `& < > "`. Before M5-05 lands, repeat and excluded columns print `n/a`.
- **Ledger (typed source for cash and actions, B10).** `H:\cg-coord\m6\ledger.json`, written by the orchestrator from `spend.md` (P1 readings) and the M5-10 evidence, validated with Zod (`strictObject`):

```typescript
const Ledger = z.strictObject({
  v: z.literal(1),
  paid_total_usd: z.number().nonnegative(),          // actual cash, every provider (spend.md)
  openrouter_actual_usd: z.number().nonnegative(),   // USD 60 minus the last console balance
  openrouter_balance_readings: z.array(z.strictObject({ at: z.iso.datetime(), balance_usd: z.number() })).min(1),
  claude_code_cash_usd: z.literal(0),                // Team OAuth: no money spent
  manual_reruns: z.array(z.strictObject({ experiment: z.string(), campaign: z.string(), task: z.string(), repeat: z.number().int(), arm: z.string(), execution: z.string(), decision: z.string() })),
  rejudges: z.array(z.strictObject({ experiment: z.string(), campaign: z.string(), task: z.string(), repeat: z.number().int(), arm: z.string(), execution: z.string(), judgment: z.string(), decision: z.string() })),
  pi_stop: z.strictObject({ fired: z.boolean(), experiment: z.string().nullable(), at: z.iso.datetime().nullable(), last_complete_repeat: z.number().int().positive().nullable(), decision: z.string().nullable() }),
});
```

  The ledger is the **full** action history: nothing is dropped because a report is scoped. `ledger.csv` columns: `kind,experiment,campaign,key,value,scope,decision` with one row per scalar (`paid_total_usd`, `openrouter_actual_usd`, `claude_code_cash_usd`, `pi_stop`; scope `all`), per manual rerun (`key` = `task#repeat:arm`, `value` = execution) and per rejudge (`key` = `task#repeat:arm`, `value` = `execution/judgment`). Action scope: `reported` when its campaign is one of the given reports' campaigns and its repeat <= that report's `repeats.reported` (or `repeats.planned` without a cut); `excluded_repeat` when the campaign is reported but the repeat is above the cut; `not_reported` when no given report covers the campaign (for example cc-vs-pi stopped before a complete repeat). Cross-checks (refuse on mismatch): per (experiment, campaign, arm), the ledger's manual reruns with scope `reported` = that report's scoped `coverage[].manual_reruns`; `excluded_repeat` and `not_reported` actions are never compared, only disclosed (on that experiment's primary chart as `<n> excluded action(s) (ledger.csv)` and as rows in `ledger.csv`); `openrouter_actual_usd` = 60 minus the latest balance reading; when `pi_stop.fired`, `pi_stop.experiment` is set, and a given report of that experiment has `repeats.reported` = `last_complete_repeat`.

- [ ] **Step 1: Fixture** from the real M1-30 campaign (no container): `deno task start harness report mock-contract --results-dir 'H:\cg-coord\jobs\M1-30-1\results\harness' --judging campaign --json > tests/fixtures/harness/report-mock-contract.json`.
- [ ] **Step 2: Failing tests:**

```typescript
import { assert, assertEquals, assertThrows } from "@std/assert";
import type { HarnessReport } from "../../../src/harness/report.ts";
import { renderCharts } from "../../../scripts/harness/report-charts.ts";

const base = async (): Promise<HarnessReport> =>
  JSON.parse(await Deno.readTextFile("tests/fixtures/harness/report-mock-contract.json"));
const get = (fs: { name: string; content: string }[], suffix: string) => fs.find((f) => f.name.endsWith(suffix))!.content;

Deno.test("charts: campaign and current reports of one experiment get distinct names; an exact duplicate is refused", async () => {
  const a = await base();
  const b = { ...a, judging: { ...a.judging, source: "current" as const } };
  const names = renderCharts([a, b]).map((f) => f.name);
  assertEquals(new Set(names).size, names.length);
  assertThrows(() => renderCharts([a, a]), Error, "duplicate report");
});

Deno.test("charts: exact arm values and the null reason, no NaN anywhere", async () => {
  const fs = renderCharts([await base()]);
  const row = get(fs, "arms.csv").split("\n").find((l) => l.includes(",mock-naive-lock-table,"))!;
  assert(row.includes(",n/a,no solves,0,0,"), row); // cost, reason, pass_rate, pass_k
  for (const f of fs) assert(!f.content.includes("NaN"), f.name);
});

Deno.test("charts: every CI branch keeps delta and interval next to the verdict text", async () => {
  const r = await base();
  const primary = r.comparisons.find((c) => c.primary)!;
  const variants = [
    { ...primary, delta: -0.5, ci: [-0.9, -0.1] as [number, number], distinguishable: true },
    { ...primary, delta: -0.2, ci: [-0.6, 0.3] as [number, number], distinguishable: false },
    { ...primary, delta: -0.2, ci: null, distinguishable: null, undefined_share: 0.12 },
  ];
  const texts = ["distinguishable", "not distinguishable", "CI suppressed (12% undefined)"];
  variants.forEach((c, i) => {
    const svg = get(renderCharts([{ ...r, comparisons: [c] }]), "-primary.svg");
    assert(svg.includes(texts[i]!), texts[i]);
    if (i === 0) assert(!svg.includes("not distinguishable"));
    if (c.ci) assert(svg.includes(`[${c.ci[0].toFixed(2)}, ${c.ci[1].toFixed(2)}]`) && svg.includes(c.delta!.toFixed(2)));
    assert(svg.includes(`${c.pairs} matched pairs`));
  });
});

Deno.test("charts: cost-primary report leads with cost; outcome and task charts are labelled exploratory", async () => {
  const r = await base();
  // A coherent cost-primary report: declaration, labels and comparison flags all switched.
  const cost = {
    ...r,
    experiment: { ...r.experiment, primary_metric: "cost_per_solved_task" as const },
    metric_labels: { ...r.metric_labels, cost_per_solved_task: "primary" as const, pass_rate: "exploratory" as const },
    comparisons: r.comparisons.map((c) => ({ ...c, primary: c.metric === "cost_per_solved_task", label: c.metric === "cost_per_solved_task" ? "primary" as const : "exploratory" as const })),
  };
  const fs = renderCharts([cost]);
  assert(get(fs, "-primary.svg").includes("Cost per solved task"));
  assert(get(fs, "-outcome.svg").includes("exploratory"));
  assert(get(fs, "-tasks.svg").includes("exploratory"));
});

Deno.test("charts: provisional marks every chart and the provisional column of arms.csv and provenance.csv", async () => {
  const fs = renderCharts([{ ...(await base()), provisional: true }]);
  for (const f of fs.filter((x) => x.name.endsWith(".svg"))) assert(f.content.includes("PROVISIONAL"), f.name);
  for (const name of ["arms.csv", "provenance.csv"]) {
    const [head, ...rows] = get(fs, name).trim().split("\n").map((l) => l.split(","));
    const col = head!.indexOf("provisional");
    assert(col >= 0, name);
    for (const row of rows) assertEquals(row[col], "true", name);
  }
});

Deno.test("charts: the ledger becomes ledger.csv and must agree with the reports", async () => {
  const r = await base();
  const ledger = {
    v: 1 as const, paid_total_usd: 12.5, openrouter_actual_usd: 12.5, claude_code_cash_usd: 0 as const,
    openrouter_balance_readings: [{ at: "2026-10-15T10:00:00.000Z", balance_usd: 47.5 }],
    manual_reruns: [], rejudges: [],
    pi_stop: { fired: false, experiment: null, at: null, last_complete_repeat: null, decision: null },
  };
  const csv = get(renderCharts([r], ledger), "ledger.csv");
  assert(csv.includes("scalar,,,paid_total_usd,12.5,all,"));
  assert(csv.includes("scalar,,,claude_code_cash_usd,0,all,"));
  const wrongRerun = { ...ledger, manual_reruns: [{ experiment: r.experiment.id, campaign: r.campaign.id, task: "HX-001", repeat: 1, arm: r.arms[0]!.arm, execution: "x", decision: "d" }] };
  assertThrows(() => renderCharts([r], wrongRerun), Error, "manual reruns");
  assertThrows(() => renderCharts([r], { ...ledger, openrouter_actual_usd: 10 }), Error, "balance");
});

Deno.test("charts: a manual rerun in a cut repeat is kept in the ledger, disclosed as excluded, and not compared", async () => {
  const r = await base();
  const cut = { ...r, repeats: { planned: 3, reported: 2 } }; // scoped coverage: manual_reruns 0 in the fixture
  const arm = r.arms[0]!.arm;
  const rerun = (repeat: number) => ({ experiment: r.experiment.id, campaign: r.campaign.id, task: "HX-001", repeat, arm, execution: `x${repeat}`, decision: "d" });
  const ledger = {
    v: 1 as const, paid_total_usd: 0, openrouter_actual_usd: 0, claude_code_cash_usd: 0 as const,
    openrouter_balance_readings: [{ at: "2026-10-15T10:00:00.000Z", balance_usd: 60 }],
    manual_reruns: [rerun(3)], rejudges: [],
    pi_stop: { fired: false, experiment: null, at: null, last_complete_repeat: null, decision: null },
  };
  const fs = renderCharts([cut], ledger);
  assert(get(fs, "ledger.csv").includes(`manual_rerun,${r.experiment.id},${r.campaign.id},HX-001#3:${arm},x3,excluded_repeat,`));
  assert(get(fs, "-primary.svg").includes("1 excluded action"));
  // The same rerun inside the reported repeats must match scoped coverage, which is 0 here.
  assertThrows(() => renderCharts([cut], { ...ledger, manual_reruns: [rerun(1)] }), Error, "manual reruns");
});

Deno.test("charts: a fired pi stop needs its report at the last complete repeat", async () => {
  const r = await base();
  const stop = (n: number | null) => ({
    v: 1 as const, paid_total_usd: 3, openrouter_actual_usd: 3, claude_code_cash_usd: 0 as const,
    openrouter_balance_readings: [{ at: "2026-10-12T10:00:00.000Z", balance_usd: 57 }],
    manual_reruns: [], rejudges: [],
    pi_stop: { fired: true, experiment: r.experiment.id, at: "2026-10-12T09:00:00.000Z", last_complete_repeat: n, decision: "od-1" },
  });
  renderCharts([{ ...r, repeats: { planned: 3, reported: 2 } }], stop(2));
  assertThrows(() => renderCharts([{ ...r, repeats: { planned: 3, reported: 3 } }], stop(2)), Error, "last complete repeat");
});

Deno.test("charts: the task chart lists every campaign task, from cells, not only flips", async () => {
  const r = await base();
  const svg = get(renderCharts([{ ...r, flips: [] }]), "-tasks.svg");
  for (const t of new Set(r.cells.map((c) => c.task))) assert(svg.includes(t), t);
});

Deno.test("charts: CSV quoting and SVG escaping", async () => {
  const r = await base();
  const odd = { ...r, experiment: { ...r.experiment, hypothesis: 'a, "b" <c> & d' } };
  const fs = renderCharts([odd]);
  assert(get(fs, "-primary.svg").includes("&lt;c&gt; &amp; d"));
});
```

Run: FAIL (module missing).
- [ ] **Step 3: Implement.** Ledger: parse with the Zod schema above, run the cross-checks, write `ledger.csv`. Charts: 960x540 SVG, one colour per arm in `r.arms` order (baseline first). Header on every chart: experiment, campaign id, judging source and identity (12 chars), task count, `PROVISIONAL` when set. `primary`: bars of the declared primary metric per arm (other metric as a label), then per comparison of that metric: `delta <d> [<lo>, <hi>] <verdict_text> over <pairs> matched pairs, <tasks> tasks (<tasks_dropped> dropped); bars are per-arm, the delta is over matched pairs`; per arm a line with scored/planned, unscored, unknown-cost cells. `outcome` (exploratory): pass rate and pass^k per arm. `tasks` (exploratory): all tasks from `cells` x arms, per-task pass rate over scored cells, `n/a` where none.
- [ ] **Step 4 (after M5-05):** consume `repeats` and the excluded fields; when `reported < planned`, every chart shows `Repeats reported N of P; excluded <cells> cells, $<spend>`. Test: a report with `repeats: {planned: 3, reported: 2}` shows that line on all three charts and the values in `arms.csv` and `provenance.csv`.
- [ ] **Step 5:** Tests pass; check/lint/fmt; commit `feat(harness): report charts and typed CSVs for the talk slides`.
- [ ] **Step 6 (cut item 3, optional):** `<prefix>-efficiency.svg` from `r.efficiency`, labelled exploratory, `n/a` for nulls, same test pattern.

**Acceptance (orchestrator):** tests green; the CLI on the fixture writes 3 SVGs and 3 CSVs (4 with a ledger); SVGs open and render (one screenshot path attached).

---

### Task M6-03: snapshot archive with fail-closed scan

**Lane:** infra, strictly after M1-34c. **Deps:** none. **Date:** 10-03 to 10-08. **Startable now.**

**Files:** Create `scripts/harness/freeze-archive.ts`, `tests/unit/harness/freeze-archive.test.ts`.

**Interfaces:**
- `pack(resultsRoot, outDir, opts: { meta: Record<string, string>; secretFiles: string[] }): Promise<{ files: number; sumsSha256: string }>`; `verify(outDir): Promise<string[]>` (problems, empty = OK); `bind(outDir, files: string[]): Promise<void>` maintains `<outDir>/derived.json` `{ v: 1, sums_sha256, files: [{ path, sha256, bound_at }] }`.
- **Cumulative binding contract.** `bind` is append-only: it reads the existing `derived.json` (refusing it if its `sums_sha256` differs from `freeze.json`), keeps every earlier entry, adds new paths with their hash and time, accepts a path already bound with the same hash as a no-op, and refuses a path already bound with a different hash (`already bound with another hash`: a changed derived file is an error, never an update). `verify` checks every entry of every bind call. Order in M6: reports, then charts and CSVs, then `ledger.json`, then `caveats.md` and `handoff.md`.
- Layout: `<outDir>/results/...` (byte copy), `SHA256SUMS` (`<sha256>  <posix path>`, raw bytes, sorted), `freeze.json` `{ v: 1, created_at, files, sums_sha256, meta, scan: { secret_files: <count>, patterns: [...], hits: 0 } }`.
- Scan (inside `pack`, on the copied bytes; it covers the secret values available on disk plus the patterns, and is not proof that every historical credential value is absent): every secret file must exist, be readable and non-empty, else **operational failure**; each value is searched as bytes in every copied file; patterns `sk-or-v1-[A-Za-z0-9]{20,}` and `sk-ant-oat01-[A-Za-z0-9_-]{20,}`. A hit names the archived path and the secret file's basename, never the value, and removes `outDir`.
- CLI exit codes: `0` clean and packed, `1` secret hit or verify problem, `2` operational failure (unreadable secret file or tree, existing `outDir`, a link or reparse point). Links policy: any symlink or junction in the tree refuses the pack.

- [ ] **Step 1: Failing tests:**

```typescript
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { bind, pack, verify } from "../../../scripts/harness/freeze-archive.ts";

async function tree() {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "executions", "c1"), { recursive: true });
  await Deno.writeTextFile(join(root, "executions", "c1", "e1.json"), '{"a":1}\r\n');
  await Deno.writeTextFile(join(root, "campaigns.json"), "{}");
  return root;
}
async function secret(value: string) {
  const f = join(await Deno.makeTempDir(), "claude-oauth-token");
  await Deno.writeTextFile(f, value);
  return f;
}
const out = async () => join(await Deno.makeTempDir(), "a");

Deno.test("pack then verify is clean; freeze.json holds meta, sums hash and scan count", async () => {
  const o = await out();
  const r = await pack(await tree(), o, { meta: { git: "abc" }, secretFiles: [await secret("tok-123")] });
  assertEquals([r.files, await verify(o)], [2, []]);
  const f = JSON.parse(await Deno.readTextFile(join(o, "freeze.json")));
  assertEquals([f.meta.git, f.sums_sha256, f.scan.secret_files, f.scan.hits], ["abc", r.sumsSha256, 1, 0]);
});

Deno.test("a secret hit fails without printing the value; missing or empty secret files are operational failures", async () => {
  const root = await tree();
  await Deno.writeTextFile(join(root, "leak.txt"), "x tok-123 y");
  const hit = await assertRejects(async () => pack(root, await out(), { meta: {}, secretFiles: [await secret("tok-123")] }), Error, "leak.txt");
  assert(!hit.message.includes("tok-123"));
  await assertRejects(async () => pack(root, await out(), { meta: {}, secretFiles: [await Deno.makeTempFile()] }), Error, "empty secret file");
  await assertRejects(async () => pack(root, await out(), { meta: {}, secretFiles: [join(await Deno.makeTempDir(), "gone")] }), Error, "cannot read secret file");
});

Deno.test("verify names changed, missing, extra files, an edited SHA256SUMS and a changed bound file", async () => {
  const o = await out();
  await pack(await tree(), o, { meta: {}, secretFiles: [await secret("tok")] });
  const report = join(await Deno.makeTempDir(), "r.json");
  await Deno.writeTextFile(report, "{}");
  await bind(o, [report]);
  await Deno.writeTextFile(join(o, "results", "executions", "c1", "e1.json"), '{"a":1}\n');
  await Deno.remove(join(o, "results", "campaigns.json"));
  await Deno.writeTextFile(join(o, "results", "extra.txt"), "x");
  await Deno.writeTextFile(report, "{ }");
  const p = (await verify(o)).join("\n");
  for (const s of ["changed: executions/c1/e1.json", "missing: campaigns.json", "extra: extra.txt", "bound file changed"]) assert(p.includes(s), s);
  await Deno.writeTextFile(join(o, "SHA256SUMS"), "tampered\n");
  assert((await verify(o)).some((x) => x.includes("SHA256SUMS does not match freeze.json")));
});

Deno.test("bind is cumulative: reports, then documents; a later call keeps earlier entries; a changed report is caught", async () => {
  const o = await out();
  await pack(await tree(), o, { meta: {}, secretFiles: [await secret("tok")] });
  const dir = await Deno.makeTempDir();
  const report = join(dir, "r.json"), doc = join(dir, "handoff.md");
  await Deno.writeTextFile(report, "{}");
  await Deno.writeTextFile(doc, "# h");
  await bind(o, [report]);
  await bind(o, [doc]);
  await bind(o, [report]); // same hash: no-op
  const d = JSON.parse(await Deno.readTextFile(join(o, "derived.json")));
  assertEquals(d.files.map((f: { path: string }) => f.path).sort(), [doc, report].sort());
  assertEquals(await verify(o), []);
  await Deno.writeTextFile(report, "{ }");
  assert((await verify(o)).some((x) => x.includes("bound file changed") && x.includes("r.json")));
  await assertRejects(() => bind(o, [report]), Error, "already bound with another hash");
});

Deno.test({
  name: "a junction in the tree refuses the pack (Windows)",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const root = await tree();
    const target = await Deno.makeTempDir();
    const r = await new Deno.Command("cmd", { args: ["/c", "mklink", "/J", join(root, "j"), target] }).output();
    assert(r.success, "mklink /J needs no privilege; failing to create it is a test failure, not a skip");
    await assertRejects(async () => pack(root, await out(), { meta: {}, secretFiles: [await secret("tok")] }), Error, "link");
  },
});
```

Run: FAIL (module missing).
- [ ] **Step 2: Implement:** `walk` with `followSymlinks: false`; refuse `isSymlink` (Deno reports junctions as symlinks on Windows; the junction test proves it); byte copy; scan the copies; SHA-256 via `crypto.subtle.digest`; remove `outDir` on any failure after creating it.
- [ ] **Step 3:** Tests pass; check/lint/fmt; commit `feat(harness): freeze archive with fail-closed secret scan and bound derived files`.

**Acceptance (orchestrator):** tests green with the junction test run (not ignored) on this host; `pack` then `verify` on `H:\cg-coord\jobs\M1-30-1\results\harness` into `H:\Temp3\harness-spike\M6-03\` prints `[OK]`, with the secret files of the secrets dir.

---

### Task M6-04: handoff template

**Lane:** content. **Deps:** skeleton none; placeholders after M6-02's CSV schema is accepted. **Date:** skeleton 10-03, placeholders 10-08. **Startable now (skeleton).**

**Files:** Create `H:\cg-coord\m6\handoff-template.md`.

- [ ] **Step 1: Skeleton sections:** (1) per experiment: hypothesis; answer as delta, CI and verdict text over N matched pairs; cost per solved task and pass rate per arm, stating bars are per-arm and the delta is matched-pair; (2) coverage: task-set hash, campaign ids, judging source, repeats planned and reported, scored/planned per arm, unscored, pending, unknown-cost and excluded cells and spend, infra-exposed, manual reruns and rejudges (from M5-10); (3) charts with captions; (4) top five caveats, link to `caveats.md`; (5) spend: paid total, OpenRouter, Claude Code list-price estimate (not money); (6) reproducibility: master SHA, image ids, archive `sums_sha256`, `derived.json`; (7) owner follow-ups; (8) exploratory extras.
- [ ] **Step 2 (after M6-02):** every number is `{{<csv>:<key columns>:<column>}}` naming one of `arms.csv`, `comparisons.csv`, `provenance.csv`, `ledger.csv`. Sources by section: (1) and (2) `arms.csv`, `comparisons.csv`, `provenance.csv`; manual reruns `arms.csv:manual_reruns` and `ledger.csv` rows `manual_rerun`; rejudges `ledger.csv` rows `rejudge`; (5) paid total `ledger.csv:paid_total_usd`, OpenRouter actual `ledger.csv:openrouter_actual_usd`, Claude Code cash `ledger.csv:claude_code_cash_usd` (0) next to its list-price estimate `arms.csv:total_spend_usd` labelled as an estimate; the pi stop `ledger.csv:pi_stop`. The list-price `total_spend_usd` is never shown as money.

**Acceptance (orchestrator):** sections 1 to 8 present; every placeholder names an existing CSV column or `ledger.csv` key.

---

### Task M6-05: rehearsal on existing records

**Lane:** content. **Deps:** M6-01 first version, M6-02, M6-03, M6-04 accepted. **Date:** by 10-09.

- [ ] **Step 1:** Follow M6-06 and M6-07 in their final order on `H:\cg-coord\jobs\M1-30-1\results\harness` (experiment `mock-contract`), into `H:\cg-coord\m6\rehearsal\`.
- [ ] **Step 2:** With a rehearsal `ledger.json` (zero spend, no reruns, marked REHEARSAL), fill the template into `rehearsal\handoff.md`, marked REHEARSAL (mock data, not results). Then walk the M5 "Acceptance case: P3 fires right after stage A" on the mock records: a second rehearsal ledger with `pi_stop` fired for `mock-contract` and `last_complete_repeat: null`; Step 1 of M6-07 produces a partial, provisional report without `--repeats`; M6-07 Step 4 leaves it out of `charts\`; the handoff shows no headline for it. Quote the outputs.
- [ ] **Step 3:** Times per step and friction in `H:\cg-coord\tasks\M6-05\runs\<nnn>\notes.md`; fixes become new tasks.

**Acceptance (orchestrator):** snapshot `verify` `[OK]`, `derived.json` present, filled handoff, notes.

---

### Task M6-06 (ops): quiesce and snapshot (B12)

**Lane:** ops. **Deps:** M5-10 accepted. **Date:** 10-15 from 12:00.

- [ ] **Step 1: Quiesce (campaign freeze, not a global pause).** The orchestrator creates `H:\cg-coord\m5\stop-all.json` (M5 "Stop files"): every campaign invocation stops at its next cell boundary and none can start, while every lane, including M6 work, continues. `H:\cg-coord\pause.json` is never created for this; if the owner's global pause is active, the README rules apply first and this task waits for `resume`. Then quote: no `harness` process running (process list), no `results/.bench-running.json` younger than 2 min, `coord holder` free for Cronus281-283. Record the selected campaign ids from the M5 decisions. `stop-all.json` stays in place after the freeze; reopening needs an orchestrator decision.
- [ ] **Step 2: Pack** (secret files = every file M5-00 lists for generations 1 and 2 that still exists on disk; a listed file that is gone is written in the evidence with its revocation time):

```bash
deno run --allow-all scripts/harness/freeze-archive.ts pack results/harness 'H:\cg-coord\m6\archive' \
  --secret-file <each file> --meta git=<sha> --meta task_set=<hash> \
  --meta images=<base,claude-code,pi ids> --meta campaigns=<ids>
deno run --allow-all scripts/harness/freeze-archive.ts verify 'H:\cg-coord\m6\archive'
```

  Exit 1 or 2: stop, `coord ask`, no reports.

**Acceptance (orchestrator):** exit codes 0 quoted, `sums_sha256` quoted, scan count equals the secret files listed.

---

### Task M6-07 (ops): final reports and charts from the snapshot

**Lane:** ops. **Deps:** M6-06. **Date:** 10-15.

- [ ] **Step 1:** For each experiment, from the snapshot: `deno task start harness report <exp> --campaign <id> --judging campaign --results-dir 'H:\cg-coord\m6\archive\results' --json > H:\cg-coord\m6\reports\<exp>.campaign.json` and the text form. `--repeats <n>`: for a capacity cut the owner decided (all experiments alike, decision path in the evidence); for cc-vs-pi after a **stopped (OD-1)** disposition, `--repeats <last complete repeat>` when it is 1 or more (a balanced cc-vs-pi-only subset, excluded work disclosed by M5-05), and no `--repeats` when there is no complete repeat (the report stays provisional and is marked partial). `--repeats 0` is never used. `--judging current` (to `<exp>.current.json`) only under the Global Constraints rule; the orchestrator names which one is the headline.
- [ ] **Step 2:** `jq` per report: `.provisional`, and per arm `unscored_cells`, `pending_cells`, `unknown_spend_terminal_cells`; any non-zero value is listed in the evidence for the handoff (not hidden, not blocking).
- [ ] **Step 3 (orchestrator):** Write `H:\cg-coord\m6\ledger.json` (M6-02 schema) from `spend.md` and the M5-10 evidence, with every action of every campaign (the full history). If the OD-1 stop fired: `pi_stop` with `experiment: "cc-vs-pi"`, the stop time from the M5 decision, `last_complete_repeat` (null when none) and the decision path.
- [ ] **Step 4:** `report-charts.ts --out H:\cg-coord\m6\charts --ledger H:\cg-coord\m6\ledger.json --report <headline report> ...` with exactly one report per experiment that has a headline. cc-vs-pi stopped with no complete repeat has no headline: its report is not passed here (its ledger actions then show as `not_reported`), and it is bound in Step 5 as a partial report. A second judging goes to `H:\cg-coord\m6\charts-current\` if the orchestrator wants it shown. A ledger mismatch stops the task.
- [ ] **Step 5:** `freeze-archive.ts bind 'H:\cg-coord\m6\archive' <every report>`, then `bind ... <every SVG and CSV> H:\cg-coord\m6\ledger.json`; `verify` `[OK]`.

**Acceptance (orchestrator):** reports, charts, `ledger.csv`, `derived.json` listing every file, verify `[OK]`.

---

### Task M6-08: handoff and data freeze

**Lane:** content (document), orchestrator (freeze). **Deps:** M6-01 final, M6-07. **Date:** 10-15 draft, 10-16 freeze.

- [ ] **Step 1 (content):** Fill `H:\cg-coord\m6\handoff.md` from the template and the CSVs; finalize `caveats.md` with the M5 decisions; `bind` both documents into `derived.json`.
- [ ] **Step 2 (orchestrator):** Diff every number in `handoff.md` against the CSVs and report JSON (`jq`); freeze inputs per README; gpt-6-sol review: does every claim follow from the bound reports, is every caveat sourced.
- [ ] **Step 3 (orchestrator):** `verify` `[OK]` on the day; decision `2026-10-16-data-freeze.md` (master SHA, `sums_sha256`, `derived.json` hash, review path); local tag `harness-data-freeze-2026-10-16` on master, pushed; `coord ask` plus push notification with the handoff path.

**Acceptance:** review verdict recorded; owner notified.

---

## Startable now

- M6-01 (content).
- M6-02 Steps 1 to 3 (infra, only behind M1-34c; Step 4 after M5-05 on the same lane).
- M6-03 (infra, only behind M1-34c).
- M6-04 skeleton (content); placeholders after M6-02's schema.
- M6-05 (content) once M6-01 to M6-04 are accepted, target 10-09.

## Findings addressed (round 1)

B9: namespaced outputs, duplicate refusal, explicit `--report` selection (M6-02, M6-07 Step 3). B10: three typed CSVs, null reasons, delta and CI kept beside the verdict text, cohort disclosure, exploratory labels (M6-02). B11: repeat and excluded fields consumed and shown (M6-02 Step 4, M6-07 Step 1; fields from M5-05). B12: quiesce, fail-closed scan inside the pack, verify, reports from the snapshot, `bind` (M6-03, M6-06, M6-07). N1: startable-now qualifiers. N2: tests for every CI branch, cost-primary, escaping, duplicates, exact CSV values; a real junction test instead of a silent skip. N3: task chart from cells. N4: M6-01 inventory.

## Review round 1: not adopted

- B12, "cover rotated credential generations": adopted with one limit. A generation-1 secret file that was deleted after revocation cannot be scanned; the evidence then records its revocation time (a revoked value in the archive is no longer a live credential). Keeping revoked values on disk only for scanning would add a secret to protect. The scan is described as covering the available values plus patterns, not as proof that every historical value is absent (round 2).

## Review round 2: changes (rev 3)

- Blocker 4 / B10 (placeholder sources): typed `ledger.json` (Zod) and `ledger.csv` for paid total, OpenRouter actual, Claude Code cash (0), manual reruns, rejudges and the pi stop, cross-checked against the reports; `arms.csv` gains `manual_reruns`; M6-04 maps every section to a CSV column or ledger key; list-price spend is never shown as money.
- B12 (quiescence): campaign freeze via `H:\cg-coord\m5\stop-all.json`, never the global `pause.json`; other lanes keep working; an active owner pause is honoured first.
- B12 (binding): cumulative, append-only `bind` contract (same hash no-op, different hash refused, every entry verified) with a reports-then-documents test; fixed bind order in M6-07 and M6-08.
- Non-blocking: provisional test parses the `provisional` column of `arms.csv` and `provenance.csv`; the cost-primary test uses a coherent report (labels and comparison flags switched); the scan wording no longer claims completeness.
- M6-01 (loaded task): unchanged.

## Review round 2: not adopted

None.

## Review round 3: changes (rev 4, owner-directed, no further review)

- OD-1 stop path: M6-07 Steps 1, 3 and 4 handle cc-vs-pi stopped (OD-1): N >= 1 complete repeats gives a balanced `--repeats N` subset; none gives a partial, provisional report with no headline and no chart, never `--repeats 0`. `pi_stop` gains `experiment`; the charts refuse a report whose `repeats.reported` differs from `last_complete_repeat`. M6-05 rehearses the stop-after-stage-A case.
- Ledger scope: the ledger keeps the full action history; actions are scoped `reported`, `excluded_repeat` or `not_reported`; only `reported` manual reruns are compared with scoped coverage; excluded actions are disclosed in `ledger.csv` and on the charts. Rejudges carry task, repeat and arm for scoping. New test with an excluded manual rerun in a cut repeat.
- M6-01 (loaded task): unchanged.
