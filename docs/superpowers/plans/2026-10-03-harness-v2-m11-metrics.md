# Harness Bench v2 M11: Metrics and Statistics Implementation Plan (rev 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Shared interfaces:** every cross-plan name, path, record shape, tag and date in this plan is defined in `H:\cg-coord\plans-v2\2026-10-03-harness-v2-interfaces.md` (the appendix). Where this plan and the appendix differ, the appendix wins and this plan is the bug.

Rev 2 answers round 1 review `H:\cg-coord\reviews\PLANS-v2-001\review-m11.md` (REJECT) and follows `cross-plan-rulings.md` (rulings 2, 4, 5, 8 in particular). Rev 3 answers round 2 review `H:\cg-coord\reviews\PLANS-v2-002\review-m11.md` (REJECT), rulings 1 to 10 (`H:\cg-coord\reviews\PLANS-v2-002\cross-plan-rulings.md`), the owner decisions `H:\cg-coord\decisions\2026-10-03-v2-plans-round3.md` and the appendix. The mappings are in "Review responses" (rounds 1 and 2) and "Round 3 changes" at the end.

**Goal:** Give the v2 2x2 factorial campaign its telemetry (structured backend build log; LSP and tool-mix counts consumed from M10-07; usage completeness consumed from M9 gate 3), three qualified measures (final-code check, reuse, partial credit), exploratory per-arm and paired-delta rollups, the confirmatory C1-C3 machinery (bootstrap p-values, Holm over the pre-registered family, zero-solve rule), a simulation of the frozen selection and inference pipeline, and a two-stage pre-registration whose ancestry, design and selection the campaign and the report verify.

**Architecture:** Measures are not scorers: they never touch `SCORER_SUITE`, `verdictOf` or the judgment record. Each measure record is an immutable side file `results/harness/measures/<judgment-id>/<measure-fingerprint>.json`, bound to the artifact, judgment, oracle and analyzer identities; a version change adds a new file instead of overwriting. Statistics extend `src/harness/stats.ts` in place (same draws per seed). The experiment schema gains optional `contrasts` / `interaction` / `preregistration` keys (never defaulted, so v1 `experiment_hash` values are unchanged). The pre-registration YAML lives in `harness/preregistration/`; stage A freezes the protocol before screening (after M8's start seal, so it records the held-out ids), stage B adds only the design, the selection and provenance, and proves its ancestry by hashing its stage-A projection AND comparing it with anchors outside the editable document: the annotated tag `harness-v2-prereg-a` and the protocol hash and tag object recorded in the owner's decision file at approval (appendix section 10). The power simulation lives in `scripts/harness/power-sim.ts` beside M8's `scripts/harness/screening.ts` and calls M8's `stratumOf` and `select` and stats' `compareArms` / `compareInteraction` / `holm`, so it simulates the pipeline that will run.

**Tech Stack:** Deno 2.8, TypeScript, zod, `@std/assert`, `@std/cli/parse-args` (scripts), bccontainerhelper 6.1.14 (`Compile-AppWithBcCompilerFolder -EnableCodeCop -EnableUICop -rulesetFile`, verified in the installed module source).

**Spec:** `docs/superpowers/specs/2026-10-03-harness-v2-design.md` (master 2f8d2fca), sections 6, 7, 8.3, 8.6, 10, 12. Reviews: `H:\cg-coord\reviews\SPEC-v2-001\review-gpt61sol.md`, `H:\cg-coord\reviews\SPEC-v2-002\review-gpt61sol.md`, `H:\cg-coord\reviews\PLANS-v2-001\review-m11.md`, `H:\cg-coord\reviews\PLANS-v2-002\review-m11.md`. Rulings: `H:\cg-coord\reviews\PLANS-v2-002\cross-plan-rulings.md`. v1 rules: `H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`. Sibling plans: M8 (screening protocol `scripts/harness/screening.ts`, M8-02), M9 (gate 3: M9-06, M9-13, M9-14; arm ids `cc-v2-plain`, `cc-v2-plain-lsp`, `cc-v2-realistic`, `cc-v2-realistic-lsp`; experiment `cc-v2-factorial`), M10 (M10-07 LSP trace counts).

## Global Constraints

- Primary (confirmatory) metric: cost per solved task (list-price estimate), v1 rules 1-6 unchanged.
- Confirmatory family: exactly the pre-registered `family` (C1 LSP effect at realistic off, C2 LSP effect at realistic on, C3 "realistic effect without LSP"; the interaction only if pre-registered confirmatory before screening). Holm at family alpha 0.05. Held-out tasks never enter C1-C3.
- Everything else is exploratory and labelled `[exploratory]` / `label: "exploratory"`.
- Missing or incomplete telemetry stays `null`, never zero. No-build cells are counted apart.
- Bootstrap: paired task clusters; replication count (10,000) and seed pre-registered; zero-solve rule chosen in stage A by the simulation, never changed after.
- Power target (spec 7): MDE 20% lower cost per solved task (calibrated, not assumed), about 80% power per confirmatory contrast after Holm, suppression rate under 5%, family-wise error controlled within Monte Carlo error; designs 24/30/40 x 3/5/8.
- Measures qualified on correct, naive and measurement-only fixtures (spec 8.6) before screening (spec 12.3).
- Partial credit never for test-authoring; weights only over new-requirement rows (M8-21); hidden-regression rows and pass_to_pass preservation reported separately.
- Reuse = the target procedure is executed AND its result matters (effectiveness probe); never text matching.
- Final-code check: pinned compiler, CodeCop + UICop, frozen ruleset, analyzer canary, counts relative to the starting workspace; an incomplete build never yields warning numbers.
- Frozen v1 data and hashes are read-only; v1 campaigns need not resume (ruling 6).
- Rulings: parser `claude-code-trace@5` is bumped once by whichever of M9-04 / M10-07 merges first; M11 never touches the parser string or its pinning test (ruling 2). Gate 3 is M9's; M11 consumes it (ruling 4). All code builds on master after H-01 merges (ruling 8): every M11 code task lists H-01 as a dependency.
- Repo rules: TDD; Cliffy for `centralgauge` commands, `@std/cli/parse-args` for `scripts/harness/*` like their neighbours; `[Tag]` colored output; no em dash in new text; never run `tests/unit/container` while a bench is live; scope `deno check/lint/fmt` to touched files; never `deno fmt` under `site/`; never kill a process by image name.
- Acceptance for every code task: `deno test --allow-all --ignore=tests/unit/container tests/unit/harness/ tests/unit/scripts/ tests/unit/cli/commands/harness-command.test.ts` green; `deno check`, `deno lint`, `deno fmt --check` clean on touched files; no existing assertion weakened or deleted.

## Review Focus

1. A v1 artifact (experiment, campaign, trace from parser @4, host log without M11 fields, judgment without a measure file) must load and report as before: M11-08 (experiment hash), M11-12 (pre-@5 trace gives LSP missing, pre-M11 host log missing).
2. A cell with no host log, an incomplete trace when the arm declares a toolchain, or unproven usage (M9) must read as missing, never 0: M11-12 `cellValues` tests.
3. A suppressed contrast enters Holm as p = 1, never rejects, decides `no_decision`; a family that differs from the pre-registration in members, order or interaction status is refused: M11-09, M11-11.
4. A stage-B file whose stage-A projection does not hash to the approved stage A, whose design disagrees with the selection or the simulation output, or whose campaign task set differs from selected + held-out, is refused: M11-10. The approved stage A is read from outside the document (tag `harness-v2-prereg-a` and the decision file); editing both the document and its `stage_a.sha256` is refused: M11-10 anchor tests.
5. A reuse probe on a renamed, re-signed, moved or comment-only target is `missing` or not executed, never a false positive; a probe that does not compile is `missing`; a token call whose result is ignored is `executed: true, effective: false`: M11-06 and M11-14.

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `src/harness/build-log.ts` (new) | M11-01 | diagnostic normalization, `buildLogMetrics` |
| `src/harness/backend.ts` | M11-02 | host log lines carry `diagnostic_list`, `changed_apps`, `build_ok`; empty log at grant |
| `src/harness/measures.ts` (new) | M11-04..06 | task measures file, records, partial credit, final-code, canary, reuse probe |
| `src/harness/identity.ts` | M11-04 | `measures/` in the oracle hash only when present |
| `src/container/types.ts`, `bc-script-builders.ts`, `bc-container-provider.ts`, `bc-output-parsers.ts`, `src/harness/bc-lane.ts` | M11-05 | analyzer settings, warnings kept, cop codes parsed |
| `harness/analysis/final-code.ruleset.json`, `harness/analysis/canary/**` (new) | M11-05 | frozen ruleset, analyzer canary app and its expected codes |
| `src/harness/execution.ts`, `src/harness/qualify.ts`, `cli/commands/harness-command.ts` | M11-07 | `measureWorkspace`, `harness measure`, `judge-fixture --measures`, `fixture/<name>` fixtures |
| `src/harness/config.ts` | M11-08 | `contrasts`, `interaction`, `preregistration` |
| `src/harness/stats.ts` | M11-09 | `drawTasks`, `bootstrapP`, `holm`, zero-solve rule, `compareInteraction`, `testContrasts(family)` |
| `src/harness/prereg.ts` (new), `records.ts`, `campaign.ts`, `cli/commands/harness-command.ts` (`--prereg-decision`) | M11-10 | schema, ancestry, external stage-A anchor, verification, campaign binding |
| `src/harness/report.ts` | M11-11, M11-12 | confirmatory section (family, held-out, measure binding), exploratory section |
| `src/harness/rollups.ts` (new) | M11-12 | per-cell values, per-arm rollups, paired deltas |
| `scripts/harness/power-sim.ts` (new) | M11-13 | fit, candidate pool, M8 selection, calibration, evaluation, rule and design choice |
| `harness/preregistration/cc-v2-factorial.yml`, `.sim-a.json`, `.sim-b.json` (new) | M11-15..17b | the pre-registration and its simulation outputs |

## Schedule (start 2026-10-03; measures qualified by 10-20; stage A frozen 10-22..24 after M8's start seal on 10-21 and before M8-15b screening on 10-25; appendix sections 11 and 13)

| Task | Lane | Window | Deps |
| --- | --- | --- | --- |
| M11-09 contrast statistics | lane-infra | 10-03..10-06 | H-01 |
| M11-08 experiment schema | lane-infra | 10-06 | H-01 |
| M11-01 build-log metrics | lane-infra | 10-07 | H-01 |
| M11-02 backend build log | lane-infra | 10-07..10-09 | M11-01 |
| M11-10 pre-registration | lane-infra | 10-09..10-12 | M11-08, M11-09, M8-02 (selection JSON shape) |
| M11-11 report: confirmatory | lane-infra | 10-12..10-14 | M11-08..10 |
| M11-12 report: exploratory | lane-infra | 10-14..10-17 | M11-01, M11-02, M11-04, M11-11, M10-07, M9-06 |
| M11-04 measures core + partial credit | lane-infra2 | 10-03..10-05 | H-01 |
| M11-13 simulation | lane-infra2 | 10-05..10-09 | M11-09, M8-02 |
| M11-05 final-code check + canary | lane-infra2 | 10-09..10-11 | M11-04 |
| M11-06 reuse probe | lane-infra2 | 10-11..10-14 | M11-04 |
| M11-07 measure command | lane-infra2 | 10-14..10-16 | M11-04..06 |
| M11-15 stage-A simulation run (zero-solve rule, N_prelim for M8) | lane-ops | 10-10..10-13 | M11-13, M8-02 |
| M11-14 measure qualification (gate 6) | lane-ops | 10-16..10-20 | M11-07, M8-06 + M8-07 (fixtures, split; see M11-14) |
| M11-16 stage A freeze | orchestrator + owner | 10-22..10-24 | M11-10, M11-14, M11-15, M8-15a (held-out ids), M9-08 |
| M11-17a provisional design (sim-b) | orchestrator + lane-ops | 11-01 | M11-16, M8-16b |
| M11-17b stage B binding | orchestrator + owner | 11-06 | M11-17a, M8-19, M8-21 |

M11-03 (trace LSP telemetry) is withdrawn: M10-07 implements LSP counts and, if it merges before M9-04, the single parser bump; M11-12 consumes `TraceMetrics.lsp_calls: { total, by_op } | null` (rulings 2 and 9).

---

### Task M11-01: Build-log metrics (pure)

Lane: lane-infra. Deps: H-01.

**Files:**
- Create: `src/harness/build-log.ts`
- Modify (type only): `src/harness/backend.ts:69-86` (`HostLogLine` gains three optional fields)
- Test: `tests/unit/harness/build-log.test.ts`

**Interfaces:**
- Produces: `BuildDiagnostic`, `diagSymbol(message: string): string | null`, `relDiagFile(file: string, folder: string): string`, `buildDiagnostics(built: readonly BuiltApp[]): BuildDiagnostic[]`, `UNKNOWN_SYMBOL_CODES`, `BuildLogMetrics`, `buildLogMetrics(lines: readonly HostLogLine[] | undefined): BuildLogMetrics | null`.
- `HostLogLine` gains `diagnostic_list?: BuildDiagnostic[]`, `changed_apps?: string[]`, `build_ok?: boolean | null` (absent = pre-M11).

Definitions (copied into stage A):
- Build = host log line with `op` compile or test, `outcome` ok or failed, `build_ok` boolean. Snapshot-violation lines carry `build_ok: null`.
- Eligible build = a build whose `changed_apps` is non-empty (the agent has edited).
- Burden = distinct error diagnostics over all builds of the used execution keyed (code, workspace-relative file, symbol); `null` when the execution made no build.
- First eligible build = `ok` / `failed` by `build_ok`; `no_build` when none.
- Test runs = test-op builds that ran at least one test.
- No log file, or a compile/test line with outcome ok/failed and no `build_ok` key: `null`.

- [ ] **Step 1: Add the optional fields to `HostLogLine`** (after `message?: string;`):

```ts
  /** M11: error diagnostics of this build; absent in pre-M11 logs (missing, never zero). */
  diagnostic_list?: BuildDiagnostic[];
  /** M11: workspace apps that differ from the pristine workspace at this request. */
  changed_apps?: string[];
  /** M11: whether the build succeeded; null when nothing was built (snapshot refused). */
  build_ok?: boolean | null;
```

with `import type { BuildDiagnostic } from "./build-log.ts";`.

- [ ] **Step 2: Write the failing test** `tests/unit/harness/build-log.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import type { HostLogLine } from "../../../src/harness/backend.ts";
import {
  buildDiagnostics,
  buildLogMetrics,
  diagSymbol,
  relDiagFile,
} from "../../../src/harness/build-log.ts";

const line = (o: Partial<HostLogLine>): HostLogLine => ({
  v: 1,
  request: "br_1",
  execution: "e",
  op: "compile",
  status: 200,
  outcome: "ok",
  at: "2026-10-05T00:00:00.000Z",
  spans: { compile_ms: 10 },
  apps_compiled: [],
  per_app_compiles: 0,
  diagnostics: 0,
  tests_run: 0,
  tests_failed: 0,
  container: null,
  retries: 0,
  diagnostic_list: [],
  changed_apps: [],
  build_ok: true,
  ...o,
});
const d = (code: string, file: string, symbol: string | null) => ({
  app: "Core",
  code,
  file,
  line: 1,
  symbol,
});

Deno.test("diagSymbol: quoted identifiers joined, null without quotes", () => {
  assertEquals(diagSymbol("The name 'Foo' does not exist in the current context"), "Foo");
  assertEquals(
    diagSymbol("'Codeunit \"Rental Mgt\"' does not contain a definition for 'Calc'"),
    'Codeunit "Rental Mgt".Calc',
  );
  assertEquals(diagSymbol("App generation failed"), null);
});

Deno.test("relDiagFile: workspace-relative from the app folder, any separator", () => {
  assertEquals(relDiagFile("C:\\w\\snap-1\\Core\\src\\C.al", "Core"), "Core/src/C.al");
  assertEquals(relDiagFile("/tmp/x/core/src/C.al", "Core"), "core/src/C.al");
  assertEquals(relDiagFile("x.al", "Core"), "x.al");
});

Deno.test("buildDiagnostics: errors only, normalized", () => {
  const out = buildDiagnostics([{
    folder: "Core",
    id: "i",
    version: "1.0.0.0",
    ok: false,
    attempted: true,
    file: null,
    compile_ms: 1,
    diagnostics: [
      { code: "AL0118", message: "The name 'Foo' does not exist", file: "C:\\s\\Core\\src\\C.al", line: 3, column: 1, severity: "error" },
      { code: "AL0432", message: "obsolete 'Bar'", file: "C:\\s\\Core\\src\\C.al", line: 4, column: 1, severity: "warning" },
    ],
  }]);
  assertEquals(out, [{ app: "Core", code: "AL0118", file: "Core/src/C.al", line: 3, symbol: "Foo" }]);
});

Deno.test("buildLogMetrics: no log and pre-M11 lines are missing, not zero", () => {
  assertEquals(buildLogMetrics(undefined), null);
  const old = line({}) as Partial<HostLogLine>;
  delete old.build_ok;
  assertEquals(buildLogMetrics([old as HostLogLine]), null);
});

Deno.test("buildLogMetrics: an empty log is a no-build cell", () => {
  assertEquals(buildLogMetrics([]), {
    builds: 0,
    test_runs: 0,
    build_ms: 0,
    distinct_diagnostics: null,
    unknown_symbol: null,
    first_eligible: "no_build",
  });
});

Deno.test("buildLogMetrics: dedupe by (code, file, symbol); first eligible build skips pre-edit builds", () => {
  const m = buildLogMetrics([
    line({ changed_apps: [], build_ok: true }),
    line({ request: "br_2", changed_apps: ["Core"], build_ok: false, outcome: "failed",
      diagnostic_list: [d("AL0118", "Core/src/C.al", "Foo"), d("AL0118", "Core/src/C.al", "Foo")] }),
    line({ request: "br_3", changed_apps: ["Core"], build_ok: false, outcome: "failed",
      diagnostic_list: [d("AL0118", "Core/src/C.al", "Foo"), d("AL0118", "Core/src/D.al", "Foo"), d("AL0103", "Core/src/C.al", null)] }),
    line({ request: "br_4", op: "test", changed_apps: ["Core"], build_ok: true, tests_run: 3 }),
    line({ request: "rejected_1", outcome: "rejected", build_ok: undefined }),
    line({ request: "br_5", outcome: "failed", build_ok: null, changed_apps: ["Core"] }),
  ]);
  assertEquals(m, {
    builds: 4,
    test_runs: 1,
    build_ms: 40,
    distinct_diagnostics: 3,
    unknown_symbol: 2,
    first_eligible: "failed",
  });
});
```

- [ ] **Step 3: Run to verify it fails** (`deno test --allow-all tests/unit/harness/build-log.test.ts`): module not found.

- [ ] **Step 4: Implement** `src/harness/build-log.ts`:

```ts
/**
 * Structured agent-build telemetry from the cg-al backend host log (spec v2
 * section 6, M11). Pure. No log or a pre-M11 line gives null, never zero.
 */

import type { HostLogLine } from "./backend.ts";
import type { BuiltApp } from "./bc-lane.ts";

export interface BuildDiagnostic {
  app: string;
  code: string;
  /** Workspace-relative, forward slashes, from the app folder. */
  file: string;
  line: number;
  /** Quoted identifiers of the message joined with "."; null when none. */
  symbol: string | null;
}

/** Frozen in stage A (`measures.unknown_symbol_codes`). */
export const UNKNOWN_SYMBOL_CODES: readonly string[] = ["AL0118", "AL0132", "AL0185"];

export function diagSymbol(message: string): string | null {
  const q = [...message.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  return q.length === 0 ? null : q.join(".");
}

/** From the first path segment equal to the app folder (case-insensitive); else the base name. */
export function relDiagFile(file: string, folder: string): string {
  const parts = file.replaceAll("\\", "/").split("/");
  const i = parts.findIndex((p) => p.toLowerCase() === folder.toLowerCase());
  return i >= 0 ? parts.slice(i).join("/") : parts.at(-1)!;
}

export function buildDiagnostics(built: readonly BuiltApp[]): BuildDiagnostic[] {
  return built.flatMap((b) =>
    b.diagnostics.filter((x) => x.severity === "error").map((x) => ({
      app: b.folder,
      code: x.code,
      file: relDiagFile(x.file, b.folder),
      line: x.line,
      symbol: diagSymbol(x.message),
    }))
  );
}

export type FirstBuild = "ok" | "failed" | "no_build";

export interface BuildLogMetrics {
  builds: number;
  test_runs: number;
  build_ms: number;
  distinct_diagnostics: number | null;
  unknown_symbol: number | null;
  first_eligible: FirstBuild;
}

export function buildLogMetrics(
  lines: readonly HostLogLine[] | undefined,
): BuildLogMetrics | null {
  if (lines === undefined) return null;
  const done = lines.filter((l) =>
    (l.op === "compile" || l.op === "test") &&
    (l.outcome === "ok" || l.outcome === "failed")
  );
  if (done.some((l) => !("build_ok" in l))) return null;
  const builds = done.filter((l) => typeof l.build_ok === "boolean");
  const keys = new Set<string>();
  const unknown = new Set<string>();
  for (const l of builds) {
    for (const x of l.diagnostic_list ?? []) {
      const k = `${x.code}\u0000${x.file}\u0000${x.symbol ?? ""}`;
      keys.add(k);
      if (UNKNOWN_SYMBOL_CODES.includes(x.code)) unknown.add(k);
    }
  }
  const first = builds.find((l) => (l.changed_apps ?? []).length > 0);
  return {
    builds: builds.length,
    test_runs: builds.filter((l) => l.op === "test" && l.tests_run > 0).length,
    build_ms: builds.reduce((n, l) => n + (l.spans["compile_ms"] ?? 0), 0),
    distinct_diagnostics: builds.length === 0 ? null : keys.size,
    unknown_symbol: builds.length === 0 ? null : unknown.size,
    first_eligible: first === undefined ? "no_build" : first.build_ok ? "ok" : "failed",
  };
}
```

- [ ] **Step 5: Run to pass; check/lint/fmt; commit**

```bash
git add src/harness/build-log.ts src/harness/backend.ts tests/unit/harness/build-log.test.ts
git commit -m "feat(harness): build-log metrics for agent builds (M11-01)"
```

---

### Task M11-02: Backend writes the structured build log

Lane: lane-infra. Deps: M11-01, H-01.

**Files:**
- Modify: `src/harness/backend.ts` (`grant` ~line 440; violation line ~line 722; `defaultBackendOps` ~972-1125)
- Modify: `tests/unit/harness/fake-bc.ts` (optional per-folder errors)
- Test: `tests/unit/harness/backend.test.ts` (append)

**Interfaces:**
- Produces: every compile/test host log line carries `diagnostic_list`, `changed_apps`, `build_ok`; a granted execution always has a host log file (possibly empty).

- [ ] **Step 1: FakeBc hook** in `tests/unit/harness/fake-bc.ts`: field `errorsFor: ((folder: string) => CompilationError[]) | null = null;`, and in `compileProject` after `const source = await sources(project.path);`:

```ts
      const planted = this.errorsFor?.(folder) ?? [];
      if (planted.length > 0) {
        return { success: false, errors: planted, warnings: [], output: "", duration: 1 };
      }
```

- [ ] **Step 2: Failing tests** (append to `backend.test.ts`):

```ts
const ASSERT_SYMBOL = {
  app_id: IDS.assert,
  name: "Library Assert",
  publisher: "Microsoft",
  version: "28.0.0.0",
  file: "a.app",
  sha256: "0".repeat(64),
};

Deno.test("backend (M11): a granted execution has a host log before any request", async () => {
  const s = await setup();
  const path = join(s.root, "host-log-b.jsonl");
  assert((await Deno.stat(path)).isFile);
  assertEquals(await readHostLog(path), []);
});

Deno.test("production ops (M11): a failed compile logs code, relative file, symbol, changed apps and build_ok", async () => {
  const s = await setup();
  const bc = new FakeBc(() => result({ A: true }));
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend-m11"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
  });
  const exec = "00000000-0000-4000-8000-00000000e011";
  const ws = await workspace(s.root, exec);
  const pristine = await workspace(s.root, "pristine-m11");
  const hostLog = join(s.root, "hl-m11.jsonl");
  const tok = await b.grant({
    executionId: exec,
    sandbox: null,
    workspace: ws,
    pristine,
    trusted: await readAppGraph(pristine),
    symbols: [ASSERT_SYMBOL],
    lock: { store: s.root, packages: [] },
    deploy: { ledgerRoot: s.root, trustedRoots: [pristine] },
    hostLog,
  }, 60_000);
  bc.errorsFor = (f) =>
    f === "Core"
      ? [{
        code: "AL0118",
        message: "The name 'Foo' does not exist in the current context",
        file: "C:\\snap\\x\\Core\\src\\C.al",
        line: 3,
        column: 5,
        severity: "error",
      }]
      : [];
  await b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec));
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n    // edited\n}\n`);
  await b.handle(req("/v1/compile", tok, '{"apps":["Core"]}', exec));
  const [first, second] = await readHostLog(hostLog);
  assertEquals(first!.changed_apps, []);
  assertEquals(second!.changed_apps, ["Core"]);
  assertEquals(second!.build_ok, false);
  assertEquals(second!.diagnostic_list, [{ app: "Core", code: "AL0118", file: "Core/src/C.al", line: 3, symbol: "Foo" }]);
});

Deno.test("production ops (M11): a test request whose build fails logs its diagnostics", async () => {
  const s = await setup();
  const bc = new FakeBc(() => result({ A: true }));
  bc.errorsFor = (f) =>
    f === "Core"
      ? [{ code: "AL0132", message: "'X' does not contain a definition for 'Y'", file: "C.al", line: 1, column: 1, severity: "error" }]
      : [];
  const b = new Backend({
    scanReparsePoints: NO_SCAN,
    approvedRoots: [join(s.root, "work")],
    workRoot: join(s.root, "backend-m11t"),
    ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"],
  });
  const exec = "00000000-0000-4000-8000-00000000e012";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl-m11t.jsonl"));
  await b.handle(req("/v1/test", tok, "{}", exec));
  const [l] = await readHostLog(join(s.root, "hl-m11t.jsonl"));
  assertEquals([l!.op, l!.build_ok, l!.diagnostics], ["test", false, 1]);
  assertEquals(l!.diagnostic_list!.map((x) => [x.code, x.symbol]), [["AL0132", "X.Y"]]);
});
```

- [ ] **Step 3: Run to verify failure** (`--filter "M11"`).

- [ ] **Step 4: Implement** in `backend.ts`:

In `grant`, after the approved-roots check and before `const token = ...`:

```ts
      // M11: a granted execution always has a host log, so a missing file
      // is lost telemetry and an empty one is "no request".
      await Deno.mkdir(join(g.hostLog, ".."), { recursive: true });
      await Deno.writeTextFile(g.hostLog, "", { append: true, create: true });
```

Violation branch: add `build_ok: null,` to the `this.line(...)` extra. `defaultBackendOps.compile` log adds `diagnostic_list: buildDiagnostics(built), changed_apps: changed, build_ok: ok,`. `defaultBackendOps.test`: the `!prep.buildOk` log adds `diagnostics: prep.built.reduce((n, b) => n + b.diagnostics.length, 0), diagnostic_list: buildDiagnostics(prep.built), changed_apps: changed, build_ok: false,`; the "no runnable test codeunit" log and the final log add `diagnostic_list: buildDiagnostics(prep.built), changed_apps: changed, build_ok: true,`. Import `buildDiagnostics` from `./build-log.ts`.

- [ ] **Step 5: Run** all of `backend.test.ts` and `report.test.ts`. If an existing test asserts that no host log exists before a request, stop and report it (do not edit it).

- [ ] **Step 6: check/lint/fmt; commit**

```bash
git add src/harness/backend.ts tests/unit/harness/fake-bc.ts tests/unit/harness/backend.test.ts
git commit -m "feat(harness): backend host log carries diagnostics, changed apps, build outcome (M11-02)"
```

---

### Task M11-03: withdrawn

LSP counts are M10-07's; the parser bump belongs to the first of M9-04 / M10-07 to merge (ruling 2). Consumption contract for M11-12 (ruling 9, appendix section 5): `TraceMetrics.lsp_calls: { total: number; by_op: Record<string, number> } | null` (null when the trace lacks the `lsp_call` capability, never 0; operation names sanitized by M10-07), `TraceMetrics.lsp_shell_calls: number | null`, `raw_usage.lsp_passive_diagnostics: number | null`; the per-cell LSP total is also missing unless the execution's recorded parser (`telemetry.raw_usage.capabilities.parser`) is `claude-code-trace@5` or later. LSP calls stay `unclassified` under rules@1: they are counted by `lsp_calls`, and a `RULES_VERSION` bump would relabel v1 replays for no measurement gain.

---

### Task M11-04: Measures core: task measures file, versioned records, partial credit

Lane: lane-infra2. Deps: H-01.

**Files:**
- Create: `src/harness/measures.ts`
- Modify: `src/harness/identity.ts:332-346` (`oracleHash` includes `measures/` only when present)
- Test: `tests/unit/harness/measures.test.ts`, `tests/unit/harness/identity.test.ts` (append)

**Interfaces:**
- Task file `harness-tasks/tasks/HX-NNN/measures/measures.yml` (oracle side, never staged, outside `oracle/` so never compiled). Measurement-only fixtures live in `fixture/<name>/` overlay folders beside `naive/`, variant id `fixture/<name>` (appendix section 7; M8 review finding 2: they may pass the oracle, so they are not naive variants).
- Produces: `TaskMeasuresSchema`, `TaskMeasures`, `loadTaskMeasures(t: LoadedTask): Promise<TaskMeasures | null>`, `Measure<T>`, `ok`, `na`, `missing`, `PartialCredit`, `partialCredit(task, m, j): Measure<PartialCredit>`, `MEASURE_SUITE`, `measureFingerprint()`, `AnalyzersSchema`, `FinalCodeSchema`, `ReuseSchema`, `MeasureRecordSchema`, `MeasureRecord`, `writeMeasureRecord(resultsRoot, r)`, `readMeasureRecord(resultsRoot, judgmentId, fingerprint): Promise<MeasureRecord | null>`.

Partial-credit rows follow M8 (appendix section 7): an oracle procedure failing on `baseline` in the candidate's first promoted gate report (M8 A9, before the seal) is a new-requirement row (weighted); one passing is a hidden-regression row (unweighted preservation share). The weights file lists both and is fixed at the seal; M11-14 checks the split against that gate report, and M8-21 re-derives it at freeze and must find the same.

- [ ] **Step 1: Failing tests** `tests/unit/harness/measures.test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import type { HarnessTask } from "../../../src/harness/task.ts";
import type { JudgmentRecord } from "../../../src/harness/records.ts";
import {
  loadTaskMeasures,
  type MeasureRecord,
  measureFingerprint,
  partialCredit,
  readMeasureRecord,
  TaskMeasuresSchema,
  writeMeasureRecord,
} from "../../../src/harness/measures.ts";

const task = (kind: HarnessTask["kind"] = "feature"): HarnessTask => ({
  id: "HX-101",
  refapp_version: "refapp-v2",
  kind,
  prompt: "prompt.md",
  touches: [],
  coupling: [],
  source: "refapp",
  attachments: [],
  scorers: ["build", "pass_to_pass", "fail_to_pass"],
  pass_to_pass: [{ codeunit: 80010, procedures: ["P1", "P2"] }],
  fail_to_pass: { depends_on: ["Core"], tests: [{ codeunit: 85400, procedures: ["A", "B", "C", "H"] }] },
  mutants: [],
  contamination: null,
  limits: {},
});
const M = TaskMeasuresSchema.parse({
  v: 1,
  partial_credit: { weights: { "85400/A": 2, "85400/B": 1, "85400/C": 1 }, hidden_regressions: ["85400/H"] },
});
const row = (codeunit: number, procedure: string, pass: boolean, target = "candidate") => ({
  codeunit,
  procedure,
  target,
  outcome: pass ? "pass" as const : "fail" as const,
  failure: pass ? null : "assertion" as const,
});
const judgment = (scorers: JudgmentRecord["scorers"]): JudgmentRecord =>
  ({ scorers } as unknown as JudgmentRecord);
const full = (f2p: ReturnType<typeof row>[], p2p: ReturnType<typeof row>[]) =>
  judgment([
    { name: "build", passed: true, tests: [] },
    { name: "pass_to_pass", passed: false, tests: p2p },
    { name: "fail_to_pass", passed: false, tests: f2p },
  ]);

Deno.test("partialCredit: weighted new requirements; hidden regressions and pass_to_pass apart", () => {
  const j = full(
    [row(85400, "A", true), row(85400, "B", false), row(85400, "C", true), row(85400, "H", false)],
    [row(80010, "P1", true), row(80010, "P2", false), row(80011, "AgentTest", true)],
  );
  assertEquals(partialCredit(task(), M, j), {
    status: "ok",
    value: { new_requirements: 0.75, hidden_regressions: 0, pass_to_pass: 0.5 },
  });
});

Deno.test("partialCredit: incomplete rows, absent scorer or infra are missing; failed build is 0; test-authoring n/a", () => {
  const short = full([row(85400, "A", true)], [row(80010, "P1", true), row(80010, "P2", true)]);
  assertEquals(partialCredit(task(), M, short).status, "missing");
  const noP2p = judgment([
    { name: "build", passed: true, tests: [] },
    { name: "fail_to_pass", passed: true, tests: [] },
  ]);
  assertEquals(partialCredit(task(), M, noP2p), { status: "missing", reason: "required scorer absent" });
  const infra = judgment([
    { name: "build", passed: true, tests: [] },
    { name: "pass_to_pass", passed: null, tests: [] },
    { name: "fail_to_pass", passed: null, tests: [] },
  ]);
  assertEquals(partialCredit(task(), M, infra).status, "missing");
  const failed = judgment([
    { name: "build", passed: false, tests: [] },
    { name: "pass_to_pass", passed: false, tests: [] },
    { name: "fail_to_pass", passed: false, tests: [] },
  ]);
  assertEquals(partialCredit(task(), M, failed), {
    status: "ok",
    value: { new_requirements: 0, hidden_regressions: 0, pass_to_pass: 0 },
  });
  assertEquals(partialCredit(task("test-authoring"), M, failed).status, "not_applicable");
  assertEquals(partialCredit(task(), null, failed).status, "not_applicable");
});

Deno.test("loadTaskMeasures: weights + hidden regressions cover exactly the fail_to_pass procedures; never empty; never test-authoring", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, "measures"));
  const write = (y: string) => Deno.writeTextFile(join(dir, "measures", "measures.yml"), y);
  assertEquals(await loadTaskMeasures({ task: task(), dir: await Deno.makeTempDir() }), null);
  await write(`v: 1\npartial_credit:\n  weights: { "85400/A": 1, "85400/B": 1, "85400/C": 1 }\n`);
  await assertRejects(() => loadTaskMeasures({ task: task(), dir }), ValidationError, "85400/H");
  await write(`v: 1\npartial_credit:\n  weights: { "85400/A": 1, "85400/B": 1, "85400/C": 1, "85400/H": 1 }\n  hidden_regressions: ["85400/H"]\n`);
  await assertRejects(() => loadTaskMeasures({ task: task(), dir }), ValidationError, "both");
  await write(`v: 1\npartial_credit:\n  weights: {}\n`);
  await assertRejects(() => loadTaskMeasures({ task: task(), dir }));
  await write(`v: 1\npartial_credit:\n  weights: { "85400/A": 1, "85400/B": 1, "85400/C": 1 }\n  hidden_regressions: ["85400/H"]\n`);
  await assertRejects(() => loadTaskMeasures({ task: task("test-authoring"), dir }), ValidationError, "test-authoring");
  assertEquals((await loadTaskMeasures({ task: task(), dir }))!.partial_credit!.hidden_regressions, ["85400/H"]);
});

Deno.test("measure records: versioned by fingerprint, write once, bound to artifact and oracle", async () => {
  const root = await Deno.makeTempDir();
  const r: MeasureRecord = {
    v: 1,
    judgment_id: "00000000-0000-4000-8000-0000000000a1",
    execution_id: "00000000-0000-4000-8000-0000000000b1",
    task_id: "HX-101",
    workspace_hash: "a".repeat(64),
    oracle_hash: "b".repeat(64),
    measure_fingerprint: await measureFingerprint(),
    analyzers: null,
    final_code: { status: "missing", reason: "not run" },
    reuse: { status: "not_applicable", reason: "no reuse target" },
    partial_credit: { status: "ok", value: { new_requirements: 1, hidden_regressions: null, pass_to_pass: 1 } },
  };
  await writeMeasureRecord(root, r);
  assertEquals(await readMeasureRecord(root, r.judgment_id, r.measure_fingerprint), r);
  await assertRejects(() => writeMeasureRecord(root, r));
  const other = { ...r, measure_fingerprint: "c".repeat(64) };
  await writeMeasureRecord(root, other);
  assertEquals(await readMeasureRecord(root, r.judgment_id, "c".repeat(64)), other);
  assertEquals(await readMeasureRecord(root, r.judgment_id, "d".repeat(64)), null);
});
```

Append to `identity.test.ts`: `oracleHash` of a task folder without `measures/` equals the value from the pre-change formula (copy today's `hashJson({...})` literal into the test), and adding `measures/measures.yml` changes it.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/harness/measures.ts` (M11-05 and M11-06 extend it):

```ts
/**
 * Exploratory measures (spec v2 sections 6 and 8.6): final-code check,
 * reuse, partial credit. NOT scorers: never in SCORER_SUITE or the verdict.
 * Immutable side files results/harness/measures/<judgment>/<fingerprint>.json,
 * bound to the artifact, judgment, oracle and analyzer identities. Each
 * measure is ok, not_applicable or missing (missing is never a zero).
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import type { JudgmentRecord } from "./records.ts";
import type { HarnessTask, LoadedTask } from "./task.ts";
import { hashJson } from "./hash.ts";
import { Sha256Hex } from "./identity.ts";
import { readYaml } from "./yaml.ts";

export const MEASURE_SUITE: Record<string, string> = {
  final_code: "1",
  reuse: "1",
  partial_credit: "1",
};
export function measureFingerprint(): Promise<string> {
  return hashJson({ measure_versions: MEASURE_SUITE });
}

const ProcKey = z.string().regex(/^8\d{4}\/[A-Za-z_][A-Za-z0-9_]*$/);
/** Appendix section 7: measurement-only fixtures are `fixture/<name>` (folder `fixture/<name>/`). */
export const VARIANT = /^(correct|reference-tests|naive\/[A-Za-z0-9_-]+|fixture\/[A-Za-z0-9_-]+)$/;

export const ReuseTargetSchema = z.strictObject({
  codeunit: z.number().int().positive(),
  procedure: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  /** As declared, e.g. "(Amount: Decimal): Decimal"; compared without whitespace, case-insensitive. */
  signature: z.string().min(2),
  /** Workspace-relative file holding the codeunit in the pristine workspace. */
  file: z.string().min(1),
  /** AL statements for a non-throwing wrong result (the effectiveness probe). */
  perturb: z.string().min(1),
});
export type ReuseTarget = z.output<typeof ReuseTargetSchema>;

export const TaskMeasuresSchema = z.strictObject({
  v: z.literal(1),
  partial_credit: z.strictObject({
    weights: z.record(ProcKey, z.number().positive())
      .refine((w) => Object.keys(w).length > 0, "at least one weight"),
    hidden_regressions: z.array(ProcKey).default([]),
  }).nullable().default(null),
  reuse: z.strictObject({
    /** The spec-named procedure first, then accepted alternatives. */
    targets: z.array(ReuseTargetSchema).min(1),
    tests: z.array(z.strictObject({
      codeunit: z.number().int().min(85000).max(89999),
      procedures: z.array(z.string().min(1)).min(1),
    })).min(1),
  }).nullable().default(null),
  expect: z.record(z.string().regex(VARIANT), z.strictObject({
    reuse_executed: z.boolean().optional(),
    reuse: z.boolean().optional(),
    partial_credit: z.number().min(0).max(1).optional(),
    final_errors: z.number().int().min(0).optional(),
    /** Codes whose count must increase over the starting workspace. */
    new_warning_codes: z.array(z.string()).optional(),
  })).default({}),
});
export type TaskMeasures = z.output<typeof TaskMeasuresSchema>;

export async function loadTaskMeasures(t: LoadedTask): Promise<TaskMeasures | null> {
  const path = join(t.dir, "measures", "measures.yml");
  try {
    await Deno.stat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  const m = await readYaml(path, TaskMeasuresSchema);
  const errors: string[] = [];
  const f2p = new Set(
    (t.task.fail_to_pass?.tests ?? []).flatMap((x) => x.procedures.map((p) => `${x.codeunit}/${p}`)),
  );
  if (m.partial_credit) {
    if (t.task.kind === "test-authoring") errors.push("partial_credit is not defined for test-authoring");
    const w = new Set(Object.keys(m.partial_credit.weights));
    const h = new Set(m.partial_credit.hidden_regressions);
    for (const k of w) if (h.has(k)) errors.push(`${k} is both weighted and a hidden regression`);
    for (const k of f2p) if (!w.has(k) && !h.has(k)) errors.push(`no weight or hidden-regression entry for ${k}`);
    for (const k of [...w, ...h]) if (!f2p.has(k)) errors.push(`${k} is not a fail_to_pass procedure`);
  }
  for (const x of m.reuse?.tests ?? []) {
    for (const p of x.procedures) {
      if (!f2p.has(`${x.codeunit}/${p}`)) errors.push(`reuse test ${x.codeunit}/${p} is not a fail_to_pass procedure`);
    }
  }
  if (errors.length > 0) throw new ValidationError(`${path}:\n  ${errors.join("\n  ")}`, errors);
  return m;
}

export type Measure<T> =
  | { status: "ok"; value: T }
  | { status: "not_applicable"; reason: string }
  | { status: "missing"; reason: string };
export const ok = <T>(value: T): Measure<T> => ({ status: "ok", value });
export const na = <T>(reason: string): Measure<T> => ({ status: "not_applicable", reason });
export const missing = <T>(reason: string): Measure<T> => ({ status: "missing", reason });

export interface PartialCredit {
  new_requirements: number;
  /** Share of hidden-regression rows passed; null when the task has none. */
  hidden_regressions: number | null;
  /** Share of declared pass_to_pass procedures passed; null when none declared. */
  pass_to_pass: number | null;
}

type Scorer = JudgmentRecord["scorers"][number];

/** Passed keys when every key has exactly one candidate row, else null (incomplete). */
function passedRows(s: Scorer, keys: string[]): Set<string> | null {
  const by = new Map<string, Scorer["tests"]>();
  for (const t of s.tests.filter((x) => x.target === "candidate")) {
    const k = `${t.codeunit}/${t.procedure}`;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  if (!keys.every((k) => by.get(k)?.length === 1)) return null;
  return new Set(keys.filter((k) => by.get(k)![0]!.outcome === "pass"));
}

export function partialCredit(
  task: HarnessTask,
  m: TaskMeasures | null,
  j: JudgmentRecord,
): Measure<PartialCredit> {
  if (task.kind === "test-authoring") return na("kind test-authoring");
  if (!m?.partial_credit) return na("no frozen weights");
  const s = (n: string) => j.scorers.find((x) => x.name === n);
  const build = s("build");
  const f2p = s("fail_to_pass");
  const p2p = s("pass_to_pass");
  const declared = task.pass_to_pass.flatMap((r) => r.procedures.map((p) => `${r.codeunit}/${p}`));
  if (!build || !f2p || (declared.length > 0 && !p2p)) return missing("required scorer absent");
  if (j.scorers.some((x) => x.passed === null)) return missing("unscored judgment (infra)");
  const hidden = m.partial_credit.hidden_regressions;
  const share = (keys: string[], pass: Set<string>) =>
    keys.length === 0 ? null : keys.filter((k) => pass.has(k)).length / keys.length;
  if (build.passed === false) {
    return ok({ new_requirements: 0, hidden_regressions: share(hidden, new Set()), pass_to_pass: share(declared, new Set()) });
  }
  const weights = Object.entries(m.partial_credit.weights);
  const passF = passedRows(f2p, [...weights.map(([k]) => k), ...hidden]);
  const passP = declared.length === 0 ? new Set<string>() : passedRows(p2p!, declared);
  if (passF === null || passP === null) return missing("incomplete oracle rows");
  const total = weights.reduce((n, [, w]) => n + w, 0);
  return ok({
    new_requirements: weights.reduce((n, [k, w]) => n + (passF.has(k) ? w : 0), 0) / total,
    hidden_regressions: share(hidden, passF),
    pass_to_pass: share(declared, passP),
  });
}

const measure = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("ok"), value }),
    z.strictObject({ status: z.literal("not_applicable"), reason: z.string().min(1) }),
    z.strictObject({ status: z.literal("missing"), reason: z.string().min(1) }),
  ]);

export const AnalyzersSchema = z.strictObject({
  /** harnessCompilerIdentity: artifact URL plus pinned BCH version (analyzers ship with the compiler). */
  compiler: z.string().min(1),
  ruleset_sha256: Sha256Hex,
  /** Codes the canary produced in this run; must include the frozen expected codes. */
  canary_codes: z.array(z.string()),
});

export const FinalCodeSchema = z.strictObject({
  errors: z.number().int().min(0),
  /** null when any app was skipped or failed (analyzer output incomplete). */
  warnings: z.number().int().min(0).nullable(),
  start_errors: z.number().int().min(0),
  start_warnings: z.number().int().min(0),
  new_warnings: z.number().int().min(0).nullable(),
  /** Per code: final minus start, only codes that increased. */
  new_warning_codes: z.record(z.string(), z.number().int().positive()),
  complete: z.boolean(),
  incomplete_apps: z.array(z.string()),
});
export type FinalCode = z.output<typeof FinalCodeSchema>;

export const ReuseSchema = z.strictObject({
  executed: z.boolean(),
  effective: z.boolean(),
  via: z.string().nullable(),
});

export const MeasureRecordSchema = z.strictObject({
  v: z.literal(1),
  judgment_id: z.uuid(),
  execution_id: z.uuid(),
  task_id: z.string(),
  workspace_hash: Sha256Hex,
  oracle_hash: Sha256Hex,
  measure_fingerprint: Sha256Hex,
  analyzers: AnalyzersSchema.nullable(),
  final_code: measure(FinalCodeSchema),
  reuse: measure(ReuseSchema),
  partial_credit: measure(z.strictObject({
    new_requirements: z.number().min(0).max(1),
    hidden_regressions: z.number().min(0).max(1).nullable(),
    pass_to_pass: z.number().min(0).max(1).nullable(),
  })),
});
export type MeasureRecord = z.output<typeof MeasureRecordSchema>;

const recordPath = (root: string, judgmentId: string, fp: string) =>
  join(root, "measures", judgmentId, `${fp}.json`);

export async function writeMeasureRecord(resultsRoot: string, r: MeasureRecord): Promise<void> {
  const p = MeasureRecordSchema.parse(r);
  await Deno.mkdir(join(resultsRoot, "measures", p.judgment_id), { recursive: true });
  await Deno.writeTextFile(
    recordPath(resultsRoot, p.judgment_id, p.measure_fingerprint),
    JSON.stringify(p, null, 2) + "\n",
    { createNew: true },
  );
}

export async function readMeasureRecord(
  resultsRoot: string,
  judgmentId: string,
  fingerprint: string,
): Promise<MeasureRecord | null> {
  if (!z.uuid().safeParse(judgmentId).success || !Sha256Hex.safeParse(fingerprint).success) return null;
  try {
    return MeasureRecordSchema.parse(JSON.parse(await Deno.readTextFile(recordPath(resultsRoot, judgmentId, fingerprint))));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
```

`identity.ts oracleHash`: `const measures = (await exists(join(dir, "measures"))) ? await tree("measures") : null;` and spread `...(measures !== null ? { measures } : {})`; `exists` from `./fsutil.ts`; doc comment names `measures/`. `tests/unit/harness/task-set-v1.test.ts` must stay green untouched.

- [ ] **Step 4: Run; check/lint/fmt; commit**

```bash
git add src/harness/measures.ts src/harness/identity.ts tests/unit/harness/measures.test.ts tests/unit/harness/identity.test.ts
git commit -m "feat(harness): versioned measure records, task measures file, partial credit (M11-04)"
```

---

### Task M11-05: Final-code check with analyzer canary

Lane: lane-infra2. Deps: M11-04, H-01.

**Files:**
- Modify: `src/container/types.ts:79-84`, `src/container/bc-script-builders.ts:110-144`, `src/container/bc-container-provider.ts:~1668-1700`, `src/container/bc-output-parsers.ts:98-180`, `src/harness/bc-lane.ts:350-358, 597-861`, `src/harness/measures.ts`
- Create: `harness/analysis/final-code.ruleset.json`, `harness/analysis/canary/app.json`, `harness/analysis/canary/src/Canary.Codeunit.al`, `harness/analysis/canary/expect.json`
- Modify: `tests/unit/harness/fake-bc.ts`
- Test: `tests/unit/harness/final-code.test.ts`

**Interfaces:**
- Produces: `AnalysisSettings { codeCop: boolean; uiCop: boolean; rulesetFile: string }` (`ALProject.analysis?`); `BuiltApp.warnings?`; `buildApps({ analysis })`; `FinalCounts { errors; warnings; warning_codes; incomplete_apps: string[]; compiler }`; `finalCodeCounts(lane, o)`; `finalCode(start: FinalCounts, end: FinalCounts): Measure<FinalCode>`; `canaryCheck(lane, o): Promise<{ codes: string[]; ok: boolean; compiler: string }>`.

Completeness: an app counts as complete only when attempted AND built ok; warnings are reported only when every app is complete (analyzers may not run, or run partially, on a failing compile, so a failed app's warning count is not trusted). An incomplete start workspace makes the measure `missing`. Analyzer activity is proven per measure run by compiling the canary app and requiring its frozen expected codes (`expect.json`, starting with `AA0137`; lane-ops adds the measured UICop code in M11-14); a failed canary makes every final-code measure of that run `missing`.

The parser change: `parseCompilationErrors/Warnings` match only `AL\d+` today, so `AA0137` would be dropped and a cop error becomes `AL0000`. The bench never enables cops, so widening to `[A-Z]{2}\d{4}` changes nothing there.

- [ ] **Step 1: Analysis files.** `final-code.ruleset.json`:

```json
{
  "name": "CentralGauge harness v2 final-code check",
  "description": "Frozen in stage A. CodeCop and UICop default severities, no overrides.",
  "rules": []
}
```

`canary/app.json`: a minimal app (`id` a fixed new GUID, `name` "CG Analyzer Canary", `publisher` "CentralGauge", `version` "1.0.0.0", `idRanges` [{ from: 50990, to: 50999 }], no dependencies, `runtime` as the refapp-v2 apps). `canary/src/Canary.Codeunit.al`:

```al
codeunit 50990 "CG Analyzer Canary"
{
    procedure Probe(): Integer
    var
        Unused: Integer;
    begin
        exit(1);
    end;
}
```

`canary/expect.json`: `{ "codes": ["AA0137"] }`.

- [ ] **Step 2: FakeBc**: fields `analysisSeen: (AnalysisSettings | undefined)[] = [];` and `warningsFor: ((folder: string) => CompilationWarning[]) | null = null;`; `compileProject` pushes `project.analysis` and returns `warnings: this.warningsFor?.(folder) ?? []` on success.

- [ ] **Step 3: Failing tests** `tests/unit/harness/final-code.test.ts`:

```ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildCompileScript } from "../../../src/container/bc-script-builders.ts";
import { parseCompilationErrors, parseCompilationWarnings } from "../../../src/container/bc-output-parsers.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { canaryCheck, finalCode, type FinalCounts, finalCodeCounts } from "../../../src/harness/measures.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { FakeBc } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const analysis = { codeCop: true, uiCop: true, rulesetFile: "r.json" };
const w = (code: string) => ({ code, message: "m", file: "C.al", line: 1, column: 1, severity: "warning" as const });
const counts = (o: Partial<FinalCounts>): FinalCounts => ({
  errors: 0, warnings: 0, warning_codes: {}, incomplete_apps: [], compiler: "c", ...o,
});

Deno.test("buildCompileScript: analysis adds the cop switches and the ruleset; none without it", () => {
  assertEquals(buildCompileScript("C:\\\\cf", "C:\\\\p", "C:\\\\o").includes("EnableCodeCop"), false);
  const s = buildCompileScript("C:\\\\cf", "C:\\\\p", "C:\\\\o", { ...analysis, rulesetFile: "C:\\\\r\\\\f.json" });
  assertStringIncludes(s, "-EnableCodeCop");
  assertStringIncludes(s, "-EnableUICop");
  assertStringIncludes(s, '-rulesetFile "C:\\\\r\\\\f.json"');
});

Deno.test("parsers: CodeCop and UICop codes keep their code", () => {
  const out = [
    "C:\\w\\Core\\src\\C.al(5,9): warning AA0137: The variable 'X' is declared but never used.",
    "C:\\w\\Core\\src\\P.al(2,1): warning AW0006: The page 'P' should have the UsageCategory set.",
    "C:\\w\\Core\\src\\C.al(7,1): error AA0001: There must be exactly one space character.",
  ].join("\n");
  assertEquals(parseCompilationWarnings(out).map((x) => x.code), ["AA0137", "AW0006"]);
  assertEquals(parseCompilationErrors(out).map((x) => x.code), ["AA0001"]);
});

Deno.test("finalCodeCounts: analysis reaches the compile; a failed app is incomplete", async () => {
  const root = await Deno.makeTempDir();
  const ws = join(root, "ws");
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  bc.warningsFor = () => [w("AA0137")];
  const o = { dir: ws, apps: await readAppGraph(ws), lock: { store: root, packages: [] }, outDir: join(root, "o1"), analysis };
  assertEquals(await finalCodeCounts(lane, o), counts({ warnings: 1, warning_codes: { AA0137: 1 }, compiler: bc.compilerId }));
  assertEquals(bc.analysisSeen.at(-1), analysis);
  bc.errorsFor = () => [{ code: "AL0118", message: "x", file: "C.al", line: 1, column: 1, severity: "error" }];
  const bad = await finalCodeCounts(lane, { ...o, outDir: join(root, "o2") });
  assertEquals([bad.errors, bad.incomplete_apps], [1, ["Core"]]);
});

Deno.test("finalCode: per-code increases; incomplete final has no warning numbers; incomplete start is missing", () => {
  const start = counts({ warnings: 1, warning_codes: { AA0137: 1, AA0072: 2 } });
  const end = counts({ warnings: 4, warning_codes: { AA0137: 3, AW0006: 1 } });
  assertEquals(finalCode(start, end), {
    status: "ok",
    value: {
      errors: 0, warnings: 4, start_errors: 0, start_warnings: 1, new_warnings: 3,
      new_warning_codes: { AA0137: 2, AW0006: 1 }, complete: true, incomplete_apps: [],
    },
  });
  const part = finalCode(start, counts({ errors: 2, incomplete_apps: ["Rental"] }));
  assertEquals(part.status === "ok" && [part.value.warnings, part.value.new_warnings, part.value.complete], [null, null, false]);
  assertEquals(finalCode(counts({ incomplete_apps: ["Core"] }), end).status, "missing");
  assertEquals(finalCode(start, counts({ compiler: "other" })).status, "missing");
});

Deno.test("canaryCheck: ok only when every expected code appears", async () => {
  const root = await Deno.makeTempDir();
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const o = { canaryDir: "harness/analysis/canary", lock: { store: root, packages: [] }, outDir: join(root, "c"), analysis, expected: ["AA0137"] };
  bc.warningsFor = () => [w("AA0137")];
  assertEquals((await canaryCheck(lane, o)).ok, true);
  bc.warningsFor = () => [];
  assertEquals((await canaryCheck(lane, { ...o, outDir: join(root, "c2") })).ok, false);
});
```

- [ ] **Step 4: Run to verify failure.**

- [ ] **Step 5: Implement.**

`types.ts`:

```ts
/** Analyzer settings for the harness final-code check (host-controlled compile). */
export interface AnalysisSettings {
  codeCop: boolean;
  uiCop: boolean;
  /** Host path of the frozen ruleset. */
  rulesetFile: string;
}
```

and `ALProject.analysis?: AnalysisSettings;`.

`buildCompileScript(compilerFolder, projectPath, outputDir, analysis?: AnalysisSettings)`:

```ts
  const cops = analysis
    ? [
      analysis.codeCop ? "-EnableCodeCop" : "",
      analysis.uiCop ? "-EnableUICop" : "",
      `-rulesetFile "${analysis.rulesetFile}"`,
    ].filter(Boolean).join(" ")
    : "";
```

with the call lines

```
          -appOutputFolder "${outputDir}" \`${cops ? `
          ${cops} \`` : ""}
          -ErrorAction Stop 2>&1
```

`bc-container-provider.ts compileProjectInner`: pass `project.analysis ? { ...project.analysis, rulesetFile: project.analysis.rulesetFile.replace(/\\/g, "\\\\") } : undefined` as the fourth argument.

`bc-output-parsers.ts`: both regexes use `([A-Z]{2}\d{4})` instead of `(AL\d+)`.

`bc-lane.ts`: `BuiltApp.warnings?: CompilationError[]` (set only by an analysis compile); `buildApps` option `analysis?: AnalysisSettings` passed into the project; the attempted-compile pushes add `...(o.analysis ? { warnings: r.warnings } : {})`. Callers passing `analysis` never pass `cache`.

`measures.ts`:

```ts
export interface FinalCounts {
  errors: number;
  warnings: number;
  warning_codes: Record<string, number>;
  /** Apps not attempted or not built ok: their analyzer output is not trusted. */
  incomplete_apps: string[];
  compiler: string;
}

export function finalCodeCounts(
  lane: BcLane,
  o: { dir: string; apps: StagedApp[]; lock: LockedSymbols; outDir: string; analysis: AnalysisSettings },
): Promise<FinalCounts> {
  return lane.compile(async (c) => {
    const built = await buildApps(lane.bc, c, {
      srcDir: o.dir, apps: o.apps, versions: new Map(), outDir: o.outDir, lock: o.lock, analysis: o.analysis,
    });
    const warning_codes: Record<string, number> = {};
    let warnings = 0;
    for (const b of built) {
      for (const x of b.warnings ?? []) {
        warnings++;
        warning_codes[x.code] = (warning_codes[x.code] ?? 0) + 1;
      }
    }
    return {
      errors: built.reduce((n, b) => n + b.diagnostics.filter((d) => d.severity === "error").length, 0),
      warnings,
      warning_codes,
      incomplete_apps: built.filter((b) => !b.attempted || !b.ok).map((b) => b.folder),
      compiler: await lane.bc.harnessCompilerIdentity(c),
    };
  });
}

export function finalCode(start: FinalCounts, end: FinalCounts): Measure<FinalCode> {
  if (start.compiler !== end.compiler) return missing("compiler changed between the start and final compiles");
  if (start.incomplete_apps.length > 0) {
    return missing(`starting workspace did not build completely: ${start.incomplete_apps.join(", ")}`);
  }
  const complete = end.incomplete_apps.length === 0;
  const inc: Record<string, number> = {};
  if (complete) {
    for (const k of Object.keys(end.warning_codes).sort()) {
      const d = end.warning_codes[k]! - (start.warning_codes[k] ?? 0);
      if (d > 0) inc[k] = d;
    }
  }
  return ok({
    errors: end.errors,
    warnings: complete ? end.warnings : null,
    start_errors: start.errors,
    start_warnings: start.warnings,
    new_warnings: complete ? Object.values(inc).reduce((a, b) => a + b, 0) : null,
    new_warning_codes: inc,
    complete,
    incomplete_apps: end.incomplete_apps,
  });
}

export async function canaryCheck(
  lane: BcLane,
  o: { canaryDir: string; lock: LockedSymbols; outDir: string; analysis: AnalysisSettings; expected: string[] },
): Promise<{ codes: string[]; ok: boolean; compiler: string }> {
  const c = await finalCodeCounts(lane, {
    dir: dirname(o.canaryDir), apps: await readAppGraphOf(o.canaryDir), lock: o.lock, outDir: o.outDir, analysis: o.analysis,
  });
  const codes = Object.keys(c.warning_codes).sort();
  return { codes, ok: c.incomplete_apps.length === 0 && o.expected.every((x) => codes.includes(x)), compiler: c.compiler };
}
```

where `readAppGraphOf(dir)` reads the single app at `dir` via `readAppJson(join(dir, "app.json"))` into one `StagedApp` with `folder: basename(dir)`, `depends: []`, `external: []` (the canary has no dependencies). Imports: `basename, dirname` from `@std/path`; `type AnalysisSettings` from `../container/types.ts`; `type BcLane, buildApps, type LockedSymbols` from `./bc-lane.ts`; `readAppJson, type StagedApp` from `./staging.ts`.

- [ ] **Step 6: Run** final-code, bc-lane, verdict, backend tests. Do not run `tests/unit/container/` while a bench is live.

- [ ] **Step 7: check/lint/fmt; commit**

```bash
git add harness/analysis src/container/types.ts src/container/bc-script-builders.ts src/container/bc-container-provider.ts src/container/bc-output-parsers.ts src/harness/bc-lane.ts src/harness/measures.ts tests/unit/harness/fake-bc.ts tests/unit/harness/final-code.test.ts
git commit -m "feat(harness): final-code check with frozen ruleset, completeness and analyzer canary (M11-05)"
```

---

### Task M11-06: Reuse probe: executed and effective

Lane: lane-infra2. Deps: M11-04, H-01.

Definition (frozen in stage A): for a task whose `measures.yml` has `reuse`, and a cell whose real judgment passed every listed reuse test, each target (the spec-named procedure, then accepted alternatives) is located by codeunit id, procedure name AND declared signature inside that codeunit's object body, with comments and string literals masked. Two probes run on copies of the frozen workspace, each re-judged with only the reuse tests:
- executed probe: body becomes `Error('CG-REUSE-PROBE')`; executed = every reuse test fails with a message containing the marker;
- effectiveness probe: body becomes the task's `perturb` statements (a non-throwing wrong result); effective = every reuse test fails.
A token call whose result is ignored is executed but not effective. A target the agent renamed, re-signed or moved is not located; no located target at all: `missing`. A probe whose build fails or that is unscored: `missing` (never `reused: false`). Attribution is per reuse test (round 2 finding 5): a test counts as executed when it fails with the marker under some located target's executed probe, and as effective when it fails under some located target's effectiveness probe, so different tests may run through different accepted alternatives. `effective` = every reuse test effective; `executed` = every reuse test executed OR effective (a test that the perturbation changes ran the target, so a call whose probe error is swallowed, for example inside a `[TryFunction]`, still reads as executed when its result is used). A call whose error is swallowed AND whose result is ignored reads as not executed: `executed` is a lower bound, stated in the report. Result: `{ executed, effective, via }`, `via` = the ids of the targets that cover the effective (else executed) tests, joined by `+`, or null.

**Files:**
- Modify: `src/harness/measures.ts` (`REUSE_MARKER`, `maskAl`, `locateProcedure`, `stubProcedure`, `reuseCheck`)
- Test: `tests/unit/harness/measures.test.ts` (append), `tests/unit/harness/reuse.test.ts` (FakeBc end-to-end)

**Interfaces:**
- Produces: `maskAl(src: string): string`, `locateProcedure(src: string, t: Pick<ReuseTarget, "codeunit" | "procedure" | "signature">): [number, number] | null`, `stubProcedure(src, t, statements: string): string | null`, `ReuseInput`, `reuseCheck(lane: BcLane, o: ReuseInput): Promise<Measure<{ executed: boolean; effective: boolean; via: string | null }>>`.

```ts
export interface ReuseInput {
  task: LoadedTask;
  measures: TaskMeasures;
  judgment: JudgmentRecord;
  judge: Omit<JudgeInput, "task" | "artifact" | "workDir" | "executionId">;
  artifact: string;
  workDir: string;
}
```

- [ ] **Step 1: Failing unit tests** (append to `measures.test.ts`):

```ts
import { locateProcedure, stubProcedure } from "../../../src/harness/measures.ts";

const T = { codeunit: 70010, procedure: "CalcSurcharge", signature: "(Amount: Decimal): Decimal" };
const CU = `codeunit 70010 "Rental Price Mgt"
{
    // old: procedure CalcSurcharge(Amount: Decimal): Decimal begin end;
    procedure CalcSurcharge(Amount: Decimal): Decimal
    var
        Rate: Decimal;
    begin
        Rate := 0.1; // begin end case
        Message('end; begin');
        case Amount > 100 of
            true:
                begin
                    exit(Amount * Rate);
                end;
        end;
        exit(0);
    end;

    procedure Other()
    begin
    end;
}
`;
const OTHER = `codeunit 70011 "Copy"
{
    procedure CalcSurcharge(Amount: Decimal): Decimal
    begin
        exit(1);
    end;
}
`;

Deno.test("stubProcedure: replaces only the target body (nested begin/case, comments, strings)", () => {
  const out = stubProcedure(CU, T, "Error('CG-REUSE-PROBE');")!;
  assertEquals(out.includes("Error('CG-REUSE-PROBE')"), true);
  assertEquals(out.includes("exit(Amount * Rate)"), false);
  assertEquals(out.includes("procedure Other()\n    begin\n    end;"), true);
  assertEquals(out.includes("Rate: Decimal;"), true);
  assertEquals(out.includes("// old: procedure CalcSurcharge"), true);
});

Deno.test("locateProcedure: object scoping, signature, renames and duplicates", () => {
  assertEquals(stubProcedure(OTHER + CU, T, "exit(-1);")!.includes("exit(1);"), true);
  assertEquals(locateProcedure(CU, { ...T, codeunit: 70011 }), null);
  assertEquals(locateProcedure(CU, { ...T, procedure: "CalcSurcharge2" }), null);
  assertEquals(locateProcedure(CU, { ...T, signature: "(Amount: Decimal; Weekend: Boolean): Decimal" }), null);
  assertEquals(locateProcedure(CU + CU, T), null);
  assertEquals(locateProcedure(CU.replace("procedure CalcSurcharge(Amount: Decimal)", "procedure  calcsurcharge( amount : decimal )"), T) !== null, true);
});
```

- [ ] **Step 2: Failing end-to-end tests** `tests/unit/harness/reuse.test.ts`, built on the judge fixtures used by `tests/unit/harness/verdict.test.ts` (staged pristine with a Rental app holding codeunit 70010 above, oracle codeunit 85400 with procedure `SurchargeApplied`). The FakeBc test script (the fake cannot execute AL; a candidate "on the tested path" carries `// path: calls target`, one whose call result is used carries `// path: uses result`):

```ts
const script = (cu: number, deployed: Map<string, FakeApp>) => {
  if (cu !== 85400) return result({ A: true });
  const src = [...deployed.values()].map((a) => a.source).join("\n");
  if (src.includes("CG-REUSE-PROBE") && src.includes("// path: calls target")) {
    return result({ SurchargeApplied: "Error: CG-REUSE-PROBE" });
  }
  if (src.includes("exit(-1);") && src.includes("// path: uses result")) {
    return result({ SurchargeApplied: "Assert.AreEqual failed" });
  }
  return result({ SurchargeApplied: true });
};
```

Cases, each a `Deno.test` with exact expected values:
1. calls and uses the result: `{ status: "ok", value: { executed: true, effective: true, via: "70010/CalcSurcharge" } }`;
2. token call, result ignored (`// path: calls target` only): `{ executed: true, effective: false, via: "70010/CalcSurcharge" }`;
3. duplicated logic (no marker comment): `{ executed: false, effective: false, via: null }`;
4. target renamed by the agent, no alternative: `{ status: "missing", reason: "no reuse target located in the final workspace" }`;
5. first target re-signed, second (alternative) target used: `via` names the alternative;
6. the probe body does not compile (FakeBc `errorsFor` on the probed app): `status: "missing"`, reason starts `probe did not build`;
7. the reuse test failed in the real judgment: `status: "missing"`, reason starts `not evaluable`;
8. two reuse tests, the first asserting through the named target and the second through the accepted alternative (FakeBc script keyed per test procedure): `{ executed: true, effective: true, via: "70010/CalcSurcharge+70012/CalcSurchargeAlt" }`;
9. caught call (the marker never reaches the test message because the call sits in a `[TryFunction]`, but the perturbation fails the test): `{ executed: true, effective: true, via: "70010/CalcSurcharge" }`;
10. caught call whose result is ignored: `{ executed: false, effective: false, via: null }` (the stated lower bound).

Confirm while writing that the FakeBc error text reaches `log.test_messages[].message` (as `deployAndTest` does for real runs); if not, assert on the FakeBc error in the row and state it in the task report.

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement:**

```ts
export const REUSE_MARKER = "CG-REUSE-PROBE";

/** Same length as src: comments and string literals blanked (quotes kept), so indices stay valid. */
export function maskAl(src: string): string {
  return src.replace(/'(?:[^']|'')*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}
/** Quoted identifiers blanked too, for keyword scanning only. */
const maskIdents = (m: string) => m.replace(/"[^"\n]*"/g, (s) => `"${" ".repeat(s.length - 2)}"`);
const norm = (s: string) => s.trim().replace(/;$/, "").replace(/\s+/g, "").toLowerCase();

function bodyRange(m: string, from: number, limit: number): [number, number] | null {
  const re = /\b(begin|case|end)\b/gi;
  re.lastIndex = from;
  let depth = 0;
  let start = -1;
  for (let x = re.exec(m); x !== null && x.index < limit; x = re.exec(m)) {
    const k = x[1]!.toLowerCase();
    if (k === "end") {
      depth--;
      if (depth === 0) return [start, x.index + 3];
      if (depth < 0) return null;
    } else {
      if (depth === 0) {
        if (k !== "begin") return null;
        start = x.index;
      }
      depth++;
    }
  }
  return null;
}

export function locateProcedure(
  src: string,
  t: Pick<ReuseTarget, "codeunit" | "procedure" | "signature">,
): [number, number] | null {
  const m = maskAl(src);
  const k = maskIdents(m);
  const heads = [...k.matchAll(new RegExp(`\\bcodeunit\\s+${t.codeunit}\\b`, "gi"))];
  if (heads.length !== 1) return null;
  const open = k.indexOf("{", heads[0]!.index!);
  if (open < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < k.length && close < 0; i++) {
    if (k[i] === "{") depth++;
    else if (k[i] === "}" && --depth === 0) close = i;
  }
  if (close < 0) return null;
  const body = m.slice(open, close);
  const hits = [...body.matchAll(new RegExp(`\\bprocedure\\s+(?:"${t.procedure}"|${t.procedure})\\s*\\(`, "gi"))];
  if (hits.length !== 1) return null;
  const sig = open + hits[0]!.index! + hits[0]![0].length - 1;
  const kw = /\b(var|begin)\b/gi;
  kw.lastIndex = sig;
  const at = kw.exec(k);
  if (!at || at.index > close) return null;
  if (norm(m.slice(sig, at.index)) !== norm(t.signature)) return null;
  return bodyRange(k, at.index, close);
}

export function stubProcedure(
  src: string,
  t: Pick<ReuseTarget, "codeunit" | "procedure" | "signature">,
  statements: string,
): string | null {
  const r = locateProcedure(src, t);
  return r === null ? null : `${src.slice(0, r[0])}begin\n        ${statements}\n    end${src.slice(r[1])}`;
}

export async function reuseCheck(
  lane: BcLane,
  o: ReuseInput,
): Promise<Measure<{ executed: boolean; effective: boolean; via: string | null }>> {
  const r = o.measures.reuse;
  if (!r) return na("no reuse target");
  const wanted = r.tests.flatMap((x) => x.procedures.map((p) => `${x.codeunit}/${p}`));
  const f2p = o.judgment.scorers.find((s) => s.name === "fail_to_pass");
  const passing = new Set((f2p?.tests ?? []).filter((t) => t.outcome === "pass").map((t) => `${t.codeunit}/${t.procedure}`));
  if (!wanted.every((k) => passing.has(k))) return missing("not evaluable: reuse tests did not pass in the judgment");
  const probeTask: LoadedTask = {
    dir: o.task.dir,
    task: {
      ...o.task.task,
      scorers: ["build", "fail_to_pass"],
      pass_to_pass: [],
      fail_to_pass: { depends_on: o.task.task.fail_to_pass!.depends_on, tests: r.tests },
    },
  };
  /** Per reuse test: failed under this probe, and failed with the marker. */
  type Run = { failed: Set<string>; marker: Set<string> } | { problem: string };
  const probe = async (i: number, kind: string, t: ReuseTarget, body: string): Promise<Run | null> => {
    const art = join(o.workDir, `${kind}-${i}`);
    await safeCopyTree(o.artifact, art);
    let src: string;
    try {
      src = await Deno.readTextFile(join(art, t.file));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    const stubbed = stubProcedure(src, t, body);
    if (stubbed === null) return null;
    await Deno.writeTextFile(join(art, t.file), stubbed);
    const { judgment, log } = await judge(lane, {
      ...o.judge,
      executionId: crypto.randomUUID(),
      task: probeTask,
      artifact: art,
      workDir: join(o.workDir, `${kind}-judge-${i}`),
    });
    if (judgment.verdict === "unscored") return { problem: "infra during a reuse probe" };
    if (judgment.scorers.find((s) => s.name === "build")?.passed !== true) {
      return { problem: `probe did not build (${kind} probe of ${t.codeunit}/${t.procedure})` };
    }
    const rows = judgment.scorers.find((s) => s.name === "fail_to_pass")?.tests ?? [];
    const failed = new Set(wanted.filter((k) => rows.some((x) => `${x.codeunit}/${x.procedure}` === k && x.outcome !== "pass")));
    const marker = new Set([...failed].filter((k) =>
      log.test_messages.some((m) => `${m.codeunit}/${m.procedure}` === k && m.message.includes(REUSE_MARKER))
    ));
    return { failed, marker };
  };
  let located = 0;
  // Per reuse test, the targets that cover it (round 2 finding 5: alternatives may serve different tests).
  const execBy = new Map<string, string[]>();
  const effBy = new Map<string, string[]>();
  const note = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...(m.get(k) ?? []), id]);
  for (const [i, t] of r.targets.entries()) {
    const ex = await probe(i, "executed", t, `Error('${REUSE_MARKER}');`);
    if (ex === null) continue;
    located++;
    if ("problem" in ex) return missing(ex.problem);
    const ef = await probe(i, "effective", t, t.perturb);
    if (ef === null) return missing(`target ${t.codeunit}/${t.procedure} vanished between probes`);
    if ("problem" in ef) return missing(ef.problem);
    const id = `${t.codeunit}/${t.procedure}`;
    for (const k of ex.marker) note(execBy, k, id);
    for (const k of ef.failed) note(effBy, k, id);
  }
  if (located === 0) return missing("no reuse target located in the final workspace");
  const effective = wanted.every((k) => effBy.has(k));
  // A test the perturbation changes ran the target, even if a TryFunction swallowed the marker.
  const executed = wanted.every((k) => execBy.has(k) || effBy.has(k));
  const cover = effective ? effBy : executed ? new Map([...execBy, ...effBy]) : null;
  const via = cover === null ? null : [...new Set(wanted.map((k) => cover.get(k)![0]!))].join("+");
  return ok({ executed, effective, via });
}
```

Imports: `judge`, `type JudgeInput` from `./verdict.ts`; `safeCopyTree` from `./fsutil.ts`. `measures.ts` imports `verdict.ts`, never the reverse.

- [ ] **Step 5: Run** measures, reuse, verdict tests; check/lint/fmt; commit

```bash
git add src/harness/measures.ts tests/unit/harness/measures.test.ts tests/unit/harness/reuse.test.ts
git commit -m "feat(harness): reuse probe separating executed from effective reuse (M11-06)"
```

---

### Task M11-07: `harness measure`, `judge-fixture --measures`, measurement-only fixtures

Lane: lane-infra2. Deps: M11-04..06, H-01.

**Files:**
- Modify: `src/harness/execution.ts` (`measureWorkspace`, `measureExecution` next to `rejudgeExecution`)
- Modify: `src/harness/measures.ts` (`qualifyMeasures`)
- Modify: `src/harness/qualify.ts` (`fixture` list, `variantAllowed` accepts `fixture/<name>`)
- Modify: `cli/commands/harness-command.ts` (`harnessMeasure`, `measure` subcommand, `judge-fixture --measures`, variant regex)
- Test: `tests/unit/harness/measures.test.ts`, `tests/unit/harness/qualify.test.ts` (or the file that tests `variantAllowed`), `tests/unit/cli/commands/harness-command.test.ts`

**Interfaces:**
- Produces: `measureWorkspace(env: HarnessEnv, x: { task: LoadedTask; pristine: string; artifact: string; workspaceHash: string; oracleHash: string; judgment: JudgmentRecord; executionId: string }, run: MeasureRun): Promise<MeasureRecord>` where `MeasureRun = { startCache: Map<string, FinalCounts>; analyzers: Measure<z.output<typeof AnalyzersSchema>> | null }` (the canary result is computed once per run); `measureExecution(env, cell, e, j, run)`; `harnessMeasure(experimentId, o, open?)`; `qualifyMeasures(r, expect): string[]`.
- `QualifyManifestSchema` task entries gain `fixture: z.array(name).default([])`; `variantAllowed` lists `fixture/<n>` too (appendix section 7).
- CLI: `centralgauge harness measure <experiment> --secrets-dir <d> [--campaign <id>] [--execution <id>] [--yes]` measures each counted cell's judgment that has no record for the current `measureFingerprint()`; `harness judge-fixture <task> <variant> --measures` accepts `fixture/<name>` variants (overlay plus `fixture/<name>/` layered as a naive variant is), writes `measures.json` into the fixture output folder and prints `[OK]`/`[FAIL]` per expectation.

- [ ] **Step 1: Failing test for `qualifyMeasures`:**

```ts
Deno.test("qualifyMeasures: exact per-code increases; missing is a failure", async () => {
  const r = {
    v: 1,
    judgment_id: "00000000-0000-4000-8000-0000000000a1",
    execution_id: "00000000-0000-4000-8000-0000000000b1",
    task_id: "HX-101",
    workspace_hash: "a".repeat(64),
    oracle_hash: "b".repeat(64),
    measure_fingerprint: await measureFingerprint(),
    analyzers: { compiler: "c", ruleset_sha256: "e".repeat(64), canary_codes: ["AA0137"] },
    final_code: { status: "ok", value: { errors: 0, warnings: 3, start_errors: 0, start_warnings: 2, new_warnings: 1, new_warning_codes: { AA0137: 1 }, complete: true, incomplete_apps: [] } },
    reuse: { status: "missing", reason: "no reuse target located in the final workspace" },
    partial_credit: { status: "ok", value: { new_requirements: 0.5, hidden_regressions: null, pass_to_pass: 1 } },
  } as const satisfies MeasureRecord;
  assertEquals(qualifyMeasures(r, { partial_credit: 0.5, final_errors: 0, new_warning_codes: ["AA0137"] }), []);
  assertEquals(qualifyMeasures(r, { new_warning_codes: ["AW0006"] }), ["new_warning_codes: expected AW0006 to increase, increased: AA0137"]);
  assertEquals(qualifyMeasures(r, { reuse: false, partial_credit: 1 }), [
    "reuse: expected false, got missing (no reuse target located in the final workspace)",
    "partial_credit: expected 1, got 0.5",
  ]);
});
```

- [ ] **Step 2: Implement `qualifyMeasures`:**

```ts
export function qualifyMeasures(r: MeasureRecord, expect: TaskMeasures["expect"][string]): string[] {
  const out: string[] = [];
  const got = <T>(m: Measure<T>, f: (v: T) => unknown) => m.status === "ok" ? f(m.value) : `${m.status} (${m.reason})`;
  const eq = (name: string, want: unknown, g: unknown) => {
    if (want !== undefined && g !== want) out.push(`${name}: expected ${want}, got ${g}`);
  };
  eq("reuse_executed", expect.reuse_executed, got(r.reuse, (v) => v.executed));
  eq("reuse", expect.reuse, got(r.reuse, (v) => v.effective));
  if (expect.partial_credit !== undefined) {
    const g = got(r.partial_credit, (v) => v.new_requirements);
    if (typeof g !== "number" || Math.abs(g - expect.partial_credit) > 1e-9) {
      out.push(`partial_credit: expected ${expect.partial_credit}, got ${g}`);
    }
  }
  eq("final_errors", expect.final_errors, got(r.final_code, (v) => v.errors));
  if (expect.new_warning_codes !== undefined) {
    const fc = r.final_code;
    if (fc.status !== "ok" || !fc.value.complete) {
      out.push(`new_warning_codes: final-code check ${fc.status === "ok" ? "incomplete" : `${fc.status} (${fc.reason})`}`);
    } else {
      const inc = Object.keys(fc.value.new_warning_codes);
      const lack = expect.new_warning_codes.filter((c) => !inc.includes(c));
      if (lack.length > 0) {
        out.push(`new_warning_codes: expected ${lack.join(",")} to increase, increased: ${inc.join(",") || "none"}`);
      }
    }
  }
  return out;
}
```

- [ ] **Step 3: Implement `measureWorkspace` / `measureExecution`** in `execution.ts`:

```ts
const RULESET = join("analysis", "final-code.ruleset.json");
const CANARY = join("analysis", "canary");

export interface MeasureRun {
  startCache: Map<string, FinalCounts>;
  analyzers: Measure<z.output<typeof AnalyzersSchema>> | null;
}

async function analyzersOf(env: HarnessEnv, run: MeasureRun, workDir: string) {
  if (run.analyzers) return run.analyzers;
  const rulesetFile = join(env.harnessRoot, RULESET);
  const analysis = { codeCop: true, uiCop: true, rulesetFile };
  const expected = (JSON.parse(await Deno.readTextFile(join(env.harnessRoot, CANARY, "expect.json"))) as { codes: string[] }).codes;
  const c = await canaryCheck(env.lane, {
    canaryDir: join(env.harnessRoot, CANARY), lock: { store: env.symbolStore, packages: env.symbols },
    outDir: join(workDir, "canary"), analysis, expected,
  });
  run.analyzers = c.ok
    ? ok({ compiler: c.compiler, ruleset_sha256: await hashFile(env.harnessRoot, rulesetFile), canary_codes: c.codes })
    : missing(`analyzer canary failed: expected ${expected.join(",")}, got ${c.codes.join(",") || "none"}`);
  return run.analyzers;
}

export async function measureWorkspace(
  env: HarnessEnv,
  x: { task: LoadedTask; pristine: string; artifact: string; workspaceHash: string; oracleHash: string; judgment: JudgmentRecord; executionId: string },
  run: MeasureRun,
  workDir: string,
): Promise<MeasureRecord> {
  const measures = await loadTaskMeasures(x.task);
  const lock = { store: env.symbolStore, packages: env.symbols };
  const symbolIds = new Set(env.symbols.map((s) => s.app_id.toLowerCase()));
  const az = await analyzersOf(env, run, workDir);
  const analysis = { codeCop: true, uiCop: true, rulesetFile: join(env.harnessRoot, RULESET) };
  const infraSafe = async <T>(f: () => Promise<Measure<T>>): Promise<Measure<T>> => {
    try {
      return await f();
    } catch (err) {
      if (err instanceof InfraRetriesExhaustedError || err instanceof NoEligibleContainersError || isInfraError(err)) {
        return missing(`infra: ${err instanceof Error ? err.message : String(err)}`);
      }
      throw err;
    }
  };
  const final_code = az.status !== "ok"
    ? missing<FinalCode>(az.status === "missing" ? az.reason : "analyzers unavailable")
    : await infraSafe(async () => {
      const vw = await buildVerdictWorkspace({ pristine: x.pristine, artifact: x.artifact, out: join(workDir, "final"), symbolIds });
      if (vw.violations.length > 0) return missing<FinalCode>(`workspace violations: ${vw.violations.length}`);
      let start = run.startCache.get(x.task.task.id);
      if (!start) {
        start = await finalCodeCounts(env.lane, { dir: x.pristine, apps: await readAppGraph(x.pristine), lock, outDir: join(workDir, "start-build"), analysis });
        run.startCache.set(x.task.task.id, start);
      }
      const end = await finalCodeCounts(env.lane, { dir: vw.dir, apps: vw.apps, lock, outDir: join(workDir, "final-build"), analysis });
      return finalCode(start, end);
    });
  const reuse = !measures
    ? na<z.output<typeof ReuseSchema>>("no measures file")
    : await infraSafe(() =>
      reuseCheck(env.lane, {
        task: x.task,
        measures,
        judgment: x.judgment,
        judge: { workspaceHash: x.workspaceHash, oracleHash: x.oracleHash, pristine: x.pristine, symbolIds, lock, deploy: env.deploy },
        artifact: x.artifact,
        workDir: join(workDir, "reuse"),
      })
    );
  return {
    v: 1,
    judgment_id: x.judgment.id,
    execution_id: x.executionId,
    task_id: x.task.task.id,
    workspace_hash: x.workspaceHash,
    oracle_hash: x.judgment.task_oracle_hash,
    measure_fingerprint: await measureFingerprint(),
    analyzers: az.status === "ok" ? az.value : null,
    final_code,
    reuse,
    partial_credit: partialCredit(x.task.task, measures, x.judgment),
  };
}

/** Exploratory measures of one judged execution (M11); never re-runs the agent, never touches the judgment. */
export async function measureExecution(
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
  j: JudgmentRecord,
  run: MeasureRun,
): Promise<MeasureRecord> {
  const art = await env.store.artifact(e.id);
  if (!art) throw new ValidationError(`no artifact for execution ${e.id}`, [e.id]);
  const out = join(env.privateRoot, "work", `measure-${e.id}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    const pristine = (await stage(env, cell, out)).pristine;
    const rec = await measureWorkspace(env, {
      task: cell.task, pristine, artifact: join(env.resultsRoot, art.stored_path),
      workspaceHash: art.workspace_hash, oracleHash: j.task_oracle_hash, judgment: j, executionId: e.id,
    }, run, join(out, "m"));
    await writeMeasureRecord(env.resultsRoot, rec);
    return rec;
  } finally {
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
}
```

- [ ] **Step 4: `harnessMeasure`** in `harness-command.ts`, the rejudge flow reused: `rejudgeTarget` for the campaign; `loadCampaignData` + `validateCampaignRecords`; `cellsFromRecords(c, data.executions, byExecution)` for each terminal scored cell's `judgment_id` and `used_execution`; skip cells with `readMeasureRecord(resultsDir, judgment_id, await measureFingerprint())`; `loadTaskSet`, `resolveRefapp`, `cellRefFor` as in `harnessRejudge`; confirm with `ask` unless `--yes`; one `MeasureRun` for the whole call; print `[OK] <execution>: final errors X, new warnings Y, reuse executed/effective, partial P`. Register `measure` with the `shared(...)` options plus `--campaign`, `--execution`, `--yes`. `judge-fixture`: the variant regex becomes `VARIANT` from `measures.ts`; with `--measures`, after `judge` call `measureWorkspace` on the fixture's frozen workspace, write `measures.json` into the fixture output folder (never into `results/harness/measures/`), print `qualifyMeasures` for `measures.expect[variant]` (`[WARN] no expectation for <variant>` when absent). `qualify.ts`: task entries gain `fixture: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).default([])`, and `variantAllowed` lists `...t.fixture.map((n) => \`fixture/${n}\`)`.

- [ ] **Step 5: Tests:** `variantAllowed` accepts a listed `fixture/dead-call` and refuses an unlisted one and the withdrawn `measure/dead-call`; CLI test following the existing rejudge test with a fake `Opener` and FakeBc env: two scored cells, one already measured under the current fingerprint; `harnessMeasure(..., { yes: true })` returns `measured: 1` and writes one new file under `measures/<judgment>/`.

- [ ] **Step 6: Run** measures, qualify, harness-command tests; check/lint/fmt; commit

```bash
git add src/harness/execution.ts src/harness/measures.ts src/harness/qualify.ts cli/commands/harness-command.ts tests/unit/harness/measures.test.ts tests/unit/harness/qualify.test.ts tests/unit/cli/commands/harness-command.test.ts
git commit -m "feat(harness): harness measure, judge-fixture --measures, measurement-only fixtures (M11-07)"
```

The freeze archive (`scripts/harness/freeze-archive.ts pack`) walks the whole results root, so `measures/` is archived with the campaign without a change; M12 binds the pre-registration and its simulation outputs with `freeze-archive.ts bind`.

---

### Task M11-08: Experiment schema: contrasts, interaction, pre-registration

Lane: lane-infra. Deps: H-01.

**Files:**
- Modify: `src/harness/config.ts:84-114`
- Test: `tests/unit/harness/config.test.ts`

**Interfaces:**
- Produces: `ContrastSchema`, `InteractionSchema`, `Experiment.contrasts?`, `Experiment.interaction?` (`{ name, status, plain, lsp, realistic, realistic_lsp }`), `Experiment.preregistration?` (relative to `harness/`). The single `primary_metric` stays.

M9's `cc-v2-factorial` experiment adds, after this task merges:

```yaml
contrasts:
  - { id: C1, name: "LSP effect without the realistic setup", baseline: cc-v2-plain, variant: cc-v2-plain-lsp }
  - { id: C2, name: "LSP effect with the realistic setup", baseline: cc-v2-realistic, variant: cc-v2-realistic-lsp }
  - { id: C3, name: "realistic effect without LSP", baseline: cc-v2-plain, variant: cc-v2-realistic }
interaction: { name: "LSP effect differs by realistic level", status: exploratory, plain: cc-v2-plain, lsp: cc-v2-plain-lsp, realistic: cc-v2-realistic, realistic_lsp: cc-v2-realistic-lsp }
preregistration: preregistration/cc-v2-factorial.yml
```

- [ ] **Step 1: Failing tests** (append to `config.test.ts`):

```ts
const v2 = {
  id: "cc-v2-factorial",
  hypothesis: "h",
  primary_metric: "cost_per_solved_task",
  baseline: "cc-v2-plain",
  variants: ["cc-v2-plain-lsp", "cc-v2-realistic", "cc-v2-realistic-lsp"],
  vary: ["lsp"],
  tasks: "harness-tasks/tasks/*",
  repeats: 5,
  contrasts: [
    { id: "C1", name: "LSP effect without the realistic setup", baseline: "cc-v2-plain", variant: "cc-v2-plain-lsp" },
    { id: "C2", name: "LSP effect with the realistic setup", baseline: "cc-v2-realistic", variant: "cc-v2-realistic-lsp" },
    { id: "C3", name: "realistic effect without LSP", baseline: "cc-v2-plain", variant: "cc-v2-realistic" },
  ],
  interaction: { name: "i", status: "exploratory", plain: "cc-v2-plain", lsp: "cc-v2-plain-lsp", realistic: "cc-v2-realistic", realistic_lsp: "cc-v2-realistic-lsp" },
  preregistration: "preregistration/cc-v2-factorial.yml",
};

Deno.test("ExperimentSchema (M11): a v1 experiment parses without the new keys", async () => {
  const v1 = await readYaml("harness/experiments/cc-mcp-vs-plain.yml", ExperimentSchema);
  assertEquals(["contrasts", "interaction", "preregistration"].some((k) => k in v1), false);
});

Deno.test("ExperimentSchema (M11): contrasts name declared arms, unique ids, need a preregistration", () => {
  assertEquals(ExperimentSchema.parse(v2).contrasts!.length, 3);
  const bad = (o: object, msg: string) =>
    assertStringIncludes(ExperimentSchema.safeParse({ ...v2, ...o }).error!.message, msg);
  bad({ contrasts: [{ ...v2.contrasts[0], variant: "cc-nope" }] }, "not an arm");
  bad({ contrasts: [v2.contrasts[0], v2.contrasts[0]] }, "duplicate contrast");
  bad({ contrasts: [{ ...v2.contrasts[0], variant: "cc-v2-plain" }] }, "differ");
  bad({ preregistration: undefined }, "preregistration");
  bad({ contrasts: undefined }, "interaction needs contrasts");
  bad({ interaction: { ...v2.interaction, lsp: "cc-nope" } }, "not an arm");
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** in `config.ts`:

```ts
export const ContrastSchema = z.strictObject({
  id: z.string().regex(/^C\d+$/, "C1, C2, ..."),
  name: z.string().trim().min(1),
  baseline: slug,
  variant: slug,
});
export const InteractionSchema = z.strictObject({
  name: z.string().trim().min(1),
  /** Must equal the pre-registration (checked by the report and the campaign). */
  status: z.enum(["exploratory", "confirmatory"]),
  plain: slug,
  lsp: slug,
  realistic: slug,
  realistic_lsp: slug,
});
```

`ExperimentSchema` gains (optional, never `.default`, so v1 parsed objects and hashes are unchanged):

```ts
  contrasts: z.array(ContrastSchema).min(1).optional(),
  interaction: InteractionSchema.optional(),
  preregistration: relPath.optional(),
```

and `superRefine` gains:

```ts
  const armSet = new Set(arms);
  const notArm = (a: string, path: (string | number)[]) =>
    !armSet.has(a) && ctx.addIssue({ code: "custom", message: `${a} is not an arm of this experiment`, path });
  e.contrasts?.forEach((c, i) => {
    notArm(c.baseline, ["contrasts", i, "baseline"]);
    notArm(c.variant, ["contrasts", i, "variant"]);
    if (c.baseline === c.variant) {
      ctx.addIssue({ code: "custom", message: "contrast arms must differ", path: ["contrasts", i] });
    }
  });
  const ids = (e.contrasts ?? []).map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "duplicate contrast id", path: ["contrasts"] });
  }
  if (e.contrasts && !e.preregistration) {
    ctx.addIssue({ code: "custom", message: "contrasts need a preregistration file", path: ["preregistration"] });
  }
  if (e.interaction && !e.contrasts) {
    ctx.addIssue({ code: "custom", message: "interaction needs contrasts", path: ["interaction"] });
  }
  if (e.interaction) {
    for (const k of ["plain", "lsp", "realistic", "realistic_lsp"] as const) notArm(e.interaction[k], ["interaction", k]);
  }
```

- [ ] **Step 4: Run** config, campaign, records tests; check/lint/fmt; commit

```bash
git add src/harness/config.ts tests/unit/harness/config.test.ts
git commit -m "feat(harness): experiment contrasts, interaction and preregistration keys (M11-08)"
```

---

### Task M11-09: Contrast statistics

Lane: lane-infra. Deps: H-01.

Inference contract (stage A copies it):
- Per contrast: two-sided test of delta = 0, delta = variant minus baseline cost per solved task over matched (task, repeat) pairs eligible in both arms (v1 rule 2). Interaction: (RL - R) - (L - P) over blocks eligible in all four arms.
- p-value: percentile bootstrap with the +1 correction over the defined resamples, `p = min(1, 2 * min(#{d <= 0} + 1, #{d >= 0} + 1) / (n + 1))`. This is an approximate test; its calibration is not assumed but checked: stage A's design rule requires family-wise error under the null and partial-null scenarios within alpha + 2 Monte Carlo SE at the chosen design (M11-13). If that fails no design is accepted and the owner decides.
- Holm over exactly the pre-registered `family`, in its order (ties keep family order). A suppressed contrast (zero-solve rule) has p = null: ranks as 1, never rejects, decides `no_decision`.
- Direction: a rejection decides `variant_lower` (delta < 0) or `variant_higher`; else `no_decision`.
- Intervals: the 95% percentile interval is per contrast and unadjusted (descriptive); beside it a Bonferroni interval at 1 - alpha/m from the same draws. Decisions come from Holm only. With finite resamples the interpolated Bonferroni interval and the +1-corrected Holm test can disagree in either direction at the boundary (an interval excluding 0 beside `no_decision` is possible); the report shows both as is and names Holm as the sole decision rule (ruling 2026-10-03, M11-09).
- Zero-solve rule: `suppress_any_undefined` (v1) or `min_defined_share` (p and interval over the defined resamples, only when their share is at least the frozen threshold); chosen by M11-15 in stage A.

**Files:**
- Modify: `src/harness/stats.ts`
- Test: `tests/unit/harness/stats.test.ts` (append)

**Interfaces:**
- Produces: `ZeroSolveRule`, `BootstrapOptions.zeroSolve?`, `drawTasks`, `bootstrapP`, `holm`, `Decision`, `decide`, `Comparison.p_value?`, `Comparison.values?`, `Comparison.zero_solve?`, `InteractionArms`, `compareInteraction`, `ContrastSpec`, `ContrastResult`, `testContrasts(cells, contrasts, interaction, metric, o)` with `o.family: readonly string[]`.

- [ ] **Step 1: Failing tests** (append to `stats.test.ts`, reusing its `cells` helper):

```ts
import { bootstrapP, compareInteraction, decide, holm, testContrasts } from "../../../src/harness/stats.ts";

Deno.test("bootstrapP: +1 corrected two-sided percentile p", () => {
  assertAlmostEquals(bootstrapP([-1, -2, -3, -4]), 2 / 5, 1e-12);
  assertEquals(bootstrapP([-1, 1]), 1);
  assertEquals(bootstrapP([]), 1);
});

Deno.test("holm: step-down adjusted p; null never rejects and ranks as 1; ties keep order", () => {
  const h = holm([0.01, 0.04, 0.03], 0.05);
  assertEquals(h.adjusted.map((x) => +x.toFixed(4)), [0.03, 0.06, 0.06]);
  assertEquals(h.reject, [true, false, false]);
  const n = holm([null, 0.001, 0.001], 0.05);
  assertEquals([n.reject, n.adjusted[0]], [[false, true, true], 1]);
});

Deno.test("decide: direction only on a rejection", () => {
  assertEquals(decide(-0.2, true), "variant_lower");
  assertEquals(decide(0.2, true), "variant_higher");
  assertEquals(decide(-0.2, false), "no_decision");
  assertEquals(decide(null, true), "no_decision");
});

Deno.test("compareArms: p_value and values; v1 suppression keeps p null; min_defined_share allows it", () => {
  const cs = [
    ...cells("A", "t1", [[true, 2], [true, 2]]),
    ...cells("A", "t2", [[true, 3], [false, 3]]),
    ...cells("B", "t1", [[true, 1], [true, 1]]),
    ...cells("B", "t2", [[true, 1], [true, 1]]),
  ];
  const c = compareArms(cs, "A", "B", "cost_per_solved_task", { resamples: 400, seed: 3 });
  assert(c.p_value! > 0 && c.p_value! <= 1);
  assertEquals(c.values!.variant, 1);
  const z = [
    ...cells("A", "t1", [[false, 2]]),
    ...cells("A", "t2", [[true, 2]]),
    ...cells("B", "t1", [[true, 1]]),
    ...cells("B", "t2", [[true, 1]]),
  ];
  const s = compareArms(z, "A", "B", "cost_per_solved_task", { resamples: 400, seed: 3 });
  assertEquals([s.ci, s.p_value], [null, null]);
  const share = compareArms(z, "A", "B", "cost_per_solved_task", {
    resamples: 400, seed: 3, zeroSolve: { rule: "min_defined_share", share: 0.5 },
  });
  assert(share.undefined_share > 0 && share.undefined_share < 0.5);
  assert(share.ci !== null && share.p_value !== null);
});

Deno.test("compareInteraction: (RL - R) - (L - P) over blocks eligible in all four arms", () => {
  const cs = [
    ...cells("P", "t1", [[true, 4], [true, 4]]),
    ...cells("L", "t1", [[true, 2], [true, 2]]),
    ...cells("R", "t1", [[true, 4], [true, 4]]),
    ...cells("RL", "t1", [[true, 4], ["pending", null]]),
  ];
  const c = compareInteraction(cs, { plain: "P", lsp: "L", realistic: "R", realistic_lsp: "RL" }, "cost_per_solved_task", { resamples: 50 });
  assertEquals([c.pairs, c.delta], [1, 2]);
});

const factorial = () => {
  const arm = (a: string, spend: number) =>
    ["t1", "t2", "t3", "t4", "t5", "t6"].flatMap((t, i) => cells(a, t, [[true, spend + i / 10], [true, spend + i / 10]]));
  return [...arm("P", 2), ...arm("L", 1), ...arm("R", 2), ...arm("RL", 2)];
};
const SPECS = [
  { id: "C1", name: "c1", baseline: "P", variant: "L" },
  { id: "C2", name: "c2", baseline: "R", variant: "RL" },
  { id: "C3", name: "c3", baseline: "P", variant: "R" },
];
const INTER = { name: "i", plain: "P", lsp: "L", realistic: "R", realistic_lsp: "RL" };
const O = { resamples: 999, seed: 7, level: 0.95, alpha: 0.05, zeroSolve: { rule: "suppress_any_undefined" as const } };

Deno.test("testContrasts: Holm over the given family only; interaction outside it is exploratory", () => {
  const r = testContrasts(factorial(), SPECS, INTER, "cost_per_solved_task", { ...O, family: ["C1", "C2", "C3"] });
  assertEquals(r.map((x) => [x.id, x.confirmatory, x.decision]), [
    ["C1", true, "variant_lower"],
    ["C2", true, "no_decision"],
    ["C3", true, "no_decision"],
    ["interaction", false, "no_decision"],
  ]);
  assertEquals(r[3]!.p_holm, null);
  assert(r[0]!.bonferroni_ci![1] < 0);
  assertAlmostEquals(r[0]!.ratio!, r[0]!.values!.variant! / r[0]!.values!.baseline!, 1e-12);
});

Deno.test("testContrasts: a confirmatory interaction joins Holm (m = 4)", () => {
  const r = testContrasts(factorial(), SPECS, INTER, "cost_per_solved_task", { ...O, family: ["C1", "C2", "C3", "interaction"] });
  assertEquals(r[3]!.confirmatory, true);
  assertAlmostEquals(r[0]!.p_holm!, Math.min(1, 4 * r[0]!.p_value!), 1e-12);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** in `stats.ts`:

```ts
export type ZeroSolveRule =
  | { rule: "suppress_any_undefined" }
  | { rule: "min_defined_share"; share: number };

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
  level?: number;
  /** Default suppress_any_undefined (v1 rule 4). */
  zeroSolve?: ZeroSolveRule;
}

/** The resample loop (one mulberry32 stream per seed): the same draws as v1 compareArms. */
export function drawTasks(
  tasks: string[],
  resamples: number,
  seed: number,
  f: (sample: string[]) => number | null,
): { values: number[]; undefined_share: number } {
  const rand = mulberry32(seed);
  const values: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const d = f(tasks.map(() => tasks[Math.floor(rand() * tasks.length)]!));
    if (d !== null) values.push(d);
  }
  return { values, undefined_share: (resamples - values.length) / resamples };
}

export function bootstrapP(deltas: readonly number[]): number {
  const n = deltas.length;
  if (n === 0) return 1;
  const le = deltas.filter((d) => d <= 0).length;
  const ge = deltas.filter((d) => d >= 0).length;
  return Math.min(1, (2 * Math.min(le + 1, ge + 1)) / (n + 1));
}

export function holm(ps: readonly (number | null)[], alpha: number): { adjusted: number[]; reject: boolean[] } {
  const m = ps.length;
  const order = ps.map((p, i) => ({ p: p ?? 1, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const adjusted = new Array<number>(m);
  let run = 0;
  order.forEach(({ p, i }, k) => {
    run = Math.max(run, Math.min(1, (m - k) * p));
    adjusted[i] = run;
  });
  return { adjusted, reject: adjusted.map((a, i) => ps[i] !== null && a <= alpha) };
}

export type Decision = "variant_lower" | "variant_higher" | "no_decision";
export function decide(delta: number | null, rejected: boolean): Decision {
  if (!rejected || delta === null || delta === 0) return "no_decision";
  return delta < 0 ? "variant_lower" : "variant_higher";
}

function allowed(rule: ZeroSolveRule, undefinedShare: number): boolean {
  return rule.rule === "suppress_any_undefined" ? undefinedShare === 0 : 1 - undefinedShare >= rule.share;
}
```

`checkBootstrapOptions` adds: `if (opts.zeroSolve?.rule === "min_defined_share" && !(opts.zeroSolve.share > 0 && opts.zeroSolve.share <= 1)) errors.push(\`zeroSolve.share must be in (0, 1], got ${opts.zeroSolve.share}\`);`.

`Comparison` gains `p_value?: number | null;` (null when suppressed; absent in pre-M11 reports), `values?: { baseline: number | null; variant: number | null };`, `zero_solve?: ZeroSolveRule;`.

Refactor `compareArms`: `drawTasks(tasks, resamples, seed, delta)` replaces the inline loop, and the tail moves to

```ts
function finish(
  base: Omit<Comparison, "delta" | "ci" | "undefined_share" | "distinguishable" | "exploratory_ci_defined_only">,
  point: number | null,
  draws: { values: number[]; undefined_share: number },
  level: number,
  rule: ZeroSolveRule,
): Comparison {
  const deltas = draws.values;
  const alpha = (1 - level) / 2;
  const defined: [number, number] | null = deltas.length === 0
    ? null
    : [percentile(deltas, alpha), percentile(deltas, 1 - alpha)];
  const ci = allowed(rule, draws.undefined_share) ? defined : null;
  return {
    ...base,
    delta: point,
    ci,
    undefined_share: draws.undefined_share,
    distinguishable: ci === null ? null : !(ci[0] <= 0 && 0 <= ci[1]),
    p_value: ci === null ? null : bootstrapP(deltas),
    zero_solve: rule,
    exploratory_ci_defined_only: defined === null || deltas.length < minDefinedResamples(level)
      ? null
      : { lo: defined[0], hi: defined[1], level, resamples_used: deltas.length, undefined_share: draws.undefined_share },
  };
}
```

`compareArms` adds `values: { baseline: statistic(metric, tasks.map((t) => sb.get(t)!)), variant: statistic(metric, tasks.map((t) => sv.get(t)!)) }` to `base` (both null when there are no tasks) and `p_value: null` to the zero-task return. Every pre-existing stats/report test must pass unchanged.

```ts
export interface InteractionArms {
  plain: string;
  lsp: string;
  realistic: string;
  realistic_lsp: string;
}

/** (RL - R) - (L - P) over (task, repeat) blocks eligible in all four arms; incomplete blocks under excluded.baseline.missing. */
export function compareInteraction(
  cells: Cell[],
  a: InteractionArms,
  metric: PrimaryMetric,
  opts: BootstrapOptions = {},
): Comparison {
  checkCells(cells);
  checkBootstrapOptions(opts);
  const resamples = opts.resamples ?? 2000;
  const seed = opts.seed ?? 1;
  const level = opts.level ?? 0.95;
  const names = [a.plain, a.lsp, a.realistic, a.realistic_lsp];
  const byArm = names.map((n) => new Map(cells.filter((c) => c.arm === n).map((c) => [key(c.task, c.repeat), c])));
  const keys = new Set(byArm.flatMap((m) => [...m.keys()]));
  const kept: Cell[][] = names.map(() => []);
  let pairs = 0;
  for (const k of keys) {
    const cs = byArm.map((m) => m.get(k));
    if (cs.every((c) => c !== undefined && ineligible(c, metric) === null)) {
      cs.forEach((c, i) => kept[i]!.push(c!));
      pairs++;
    }
  }
  const stats = kept.map((cs) => taskStats(cs, metric));
  const tasks = [...stats[0]!.keys()].sort();
  const f = (sample: string[]): number | null => {
    const s = stats.map((m) => statistic(metric, sample.map((t) => m.get(t)!)));
    if (s.some((x) => x === null)) return null;
    const [p, l, r, rl] = s as number[];
    return (rl! - r!) - (l! - p!);
  };
  const allTasks = new Set(cells.filter((c) => names.includes(c.arm)).map((c) => c.task));
  const base = {
    metric,
    baseline: a.plain,
    variant: a.realistic_lsp,
    pairs,
    tasks: tasks.length,
    tasks_dropped: allTasks.size - tasks.length,
    excluded: { baseline: { missing: keys.size - pairs }, variant: {} },
    level,
    resamples,
    seed,
    provisional: cells.some((c) => names.includes(c.arm) && (c.status === "pending" || c.status === "unrun")),
    values: { baseline: null, variant: null },
  };
  if (tasks.length === 0) {
    return { ...base, delta: null, ci: null, undefined_share: 1, distinguishable: null, p_value: null, exploratory_ci_defined_only: null };
  }
  return finish(base, f(tasks), drawTasks(tasks, resamples, seed, f), level, opts.zeroSolve ?? { rule: "suppress_any_undefined" });
}

export interface ContrastSpec {
  id: string;
  name: string;
  baseline: string;
  variant: string;
}
export interface ContrastResult extends Comparison {
  id: string;
  name: string;
  confirmatory: boolean;
  p_holm: number | null;
  decision: Decision;
  bonferroni_ci: [number, number] | null;
  ratio: number | null;
}

/** Holm over exactly `family` (ids in pre-registered order, "interaction" for the interaction). */
export function testContrasts(
  cells: Cell[],
  contrasts: ContrastSpec[],
  interaction: (InteractionArms & { name: string }) | null,
  metric: PrimaryMetric,
  o: { resamples: number; seed: number; level: number; alpha: number; zeroSolve: ZeroSolveRule; family: readonly string[] },
): ContrastResult[] {
  const boot = { resamples: o.resamples, seed: o.seed, zeroSolve: o.zeroSolve };
  const rows: { id: string; name: string; run: (level: number) => Comparison }[] = contrasts.map((c) => ({
    id: c.id,
    name: c.name,
    run: (level) => compareArms(cells, c.baseline, c.variant, metric, { ...boot, level }),
  }));
  if (interaction) {
    rows.push({
      id: "interaction",
      name: interaction.name,
      run: (level) => compareInteraction(cells, interaction, metric, { ...boot, level }),
    });
  }
  const missingIds = o.family.filter((id) => !rows.some((r) => r.id === id));
  if (missingIds.length > 0 || new Set(o.family).size !== o.family.length) {
    const msg = `family ${o.family.join(",")} does not match the contrasts (${rows.map((r) => r.id).join(",")})`;
    throw new ValidationError(msg, [msg]);
  }
  const results = new Map(rows.map((r) => [r.id, r.run(o.level)]));
  const h = holm(o.family.map((id) => results.get(id)!.p_value ?? null), o.alpha);
  const bonf = 1 - o.alpha / o.family.length;
  return rows.map((r) => {
    const c = results.get(r.id)!;
    const v = c.values;
    const ratio = v && v.baseline !== null && v.variant !== null && v.baseline !== 0 ? v.variant / v.baseline : null;
    const j = o.family.indexOf(r.id);
    if (j < 0) {
      return { ...c, id: r.id, name: r.name, confirmatory: false, p_holm: null, decision: "no_decision" as const, bonferroni_ci: null, ratio };
    }
    return {
      ...c,
      id: r.id,
      name: r.name,
      confirmatory: true,
      p_holm: c.p_value == null ? null : h.adjusted[j]!,
      decision: decide(c.delta, h.reject[j]!),
      bonferroni_ci: c.ci === null ? null : r.run(bonf).ci,
      ratio,
    };
  });
}
```

- [ ] **Step 4: Run** stats, report, report-extras, report-charts tests (no edited assertion); check/lint/fmt; commit

```bash
git add src/harness/stats.ts tests/unit/harness/stats.test.ts
git commit -m "feat(harness): bootstrap p-values, Holm over a declared family, zero-solve rule, interaction (M11-09)"
```

---

### Task M11-10: Two-stage pre-registration: schema, ancestry, verification, campaign binding

Lane: lane-infra. Deps: M11-08, M11-09, M8-02 (selection JSON shape), H-01.

Format (answers brief item f; ruling 5, owner approved 2026-10-03):
- File `harness/preregistration/<experiment>.yml`, referenced by the experiment's `preregistration`. One schema, two stages.
- Stage A (before screening, AFTER M8's start seal `harness-v2-screen-start` and held-out designation, M8-15a; appendix section 11): the protocol (arm ids, contrasts, interaction), inference contract, zero-solve rule, measures identities, held-out count, M8's designation rule, the seal and the four held-out ids from M8-15a, simulation script hashes and arguments, the design rule, the stage-A approval. Stage-B keys are empty. Its identity is `protocolSha(doc) = hashJson(stageAOf(doc))`. At approval the orchestrator commits the file, creates the annotated tag `harness-v2-prereg-a` whose message contains the line `protocol_sha256: <hex>`, and writes the decision file `H:\cg-coord\decisions\<date>-harness-v2-prereg-a.md` (planned `2026-10-24-...`) with the lines `protocol_sha256:`, `file_sha256:`, `tag: harness-v2-prereg-a`, `tag_object: <git rev-parse harness-v2-prereg-a>` and the owner's `OWNER-APPROVED:` line (appendix section 10).
- Stage B (after the pilot, before the first confirmatory cell): adds only `stage_a`, `experiment_hash`, `selection`, `design`, `power_simulation`, `compiler_identity`, `stage_b_approval`, `amendments`. Ancestry (round 2 finding 1): `stageAOf(b)` (stage-B keys emptied, amendments reverted) must hash to `b.stage_a.sha256` AND to the approved protocol sha, which is read from OUTSIDE the editable document: the decision file's `protocol_sha256` (and its `tag_object` must still be what `harness-v2-prereg-a` resolves to), and the stage-A file committed at that tag must hash to the same value. Editing the document and its `stage_a.sha256` together therefore fails.
- Stage-B external anchor (round 3 finding 1): the approval text inside the document (`stage_b_approval`, `amendments[].approval`) is descriptive only and never authorizes anything. At stage-B approval the orchestrator commits the file, creates the annotated tag `harness-v2-prereg-b` (message line `stage_b_sha256: <hex>`), and writes `H:\cg-coord\decisions\<date>-harness-v2-prereg-b.md` with the lines `stage_b_sha256: <sha256 of the yml bytes>`, `tag: harness-v2-prereg-b`, `tag_object: <git rev-parse harness-v2-prereg-b>`, one `amendment: <key>` line per owner-approved amendment (none when there is none) and the owner's `OWNER-APPROVED:` line. The sha256 of that decision file is recorded in the campaign record at creation (`stage_b_decision_sha256`).
- Amendment policy: an amendment is allowed only after an owner decision, only for keys `design` (the frozen rule found no design), `family` (drop a contrast) or `confirmatory` (downgrade to exploratory); each records `from`, `to` and reason; it is AUTHORIZED only when its key is listed as an `amendment:` line in the stage-B decision file AND the document bytes equal the externally approved stage-B bytes. The report prints every amendment in its header as "pre-registration amended after screening". An amendment never makes the protocol "before screening" retroactively.
- Verification (campaign creation and report; both CLIs take `--prereg-decision <stage-A decision>` and `--prereg-b-decision <stage-B decision>`, both required when the experiment has `preregistration`): the stage-A anchor (decision file, tag object, stage-A file at the tag); the stage-B anchor (decision file parses, `harness-v2-prereg-b` resolves to its `tag_object`, the file bytes at the tag AND the current file bytes both hash to `stage_b_sha256`, every amendment key in the document is listed in the decision file); ancestry; held-out ids equal stage A's `held_out.tasks`; protocol equals the experiment (arms, contrasts, interaction incl. status); family vs protocol; `experiment_hash`; design vs experiment repeats; selection file sha, status ok, `selection.selected` count = design tasks, campaign task set = selected + held-out, held-out count = stage-A count; simulation output sha, its recorded zero-solve rule and script hashes equal the frozen ones, its decision equals `design` unless a `design` amendment is externally authorized. Initial campaign creation therefore binds to the externally approved stage-B bytes.

**Files:**
- Create: `src/harness/prereg.ts`
- Modify: `src/harness/records.ts:342-445` (`preregistration?` + refine), `src/harness/campaign.ts:~555-610`, `cli/commands/harness-command.ts` (`harness run --prereg-decision <path> --prereg-b-decision <path>`)
- Test: `tests/unit/harness/prereg.test.ts`, `tests/unit/harness/campaign.test.ts` (append)

**Interfaces:**
- Produces: `PreregSchema`, `Prereg`, `STAGE_B_KEYS`, `STAGE_A_TAG = "harness-v2-prereg-a"`, `stageAOf(doc)`, `protocolSha(doc): Promise<string>`, `familyProblems(doc, experiment): string[]`, `StageAAnchor = { approved_protocol_sha256: string; tag_protocol_sha256: string | null; tag_moved: boolean }`, `parseStageADecision(text): { protocol_sha256; tag; tag_object } | null`, `loadStageAAnchor(repoRoot, harnessRoot, rel, decisionPath): Promise<{ anchor: StageAAnchor; decision_sha256: string }>`, `STAGE_B_TAG = "harness-v2-prereg-b"`, `StageBAnchor = { approved_sha256: string; file_sha256: string; tag_file_sha256: string | null; tag_moved: boolean; approved_amendments: string[] }`, `parseStageBDecision(text): { stage_b_sha256; tag; tag_object; amendments: string[] } | null`, `loadStageBAnchor(repoRoot, harnessRoot, rel, decisionPath): Promise<{ anchor: StageBAnchor; decision_sha256: string }>`, `PreregContext` (gains `anchor` and `stageB: StageBAnchor | null`), `preregProblems(doc, ctx): Promise<string[]>`, `verifyPrereg(repoRoot, harnessRoot, experiment, experimentHash, taskIds, decisionPath, stageBDecisionPath): Promise<{ doc; sha256; protocol_sha256; decision_sha256; stage_b_decision_sha256; problems: string[] }>`, `CampaignRecord.preregistration?: { path: string; sha256: string; protocol_sha256: string; decision_sha256: string; stage_b_decision_sha256: string }`; CLI options `--prereg-decision <path>` and `--prereg-b-decision <path>` on `harness run` and `harness report`.

- [ ] **Step 1: Failing tests** `tests/unit/harness/prereg.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { stringify } from "@std/yaml";
import { ExperimentSchema } from "../../../src/harness/config.ts";
import {
  familyProblems, loadStageAAnchor, parseStageADecision, parseStageBDecision, preregProblems, PreregSchema, protocolSha, stageAOf,
} from "../../../src/harness/prereg.ts";

const H = (c: string) => c.repeat(64);
const PROTOCOL = {
  arms: ["cc-v2-plain", "cc-v2-plain-lsp", "cc-v2-realistic", "cc-v2-realistic-lsp"],
  contrasts: [
    { id: "C1", name: "LSP effect without the realistic setup", baseline: "cc-v2-plain", variant: "cc-v2-plain-lsp" },
    { id: "C2", name: "LSP effect with the realistic setup", baseline: "cc-v2-realistic", variant: "cc-v2-realistic-lsp" },
    { id: "C3", name: "realistic effect without LSP", baseline: "cc-v2-plain", variant: "cc-v2-realistic" },
  ],
  interaction: { name: "i", status: "exploratory", plain: "cc-v2-plain", lsp: "cc-v2-plain-lsp", realistic: "cc-v2-realistic", realistic_lsp: "cc-v2-realistic-lsp" },
};
export const STAGE_A = {
  v: 1,
  experiment: "cc-v2-factorial",
  protocol: PROTOCOL,
  approval: "OWNER-APPROVED: stage A (2026-10-21T12:00:00Z)",
  population: "Frozen v2 task set: BC/AL tasks of the stated kinds and coupling styles on refapp-v2, selected by the screening pilot.",
  primary_metric: "cost_per_solved_task",
  confirmatory: true,
  family: ["C1", "C2", "C3"],
  alpha: 0.05,
  test: { sides: "two", p_value: "percentile_bootstrap_plus_one", adjustment: "holm", direction: "sign_of_delta" },
  intervals: { reported: "per_contrast_unadjusted", beside: "bonferroni_same_draws" },
  bootstrap: { unit: "task", resamples: 10000, seed: 20261021, level: 0.95 },
  zero_solve: { rule: "suppress_any_undefined" },
  missing_pairs: "per_contrast_matched",
  held_out: {
    count: 4,
    rule: "M8 pickHeldOut at harness-v2-screen-start: first-ranked set per kind with 2 large tasks and every required coupling style",
    seal: "harness-v2-screen-start",
    tasks: ["HX-050", "HX-051", "HX-052", "HX-053"],
    in_family: false,
  },
  measures: {
    fingerprint: H("f"),
    unknown_symbol_codes: ["AL0118", "AL0132", "AL0185"],
    ruleset_sha256: H("r"),
    canary_codes: ["AA0137"],
    workflow_execution: "used_execution",
    effort_execution: "every_attempt",
  },
  exploratory_metrics: ["pass_rate", "tokens_out"],
  simulation: {
    script_sha256: H("1"),
    args: { sims: 1000, resamples: 1000, confirm_sims: 500, confirm_resamples: 10000, seed: 20261003, pool_factor: 2, rule_b_share: 0.99 },
  },
  design_rule: "smallest tasks x repeats meeting power, error-control, suppression and coverage gates under the frozen rule (M11-13 chooseDesign), confirmed at 10000 resamples",
  stage_a: null,
  experiment_hash: null,
  selection: null,
  design: null,
  power_simulation: null,
  compiler_identity: null,
  stage_b_approval: null,
  amendments: [],
};
const stageB = async (o: Record<string, unknown> = {}) => {
  const a = PreregSchema.parse(STAGE_A);
  return PreregSchema.parse({
    ...STAGE_A,
    stage_a: { sha256: await protocolSha(a) },
    experiment_hash: H("e"),
    selection: { path: "harness-tasks/v2/selection.json", sha256: H("s"), selected: ["HX-007", "HX-008"], held_out: ["HX-050", "HX-051", "HX-052", "HX-053"] },
    design: { tasks: 2, repeats: 5 },
    power_simulation: { inputs: [{ path: "x.json", sha256: H("2") }], output: { path: "harness/preregistration/cc-v2-factorial.sim-b.json", sha256: H("3") } },
    compiler_identity: "artifact|bccontainerhelper 6.1.14",
    stage_b_approval: "OWNER-APPROVED: stage B (2026-10-29T12:00:00Z)",
    ...o,
  });
};
const EXP = ExperimentSchema.parse({
  id: "cc-v2-factorial", hypothesis: "h", primary_metric: "cost_per_solved_task",
  baseline: "cc-v2-plain", variants: ["cc-v2-plain-lsp", "cc-v2-realistic", "cc-v2-realistic-lsp"],
  vary: ["lsp"], tasks: "harness-tasks/tasks/*", repeats: 5,
  contrasts: PROTOCOL.contrasts, interaction: PROTOCOL.interaction, preregistration: "preregistration/cc-v2-factorial.yml",
});
const APPROVED = await protocolSha(PreregSchema.parse(STAGE_A));
const ctx = (o: object = {}) => ({
  experiment: EXP,
  experimentHash: H("e"),
  taskIds: ["HX-007", "HX-008", "HX-050", "HX-051", "HX-052", "HX-053"],
  selection: { sha256: H("s"), json: { status: "ok", held_out: ["HX-050", "HX-051", "HX-052", "HX-053"], selection: { n: 2, selected: ["HX-007", "HX-008"] } } },
  simulation: { sha256: H("3"), json: { script_sha256: H("1"), args: STAGE_A.simulation.args, zero_solve: { rule: "suppress_any_undefined" }, decision: { design: { tasks: 2, repeats: 5 } } } },
  // Read from the decision file and the tag (outside the document): what the owner approved.
  anchor: { approved_protocol_sha256: APPROVED, tag_protocol_sha256: APPROVED, tag_moved: false },
  // Read from the stage-B decision file and harness-v2-prereg-b (round 3 finding 1).
  stageB: { approved_sha256: H("b"), file_sha256: H("b"), tag_file_sha256: H("b"), tag_moved: false, approved_amendments: [] as string[] },
  ...o,
});
const SB = ctx().stageB;

Deno.test("stage A has no stage-B values; its identity is its own projection", async () => {
  const a = PreregSchema.parse(STAGE_A);
  assertEquals(await protocolSha(stageAOf(a)), await protocolSha(a));
  assertEquals(PreregSchema.safeParse({ ...STAGE_A, approval: "ok" }).success, false);
  assertEquals(PreregSchema.safeParse({ ...STAGE_A, extra: 1 }).success, false);
});

Deno.test("preregProblems: a clean stage B passes; stage A is not campaign-ready", async () => {
  assertEquals(await preregProblems(await stageB(), ctx()), []);
  assert((await preregProblems(PreregSchema.parse(STAGE_A), ctx())).includes("stage B is not frozen: stage_a"));
});

Deno.test("preregProblems: ancestry, design, selection, task set and simulation are each checked", async () => {
  const has = async (b: Promise<Parameters<typeof preregProblems>[0]>, c: object, msg: string) =>
    assert((await preregProblems(await b, ctx(c))).some((p) => p.includes(msg)), msg);
  await has(stageB({ alpha: 0.1 }), {}, "does not descend from stage A");
  await has(stageB({ design: { tasks: 3, repeats: 5 } }), {}, "design tasks 3");
  await has(stageB(), { taskIds: ["HX-007", "HX-008"] }, "campaign task set");
  await has(stageB(), { experimentHash: H("x") }, "experiment_hash");
  await has(stageB(), { simulation: { ...ctx().simulation, json: { ...ctx().simulation.json, zero_solve: { rule: "min_defined_share", share: 0.99 } } } }, "zero-solve rule");
  await has(stageB(), { simulation: { ...ctx().simulation, json: { ...ctx().simulation.json, decision: { design: null } } } }, "simulation decision");
  await has(stageB(), { selection: { ...ctx().selection, sha256: H("z") } }, "selection");
});

Deno.test("anchor: editing the document AND its stage_a.sha256 after approval is refused (round 2 finding 1)", async () => {
  // Self-consistent forgery: alpha changed and stage_a recomputed from the edited document.
  const edited = PreregSchema.parse({ ...STAGE_A, alpha: 0.1 });
  const forged = await stageB({ alpha: 0.1, stage_a: { sha256: await protocolSha(edited) } });
  const p = await preregProblems(forged, ctx());
  assert(!p.some((x) => x.includes("projection hash differs")), "the forgery is internally consistent");
  assert(p.some((x) => x.includes("differs from the approved stage A")), p.join("\n"));
  // The tag moved to an edited commit: the decision file still names the old tag object.
  assert(
    (await preregProblems(await stageB(), ctx({ anchor: { approved_protocol_sha256: APPROVED, tag_protocol_sha256: APPROVED, tag_moved: true } })))
      .some((x) => x.includes("harness-v2-prereg-a no longer resolves")),
  );
  // The file committed at the tag differs from the approved hash.
  assert(
    (await preregProblems(await stageB(), ctx({ anchor: { approved_protocol_sha256: APPROVED, tag_protocol_sha256: H("9"), tag_moved: false } })))
      .some((x) => x.includes("stage A at harness-v2-prereg-a")),
  );
  // Held-out ids must be the ones stage A recorded.
  assert(
    (await preregProblems(await stageB({ selection: { path: "harness-tasks/v2/selection.json", sha256: H("s"), selected: ["HX-007", "HX-008"], held_out: ["HX-050", "HX-051", "HX-052", "HX-054"] } }), ctx()))
      .some((x) => x.includes("held-out tasks")),
  );
});

Deno.test("parseStageADecision: the decision file's anchor lines", () => {
  const d = parseStageADecision(`# stage A\nprotocol_sha256: ${H("a")}\nfile_sha256: ${H("b")}\ntag: harness-v2-prereg-a\ntag_object: ${"c".repeat(40)}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`);
  assertEquals(d, { protocol_sha256: H("a"), tag: "harness-v2-prereg-a", tag_object: "c".repeat(40) });
  assertEquals(parseStageADecision(`protocol_sha256: ${H("a")}\n`), null);
});

Deno.test("verifyPrereg I/O: the anchor comes from the tag and the decision file, not the working file", async () => {
  // Temp git repo: commit stage A, tag it, write the decision; then edit the working file and its stage_a.
  const repo = await Deno.makeTempDir();
  const git = (...args: string[]) => new Deno.Command("git", { args, cwd: repo, stdout: "piped", stderr: "piped" }).output();
  await git("init", "-q");
  await git("config", "user.email", "t@example.invalid");
  await git("config", "user.name", "t");
  await Deno.mkdir(join(repo, "harness", "preregistration"), { recursive: true });
  const rel = "preregistration/cc-v2-factorial.yml";
  await Deno.writeTextFile(join(repo, "harness", rel), stringify(STAGE_A));
  await git("add", ".");
  await git("commit", "-q", "-m", "stage A");
  await git("tag", "-a", "harness-v2-prereg-a", "-m", `protocol_sha256: ${APPROVED}`);
  const tagObject = new TextDecoder().decode((await git("rev-parse", "harness-v2-prereg-a")).stdout).trim();
  const decision = join(repo, "decision.md");
  await Deno.writeTextFile(decision, `protocol_sha256: ${APPROVED}\ntag: harness-v2-prereg-a\ntag_object: ${tagObject}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`);
  const clean = await loadStageAAnchor(repo, join(repo, "harness"), rel, decision);
  assertEquals(clean.anchor, { approved_protocol_sha256: APPROVED, tag_protocol_sha256: APPROVED, tag_moved: false });
  // Editing the working file changes nothing the anchor reads.
  await Deno.writeTextFile(join(repo, "harness", rel), stringify({ ...STAGE_A, alpha: 0.1 }));
  assertEquals((await loadStageAAnchor(repo, join(repo, "harness"), rel, decision)).anchor, clean.anchor);
  // Moving the tag is detected against the decision file.
  await git("commit", "-q", "-am", "edit");
  await git("tag", "-f", "-a", "harness-v2-prereg-a", "-m", "moved");
  assertEquals((await loadStageAAnchor(repo, join(repo, "harness"), rel, decision)).anchor.tag_moved, true);
  await Deno.remove(repo, { recursive: true });
});

const DROP_C3 = { key: "family", from: ["C1", "C2", "C3"], to: ["C1", "C2"], reason: "C3 unpowered", approval: "OWNER-APPROVED: drop C3 (2026-10-29T12:00:00Z)" } as const;
const NO_DESIGN = { ...ctx().simulation, json: { ...ctx().simulation.json, decision: { design: null } } };
const DESIGN_AM = { key: "design", from: null, to: { tasks: 2, repeats: 5 }, reason: "no design met the rule", approval: "OWNER-APPROVED: design 2x5 (2026-10-29T12:00:00Z)" } as const;

Deno.test("amendments: an externally approved family amendment keeps ancestry and is disclosed", async () => {
  const b = await stageB({ family: ["C1", "C2"], amendments: [DROP_C3] });
  assertEquals(await preregProblems(b, ctx({ stageB: { ...SB, approved_amendments: ["family"] } })), []);
});

Deno.test("amendments: forged amendments with a valid stage-A anchor are refused (round 3 finding 1)", async () => {
  // Family drop whose only approval is the text inside the editable document.
  const drop = await preregProblems(await stageB({ family: ["C1", "C2"], amendments: [DROP_C3] }), ctx());
  assert(drop.some((x) => x.includes("amendment of family is not externally approved")), drop.join("\n"));
  // Design amendment used to waive the simulation/design agreement.
  const design = await preregProblems(await stageB({ amendments: [DESIGN_AM] }), ctx({ simulation: NO_DESIGN }));
  assert(design.some((x) => x.includes("amendment of design is not externally approved")), design.join("\n"));
  assert(design.some((x) => x.includes("design differs from the simulation decision")), "no waiver without external approval");
  // The same design amendment, externally approved: the waiver applies.
  assertEquals(
    await preregProblems(await stageB({ amendments: [DESIGN_AM] }), ctx({ simulation: NO_DESIGN, stageB: { ...SB, approved_amendments: ["design"] } })),
    [],
  );
});

Deno.test("stage-B anchor: no approval, edited bytes or a moved tag refuse campaign creation", async () => {
  const b = await stageB();
  const p = async (stage: object | null) => (await preregProblems(b, ctx({ stageB: stage }))).join("\n");
  assert((await p(null)).includes("stage B is not externally approved"));
  assert((await p({ ...SB, file_sha256: H("x") })).includes("differs from the externally approved stage-B bytes"));
  assert((await p({ ...SB, tag_file_sha256: H("x") })).includes("stage B at harness-v2-prereg-b"));
  assert((await p({ ...SB, tag_moved: true })).includes("harness-v2-prereg-b no longer resolves"));
});

Deno.test("parseStageBDecision: bytes hash, tag and approved amendment keys", () => {
  const d = parseStageBDecision(`stage_b_sha256: ${H("b")}\ntag: harness-v2-prereg-b\ntag_object: ${"c".repeat(40)}\namendment: family\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`);
  assertEquals(d, { stage_b_sha256: H("b"), tag: "harness-v2-prereg-b", tag_object: "c".repeat(40), amendments: ["family"] });
  assertEquals(parseStageBDecision(`stage_b_sha256: ${H("b")}\n`), null);
});

Deno.test("familyProblems: order, membership and interaction status must match the protocol", async () => {
  const b = await stageB();
  assertEquals(familyProblems(b, EXP), []);
  assert(familyProblems({ ...b, family: ["C2", "C1", "C3"] }, EXP).length > 0);
  assert(familyProblems({ ...b, family: ["C1", "C2", "C3", "interaction"] }, EXP).length > 0);
  const confirm = ExperimentSchema.parse({ ...EXP, interaction: { ...PROTOCOL.interaction, status: "confirmatory" } });
  assert(familyProblems(b, confirm).some((p) => p.includes("interaction status")));
});
```

Append to `campaign.test.ts` following its `runCampaign` fixtures (the temp repo is a git repo with the stage-A commit tagged `harness-v2-prereg-a` and a decision file, as in the `verifyPrereg I/O` test): (1) an experiment with `contrasts` and a stage-A file is refused before any cell with a message containing `stage B is not frozen`; (2) a clean stage-B file (fixture selection and simulation JSON files written into the temp repo) creates a campaign carrying `preregistration.sha256`, `protocol_sha256` and `decision_sha256`; (3) editing the file and resuming is refused with `preregistration changed`; (4) a missing `--prereg-decision` or `--prereg-b-decision` is refused before any cell; (5) a stage-B file whose stage A and `stage_a.sha256` were both edited is refused with `differs from the approved stage A`; (6) the stage-B commit is tagged `harness-v2-prereg-b` with a stage-B decision file, then the working file gains a forged `family` amendment (with `OWNER-APPROVED:` text inside it): campaign creation is refused with `not externally approved` and `differs from the externally approved stage-B bytes`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/harness/prereg.ts`:

```ts
/**
 * Two-stage pre-registration of a confirmatory harness campaign (spec v2
 * section 7, round 2 finding 1, cross-plan ruling 5). Stage A (protocol,
 * inference contract, rules) is frozen before screening; stage B adds only
 * the stage-B keys and proves its ancestry by hashing its stage-A projection.
 */

import { join, relative } from "@std/path";
import { parse } from "@std/yaml";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { ContrastSchema, type Experiment, InteractionSchema } from "./config.ts";
import { hashFile, hashJson, sha256Hex } from "./hash.ts";
import { Sha256Hex } from "./identity.ts";
import { isOwnerApproval } from "./records.ts";
import { readYaml } from "./yaml.ts";

const Approval = z.string().refine(isOwnerApproval, "an OWNER-APPROVED: <words> (<ISO-8601 time>) line");
const Rule = z.discriminatedUnion("rule", [
  z.strictObject({ rule: z.literal("suppress_any_undefined") }),
  z.strictObject({ rule: z.literal("min_defined_share"), share: z.number().gt(0.5).max(1) }),
]);
const FileRef = z.strictObject({ path: z.string().min(1), sha256: Sha256Hex });

export const PreregSchema = z.strictObject({
  v: z.literal(1),
  experiment: z.string().min(1),
  protocol: z.strictObject({
    arms: z.array(z.string().min(1)).min(2),
    contrasts: z.array(ContrastSchema).min(1),
    interaction: InteractionSchema.nullable(),
  }),
  approval: Approval,
  population: z.string().trim().min(1),
  primary_metric: z.literal("cost_per_solved_task"),
  confirmatory: z.boolean(),
  family: z.array(z.string().min(1)),
  alpha: z.number().gt(0).lt(1),
  test: z.strictObject({
    sides: z.literal("two"),
    p_value: z.literal("percentile_bootstrap_plus_one"),
    adjustment: z.literal("holm"),
    direction: z.literal("sign_of_delta"),
  }),
  intervals: z.strictObject({ reported: z.literal("per_contrast_unadjusted"), beside: z.literal("bonferroni_same_draws") }),
  bootstrap: z.strictObject({
    unit: z.literal("task"),
    resamples: z.number().int().min(1000),
    seed: z.number().int().min(0).max(0xffffffff),
    level: z.number().gt(0).lt(1),
  }),
  zero_solve: Rule,
  missing_pairs: z.literal("per_contrast_matched"),
  held_out: z.strictObject({
    count: z.number().int().min(0),
    rule: z.string().min(1),
    /** M8's start seal and the ids M8-15a designated there (stage A follows the seal). */
    seal: z.string().regex(/^harness-v2-screen-[a-z0-9-]+$/),
    tasks: z.array(z.string().regex(/^HX-\d{3}$/)),
    in_family: z.literal(false),
  }).refine((h) => h.tasks.length === h.count, "held_out.tasks must list count ids"),
  measures: z.strictObject({
    fingerprint: Sha256Hex,
    unknown_symbol_codes: z.array(z.string().regex(/^AL\d{4}$/)).min(1),
    ruleset_sha256: Sha256Hex,
    canary_codes: z.array(z.string()).min(1),
    workflow_execution: z.literal("used_execution"),
    effort_execution: z.literal("every_attempt"),
  }),
  exploratory_metrics: z.array(z.string().min(1)).min(1),
  simulation: z.strictObject({ script_sha256: Sha256Hex, args: z.record(z.string(), z.number()) }),
  design_rule: z.string().trim().min(1),
  // Stage B keys: empty in stage A.
  stage_a: z.strictObject({ sha256: Sha256Hex }).nullable(),
  experiment_hash: Sha256Hex.nullable(),
  selection: z.strictObject({
    path: z.string().min(1),
    sha256: Sha256Hex,
    selected: z.array(z.string()).min(1),
    held_out: z.array(z.string()),
  }).nullable(),
  design: z.strictObject({ tasks: z.number().int().positive(), repeats: z.number().int().positive() }).nullable(),
  power_simulation: z.strictObject({ inputs: z.array(FileRef).min(1), output: FileRef }).nullable(),
  compiler_identity: z.string().min(1).nullable(),
  stage_b_approval: Approval.nullable(),
  amendments: z.array(z.strictObject({
    key: z.enum(["design", "family", "confirmatory"]),
    from: z.json(),
    to: z.json(),
    reason: z.string().trim().min(1),
    approval: Approval,
  })),
}).superRefine((p, ctx) => {
  const inter = p.protocol.interaction?.status === "confirmatory";
  if (p.family.includes("interaction") !== (inter && p.confirmatory)) {
    ctx.addIssue({ code: "custom", message: "interaction is in the family exactly when it is confirmatory", path: ["family"] });
  }
  if (p.confirmatory && p.family.length === 0) {
    ctx.addIssue({ code: "custom", message: "a confirmatory pre-registration needs a family", path: ["family"] });
  }
});
export type Prereg = z.output<typeof PreregSchema>;

export const STAGE_B_KEYS = [
  "stage_a", "experiment_hash", "selection", "design", "power_simulation", "compiler_identity", "stage_b_approval",
] as const;

/** The stage-A document a stage-B file claims to extend: amendments reverted, stage-B keys emptied. */
export function stageAOf(doc: Prereg): Prereg {
  const a: Record<string, unknown> = { ...doc };
  for (const am of [...doc.amendments].reverse()) a[am.key] = am.from;
  for (const k of STAGE_B_KEYS) a[k] = null;
  a.amendments = [];
  return a as Prereg;
}

export function protocolSha(doc: Prereg): Promise<string> {
  return hashJson({ preregistration_stage_a: stageAOf(doc) });
}

export function familyProblems(doc: Prereg, e: Experiment): string[] {
  const out: string[] = [];
  const ids = (e.contrasts ?? []).map((c) => c.id);
  const fam = doc.family.filter((id) => id !== "interaction");
  const amended = doc.amendments.some((a) => a.key === "family");
  let i = 0;
  for (const id of ids) if (fam[i] === id) i++;
  if (i !== fam.length) out.push(`family ${doc.family.join(",")} is not in contrast order ${ids.join(",")}`);
  if (!amended && doc.confirmatory && fam.length !== ids.length) out.push("family must hold every contrast unless amended");
  if (new Set(doc.family).size !== doc.family.length) out.push("duplicate family member");
  const status = e.interaction?.status ?? null;
  const pre = doc.protocol.interaction?.status ?? null;
  if (status !== pre) out.push(`interaction status ${status} does not match the pre-registration (${pre})`);
  return out;
}

export const STAGE_A_TAG = "harness-v2-prereg-a";

/**
 * What the owner approved, read OUTSIDE the editable document (round 2
 * finding 1): the decision file's protocol hash, whether the stage-A tag
 * still resolves to the tag object the decision recorded, and the protocol
 * hash of the stage-A file committed at that tag.
 */
export interface StageAAnchor {
  approved_protocol_sha256: string;
  /** null when the tag or the file at the tag is missing or does not parse. */
  tag_protocol_sha256: string | null;
  tag_moved: boolean;
}

export interface PreregContext {
  experiment: Experiment;
  experimentHash: string;
  /** Task ids of the campaign task set. */
  taskIds: string[];
  /** The referenced files as read by the caller (sha256 by hashFile). */
  selection: { sha256: string; json: unknown } | null;
  simulation: { sha256: string; json: unknown } | null;
  anchor: StageAAnchor;
  /** null: no stage-B decision was supplied or it did not parse (never campaign-ready). */
  stageB: StageBAnchor | null;
}

export const STAGE_B_TAG = "harness-v2-prereg-b";

/**
 * What the owner approved at stage B, read OUTSIDE the editable document
 * (round 3 finding 1): the decision file's hash of the approved stage-B bytes
 * and its approved amendment keys, the bytes of the current file and of the
 * file committed at harness-v2-prereg-b, and whether that tag moved. Hashes
 * are sha256 of the file text with CRLF normalized to LF.
 */
export interface StageBAnchor {
  approved_sha256: string;
  file_sha256: string;
  tag_file_sha256: string | null;
  tag_moved: boolean;
  approved_amendments: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (xs: string[]) => [...xs].sort();
const textSha = (t: string) => sha256Hex(new TextEncoder().encode(t.replaceAll("\r\n", "\n")));

export async function preregProblems(doc: Prereg, c: PreregContext): Promise<string[]> {
  const out: string[] = [];
  for (const k of STAGE_B_KEYS) if (doc[k] === null) out.push(`stage B is not frozen: ${k}`);
  if (out.length > 0) return out;
  const mine = await protocolSha(doc);
  if (doc.stage_a!.sha256 !== mine) out.push("stage B does not descend from stage A (projection hash differs)");
  // The external anchor: the document's own stage_a value is never trusted alone.
  if (mine !== c.anchor.approved_protocol_sha256) {
    out.push(`stage A of this document (${mine.slice(0, 12)}) differs from the approved stage A (${c.anchor.approved_protocol_sha256.slice(0, 12)}, decision file)`);
  }
  if (c.anchor.tag_moved) out.push(`${STAGE_A_TAG} no longer resolves to the tag object recorded in the decision file`);
  if (c.anchor.tag_protocol_sha256 !== c.anchor.approved_protocol_sha256) {
    out.push(`stage A at ${STAGE_A_TAG} (${c.anchor.tag_protocol_sha256?.slice(0, 12) ?? "missing"}) differs from the approved stage A`);
  }
  // Stage-B anchor: the bytes and every amendment must be externally approved;
  // approval text inside the document authorizes nothing (round 3 finding 1).
  const b = c.stageB;
  const bOk = b !== null && !b.tag_moved && b.file_sha256 === b.approved_sha256 && b.tag_file_sha256 === b.approved_sha256;
  if (b === null) out.push("stage B is not externally approved (no stage-B decision file)");
  else {
    if (b.file_sha256 !== b.approved_sha256) out.push("stage-B file differs from the externally approved stage-B bytes (decision file)");
    if (b.tag_moved) out.push(`${STAGE_B_TAG} no longer resolves to the tag object recorded in the stage-B decision file`);
    if (b.tag_file_sha256 !== b.approved_sha256) out.push(`stage B at ${STAGE_B_TAG} (${b.tag_file_sha256?.slice(0, 12) ?? "missing"}) differs from the approved stage-B bytes`);
  }
  const authorized = (key: string) => bOk && b!.approved_amendments.includes(key);
  for (const am of doc.amendments) {
    if (!same((doc as Record<string, unknown>)[am.key], am.to)) out.push(`amendment of ${am.key} does not match its value`);
    if (!authorized(am.key)) out.push(`amendment of ${am.key} is not externally approved (stage-B decision file)`);
  }
  const e = c.experiment;
  if (!same(sorted(doc.protocol.arms), sorted([e.baseline, ...e.variants]))) out.push("protocol arms differ from the experiment");
  if (!same(doc.protocol.contrasts, e.contrasts ?? [])) out.push("protocol contrasts differ from the experiment");
  if (!same(doc.protocol.interaction, e.interaction ?? null)) out.push("protocol interaction differs from the experiment");
  out.push(...familyProblems(doc, e));
  if (doc.experiment_hash !== c.experimentHash) out.push(`experiment_hash ${doc.experiment_hash} differs from the experiment (${c.experimentHash})`);
  const d = doc.design!;
  if (d.repeats !== e.repeats) out.push(`design repeats ${d.repeats} differ from the experiment's ${e.repeats}`);
  const s = doc.selection!;
  if (d.tasks !== s.selected.length) out.push(`design tasks ${d.tasks} differ from the ${s.selected.length} selected tasks`);
  if (s.held_out.length !== doc.held_out.count) out.push(`held-out count ${s.held_out.length} differs from the frozen ${doc.held_out.count}`);
  if (!same(sorted(s.held_out), sorted(doc.held_out.tasks))) out.push(`held-out tasks ${sorted(s.held_out).join(",")} differ from stage A's ${sorted(doc.held_out.tasks).join(",")}`);
  if (!same(sorted(c.taskIds), sorted([...s.selected, ...s.held_out]))) out.push("campaign task set differs from selected + held-out");
  const sel = c.selection?.json as { status?: string; held_out?: string[]; selection?: { selected?: string[] } } | undefined;
  if (!c.selection || c.selection.sha256 !== s.sha256 || sel?.status !== "ok" ||
    !same(sorted(sel.selection?.selected ?? []), sorted(s.selected)) || !same(sorted(sel.held_out ?? []), sorted(s.held_out))) {
    out.push(`selection ${s.path} does not match the pre-registration`);
  }
  const sim = c.simulation?.json as { script_sha256?: string; args?: unknown; zero_solve?: unknown; decision?: { design?: unknown } } | undefined;
  if (!c.simulation || c.simulation.sha256 !== doc.power_simulation!.output.sha256) out.push("simulation output does not match the pre-registration");
  else {
    if (sim?.script_sha256 !== doc.simulation.script_sha256 || !same(sim?.args, doc.simulation.args)) out.push("simulation was not run with the frozen script and arguments");
    if (!same(sim?.zero_solve, doc.zero_solve)) out.push("simulation used another zero-solve rule than the frozen one");
    // The waiver needs an externally approved design amendment, never one only written in the document.
    const waived = doc.amendments.some((a) => a.key === "design") && authorized("design");
    if (!waived && !same(sim?.decision?.design, d)) out.push("design differs from the simulation decision");
  }
  return out;
}

async function readJsonAt(root: string, rel: string): Promise<{ sha256: string; json: unknown } | null> {
  const p = join(root, rel);
  try {
    return { sha256: await hashFile(root, p), json: JSON.parse(await Deno.readTextFile(p)) };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** The anchor lines of a stage-A decision file; null when any is missing. */
export function parseStageADecision(text: string): { protocol_sha256: string; tag: string; tag_object: string } | null {
  const line = (k: string, re: string) => new RegExp(`^${k}:\\s*(${re})\\s*$`, "m").exec(text)?.[1] ?? null;
  const protocol_sha256 = line("protocol_sha256", "[0-9a-f]{64}");
  const tag = line("tag", "[A-Za-z0-9._/-]+");
  const tag_object = line("tag_object", "[0-9a-f]{40}");
  if (!protocol_sha256 || !tag || !tag_object || !/^OWNER-APPROVED:/m.test(text)) return null;
  return { protocol_sha256, tag, tag_object };
}

/** The anchor lines of a stage-B decision file; null when any required one is missing. */
export function parseStageBDecision(
  text: string,
): { stage_b_sha256: string; tag: string; tag_object: string; amendments: string[] } | null {
  const line = (k: string, re: string) => new RegExp(`^${k}:\\s*(${re})\\s*$`, "m").exec(text)?.[1] ?? null;
  const stage_b_sha256 = line("stage_b_sha256", "[0-9a-f]{64}");
  const tag = line("tag", "[A-Za-z0-9._/-]+");
  const tag_object = line("tag_object", "[0-9a-f]{40}");
  if (!stage_b_sha256 || !tag || !tag_object || !/^OWNER-APPROVED:/m.test(text)) return null;
  const amendments = [...text.matchAll(/^amendment:\s*(design|family|confirmatory)\s*$/gm)].map((m) => m[1]!);
  return { stage_b_sha256, tag, tag_object, amendments };
}

async function gitOut(repoRoot: string, args: string[]): Promise<string | null> {
  const r = await new Deno.Command("git", { args, cwd: repoRoot, stdout: "piped", stderr: "null" }).output();
  return r.success ? new TextDecoder().decode(r.stdout) : null;
}

/** Reads the approved stage A from the decision file and the tag, never from the working file. */
export async function loadStageAAnchor(
  repoRoot: string,
  harnessRoot: string,
  rel: string,
  decisionPath: string,
): Promise<{ anchor: StageAAnchor; decision_sha256: string }> {
  const text = await Deno.readTextFile(decisionPath);
  const d = parseStageADecision(text);
  if (!d || d.tag !== STAGE_A_TAG) {
    throw new ValidationError(`${decisionPath}: not a stage-A decision (protocol_sha256, tag ${STAGE_A_TAG}, tag_object, OWNER-APPROVED lines)`, [decisionPath]);
  }
  const object = (await gitOut(repoRoot, ["rev-parse", "--verify", `refs/tags/${STAGE_A_TAG}`]))?.trim() ?? null;
  const repoRel = relative(repoRoot, join(harnessRoot, rel)).replaceAll("\\", "/");
  const atTag = object === null ? null : await gitOut(repoRoot, ["show", `${STAGE_A_TAG}^{commit}:${repoRel}`]);
  let tagSha: string | null = null;
  if (atTag !== null) {
    const r = PreregSchema.safeParse(parse(atTag));
    tagSha = r.success ? await protocolSha(r.data) : null;
  }
  return {
    anchor: { approved_protocol_sha256: d.protocol_sha256, tag_protocol_sha256: tagSha, tag_moved: object !== d.tag_object },
    decision_sha256: await sha256Hex(new TextEncoder().encode(text)),
  };
}

/** Reads the approved stage-B bytes and amendment keys from the decision file and the tag. */
export async function loadStageBAnchor(
  repoRoot: string,
  harnessRoot: string,
  rel: string,
  decisionPath: string,
): Promise<{ anchor: StageBAnchor; decision_sha256: string }> {
  const text = await Deno.readTextFile(decisionPath);
  const d = parseStageBDecision(text);
  if (!d || d.tag !== STAGE_B_TAG) {
    throw new ValidationError(`${decisionPath}: not a stage-B decision (stage_b_sha256, tag ${STAGE_B_TAG}, tag_object, OWNER-APPROVED lines)`, [decisionPath]);
  }
  const object = (await gitOut(repoRoot, ["rev-parse", "--verify", `refs/tags/${STAGE_B_TAG}`]))?.trim() ?? null;
  const repoRel = relative(repoRoot, join(harnessRoot, rel)).replaceAll("\\", "/");
  const atTag = object === null ? null : await gitOut(repoRoot, ["show", `${STAGE_B_TAG}^{commit}:${repoRel}`]);
  return {
    anchor: {
      approved_sha256: d.stage_b_sha256,
      file_sha256: await textSha(await Deno.readTextFile(join(harnessRoot, rel))),
      tag_file_sha256: atTag === null ? null : await textSha(atTag),
      tag_moved: object !== d.tag_object,
      approved_amendments: d.amendments,
    },
    decision_sha256: await sha256Hex(new TextEncoder().encode(text)),
  };
}

export async function verifyPrereg(
  repoRoot: string,
  harnessRoot: string,
  experiment: Experiment,
  experimentHash: string,
  taskIds: string[],
  decisionPath: string,
  stageBDecisionPath: string,
): Promise<{ doc: Prereg; sha256: string; protocol_sha256: string; decision_sha256: string; stage_b_decision_sha256: string; problems: string[] }> {
  const rel = experiment.preregistration!;
  const path = join(harnessRoot, rel);
  try {
    await Deno.stat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new ValidationError(`preregistration not found: ${rel}`, [rel]);
    throw err;
  }
  const doc = await readYaml(path, PreregSchema);
  const { anchor, decision_sha256 } = await loadStageAAnchor(repoRoot, harnessRoot, rel, decisionPath);
  const b = await loadStageBAnchor(repoRoot, harnessRoot, rel, stageBDecisionPath);
  const problems = await preregProblems(doc, {
    experiment,
    experimentHash,
    taskIds,
    selection: doc.selection ? await readJsonAt(repoRoot, doc.selection.path) : null,
    simulation: doc.power_simulation ? await readJsonAt(repoRoot, doc.power_simulation.output.path) : null,
    anchor,
    stageB: b.anchor,
  });
  return {
    doc,
    sha256: await hashFile(harnessRoot, path),
    protocol_sha256: await protocolSha(doc),
    decision_sha256,
    stage_b_decision_sha256: b.decision_sha256,
    problems,
  };
}
```

`records.ts` `CampaignRecordSchema` gains `preregistration: z.strictObject({ path: z.string().min(1), sha256: Sha256Hex, protocol_sha256: Sha256Hex, decision_sha256: Sha256Hex, stage_b_decision_sha256: Sha256Hex }).optional()` and the refine `if (c.experiment.contrasts && !c.preregistration) issue("a campaign with contrasts needs its preregistration", ["preregistration"]);`.

`campaign.ts runCampaign` takes `opts.preregDecision?: string` and `opts.preregBDecision?: string` (from `harness run --prereg-decision <path> --prereg-b-decision <path>`, Cliffy string options; both required when the experiment has `preregistration`, else `ConfigurationError`); for a new campaign, before `CampaignRecordSchema.parse`:

```ts
    let preregistration:
      | { path: string; sha256: string; protocol_sha256: string; decision_sha256: string; stage_b_decision_sha256: string }
      | undefined;
    if (experiment.preregistration) {
      if (!opts.preregDecision || !opts.preregBDecision) {
        throw new ConfigurationError("--prereg-decision and --prereg-b-decision are required for a pre-registered experiment");
      }
      const v = await verifyPrereg(env.repoRoot, env.harnessRoot, experiment, expHash, ids.tasks.map((t) => t.id), opts.preregDecision, opts.preregBDecision);
      if (v.problems.length > 0) {
        throw new ConfigurationError(`preregistration ${experiment.preregistration} refuses a confirmatory campaign:\n  ${v.problems.join("\n  ")}`);
      }
      preregistration = {
        path: experiment.preregistration,
        sha256: v.sha256,
        protocol_sha256: v.protocol_sha256,
        decision_sha256: v.decision_sha256,
        stage_b_decision_sha256: v.stage_b_decision_sha256,
      };
    }
```

spread into the record: the initial campaign is bound to the externally approved stage-B bytes and the recorded hashes of both decision files. For an existing campaign `c` with `c.preregistration`, re-run `verifyPrereg` and refuse when the document sha or either decision sha differs (`preregistration changed since campaign ${c.id} was created`) or problems exist.

- [ ] **Step 4: Run** prereg, campaign, records, integrity tests; check/lint/fmt; commit

```bash
git add src/harness/prereg.ts src/harness/records.ts src/harness/campaign.ts cli/commands/harness-command.ts tests/unit/harness/prereg.test.ts tests/unit/harness/campaign.test.ts
git commit -m "feat(harness): two-stage pre-registration anchored to the stage-A tag and decision, with selection and simulation binding (M11-10)"
```

---

### Task M11-11: Report: confirmatory contrasts, held-out exclusion, measure binding

Lane: lane-infra. Deps: M11-08..10, H-01.

Rules:
- With `campaign.preregistration`, `buildReport` requires `opts.prereg` (from `verifyPrereg`) with the same sha256 and no problems; else `ValidationError`.
- Family: `familyProblems` must be empty; `testContrasts` gets `family: doc.confirmatory ? doc.family : []` and the bootstrap/alpha/zero-solve of the pre-registration; CLI `--resamples/--seed` never reach the confirmatory section.
- Confirmatory cells are the cells of `doc.selection.selected` only; held-out cells (`doc.selection.held_out`) get a separate descriptive `armSummary` per arm, never in C1-C3.
- Measure records used by the report must carry `doc.measures.fingerprint`, `analyzers.ruleset_sha256 === doc.measures.ruleset_sha256`, `analyzers.compiler === doc.compiler_identity`, and canary codes containing `doc.measures.canary_codes`; a mismatch refuses the report (as mixed scorer fingerprints do).
- Measure provenance (round 2 side-file finding): a record counts for a cell only when `judgment_id` is the cell's counted judgment, `execution_id` its used execution, `workspace_hash` that execution's stored artifact `workspace_hash`, and `oracle_hash` the judgment's `task_oracle_hash`; any mismatch refuses the report naming the field (`judgment`, `execution`, `workspace`, `oracle`). Applies with and without a pre-registration (M11-12 loads through the same check).
- The v1 `comparisons` rows become exploratory when the experiment has contrasts.
- Amendments print first in the header.

**Files:**
- Modify: `src/harness/report.ts`, `cli/commands/harness-command.ts:379-417`
- Test: `tests/unit/harness/report.test.ts` (append), `tests/unit/harness/fixtures.ts` (optional `experiment` override), `tests/unit/cli/commands/harness-command.test.ts` (append)

**Interfaces:**
- Consumes: `testContrasts`, `ContrastResult`, `armSummary`; `Prereg`, `verifyPrereg`, `familyProblems`.
- Produces: `ReportOptions.prereg?: { doc: Prereg; sha256: string; problems: string[] }`; `HarnessReport.confirmatory?: { preregistration: { path; sha256; protocol_sha256 }; amendments: Prereg["amendments"]; alpha: number; family: string[]; zero_solve: ZeroSolveRule; bootstrap: { resamples; seed; level }; tasks: string[]; results: ContrastResult[]; held_out: { tasks: string[]; arms: ArmSummary[] } }`.

- [ ] **Step 1: Failing tests.** In `report.test.ts` add `factorialRecords()` (four arms P, L, R, RL mapped to the fixture campaign's arm ids, 8 tasks of which 2 are held out, 2 repeats, L cheaper than P, the held-out tasks with an extreme cost in L so including them would change C1) and `stageBFor(campaign)` building a stage-B `Prereg` with `bootstrap.resamples: 1000` and `held_out: { ...STAGE_A.held_out, count: 2, tasks: <the two held-out fixture tasks> }`:

```ts
Deno.test("buildReport (M11): confirmatory C1-C3 from the pre-registration over selected tasks only", async () => {
  const recs = await factorialRecords();
  const prereg = { doc: await stageBFor(recs.campaign), sha256: recs.campaign.preregistration!.sha256, problems: [] };
  const r = await buildReport(recs, { prereg, resamples: 50, seed: 99 });
  const k = r.confirmatory!;
  assertEquals(k.bootstrap.resamples, 1000);
  assertEquals(k.tasks, prereg.doc.selection!.selected);
  assertEquals(k.results.map((x) => [x.id, x.confirmatory]), [["C1", true], ["C2", true], ["C3", true], ["interaction", false]]);
  assertEquals(k.results[0]!.tasks, prereg.doc.selection!.selected.length);
  assertEquals(k.held_out.tasks, prereg.doc.selection!.held_out);
  assert(r.comparisons.every((c) => c.label === "exploratory"));
  assertStringIncludes(renderReport(r), "Confirmatory contrasts (pre-registered");
});

Deno.test("buildReport (M11): missing, changed or inconsistent pre-registration is refused", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign);
  await assertRejects(() => buildReport(recs, {}), ValidationError, "preregistration");
  await assertRejects(() => buildReport(recs, { prereg: { doc, sha256: "0".repeat(64), problems: [] } }), ValidationError, "does not match the campaign");
  await assertRejects(() => buildReport(recs, { prereg: { doc: { ...doc, family: ["C2", "C1", "C3"] }, sha256: recs.campaign.preregistration!.sha256, problems: [] } }), ValidationError, "family");
});

Deno.test("buildReport (M11): a measure record from another fingerprint, ruleset or compiler is refused", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign);
  const logs = await logsWithMeasure(recs, { analyzers: { compiler: "other", ruleset_sha256: doc.measures.ruleset_sha256, canary_codes: ["AA0137"] } });
  await assertRejects(
    () => buildReport(recs, { prereg: { doc, sha256: recs.campaign.preregistration!.sha256, problems: [] }, logs }),
    ValidationError,
    "compiler",
  );
});
```

(`logsWithMeasure` builds `ReportLogs` with a `measures` map holding one record for the first scored cell's judgment.) Add the provenance test: the same helper with `{ workspace_hash: "f".repeat(64) }` and, separately, `{ execution_id: <another execution of the campaign> }` is refused with `ValidationError` containing `workspace` and `execution`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** in `buildReport` after `checkBootstrapOptions(opts)`:

```ts
  const pre = campaign.preregistration;
  if (pre) {
    const p = opts.prereg;
    if (!p || p.sha256 !== pre.sha256) {
      const msg = `preregistration ${pre.path} (${p?.sha256 ?? "not loaded"}) does not match the campaign (${pre.sha256})`;
      throw new ValidationError(msg, [msg]);
    }
    const why = [...p.problems, ...familyProblems(p.doc, exp)];
    if (why.length > 0) throw new ValidationError(`preregistration ${pre.path}: ${why.join("; ")}`, why);
  }
```

then

```ts
  const confirmatory = pre && opts.prereg && exp.contrasts
    ? (() => {
      const d = opts.prereg!.doc;
      const selected = new Set(d.selection!.selected);
      const held = new Set(d.selection!.held_out);
      const results = testContrasts(
        cells.filter((c) => selected.has(c.task)),
        exp.contrasts!,
        exp.interaction ? { ...exp.interaction } : null,
        "cost_per_solved_task",
        { ...d.bootstrap, alpha: d.alpha, zeroSolve: d.zero_solve, family: d.confirmatory ? d.family : [] },
      );
      const heldCells = cells.filter((c) => held.has(c.task));
      return {
        preregistration: pre,
        amendments: d.amendments,
        alpha: d.alpha,
        family: d.confirmatory ? d.family : [],
        zero_solve: d.zero_solve,
        bootstrap: { resamples: d.bootstrap.resamples, seed: d.bootstrap.seed, level: d.bootstrap.level },
        tasks: d.selection!.selected,
        results,
        held_out: { tasks: d.selection!.held_out, arms: arms.map((a) => armSummary(heldCells, a, reported)) },
      };
    })()
    : undefined;
```

Comparisons rows: `primary: exp.contrasts ? false : metric === exp.primary_metric` and matching `label`. Return `...(confirmatory ? { confirmatory } : {})`.

Measure binding (shared with M11-12's loader): every record in `logs.measures` must match its cell (`judgment_id`, `execution_id`, `workspace_hash` from `store.artifact(execution).workspace_hash`, `oracle_hash` from the judgment), else `ValidationError` naming the field; when `opts.prereg`, every record must also satisfy `r.measure_fingerprint === d.measures.fingerprint`, and when `r.analyzers` is non-null, `ruleset_sha256 === d.measures.ruleset_sha256`, `compiler === d.compiler_identity`, `d.measures.canary_codes` ⊆ `canary_codes`; otherwise `ValidationError` naming the field (`fingerprint`, `ruleset`, `compiler`, `canary`).

`renderReport`, after the "Primary" block when `r.confirmatory`:

```ts
  if (r.confirmatory) {
    const k = r.confirmatory;
    for (const a of k.amendments) {
      out.push(colors.yellow(`pre-registration amended after screening: ${a.key} ${JSON.stringify(a.from)} -> ${JSON.stringify(a.to)} (${a.reason}; ${a.approval})`));
    }
    h(`Confirmatory contrasts (pre-registered ${k.preregistration.sha256.slice(0, 12)}, protocol ${k.preregistration.protocol_sha256.slice(0, 12)}, Holm at ${k.alpha}, ${k.bootstrap.resamples} resamples, seed ${k.bootstrap.seed}, ${k.tasks.length} tasks)`);
    for (const c of k.results) {
      const f = fmtOf(c);
      const ci = c.ci === null
        ? `CI suppressed (${Math.round(c.undefined_share * c.resamples)} of ${c.resamples} resamples undefined)`
        : `95% CI [${f(c.ci[0])}, ${f(c.ci[1])}] (unadjusted)`;
      const tail = c.confirmatory
        ? `p ${c.p_value?.toFixed(4) ?? "n/a"}, Holm p ${c.p_holm?.toFixed(4) ?? "n/a"} -> ${c.decision.replace("_", " ")}; Bonferroni interval ${c.bonferroni_ci ? `[${f(c.bonferroni_ci[0])}, ${f(c.bonferroni_ci[1])}]` : "n/a"}`
        : colors.dim("[exploratory] outside the Holm family");
      out.push(`  ${c.id} ${c.name}: ${c.variant} vs ${c.baseline}: ${c.delta === null ? "n/a" : f(c.delta)}, ${ci}; ${tail}`);
    }
    h(`Held-out tasks (descriptive robustness check, not in C1-C3): ${k.held_out.tasks.join(", ")}`);
    for (const a of k.held_out.arms) {
      out.push(`  ${a.arm}: cost per solved task ${usd(a.cost_per_solved_task)}, pass rate ${pct(a.pass_rate)} over ${a.scored_cells} scored cells`);
    }
  }
```

`harnessReport`: when `campaign.preregistration`, require `--prereg-decision <path>` and `--prereg-b-decision <path>` (Cliffy string options on `harness report`), `prereg = await verifyPrereg(opts.root, join(opts.root, "harness"), campaign.experiment, campaign.experiment_hash, campaign.task_set.tasks.map((t) => t.id), opts.preregDecision, opts.preregBDecision)`, refuse when `prereg.decision_sha256` or `prereg.stage_b_decision_sha256` differs from the campaign record, and pass it. CLI tests: an edited pre-registration file makes `harness report` fail; an edited stage-A or stage-B decision file makes it fail.

- [ ] **Step 4: Run** report, report-charts, harness-command tests; check/lint/fmt; commit

```bash
git add src/harness/report.ts cli/commands/harness-command.ts tests/unit/harness/report.test.ts tests/unit/harness/fixtures.ts tests/unit/cli/commands/harness-command.test.ts
git commit -m "feat(harness): report pre-registered C1-C3, held-out apart, measure provenance enforced (M11-11)"
```

---

### Task M11-12: Report: exploratory rollups per arm and paired deltas

Lane: lane-infra. Deps: M11-01, M11-02, M11-04, M11-11, M10-07 (`lsp_calls`), M9-06 (usage proof on every run), H-01.

Rules (stage A copies them):
- Effort, token and tool-mix values sum over every attempt of the cell; any attempt missing the value makes the cell missing. Tokens are missing when an attempt's `per_model` is empty or has a null field: that is how the claude-code adapter reports an unproven modelUsage coverage, which M9-06 extends to single-result runs (gate 3 consumption contract: parent plus sub-agent usage proven, else `per_model` empty and `cost_usd` null).
- Workflow and quality values (burden, first build, final code, reuse, partial credit) come from the used execution and the counted judgment.
- Burden and first build are missing unless outside-backend compilation is excluded: the arm declares no toolchain (`manifest.toolchain` empty), or the used execution's trace is complete and shows `compile_calls.in_container === 0`.
- Trace values need a complete trace for every attempt. LSP total and LSP shell calls are missing when `lsp_calls` is null (no `lsp_call` capability) or the parser is before `claude-code-trace@5` (ruling 9). `lsp_passive_diagnostics` comes from the used execution's `raw_usage` (null stays missing; non-LSP arms read `n/a`). `lsp_shell_calls` is reported per arm and never excludes a cell (stage A text).
- Usage disclosure (appendix section 6): per arm, the count of cells per `raw_usage.usage_reconciliation.status` (`exact`, `compaction_excess`, `unreconciled`, absent), printed beside the token rollups; `compaction_excess` cells keep their cost (owner default) and are listed.
- Per arm: per-task mean over cells with a value, then mean over tasks. Counts: cells with a value, missing, no-build, not applicable.
- Paired delta per contrast (or per variant vs baseline without contrasts): pairs where both cells have a value; per-task mean of deltas, then mean over tasks; descriptive only, no interval.
- Measure records: the one for the required fingerprint (pre-registration, else current `measureFingerprint()`); `reuse` is the effective-reuse share, `reuse_executed` the executed share.

**Files:**
- Create: `src/harness/rollups.ts`
- Modify: `src/harness/report.ts` (`ReportLogs.measures?`, `loadReportLogs(resultsRoot, records, fingerprint)`, `HarnessReport.exploratory?`, render)
- Test: `tests/unit/harness/rollups.test.ts`, `tests/unit/harness/report.test.ts` (append)

**Interfaces:**
- Produces: `EXPLORATORY_METRICS`, `MetricId`, `CellValue = number | null | "no_build" | "n/a"`, `cellValues(attempts, used, measure, host, traces, toolchainDeclared): Record<MetricId, CellValue>`, `lspTotal(e, m): number | null`, `lspShell(e, m): number | null`, `ArmRollup`, `DeltaRollup`, `rollups(...)`, the per-arm `usage_reconciliation` status counts.
- Consumes (appendix sections 5 and 6): `TraceMetrics.lsp_calls` / `lsp_shell_calls`, `raw_usage.lsp_passive_diagnostics`, `raw_usage.usage_reconciliation`, `telemetry.per_model`.

- [ ] **Step 1: Failing tests** `tests/unit/harness/rollups.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { cellValues, rollups } from "../../../src/harness/rollups.ts";
import type { ExecutionRecord } from "../../../src/harness/records.ts";
import type { LoadedTrace } from "../../../src/harness/trace-metrics.ts";

const exec = (id: string, perModel: object[], parser = "claude-code-trace@5", turns: number | null = 3) =>
  ({ id, telemetry: { per_model: perModel, turns, wall_ms: 1000, raw_usage: { capabilities: { parser } } } }) as unknown as ExecutionRecord;
const pm = (out: number | null) => ({
  model: "m", requests: 1, tokens_in_uncached: 10, tokens_cache_read: 20,
  tokens_cache_write: 5, tokens_out: out, tokens_reasoning: 0, cost_usd: 0.1,
});
const T: LoadedTrace = { events: [], complete: true, trace_types: ["tool_call", "lsp_call"] };

Deno.test("cellValues: missing host log, incomplete trace, unproven usage are missing, never zero", () => {
  const a = exec("a", [pm(null)]);
  const v = cellValues([a], a, undefined, new Map(), new Map([["a", { ...T, complete: false }]]), false);
  assertEquals([v.tokens_out, v.tokens_in_uncached, v.backend_builds, v.burden_distinct, v.lsp_calls, v.final_errors, v.reuse], [null, 10, null, null, null, null, null]);
  const u = exec("u", []);
  assertEquals(cellValues([u], u, undefined, new Map([["u", []]]), new Map([["u", T]]), false).tokens_in_uncached, null);
});

Deno.test("cellValues: empty host log is no-build; sums over attempts; LSP needs parser @5", () => {
  const a = exec("a", [pm(5)]);
  const b = exec("b", [pm(7)]);
  const v = cellValues([a, b], b, undefined, new Map([["a", []], ["b", []]]), new Map([["a", T], ["b", T]]), false);
  assertEquals([v.tokens_out, v.turns, v.backend_builds, v.burden_distinct, v.first_build_ok, v.lsp_calls], [12, 6, 0, "no_build", "no_build", 0]);
  const old = exec("o", [pm(1)], "claude-code-trace@4");
  assertEquals(cellValues([old], old, undefined, new Map([["o", []]]), new Map([["o", T]]), false).lsp_calls, null);
  // An @5 trace without the lsp_call capability is unobservable: null, never 0 (ruling 9).
  const noCap = exec("n", [pm(1)]);
  assertEquals(
    cellValues([noCap], noCap, undefined, new Map([["n", []]]), new Map([["n", { ...T, trace_types: ["tool_call"] }]]), false).lsp_calls,
    null,
  );
});

Deno.test("cellValues: a declared toolchain needs a complete used trace for burden", () => {
  const a = exec("a", [pm(1)]);
  const v = cellValues([a], a, undefined, new Map([["a", []]]), new Map(), true);
  assertEquals([v.burden_distinct, v.first_build_ok, v.backend_builds], [null, null, 0]);
});

Deno.test("rollups: equal task weight per arm; paired deltas over pairs with both values", () => {
  const val: Record<string, number | null> = {
    "A/t1/1": 1, "A/t1/2": 3, "A/t2/1": 10, "A/t2/2": null,
    "B/t1/1": 2, "B/t1/2": 2, "B/t2/1": 4, "B/t2/2": 4,
  };
  const cs = Object.keys(val).map((k) => { const [arm, task, r] = k.split("/"); return { arm: arm!, task: task!, repeat: Number(r) }; });
  const out = rollups(cs, ["A", "B"], [{ baseline: "A", variant: "B" }], (c) => ({ turns: val[`${c.arm}/${c.task}/${c.repeat}`] ?? null }), ["turns"]);
  assertEquals(out.arms.find((x) => x.arm === "A")!, { arm: "A", metric: "turns", value: 6, cells: 3, missing: 1, no_build: 0, not_applicable: 0 });
  assertEquals(out.deltas[0], { baseline: "A", variant: "B", metric: "turns", delta: -3, pairs: 3, tasks: 2, missing_pairs: 1 });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/harness/rollups.ts`:

```ts
/**
 * Exploratory metrics (spec v2 section 6): per cell, per arm (equal task
 * weight) and as paired deltas; labelled exploratory by the report.
 */

import type { HostLogLine } from "./backend.ts";
import type { MeasureRecord } from "./measures.ts";
import type { ExecutionRecord } from "./records.ts";
import type { LoadedTrace, TraceMetrics } from "./trace-metrics.ts";
import { buildLogMetrics } from "./build-log.ts";
import { traceMetrics } from "./trace-metrics.ts";

export const EXPLORATORY_METRICS = [
  "tokens_in_uncached", "tokens_cache_read", "tokens_cache_write", "tokens_out", "tokens_reasoning",
  "turns", "wall_ms", "backend_builds", "test_runs",
  "burden_distinct", "burden_unknown_symbol", "first_build_ok",
  "final_errors", "final_new_warnings", "reuse", "reuse_executed",
  "partial_credit", "hidden_regressions_preserved", "pass_to_pass_preserved",
  "lsp_calls", "lsp_shell_calls", "lsp_passive_diagnostics",
  "search_calls", "read_calls", "edit_calls", "skill_invocations", "subagents", "mcp_calls",
] as const;
export type MetricId = (typeof EXPLORATORY_METRICS)[number];
export type CellValue = number | null | "no_build" | "n/a";

const sumOr = (xs: (number | null)[]): number | null =>
  xs.length === 0 || xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + b!, 0);
const atLeast5 = (e: ExecutionRecord) => {
  const raw = e.telemetry.raw_usage as { capabilities?: { parser?: unknown } } | null;
  const v = typeof raw?.capabilities?.parser === "string" ? /^claude-code-trace@(\d+)$/.exec(raw.capabilities.parser) : null;
  return v !== null && Number(v[1]) >= 5;
};

/** LSP calls (M10-07, ruling 9: `{ total, by_op } | null`); null before claude-code-trace@5 or when unobservable. */
export function lspTotal(e: ExecutionRecord, m: TraceMetrics): number | null {
  return !atLeast5(e) || m.lsp_calls === null ? null : m.lsp_calls.total;
}

/** Shell calls into the LSP install (M10-07 best-effort audit); null as lspTotal. */
export function lspShell(e: ExecutionRecord, m: TraceMetrics): number | null {
  return !atLeast5(e) ? null : m.lsp_shell_calls;
}

export function cellValues(
  attempts: ExecutionRecord[],
  used: ExecutionRecord | undefined,
  measure: MeasureRecord | undefined,
  host: ReadonlyMap<string, readonly HostLogLine[]>,
  traces: ReadonlyMap<string, LoadedTrace | null> | null,
  toolchainDeclared: boolean,
): Record<MetricId, CellValue> {
  type PM = ExecutionRecord["telemetry"]["per_model"][number];
  const tok = (k: keyof PM) =>
    sumOr(attempts.map((e) => e.telemetry.per_model.length === 0 ? null : sumOr(e.telemetry.per_model.map((p) => p[k] as number | null))));
  const tm = attempts.map((e) => {
    const t = traces?.get(e.id);
    return t && t.complete ? traceMetrics(t.events, t) : null;
  });
  const tr = (f: (m: TraceMetrics, e: ExecutionRecord) => number | null) =>
    sumOr(tm.map((m, i) => m === null ? null : f(m, attempts[i]!)));
  const logs = attempts.map((e) => buildLogMetrics(host.get(e.id)));
  const usedLog = used ? buildLogMetrics(host.get(used.id)) : null;
  const usedTrace = used ? tm[attempts.findIndex((e) => e.id === used.id)] ?? null : null;
  const excluded = !toolchainDeclared || (usedTrace !== null && usedTrace.compile_calls.in_container === 0);
  const burden = (x: number | null | undefined): CellValue =>
    usedLog === null || !excluded ? null : x === null ? "no_build" : x ?? null;
  const m = <T>(f: (v: T) => number | null, x: { status: string; value?: T } | undefined): CellValue =>
    x === undefined ? null : x.status === "ok" ? (f(x.value as T) ?? "n/a") : x.status === "not_applicable" ? "n/a" : null;
  return {
    tokens_in_uncached: tok("tokens_in_uncached"),
    tokens_cache_read: tok("tokens_cache_read"),
    tokens_cache_write: tok("tokens_cache_write"),
    tokens_out: tok("tokens_out"),
    tokens_reasoning: tok("tokens_reasoning"),
    turns: sumOr(attempts.map((e) => e.telemetry.turns)),
    wall_ms: sumOr(attempts.map((e) => e.telemetry.wall_ms)),
    backend_builds: sumOr(logs.map((l) => l?.builds ?? null)),
    test_runs: sumOr(logs.map((l) => l?.test_runs ?? null)),
    burden_distinct: burden(usedLog?.distinct_diagnostics),
    burden_unknown_symbol: burden(usedLog?.unknown_symbol),
    first_build_ok: usedLog === null || !excluded
      ? null
      : usedLog.first_eligible === "no_build" ? "no_build" : usedLog.first_eligible === "ok" ? 1 : 0,
    final_errors: m((v: { errors: number }) => v.errors, measure?.final_code),
    final_new_warnings: m((v: { new_warnings: number | null }) => v.new_warnings, measure?.final_code) === "n/a"
      ? null
      : m((v: { new_warnings: number | null }) => v.new_warnings, measure?.final_code),
    reuse: m((v: { effective: boolean }) => v.effective ? 1 : 0, measure?.reuse),
    reuse_executed: m((v: { executed: boolean }) => v.executed ? 1 : 0, measure?.reuse),
    partial_credit: m((v: { new_requirements: number }) => v.new_requirements, measure?.partial_credit),
    hidden_regressions_preserved: m((v: { hidden_regressions: number | null }) => v.hidden_regressions, measure?.partial_credit),
    pass_to_pass_preserved: m((v: { pass_to_pass: number | null }) => v.pass_to_pass, measure?.partial_credit),
    lsp_calls: tr((x, e) => lspTotal(e, x)),
    lsp_shell_calls: tr((x, e) => lspShell(e, x)),
    lsp_passive_diagnostics: (() => {
      if (!used) return null;
      const raw = used.telemetry.raw_usage as { lsp_passive_diagnostics?: unknown; incomplete_reasons?: Record<string, unknown> } | null;
      const v = raw?.lsp_passive_diagnostics;
      if (typeof v === "number") return v;
      // null with a reason (LSP arm, unobservable) stays missing; null without one is a non-LSP arm.
      return raw?.incomplete_reasons?.["lsp_passive_diagnostics"] !== undefined ? null : "n/a";
    })(),
    search_calls: tr((x) => x.categories.search),
    read_calls: tr((x) => x.categories.read),
    edit_calls: tr((x) => x.categories.edit),
    skill_invocations: tr((x) => total(x.skill_invocations)),
    subagents: tr((x) => x.subagents),
    mcp_calls: tr((x) => total(x.mcp_calls)),
  };
}

export interface ArmRollup {
  arm: string;
  metric: string;
  value: number | null;
  cells: number;
  missing: number;
  no_build: number;
  not_applicable: number;
}
export interface DeltaRollup {
  baseline: string;
  variant: string;
  metric: string;
  delta: number | null;
  pairs: number;
  tasks: number;
  missing_pairs: number;
}

const mean = (xs: number[]) => xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
function taskMean(rows: { task: string; v: number }[]): number | null {
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.task, [...(by.get(r.task) ?? []), r.v]);
  return mean([...by.values()].map((xs) => mean(xs)!));
}

export function rollups<C extends { arm: string; task: string; repeat: number }>(
  cells: C[],
  arms: string[],
  pairs: { baseline: string; variant: string }[],
  valueOf: (c: C) => Partial<Record<string, CellValue>>,
  metrics: readonly string[] = EXPLORATORY_METRICS,
): { arms: ArmRollup[]; deltas: DeltaRollup[] } {
  const k = (arm: string, task: string, repeat: number) => `${arm}\u0000${task}\u0000${repeat}`;
  const vals = new Map(cells.map((c) => [k(c.arm, c.task, c.repeat), valueOf(c)]));
  const out: { arms: ArmRollup[]; deltas: DeltaRollup[] } = { arms: [], deltas: [] };
  for (const metric of metrics) {
    for (const arm of arms) {
      const mine = cells.filter((c) => c.arm === arm).map((c) => ({ task: c.task, v: vals.get(k(c.arm, c.task, c.repeat))![metric] ?? null }));
      const num = mine.filter((x): x is { task: string; v: number } => typeof x.v === "number");
      out.arms.push({
        arm, metric, value: taskMean(num), cells: num.length,
        missing: mine.filter((x) => x.v === null).length,
        no_build: mine.filter((x) => x.v === "no_build").length,
        not_applicable: mine.filter((x) => x.v === "n/a").length,
      });
    }
    for (const p of pairs) {
      const rows: { task: string; v: number }[] = [];
      let unpaired = 0;
      for (const b of cells.filter((c) => c.arm === p.baseline)) {
        const vb = vals.get(k(p.baseline, b.task, b.repeat))?.[metric];
        const vv = vals.get(k(p.variant, b.task, b.repeat))?.[metric];
        if (typeof vb === "number" && typeof vv === "number") rows.push({ task: b.task, v: vv - vb });
        else unpaired++;
      }
      out.deltas.push({
        baseline: p.baseline, variant: p.variant, metric, delta: taskMean(rows),
        pairs: rows.length, tasks: new Set(rows.map((r) => r.task)).size, missing_pairs: unpaired,
      });
    }
  }
  return out;
}
```

`report.ts`: `ReportLogs.measures?: ReadonlyMap<string, MeasureRecord>`; `loadReportLogs(resultsRoot, records, fingerprint?)` reads `readMeasureRecord(resultsRoot, j.id, fingerprint ?? await measureFingerprint())` per judgment; `harnessReport` passes the pre-registration's fingerprint when there is one. Without a pre-registration, mixed fingerprints cannot occur (one fingerprint is read). In `buildReport`, for each terminal cell (`ineligible(c, exp.primary_metric) === null`): `cellValues(attemptsOf(c), executions.find((e) => e.id === c.used_execution), c.judgment_id ? measures.get(c.judgment_id) : undefined, logs.host, opts.traces?.traces ?? null, manifestOf(c.arm).toolchain.length > 0)`; pairs = `exp.contrasts ?? exp.variants.map((v) => ({ baseline: exp.baseline, variant: v }))`; `exploratory: { label: "exploratory", ...rollups(...) }`. Render a section `Exploratory metrics (not confirmatory)`: per metric `  <metric>: <arm> <value|n/a> (<cells> cells[, <missing> missing][, <no_build> no build][, <not_applicable> n/a]); ...` and per delta `    <variant> - <baseline>: <delta|n/a> over <pairs> pairs / <tasks> tasks[, <missing_pairs> unpaired]`.

Append a report test: a two-arm campaign with host logs (`[]` for one execution, no entry for another) and one measure record; `exploratory.arms` for `backend_builds` shows 1 cell, 1 missing; `burden_distinct` shows `no_build: 1`; the text has `Exploratory metrics (not confirmatory)`.

- [ ] **Step 4: Run** rollups, report, report-extras, report-charts, harness-command tests; check/lint/fmt; commit

```bash
git add src/harness/rollups.ts src/harness/report.ts tests/unit/harness/rollups.test.ts tests/unit/harness/report.test.ts
git commit -m "feat(harness): exploratory rollups per arm and paired deltas (M11-12)"
```

---

### Task M11-13: Simulation of the frozen selection and inference pipeline

Lane: lane-infra2. Deps: M11-09, M8-02 (`scripts/harness/screening.ts`), H-01.

What it simulates, end to end, per replicate:
1. Fit (`fitCells`) from v1 cells (stage A) or v1 plus pilot cells (stage B): `log_mean`, `task_sd`, `cell_sd`, `arm_sd`, `solved_ratio` (cost-success dependence), `unknown_share` (missing cost). Fit `stress`: task_sd x 1.5, arm_sd x 2.
2. Candidate pool of `ceil(pool_factor x N)`: latent solve rate from the author prior per 12 (2 easy U(0.80, 0.97), 8 intermediate U(0.20, 0.80), 2 hard U(0.03, 0.20)), kinds per M8's wave quota (4 feature, 3 bugfix, 3 refactor, 2 test-authoring), 8 of 12 large, required coupling styles spread over the pool.
3. Screening exactly as M8: 3 pilot cells on plain and 3 on realistic+LSP (scenario effects apply), pooled count through M8's `stratumOf`, dead/saturated dropped, M8's `select` with M8's rules and a random rank; a shortfall counts as a selection failure (reported, gated below 5%).
4. Campaign cells: N selected tasks x R repeats x 4 arms.
5. Inference exactly as analysed: `compareArms` per contrast, `compareInteraction` when the interaction is in the family, `holm` over the family; every contrast of one replicate uses the same seeded task draws (stats.ts shares draws per seed), as the campaign does. Grid pass (approximate, labelled so): rule A suppression is applied with the campaign's resample count from ONE uniform per replicate shared by all contrasts (suppress contrast i when `u < 1 - (1 - q_i)^B`, q_i = exact probability that a task resample has no solve in one of its arms), so suppression is comonotone across contrasts rather than independent. Confirmation pass (exact, round 2 finding 2): the chosen design is re-run at the campaign's 10,000 resamples and rule A suppression is read from the actual shared bootstrap draws (`undefined_share > 0` or `ci === null`), so suppression and the Holm decisions come from the same draws; the design is accepted only on the confirmation numbers. Rule B suppresses when the defined share falls below its threshold (both passes).
6. Sensitivity (confirmation pass only, error control gating, power reported): three extra fits beside `fitted` and `stress`: `skew` (finite-moment log-normal scale mixture: with probability 0.1 the log-noise sd is 3 x `cell_sd`, else `cell_sd`; `noiseMean` gives its exact `E[exp(noise)]`, used by `populationCps`, so calibration and coverage truth match the simulated distribution; round 3 finding 2), `arm_missing` (missing-cost share doubled in the treated arms only) and `hetero` (latent solve rates widened: easy U(0.70, 0.99), intermediate U(0.10, 0.90), hard U(0.01, 0.30)). The chosen design must keep FWER within the fixed tolerance and coverage gates under each; power under them is reported, not gated.
Scenarios have analytic nulls: `null`; `C1` (lsp arm; C1 and the interaction non-null); `C2` (realistic+LSP arm; C2 and the interaction non-null); `C3` (realistic and realistic+LSP arms; C3 non-null, C2 exactly null). Mechanisms: `spend` (multiplier 0.8, exact for cost per solved) and `solve` (solve rate multiplier calibrated by bisection on the population cost per solved of the selected-task population, common random numbers, to a 20% reduction; infeasible calibration fails the scenario). Truth for coverage: 0 for null contrasts, the calibrated population delta otherwise.
Outputs per (design, scenario, mechanism, fit), for both rules from the same datasets: power of each affected family member in the expected direction, type I per null family member, FWER, suppression, coverage of the 95% interval per contrast with counts, selection-failure rate, each with Monte Carlo SE.
Precision (round 2 finding 5): the FWER tolerance is FIXED at `FWER_TOL = alpha + 2 x sqrt(alpha (1 - alpha) / 1000)` (0.0638 at alpha 0.05) whatever the simulation count, so lowering `sims` can never loosen the gate; every gating result needs at least `MIN_GATING_SIMS = 500` completed replicates (else `chooseRule`/`chooseDesign` throw `too few simulations for a gating decision`). Rule choice (stage A only, `chooseRule`): B (`min_defined_share 0.99`) only if under B, for every result, FWER <= FWER_TOL, every contrast's coverage has n >= 100 and >= 0.93, and B's mean suppression is lower than A's; else A. Design choice (`chooseDesign`, stage A and B, under the frozen rule only): the grid must be complete (all 14 scenario x mechanism x fit combinations for the design: 7 scenario-mechanism pairs x 2 fits; else throw); smallest N x R (ties to fewer repeats) where every result has power >= 0.80 for each affected family member, FWER <= FWER_TOL, suppression < 0.05, selection failures < 0.05, coverage n >= 100 and >= 0.93; then the confirmation pass re-evaluates that design's 14 combinations plus the three sensitivity fits at the campaign's 10,000 resamples with exact suppression and takes the next design if it fails; none: decision `null` (owner amendment). Runtime: the CLI writes every finished `DesignResult` to `<out>.partial.jsonl` and `--resume` skips combinations already there (same arguments, checked by hash), so a stopped run continues; M11-15 times `--sims 20` first.

**Files:**
- Create: `scripts/harness/power-sim.ts` (exports + `import.meta.main` CLI)
- Test: `tests/unit/scripts/power-sim.test.ts`

**Interfaces:**
- Consumes: `stratumOf`, `select`, `type Eligible`, `type Rules`, `type Kind` from `scripts/harness/screening.ts` (M8-02); `compareArms`, `compareInteraction`, `holm`, `ineligible`, `mulberry32`, `type Cell`, `type ZeroSolveRule` from `src/harness/stats.ts`.
- Produces: `Fit`, `fitCells`, `SCENARIOS`, `drawPool`, `selectTasks`, `simulateCells`, `undefinedProb`, `calibrate`, `evaluate`, `chooseRule`, `chooseDesign`.
- CLI stage A: `deno run --allow-read --allow-write scripts/harness/power-sim.ts --cells <report.json>... --arm-prefix cc- --rules harness-tasks/v2/screening.yml --out <file> [--sims 1000] [--resamples 1000] [--confirm-sims 500] [--confirm-resamples 10000] [--seed 20261003] [--pool-factor 2.0] [--rule-b-share 0.99] [--interaction exploratory|confirmatory] [--resume]` (pool factor shared with M8, appendix section 12). CLI stage B: `--prereg harness/preregistration/<exp>.yml` takes rule, interaction, alpha and every argument from the frozen stage A and refuses any overriding flag. Output: `{ v: 1, stage, script_sha256, args, inputs: [{ path, sha256 }], fit, stress_fit, results, zero_solve, decision: { design, confirmed } }`; `script_sha256` = sha256 of this script's bytes plus `scripts/harness/screening.ts` and `src/harness/stats.ts` (hashJson of the three file hashes).

- [ ] **Step 1: Failing tests** `tests/unit/scripts/power-sim.test.ts`:

```ts
import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { type Cell, mulberry32 } from "../../../src/harness/stats.ts";
import {
  calibrate, chooseDesign, chooseRule, type DesignResult, evaluate, expectedSpend, fitCells, noiseMean, selectTasks, simulateCells,
  undefinedProb,
} from "../../../scripts/harness/power-sim.ts";
import { RulesSchema } from "../../../scripts/harness/screening.ts";

const RULES = RulesSchema.parse({
  arms: ["cc-v2-plain", "cc-v2-realistic-lsp"], repeats: 3, easy_share: 0.2, hard_share: 0.2,
  kind_min: 2, kind_max_share: 0.4, required_coupling: ["single-instance", "temporary-table", "commit-behavior"],
  coupling_min: 1, large_min_share: 0.5,
  borrow: { easy: ["intermediate"], intermediate: ["hard", "easy"], hard: ["intermediate"] },
});
const FIT = { log_mean: Math.log(0.5), task_sd: 0.5, cell_sd: 0.4, arm_sd: 0.1, solved_ratio: 1.2, unknown_share: 0.05 };
const cell = (task: string, arm: string, repeat: number, pass: boolean, spend: number | null = 1): Cell => ({
  task, arm, repeat, status: "scored", pass, spend_usd: spend, known_spend_usd: spend ?? 0, attempts: 1,
});

Deno.test("fitCells: log mean and unknown share from terminal cells", () => {
  const cs = [1, 2, 3, 4].flatMap((r) => ["t1", "t2"].map((t) => cell(t, "a", r, r % 2 === 0, r === 4 && t === "t2" ? null : 1)));
  const f = fitCells(cs);
  assertAlmostEquals(f.log_mean, 0, 1e-12);
  assertEquals(f.unknown_share, 1 / 8);
});

Deno.test("undefinedProb: exact for two tasks, one never solved by the baseline", () => {
  const cs = [cell("t1", "b", 1, false), cell("t1", "v", 1, true), cell("t2", "b", 1, true), cell("t2", "v", 1, true)];
  assertAlmostEquals(undefinedProb(cs, ["b", "v"], 1), 0.25, 1e-12);
  assertAlmostEquals(undefinedProb(cs, ["b", "v"], 2), 1 - 0.75 ** 2, 1e-12);
});

Deno.test("selectTasks: M8 selection yields n tasks or a failure, deterministic per seed", () => {
  const run = { scenario: "null" as const, mechanism: "spend" as const, fit: FIT, multiplier: 1, poolFactor: 2 };
  const a = selectTasks({ tasks: 24, repeats: 3 }, run, RULES, mulberry32(4));
  const b = selectTasks({ tasks: 24, repeats: 3 }, run, RULES, mulberry32(4));
  assertEquals(a?.map((t) => t.id), b?.map((t) => t.id));
  assert(a === null || a.length === 24);
});

Deno.test("calibrate: spend is exactly 0.8 and leaves nulls at 0; solve reaches a 20% reduction", () => {
  const s = calibrate({ scenario: "C3", mechanism: "spend", fit: FIT, poolFactor: 2 }, { tasks: 24, repeats: 3 }, RULES, 9, 50);
  assertEquals([s.multiplier, s.truth.C1, s.truth.C2], [0.8, 0, 0]);
  assertAlmostEquals(s.ratio, 0.8, 1e-9);
  const v = calibrate({ scenario: "C1", mechanism: "solve", fit: FIT, poolFactor: 2 }, { tasks: 24, repeats: 3 }, RULES, 9, 50);
  assertAlmostEquals(v.ratio, 0.8, 0.005);
});

Deno.test("evaluate: deterministic; a big C1 effect is found; null scenario reports FWER", () => {
  const o = { sims: 20, resamples: 200, campaignResamples: 10000, seed: 5, alpha: 0.05, ruleBShare: 0.99, family: ["C1", "C2", "C3"], rules: RULES };
  const spec = { scenario: "C1" as const, mechanism: "spend" as const, fitName: "fitted" as const, fit: FIT, multiplier: 0.4, poolFactor: 2, truth: { C1: -0.4, C2: 0, C3: 0, interaction: 0.4 } };
  const r1 = evaluate({ tasks: 30, repeats: 5 }, spec, o);
  assertEquals(r1, evaluate({ tasks: 30, repeats: 5 }, spec, o));
  assert(r1.byRule.A.power.C1!.p > 0.5);
  const nul = evaluate({ tasks: 24, repeats: 3 }, { ...spec, scenario: "null", multiplier: 1, truth: { C1: 0, C2: 0, C3: 0, interaction: 0 } }, o);
  assertEquals(Object.keys(nul.byRule.A.power), []);
  assert(nul.byRule.A.fwer !== null);
});

const P = (p: number, n = 1000) => ({ p, n, mcse: Math.sqrt((p * (1 - p)) / n) });
const res = (tasks: number, repeats: number, o: { power?: number; fwer?: number; sup?: number; cov?: number; covB?: number; scenario?: string } = {}): DesignResult => {
  const stats = (cov: number) => ({
    power: o.scenario === "null" ? {} : { C1: P(o.power ?? 0.9) },
    type1: { C2: P(0.01), C3: P(0.01) },
    fwer: P(o.fwer ?? 0.03),
    suppressed: P(o.sup ?? 0.01),
    coverage: { C1: P(cov, 900), C2: P(cov, 900), C3: P(cov, 900) },
  });
  return {
    design: { tasks, repeats }, scenario: o.scenario ?? "C1", mechanism: "spend", fit: "fitted", exact: false, multiplier: 0.8,
    selection_failures: P(0.01), byRule: { A: stats(o.cov ?? 0.95), B: stats(o.covB ?? 0.9) },
  };
};
const grid = (tasks: number, repeats: number, o: Parameters<typeof res>[2] = {}) =>
  ["null", "C1", "C2", "C3"].flatMap((scenario) =>
    (scenario === "null" ? ["spend"] : ["spend", "solve"]).flatMap((mechanism) =>
      ["fitted", "stress"].map((fit) => ({ ...res(tasks, repeats, { ...o, scenario }), mechanism, fit }) as DesignResult)
    )
  );

Deno.test("chooseRule: B only when its coverage and error control hold everywhere and it suppresses less", () => {
  assertEquals(chooseRule(grid(30, 5)), { rule: "suppress_any_undefined" });
  assertEquals(chooseRule(grid(30, 5, { covB: 0.95 }).map((r) => ({ ...r, byRule: { A: r.byRule.A, B: { ...r.byRule.B, suppressed: P(0) } } }))), { rule: "min_defined_share", share: 0.99 });
});

Deno.test("chooseDesign: gates on power, FWER, suppression and coverage; an incomplete grid throws", () => {
  const all = [...grid(40, 5), ...grid(30, 5), ...grid(24, 8, { power: 0.7 })];
  assertEquals(chooseDesign(all, "A"), { tasks: 30, repeats: 5 });
  assertEquals(chooseDesign([...grid(30, 5, { fwer: 0.09 })], "A"), null);
  assertEquals(chooseDesign([...grid(30, 5, { cov: 0.9 })], "A"), null);
  assertThrows(() => chooseDesign(grid(30, 5).slice(1), "A"), Error, "incomplete");
});

Deno.test("gates: the FWER tolerance is fixed and too few simulations refuse a gating decision", () => {
  // 0.06 passes the fixed 0.0638 tolerance; with 100 replicates alpha + 2 SE would have been 0.094.
  assertEquals(chooseDesign(grid(30, 5, { fwer: 0.06 }), "A"), { tasks: 30, repeats: 5 });
  assertEquals(chooseDesign(grid(30, 5, { fwer: 0.07 }), "A"), null);
  const few = grid(30, 5).map((r) => ({ ...r, byRule: { A: { ...r.byRule.A, suppressed: P(0.01, 100) }, B: r.byRule.B } }));
  assertThrows(() => chooseDesign(few, "A"), Error, "too few simulations");
  assertThrows(() => chooseRule(few), Error, "too few simulations");
});

Deno.test("skew sensitivity: finite-moment noise whose simulated mean matches the analytic truth within Monte Carlo error", () => {
  for (const sens of [undefined, "skew"] as const) {
    const fit = { ...FIT, sens };
    const run = { scenario: "null" as const, mechanism: "spend" as const, fit, multiplier: 1, poolFactor: 2 };
    const t = {
      id: "S000", p: 0.5, mu: Math.log(0.5), kind: "feature" as const, coupling: [], large: true,
      dev: { plain: 0, lsp: 0, real: 0, real_lsp: 0 },
    };
    const cells = simulateCells([t], 50_000, run, mulberry32(11)).filter((c) => c.arm === "plain");
    const xs = cells.map((c) => c.known_spend_usd);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const se = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) / xs.length);
    const truth = expectedSpend(t, "plain", run);
    assert(Math.abs(mean - truth) < 4 * se, `${sens ?? "gaussian"}: simulated ${mean} vs analytic ${truth} (se ${se})`);
    assert(Number.isFinite(noiseMean(fit)));
  }
  // The mixture really is heavier-tailed than the Gaussian fit.
  assert(noiseMean({ ...FIT, sens: "skew" }) > noiseMean(FIT));
});

Deno.test("evaluate: exact mode reads rule-A suppression from the shared bootstrap draws", () => {
  const o = { sims: 20, resamples: 200, campaignResamples: 200, seed: 5, alpha: 0.05, ruleBShare: 0.99, family: ["C1", "C2", "C3"], rules: RULES };
  const spec = { scenario: "null" as const, mechanism: "spend" as const, fitName: "fitted" as const, fit: FIT, multiplier: 1, poolFactor: 2, truth: { C1: 0, C2: 0, C3: 0, interaction: 0 } };
  const r = evaluate({ tasks: 24, repeats: 3 }, spec, { ...o, exact: true });
  assertEquals(r.exact, true);
  assertEquals(r, evaluate({ tasks: 24, repeats: 3 }, spec, { ...o, exact: true }));
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `scripts/harness/power-sim.ts`:

```ts
// Usage: see the module doc of the CLI below.
// Simulates the frozen v2 pipeline: M8 screening and selection, the campaign,
// and the pre-registered inference (compareArms, compareInteraction, holm).

import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import {
  type Cell, checkCells, compareArms, compareInteraction, holm, ineligible, mulberry32, type ZeroSolveRule,
} from "../../src/harness/stats.ts";
import { type Eligible, type Rules, select, stratumOf } from "./screening.ts";

export interface Fit {
  log_mean: number; task_sd: number; cell_sd: number; arm_sd: number; solved_ratio: number; unknown_share: number;
  /** Confirmation-only sensitivity (round 2 finding 2): skewed costs, arm-dependent missingness, wider solve heterogeneity. */
  sens?: "skew" | "arm_missing" | "hetero";
}
export const SENSITIVITY = ["skew", "arm_missing", "hetero"] as const;
export const SIM_ARMS = ["plain", "lsp", "real", "real_lsp"] as const;
export type SimArm = (typeof SIM_ARMS)[number];
export const CONTRASTS = [
  { id: "C1", baseline: "plain", variant: "lsp" },
  { id: "C2", baseline: "real", variant: "real_lsp" },
  { id: "C3", baseline: "plain", variant: "real" },
] as const;
const INTERACTION = { plain: "plain", lsp: "lsp", realistic: "real", realistic_lsp: "real_lsp" };
export type ScenarioName = "null" | "C1" | "C2" | "C3";
/** Affected arms and, analytically, the non-null family members with their expected sign. */
export const SCENARIOS: Record<ScenarioName, { arms: SimArm[]; signs: Record<string, -1 | 1>; target: { baseline: SimArm; variant: SimArm } | null }> = {
  null: { arms: [], signs: {}, target: null },
  C1: { arms: ["lsp"], signs: { C1: -1, interaction: 1 }, target: { baseline: "plain", variant: "lsp" } },
  C2: { arms: ["real_lsp"], signs: { C2: -1, interaction: -1 }, target: { baseline: "real", variant: "real_lsp" } },
  C3: { arms: ["real", "real_lsp"], signs: { C3: -1 }, target: { baseline: "plain", variant: "real" } },
};
export interface Design { tasks: number; repeats: number }
export interface RunSpec { scenario: ScenarioName; mechanism: "spend" | "solve"; fit: Fit; multiplier: number; poolFactor: number }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
function normal(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}

export function fitCells(cells: Cell[]): Fit {
  checkCells(cells);
  const term = cells.filter((c) => c.status === "scored" || c.status === "unscored");
  const known = term.filter((c) => c.spend_usd !== null && c.spend_usd > 0);
  const group = (k: (c: Cell) => string) => {
    const m = new Map<string, Cell[]>();
    for (const c of known) m.set(k(c), [...(m.get(k(c)) ?? []), c]);
    return m;
  };
  const logs = (cs: Cell[]) => cs.map((c) => Math.log(c.spend_usd!));
  const byTask = group((c) => c.task);
  const byTaskArm = group((c) => `${c.task}\u0000${c.arm}`);
  const taskMean = new Map([...byTask].map(([t, cs]) => [t, mean(logs(cs))]));
  const within = [...byTaskArm.values()].flatMap((cs) => { const m = mean(logs(cs)); return logs(cs).map((x) => x - m); });
  const armDev = [...byTaskArm.values()].map((cs) => mean(logs(cs)) - taskMean.get(cs[0]!.task)!);
  const solvedDiff = [...byTask.values()].flatMap((cs) => {
    const s = cs.filter((c) => c.pass === true);
    const u = cs.filter((c) => c.pass !== true);
    return s.length > 0 && u.length > 0 ? [mean(logs(s)) - mean(logs(u))] : [];
  });
  return {
    log_mean: mean([...taskMean.values()]),
    task_sd: sd([...taskMean.values()]),
    cell_sd: within.length < 2 ? 0 : Math.sqrt(within.reduce((a, x) => a + x * x, 0) / (within.length - 1)),
    arm_sd: sd(armDev),
    solved_ratio: solvedDiff.length === 0 ? 1 : Math.exp(mean(solvedDiff)),
    unknown_share: term.filter((c) => c.spend_usd === null).length / term.length,
  };
}

export interface SimTask { id: string; p: number; mu: number; dev: Record<SimArm, number>; kind: Eligible["kind"]; coupling: string[]; large: boolean }

const PRIOR = ["easy", "easy", ...Array(8).fill("intermediate"), "hard", "hard"] as const;
const KIND_CYCLE: Eligible["kind"][] = ["feature", "feature", "feature", "feature", "bugfix", "bugfix", "bugfix", "refactor", "refactor", "refactor", "test-authoring", "test-authoring"];

export function drawPool(n: number, run: RunSpec, rules: Rules, rand: () => number): SimTask[] {
  const size = Math.ceil(run.poolFactor * n);
  return Array.from({ length: size }, (_, i) => {
    const prior = PRIOR[i % 12]!;
    const wide = run.fit.sens === "hetero";
    const p = prior === "easy"
      ? (wide ? 0.7 + 0.29 * rand() : 0.8 + 0.17 * rand())
      : prior === "hard"
      ? (wide ? 0.01 + 0.29 * rand() : 0.03 + 0.17 * rand())
      : (wide ? 0.1 + 0.8 * rand() : 0.2 + 0.6 * rand());
    return {
      id: `S${String(i).padStart(3, "0")}`,
      p,
      mu: run.fit.log_mean + run.fit.task_sd * normal(rand),
      dev: Object.fromEntries(SIM_ARMS.map((a) => [a, run.fit.arm_sd * normal(rand)])) as Record<SimArm, number>,
      kind: KIND_CYCLE[i % 12]!,
      coupling: i % 4 === 0 ? [rules.required_coupling[(i / 4) % rules.required_coupling.length]!] : [],
      large: i % 12 < 8,
    };
  });
}

const affected = (run: RunSpec, a: SimArm) => SCENARIOS[run.scenario].arms.includes(a);
export const pArm = (t: SimTask, a: SimArm, run: RunSpec) =>
  run.mechanism === "solve" && affected(run, a) ? Math.min(0.98, t.p * run.multiplier) : t.p;
const spendMult = (a: SimArm, run: RunSpec) => run.mechanism === "spend" && affected(run, a) ? run.multiplier : 1;

/** M8's screening and selection on a simulated pool; null on a shortfall. */
export function selectTasks(design: Design, run: RunSpec, rules: Rules, rand: () => number): SimTask[] | null {
  const pool = drawPool(design.tasks, run, rules, rand);
  const eligible: Eligible[] = [];
  for (const t of pool) {
    let solved = 0;
    for (const a of ["plain", "real_lsp"] as const) for (let i = 0; i < rules.repeats; i++) if (rand() < pArm(t, a, run)) solved++;
    const s = stratumOf(solved, 2 * rules.repeats);
    if (s !== "dead" && s !== "saturated") eligible.push({ id: t.id, stratum: s, kind: t.kind, coupling: t.coupling, large: t.large });
  }
  const rank = new Map(pool.map((t) => [t.id, rand().toFixed(12)]));
  const sel = select(eligible, design.tasks, rules, rank);
  if (sel.shortfalls.length > 0) return null;
  const byId = new Map(pool.map((t) => [t.id, t]));
  return sel.selected.map((id) => byId.get(id)!);
}

/**
 * Skew sensitivity (round 3 finding 2): a log-normal scale mixture with finite
 * moments. With probability SKEW_W the log-noise standard deviation is
 * SKEW_K x cell_sd, else cell_sd; the cost is right-skewed with a heavier tail
 * than the Gaussian fit, and E[exp(noise)] is exact (noiseMean).
 */
export const SKEW_W = 0.1;
export const SKEW_K = 3;
/** Exact E[exp(log-noise)] of a cell under the fit (Gaussian, or the skew mixture). */
export function noiseMean(fit: Fit): number {
  const s2 = fit.cell_sd ** 2;
  return fit.sens === "skew"
    ? (1 - SKEW_W) * Math.exp(s2 / 2) + SKEW_W * Math.exp((SKEW_K ** 2 * s2) / 2)
    : Math.exp(s2 / 2);
}
function logNoise(fit: Fit, rand: () => number): number {
  const scale = fit.sens === "skew" && rand() < SKEW_W ? SKEW_K * fit.cell_sd : fit.cell_sd;
  return scale * normal(rand);
}
/** Exact expected spend of task t in arm a with its drawn arm deviation (the coverage and calibration truth uses the same terms). */
export function expectedSpend(t: SimTask, a: SimArm, run: RunSpec): number {
  const half = Math.log(run.fit.solved_ratio) / 2;
  const p = pArm(t, a, run);
  return Math.exp(t.mu + t.dev[a]) * noiseMean(run.fit) * spendMult(a, run) * (p * Math.exp(half) + (1 - p) * Math.exp(-half));
}

export function simulateCells(tasks: SimTask[], repeats: number, run: RunSpec, rand: () => number): Cell[] {
  const half = Math.log(run.fit.solved_ratio) / 2;
  const out: Cell[] = [];
  for (const t of tasks) {
    for (let r = 1; r <= repeats; r++) {
      for (const a of SIM_ARMS) {
        const pass = rand() < pArm(t, a, run);
        const spend = Math.exp(t.mu + t.dev[a] + logNoise(run.fit, rand) + (pass ? half : -half)) * spendMult(a, run);
        // arm_missing: the treated arms lose cost twice as often as plain.
        const share = run.fit.sens === "arm_missing" && a !== "plain" ? Math.min(1, 2 * run.fit.unknown_share) : run.fit.unknown_share;
        const unknown = rand() < share;
        out.push({ task: t.id, arm: a, repeat: r, status: "scored", pass, spend_usd: unknown ? null : spend, known_spend_usd: spend, attempts: 1 });
      }
    }
  }
  return out;
}

/** P(a campaign bootstrap of B task resamples hits a resample with no solve in some arm), over blocks eligible in every arm. */
export function undefinedProb(cells: Cell[], arms: readonly string[], B: number): number {
  const byKey = new Map<string, Map<string, Cell>>();
  for (const c of cells.filter((x) => arms.includes(x.arm))) {
    const k = `${c.task}\u0000${c.repeat}`;
    byKey.set(k, (byKey.get(k) ?? new Map()).set(c.arm, c));
  }
  const solved = new Map<string, Set<string>>();
  const tasks = new Set<string>();
  for (const m of byKey.values()) {
    if (!arms.every((a) => m.has(a) && ineligible(m.get(a)!, "cost_per_solved_task") === null)) continue;
    const task = m.get(arms[0]!)!.task;
    tasks.add(task);
    for (const a of arms) if (m.get(a)!.pass) solved.set(task, (solved.get(task) ?? new Set()).add(a));
  }
  const T = tasks.size;
  if (T === 0) return 1;
  let q = 0;
  for (let mask = 1; mask < 1 << arms.length; mask++) {
    const S = arms.filter((_, i) => mask & (1 << i));
    const z = [...tasks].filter((t) => S.every((a) => !solved.get(t)?.has(a))).length;
    q += (S.length % 2 === 1 ? 1 : -1) * (z / T) ** T;
  }
  return 1 - (1 - q) ** B;
}

/** Population cost per solved per arm over the selected-task population (K selections, analytic within task). */
function populationCps(design: Design, run: RunSpec, rules: Rules, seed: number, K: number): Record<SimArm, number> {
  const rand = mulberry32(seed >>> 0);
  const half = Math.log(run.fit.solved_ratio) / 2;
  const spend = Object.fromEntries(SIM_ARMS.map((a) => [a, 0])) as Record<SimArm, number>;
  const solve = { ...spend };
  for (let k = 0; k < K; k++) {
    for (const t of selectTasks(design, run, rules, rand) ?? []) {
      for (const a of SIM_ARMS) {
        const p = pArm(t, a, run);
        // Arm deviations are integrated out analytically (same distribution in every arm), so unaffected arms are exactly equal.
        // Same noise term as simulateCells (noiseMean: Gaussian or the skew mixture, exact).
        spend[a] += Math.exp(t.mu + run.fit.arm_sd ** 2 / 2) * noiseMean(run.fit) * spendMult(a, run) * (p * Math.exp(half) + (1 - p) * Math.exp(-half));
        solve[a] += p;
      }
    }
  }
  return Object.fromEntries(SIM_ARMS.map((a) => [a, spend[a] / solve[a]])) as Record<SimArm, number>;
}

/** Effect multiplier giving a 20% lower population cost per solved on the scenario's target contrast; nulls are exactly 0. */
export function calibrate(
  spec: Omit<RunSpec, "multiplier">,
  design: Design,
  rules: Rules,
  seed: number,
  K = 200,
): { multiplier: number; ratio: number; truth: Record<string, number> } {
  const sc = SCENARIOS[spec.scenario];
  const at = (m: number) => populationCps(design, { ...spec, multiplier: m }, rules, seed, K);
  let multiplier = 1;
  if (sc.target) {
    if (spec.mechanism === "spend") multiplier = 0.8;
    else {
      const ratio = (m: number) => { const c = at(m); return c[sc.target!.variant] / c[sc.target!.baseline]; };
      let lo = 1;
      let hi = 3;
      if (ratio(hi) > 0.8) throw new Error(`${spec.scenario} solve: a 20% reduction is not reachable (solve rate cap)`);
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (ratio(mid) > 0.8) lo = mid;
        else hi = mid;
      }
      multiplier = hi;
    }
  }
  const c = at(multiplier);
  const delta = (b: SimArm, v: SimArm) => c[v] - c[b];
  const truth: Record<string, number> = {};
  for (const x of CONTRASTS) truth[x.id] = sc.signs[x.id] ? delta(x.baseline, x.variant) : 0;
  truth.interaction = sc.signs.interaction ? delta("real", "real_lsp") - delta("plain", "lsp") : 0;
  return { multiplier, ratio: sc.target ? c[sc.target.variant] / c[sc.target.baseline] : 1, truth };
}

export interface Prop { p: number; n: number; mcse: number }
const prop = (x: number, n: number): Prop => {
  const p = n === 0 ? 0 : x / n;
  return { p, n, mcse: n === 0 ? 0 : Math.sqrt((p * (1 - p)) / n) };
};
export interface RuleStats {
  power: Record<string, Prop>;
  type1: Record<string, Prop>;
  fwer: Prop | null;
  suppressed: Prop;
  coverage: Record<string, Prop>;
}
export type FitName = "fitted" | "stress" | (typeof SENSITIVITY)[number];
export interface DesignResult {
  design: Design;
  scenario: string;
  mechanism: RunSpec["mechanism"];
  fit: FitName;
  /** true when suppression was read from the actual shared bootstrap draws (confirmation pass). */
  exact: boolean;
  multiplier: number;
  selection_failures: Prop;
  byRule: { A: RuleStats; B: RuleStats };
}

export function evaluate(
  design: Design,
  spec: RunSpec & { fitName: FitName; truth: Record<string, number> },
  o: { sims: number; resamples: number; campaignResamples: number; seed: number; alpha: number; ruleBShare: number; family: string[]; rules: Rules; exact?: boolean },
): DesignResult {
  const rand = mulberry32(o.seed >>> 0);
  const signs = SCENARIOS[spec.scenario].signs;
  const fam = o.family;
  const counts = () => ({
    hit: Object.fromEntries(fam.filter((id) => signs[id]).map((id) => [id, 0])),
    t1: Object.fromEntries(fam.filter((id) => !signs[id]).map((id) => [id, 0])),
    fw: 0,
    sup: 0,
    cov: Object.fromEntries(fam.map((id) => [id, [0, 0]])) as Record<string, number[]>,
  });
  const by = { A: counts(), B: counts() };
  let fails = 0;
  let ran = 0;
  const loose: ZeroSolveRule = { rule: "min_defined_share", share: Number.EPSILON };
  for (let s = 0; s < o.sims; s++) {
    const tasks = selectTasks(design, spec, o.rules, rand);
    if (tasks === null) {
      fails++;
      continue;
    }
    ran++;
    const cells = simulateCells(tasks, design.repeats, spec, rand);
    const boot = { resamples: o.resamples, seed: (o.seed + s) >>> 0, level: 0.95, zeroSolve: loose };
    const comps = fam.map((id) => {
      if (id === "interaction") return { id, c: compareInteraction(cells, INTERACTION, "cost_per_solved_task", boot), arms: [...SIM_ARMS] as string[] };
      const x = CONTRASTS.find((k) => k.id === id)!;
      return { id, c: compareArms(cells, x.baseline, x.variant, "cost_per_solved_task", boot), arms: [x.baseline, x.variant] as string[] };
    });
    // Exact (confirmation): rule A read from the same shared draws the analysis uses.
    // Grid: one uniform per replicate for all contrasts (comonotone, approximate).
    const u = rand();
    const supA = o.exact
      ? comps.map((x) => x.c.undefined_share > 0 || x.c.ci === null)
      : comps.map((x) => u < undefinedProb(cells, x.arms, o.campaignResamples));
    const supB = comps.map((x) => 1 - x.c.undefined_share < o.ruleBShare || x.c.ci === null);
    for (const [key, sup] of [["A", supA], ["B", supB]] as const) {
      const k = by[key];
      const ps = comps.map((x, i) => (sup[i] ? null : x.c.p_value ?? null));
      const h = holm(ps, o.alpha);
      let anyNull = false;
      comps.forEach((x, i) => {
        if (signs[x.id]) {
          if (h.reject[i] && Math.sign(x.c.delta ?? 0) === signs[x.id]) k.hit[x.id]!++;
        } else if (h.reject[i]) {
          k.t1[x.id]!++;
          anyNull = true;
        }
        const ci = sup[i] ? null : x.c.ci;
        if (ci) {
          k.cov[x.id]![1]!++;
          if (ci[0] <= spec.truth[x.id]! && spec.truth[x.id]! <= ci[1]) k.cov[x.id]![0]!++;
        }
      });
      if (anyNull) k.fw++;
      if (sup.some(Boolean)) k.sup++;
    }
  }
  const stats = (k: ReturnType<typeof counts>): RuleStats => ({
    power: Object.fromEntries(Object.entries(k.hit).map(([id, x]) => [id, prop(x, ran)])),
    type1: Object.fromEntries(Object.entries(k.t1).map(([id, x]) => [id, prop(x, ran)])),
    fwer: Object.keys(k.t1).length > 0 ? prop(k.fw, ran) : null,
    suppressed: prop(k.sup, ran),
    coverage: Object.fromEntries(Object.entries(k.cov).map(([id, [c, n]]) => [id, prop(c!, n!)])),
  });
  return {
    design,
    scenario: spec.scenario,
    mechanism: spec.mechanism,
    fit: spec.fitName,
    exact: o.exact === true,
    multiplier: spec.multiplier,
    selection_failures: prop(fails, o.sims),
    byRule: { A: stats(by.A), B: stats(by.B) },
  };
}

const ALPHA = 0.05;
/** Fixed tolerance (round 2 finding 5): never widens when fewer simulations are run. */
export const FWER_TOL = ALPHA + 2 * Math.sqrt((ALPHA * (1 - ALPHA)) / 1000);
export const MIN_GATING_SIMS = 500;
const fwerOk = (s: RuleStats) => s.fwer === null || s.fwer.p <= FWER_TOL;
const coverageOk = (s: RuleStats) => Object.values(s.coverage).every((c) => c.n >= 100 && c.p >= 0.93);
function enoughSims(results: DesignResult[]): void {
  const low = results.filter((r) => [r.byRule.A, r.byRule.B].some((s) => s.suppressed.n < MIN_GATING_SIMS));
  if (low.length > 0) {
    throw new Error(`too few simulations for a gating decision: ${low.length} results under ${MIN_GATING_SIMS} replicates`);
  }
}

export function chooseRule(results: DesignResult[]): ZeroSolveRule {
  enoughSims(results);
  const meanSup = (k: "A" | "B") => mean(results.map((r) => r.byRule[k].suppressed.p));
  const bOk = results.every((r) => fwerOk(r.byRule.B) && coverageOk(r.byRule.B)) && meanSup("B") < meanSup("A");
  return bOk ? { rule: "min_defined_share", share: 0.99 } : { rule: "suppress_any_undefined" };
}

const EXPECTED = ["null|spend", "C1|spend", "C1|solve", "C2|spend", "C2|solve", "C3|spend", "C3|solve"]
  .flatMap((s) => ["fitted", "stress"].map((f) => `${s}|${f}`));

export function chooseDesign(results: DesignResult[], key: "A" | "B"): Design | null {
  enoughSims(results);
  const designs = [...new Map(results.map((r) => [`${r.design.tasks}x${r.design.repeats}`, r.design])).values()]
    .sort((a, b) => a.tasks * a.repeats - b.tasks * b.repeats || a.repeats - b.repeats);
  for (const d of designs) {
    const mine = results.filter((r) => r.design.tasks === d.tasks && r.design.repeats === d.repeats && (r.fit === "fitted" || r.fit === "stress"));
    const have = new Set(mine.map((r) => `${r.scenario}|${r.mechanism}|${r.fit}`));
    const lack = EXPECTED.filter((e) => !have.has(e));
    if (lack.length > 0) throw new Error(`simulation grid incomplete for ${d.tasks}x${d.repeats}: ${lack.join(", ")}`);
    const pass = mine.every((r) => {
      const s = r.byRule[key];
      return Object.values(s.power).every((p) => p.p >= 0.8) && fwerOk(s) && s.suppressed.p < 0.05 &&
        r.selection_failures.p < 0.05 && coverageOk(s);
    });
    if (pass) return d;
  }
  return null;
}
```

CLI under `if (import.meta.main)`: parse args (`string: ["out", "arm-prefix", "rules", "prereg", "interaction"]`, `boolean: ["resume"]`, `collect: ["cells"]`, numbers via `Number()` with validation, `--pool-factor` default 2.0, exit 2 on bad input); refuse an existing `--out`; with `--resume`, read `<out>.partial.jsonl`, refuse it when its first line's `args_sha256` differs from the current arguments' hash, and skip every (design, scenario, mechanism, fit, exact) key it holds; read `--rules` with `RulesSchema` (from `screening.ts`, the `rules` key of the registry file); read every `--cells` file's `.cells`, keep arms starting with `--arm-prefix`, `fitCells` for `fitted`, `stress` = task_sd x 1.5, arm_sd x 2; family = C1-C3 plus `interaction` when `--interaction confirmatory`; for every design in [24, 30, 40] x [3, 5, 8], every scenario x mechanism (null once) x fit: `calibrate` then `evaluate`; print `[sim] 30x5 C1 solve stress: power A 0.82 (se 0.012) B 0.84, fwer A 0.03, sup A 0.03, cov A 0.94` per evaluation. Stage A (`--prereg` absent): `zero_solve = chooseRule(results)`. Stage B (`--prereg` given): load the stage-A document with `PreregSchema`, take `zero_solve`, family, alpha and every argument from it, refuse any CLI flag that differs. Then `design = chooseDesign(results, zero_solve is suppress_any_undefined ? "A" : "B")`; confirmation: re-run `evaluate` with `exact: true` for that design's 14 combinations (7 scenario-mechanism pairs x `fitted`/`stress`) plus the three `SENSITIVITY` fits of each non-null scenario-mechanism pair and the null scenario, with `resamples = campaignResamples = confirm_resamples`, `sims = confirm_sims`; the design is confirmed when `chooseDesign` accepts the 14 exact combinations and every sensitivity result passes `fwerOk` and `coverageOk` (power reported); if not, drop that design and repeat; every finished result is appended to `<out>.partial.jsonl` and `--resume` skips results already there; write the output JSON with `script_sha256` = `hashJson` of the sha256 of this file, `scripts/harness/screening.ts` and `src/harness/stats.ts`; print `[OK] zero-solve ..., design NxR` or `[WARN] no design meets the frozen rule: owner amendment needed`.

- [ ] **Step 4: Run** `deno test --allow-all tests/unit/scripts/power-sim.test.ts` (under 60 s; lower `sims`/`resamples` in the `evaluate` tests if needed, never the thresholds, `FWER_TOL` or `MIN_GATING_SIMS`).

- [ ] **Step 5: Smoke** on v1 data into scratch: `deno run --allow-read --allow-write scripts/harness/power-sim.ts --cells H:/cg-coord/m6/reports/cc-mcp-vs-plain.campaign.json --arm-prefix cc- --rules harness-tasks/v2/screening.yml --sims 5 --resamples 100 --confirm-sims 5 --confirm-resamples 200 --pool-factor 2.0 --out <scratch>/sim-smoke.json`. Expected: `<scratch>/sim-smoke.json.partial.jsonl` holds 9 designs x 14 combinations, and the run stops with `too few simulations for a gating decision` (the 500-replicate floor works); rerunning with `--resume` reuses every partial line without recomputing it.

- [ ] **Step 6: check/lint/fmt; commit**

```bash
git add scripts/harness/power-sim.ts tests/unit/scripts/power-sim.test.ts
git commit -m "feat(harness): simulate the frozen selection and inference pipeline (M11-13)"
```

---

### Task M11-14: Measure qualification (gate 6)

Lane: lane-ops (containers). Deps: M11-07; M8-06 and M8-07 (wave 1 fixtures, measures and A9 split, gated by 10-12); H-01. Window 10-16..10-20.

Fixtures M8 delivers (appendix section 7; M8-06, gated with A9 by 10-12): for every non-test-authoring candidate `measures/measures.yml` with weights over the new-requirement rows and `hidden_regressions` for the rest, split from the candidate's first promoted gate report before the seal (M8 A9), and an `expect` per variant; for at least 3 reuse-flagged candidates (M8 `size.reuse`) `reuse.targets` (with `signature` and `perturb`) and `reuse.tests`, plus measurement-only variants `fixture/duplicated-logic` (expect `reuse_executed: false, reuse: false`), `fixture/dead-call` (target called on a branch the tests never take: `false, false`), `fixture/comment-only` (`false, false`), `fixture/token-call` (called, result ignored: `reuse_executed: true, reuse: false`), and on at least one of them `fixture/caught-call` (called inside a `[TryFunction]`; expectation written by the author under M11-06's rule "executed = marker observed OR effective", typically `true, true` when the result is used); `correct` expects `reuse_executed: true, reuse: true, partial_credit: 1, final_errors: 0`. For the final-code check one task gets `fixture/unused-variable` expecting `new_warning_codes: [AA0137]`. Measurement-only variants never change any oracle and are not naive variants. Step 3 also checks each `measures.yml` split against the candidate's gate report (the A9 `jq` of M8), a difference is a failed expectation.

- [ ] **Step 1:** No bench live (`find results/.bench-running.json -mmin -2` empty); Cronus281-283 healthy.
- [ ] **Step 2: Canary:** compile `harness/analysis/canary` with analyzers on a real container (`judge-fixture` of any task with `--measures` runs it); record every code it emits; add one UICop code that a page in the canary reliably triggers (add a minimal page to the canary if none fires) to `expect.json` via lane-infra2; re-run until `analyzers` is non-null.
- [ ] **Step 3:** For every candidate and every listed variant (`correct`, `naive/*`, `fixture/*`): `deno task start harness judge-fixture <task> <variant> --measures --secrets-dir <dir> --containers Cronus281,Cronus282,Cronus283 --manifest <qualification manifest>`. Expected: every expectation `[OK]`.
- [ ] **Step 4: Determinism:** `correct` of 3 tasks twice: equal `measures.json` apart from ids.
- [ ] **Step 5: Real-container facts:** `AA0137` arrives with its code (parser change, BCH switches); the probe's `CG-REUSE-PROBE` text reaches the test message; `relDiagFile` of a real compile gives `<App>/src/...` (one `host-log.jsonl` from `scripts/harness/backend-probe.ts`).
- [ ] **Step 6:** `H:\cg-coord\m11\qualification.md`: per task and variant expected vs got, measure fingerprint, compiler identity, ruleset sha256, canary codes, failures. A failed expectation is fixed in the measure or the fixture, then re-run; never by loosening the expectation. M11 and M9 jointly sign off gate 3 here: M11 confirms that on M9-13's live captures every counted execution has `usage_reconciliation.status === "exact"` (a `compaction_excess` run keeps its cost but is not gate 3 evidence; appendix section 6), non-empty `per_model`, and `cellValues` token totals equal to the sum of the parent and sub-agent rows.

---

### Task M11-15: Stage-A simulation run (zero-solve rule, N_prelim)

Lane: lane-ops (host CPU only). Deps: M11-13, M8-02 rules committed. Window 10-10..10-13 (M8-07b and M8-12 need N_prelim by 10-13; appendix section 13).

- [ ] **Step 1:** Time `--sims 20` (into scratch) and report the extrapolation for the grid plus confirmation; if the full run does not finish by 10-13, run it in checkpointed parts with `--resume` (never lower `--sims` below 1000 or `--confirm-sims` below 500: gating needs `MIN_GATING_SIMS`). Then run in the background: `deno run --allow-read --allow-write scripts/harness/power-sim.ts --cells H:/cg-coord/m6/reports/cc-mcp-vs-plain.campaign.json --cells H:/cg-coord/m6/reports/cc-skills-vs-plain.campaign.json --cells H:/cg-coord/m6/reports/cc-vs-pi.campaign.json --arm-prefix cc- --rules harness-tasks/v2/screening.yml --sims 1000 --resamples 1000 --confirm-sims 500 --confirm-resamples 10000 --seed 20261003 --pool-factor 2.0 --rule-b-share 0.99 --interaction exploratory --out harness/preregistration/cc-v2-factorial.sim-a.json`. The interaction stays exploratory (owner default, round 3 decisions), so no `--interaction confirmatory` run is needed.
- [ ] **Step 2:** `H:\cg-coord\m11\sim-a.md`: fit (v1 rests on 6 tasks: heterogeneity is the stress fit's job), chosen zero-solve rule with coverage and FWER tables, per design power/type I/FWER/suppression/selection failures with SE, calibrated multipliers, interaction power, the exact confirmation and sensitivity results of the provisional design, provisional design (= N_prelim for M8-07b and M8-12) and, from the selection-failure rates, whether `pool_factor` 2.0 is enough (shared with M8, appendix section 12). Send the path to M8 on 10-13.

---

### Task M11-16: Stage A freeze

Lane: orchestrator drafts, owner approves. Deps: M11-10, M11-14, M11-15, M8-15a (start seal and the four held-out ids), M9-08 (`cc-v2-factorial`). Window 10-22..10-24: AFTER M8's start seal (M8-15a, 10-21) and BEFORE screening (M8-15b, 10-25) (appendix section 11).

- [ ] **Step 1:** lane-infra adds to `harness/experiments/cc-v2-factorial.yml` the `contrasts` and `interaction` of M11-08 (interaction `status: exploratory`, owner default) and `preregistration: preregistration/cc-v2-factorial.yml`; `deno task start harness validate` stays green. Then write `harness/preregistration/cc-v2-factorial.yml` in the `STAGE_A` shape of M11-10: protocol from the experiment; `zero_solve` from `sim-a.json`; bootstrap 10000 resamples, seed 20261021; interaction exploratory (owner default; never changed later); `measures.fingerprint` from `measureFingerprint()`, `unknown_symbol_codes` `[AL0118, AL0132, AL0185]` (owner default), `ruleset_sha256` (CodeCop + UICop defaults, owner default) and `canary_codes` from M11-14; `held_out` with `count: 4`, M8's rule text, `seal: harness-v2-screen-start` and the four `tasks` from M8-15a; `simulation.script_sha256` and `args` from `sim-a.json` (`pool_factor: 2`); `exploratory_metrics` = `EXPLORATORY_METRICS` plus `pass_rate`, `pass_k`; `design_rule` text, including the sentences "`unscreenable` candidates (incomplete after the one rescreen) are dropped as missing (owner-approved missingness rule)" and "`lsp_shell_calls` is reported per arm as exploratory; no cell is excluded or re-run because of it"; stage-B keys empty.
- [ ] **Step 2:** Parse check and identity: `deno eval` importing `PreregSchema` and `protocolSha` prints the stage-A sha. Commit with `sim-a.json`; create the annotated tag `git tag -a harness-v2-prereg-a -m "protocol_sha256: <sha>"`; write `H:\cg-coord\decisions\<approval date>-harness-v2-prereg-a.md` (planned `2026-10-24-harness-v2-prereg-a.md`) with the lines `protocol_sha256: <sha>`, `file_sha256: <sha256 of the yml>`, `tag: harness-v2-prereg-a`, `tag_object: <git rev-parse harness-v2-prereg-a>` and the owner's `OWNER-APPROVED:` line (appendix section 10). `ROOT=. DEC=<decision path> deno eval 'import { loadStageAAnchor } from "./src/harness/prereg.ts"; console.log(JSON.stringify((await loadStageAAnchor(".", "harness", "preregistration/cc-v2-factorial.yml", Deno.env.get("DEC")!)).anchor))'` prints `tag_moved: false` and equal protocol hashes. M8-15b may start screening only after this decision exists.

### Task M11-17a: Provisional design (sim-b; not binding)

Lane: orchestrator + lane-ops. Deps: M11-16, M8-16b (every sealed candidate has a final status). Window 11-01 (later for N_prelim 30 or 40, appendix section 12).

- [ ] **Step 1:** Re-run M11-15 with `--prereg harness/preregistration/cc-v2-factorial.yml` and the pilot report's cells added (`--cells <pilot report.json>`), output `harness/preregistration/cc-v2-factorial.sim-b.json` (checkpointed with `--resume` if needed). The script takes rule, family and arguments from stage A.
- [ ] **Step 2:** `H:\cg-coord\m11\sim-b.md`; hand `decision.design.tasks` (N) and `repeats` (R) to M8-19. If the decision is null: stop; the owner decides an amendment (`design`, `family` or `confirmatory`) before M8-19 runs. This output is provisional: nothing is bound until M11-17b.

### Task M11-17b: Stage B binding and approval

Lane: orchestrator + lane-ops + owner. Deps: M11-17a, M8-19 (committed `selection.json`, `status: ok`), M8-21 (freeze record; a task dropped at freeze re-runs M8-19 with the same N first). Window 11-06 (appendix section 12 for the other N_prelim paths). Before the first confirmatory cell.

- [ ] **Step 1:** lane-infra sets `tasks` (the selected plus held-out glob from `selection.json`) and `repeats` (R) in `harness/experiments/cc-v2-factorial.yml`; `harness validate` green; note the new `experiment_hash`.
- [ ] **Step 2: Backend lineage gate (M10 round 2 finding 7).** On each of Cronus281-283, lane-ops records the backend compiler's `Microsoft.Dynamics.Nav.CodeAnalysis.dll` sha256 and `harnessCompilerIdentity`; the sha256 must equal `lineage.backend.sha256` in `harness/images/claude-code/lsp/al-lsp.json` and the identity is written to `compiler_identity`. A mismatch: stop, `coord ask` to the owner (a new LSP definition means a new image).
- [ ] **Step 3:** Fill `stage_a` (protocol sha), `experiment_hash`, `selection` (path, sha256, selected, held_out), `design`, `power_simulation` (inputs and output with sha256), `compiler_identity`, `stage_b_approval`; any amendment from M11-17a recorded in `amendments` with from/to, reason and approval.
- [ ] **Step 4:** Commit; the orchestrator creates the annotated tag `git tag -a harness-v2-prereg-b -m "stage_b_sha256: <sha256 of the yml text, CRLF normalized to LF>"`; the owner approves and the orchestrator writes `H:\cg-coord\decisions\<date>-harness-v2-prereg-b.md` (planned `2026-11-06-...`) with `stage_b_sha256:`, `tag: harness-v2-prereg-b`, `tag_object: <git rev-parse harness-v2-prereg-b>`, one `amendment: <key>` line per amendment the owner approved, and the `OWNER-APPROVED:` line. Then `verifyPrereg` with both decision files returns no problems (`deno eval`). Campaign creation (M12, `harness run --prereg-decision <A> --prereg-b-decision <B>`) refuses otherwise (M11-10). Any later edit of the stage-B file needs a new tag, decision and approval.

---

## Review responses (round 1, `review-m11.md`)

| Finding | Response |
| --- | --- |
| 1a Percentile sign tails are an approximate test | Agreed. M11-09 states it as approximate; calibration is checked, not assumed: the stage-A design rule requires FWER under null and partial nulls within alpha + 2 SE at the chosen design, with per-contrast type I reported (M11-13). |
| 1b Report Holm family follows the experiment | Fixed. `testContrasts` takes `family` from the pre-registration; the report refuses on `familyProblems` (members, order, duplicates, interaction status) (M11-09, M11-10, M11-11). |
| 1c Promoted interaction not simulated with the expanded family | Fixed. The simulation takes the family (`--interaction confirmatory` adds it to Holm); M11-15 runs both families if the owner considers promotion. |
| 2 Stage A binds a full experiment hash; stage B can change the zero-solve rule | Fixed. Stage A binds the protocol (arms, contrasts, interaction) and its own projection hash; `experiment_hash` is a stage-B key. Stage B's simulation run takes the rule from stage A and `preregProblems` refuses an output with another rule (M11-10, M11-13). |
| B1 Simulated nulls from Monte Carlo truth | Fixed. Nulls are analytic per scenario (`SCENARIOS.signs`); C3 affects both realistic arms, keeping C2 exactly null; truth is 0 for nulls (M11-13). |
| B2 Selection, MDE, interaction, gates, resample count | Fixed. The simulation calls M8's `stratumOf` and `select` with M8's rules on observed pilot counts (strata, quotas, borrowing); MDE is calibrated per mechanism on the selected-task population (solve infeasibility fails); interaction joins Holm when confirmatory; `chooseDesign` gates on power, FWER with MC SE, suppression, selection failures and coverage (n >= 100) for both rules, throws on an incomplete grid; rule-A suppression uses the campaign's 10,000 resamples analytically and a confirmation pass re-runs the chosen design at 10,000. |
| B3 Freeze binding incomplete | Fixed. Ancestry by projection hash; protocol vs experiment; design vs selection count and experiment repeats; campaign task set = selected + held-out; held-out count; selection and simulation file hashes; simulation rule, script hash, arguments and decision; explicit amendment policy, disclosed in the report (M11-10, M11-11). |
| 4 Declared family not executed | Fixed (same as 1b). |
| 5 Reuse probe false classifications | Fixed. Comments and strings masked, object-scoped search, signature match, a non-building probe is `missing`; executed (marker) separated from effective (perturbation) reuse; tests for changed signature, comments, two objects, renamed target, alternatives, token call; caught calls qualified as a measurement fixture (M11-06, M11-14). |
| 6a Final-code completeness and analyzer identity | Fixed. `incomplete_apps`, warnings only when complete, incomplete start is missing; analyzer activity proven per run by a canary with frozen expected codes; compiler and ruleset recorded and checked against the pre-registration (M11-05, M11-11). |
| 6b Burden numeric with a missing trace | Fixed. Burden and first build are missing unless outside-backend compilation is excluded (no declared toolchain, or a complete used trace with no in-container compile) (M11-12). |
| 7a Partial credit completeness | Fixed. Required scorers, exactly one candidate row per weighted or hidden-regression key, non-empty weights; otherwise missing; weights only over M8's new-requirement rows, hidden regressions apart (M11-04). |
| 7b Warning qualification too loose | Fixed. Records keep per-code increases; qualification requires each expected code to have increased (M11-07). |
| 4 (sec. 4) Provenance and write-once conflict | Fixed. Records bind workspace hash, judgment, oracle hash, analyzers; stored per fingerprint so re-measurement adds a file; the report reads the pre-registered fingerprint (M11-04, M11-11, M11-12). |
| 5 Subagent accounting | Gate 3 stays M9's (ruling 4). M11 states the consumption contract (empty `per_model` = unproven, tokens missing) and co-signs gate 3 in M11-14. |
| 5 Held-out exclusion | Fixed. Confirmatory cells are the selected tasks only; held-out cells get a separate descriptive summary (M11-11). |
| 5 Archive measure side files | No code change: `freeze-archive.ts pack` walks the whole results root, so `measures/` is archived; M12 binds the pre-registration and simulation outputs with `bind`. |
| Parser bump and LSP fields (cross-plan) | M11-03 withdrawn; M10-07 owns LSP tracing and, if first, the bump (ruling 2); M11-12 consumes `lsp_calls` through `lspTotal`. |

## Open items

Settled in round 3 (appendix): LSP trace shape `{ total, by_op } | null` (ruling 9); M8 delivers `measures.yml` split at A9 and the `fixture/*` folders by 10-12 and exports the section 8 names; M11-16 itself adds `contrasts`, `interaction` and `preregistration` to `cc-v2-factorial.yml` and M11-17b sets `tasks`/`repeats`; the owner accepted interaction exploratory, codes `AL0118, AL0132, AL0185` and CodeCop + UICop defaults. Still open:

1. The simulation's runtime at 1,000 sims x 126 grid combinations plus the exact confirmation and sensitivity runs is unmeasured; M11-15 times it first and checkpoints with `--resume`. Lowering `sims` below the gating floor is not allowed; if the runtime does not fit by 10-13, the orchestrator moves M8-07b's rerun and M8-12's start, not the precision.

## Review responses (round 2, `H:\cg-coord\reviews\PLANS-v2-002\review-m11.md`)

| Finding | Response | Where |
| --- | --- | --- |
| 1 BLOCKING: approved stage A not anchored (projection compared only with `doc.stage_a.sha256` in the same file) | Accepted. `verifyPrereg` reads the approved protocol hash from the decision file, checks that `harness-v2-prereg-a` still resolves to the recorded tag object, and hashes the stage-A file committed at that tag; the document's own value is never trusted alone. Tests: self-consistent forgery (document and `stage_a.sha256` both edited) refused; moved tag; file at tag differs; an I/O test in a temp git repo. Campaign record and report bind `decision_sha256`; both CLIs take `--prereg-decision`. | M11-10, M11-11, appendix section 10 |
| 2 MAJOR: rule-A suppression drawn independently, disconnected from bootstrap draws; confirmation keeps the approximation; calibration only model-conditional | Accepted. Confirmation reads suppression from the actual shared draws (`exact: true`) and decides on those numbers; the grid uses one shared uniform per replicate (comonotone) and is labelled approximate; sensitivity fits `skew`, `arm_missing`, `hetero` gate error control and coverage of the chosen design. | M11-13 |
| 2 (partial rejection) | Not adopted: running the full 126-combination grid with exact 10,000-resample suppression. Reason: runtime (126 x 1,000 x 10,000 bootstrap draws) is not feasible by 10-13; the grid only ranks candidate designs, and the binding decision is taken on the exact confirmation pass. | M11-13 |
| 3 MAJOR: `lspTotal` sums a map; `measure/` vs `fixtures/`; pool factor 1.5 vs 2.0 | Accepted. `lspTotal` reads `lsp_calls.total` of ruling 9's shape (null never 0); one fixture form `fixture/<name>` in both plans; pool factor 2.0 everywhere (appendix sections 5, 7, 12). | M11-12, M11-04, M11-07, M11-13, M11-15 |
| 4 MAJOR: sequencing (stage A before the start seal vs M8 sealing first; M11-17 needs M8-19 needs M11-17); 13 vs 14 combinations | Accepted. Start seal first, then stage A (records the held-out ids), then screening; M11-17 split into M11-17a (provisional design, feeds M8-19) and M11-17b (binding after the freeze); confirmation names 14 combinations. | Schedule, M11-16, M11-17a, M11-17b, M11-13 |
| 5 MODERATE: runtime and checkpointing; `alpha + 2 SE` loosens as counts fall | Accepted. Fixed `FWER_TOL` (0.0638), `MIN_GATING_SIMS` 500 (gating throws below it), `<out>.partial.jsonl` checkpoint with `--resume`, timing run first. | M11-13, M11-15 |
| R1-5 PARTLY: caught calls read `executed: false`; alternatives used by different tests | Accepted. Per-test attribution across targets; `executed` = marker observed OR effective (a caught call whose result is used is executed); the remaining lower bound (swallowed and ignored) is stated; tests 8 to 10. | M11-06 |
| Side-file provenance PARTLY: report does not match record identities to the counted artifact/judgment | Accepted. The loader refuses a record whose `judgment_id`, `execution_id`, `workspace_hash` or `oracle_hash` differs from the counted cell. | M11-11, M11-12 |
| (no other rejection) | | |

## Round 3 changes

1. Header links the shared interfaces appendix; rulings path PLANS-v2-002; owner defaults applied (interaction exploratory, AL0118/AL0132/AL0185, CodeCop + UICop defaults, `unscreenable`).
2. M11-10: external stage-A anchor (tag object, decision file, file at tag), `parseStageADecision`, `loadStageAAnchor`, `--prereg-decision`, `decision_sha256`, held-out ids in stage A; forgery, moved-tag and I/O tests.
3. M11-13: shared-draw exact confirmation, comonotone grid suppression, sensitivity fits, fixed FWER tolerance, simulation floor, checkpoint and resume, pool factor 2.0, 14 combinations.
4. M11-06: per-test target attribution, executed includes effective; new cases.
5. M11-04/M11-07/M11-14: `fixture/<name>` folder and variant; split from M8's A9 gate report.
6. M11-11/M11-12: measure provenance binding; `lsp_calls` per ruling 9, `lsp_shell_calls`, `lsp_passive_diagnostics`, usage-reconciliation status counts.
7. M11-16 after M8-15a (10-22..24) with the experiment edit, held-out ids and pre-registered contamination and missingness text; M11-17a (11-01) and M11-17b (11-06, with the backend lineage gate) replace M11-17.
8. Round 3 review (`H:\cg-coord\reviews\PLANS-v2-003\review-m11.md`) blocking 1: amendments and the stage-B bytes are verified against an external stage-B anchor (annotated tag `harness-v2-prereg-b`, decision file with `stage_b_sha256`, `tag_object` and `amendment:` lines, its sha256 recorded in the campaign record); approval text inside the document authorizes nothing; the design waiver needs an externally approved design amendment; `--prereg-b-decision` on `harness run`/`report`; tests for forged family-drop and design amendments under a valid stage-A anchor, edited bytes and a moved tag; appendix section 10 updated.
9. Round 3 review blocking 2: the skew sensitivity uses a finite-moment log-normal scale mixture (w 0.1, k 3) instead of exp(t(3)); `noiseMean` gives its exact expectation and `populationCps` (calibration and coverage truth) uses it; `expectedSpend` plus a test that the simulated mean matches it within 4 Monte Carlo SE.
