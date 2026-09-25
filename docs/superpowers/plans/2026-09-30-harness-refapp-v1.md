# Harness Bench Refapp v1 and Task Set (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the M0 refapp skeleton into refapp v1 and author six harness tasks (HX-001 to HX-006) that are authoring-qualified by the interim gate and then qualified through the real M1 pipeline and frozen by 2026-10-09, with HX-001 authoring-qualified by 2026-10-01 and pinned as `refapp-v1-rc1` by 10-02, well before the end-to-end gate (moved to 10-05, decision `2026-09-25-gate-1002-moved.md`).

**Architecture:** lane-content writes AL only: refapp slices under `harness-tasks/refapp/`, and per task `task.yml`, `prompt.md`, `overlay/`, `oracle/`, `correct/`, `naive/`, and for the test-authoring task `mutants/` and `reference-tests/`. lane-ops owns the interim gate, split into three reviewable files: `scripts/harness/gate-core.ts` (pure decision contract), `scripts/harness/gate-stage.ts` (staging from an exported git revision and static checks) and `scripts/harness/gate-task.ts` (CLI, host compile, container executor). The gate stages a named commit, never the working tree, compiles and publishes on a leased Cronus container, runs the listed tests over SOAP, classifies every failure, checks the full run matrix and writes a report under `H:\Temp3\harness-spike\M4\<task>\`. A task promoted by this gate is **authoring-qualified**; the 10-09 freeze additionally needs real-pipeline judgments and non-provisional identities (M4-15).

**Tech Stack:** AL (BC 28.4, runtime 17.0, `NoImplicitWith`), Library Assert, the repo SOAP test harness (`infra/cg-test-harness`, TestIsolation = Codeunit), Deno + TypeScript (`BcContainerProvider`, `runTestsViaSoap`, `loadTask` and `hashTree` from M1-01/M1-02), host AL Tools (`al compile`), git (`read-tree`, `checkout-index` with a private index).

**Spec:** `docs/superpowers/specs/2026-09-24-harness-refapp-design.md` (1b, primary). Also 1a `docs/superpowers/specs/2026-09-24-harness-bench-design.md` sections 5-8 and 14, findings `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` sections 1, 2 and 8, M1 plans `docs/superpowers/plans/2026-09-30-harness-core.md` (M1-01 schema) and `docs/superpowers/plans/2026-09-30-harness-core-part2.md` (M1-11 to M1-30), the launch contract `docs/superpowers/runbooks/harness-autonomy/launch-contract.md`.

**Revision 2 inputs:** review `H:\cg-coord\reviews\M4-plan-001\review-gpt6astra.md` (ACCEPT-WITH-CHANGES, all must-change items applied), owner decision `H:\cg-coord\decisions\2026-09-25-m4-coverage-pilot.md`, premise probe `H:\Temp3\harness-spike\M4-00-results.md` (HX-001 redesigned).

**Revision 3 inputs:** round-2 review `H:\cg-coord\reviews\M4-plan-002\review-gpt6astra-round2.md` (ACCEPT-WITH-CHANGES, last round: must-change items 1-6, blockers A-D and the section 4 rulings applied), decisions `H:\cg-coord\decisions\2026-09-25-gate-1002-moved.md` (end-to-end gate 10-05, M1 Part 2 replanned as a vertical slice) and `H:\cg-coord\decisions\2026-09-25-egress.md` (at most 5 supervised credential-bearing dev runs before egress enforcement).

## Global Constraints

- lane-content never touches a container. Every compile/publish/test on a Cronus container is a lane-ops job named in this plan, with a lease, on Cronus281 to Cronus283 (lane.md: content gate runs). lane-content may run the host `al` compile (`gate-task.ts compile`, orchestrator ruling); it starts no container and publishes nothing, and it is a pre-check only.
- lane-ops owns `scripts/harness/gate-*.ts` (orchestrator ruling).
- Every gate stages an exported commit (`--rev`), not a working tree, and records `source_commit`, `refapp_tree` and `task_tree`.
- Temporary workspaces live under `H:\Temp3\harness-spike\M4\tmp\` (launch contract: outputs only in the repo, the coord root and `H:\Temp3\harness-spike\`), unit-test temp dirs under `H:\Temp3\harness-spike\M4\tmp\unit\` (`tmp()` in `gate-fixtures.ts`; `CG_GATE_TMP` overrides both). Evidence goes to `H:\Temp3\harness-spike\M4\<task>\`.
- Tags: `refapp-v1-rcN` and the published `refapp-v1` are never moved. The local `refapp-v1` created for the freeze candidate is a provisional alias until M4-15 qualifies it; a failed candidate's SHA and evidence are kept under `H:\Temp3\harness-spike\M4\freeze\failed-<sha>\`.
- Credential-bearing sandbox runs before egress enforcement exists: at most 5 in total across all lanes, each supervised, no unattended retries, terminated on unexpected network activity (decision `2026-09-25-egress.md`). The M4-17 pilot counts against those 5 unless it runs through the production adapter behind tested egress enforcement.
- ID bands (1b section 4): refapp Core 70000-70099, Fleet 70100-70199, Rental 70200-70299, Leasing 70300-70399, Integration 70400-70499, Reporting 70500-70599; `Test` app 80000-84999 (codeunit 80013 is never used: Cronus28 hosts a foreign 80013); hidden oracles 85000-89999, HX-00N owns 85000+(N-1)*100 to 85099+(N-1)*100. Never 75000-79999. Production-replacing mutants keep their module's ids.
- App ids are static: refapp `c6a1e000-0000-4000-8000-00000000000N` (existing); oracle of HX-00N `c6a1e000-0000-4000-8001-00000000000N`, name `CGR Oracle HX-00N`, publisher `CentralGauge`, dependencies only `CGR <module>` for modules in `fail_to_pass.depends_on` plus Library Assert. An oracle never depends on `CGR Test`.
- Trusted test boundary (1a section 7): `correct/`, `naive/` and `mutants/` never contain files under `Test/`; `reference-tests/` and naive test suites only add new files under `Test/`, never replace any shipped `Test/` file (including `Test/app.json`). `check` enforces it over every file, not only `.al`.
- Layers add or replace files; nothing is deleted. A zero-byte layer file is refused as an unsupported deletion.
- Every test codeunit has `Subtype = Test;`, `TestPermissions = Disabled;` and at least one `[Test]` procedure.
- The SOAP harness rolls back per test codeunit, not per procedure: every procedure uses its own keys, sets every Setup value and the work date it depends on, and never relies on state from another procedure.
- Oracles follow CLAUDE.md "Writing AL Tests": no placeholder assertions, every requirement in `prompt.md` asserted, boundaries probed on both sides, interface behavior tested through an implementing codeunit. An oracle asserts only what the prompt or an existing refapp contract states.
- Prompts follow CLAUDE.md "Writing Task Specifications": ticket style, symptom or requirement, never mechanism or how; required names and signatures stated; no oracle, codeunit or mutant name (`check` enforces).
- The oracle tables in this plan are normative: an implemented oracle has at least every row with the same inputs and expected values, and each variant's kill mapping holds. After the first gate run of a task an oracle changes only for a defect the auditor or the owner confirmed, recorded in `H:\Temp3\harness-spike\M4\<task>\oracle-changes.md`, followed by a new audit and a full re-gate. Removing a procedure or assertion, or loosening an expected value, to get a green gate is forbidden (launch contract).
- A slice that edits a refapp file which an earlier task's layers replace re-derives those layer files, re-pins the task to the new rc tag and has the slice's ops gate re-gate it on the same commit (Review Focus 5). Known case: slice D edits `RentalMgt`, which HX-003 replaces.
- Keep tasks hard (CLAUDE.md, Benchmark Tasks). A task the pilot (M4-17) finds easy is hardened, never softened.
- Refapp breadth stays at what the six tasks need. Number series, dimensions, API pages and the HTTP mock are not built (cut order item 4). The coverage gap is accepted by the owner and stated as a report caveat (decision `2026-09-25-m4-coverage-pilot.md`).
- The difficulty pilot is developmental and excluded from results; it uses pi through OpenRouter only (never the Team account) and counts against the USD 150 paid cap.
- `deno fmt`, `deno check`, `deno lint` on changed `.ts` files only. No em dash in any committed text.
- Dates: a slip of more than one day against 10-01 (HX-001 authoring-qualified), 10-02 (rc1 tagged, needed by the 10-05 end-to-end gate) or 10-09 (six frozen) goes to the owner.

## Review Focus

1. **A failure that is not an assertion counts as discrimination**: a naive solution or a mutant "fails" through a runtime error, a missing procedure, a compile error or a publish fault. Expected: only an assertion failure with every expected procedure run is a kill; runtime-only failures are refused; publish faults, zero-result codeunits and missing procedures are infra (exit 3). Pinned in M4-01a (`naive runtime-only failure is refused`, `naive with a missing procedure is infra`, `mixed assertion and missing is infra, not a kill`, `infra run is refused`, `baseline oracle compile with an unexpected diagnostic is refused`) and M4-01c (`zero results from a codeunit is infra`).
2. **An incomplete run matrix promotes a task**: a planned variant or repeat never ran, or a test-authoring suite ran only some of its procedures. Expected: refused with the missing entry named. Pinned in M4-01a (`matrix incomplete`, `naive suite with a missing procedure on a mutant`).
3. **A layer replaces a shipped test** and a suite passes only because of it. Expected: `check` refuses a suite that replaces any shipped `Test/` file (including `Test/app.json`), and staging skips candidate replacements of shipped tests. Pinned in M4-01b (`every static rule fires`: `replaces a shipped test` for `Test/app.json`; `candidate layer cannot replace a shipped test`).
4. **The gate stages something other than the commit it reports**: the working tree, a moved tag, a stale refapp under an rc tag. Expected: staging from `git` objects of the named revision; `tag_status: mismatch` blocks promotion. Pinned in M4-01b (`exportSource ignores working tree changes`) and M4-01c (`tag mismatch blocks promotion`).
5. **A later refapp slice changes what an earlier task stages.** Expected: `check` names every changed file a task replaces (problem) and warns on any other refapp change since the task's tag; the freeze re-gates every task on the candidate commit. Pinned in M4-01b (`drift: replaced file is a problem, other change a warning`) and M4-15.

## Decisions argued from the spec

- **Interim gate, then real pipeline.** 1b section 8 says the `mock` harness runs both solutions "through the real pipeline". M1 Part 2 is being replanned as a vertical slice for the 10-05 end-to-end gate (decision `2026-09-25-gate-1002-moved.md`); mutant scoring and campaigns are deferred in that slice. So `gate-*.ts` implements the 1b section 8 checks for authoring, and M4-15 requires real-pipeline judgments through `harness cell` before freeze. Without them by 10-09 the freeze needs an explicit owner exception.
- **Failure classes, aligned with M1 (review round 2, ruling 3).** A failed procedure is `assertion` when its message matches `\bAssert\.\w+ failed\b` or is BC's "An error was expected inside an ASSERTERROR statement." (the test's own expected-error assertion losing), else `runtime_error`. The M1 classifier lives in M1-16's `src/harness/bc-lane.ts`; lane-infra aligns it and uses the M4-16 P5 messages as regression fixtures (cross-lane request 3). M4-16 P5 acceptance is a predecessor of the first accepted gate (M4-03).
- **Missing results are infra.** A test codeunit that returns zero results, or an expected procedure (listed `pass_to_pass`/`fail_to_pass`, or discovered in the suite under test) missing from the results of an app that built, marks the run infra: reported, exit 3, never scored. A kill needs an assertion with every expected procedure present; "assertion in A, missing B" is infra, not a kill (shared fixture `tests/fixtures/harness/conformance/mixed-assertion-missing.json`, M4-01a; M1-18 must agree, cross-lane request 3).
- **Gate expectations** (1b section 8, 1a section 7), all on a complete matrix with no infra run:
  - f2p tasks. Baseline: all seven apps build, every `pass_to_pass` procedure passes, and `fail_to_pass` fails: either the oracle compiles, every listed procedure runs and at least one fails, or the oracle fails to compile with only missing-feature diagnostics (`MISSING_FEATURE_CODES`). `correct/` x3: every scorer passes. Each `naive/<x>` x2: the refapp and the oracle build, every listed procedure runs, at least one loses an assertion.
  - test-authoring. Baseline builds and passes `pass_to_pass`. Reference tests: every discovered procedure passes on `correct/` x3; on m0 (the staged state) and on every named mutant everything builds, every procedure runs and at least one loses an assertion. Each naive suite: passes completely on `correct/`, runs completely on every target, and leaves at least one mutant alive. Naive suites run once per target (their matrix already has one run per mutant); f2p naive variants run twice.
  - A hidden regression row may pass on the baseline; the scorer must fail on the baseline, every procedure must pass on `correct/`, and the report keeps baseline per-procedure outcomes so no row is mislabeled as a transition.
- **Layer semantics** (1b section 5): layers mirror the workspace (`<Module>/...`) and add or replace files. Order: refapp, overlay, correct, mutant, test suite. Deletion is not supported and refused.
- **Provenance and tags.** Each task is gated at a named commit; the orchestrator tags it `refapp-v1-rcN` on acceptance and the task pins that tag. The gate reports `tag_status`: `match` (the tag's `harness-tasks/refapp` tree equals the gated tree), `pending` (tag not created yet) or `mismatch` (blocks promotion). The final `refapp-v1` tag is created locally on the freeze candidate as a provisional alias so the real pipeline can resolve it, and pushed only after M4-15 qualifies all six; a failed qualification keeps the failed SHA and its evidence, deletes the unpushed local alias and tags a fixed commit instead. A published tag is never moved.
- **Audit identity.** Every gate report's `task_tree` must equal the `TASK TREE` of the task's latest full audit or of an auditor-approved metadata-only re-attestation (`reattest-*.md`: old audited tree, new tree, the exact permitted diff, `VERDICT: clean`). A re-derivation (HX-003 in M4-08) needs a fresh full audit; the freeze re-pin (M4-14) needs a re-attestation per task.
- **Reference tests** live in `reference-tests/` (review answer 1): an authoring input in neither hash; the gate report records its tree id. In the real pipeline `reference-tests/` is HX-002's positive submitted test solution (the verdict supplies reference production itself); it is not moved into `correct/` (ruling 4).
- **HX-001 is a final-state task.** M4-00 measured that a stale record's `Modify` after a subscriber modified the same row in the same transaction raises no error on BC 28.4; the stale buffer silently overwrites (lost update). The ticket reports the observable symptom; the oracle asserts final state across apps, including a return that adds a second open damage.
- **Coupling tags** use the 1b section 3 edges: `events`, `internal`, `interface`, `queries` (the Reporting row: table extensions, cross-app FlowFields, queries; M4 exercises FlowFields, not query objects), `facade`, `ishandled`, `core-facade`.
- **Smoke codeunit 80000 stays.** M1-27's probe runs test codeunit 80000 and expects 5 passing procedures (findings section 1). Refapp v1 keeps `"CGR Skeleton Tests"` (80000) with its five procedures ported to the v1 API, so the probe keeps working (ruling 1).

## Cross-lane dependencies and requests

| Gate | M4 provides | Needs from other lanes |
| --- | --- | --- |
| 10-05 end to end (moved from 10-02; refapp, Claude Code in the sandbox, trusted verdict, cost in the records) | HX-001 authoring-qualified (M4-03, 10-01) and tagged `refapp-v1-rc1` by 10-02 | the M1 Part 2 vertical slice: staging and freeze, locked build inputs, scoped BC lifecycle, trusted bugfix/feature verdict, `cg-al` backend, sandbox, thin `harness cell`, minimal Claude Code adapter and cost parser. Old ids where they still fit: M1-13, M1-14, M1-15, M1-16, M1-17, M1-19, M1-20, M1-21, M1-24, M1-26; the replanned ids replace these when the slice plan lands. M1-28 uses `refapp-v1-rc1`. |
| 10-09 freeze | six tasks at a candidate commit, pinned to `refapp-v1` (M4-14) | `harness cell` mock arms that take a named variant (`correct`, `naive:<name>`, and `reference-tests` as the test-authoring positive), mutant scoring for HX-002 (deferred in the slice, needed by 10-08), the symbols lock (non-provisional identity). M1-29 uses HX-001 at rc1 and HX-002 at rc2, not the final tag. |

Cross-lane requests (sent by `coord ask` with this plan; not resolved here):
1. M1-28/M1-29 dependencies: replace "refapp-v1 tagged" with HX-001 at `refapp-v1-rc1` (M1-28) and HX-001 rc1 plus HX-002 rc2 (M1-29); each task resolves its own pin.
2. Mock positive artifact for test-authoring = `reference-tests/`; every named naive variant selectable; judgments expose raw reasons, target coverage and artifact identity.
3. M1-16 `bc-lane.ts` classifier counts the lost-ASSERTERROR text as `assertion` (P5 fixtures), and M1-18 checks infra and missing procedures before accepting an assertion kill (fixture `mixed-assertion-missing.json`).
4. The obsolete Part 1 wording that puts all `mutants` in the hidden band is updated: production-replacing mutants keep module ids (already so in Part 2, ruling 5).

## Task set, coverage and schedule

| Task | Kind | Touches | Coupling | Author | Gate | Target |
| --- | --- | --- | --- | --- | --- | --- |
| HX-001 | bugfix | Rental, Fleet, Core | events, core-facade | M4-02 | M4-03 | 10-01 (rc1 by 10-02) |
| HX-002 | test-authoring | Leasing, Core, Test | internal | M4-04 | M4-05 | 10-02 |
| HX-003 | feature | Fleet, Rental, Core | ishandled, interface | M4-06 | M4-07 (re-gate M4-09) | 10-03 |
| HX-004 | feature | Reporting, Leasing, Rental, Fleet | queries, internal | M4-08 | M4-09 | 10-05 |
| HX-005 | refactor | Rental | interface | M4-10 | M4-11 | 10-06 |
| HX-006 | feature | Integration, Core, Rental | facade, events, core-facade | M4-12 | M4-13 | 10-07 |

Coverage caveat (owner decision, stated in the report): `ishandled`, `queries` and `facade` are exercised once; single-instance state, temporary tables and `CommitBehavior` not at all. 1b section 9's two-per-style rule is not met by the v1 six.

| Day | lane-ops | lane-content |
| --- | --- | --- |
| 09-30 | M4-01a, M4-01b | M4-02 (slice A, HX-001) |
| 10-01 | M4-01c, M4-16 (probes, morning), M4-03 | M4-02 audit fixes, M4-04 |
| 10-02 | M4-05; orchestrator tags rc1, rc2 | M4-04 finish, M4-06 |
| 10-03 | M4-07; M4-17 HX-002 if the runner check passed | M4-08 |
| 10-05 | M4-09 (HX-004, HX-003); end-to-end gate on HX-001 (other lanes) | M4-10 |
| 10-06 | M4-11; M4-17 HX-005 | M4-12 |
| 10-07 | M4-13 | hardening from pilot, if any |
| 10-08 | M4-15 | M4-14 |
| 10-09 | M4-15 finish | |

Container load (review round 2): 79 initial gate runs (HX-001 10, HX-002 27, HX-003 10, HX-004 10, HX-005 12, HX-006 10), 10 for the HX-003 re-gate, 79 for the freeze re-gate: **168 runs** before real-pipeline qualification, probes, pilot judging and retries; `partial-reschedule` adds 6 across initial and freeze gates. At the spike's 73.2 s per seven-app operation sum that is about 3.4 aggregate container-hours before oracle apps, staging and cleanup (findings section 1 excludes those). M4-03 records per-run wall time; ops reserves gate windows on Cronus281-283 from that measurement.

## File Structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `scripts/harness/gate-core.ts` | variants, layers, failure classes, tallies, summaries, run matrix, `decideGate` (pure) | M4-01a |
| `scripts/harness/gate-stage.ts` | export a revision, stage layers, `checkTask`, drift, test manifests | M4-01b |
| `scripts/harness/gate-task.ts` | CLI (`check`, `compile`, `stage`, `gate`, `judge`), host compile, container executor, reports | M4-01c |
| `tests/unit/harness/gate-core.test.ts`, `gate-stage.test.ts`, `gate-task.test.ts`, `gate-fixtures.ts` | unit tests and the shared seven-module fixture | M4-01a-c |
| `harness-tasks/refapp/<Module>/src/*.al` | refapp v1, grown per slice | M4-02, 04, 06, 08, 12 |
| `harness-tasks/refapp/Test/src/*.al` | visible tests and test library | same |
| `harness-tasks/tasks/HX-00N/...` | `task.yml`, `prompt.md`, `overlay/`, `oracle/`, `correct/`, `naive/<x>/` | per task |
| `harness-tasks/tasks/HX-002/mutants/<m>/`, `reference-tests/` | test-authoring only | M4-04 |
| `harness/experiments/m4-qualify.yml` | real-pipeline qualification experiment | M4-14 |
| `tests/unit/harness/task-set-v1.test.ts` | loads all six manifests | M4-14 |
| `H:\Temp3\harness-spike\M4\...` | reports, audits, oracle change notes, probes, pilot | evidence |

---

### Task M4-01a: gate decision contract (pure)

**Lane:** ops. **Deps:** M1-01 (merged: `src/harness/task.ts`). **Target:** 09-30.

**Files:**
- Create: `scripts/harness/gate-core.ts`
- Create: `tests/fixtures/harness/conformance/mixed-assertion-missing.json`
- Test: `tests/unit/harness/gate-core.test.ts`

**Interfaces:**
- Consumes: `type HarnessTask`, `HarnessTaskSchema` (M1-01).
- Produces: `BUILD_ORDER`, `RANGES`, `CORRECT_RUNS = 3`, `NAIVE_RUNS = 2`, `MISSING_FEATURE_CODES`; `type Variant`, `variantName`, `parseVariant`, `interface Layer { path: string; mode: "task" | "candidate" | "candidate-tests"; optional?: boolean }`, `layers(taskDir, v, testAuthoring): Layer[]`; `objectIds`, `isTestCodeunit`, `parseTestManifest(al): TestRef | null`; `interface ProcResult`, `classifyTestFailure`; `interface TestRef`, `interface Tally`, `tally`, `allPass`, `assertionKill`, `complete`; `interface BuildStep`, `interface RunResult`, `type AppState`, `interface RunSummary`, `summarize`; `interface PlanEntry`, `interface GateRun`, `gatePlan(task, naive): PlanEntry[]`, `runKey`, `decideGate(task, plan, runs): { promoted: boolean; matrix_complete: boolean; reasons: string[] }`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/gate-core.test.ts`:

```typescript
import { assert, assertEquals } from "@std/assert";
import type { GateRun, RunSummary, Tally, Variant } from "../../../scripts/harness/gate-core.ts";
import {
  assertionKill,
  classifyTestFailure,
  decideGate,
  gatePlan,
  layers,
  parseVariant,
  summarize,
  tally,
} from "../../../scripts/harness/gate-core.ts";
import { HarnessTaskSchema } from "../../../src/harness/task.ts";

const F2P = HarnessTaskSchema.parse({
  id: "HX-001",
  refapp_version: "refapp-v1-rc1",
  kind: "bugfix",
  prompt: "prompt.md",
  source: "refapp",
  scorers: ["build", "pass_to_pass", "fail_to_pass"],
  pass_to_pass: [{ codeunit: 80010, procedures: ["Visible"] }],
  fail_to_pass: { depends_on: ["Core"], tests: [{ codeunit: 85000, procedures: ["Hidden"] }] },
});
const TA = HarnessTaskSchema.parse({
  id: "HX-002",
  refapp_version: "refapp-v1-rc2",
  kind: "test-authoring",
  prompt: "prompt.md",
  source: "refapp",
  scorers: ["build", "pass_to_pass", "mutant_kill"],
  pass_to_pass: [{ codeunit: 80010, procedures: ["Visible"] }],
  mutants: ["m1"],
});

const T = (k: "pass" | "assert" | "runtime" | "missing"): Tally => ({
  expected: 1,
  passed: k === "pass" ? 1 : 0,
  assertion: k === "assert" ? 1 : 0,
  runtime: k === "runtime" ? 1 : 0,
  missing: k === "missing" ? 1 : 0,
});
const S = (o: Partial<RunSummary>): RunSummary => ({
  refapp: "ok",
  oracle: null,
  oracleCodes: [],
  p2p: T("pass"),
  f2p: null,
  own: null,
  infra: false,
  ...o,
});
const run = (variant: Variant, summary: RunSummary, repeat = 1): GateRun => ({
  variant,
  repeat,
  summary,
  staged_hash: `${JSON.stringify(variant)}`,
});

function f2pRuns(): GateRun[] {
  return [
    run({ kind: "baseline" }, S({ oracle: "ok", f2p: T("assert") })),
    ...[1, 2, 3].map((i) => run({ kind: "correct" }, S({ oracle: "ok", f2p: T("pass") }), i)),
    ...["a", "b"].flatMap((name) =>
      [1, 2].map((i) => run({ kind: "naive", name }, S({ oracle: "ok", f2p: T("assert") }), i))
    ),
  ];
}
function taRuns(): GateRun[] {
  const t = (suite: string, mutant: string | null, own: Tally, i = 1) =>
    run({ kind: "tests", suite, mutant }, S({ own }), i);
  return [
    run({ kind: "baseline" }, S({})),
    t("reference-tests", null, T("pass"), 1),
    t("reference-tests", null, T("pass"), 2),
    t("reference-tests", null, T("pass"), 3),
    t("reference-tests", "m0", T("assert")),
    t("reference-tests", "m1", T("assert")),
    ...["naive/a", "naive/b"].flatMap((s) => [
      t(s, null, T("pass")),
      t(s, "m0", T("assert")),
      t(s, "m1", T("pass")),
    ]),
  ];
}
const planF2P = gatePlan(F2P, ["a", "b"]);
const planTA = gatePlan(TA, ["a", "b"]);

Deno.test("layers: order refapp < overlay < correct < mutant < suite", () => {
  const p = (v: Variant, ta = false) =>
    layers("T", v, ta).map((l) => `${l.path.replaceAll("\\", "/")}:${l.mode}`);
  assertEquals(p({ kind: "baseline" }), ["T/overlay:task"]);
  assertEquals(p({ kind: "correct" }), ["T/overlay:task", "T/correct:task"]);
  assertEquals(p({ kind: "tests", suite: "naive/x", mutant: "m1" }, true), [
    "T/overlay:task",
    "T/correct:task",
    "T/mutants/m1:task",
    "T/naive/x:task",
  ]);
  assertEquals(p({ kind: "tests", suite: "reference-tests", mutant: "m0" }, true), [
    "T/overlay:task",
    "T/reference-tests:task",
  ]);
  assertEquals(p({ kind: "candidate", dir: "W", mutant: null }, true), [
    "T/overlay:task",
    "T/correct:task",
    "W:candidate-tests",
  ]);
  assertEquals(p({ kind: "candidate", dir: "W", mutant: null }), ["T/overlay:task", "W:candidate"]);
});

Deno.test("parseVariant: CLI spellings", () => {
  assertEquals(parseVariant("naive/skip"), { kind: "naive", name: "skip" });
  assertEquals(parseVariant("tests:reference-tests@correct"), {
    kind: "tests",
    suite: "reference-tests",
    mutant: null,
  });
  assertEquals(parseVariant("tests:naive/a@m0"), { kind: "tests", suite: "naive/a", mutant: "m0" });
});

Deno.test("classifyTestFailure: assertion, lost asserterror, runtime", () => {
  assertEquals(classifyTestFailure("Assert.AreEqual failed. Expected:<1> Actual:<0>"), "assertion");
  assertEquals(classifyTestFailure("An error was expected inside an ASSERTERROR statement."), "assertion");
  assertEquals(classifyTestFailure("The CGR Vehicle does not exist."), "runtime_error");
});

Deno.test("tally: missing, assertion and runtime counted apart", () => {
  const t = tally([
    { codeunit: 85000, procedure: "A", passed: false, failure: "assertion" },
    { codeunit: 85000, procedure: "B", passed: false, failure: "runtime_error" },
  ], [{ codeunit: 85000, procedures: ["A", "B", "C"] }]);
  assertEquals(t, { expected: 3, passed: 0, assertion: 1, runtime: 1, missing: 1 });
});

Deno.test("decideGate: happy f2p task is promoted", () => {
  assertEquals(decideGate(F2P, planF2P, f2pRuns()), {
    promoted: true,
    matrix_complete: true,
    reasons: [],
  });
});

const F2P_BAD: Array<[string, (r: GateRun[]) => void, string]> = [
  ["one flaky correct run blocks promotion", (r) => {
    r[2]!.summary = S({ oracle: "ok", f2p: T("assert") });
  }, "correct#2"],
  ["naive compile failure is refused", (r) => {
    r[4]!.summary = S({ refapp: "compile_fail" });
  }, "naive/a#1"],
  ["naive runtime-only failure is refused", (r) => {
    r[4]!.summary = S({ oracle: "ok", f2p: T("runtime") });
  }, "naive/a#1"],
  ["naive with a missing procedure is infra", (r) => {
    r[5]!.summary = S({ oracle: "ok", f2p: T("missing"), infra: true });
  }, "naive/a#2: infra"],
  ["baseline that already passes the oracle is refused", (r) => {
    r[0]!.summary = S({ oracle: "ok", f2p: T("pass") });
  }, "baseline#1"],
  ["baseline oracle compile with an unexpected diagnostic is refused", (r) => {
    r[0]!.summary = S({ oracle: "compile_fail", oracleCodes: ["AL0001"] });
  }, "baseline#1"],
  ["infra run is refused", (r) => {
    r[1]!.summary = S({ oracle: "publish_fail", infra: true });
  }, "infra"],
  ["matrix incomplete", (r) => {
    r.splice(7, 1);
  }, "matrix incomplete"],
];
for (const [name, mutate, needle] of F2P_BAD) {
  Deno.test(`decideGate: ${name}`, () => {
    const runs = f2pRuns();
    mutate(runs);
    const d = decideGate(F2P, planF2P, runs);
    assertEquals(d.promoted, false);
    assert(d.reasons.some((x) => x.includes(needle)), d.reasons.join("; "));
  });
}

Deno.test("decideGate: only one naive variant is refused", () => {
  const plan = gatePlan(F2P, ["a"]);
  const d = decideGate(F2P, plan, f2pRuns().slice(0, 6));
  assert(d.reasons.some((x) => x.includes("fewer than two")));
});

Deno.test("decideGate: baseline oracle failing on missing objects only is accepted", () => {
  const runs = f2pRuns();
  runs[0]!.summary = S({ oracle: "compile_fail", oracleCodes: ["AL0118", "AL0132"] });
  assertEquals(decideGate(F2P, planF2P, runs).promoted, true);
});

Deno.test("decideGate: test-authoring", () => {
  assertEquals(decideGate(TA, planTA, taRuns()).promoted, true);
  const survivor = taRuns();
  survivor[5]!.summary = S({ own: T("pass") });
  assert(decideGate(TA, planTA, survivor).reasons.some((x) => x.includes("@m1")));
  const strong = taRuns();
  strong[8]!.summary = S({ own: T("assert") });
  assert(decideGate(TA, planTA, strong).reasons.some((x) => x.includes("naive/a must leave")));
  const partial = taRuns();
  partial[7]!.summary = S({ own: T("missing") });
  assert(decideGate(TA, planTA, partial).reasons.some((x) => x.includes("naive/a@m0")));
});

Deno.test("summarize: mixed assertion and missing is infra, not a kill", async () => {
  const fx = JSON.parse(
    await Deno.readTextFile("tests/fixtures/harness/conformance/mixed-assertion-missing.json"),
  );
  const task = HarnessTaskSchema.parse(fx.task);
  const s = summarize(task, fx.run);
  assertEquals(s.infra, fx.expected.infra);
  assertEquals(assertionKill(s.f2p!), fx.expected.kill);
});

Deno.test("summarize: missing pass_to_pass procedure of a built Test app is infra", () => {
  const builds = ["Core", "Fleet", "Rental", "Leasing", "Integration", "Reporting", "Test"]
    .map((app) => ({ app, stage: "publish" as const, ok: true, codes: [] }));
  const s = summarize(F2P, {
    variant: "correct",
    repeat: 1,
    usesOracle: false,
    own: [],
    builds,
    tests: [],
    staged_hash: "h",
    ms: 1,
  });
  assertEquals(s.infra, true);
});

Deno.test("gatePlan: run counts", () => {
  assertEquals(planF2P.length, 1 + 3 + 2 * 2);
  assertEquals(planTA.length, 1 + 3 + 2 + 2 * 3);
});
```

Shared conformance fixture (also handed to lane-infra for M1-18, cross-lane request 3), `tests/fixtures/harness/conformance/mixed-assertion-missing.json`:

```json
{
  "description": "Oracle procedure A lost an assertion; procedure B never reported. Expected: infra, not a kill. The M4 gate and M1-18 must agree.",
  "task": {
    "id": "HX-001",
    "refapp_version": "refapp-v1-rc1",
    "kind": "bugfix",
    "prompt": "prompt.md",
    "source": "refapp",
    "scorers": ["build", "pass_to_pass", "fail_to_pass"],
    "pass_to_pass": [{ "codeunit": 80010, "procedures": ["Visible"] }],
    "fail_to_pass": { "depends_on": ["Core"], "tests": [{ "codeunit": 85000, "procedures": ["A", "B"] }] }
  },
  "run": {
    "variant": "naive/x",
    "repeat": 1,
    "usesOracle": true,
    "own": [],
    "builds": [
      { "app": "Core", "stage": "publish", "ok": true, "codes": [] },
      { "app": "Fleet", "stage": "publish", "ok": true, "codes": [] },
      { "app": "Rental", "stage": "publish", "ok": true, "codes": [] },
      { "app": "Leasing", "stage": "publish", "ok": true, "codes": [] },
      { "app": "Integration", "stage": "publish", "ok": true, "codes": [] },
      { "app": "Reporting", "stage": "publish", "ok": true, "codes": [] },
      { "app": "Test", "stage": "publish", "ok": true, "codes": [] },
      { "app": "Oracle", "stage": "publish", "ok": true, "codes": [] }
    ],
    "tests": [
      { "codeunit": 80010, "procedure": "Visible", "passed": true, "failure": null },
      { "codeunit": 85000, "procedure": "A", "passed": false, "failure": "assertion", "message": "Assert.AreEqual failed. Expected:<1> (Integer). Actual:<0> (Integer)." }
    ],
    "staged_hash": "x",
    "ms": 1
  },
  "expected": { "infra": true, "kill": false }
}
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/gate-core.test.ts`
Expected: FAIL, `Module not found ".../scripts/harness/gate-core.ts"`.

- [ ] **Step 3: Implement** `scripts/harness/gate-core.ts`:

```typescript
// Pure decision contract of the M4 authoring gate (spec 1b section 8,
// spec 1a section 7). No I/O. Owner: lane-ops.
import { join } from "@std/path";
import type { HarnessTask } from "../../src/harness/task.ts";

export const BUILD_ORDER = [
  "Core",
  "Fleet",
  "Rental",
  "Leasing",
  "Integration",
  "Reporting",
  "Test",
];
/** Spec 1b section 4. Oracle = the hidden test app of a task. */
export const RANGES: Record<string, readonly [number, number]> = {
  Core: [70000, 70099],
  Fleet: [70100, 70199],
  Rental: [70200, 70299],
  Leasing: [70300, 70399],
  Integration: [70400, 70499],
  Reporting: [70500, 70599],
  Test: [80000, 84999],
  Oracle: [85000, 89999],
};
export const CORRECT_RUNS = 3;
/** f2p naive variants only; test-authoring naive suites run once per target. */
export const NAIVE_RUNS = 2;
/**
 * Compiler diagnostics a baseline oracle may fail with: an object or member
 * the task asks for does not exist yet. Verified against real output in M4-07
 * and M4-11; a change needs orchestrator approval.
 */
export const MISSING_FEATURE_CODES = new Set(["AL0118", "AL0132", "AL0185"]);

export type Variant =
  | { kind: "baseline" }
  | { kind: "correct" }
  | { kind: "naive"; name: string }
  /** Test-authoring suite on correct code (null), the staged state ("m0") or a named mutant. */
  | { kind: "tests"; suite: string; mutant: string | null }
  /** An agent workspace (pilot judge). For test-authoring, mutant as above. */
  | { kind: "candidate"; dir: string; mutant: string | null };

export function variantName(v: Variant): string {
  switch (v.kind) {
    case "baseline":
    case "correct":
      return v.kind;
    case "naive":
      return `naive/${v.name}`;
    case "tests":
      return `${v.suite}@${v.mutant ?? "correct"}`;
    case "candidate":
      return `candidate@${v.mutant ?? "correct"}`;
  }
}

export function parseVariant(s: string): Variant {
  if (s === "baseline" || s === "correct") return { kind: s };
  if (s.startsWith("naive/")) return { kind: "naive", name: s.slice(6) };
  const m = s.match(/^tests:(.+)@(.+)$/);
  if (m) return { kind: "tests", suite: m[1]!, mutant: m[2] === "correct" ? null : m[2]! };
  throw new Error(`unknown variant ${s}`);
}

export interface Layer {
  path: string;
  mode: "task" | "candidate" | "candidate-tests";
  optional?: boolean;
}

/** Layers over the refapp snapshot, in order (spec 1a section 7: mutant 0 = staged state). */
export function layers(taskDir: string, v: Variant, testAuthoring: boolean): Layer[] {
  const t = (rel: string): Layer => ({ path: join(taskDir, rel), mode: "task" });
  const overlay: Layer = { ...t("overlay"), optional: true };
  const production = (mutant: string | null): Layer[] =>
    mutant === "m0"
      ? [overlay]
      : mutant === null
      ? [overlay, t("correct")]
      : [overlay, t("correct"), t(`mutants/${mutant}`)];
  switch (v.kind) {
    case "baseline":
      return [overlay];
    case "correct":
      return [overlay, t("correct")];
    case "naive":
      return [overlay, t(`naive/${v.name}`)];
    case "tests":
      return [...production(v.mutant), t(v.suite)];
    case "candidate":
      return testAuthoring
        ? [...production(v.mutant), { path: v.dir, mode: "candidate-tests" }]
        : [overlay, { path: v.dir, mode: "candidate" }];
  }
}

const OBJECT_RE =
  /^\s*(table|tableextension|page|pageextension|codeunit|report|reportextension|query|xmlport|enum|enumextension|permissionset|permissionsetextension)\s+(\d+)\s/gim;
export function objectIds(al: string): number[] {
  return [...al.matchAll(OBJECT_RE)].map((m) => Number(m[2]));
}
export const isTestCodeunit = (al: string) => /Subtype\s*=\s*Test\s*;/i.test(al);

export interface TestRef {
  codeunit: number;
  procedures: string[];
}

/** The [Test] procedures of a test codeunit file, or null for any other file. */
export function parseTestManifest(al: string): TestRef | null {
  if (!isTestCodeunit(al)) return null;
  const codeunit = objectIds(al)[0];
  if (codeunit === undefined) return null;
  const procedures = [
    ...al.matchAll(
      /\[Test\][^\n]*\r?\n(?:\s*\[[^\]]*\][^\n]*\r?\n)*\s*(?:local\s+)?procedure\s+([A-Za-z0-9_]+)\s*\(/gi,
    ),
  ].map((m) => m[1]!);
  return { codeunit, procedures };
}

export interface ProcResult {
  codeunit: number;
  procedure: string;
  passed: boolean;
  failure: "assertion" | "runtime_error" | null;
  message?: string;
}

/**
 * M1-17 `classifyTestFailure` rule, plus BC's lost-asserterror text (the
 * test's own expectation losing). Parity with M1-17 is an open question.
 */
export function classifyTestFailure(error: string): "assertion" | "runtime_error" {
  return /\bAssert\.\w+ failed\b/i.test(error) ||
      /An error was expected inside an ASSERTERROR statement/i.test(error)
    ? "assertion"
    : "runtime_error";
}

export interface Tally {
  expected: number;
  passed: number;
  assertion: number;
  runtime: number;
  missing: number;
}

export function tally(tests: ProcResult[], refs: TestRef[]): Tally {
  const t: Tally = { expected: 0, passed: 0, assertion: 0, runtime: 0, missing: 0 };
  for (const r of refs) {
    for (const p of r.procedures) {
      t.expected++;
      const hit = tests.find((x) => x.codeunit === r.codeunit && x.procedure === p);
      if (!hit) t.missing++;
      else if (hit.passed) t.passed++;
      else if (hit.failure === "assertion") t.assertion++;
      else t.runtime++;
    }
  }
  return t;
}
export const complete = (t: Tally) => t.expected > 0 && t.missing === 0;
export const allPass = (t: Tally) => complete(t) && t.passed === t.expected;
/** Killed: every expected procedure ran and at least one lost an assertion. */
export const assertionKill = (t: Tally) => complete(t) && t.assertion > 0;

export interface BuildStep {
  app: string;
  stage: "compile" | "publish";
  ok: boolean;
  codes: string[];
  detail?: string;
}
export interface RunResult {
  variant: string;
  repeat: number;
  usesOracle: boolean;
  /** Expected procedures of the suite under test (test-authoring, pilot). */
  own: TestRef[];
  builds: BuildStep[];
  tests: ProcResult[];
  staged_hash: string;
  ms: number;
  infra?: string;
}
export type AppState = "ok" | "compile_fail" | "publish_fail" | "not_run";
export interface RunSummary {
  refapp: AppState;
  oracle: AppState | null;
  oracleCodes: string[];
  p2p: Tally;
  f2p: Tally | null;
  own: Tally | null;
  infra: boolean;
}

function appState(run: RunResult, app: string): AppState {
  const b = run.builds.find((x) => x.app === app);
  if (!b) return "not_run";
  if (b.ok) return "ok";
  return b.stage === "compile" ? "compile_fail" : "publish_fail";
}

export function summarize(task: HarnessTask, run: RunResult): RunSummary {
  const states = BUILD_ORDER.map((a) => appState(run, a));
  const oracle = run.usesOracle ? appState(run, "Oracle") : null;
  const testBuilt = appState(run, "Test") === "ok";
  const p2p = tally(run.tests, task.pass_to_pass);
  const f2p = task.fail_to_pass && oracle === "ok" ? tally(run.tests, task.fail_to_pass.tests) : null;
  const own = run.own.length > 0 ? tally(run.tests, run.own) : null;
  return {
    refapp: states.find((s) => s !== "ok") ?? "ok",
    oracle,
    oracleCodes: run.builds.find((b) => b.app === "Oracle")?.codes ?? [],
    p2p,
    f2p,
    own,
    // Missing results from an app that built are infra, never evidence (GH #13 rule).
    infra: run.infra !== undefined || states.includes("publish_fail") ||
      oracle === "publish_fail" || (testBuilt && p2p.missing > 0) ||
      (f2p !== null && f2p.missing > 0) || (testBuilt && own !== null && own.missing > 0),
  };
}

export interface PlanEntry {
  variant: Variant;
  repeat: number;
}
export interface GateRun extends PlanEntry {
  summary: RunSummary;
  staged_hash: string;
}
export const runKey = (v: Variant, repeat: number) => `${variantName(v)}#${repeat}`;

export function gatePlan(task: HarnessTask, naive: string[]): PlanEntry[] {
  const plan: PlanEntry[] = [];
  const add = (variant: Variant, n: number) => {
    for (let i = 1; i <= n; i++) plan.push({ variant, repeat: i });
  };
  add({ kind: "baseline" }, 1);
  if (task.kind !== "test-authoring") {
    add({ kind: "correct" }, CORRECT_RUNS);
    for (const name of naive) add({ kind: "naive", name }, NAIVE_RUNS);
    return plan;
  }
  const targets = ["m0", ...task.mutants];
  add({ kind: "tests", suite: "reference-tests", mutant: null }, CORRECT_RUNS);
  for (const m of targets) add({ kind: "tests", suite: "reference-tests", mutant: m }, 1);
  for (const name of naive) {
    add({ kind: "tests", suite: `naive/${name}`, mutant: null }, 1);
    for (const m of targets) add({ kind: "tests", suite: `naive/${name}`, mutant: m }, 1);
  }
  return plan;
}

/** Spec 1b section 8 on a complete matrix; see "Decisions argued from the spec". */
export function decideGate(
  task: HarnessTask,
  plan: PlanEntry[],
  runs: GateRun[],
): { promoted: boolean; matrix_complete: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const byKey = new Map(runs.map((r) => [runKey(r.variant, r.repeat), r]));
  let matrixComplete = true;
  for (const p of plan) {
    if (!byKey.has(runKey(p.variant, p.repeat))) {
      matrixComplete = false;
      reasons.push(`matrix incomplete: ${runKey(p.variant, p.repeat)} has no run`);
    }
  }
  const hashes = new Map<string, string>();
  for (const r of runs) {
    const name = variantName(r.variant);
    if (hashes.has(name) && hashes.get(name) !== r.staged_hash) {
      reasons.push(`${name}: staged content differs between repeats`);
    }
    hashes.set(name, r.staged_hash);
    if (r.summary.infra) reasons.push(`${runKey(r.variant, r.repeat)}: infra, rerun (never scored)`);
  }
  const check = (
    pred: (v: Variant) => boolean,
    test: (s: RunSummary) => boolean,
    why: string,
  ) => {
    for (const r of runs.filter((x) => pred(x.variant))) {
      if (!r.summary.infra && !test(r.summary)) reasons.push(`${runKey(r.variant, r.repeat)}: ${why}`);
    }
  };
  const built = (s: RunSummary) => s.refapp === "ok";
  const naiveNames = new Set(
    plan.flatMap((p) =>
      p.variant.kind === "naive"
        ? [p.variant.name]
        : p.variant.kind === "tests" && p.variant.suite.startsWith("naive/")
        ? [p.variant.suite]
        : []
    ),
  );
  if (naiveNames.size < 2) reasons.push("fewer than two naive variants (spec 1b section 8)");

  if (task.kind !== "test-authoring") {
    check(
      (v) => v.kind === "baseline",
      (s) =>
        built(s) && allPass(s.p2p) &&
        (s.oracle === "compile_fail"
          ? s.oracleCodes.length > 0 && s.oracleCodes.every((c) => MISSING_FEATURE_CODES.has(c))
          : s.oracle === "ok" && s.f2p !== null && complete(s.f2p) && !allPass(s.f2p)),
      "baseline must build, pass pass_to_pass and fail fail_to_pass",
    );
    check(
      (v) => v.kind === "correct",
      (s) => built(s) && allPass(s.p2p) && s.oracle === "ok" && s.f2p !== null && allPass(s.f2p),
      "correct/ must pass every scorer",
    );
    check(
      (v) => v.kind === "naive",
      (s) => built(s) && s.oracle === "ok" && s.f2p !== null && assertionKill(s.f2p),
      "naive must build and lose an oracle assertion with every listed procedure run",
    );
  } else {
    const suite = (name: string, onCorrect: boolean) => (v: Variant) =>
      v.kind === "tests" && v.suite === name && (v.mutant === null) === onCorrect;
    const naiveSuite = (onCorrect: boolean) => (v: Variant) =>
      v.kind === "tests" && v.suite.startsWith("naive/") && (v.mutant === null) === onCorrect;
    check((v) => v.kind === "baseline", (s) => built(s) && allPass(s.p2p), "baseline must build and pass pass_to_pass");
    check(
      suite("reference-tests", true),
      (s) => built(s) && allPass(s.p2p) && s.own !== null && allPass(s.own),
      "reference tests must all pass on correct/",
    );
    check(
      suite("reference-tests", false),
      (s) => built(s) && s.own !== null && assertionKill(s.own),
      "reference tests must kill this target by assertion",
    );
    check(
      naiveSuite(true),
      (s) => built(s) && s.own !== null && allPass(s.own),
      "naive suite must pass on correct/, or it fails for the wrong reason",
    );
    check(
      naiveSuite(false),
      (s) => built(s) && s.own !== null && complete(s.own),
      "naive suite run is incomplete",
    );
    for (const name of naiveNames) {
      const survives = runs.some((r) =>
        r.variant.kind === "tests" && r.variant.suite === name && r.variant.mutant !== null &&
        r.summary.own !== null && allPass(r.summary.own)
      );
      if (!survives) reasons.push(`${name} must leave at least one mutant alive`);
    }
  }
  return { promoted: reasons.length === 0, matrix_complete: matrixComplete, reasons };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/gate-core.test.ts`
Expected: `ok | 19 passed | 0 failed`.

- [ ] **Step 5: Check, lint, format, commit**

```bash
deno check scripts/harness/gate-core.ts tests/unit/harness/gate-core.test.ts
deno lint scripts/harness/gate-core.ts tests/unit/harness/gate-core.test.ts
deno fmt scripts/harness/gate-core.ts tests/unit/harness/gate-core.test.ts
git add scripts/harness/gate-core.ts tests/unit/harness/gate-core.test.ts tests/fixtures/harness/conformance/mixed-assertion-missing.json
git commit -m "feat(harness): M4 gate decision contract"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/gate-core.test.ts` prints `ok | 19 passed | 0 failed`; check and lint clean; the test file contains the named cases of Review Focus 1 and 2; the conformance fixture exists.

---

### Task M4-01b: staging from a revision and static checks

**Lane:** ops. **Deps:** M4-01a, M1-02 (merged: `hashTree`). **Target:** 09-30.

**Files:**
- Create: `scripts/harness/gate-stage.ts`
- Create: `tests/unit/harness/gate-fixtures.ts`
- Test: `tests/unit/harness/gate-stage.test.ts`

**Interfaces:**
- Consumes: M4-01a exports; `hashTree(dir, "task")` (M1-02); `loadTask`, `type LoadedTask` (M1-01).
- Produces: `exists`, `git(cwd, args, env?)`; `interface Source { commit; root; refappDir; refappTree; taskDir; taskTree }`; `exportSource(repo, rev, taskId, out): Promise<Source>`; `stageWorkspace(refappDir, layers: Layer[], out): Promise<void>`; `stagedHash(dir): Promise<string>`; `testManifestIn(dir): Promise<TestRef[]>`; `checkTask(loaded, refappDir, repoRoot, opts?: { drift?: boolean }): Promise<{ problems: string[]; warnings: string[] }>`. Fixture: `writeRefapp(root)`, `writeTask(root, id, promptText)`, `write(root, rel, text)`.

- [ ] **Step 1: Shared fixture** `tests/unit/harness/gate-fixtures.ts`:

```typescript
import { dirname, join } from "@std/path";
import { BUILD_ORDER } from "../../../scripts/harness/gate-core.ts";

/** Unit-test temp root under the launch contract's authorized output root. */
export const TEST_TMP = join(
  Deno.env.get("CG_GATE_TMP") ?? "H:\\Temp3\\harness-spike\\M4\\tmp",
  "unit",
);
export async function tmp(): Promise<string> {
  await Deno.mkdir(TEST_TMP, { recursive: true });
  return await Deno.makeTempDir({ dir: TEST_TMP });
}

export async function write(root: string, rel: string, text: string): Promise<void> {
  await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
  await Deno.writeTextFile(join(root, rel), text);
}

const TEST_CU = (id: number, proc: string) =>
  `codeunit ${id} "T${id}"\n{\n    Subtype = Test;\n    TestPermissions = Disabled;\n\n    [Test]\n    procedure ${proc}()\n    begin\n    end;\n}\n`;
export { TEST_CU };

/** A refapp with all seven modules (stageWorkspace refuses an incomplete one). */
export async function writeRefapp(refapp: string): Promise<void> {
  let n = 0;
  for (const m of BUILD_ORDER) {
    n++;
    await write(refapp, `${m}/app.json`, JSON.stringify({ id: `c6a1e000-0000-4000-8000-00000000000${n}` }));
  }
  await write(refapp, "Core/src/A.al", 'codeunit 70000 "A"\n{\n}\n');
  await write(refapp, "Test/src/V.al", TEST_CU(80010, "Visible"));
}

/** Repo layout harness-tasks/{refapp,tasks/<id>} with a clean bugfix task. */
export async function writeTask(root: string, id: string, promptText: string): Promise<string> {
  await writeRefapp(join(root, "harness-tasks/refapp"));
  const dir = join(root, "harness-tasks/tasks", id);
  await write(dir, "task.yml", `id: ${id}
refapp_version: refapp-v1-rc1
kind: bugfix
prompt: prompt.md
source: refapp
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80010, procedures: [Visible] }
fail_to_pass:
  depends_on: [Core]
  tests:
    - { codeunit: 85000, procedures: [Hidden] }
`);
  await write(dir, "prompt.md", promptText);
  await write(dir, "oracle/app.json", JSON.stringify({
    id: "c6a1e000-0000-4000-8001-000000000001",
    name: `CGR Oracle ${id}`,
    publisher: "CentralGauge",
    idRanges: [{ from: 85000, to: 85099 }],
    dependencies: [{ name: "CGR Core" }, { name: "Library Assert" }],
  }));
  await write(dir, "oracle/src/O.al", TEST_CU(85000, "Hidden"));
  for (const l of ["overlay", "correct", "naive/x", "naive/y"]) {
    await write(dir, `${l}/Core/src/A.al`, 'codeunit 70000 "A"\n{\n    // ' + l + "\n}\n");
  }
  return dir;
}
```

- [ ] **Step 2: Write the failing test** `tests/unit/harness/gate-stage.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { layers } from "../../../scripts/harness/gate-core.ts";
import {
  checkTask,
  exportSource,
  stageWorkspace,
  testManifestIn,
} from "../../../scripts/harness/gate-stage.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { TEST_CU, tmp, write, writeRefapp, writeTask } from "./gate-fixtures.ts";

const git = (cwd: string, ...args: string[]) =>
  new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" }).output();
async function commitAll(root: string, tag?: string) {
  await git(root, "add", "-A");
  await git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x");
  if (tag) await git(root, "tag", tag);
}

Deno.test("stageWorkspace: precedence, build output skipped, bad layers refused", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  await write(refapp, "Core/.alpackages/x.app", "bin");
  const task = join(root, "task");
  await write(task, "overlay/Core/src/A.al", "bug");
  await write(task, "correct/Core/src/A.al", "fix");
  await write(task, "correct/Core/src/B.al", "new");
  const out = join(root, "out");
  await stageWorkspace(refapp, layers(task, { kind: "correct" }, false), out);
  assertEquals(await Deno.readTextFile(join(out, "Core/src/A.al")), "fix");
  assertEquals(await Deno.readTextFile(join(out, "Core/src/B.al")), "new");
  await assertRejects(() => Deno.stat(join(out, "Core/.alpackages/x.app")));
  await write(task, "naive/bad/Elsewhere/x.al", "x");
  await assertRejects(
    () => stageWorkspace(refapp, layers(task, { kind: "naive", name: "bad" }, false), join(root, "o2")),
    Error,
    "module folder",
  );
  await write(task, "naive/empty/Core/src/A.al", "");
  await assertRejects(
    () => stageWorkspace(refapp, layers(task, { kind: "naive", name: "empty" }, false), join(root, "o3")),
    Error,
    "deletion",
  );
  await Deno.remove(join(refapp, "Reporting"), { recursive: true });
  await assertRejects(() => stageWorkspace(refapp, [], join(root, "o4")), Error, "Reporting");
});

Deno.test("stageWorkspace: candidate layer cannot replace a shipped test", async () => {
  const root = await tmp();
  const refapp = join(root, "refapp");
  await writeRefapp(refapp);
  const cand = join(root, "ws");
  await write(cand, "Test/src/V.al", "always passes");
  await write(cand, "Test/src/New.al", TEST_CU(80200, "Mine"));
  await write(cand, "Core/src/A.al", "agent change");
  await write(cand, "Core/notes.txt", "ignored");
  const out = join(root, "out");
  await stageWorkspace(refapp, [{ path: cand, mode: "candidate" }], out);
  assertStringIncludes(await Deno.readTextFile(join(out, "Test/src/V.al")), "Visible");
  assertStringIncludes(await Deno.readTextFile(join(out, "Test/src/New.al")), "Mine");
  assertEquals(await Deno.readTextFile(join(out, "Core/src/A.al")), "agent change");
  await assertRejects(() => Deno.stat(join(out, "Core/notes.txt")));
  const out2 = join(root, "out2");
  await stageWorkspace(refapp, [{ path: cand, mode: "candidate-tests" }], out2);
  assertStringIncludes(await Deno.readTextFile(join(out2, "Core/src/A.al")), "codeunit 70000");
});

Deno.test("testManifestIn: [Test] procedures per codeunit", async () => {
  const root = await tmp();
  await write(root, "Test/src/T.al", TEST_CU(80100, "One"));
  await write(root, "Test/src/L.al", 'codeunit 80101 "L"\n{\n}\n');
  assertEquals(await testManifestIn(root), [{ codeunit: 80100, procedures: ["One"] }]);
});

Deno.test("checkTask: clean fixture has no problems", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\nThe vehicle is not blocked.\n");
  const { problems } = await checkTask(await loadTask(dir), join(root, "harness-tasks/refapp"), root);
  assertEquals(problems, []);
});

Deno.test("checkTask: every static rule fires", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "Make Hidden pass.\n");
  await write(dir, "oracle/src/P.al", 'codeunit 80001 "P"\n{\n    Subtype = Test;\n}\n');
  await write(dir, "correct/Test/src/V.al", TEST_CU(80010, "Visible"));
  await write(dir, "naive/x/Core/src/Z.al", "");
  await Deno.remove(join(dir, "naive/y"), { recursive: true });
  await write(dir, "oracle/app.json", JSON.stringify({
    id: "c6a1e000-0000-4000-8001-000000000009",
    name: "Wrong",
    publisher: "CentralGauge",
    idRanges: [{ from: 85000, to: 85099 }],
    dependencies: [{ name: "CGR Test" }],
  }));
  const all = (await checkTask(await loadTask(dir), join(root, "harness-tasks/refapp"), root))
    .problems.join("\n");
  for (
    const needle of [
      "hidden name Hidden",
      "object id 80001 outside Oracle",
      "TestPermissions",
      "no [Test] procedure",
      "at least two",
      "must not touch Test/",
      "deletion",
      "oracle/app.json: id",
      "oracle/app.json: name",
      "dependency CGR Test",
    ]
  ) assertStringIncludes(all, needle);
});

Deno.test("check refuses a test suite that replaces Test/app.json", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-002", "# Task\n");
  const yml = join(dir, "task.yml");
  await Deno.writeTextFile(
    yml,
    (await Deno.readTextFile(yml))
      .replace("kind: bugfix", "kind: test-authoring")
      .replace("fail_to_pass]", "mutant_kill]")
      .replace(/fail_to_pass:\n[\s\S]*$/, ""),
  );
  await write(dir, "reference-tests/Test/app.json", "{}");
  await write(dir, "reference-tests/Test/src/R.al", TEST_CU(80100, "Ref"));
  const all = (await checkTask(await loadTask(dir), join(root, "harness-tasks/refapp"), root))
    .problems.join("\n");
  assertStringIncludes(all, "reference-tests/Test/app.json: replaces a shipped test");
});

Deno.test("drift: replaced file is a problem, other change a warning", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root, "refapp-v1-rc1");
  const refapp = join(root, "harness-tasks/refapp");
  await write(refapp, "Core/src/A.al", 'codeunit 70000 "A"\n{\n    // slice\n}\n');
  await write(refapp, "Fleet/src/N.al", 'codeunit 70150 "N"\n{\n}\n');
  const r = await checkTask(await loadTask(dir), refapp, root);
  assert(r.problems.some((p) => p.includes("Core/src/A.al") && p.includes("refapp-v1-rc1")), r.problems.join("; "));
  assert(r.warnings.some((w) => w.includes("re-gate")), r.warnings.join("; "));
});

Deno.test("exportSource ignores working tree changes", async () => {
  const root = await tmp();
  await writeTask(root, "HX-001", "# Bug\n");
  await git(root, "init", "-q");
  await commitAll(root, "refapp-v1-rc1");
  await write(join(root, "harness-tasks/refapp"), "Core/src/A.al", "dirty");
  const out = await tmp();
  const src = await exportSource(root, "refapp-v1-rc1", "HX-001", out);
  assertStringIncludes(await Deno.readTextFile(join(src.refappDir, "Core/src/A.al")), "codeunit 70000");
  assertEquals(src.commit.length, 40);
  assertEquals(src.refappTree.length, 40);
  assert(await loadTask(src.taskDir));
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/gate-stage.test.ts`
Expected: FAIL, `Module not found ".../scripts/harness/gate-stage.ts"`.

- [ ] **Step 4: Implement** `scripts/harness/gate-stage.ts`:

```typescript
// Staging from a git revision and static checks for the M4 authoring gate.
// No container. Owner: lane-ops.
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import type { Layer, TestRef } from "./gate-core.ts";
import type { LoadedTask } from "../../src/harness/task.ts";
import { hashTree } from "../../src/harness/hash.ts";
import { BUILD_ORDER, isTestCodeunit, objectIds, parseTestManifest, RANGES } from "./gate-core.ts";

export async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

export async function git(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command("git", {
    args,
    cwd,
    ...(env ? { env } : {}),
    stdout: "piped",
    stderr: "null",
  }).output();
  return { ok: r.success, out: new TextDecoder().decode(r.stdout) };
}

const posix = (p: string) => p.replaceAll("\\", "/");

export interface Source {
  commit: string;
  root: string;
  refappDir: string;
  refappTree: string;
  taskDir: string;
  taskTree: string;
}

/**
 * Write `harness-tasks` of `rev` into `out` from git objects, through a
 * private index, so the working tree and the repo index are never read or
 * touched. The gate stages exactly the commit it reports.
 */
export async function exportSource(repo: string, rev: string, taskId: string, out: string): Promise<Source> {
  const c = await git(repo, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
  if (!c.ok) throw new Error(`${rev} does not resolve to a commit`);
  const commit = c.out.trim();
  const env = { GIT_INDEX_FILE: join(out, ".gate-index") };
  if (!(await git(repo, ["read-tree", `--prefix=harness-tasks/`, `${commit}:harness-tasks`], env)).ok) {
    throw new Error(`read-tree ${commit}:harness-tasks failed`);
  }
  if (!(await git(repo, ["checkout-index", "-a", "-f", `--prefix=${posix(out)}/`], env)).ok) {
    throw new Error("checkout-index failed");
  }
  await Deno.remove(env.GIT_INDEX_FILE);
  const tree = async (p: string) => {
    const r = await git(repo, ["rev-parse", "--verify", "-q", `${commit}:${p}`]);
    if (!r.ok) throw new Error(`${p} not in ${commit}`);
    return r.out.trim();
  };
  return {
    commit,
    root: out,
    refappDir: join(out, "harness-tasks", "refapp"),
    refappTree: await tree("harness-tasks/refapp"),
    taskDir: join(out, "harness-tasks", "tasks", taskId),
    taskTree: await tree(`harness-tasks/tasks/${taskId}`),
  };
}

function isBuildOutput(rel: string): boolean {
  const parts = rel.split("/");
  return parts.includes(".alpackages") || parts.includes("output") || rel.toLowerCase().endsWith(".app");
}

async function* files(root: string): AsyncGenerator<{ path: string; rel: string }> {
  for await (const e of walk(root, { followSymlinks: false })) {
    if (e.isSymlink) throw new Error(`link refused: ${e.path}`);
    if (e.isFile) yield { path: e.path, rel: posix(relative(root, e.path)) };
  }
}

async function put(src: string, out: string, rel: string) {
  await Deno.mkdir(dirname(join(out, rel)), { recursive: true });
  await Deno.copyFile(src, join(out, rel));
}

/** Refapp modules (all seven required), then each layer (spec 1b section 5). */
export async function stageWorkspace(refappDir: string, ls: Layer[], out: string): Promise<void> {
  for (const m of BUILD_ORDER) {
    if (!(await exists(join(refappDir, m, "app.json")))) throw new Error(`refapp module missing: ${m}`);
    for await (const f of files(join(refappDir, m))) {
      if (!isBuildOutput(f.rel)) await put(f.path, join(out, m), f.rel);
    }
  }
  for (const l of ls) {
    if (!(await exists(l.path))) {
      if (l.optional) continue;
      throw new Error(`layer folder missing: ${l.path}`);
    }
    for await (const f of files(l.path)) {
      const top = f.rel.split("/")[0]!;
      if (isBuildOutput(f.rel)) continue;
      if (l.mode === "task") {
        if (!BUILD_ORDER.includes(top)) throw new Error(`${f.path}: layer files must sit under a module folder`);
        if ((await Deno.stat(f.path)).size === 0) throw new Error(`${f.path}: deletion is not supported`);
        await put(f.path, out, f.rel);
        continue;
      }
      // Agent workspace: sources and manifests only; shipped tests are restored (spec 1a section 7).
      if (!BUILD_ORDER.includes(top)) continue;
      if (!f.rel.endsWith(".al") && f.rel !== `${top}/app.json`) continue;
      if (top === "Test" && (await exists(join(out, f.rel)))) continue;
      if (l.mode === "candidate-tests" && top !== "Test") continue;
      await put(f.path, out, f.rel);
    }
  }
}

export const stagedHash = (dir: string) => hashTree(dir, "task");

export async function testManifestIn(dir: string): Promise<TestRef[]> {
  const out: TestRef[] = [];
  if (!(await exists(dir))) return out;
  for await (const f of files(dir)) {
    if (!f.rel.endsWith(".al")) continue;
    const m = parseTestManifest(await Deno.readTextFile(f.path));
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.codeunit - b.codeunit);
}

async function subdirs(p: string): Promise<string[]> {
  if (!(await exists(p))) return [];
  const out: string[] = [];
  for await (const e of Deno.readDir(p)) if (e.isDirectory) out.push(e.name);
  return out.sort();
}

interface AlFile {
  source: string; // "refapp" | layer folder, e.g. "correct", "naive/x", "oracle"
  rel: string; // module-rooted posix path, e.g. "Fleet/src/X.al"
  module: string;
  text: string;
}

/** Static rules. Problems block; warnings do not. */
export async function checkTask(
  loaded: LoadedTask,
  refappDir: string,
  repoRoot: string,
  opts: { drift?: boolean } = {},
): Promise<{ problems: string[]; warnings: string[] }> {
  const { task, dir } = loaded;
  const problems: string[] = [];
  const warnings: string[] = [];
  const testAuthoring = task.kind === "test-authoring";
  const naive = await subdirs(join(dir, "naive"));
  if (naive.length < 2) problems.push("naive/ needs at least two variants (spec 1b section 8)");
  if (task.mutants.includes("m0")) problems.push("mutant name m0 is reserved for the staged state");
  if (testAuthoring && !(await exists(join(dir, "reference-tests")))) {
    problems.push("test-authoring needs reference-tests/");
  }

  const layerRoots = [
    "overlay",
    "correct",
    "reference-tests",
    ...naive.map((n) => `naive/${n}`),
    ...task.mutants.map((m) => `mutants/${m}`),
  ];
  const all: AlFile[] = [];
  const layerFiles: { source: string; rel: string; size: number }[] = [];
  for (const m of BUILD_ORDER) {
    const root = join(refappDir, m);
    if (!(await exists(root))) continue;
    for await (const f of files(root)) {
      if (f.rel.endsWith(".al")) {
        all.push({ source: "refapp", rel: `${m}/${f.rel}`, module: m, text: await Deno.readTextFile(f.path) });
      }
    }
  }
  if (await exists(join(dir, "oracle"))) {
    for await (const f of files(join(dir, "oracle"))) {
      if (f.rel.endsWith(".al")) {
        all.push({ source: "oracle", rel: f.rel, module: "Oracle", text: await Deno.readTextFile(f.path) });
      }
    }
  }
  for (const lr of layerRoots) {
    const root = join(dir, lr);
    if (!(await exists(root))) continue;
    for await (const f of files(root)) {
      layerFiles.push({ source: lr, rel: f.rel, size: (await Deno.stat(f.path)).size });
      if (f.rel.endsWith(".al")) {
        all.push({ source: lr, rel: f.rel, module: f.rel.split("/")[0]!, text: await Deno.readTextFile(f.path) });
      }
    }
  }

  for (const f of all) {
    const where = `${f.source}/${f.rel}`;
    const range = RANGES[f.module];
    if (!range) {
      problems.push(`${where}: not under a module folder`);
      continue;
    }
    for (const id of objectIds(f.text)) {
      if (id < range[0] || id > range[1]) {
        problems.push(`${where}: object id ${id} outside ${f.module} range ${range[0]}-${range[1]}`);
      }
      if (f.module === "Test" && id === 80013) problems.push(`${where}: 80013 collides on Cronus28`);
    }
    if (isTestCodeunit(f.text)) {
      if (!/TestPermissions\s*=\s*Disabled\s*;/i.test(f.text)) {
        problems.push(`${where}: test codeunit without TestPermissions = Disabled`);
      }
      if ((parseTestManifest(f.text)?.procedures.length ?? 0) === 0) {
        problems.push(`${where}: test codeunit with no [Test] procedure`);
      }
    }
    if (/Assert\.(IsTrue\(\s*true|IsFalse\(\s*false)\b/i.test(f.text)) {
      problems.push(`${where}: placeholder assertion`);
    }
  }

  // Every shipped Test/ file is protected, not only .al (Test/app.json included).
  const shippedTests = new Set<string>();
  for (const root of [join(refappDir, "Test"), join(dir, "overlay", "Test")]) {
    if (!(await exists(root))) continue;
    for await (const f of files(root)) shippedTests.add(`Test/${f.rel}`);
  }
  for (const f of layerFiles) {
    const where = `${f.source}/${f.rel}`;
    if (f.size === 0) problems.push(`${where}: zero-byte file; deletion is not supported`);
    const inTest = f.rel.startsWith("Test/");
    const suite = testAuthoring && (f.source === "reference-tests" || f.source.startsWith("naive/"));
    if (suite && !inTest) problems.push(`${where}: test suites add files under Test/ only`);
    if (suite && shippedTests.has(f.rel)) problems.push(`${where}: replaces a shipped test`);
    if (!suite && f.source !== "overlay" && inTest) {
      problems.push(`${where}: correct/, naive/ and mutants/ must not touch Test/`);
    }
  }

  const declares = (pool: AlFile[], codeunit: number, proc: string) =>
    pool.some((f) => {
      const m = parseTestManifest(f.text);
      return m?.codeunit === codeunit && m.procedures.includes(proc);
    });
  const visible = all.filter((f) => f.module === "Test" && (f.source === "refapp" || f.source === "overlay"));
  for (const r of task.pass_to_pass) {
    for (const p of r.procedures) {
      if (!declares(visible, r.codeunit, p)) problems.push(`pass_to_pass ${r.codeunit}.${p} not found in shipped tests`);
    }
  }
  const hidden: string[] = [...task.mutants];
  if (task.fail_to_pass) {
    const oracle = all.filter((f) => f.module === "Oracle");
    for (const r of task.fail_to_pass.tests) {
      hidden.push(String(r.codeunit), ...r.procedures);
      for (const p of r.procedures) {
        if (!declares(oracle, r.codeunit, p)) problems.push(`fail_to_pass ${r.codeunit}.${p} not found in oracle/`);
      }
    }
    const app = JSON.parse(await Deno.readTextFile(join(dir, "oracle", "app.json"))) as {
      id?: string;
      name?: string;
      publisher?: string;
      idRanges?: { from: number; to: number }[];
      dependencies?: { name: string }[];
    };
    const n = task.id.slice(3);
    if (app.id !== `c6a1e000-0000-4000-8001-000000000${n}`) problems.push(`oracle/app.json: id must be c6a1e000-0000-4000-8001-000000000${n}`);
    if (app.name !== `CGR Oracle ${task.id}`) problems.push(`oracle/app.json: name must be CGR Oracle ${task.id}`);
    if (app.publisher !== "CentralGauge") problems.push("oracle/app.json: publisher must be CentralGauge");
    const allowed = new Set([...task.fail_to_pass.depends_on.map((m) => `CGR ${m}`), "Library Assert"]);
    allowed.delete("CGR Test");
    for (const d of app.dependencies ?? []) {
      if (!allowed.has(d.name)) problems.push(`oracle/app.json: dependency ${d.name} not allowed`);
    }
    for (const r of app.idRanges ?? []) {
      if (r.from < 85000 || r.to > 89999) problems.push("oracle/app.json: idRanges outside 85000-89999");
    }
  }
  const prompt = await Deno.readTextFile(join(dir, task.prompt));
  for (const h of hidden) {
    if (new RegExp(`\\b${h}\\b`).test(prompt)) problems.push(`prompt.md mentions hidden name ${h}`);
  }
  if (/\b(oracle|mutants?)\b/i.test(prompt)) problems.push("prompt.md mentions the oracle or mutants");

  if (opts.drift !== false) {
    const tag = task.refapp_version;
    if (!(await git(repoRoot, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`])).ok) {
      warnings.push(`refapp_version ${tag} does not resolve yet (tagged on acceptance)`);
    } else {
      const prefix = "harness-tasks/refapp/";
      const changed = [
        ...(await git(repoRoot, ["diff", "--name-only", tag, "--", prefix])).out.split(/\r?\n/),
        ...(await git(repoRoot, ["ls-files", "--others", "--exclude-standard", "--", prefix])).out.split(/\r?\n/),
      ].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
      const replaced = new Set(layerFiles.map((f) => f.rel));
      for (const c of changed) {
        if (replaced.has(c)) problems.push(`${c}: refapp changed since ${tag} under a file this task replaces`);
      }
      if (changed.length > 0) warnings.push(`refapp changed since ${tag} (${changed.length} files): re-gate before freeze`);
    }
  }
  return { problems, warnings };
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/gate-stage.test.ts`
Expected: `ok | 8 passed | 0 failed`.

- [ ] **Step 6: Check, lint, format, commit**

```bash
deno check scripts/harness/gate-stage.ts tests/unit/harness/gate-stage.test.ts tests/unit/harness/gate-fixtures.ts
deno lint scripts/harness/gate-stage.ts tests/unit/harness/gate-stage.test.ts tests/unit/harness/gate-fixtures.ts
deno fmt scripts/harness/gate-stage.ts tests/unit/harness/gate-stage.test.ts tests/unit/harness/gate-fixtures.ts
git add scripts/harness/gate-stage.ts tests/unit/harness/gate-stage.test.ts tests/unit/harness/gate-fixtures.ts
git commit -m "feat(harness): M4 gate staging from a revision and static checks"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/gate-stage.test.ts` prints `ok | 8 passed | 0 failed`; check and lint clean.

---

### Task M4-01c: host and container executors, CLI

**Lane:** ops. **Deps:** M4-01a, M4-01b. **Target:** 10-01 morning (HX-001 gate the same day).

**Files:**
- Create: `scripts/harness/gate-task.ts`
- Test: `tests/unit/harness/gate-task.test.ts`

**Interfaces:**
- Consumes: M4-01a and M4-01b exports; `BcContainerProvider`, `runTestsViaSoap`, `resolveSoapTimeoutMs`, `type ALProject`, `type TestResult`.
- Produces: `interface GateBc { prenuke(); compile(project): Promise<CompileOut>; publish(artifact); runTests(codeunit, appId): Promise<TestResult>; dispose() }`; `containerBc(container, credentials): Promise<GateBc | null>`; `runVariant(bc, task, source, v, repeat, tmpRoot): Promise<RunResult>`; `runGate(o: { bc; loaded; source; container; outDir; tmpRoot; tagTree: string | null }): Promise<{ file: string; code: number }>`; CLI:
  - `check <taskDir>...` (working tree, no container)
  - `compile <taskDir> <variant>` (working tree, host `al`, no container)
  - `stage <taskId> <outDir> [--rev R]` (staged baseline workspace for the pilot, no hidden files)
  - `gate <container> <taskId> [--rev R]` (container job; default rev `HEAD`)
  - `judge <container> <taskId> <workspaceDir> [--rev R]` (pilot: scores an agent workspace; developmental)
  Report `H:\Temp3\harness-spike\M4\<id>\gate-<stamp>.json`: `{ task, source_commit, refapp_tree, task_tree, refapp_version, tag_status, container, at, plan, matrix_complete, promoted, reasons, cleanup_error, runs[] }`. Exit 0 promoted, 1 not promoted, 3 infra.

- [ ] **Step 1: Write the failing test** `tests/unit/harness/gate-task.test.ts` (mocked BC, no container):

```typescript
import { assert, assertEquals } from "@std/assert";
import { basename, join } from "@std/path";
import type { ALProject, TestResult } from "../../../src/container/types.ts";
import type { GateBc } from "../../../scripts/harness/gate-task.ts";
import { runGate, runVariant } from "../../../scripts/harness/gate-task.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { tmp, writeTask } from "./gate-fixtures.ts";

function mockBc(o: {
  failCompile?: string;
  failPublish?: string;
  soapThrows?: boolean;
  emptyResults?: boolean;
  prenukeThrowsAfter?: number;
  seen?: string[];
}): GateBc {
  let prenukes = 0;
  return {
    prenuke: () => {
      prenukes++;
      if (o.prenukeThrowsAfter !== undefined && prenukes > o.prenukeThrowsAfter) {
        return Promise.reject(new Error("prenuke failed"));
      }
      return Promise.resolve();
    },
    compile: async (p: ALProject) => {
      o.seen?.push(p.path);
      if (basename(p.path) === o.failCompile) {
        return { ok: false, codes: ["AL0118"], detail: "AL0118 missing" };
      }
      const artifact = join(p.path, "out.app");
      await Deno.writeTextFile(artifact, "x");
      return { ok: true, codes: [], detail: "", artifact };
    },
    publish: (a: string) =>
      a.includes(`${o.failPublish}`) && o.failPublish
        ? Promise.reject(new Error("publish failed"))
        : Promise.resolve(),
    runTests: (codeunit: number): Promise<TestResult> => {
      if (o.soapThrows) return Promise.reject(new Error("SOAP timeout"));
      if (o.emptyResults) {
        return Promise.resolve({
          success: true,
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          duration: 1,
          results: [],
          output: "",
        });
      }
      const name = codeunit === 80010 ? "Visible" : "Hidden";
      return Promise.resolve({
        success: true,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        duration: 1,
        results: [{ name, passed: true, duration: 1 }],
        output: "",
      });
    },
    dispose: () => Promise.resolve(),
  };
}

async function fixture() {
  const root = await tmp();
  const dir = await writeTask(root, "HX-001", "# Bug\n");
  const loaded = await loadTask(dir);
  const source = {
    commit: "c".repeat(40),
    root,
    refappDir: join(root, "harness-tasks/refapp"),
    refappTree: "r".repeat(40),
    taskDir: dir,
    taskTree: "t".repeat(40),
  };
  const tmpRoot = await tmp();
  return { root, loaded, source, tmpRoot };
}

Deno.test("runVariant: compile failure stops the chain and is a compile step", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(mockBc({ failCompile: "Fleet" }), loaded.task, source, { kind: "correct" }, 1, tmpRoot);
  assertEquals(r.builds.map((b) => `${b.app}:${b.stage}:${b.ok}`), ["Core:publish:true", "Fleet:compile:false"]);
  assertEquals(r.builds[1]!.codes, ["AL0118"]);
  assertEquals(r.tests, []);
});

Deno.test("runVariant: oracle publish failure is recorded as publish", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(mockBc({ failPublish: "Oracle" }), loaded.task, source, { kind: "correct" }, 1, tmpRoot);
  assertEquals(r.builds.at(-1), { app: "Oracle", stage: "publish", ok: false, codes: [], detail: "publish failed" });
});

Deno.test("runVariant: temp dirs live under the tmp root and are removed", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const seen: string[] = [];
  await runVariant(mockBc({ seen }), loaded.task, source, { kind: "baseline" }, 1, tmpRoot);
  assert(seen.length > 0 && seen.every((p) => p.startsWith(tmpRoot)), seen.join(", "));
  assertEquals([...Deno.readDirSync(tmpRoot)].length, 0);
});

Deno.test("runGate: SOAP failure is infra and the report survives a failing cleanup", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const outDir = await tmp();
  const { file, code } = await runGate({
    bc: mockBc({ soapThrows: true, prenukeThrowsAfter: 1 }),
    loaded,
    source,
    container: "Mock",
    outDir,
    tmpRoot,
    tagTree: null,
  });
  assertEquals(code, 3);
  const report = JSON.parse(await Deno.readTextFile(file));
  assertEquals(report.promoted, false);
  assertEquals(report.tag_status, "pending");
  assert(report.reasons.some((x: string) => x.includes("infra")));
  assert(String(report.cleanup_error).includes("prenuke failed"));
});

Deno.test("runVariant: candidate test-authoring counts only added codeunits", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const yml = join(source.taskDir, "task.yml");
  await Deno.writeTextFile(
    yml,
    (await Deno.readTextFile(yml))
      .replace("kind: bugfix", "kind: test-authoring")
      .replace("fail_to_pass]", "mutant_kill]")
      .replace(/fail_to_pass:\n[\s\S]*$/, ""),
  );
  const ta = (await loadTask(source.taskDir)).task;
  const ws = await tmp();
  await writeTask(ws, "HX-009", "x"); // any refapp copy; only Test/ below matters
  const cand = join(ws, "harness-tasks/refapp");
  await Deno.writeTextFile(
    join(cand, "Test/src/New.al"),
    'codeunit 80200 "New"\n{\n    Subtype = Test;\n    TestPermissions = Disabled;\n\n    [Test]\n    procedure Mine()\n    begin\n    end;\n}\n',
  );
  const r = await runVariant(mockBc({}), ta, source, { kind: "candidate", dir: cand, mutant: null }, 1, tmpRoot);
  assertEquals(r.own, [{ codeunit: 80200, procedures: ["Mine"] }]);
  assertEquals(loaded.task.id, "HX-001");
});

Deno.test("runVariant: zero results from a codeunit is infra", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const r = await runVariant(mockBc({ emptyResults: true }), loaded.task, source, { kind: "correct" }, 1, tmpRoot);
  assert(r.infra?.includes("zero results"), r.infra);
});

Deno.test("runGate: a staging exception still cleans up and writes an infra report", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  await Deno.remove(join(source.refappDir, "Reporting"), { recursive: true });
  const { file, code } = await runGate({
    bc: mockBc({}),
    loaded,
    source,
    container: "Mock",
    outDir: await tmp(),
    tmpRoot,
    tagTree: null,
  });
  assertEquals(code, 3);
  const report = JSON.parse(await Deno.readTextFile(file));
  assert(report.reasons.some((x: string) => x.includes("refapp module missing")));
});

Deno.test("runGate: tag mismatch blocks promotion", async () => {
  const { loaded, source, tmpRoot } = await fixture();
  const { file } = await runGate({
    bc: mockBc({}),
    loaded,
    source,
    container: "Mock",
    outDir: await tmp(),
    tmpRoot,
    tagTree: "x".repeat(40),
  });
  const report = JSON.parse(await Deno.readTextFile(file));
  assertEquals(report.tag_status, "mismatch");
  assertEquals(report.promoted, false);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/gate-task.test.ts`
Expected: FAIL, `Module not found ".../scripts/harness/gate-task.ts"`.

- [ ] **Step 3: Implement** `scripts/harness/gate-task.ts`:

```typescript
// CLI and executors of the M4 authoring gate. Owner: lane-ops.
//   check <taskDir>...                        static rules, no container
//   compile <taskDir> <variant>               host al compile, no container
//   stage <taskId> <outDir> [--rev R]         baseline workspace for the pilot
//   gate <container> <taskId> [--rev R]       container job
//   judge <container> <taskId> <ws> [--rev R] pilot scoring, developmental
import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import type { ALProject, TestResult } from "../../src/container/types.ts";
import type { HarnessTask, LoadedTask } from "../../src/harness/task.ts";
import type { GateRun, RunResult, TestRef, Variant } from "./gate-core.ts";
import type { Source } from "./gate-stage.ts";
import { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import { resolveSoapTimeoutMs, runTestsViaSoap } from "../../src/container/soap-test-client.ts";
import { loadTask } from "../../src/harness/task.ts";
import {
  allPass,
  assertionKill,
  BUILD_ORDER,
  classifyTestFailure,
  decideGate,
  gatePlan,
  layers,
  parseVariant,
  runKey,
  summarize,
  variantName,
} from "./gate-core.ts";
import { checkTask, exists, exportSource, git, stagedHash, stageWorkspace, testManifestIn } from "./gate-stage.ts";

const EVIDENCE_ROOT = "H:\\Temp3\\harness-spike\\M4";
const TMP_ROOT = Deno.env.get("CG_GATE_TMP") ?? join(EVIDENCE_ROOT, "tmp");
const SYMBOLS = Deno.env.get("CG_AL_SYMBOLS") ??
  "C:\\ProgramData\\BcContainerHelper\\compiler-cache-15ff3c5d109b\\symbols";

export interface CompileOut {
  ok: boolean;
  codes: string[];
  detail: string;
  artifact?: string;
}
export interface GateBc {
  prenuke(): Promise<void>;
  compile(project: ALProject): Promise<CompileOut>;
  publish(artifact: string): Promise<void>;
  runTests(codeunit: number, appId: string): Promise<TestResult>;
  dispose(): Promise<void>;
}

export async function containerBc(
  container: string,
  credentials: { username: string; password: string },
): Promise<GateBc | null> {
  const provider = new BcContainerProvider();
  provider.setCredentials(container, credentials);
  if (!(await provider.isHealthy(container))) return null;
  await provider.ensureTestHarness([container]);
  const soap = {
    host: container,
    port: 7047,
    company: "My Company",
    tenant: "default",
    credentials,
    timeoutMs: resolveSoapTimeoutMs(undefined),
  };
  return {
    prenuke: () => provider.prenukeCentralGaugeApps([container]),
    compile: async (project) => {
      const r = await provider.compileProject(container, project);
      return {
        ok: r.success && r.artifactPath !== undefined,
        codes: r.errors.map((e) => e.code),
        detail: r.errors.map((e) => `${e.code} ${e.message}`).join("; "),
        ...(r.artifactPath ? { artifact: r.artifactPath } : {}),
      };
    },
    // Never runTests()/prepareCandidateApp: its cleanup removes the refapp apps (findings section 2).
    publish: (artifact) => provider.publishApp(container, artifact),
    runTests: (codeunit, appId) => runTestsViaSoap(soap, codeunit, appId),
    dispose: () => provider.dispose(),
  };
}

async function loadProject(dir: string): Promise<ALProject> {
  const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
  const sourceFiles: string[] = [];
  for await (const e of walk(dir, { exts: [".al"], followSymlinks: false })) {
    if (e.isFile && !e.path.includes(".alpackages")) sourceFiles.push(e.path);
  }
  return { path: dir, appJson, sourceFiles, testFiles: [] };
}

async function stageVariant(
  task: HarnessTask,
  source: Source,
  v: Variant,
  ws: string,
): Promise<{ apps: string[]; usesOracle: boolean; own: TestRef[] }> {
  const testAuthoring = task.kind === "test-authoring";
  await stageWorkspace(source.refappDir, layers(source.taskDir, v, testAuthoring), ws);
  const usesOracle = task.fail_to_pass !== null && v.kind !== "tests" &&
    !(v.kind === "candidate" && testAuthoring);
  if (usesOracle) {
    const oracleDir = join(source.taskDir, "oracle");
    for await (const e of walk(oracleDir, { followSymlinks: false })) {
      if (e.isSymlink) throw new Error(`link refused: ${e.path}`);
      if (!e.isFile) continue;
      const rel = relative(oracleDir, e.path);
      await Deno.mkdir(dirname(join(ws, "Oracle", rel)), { recursive: true });
      await Deno.copyFile(e.path, join(ws, "Oracle", rel));
    }
  }
  let own: TestRef[] = [];
  if (v.kind === "tests") {
    own = await testManifestIn(join(source.taskDir, v.suite));
  } else if (v.kind === "candidate" && testAuthoring) {
    // Only codeunits the agent added count as its tests (shipped ones are restored).
    const shipped = new Set([
      ...(await testManifestIn(join(source.refappDir, "Test"))).map((m) => m.codeunit),
      ...(await testManifestIn(join(source.taskDir, "overlay", "Test"))).map((m) => m.codeunit),
    ]);
    own = (await testManifestIn(join(ws, "Test"))).filter((m) => !shipped.has(m.codeunit));
  }
  return { apps: usesOracle ? [...BUILD_ORDER, "Oracle"] : BUILD_ORDER, usesOracle, own };
}

export async function runVariant(
  bc: GateBc,
  task: HarnessTask,
  source: Source,
  v: Variant,
  repeat: number,
  tmpRoot: string,
): Promise<RunResult> {
  await Deno.mkdir(tmpRoot, { recursive: true });
  const ws = await Deno.makeTempDir({ dir: tmpRoot, prefix: `${task.id}-` });
  const t0 = performance.now();
  try {
    const { apps, usesOracle, own } = await stageVariant(task, source, v, ws);
    const result: RunResult = {
      variant: variantName(v),
      repeat,
      usesOracle,
      own,
      builds: [],
      tests: [],
      staged_hash: await stagedHash(ws),
      ms: 0,
    };
    try {
      await bc.prenuke();
      const built: string[] = [];
      const appIds: Record<string, string> = {};
      for (const app of apps) {
        const appDir = join(ws, app);
        await Deno.mkdir(join(appDir, ".alpackages"), { recursive: true });
        for (let i = 0; i < built.length; i++) {
          await Deno.copyFile(built[i]!, join(appDir, ".alpackages", `dep${i}.app`));
        }
        const project = await loadProject(appDir);
        appIds[app] = (project.appJson as { id: string }).id;
        const c = await bc.compile(project);
        if (!c.ok || !c.artifact) {
          result.builds.push({ app, stage: "compile", ok: false, codes: c.codes, detail: c.detail });
          break;
        }
        try {
          await bc.publish(c.artifact);
        } catch (err) {
          result.builds.push({
            app,
            stage: "publish",
            ok: false,
            codes: [],
            detail: err instanceof Error ? err.message : String(err),
          });
          break;
        }
        result.builds.push({ app, stage: "publish", ok: true, codes: [] });
        built.push(c.artifact);
      }
      const ok = (app: string) => result.builds.some((b) => b.app === app && b.ok);
      const suites: { app: string; codeunit: number }[] = [];
      if (ok("Test")) {
        for (const t of task.pass_to_pass) suites.push({ app: "Test", codeunit: t.codeunit });
        for (const t of own) suites.push({ app: "Test", codeunit: t.codeunit });
      }
      if (usesOracle && task.fail_to_pass && ok("Oracle")) {
        for (const t of task.fail_to_pass.tests) suites.push({ app: "Oracle", codeunit: t.codeunit });
      }
      const seen = new Set<number>();
      for (const s of suites) {
        if (seen.has(s.codeunit)) continue;
        seen.add(s.codeunit);
        const res = await bc.runTests(s.codeunit, appIds[s.app] ?? "");
        if (res.results.length === 0) {
          result.infra = `codeunit ${s.codeunit}: zero results after publish`;
          break;
        }
        for (const c of res.results) {
          result.tests.push({
            codeunit: s.codeunit,
            procedure: c.name,
            passed: c.passed,
            failure: c.passed ? null : classifyTestFailure(c.error ?? ""),
            ...(c.error ? { message: c.error } : {}),
          });
        }
      }
    } catch (err) {
      result.infra = err instanceof Error ? err.message : String(err);
    }
    result.ms = Math.round(performance.now() - t0);
    return result;
  } finally {
    try {
      await Deno.remove(ws, { recursive: true });
    } catch (err) {
      console.warn(`[gate] could not remove ${ws}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function runGate(o: {
  bc: GateBc;
  loaded: LoadedTask;
  source: Source;
  container: string;
  outDir: string;
  tmpRoot: string;
  tagTree: string | null;
}): Promise<{ file: string; code: number }> {
  const { task } = o.loaded;
  const naive: string[] = [];
  if (await exists(join(o.source.taskDir, "naive"))) {
    for await (const e of Deno.readDir(join(o.source.taskDir, "naive"))) if (e.isDirectory) naive.push(e.name);
  }
  const plan = gatePlan(task, naive.sort());
  const runs: GateRun[] = [];
  const results: RunResult[] = [];
  let infra = false;
  let escaped: string | null = null;
  try {
    for (const step of plan) {
      const result = await runVariant(o.bc, task, o.source, step.variant, step.repeat, o.tmpRoot);
      const summary = summarize(task, result);
      runs.push({ ...step, summary, staged_hash: result.staged_hash });
      results.push(result);
      console.log(`[gate] ${task.id} ${runKey(step.variant, step.repeat)} ${result.ms} ms ${JSON.stringify(summary)}`);
      if (summary.infra) {
        infra = true;
        break; // an infra fault is never scored; the whole gate is rerun
      }
    }
  } catch (err) {
    // Staging or any other exception: still clean up and write the report.
    infra = true;
    escaped = err instanceof Error ? err.message : String(err);
  }
  let cleanupError: string | null = null;
  try {
    await o.bc.prenuke();
  } catch (err) {
    cleanupError = err instanceof Error ? err.message : String(err);
  }
  try {
    await o.bc.dispose();
  } catch (err) {
    cleanupError = `${cleanupError ?? ""} dispose: ${err instanceof Error ? err.message : String(err)}`.trim();
  }
  const decision = decideGate(task, plan, runs);
  if (escaped !== null) decision.reasons.push(`infra: ${escaped}`);
  const tagStatus = o.tagTree === null ? "pending" : o.tagTree === o.source.refappTree ? "match" : "mismatch";
  if (tagStatus === "mismatch") decision.reasons.push(`${task.refapp_version} tree differs from the gated refapp tree`);
  const promoted = decision.reasons.length === 0;
  await Deno.mkdir(o.outDir, { recursive: true });
  const file = join(o.outDir, `gate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await Deno.writeTextFile(
    file,
    JSON.stringify(
      {
        task: task.id,
        source_commit: o.source.commit,
        refapp_tree: o.source.refappTree,
        task_tree: o.source.taskTree,
        refapp_version: task.refapp_version,
        tag_status: tagStatus,
        container: o.container,
        at: new Date().toISOString(),
        plan: plan.map((p) => runKey(p.variant, p.repeat)),
        matrix_complete: decision.matrix_complete,
        promoted,
        reasons: decision.reasons,
        cleanup_error: cleanupError,
        runs: runs.map((r, i) => ({ key: runKey(r.variant, r.repeat), summary: r.summary, result: results[i] })),
      },
      null,
      2,
    ),
  );
  return { file, code: infra ? 3 : promoted ? 0 : 1 };
}

async function hostCompile(loaded: LoadedTask, refappDir: string, v: Variant): Promise<number> {
  await Deno.mkdir(TMP_ROOT, { recursive: true });
  const ws = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: `compile-${loaded.task.id}-` });
  try {
    const src: Source = {
      commit: "worktree",
      root: "",
      refappDir,
      refappTree: "",
      taskDir: loaded.dir,
      taskTree: "",
    };
    const { apps } = await stageVariant(loaded.task, src, v, ws);
    const pkg = join(ws, ".alpackages");
    await Deno.mkdir(pkg);
    for await (const e of Deno.readDir(SYMBOLS)) {
      if (!e.isFile) continue;
      try {
        await Deno.link(join(SYMBOLS, e.name), join(pkg, e.name));
      } catch {
        await Deno.copyFile(join(SYMBOLS, e.name), join(pkg, e.name));
      }
    }
    for (const app of apps) {
      const r = await new Deno.Command("al", {
        args: ["compile", `/project:${join(ws, app)}`, `/out:${join(pkg, `${app}.app`)}`, `/packagecachepath:${pkg}`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
      const errors = text.split(/\r?\n/).filter((l) => /error AL\d+/.test(l));
      if (!r.success || errors.length > 0) {
        console.log(`${colors.red("[FAIL]")} ${app}`);
        for (const l of errors.length > 0 ? errors : [text.trim()]) console.log(`  ${l}`);
        return 1;
      }
      console.log(`${colors.green("[OK]")} ${app}`);
    }
    return 0;
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

async function main(): Promise<number> {
  const a = parseArgs(Deno.args, { string: ["rev"], default: { rev: "HEAD" } });
  const [cmd, ...rest] = a._.map(String);
  const repo = (await git(Deno.cwd(), ["rev-parse", "--show-toplevel"])).out.trim();
  const refapp = join(repo, "harness-tasks", "refapp");
  const credentials = {
    username: Deno.env.get("CG_GATE_BC_USER") ?? "sshadows",
    password: Deno.env.get("CG_GATE_BC_PASSWORD") ?? "1234",
  };
  const exported = async (taskId: string) => {
    await Deno.mkdir(TMP_ROOT, { recursive: true });
    const out = await Deno.makeTempDir({ dir: TMP_ROOT, prefix: `src-${taskId}-` });
    return await exportSource(repo, a.rev, taskId, out);
  };
  try {
    if (cmd === "check" && rest.length > 0) {
      let failed = 0;
      for (const d of rest) {
        const { problems, warnings } = await checkTask(await loadTask(d), refapp, repo);
        for (const w of warnings) console.log(`${colors.yellow("[WARN]")} ${d}: ${w}`);
        for (const p of problems) console.log(`${colors.red("[FAIL]")} ${d}: ${p}`);
        if (problems.length === 0) console.log(`${colors.green("[OK]")} ${d}`);
        else failed++;
      }
      return failed === 0 ? 0 : 1;
    }
    if (cmd === "compile" && rest.length === 2) {
      return await hostCompile(await loadTask(rest[0]!), refapp, parseVariant(rest[1]!));
    }
    if (cmd === "stage" && rest.length === 2) {
      const src = await exported(rest[0]!);
      const loaded = await loadTask(src.taskDir);
      await stageWorkspace(src.refappDir, layers(src.taskDir, { kind: "baseline" }, false), rest[1]!);
      console.log(`${colors.green("[OK]")} ${loaded.task.id} baseline at ${src.commit} -> ${rest[1]}`);
      return 0;
    }
    if ((cmd === "gate" && rest.length === 2) || (cmd === "judge" && rest.length === 3)) {
      const src = await exported(rest[1]!);
      const loaded = await loadTask(src.taskDir);
      const { problems } = await checkTask(loaded, src.refappDir, repo, { drift: false });
      if (problems.length > 0) {
        for (const p of problems) console.log(`${colors.red("[FAIL]")} ${p}`);
        return 1;
      }
      const bc = await containerBc(rest[0]!, credentials);
      if (!bc) {
        console.error(`${colors.red("[INFRA]")} ${rest[0]} not healthy or not visible under DOCKER_CONTEXT=${Deno.env.get("DOCKER_CONTEXT") ?? "(inherited)"}`);
        return 3;
      }
      const outDir = join(EVIDENCE_ROOT, loaded.task.id);
      if (cmd === "gate") {
        const tag = await git(repo, ["rev-parse", "--verify", "-q", `${loaded.task.refapp_version}:harness-tasks/refapp`]);
        const { file, code } = await runGate({
          bc,
          loaded,
          source: src,
          container: rest[0]!,
          outDir,
          tmpRoot: TMP_ROOT,
          tagTree: tag.ok ? tag.out.trim() : null,
        });
        console.log(`${code === 0 ? colors.green("[OK]") : colors.red("[FAIL]")} ${loaded.task.id} gate -> ${file}`);
        return code;
      }
      return await judge(bc, loaded, src, rest[2]!, outDir);
    }
  } catch (err) {
    console.error(`${colors.red("[FAIL]")} ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  console.error("usage: gate-task.ts check|compile|stage|gate|judge (see header)");
  return 2;
}

/** Pilot scoring (developmental, never a verdict): same staging rules as the M1 verdict workspace, not its validation. */
async function judge(bc: GateBc, loaded: LoadedTask, src: Source, wsDir: string, outDir: string): Promise<number> {
  const { task } = loaded;
  const targets: (string | null)[] = task.kind === "test-authoring" ? [null, "m0", ...task.mutants] : [null];
  const runs: RunResult[] = [];
  try {
    for (const m of targets) {
      runs.push(await runVariant(bc, task, src, { kind: "candidate", dir: wsDir, mutant: m }, 1, TMP_ROOT));
    }
  } finally {
    await bc.prenuke().catch(() => {});
    await bc.dispose().catch(() => {});
  }
  const s = runs.map((r) => summarize(task, r));
  const pass = task.kind === "test-authoring"
    ? s[0]!.refapp === "ok" && s[0]!.own !== null && allPass(s[0]!.own) &&
      s.slice(1).every((x) => x.refapp === "ok" && x.own !== null && assertionKill(x.own))
    : s[0]!.refapp === "ok" && allPass(s[0]!.p2p) && s[0]!.f2p !== null && allPass(s[0]!.f2p);
  await Deno.mkdir(outDir, { recursive: true });
  const file = join(outDir, `pilot-judge-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await Deno.writeTextFile(
    file,
    JSON.stringify({ task: task.id, source_commit: src.commit, workspace: wsDir, pass, summaries: s, runs }, null, 2),
  );
  console.log(`${pass ? "[PASS]" : "[FAIL]"} ${task.id} pilot judge -> ${file}`);
  return runs.some((r) => r.infra !== undefined) ? 3 : 0;
}

if (import.meta.main) Deno.exit(await main());
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/gate-task.test.ts`
Expected: `ok | 8 passed | 0 failed`.

- [ ] **Step 5: Host toolchain check.** `al compile '/project:U:\Git\CentralGauge\harness-tasks\refapp\Core' "/out:H:\Temp3\harness-spike\M4\tmp\core.app" '/packagecachepath:C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols'`. Expected: exit 0, no `error AL`. Quote the result in the submit note.

- [ ] **Step 6: Check, lint, format, commit**

```bash
deno check scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
deno lint scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
deno fmt scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
git add scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
git commit -m "feat(harness): M4 gate executors and CLI"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/gate-core.test.ts tests/unit/harness/gate-stage.test.ts tests/unit/harness/gate-task.test.ts` prints `ok | 35 passed | 0 failed`; check and lint clean; submit note quotes the host compile result; no test writes outside `H:\Temp3\harness-spike\M4\tmp\unit\` (or `CG_GATE_TMP`).

---

### Task M4-16: premise probes for task semantics

**Lane:** ops. **Deps:** none (reuses the M4-00 runner pattern `scripts/spikes/harness/premise-hx001/run-probe.ts`). **Target:** 10-01 morning. Probe task id M4-16 (M4-00 is taken).

Spike code: `scripts/spikes/harness/premise-m4-16/` (apps "M16P Core" ids 50200-50249, "M16P Test" 50250-50299, publisher CentralGauge; prenuke after). Evidence `H:\Temp3\harness-spike\M4-16-results.md` with the exact message texts.

| Probe | Question | Used by |
| --- | --- | --- |
| P1 | After `asserterror` catches an error raised after a `DeleteAll` in the same call, are the deleted rows back? | HX-002 mutant `partial-reschedule` (killable only if rows stay deleted) |
| P2 | `CalcDate('<+0M>', 20270131D)` = 20270131D; `CalcDate('<+1M>', 20270131D)` = 20270228D; `CalcDate('<+1M>', 20280131D)` = 20280229D; `Date2DWY(20270306D, 1)` = 6 | HX-002, HX-005 |
| P3 | `JsonToken.WriteTo` of an Integer 1450 gives `1450`, of a Boolean gives `false`; `JsonObject.WriteTo` is compact and keeps insertion order; a text with `"` and `å` round-trips through `WriteTo`/`ReadFrom` | HX-006 |
| P4 | An `AutoIncrement` Entry No. is set in the record variable after `Insert(true)` | HX-001 (`RegisterDamage` returns it), HX-004 ledger |
| P5 | SOAP harness messages for: a failed `Assert.AreEqual`, a failed `Assert.ExpectedError`, an `asserterror` whose statement raised no error, and a runtime `Error` | `classifyTestFailure` in M4-01a |

- [ ] **Step 1:** Write the probe apps (one test procedure per row, recording actual values with `Assert` so the message shows them), run through the M4-00 runner shape, prenuke, verify no `M16P` app remains.
- [ ] **Step 2:** Write the results file: per probe the observed value or message verbatim, and a verdict line per consumer (for example `P1: rows restored -> partial-reschedule is equivalent, drop it`).
- [ ] **Step 3:** Message lane-content and the orchestrator with the path. If P5 contradicts `classifyTestFailure`, M4-01a is fixed before any gate is accepted.

**Acceptance:** `H:\Temp3\harness-spike\M4-16-results.md` has five probe sections with verbatim observations and one consumer verdict each, and a final line stating the probe apps were removed.

---

### Task M4-02: refapp slice A and HX-001 (bugfix: damaged return leaves the vehicle unblocked)

**Lane:** content. **Deps:** M4-01c for Steps 6-8 (Steps 1-5 start at once). **Target:** 09-30 to 10-01.

Spec 1b sections 3 (Rental -> Core events; Fleet reacting to Rental through a Core publisher; in-app subscriber), 5, 6, 8, 9. Premise measured by M4-00: on BC 28.4 a stale record's `Modify` after a subscriber modified the same row in the same transaction raises no error and overwrites the subscriber's change. The overlay reorders the Fleet return handler so damage registration (whose own event, in a second Fleet subscriber, blocks the vehicle and counts the open damage) runs between the handler's read and its `Modify`. The symptom is silent: the vehicle ends up not blocked with zero open damages. The agent has no error to search for; it must trace Rental.Return -> Core event -> Fleet handler -> DamageMgt -> `OnAfterDamageRegistered` -> block subscriber.

**Files:**
- Modify: `harness-tasks/refapp/Core/src/CoreEvents.Codeunit.al`
- Create: `harness-tasks/refapp/Core/src/Setup.Table.al`
- Modify: `harness-tasks/refapp/Fleet/src/Vehicle.Table.al`, `FleetMgt.Codeunit.al`
- Create: `harness-tasks/refapp/Fleet/src/DamageEntry.Table.al`, `DamageMgt.Codeunit.al`, `FleetReturnHandler.Codeunit.al`, `VehicleBlockSubscriber.Codeunit.al`
- Create: `harness-tasks/refapp/Rental/src/RentalStatus.Enum.al`, `RentalContract.Table.al`
- Modify: `harness-tasks/refapp/Rental/src/RentalMgt.Codeunit.al`
- Modify: `harness-tasks/refapp/Test/app.json` (idRanges 80000-84999; also answers M1 Part 2 open question 6)
- Modify: `harness-tasks/refapp/Test/src/SkeletonTests.Codeunit.al` (codeunit 80000 kept with its five procedures ported to the v1 API: M1-27's probe runs 80000 and expects 5 passing rows)
- Create: `harness-tasks/refapp/Test/src/TestLibrary.Codeunit.al`, `RentalTests.Codeunit.al`, `FleetTests.Codeunit.al`, `LeasingTests.Codeunit.al`, `IntegrationTests.Codeunit.al`
- Create: `harness-tasks/tasks/HX-001/{task.yml,prompt.md}`, `overlay/Fleet/src/FleetReturnHandler.Codeunit.al`, `correct/Fleet/src/FleetReturnHandler.Codeunit.al`, `oracle/app.json`, `oracle/src/ReturnOracle.Codeunit.al`, `naive/skip-modify-on-damage/...`, `naive/reblock-in-handler/...`, `naive/lock-table/...`

**Interfaces:**
- Produces (refapp v1 API):
  - `"CGR Core Events"` (70000): `RaiseVehicleCheckedOut(VehicleNo: Code[20])`, `RaiseVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])`, events `OnAfterVehicleCheckedOut`, `OnAfterVehicleReturned`.
  - table 70003 `"CGR Setup"`: `GetOrCreate()`, `NextContractNo(): Code[20]`, `NextLeaseNo(): Code[20]`.
  - table 70100 `"CGR Vehicle"`: 1 No., 2 Mileage, 3 Checked Out, 4 Strategy, 5 Blocked, 6 Last Service Km, 7 Daily Rate, 8 Description, 9 Open Damages (Integer).
  - table 70101 `"CGR Damage Entry"`; codeunit 70102 `"CGR Damage Mgt"`: `RegisterDamage(VehicleNo: Code[20]; Description: Text[100]): Integer`, `RepairDamage(EntryNo: Integer)`, event `OnAfterDamageRegistered(var DamageEntry)`.
  - codeunit 70100 `"CGR Fleet Mgt"`: `IsAvailable(VehicleNo): Boolean` (event `OnBeforeIsAvailable(VehicleNo; var Result; var IsHandled)`), `NextServiceKm(VehicleNo): Integer`.
  - enum 70200 `"CGR Rental Status"`; table 70200 `"CGR Rental Contract"`; codeunit 70200 `"CGR Rental Mgt"`: `CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; EndDate: Date): Code[20]`, `CheckOut(ContractNo: Code[20])`, `Return(ContractNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])`.
  - Test codeunit 80090 `"CGR Test Library"`: `CreateVehicle(VehicleNo; Mileage; Strategy)`, `CreateContract(VehicleNo): Code[20]`.

- [ ] **Step 1: Core**

`Core/src/CoreEvents.Codeunit.al`:
```al
codeunit 70000 "CGR Core Events"
{
    procedure RaiseVehicleCheckedOut(VehicleNo: Code[20])
    begin
        OnAfterVehicleCheckedOut(VehicleNo);
    end;

    procedure RaiseVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    begin
        OnAfterVehicleReturned(VehicleNo, ReturnKm, DamageDescription);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterVehicleCheckedOut(VehicleNo: Code[20])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    begin
    end;
}
```

`Core/src/Setup.Table.al`:
```al
table 70003 "CGR Setup"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Last Contract No."; Integer) { }
        field(3; "Last Lease No."; Integer) { }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }

    procedure GetOrCreate()
    begin
        if not Get() then begin
            Init();
            Insert();
        end;
    end;

    procedure NextContractNo(): Code[20]
    begin
        GetOrCreate();
        "Last Contract No." += 1;
        Modify();
        exit(CopyStr('RC' + Format("Last Contract No.", 0, 9), 1, 20));
    end;

    procedure NextLeaseNo(): Code[20]
    begin
        GetOrCreate();
        "Last Lease No." += 1;
        Modify();
        exit(CopyStr('LC' + Format("Last Lease No.", 0, 9), 1, 20));
    end;
}
```

- [ ] **Step 2: Fleet**

`Fleet/src/Vehicle.Table.al` fields (keep key `PK`):
```al
        field(1; "No."; Code[20]) { }
        field(2; Mileage; Integer) { }
        field(3; "Checked Out"; Boolean) { }
        field(4; Strategy; Enum "CGR Maintenance Strategy") { }
        field(5; Blocked; Boolean) { }
        field(6; "Last Service Km"; Integer) { }
        field(7; "Daily Rate"; Decimal) { }
        field(8; Description; Text[100]) { }
        field(9; "Open Damages"; Integer) { }
```

`Fleet/src/FleetMgt.Codeunit.al`: keep the skeleton; `IsAvailable` ends with `exit(not Vehicle."Checked Out" and not Vehicle.Blocked);`.

`Fleet/src/DamageEntry.Table.al`:
```al
table 70101 "CGR Damage Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; Description; Text[100]) { }
        field(4; "Reported On"; Date) { }
        field(5; Repaired; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", Repaired) { }
    }
}
```

`Fleet/src/DamageMgt.Codeunit.al`:
```al
codeunit 70102 "CGR Damage Mgt"
{
    procedure RegisterDamage(VehicleNo: Code[20]; Description: Text[100]): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := Description;
        DamageEntry."Reported On" := WorkDate();
        DamageEntry.Insert(true);
        OnAfterDamageRegistered(DamageEntry);
        exit(DamageEntry."Entry No.");
    end;

    procedure RepairDamage(EntryNo: Integer)
    var
        DamageEntry: Record "CGR Damage Entry";
        OpenDamage: Record "CGR Damage Entry";
        Vehicle: Record "CGR Vehicle";
    begin
        DamageEntry.Get(EntryNo);
        DamageEntry.Repaired := true;
        DamageEntry.Modify(true);
        OpenDamage.SetRange("Vehicle No.", DamageEntry."Vehicle No.");
        OpenDamage.SetRange(Repaired, false);
        if Vehicle.Get(DamageEntry."Vehicle No.") then begin
            Vehicle."Open Damages" := OpenDamage.Count();
            Vehicle.Blocked := Vehicle."Open Damages" > 0;
            Vehicle.Modify(true);
        end;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDamageRegistered(var DamageEntry: Record "CGR Damage Entry")
    begin
    end;
}
```

`Fleet/src/VehicleBlockSubscriber.Codeunit.al`:
```al
codeunit 70104 "CGR Vehicle Block Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Damage Mgt", 'OnAfterDamageRegistered', '', false, false)]
    local procedure BlockDamagedVehicle(var DamageEntry: Record "CGR Damage Entry")
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not Vehicle.Get(DamageEntry."Vehicle No.") then
            exit;
        Vehicle."Open Damages" += 1;
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
```

`Fleet/src/FleetReturnHandler.Codeunit.al` (correct refapp version; copied verbatim to `tasks/HX-001/correct/Fleet/src/`):
```al
codeunit 70103 "CGR Fleet Return Handler"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure HandleVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        Vehicle.Modify(true);
        if DamageDescription <> '' then
            DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
    end;
}
```

- [ ] **Step 3: Rental**

`Rental/src/RentalStatus.Enum.al`:
```al
enum 70200 "CGR Rental Status"
{
    Extensible = false;

    value(0; Open) { }
    value(1; "Checked Out") { }
    value(2; Returned) { }
    value(3; Posted) { }
}
```

`Rental/src/RentalContract.Table.al`:
```al
table 70200 "CGR Rental Contract"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; "Customer Name"; Text[100]) { }
        field(4; "Start Date"; Date) { }
        field(5; "End Date"; Date) { }
        field(6; Status; Enum "CGR Rental Status") { }
        field(7; "Start Km"; Integer) { }
        field(8; "Return Km"; Integer) { }
        field(9; "Damage Description"; Text[100]) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.") { }
    }
}
```

`Rental/src/RentalMgt.Codeunit.al` (the direct `FleetMgt.IsAvailable` call and Vehicle read are the 1b section 3 legacy direct call):
```al
codeunit 70200 "CGR Rental Mgt"
{
    var
        NotAvailableErr: Label 'Vehicle %1 is not available.', Comment = '%1 = vehicle number';
        WrongStatusErr: Label 'Rental contract %1 must have status %2.', Comment = '%1 = contract number, %2 = status';
        ReturnKmErr: Label 'Return km %1 is below the start km %2.', Comment = '%1 = return km, %2 = start km';

    procedure CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; EndDate: Date): Code[20]
    var
        Contract: Record "CGR Rental Contract";
        Setup: Record "CGR Setup";
    begin
        Contract.Init();
        Contract."No." := Setup.NextContractNo();
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := CustomerName;
        Contract."Start Date" := StartDate;
        Contract."End Date" := EndDate;
        Contract.Status := Contract.Status::Open;
        Contract.Insert(true);
        exit(Contract."No.");
    end;

    procedure CheckOut(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        CoreEvents: Codeunit "CGR Core Events";
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Open then
            Error(WrongStatusErr, ContractNo, Contract.Status::Open);
        if not FleetMgt.IsAvailable(Contract."Vehicle No.") then
            Error(NotAvailableErr, Contract."Vehicle No.");
        Vehicle.Get(Contract."Vehicle No.");
        Contract."Start Km" := Vehicle.Mileage;
        Contract.Status := Contract.Status::"Checked Out";
        Contract.Modify(true);
        CoreEvents.RaiseVehicleCheckedOut(Contract."Vehicle No.");
    end;

    procedure Return(ContractNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Contract: Record "CGR Rental Contract";
        CoreEvents: Codeunit "CGR Core Events";
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::"Checked Out" then
            Error(WrongStatusErr, ContractNo, Contract.Status::"Checked Out");
        if ReturnKm < Contract."Start Km" then
            Error(ReturnKmErr, Format(ReturnKm, 0, 9), Format(Contract."Start Km", 0, 9));
        Contract."Return Km" := ReturnKm;
        Contract."Damage Description" := DamageDescription;
        Contract.Status := Contract.Status::Returned;
        Contract.Modify(true);
        CoreEvents.RaiseVehicleReturned(Contract."Vehicle No.", ReturnKm, DamageDescription);
    end;
}
```

- [ ] **Step 4: Visible tests**

`Test/app.json`: `"idRanges": [{ "from": 80000, "to": 84999 }]`. `SkeletonTests.Codeunit.al` (80000 "CGR Skeleton Tests") keeps exactly five `[Test]` procedures, ported: `CheckOutMarksVehicleCheckedOut` (vehicle SPIKE-001, via `Lib.CreateContract` and `CheckOut`), `CheckOutTwiceFails` (SPIKE-002, expects `Vehicle SPIKE-002 is not available.`), `HeavyDutyStrategyFromFleetExtension` (SPIKE-003, 6000), `LeaseRateUsesCoreInternal` (112), `PayloadCarriesVehicleNo` (SPIKE-004). They duplicate module rows on purpose: codeunit 80000 is the M1 probe's fixed smoke suite, not a scored list.

`Test/src/TestLibrary.Codeunit.al`:
```al
codeunit 80090 "CGR Test Library"
{
    procedure CreateVehicle(VehicleNo: Code[20]; Mileage: Integer; Strategy: Enum "CGR Maintenance Strategy")
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Strategy;
        Vehicle.Insert();
    end;

    procedure CreateContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract(VehicleNo, 'Test Customer', 20270301D, 20270303D));
    end;
}
```

Visible test codeunits (each `Subtype = Test; TestPermissions = Disabled;`, `Assert: Codeunit "Library Assert"`, `Lib: Codeunit "CGR Test Library"`, one vehicle key per procedure). No visible test returns a vehicle with damage (that is the task).

| Codeunit | Procedure | Arrange / act | Assert |
| --- | --- | --- | --- |
| 80010 "CGR Rental Tests" | CheckOutMarksVehicleCheckedOut | T-RENT-001 km 1000, contract, CheckOut | vehicle Checked Out true; contract Checked Out; Start Km 1000 |
| 80010 | CheckOutTwiceFails | T-RENT-002, two contracts, check out first | `asserterror` CheckOut second; `ExpectedError('Vehicle T-RENT-002 is not available.')` |
| 80010 | ReturnWithoutDamageReleasesVehicle | T-RENT-003 km 1000, check out, Return(1300, '') | vehicle Checked Out false, Mileage 1300, Blocked false, Open Damages 0; contract Returned, Return Km 1300 |
| 80010 | ReturnBelowStartKmFails | T-RENT-004 km 1000, check out | `asserterror` Return(999, ''); `ExpectedError('Return km 999 is below the start km 1000.')`; contract Checked Out |
| 80020 "CGR Fleet Tests" | HeavyDutyStrategyFromFleetExtension | T-FLT-001 km 1000 Heavy Duty | `NextServiceKm` = 6000 |
| 80020 | DamageBlocksVehicle | T-FLT-002, RegisterDamage('Dent') | Blocked true; Open Damages 1; `IsAvailable` false |
| 80020 | RepairLastDamageUnblocks | T-FLT-003, two RegisterDamage | Open Damages 2; repair first: 1, Blocked true; repair second: 0, Blocked false, IsAvailable true |
| 80030 "CGR Leasing Tests" | LeaseRateUsesCoreInternal | none | `MonthlyRate(100, 12)` = 112 |
| 80040 "CGR Integration Tests" | PayloadCarriesVehicleNo | none | `VehicleCheckedOutPayload('T-INT-001')` = `{"event":"vehicleCheckedOut","vehicleNo":"T-INT-001"}` |

The first row in full (the rest follow this shape):
```al
codeunit 80010 "CGR Rental Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure CheckOutMarksVehicleCheckedOut()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-001');
        RentalMgt.CheckOut(ContractNo);
        Vehicle.Get('T-RENT-001');
        Assert.IsTrue(Vehicle."Checked Out", 'Fleet subscriber must mark the vehicle checked out');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Contract status after checkout');
        Assert.AreEqual(1000, Contract."Start Km", 'Start km is the vehicle mileage at checkout');
    end;
}
```

- [ ] **Step 5: HX-001 task files**

`tasks/HX-001/task.yml`:
```yaml
id: HX-001
refapp_version: refapp-v1-rc1
kind: bugfix
prompt: prompt.md
touches: [Rental, Fleet, Core]
coupling: [events, core-facade]
source: refapp
attachments: []
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80010, procedures: [CheckOutMarksVehicleCheckedOut, CheckOutTwiceFails, ReturnWithoutDamageReleasesVehicle, ReturnBelowStartKmFails] }
  - { codeunit: 80020, procedures: [HeavyDutyStrategyFromFleetExtension, DamageBlocksVehicle, RepairLastDamageUnblocks] }
fail_to_pass:
  depends_on: [Core, Fleet, Rental]
  tests:
    - { codeunit: 85000, procedures: [DamagedReturnBlocksVehicle, DamagedReturnReleasesVehicle, DamagedReturnRecordsDamage, DamagedReturnCompletesContract, DamagedVehicleCannotBeRentedAgain, RepairAfterDamagedReturnReleasesVehicle, SecondDamagedReturnAfterRepair, MultipleOpenDamagesOnReturn, ReturnWithoutDamageLeavesVehicleUnblocked] }
mutants: []
contamination: null
limits: { timeout_min: 30 }
```

`tasks/HX-001/prompt.md`:
```markdown
# Bug 4127: Damaged returns do not block the vehicle

Reported by the front desk, Aarhus branch.

When the clerk records damage while returning a rental vehicle, the damage entry is created, but the vehicle is not blocked and its "Open Damages" count stays at 0. The vehicle then shows as available, and one has already been rented out again with the damage still open.

Expected: a return with damage completes like any other return (the contract is returned and the vehicle is back with the return mileage), and the vehicle is blocked, with the damage counted as open, until the damage is repaired.

To reproduce: create a rental contract, check it out, return it with a damage description (`CGR Rental Mgt`, Return), then look at the vehicle.
```

`tasks/HX-001/overlay/Fleet/src/FleetReturnHandler.Codeunit.al` (injected: damage registered between the read and the `Modify`; the stale buffer silently overwrites `Blocked` and `Open Damages`):
```al
codeunit 70103 "CGR Fleet Return Handler"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure HandleVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        if DamageDescription <> '' then
            DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        Vehicle.Modify(true);
    end;
}
```

`correct/Fleet/src/FleetReturnHandler.Codeunit.al`: byte-identical to the refapp file from Step 2.

Naive variants (each replaces `Fleet/src/FleetReturnHandler.Codeunit.al`; all compile):
- `naive/skip-modify-on-damage`: after `RegisterDamage`, `exit` (the vehicle is never saved on a damaged return). Plausible "the second save is the problem".
- `naive/reblock-in-handler`: keeps the overlay order and adds `if DamageDescription <> '' then Vehicle.Blocked := true;` before `Modify`. Plausible "set the flag again"; still loses `Open Damages`.
- `naive/lock-table`: `Vehicle.LockTable();` before `Vehicle.Get`, overlay order kept. Plausible "concurrency, lock it"; M4-00 measured that LockTable does not help.

`tasks/HX-001/oracle/app.json`:
```json
{
  "id": "c6a1e000-0000-4000-8001-000000000001",
  "name": "CGR Oracle HX-001",
  "publisher": "CentralGauge",
  "version": "1.0.0.0",
  "platform": "28.0.0.0",
  "application": "28.0.0.0",
  "idRanges": [{ "from": 85000, "to": 85099 }],
  "runtime": "17.0",
  "target": "OnPrem",
  "features": ["NoImplicitWith"],
  "dependencies": [
    { "id": "c6a1e000-0000-4000-8000-000000000001", "name": "CGR Core", "publisher": "CentralGauge", "version": "1.0.0.0" },
    { "id": "c6a1e000-0000-4000-8000-000000000002", "name": "CGR Fleet", "publisher": "CentralGauge", "version": "1.0.0.0" },
    { "id": "c6a1e000-0000-4000-8000-000000000003", "name": "CGR Rental", "publisher": "CentralGauge", "version": "1.0.0.0" },
    { "id": "dd0be2ea-f733-4d65-bb34-a28f4624fb14", "name": "Library Assert", "publisher": "Microsoft", "version": "28.0.0.0" }
  ]
}
```

Oracle (normative), codeunit 85000 "HX001 Return Oracle". A local `CheckedOutContract(VehicleNo; Mileage)` deletes the vehicle's damage entries and contracts, inserts the vehicle (Blocked false, Open Damages 0, Checked Out false), creates a contract 2027-03-01..03 and checks it out. Damage text `Scratch on rear door` (`Locked = true` label). No assertion on `Reported On` (not in the ticket).

| Procedure | Arrange / act | Assert |
| --- | --- | --- |
| DamagedReturnBlocksVehicle | HX001-A km 1000, Return(1450, damage) | Blocked true; Open Damages 1 |
| DamagedReturnReleasesVehicle | HX001-B, Return(1450, damage) | Checked Out false; Mileage 1450 |
| DamagedReturnRecordsDamage | HX001-C, Return(1450, damage) | exactly 1 damage entry for C; Description = damage text; Repaired false |
| DamagedReturnCompletesContract | HX001-D, Return(1450, damage) | contract Returned; Return Km 1450; Damage Description = damage text |
| DamagedVehicleCannotBeRentedAgain | HX001-E, Return(1450, damage); new contract 2027-03-10..12 | `asserterror` CheckOut; `ExpectedError('Vehicle HX001-E is not available.')` |
| RepairAfterDamagedReturnReleasesVehicle | HX001-F, Return(1450, damage); RepairDamage(its entry) | Blocked false; Open Damages 0; `IsAvailable` true; Mileage 1450 |
| SecondDamagedReturnAfterRepair | HX001-G, Return(1450, 'Scratch on rear door'); repair; new contract, CheckOut, Return(1900, 'Dent') | Blocked true; Open Damages 1; Mileage 1900; 2 damage entries, 1 open (`Dent`) |
| MultipleOpenDamagesOnReturn | HX001-I km 1000 checked out; `RegisterDamage('HX001-I', 'Chipped windscreen')` while out; Return(1450, damage text) | 2 open damage entries; Open Damages 2; Blocked true; Checked Out false; Mileage 1450; repair the first entry: Blocked true, Open Damages 1; repair the second: Blocked false, Open Damages 0, `IsAvailable` true |
| ReturnWithoutDamageLeavesVehicleUnblocked | HX001-H, Return(1200, '') | Blocked false; Open Damages 0; Checked Out false; Mileage 1200; no damage entry |

Kill mapping (each naive loses at least one assertion; runtime errors elsewhere are allowed):

| Naive | Rows lost by assertion |
| --- | --- |
| skip-modify-on-damage | DamagedReturnReleasesVehicle, MultipleOpenDamagesOnReturn (Checked Out), RepairAfterDamagedReturnReleasesVehicle (availability or mileage, whichever assertion the implemented order reaches first) |
| reblock-in-handler | DamagedReturnBlocksVehicle (Open Damages 0), SecondDamagedReturnAfterRepair, MultipleOpenDamagesOnReturn (Open Damages 1, not 2) |
| lock-table | DamagedReturnBlocksVehicle, DamagedVehicleCannotBeRentedAgain (lost asserterror), SecondDamagedReturnAfterRepair, MultipleOpenDamagesOnReturn |

These are predicted kills until M4-03 records them. `MultipleOpenDamagesOnReturn` also kills a symptom patch that sets `Blocked := true; "Open Damages" := 1` before the stale `Modify` (round-2 review section 2).

Five oracle rows pass on the baseline (DamagedReturnReleasesVehicle, DamagedReturnRecordsDamage, DamagedReturnCompletesContract, RepairAfterDamagedReturnReleasesVehicle, ReturnWithoutDamageReleasesVehicle, per lane-content trace 2026-09-25): they are hidden regression rows. The other four measure the fix. The baseline suite as a whole must fail; M4-03 records the per-procedure baseline outcome (Decisions: kept, baseline outcomes recorded).

- [ ] **Step 6: Host compile every variant (M4-01c)**

```bash
for v in baseline correct naive/skip-modify-on-damage naive/reblock-in-handler naive/lock-table; do
  deno run --allow-all scripts/harness/gate-task.ts compile harness-tasks/tasks/HX-001 "$v" || break
done
```
Expected: `[OK]` for the seven apps and `Oracle` in each variant. A compile error is fixed in the AL, never by removing an oracle row.

- [ ] **Step 7: al-test-auditor pass**

Dispatch `al-test-auditor` with this template (reused by every content task with the id, audited test folder and plan section swapped):

> Audit harness task `U:\Git\CentralGauge\harness-tasks\tasks\HX-001` at task tree `<git rev-parse HEAD:harness-tasks/tasks/HX-001>`. Layout differs from `tasks/`: the specification is `prompt.md` plus `task.yml`; the oracle is `oracle/src/*.al` (hidden test app, 85000-89999; visible tests are `harness-tasks/refapp/Test`, 80000-84999). Apply rule sets A, B, C and E to the pair (prompt.md, oracle). Also: (1) compare the oracle with the normative table in `docs/superpowers/plans/2026-09-30-harness-refapp-v1.md` Task M4-02 Step 5 and report any missing row or different value; (2) report any prompt requirement with no assertion; (3) report any assertion that depends on something neither the prompt nor an existing refapp contract states; (4) report state shared between procedures of one codeunit or inherited from the session (work date, Setup); (5) check each naive variant against the kill mapping table and report a claimed loss that the code would not produce. Read-only. First line of your answer: `TASK TREE: <the id above>`. Last line: `VERDICT: clean` or `VERDICT: <n> critical, <m> major`.

Commit the task first (Step 8) so the tree id exists; save the answer to `H:\Temp3\harness-spike\M4\HX-001\audit-1.md`; fix critical and major findings (never by weakening an oracle row; a finding asking for that goes to `coord ask`), commit, re-audit to `audit-2.md` until clean.

- [ ] **Step 8: Static check, commit, request the gate job**

```bash
deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-001
git add harness-tasks/refapp harness-tasks/tasks/HX-001
git commit -m "feat(harness-tasks): refapp v1 slice A and HX-001 damaged return bugfix"
```
Expected from `check`: `[WARN] ... refapp-v1-rc1 does not resolve yet` and `[OK]`. After the audit is clean: message lane-ops `need container job: deno run --allow-all scripts/harness/gate-task.ts gate <Cronus281-283> HX-001 --rev <sha> for M4-03, report to lane-content`.

**Acceptance:** `check` prints `[OK]` for HX-001; the latest `audit-*.md` starts with `TASK TREE: <id>` equal to `git rev-parse <sha>:harness-tasks/tasks/HX-001` and ends `VERDICT: clean`; the oracle has the nine procedures of Step 5; three naive folders exist.

---

### Task M4-03: gate job HX-001

**Lane:** ops. **Deps:** M4-01c, M4-02, M4-16 (P5 accepted and `classifyTestFailure` confirmed against its messages: explicit predecessor of the first accepted gate). **Target:** 10-01; orchestrator tags `refapp-v1-rc1` by 10-02 for the 10-05 end-to-end gate.

Common procedure for every gate job (M4-05, M4-07, M4-09, M4-11, M4-13 refer to it):

- [ ] **Step 1:** Bench-live check (`find results/.bench-running.json -mmin -2` prints nothing); lease a content container (Cronus281-283); checkpoint the job in the note.
- [ ] **Step 2:** From the repo (no job worktree needed: the gate exports the revision itself): `deno run --allow-all scripts/harness/gate-task.ts gate <container> HX-001 --rev <sha>`. Expected: 10 runs (baseline, correct x3, 3 naive x2), exit 0, `[OK] HX-001 gate -> H:\Temp3\harness-spike\M4\HX-001\gate-<stamp>.json`.
- [ ] **Step 3: Premise evidence (HX-001 only).** In the baseline run, `DamagedReturnBlocksVehicle` failed by assertion: `jq -r '.runs[0].result.tests[] | select(.procedure=="DamagedReturnBlocksVehicle") | .failure' <file>` prints `assertion`.
- [ ] **Step 4:** Record wall time: `jq '[.runs[].result.ms] | add' <file>` in the submit note (first real distribution, for the container budget).
- [ ] **Step 5:** Exit 1: send `reasons` and the path to lane-content; do not edit AL. Exit 3: re-lease another content container and rerun once; a second infra exit goes to `coord ask`.
- [ ] **Step 6:** Release the lease; report the path to lane-content and the orchestrator. The orchestrator tags the gated commit `refapp-v1-rcN` on acceptance.

**Acceptance (all gate jobs, offline):** `jq -e '.promoted and .matrix_complete and .source_commit == "<sha>" and .task_tree == "<TASK TREE of the latest audit or re-attestation>" and (.runs | length) == (.plan | length) and .cleanup_error == null' <report>` exits 0; `tag_status` is `pending` (first gate) or `match` (re-gate). For HX-001 also the Step 3 line prints `assertion`.

---

### Task M4-04: refapp slice B and HX-002 (test-authoring: lease schedule)

**Lane:** content. **Deps:** M4-02, M4-16 (P1, P2, P5). **Target:** 10-01 to 10-02.

Spec 1a section 7 (test-authoring boundary; mutant 0 is the staged buggy state), 1b section 3 (Leasing -> Core `internal`), 1b section 8.

**Files:**
- Modify: `Core/src/LeaseMath.Codeunit.al`
- Create: `Leasing/src/LeaseContract.Table.al`, `LeaseScheduleLine.Table.al`
- Modify: `Leasing/src/LeaseMgt.Codeunit.al`, `Test/src/TestLibrary.Codeunit.al` (add `CreateLease`)
- Create: `tasks/HX-002/{task.yml,prompt.md}`, `overlay/Leasing/src/LeaseMgt.Codeunit.al`, `correct/Leasing/src/LeaseMgt.Codeunit.al`, `mutants/<m>/...`, `reference-tests/Test/src/LeaseScheduleTests.Codeunit.al`, `naive/{drift-repro-only,near-complete}/Test/src/*.al`

**Interfaces:**
- Produces: table 70300 `"CGR Lease Contract"` (No. Code[20], Vehicle No. Code[20] without TableRelation, Customer Name Text[100], Start Date, Months Integer, Base Rate Decimal); table 70301 `"CGR Lease Schedule Line"` (PK Contract No., Line No.; Due Date, Amount, Invoiced); `"CGR Lease Mgt"`: `MonthlyRate(BaseRate; Months): Decimal`, `CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; Months: Integer; BaseRate: Decimal): Code[20]`, `CreateSchedule(ContractNo: Code[20])`, `InvoiceLine(ContractNo: Code[20]; LineNo: Integer)`. Core `"CGR Lease Math"` internal: `RateFactor`, `LeaseTotal(BaseRate; Months): Decimal`, `SplitInstallments(Total; Count; var Amounts: List of [Decimal])`.

- [ ] **Step 1: Core internal math** (`Core/src/LeaseMath.Codeunit.al`):
```al
codeunit 70002 "CGR Lease Math"
{
    internal procedure RateFactor(Months: Integer): Decimal
    begin
        exit(1 + Months / 100);
    end;

    internal procedure LeaseTotal(BaseRate: Decimal; Months: Integer): Decimal
    begin
        exit(Round(BaseRate * RateFactor(Months) * Months, 0.01));
    end;

    internal procedure SplitInstallments(Total: Decimal; Count: Integer; var Amounts: List of [Decimal])
    var
        Installment: Decimal;
        Allocated: Decimal;
        i: Integer;
    begin
        Clear(Amounts);
        Installment := Round(Total / Count, 0.01);
        for i := 1 to Count - 1 do begin
            Amounts.Add(Installment);
            Allocated += Installment;
        end;
        Amounts.Add(Total - Allocated);
    end;
}
```

- [ ] **Step 2: Leasing.** `CreateContract` uses `Setup.NextLeaseNo()`; `InvoiceLine` sets `Invoiced := true`. Correct `CreateSchedule` (refapp and `correct/`):
```al
    procedure CreateSchedule(ContractNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMath: Codeunit "CGR Lease Math";
        Amounts: List of [Decimal];
        i: Integer;
    begin
        Contract.Get(ContractNo);
        if Contract.Months <= 0 then
            Error(MonthsErr, ContractNo);
        Line.SetRange("Contract No.", ContractNo);
        Line.SetRange(Invoiced, true);
        if not Line.IsEmpty() then
            Error(InvoicedErr, ContractNo);
        Line.SetRange(Invoiced);
        Line.DeleteAll(true);
        LeaseMath.SplitInstallments(LeaseMath.LeaseTotal(Contract."Base Rate", Contract.Months), Contract.Months, Amounts);
        for i := 1 to Contract.Months do begin
            Line.Init();
            Line."Contract No." := ContractNo;
            Line."Line No." := i * 10000;
            Line."Due Date" := CalcDate(StrSubstNo('<+%1M>', i - 1), Contract."Start Date");
            Line.Amount := Amounts.Get(i);
            Line.Insert(true);
        end;
    end;
```
with `MonthsErr: Label 'Lease %1 must run for at least one month.'` and `InvoicedErr: Label 'Lease %1 has invoiced schedule lines and cannot be rescheduled.'`.

- [ ] **Step 3: Overlay (mutant 0, the reported drift).** `overlay/Leasing/src/LeaseMgt.Codeunit.al` = correct file with cumulative due dates:
```al
        DueDate := Contract."Start Date";
        for i := 1 to Contract.Months do begin
            Line.Init();
            Line."Contract No." := ContractNo;
            Line."Line No." := i * 10000;
            Line."Due Date" := DueDate;
            Line.Amount := Amounts.Get(i);
            Line.Insert(true);
            DueDate := CalcDate('<+1M>', DueDate);
        end;
```

- [ ] **Step 4: Mutants** (one whole file each, identical to `correct/` or the refapp file except the change; production ids unchanged):

| Mutant | File | Change |
| --- | --- | --- |
| no-carry | `Core/src/LeaseMath.Codeunit.al` | `SplitInstallments` adds `Installment` for every line |
| first-due-shift | `Leasing/src/LeaseMgt.Codeunit.al` | `'<+%1M>'` with `i` instead of `i - 1` |
| invoiced-rebuilt | `Leasing/src/LeaseMgt.Codeunit.al` | no invoiced check; `DeleteAll` removes invoiced lines too |
| flat-factor | `Core/src/LeaseMath.Codeunit.al` | `RateFactor` returns `1 + (Months div 100)` |
| no-op-reschedule | `Leasing/src/LeaseMgt.Codeunit.al` | `if not Line.IsEmpty() then exit;` before the invoiced check (unfiltered) |
| line-numbering | `Leasing/src/LeaseMgt.Codeunit.al` | `Line."Line No." := i * 1000` |
| partial-reschedule | `Leasing/src/LeaseMgt.Codeunit.al` | uninvoiced lines deleted before the invoiced check. **Only if M4-16 P1 shows the rows stay deleted after `asserterror`;** otherwise it is equivalent and not added. |

- [ ] **Step 5: task.yml and prompt**

```yaml
id: HX-002
refapp_version: refapp-v1-rc2
kind: test-authoring
prompt: prompt.md
touches: [Leasing, Core, Test]
coupling: [internal]
source: refapp
attachments: []
scorers: [build, pass_to_pass, mutant_kill]
pass_to_pass:
  - { codeunit: 80030, procedures: [LeaseRateUsesCoreInternal] }
  - { codeunit: 80010, procedures: [CheckOutMarksVehicleCheckedOut, ReturnWithoutDamageReleasesVehicle] }
mutants: [no-carry, first-due-shift, invoiced-rebuilt, flat-factor, no-op-reschedule, line-numbering]
contamination: null
limits: { timeout_min: 30 }
```
(append `partial-reschedule` to `mutants` per P1.)

`prompt.md`:
```markdown
# Task 4188: Automated tests for lease schedules

Finance reports that schedules of leases starting at the end of a month drift. A 12-month lease starting 31 January 2027 has its March installment due on 28 March instead of 31 March, and every later installment stays on the 28th.

Before anyone changes the scheduling code we want automated tests that pin down how a lease schedule must behave. Add them to the Test app. Do not fix the scheduling code in this task: your tests will be run against the corrected scheduling code, where they must pass, and against the current code, where they must catch the drift.

How a lease schedule must behave (schedules are created with `CGR Lease Mgt`, CreateSchedule):

- One schedule line per month of the lease, line numbers 10000, 20000, 30000 and so on.
- The first installment is due on the lease start date; installment n is due n-1 months after the start date.
- The lease total is base rate x months x rate factor, rounded to 0.01, where the rate factor is 1 + months/100. Every installment is the total divided by the number of months, rounded to 0.01, except the last one, which takes the remainder so that the installments add up exactly to the total.
- Creating the schedule again replaces the existing lines with a schedule for the lease as it is now.
- A lease with an invoiced schedule line cannot be rescheduled: the attempt fails and the schedule stays exactly as it was.
```

- [ ] **Step 6: Reference tests** (`reference-tests/Test/src/LeaseScheduleTests.Codeunit.al`, codeunit 80100 "CGR Lease Schedule Tests"; each procedure creates its own lease):

| Procedure | Arrange | Assert | Kills |
| --- | --- | --- | --- |
| DueDatesFollowStartDate | start 2027-01-31, 12 months, base 10.07 | due dates 01-31, 02-28, 03-31, 04-30 ... 12-31 (all twelve) | m0, first-due-shift |
| LeapYearDueDates | start 2028-01-31, 3 months, base 100 | 2028-01-31, 2028-02-29, 2028-03-31 | m0, first-due-shift |
| OneLinePerMonthNumbered | start 2027-01-31, 12 months, base 10.07 | 12 lines, numbers 10000..120000 step 10000 | line-numbering |
| SingleMonthLease | start 2027-02-28, 1 month, base 100 | one line 10000, due 2027-02-28, amount 101.00 | flat-factor |
| InstallmentsCarryRoundingToLastLine | start 2027-01-31, 12 months, base 10.07 | lines 1-11 = 11.28 each; line 12 = 11.26; sum 135.34 | no-carry, flat-factor |
| RescheduleReplacesLines | 12 months base 10.07, schedule; set Months 6, Base Rate 20, `Modify`; schedule again | 6 lines (10000..60000), each 21.20, sum 127.20; no line above 60000 | no-op-reschedule |
| InvoicedLeaseCannotBeRescheduled | 12 months base 10.07, schedule, InvoiceLine(10000); snapshot all lines (No., Due Date, Amount, Invoiced); set Months 6, `Modify` | `asserterror` CreateSchedule; the 12 lines equal the snapshot field by field | invoiced-rebuilt, partial-reschedule |

Values: 10.07 x 1.12 x 12 = 135.3408, total 135.34; 135.34 / 12 = 11.2783, installment 11.28; 11 x 11.28 = 124.08; last 11.26. 20 x 1.06 x 6 = 127.20, installments 21.20. 100 x 1.01 x 1 = 101.00.

- [ ] **Step 7: Naive suites** (codeunit 80101 under `naive/<x>/Test/src/`; each passes on `correct/`, runs completely on every target, leaves a mutant alive):
  - `drift-repro-only`: DueDatesFollowStartDate only. Survivors: no-carry, invoiced-rebuilt, flat-factor, no-op-reschedule, line-numbering.
  - `near-complete`: every reference procedure except RescheduleReplacesLines and InvoicedLeaseCannotBeRescheduled. Survivors: invoiced-rebuilt, no-op-reschedule (and partial-reschedule).

- [ ] **Step 8: Visible tests.** `LeasingTests` 80030 keeps `LeaseRateUsesCoreInternal` only. `TestLibrary` gets `CreateLease(VehicleNo; StartDate; Months; BaseRate): Code[20]`.

- [ ] **Step 9: Host compile, audit, check, commit, request gate.** Compile `baseline`, `tests:reference-tests@correct`, `tests:reference-tests@m0`, each `tests:reference-tests@<mutant>`, each `tests:naive/<x>@correct`. Audit with `reference-tests/` as the audited tests and Step 6 as the normative table; the auditor also checks every row of the "Kills" column. `check` HX-001 and HX-002, commit `feat(harness-tasks): refapp v1 slice B and HX-002 lease schedule tests`, request `gate ... HX-002 --rev <sha>` for M4-05.

**Acceptance:** `check` `[OK]` for HX-001 and HX-002; latest audit `TASK TREE` matches and `VERDICT: clean`; `reference-tests/` has the seven procedures of Step 6; `mutants/` folders match `task.yml`.

---

### Task M4-05: gate job HX-002

**Lane:** ops. **Deps:** M4-01c, M4-04. **Target:** 10-02.

M4-03 Steps 1, 2, 4, 5, 6 with HX-002. Plan: baseline 1, reference tests on correct x3, reference tests on m0 and each named mutant, each naive suite on correct, m0 and each mutant (with six mutants: 1 + 3 + 7 + 2 x 8 = 27 runs). Tag `refapp-v1-rc2`.

**Acceptance:** the common gate acceptance line (M4-03).

---

### Task M4-06: refapp slice C and HX-003 (feature: service-due vehicles)

**Lane:** content. **Deps:** M4-04. **Target:** 10-02 to 10-03.

Spec 1b section 3 (Rental -> Fleet IsHandled plus legacy direct call; Fleet -> Core interface plus extensible enum), in-app style "event subscriber instance modes" (manual binding in the oracle).

**Files:**
- Modify: `Fleet/src/FleetMgt.Codeunit.al` (`NextServiceKm` counts from `"Last Service Km"`)
- Modify: `Core/src/Setup.Table.al` (field 4 `"Suspend Rentals"` Boolean)
- Create: `Rental/src/RentalFleetSubscribers.Codeunit.al` (70201: on Fleet `OnBeforeIsAvailable`, when Setup `"Suspend Rentals"` is true sets `Result := false; IsHandled := true`; otherwise nothing)
- Modify: `Rental/src/RentalMgt.Codeunit.al` (legacy `SwapVehicle(ContractNo: Code[20]; NewVehicleNo: Code[20])`: contract must be Checked Out; reads the new vehicle directly and errors `NotAvailableErr` when Checked Out or Blocked; old vehicle Checked Out false and new vehicle Checked Out true by direct `Modify`; contract Vehicle No. and Start Km := new vehicle Mileage)
- Modify: `Test/src/FleetTests.Codeunit.al` (`HeavyDutyStrategyFromFleetExtension` sets Last Service Km 1000, expects 6000), `RentalTests.Codeunit.al` (add `SwapMovesContractToFreeVehicle`, `SuspendRentalsBlocksCheckout`)
- Create: `tasks/HX-003/{task.yml,prompt.md}`, `correct/...`, `oracle/app.json` (suffix 3, 85200-85299, deps Core, Fleet, Rental, Library Assert), `oracle/src/ServiceOracle.Codeunit.al` (85200), `AvailabilityOverride.Codeunit.al` (85201, `EventSubscriberInstance = Manual`, sets `Result := true; IsHandled := true`), `ShortInterval.Codeunit.al` (85202 implements `"CGR Maintenance Strategy"`, `exit(CurrentKm + 1000)`), `Strategies.EnumExt.al` (enumextension 85200, value 85200 `"HX3 Short"`), `naive/{checkout-only,after-ishandled,hardcoded-interval}/...`
- No overlay.

- [ ] **Step 1: Slice C** as listed; host compile `baseline`; `check` HX-001 and HX-002 (drift must stay clean).

- [ ] **Step 2: prompt.md**
```markdown
# Feature 4203: Keep vehicles that are due for service off the road

The workshop wants vehicles that have reached their service interval kept away from new rentals until they have been serviced.

A vehicle is due for service when its mileage has reached the next service km that its maintenance strategy gives for the mileage at its last service ("Last Service Km"). Default vehicles go 15,000 km between services and Heavy Duty vehicles 5,000 km; other apps can add strategies.

- Checking out a rental contract for a vehicle that is due for service fails with the error "Vehicle <No.> is due for service." and leaves the contract and the vehicle unchanged.
- Swapping a checked-out contract to a vehicle that is due for service fails with the same error and leaves the contract, its current vehicle and the other vehicle unchanged.
- The fleet availability check (`CGR Fleet Mgt`, IsAvailable) reports a vehicle that is due for service as not available.
- This is a safety rule: extensions that customize vehicle availability cannot make a vehicle that is due for service available, for checkouts or swaps. For vehicles that are not due, their customizations keep working as today.
```

- [ ] **Step 3: task.yml**: `kind: feature`, `touches: [Fleet, Rental, Core]`, `coupling: [ishandled, interface]`, `refapp_version: refapp-v1-rc3`, p2p 80010 {CheckOutMarksVehicleCheckedOut, CheckOutTwiceFails, SwapMovesContractToFreeVehicle, SuspendRentalsBlocksCheckout}, 80020 {HeavyDutyStrategyFromFleetExtension, DamageBlocksVehicle}; f2p codeunit 85200 with the procedures below; `limits: { timeout_min: 30 }`.

- [ ] **Step 4: Oracle (normative)**, codeunit 85200 "HX003 Service Oracle". Every procedure sets Setup `"Suspend Rentals"` false and creates its own vehicles (Blocked false, Checked Out false). "Unchanged" means: contract Status, Vehicle No. and Start Km as before the call; vehicle Checked Out, Mileage and Blocked as before.

| Procedure | Arrange | Assert |
| --- | --- | --- |
| DefaultVehicleDueIsRefused | HX3-A Default, Last Service 10000, Mileage 25000 | `asserterror` CheckOut; `ExpectedError('Vehicle HX3-A is due for service.')`; contract and vehicle unchanged |
| DefaultVehicleBelowIntervalRents | HX3-B Default, 10000 / 24999 | CheckOut succeeds; contract Checked Out; Start Km 24999 |
| HeavyDutyDueAtFiveThousand | HX3-C Heavy Duty, 10000 / 15000 | refused with HX3-C message; unchanged |
| HeavyDutyBelowIntervalRents | HX3-D Heavy Duty, 10000 / 14999 | CheckOut succeeds |
| ExtensionStrategyIsRespected | HX3-E "HX3 Short" 10000 / 11000; HX3-F "HX3 Short" 10000 / 10999 | E refused with its message; F checks out |
| SwapToDueVehicleIsRefused | HX3-G Default not due, checked out; HX3-H Default 0 / 15000 | `asserterror` SwapVehicle(contract, HX3-H); H message; contract unchanged (Vehicle No. HX3-G); G and H unchanged |
| AvailabilityReportsDueVehicle | HX3-I due, HX3-J not due | `IsAvailable(HX3-I)` false; `IsAvailable(HX3-J)` true |
| OverrideCannotReleaseDueVehicle | bind override; HX3-K due | `IsAvailable` false; CheckOut refused with the due message; unchanged; unbind |
| SwapUnderOverrideRefused | bind override; HX3-M not due checked out; HX3-N due | `asserterror` SwapVehicle(contract, HX3-N); N message; contract and both vehicles unchanged; unbind |
| OverrideStillAppliesToVehiclesNotDue | bind override; HX3-L not due, Blocked true | `IsAvailable` true; CheckOut succeeds; unbind |

- [ ] **Step 5: correct/**: `FleetMgt.IsDueForService(VehicleNo): Boolean` (`Mileage >= NextServiceKm(VehicleNo)`); `IsAvailable` returns false for a due vehicle before raising `OnBeforeIsAvailable`; `RentalMgt.CheckOut` and `SwapVehicle` raise `DueForServiceErr: Label 'Vehicle %1 is due for service.'` before any other check or change. Any solution meeting the oracle is valid.

- [ ] **Step 6: naive/** and kill mapping (lost by assertion; a lost `asserterror` is an assertion class per M4-01a):

| Naive | Change | Rows lost |
| --- | --- | --- |
| checkout-only | only `CheckOut` checks due (message and strategy right); `SwapVehicle`, `IsAvailable` unchanged | SwapToDueVehicleIsRefused, AvailabilityReportsDueVehicle, OverrideCannotReleaseDueVehicle (IsAvailable), SwapUnderOverrideRefused |
| after-ishandled | due check inside `IsAvailable` after the `IsHandled` exit; `CheckOut`/`SwapVehicle` call `IsAvailable` and raise the due message when `IsDueForService` | OverrideCannotReleaseDueVehicle, SwapUnderOverrideRefused |
| hardcoded-interval | correct structure, due = `Mileage >= "Last Service Km" + 15000` | HeavyDutyDueAtFiveThousand, ExtensionStrategyIsRespected |

- [ ] **Step 7: Host compile all variants, audit (Step 4 table, Step 6 mapping), `check` HX-001..HX-003, commit `feat(harness-tasks): refapp v1 slice C and HX-003 service-due vehicles`, request gate M4-07.**

**Acceptance:** `check` `[OK]` for HX-001..HX-003; latest audit `TASK TREE` matches and `VERDICT: clean`; oracle has the ten procedures of Step 4.

---

### Task M4-07: gate job HX-003

**Lane:** ops. **Deps:** M4-01c, M4-06. **Target:** 10-03.

M4-03 Steps 1, 2, 4, 5, 6 with HX-003; 10 runs. The baseline oracle fails to compile or loses its due rows; if it fails to compile, quote `.runs[0].summary.oracleCodes` in the note (evidence for `MISSING_FEATURE_CODES`; an unexpected code goes to the orchestrator, not into the list). Tag `refapp-v1-rc3`.

**Acceptance:** the common gate acceptance line.

---

### Task M4-08: refapp slice D and HX-004 (feature: revenue per vehicle)

**Lane:** content. **Deps:** M4-06, M4-16 (P4). **Target:** 10-04 to 10-05.

Spec 1b section 3 (Reporting -> Rental/Leasing/Fleet: table extensions, cross-app FlowFields), in-app style "posting codeunit chains".

**Files:**
- Modify: `Core/src/Setup.Table.al` (fields 5 `"Weekend Surcharge %"` Decimal, 6 `"Km Allowance per Day"` Integer, 7 `"Excess Km Rate"` Decimal)
- Create: `Rental/src/PricingMethod.Enum.al` (enum 70201, `Extensible = false`, `Daily` 0, `"Weekend Package"` 1); field 10 `"Pricing Method"` on `"CGR Rental Contract"`
- Create: `Rental/src/RentalPricing.Codeunit.al` (70203), `RentalPost.Codeunit.al` (70204, `TableNo = "CGR Rental Contract"`), `RentalPostLedger.Codeunit.al` (70205), `RentalLedgerEntry.Table.al` (table 70205: Entry No. AutoIncrement, Contract No., Vehicle No., Posting Date, Amount, Km Driven)
- Modify: `Rental/src/RentalMgt.Codeunit.al` (add `Post(ContractNo: Code[20])`: `Contract.Get`; `Codeunit.Run(Codeunit::"CGR Rental-Post", Contract)`)
- Modify: `Test/src/RentalTests.Codeunit.al` (add `PostCreatesLedgerEntry`, `DailyPriceWithWeekendSurcharge`, `ExcessKmCharged`)
- Modify (re-derive, Step 9): `tasks/HX-003/correct/Rental/src/RentalMgt.Codeunit.al`, `tasks/HX-003/naive/*/Rental/src/RentalMgt.Codeunit.al`, `tasks/HX-003/task.yml`
- Create: `tasks/HX-004/{task.yml,prompt.md}`, `correct/{Leasing,Reporting}/...`, `oracle/` (suffix 4, 85300-85399, deps Core, Fleet, Rental, Leasing, Reporting, Library Assert), `naive/{no-follow,all-lines,moves-invoiced}/...`

- [ ] **Step 1: Pricing** (the hard-wired base HX-005 refactors), `"CGR Rental Pricing".CalcAmount(Contract: Record "CGR Rental Contract"): Decimal`:
```al
    procedure CalcAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        Amount: Decimal;
        Days: Integer;
        Driven: Integer;
        Allowed: Integer;
        i: Integer;
    begin
        Vehicle.Get(Contract."Vehicle No.");
        Setup.GetOrCreate();
        Days := Contract."End Date" - Contract."Start Date" + 1;
        case Contract."Pricing Method" of
            Contract."Pricing Method"::Daily:
                begin
                    Amount := Days * Vehicle."Daily Rate";
                    for i := 0 to Days - 1 do
                        if Date2DWY(Contract."Start Date" + i, 1) in [6, 7] then
                            Amount += Vehicle."Daily Rate" * Setup."Weekend Surcharge %" / 100;
                end;
            Contract."Pricing Method"::"Weekend Package":
                Amount := 2 * Vehicle."Daily Rate";
        end;
        Driven := Contract."Return Km" - Contract."Start Km";
        Allowed := Days * Setup."Km Allowance per Day";
        if Driven > Allowed then
            Amount += (Driven - Allowed) * Setup."Excess Km Rate";
        exit(Round(Amount, 0.01));
    end;
```

- [ ] **Step 2: Posting chain.** `"CGR Rental-Post"` `OnRun`: status must be Returned (`NotReturnedErr`); `OnBeforePostRentalContract(Rec)`; `Amount := Pricing.CalcAmount(Rec)`; `"CGR Rental-Post Ledger".InsertEntry(Rec, Amount)` (Posting Date := End Date, Km Driven := Return Km - Start Km); `Rec.Status := Posted; Rec.Modify(true)`; `OnAfterPostRentalContract(Rec, Amount)`.

- [ ] **Step 3: prompt.md**
```markdown
# Feature 4231: Revenue per vehicle

Controlling wants to see what each vehicle earns from rentals and from leases, for any period.

Add three fields to the vehicle, in the Reporting app:

- "Date Filter": a date filter.
- "Rental Revenue" (Decimal): the total amount of the rental ledger entries of the vehicle, limited to posting dates within the date filter when one is set.
- "Lease Revenue" (Decimal): the total amount of the invoiced lease schedule lines for the vehicle, limited to due dates within the date filter when one is set. Lines that are not invoiced do not count.

Both revenue fields are calculated fields (FlowFields), so they can be shown on lists.

When the vehicle of a lease contract is changed (validating its "Vehicle No."), the schedule lines that are not invoiced yet move with the lease to the new vehicle; lines already invoiced stay with the vehicle they were invoiced on.
```

- [ ] **Step 4: task.yml**: `kind: feature`, `touches: [Reporting, Leasing, Rental, Fleet]`, `coupling: [queries, internal]`, `refapp_version: refapp-v1-rc4`, p2p 80010 {PostCreatesLedgerEntry, DailyPriceWithWeekendSurcharge, ExcessKmCharged}, 80030 {LeaseRateUsesCoreInternal}; f2p codeunit 85300.

- [ ] **Step 5: Oracle (normative)**, codeunit 85300 "HX004 Revenue Oracle". Every procedure sets Setup `"Weekend Surcharge %"` 0, `"Km Allowance per Day"` 1000, `"Excess Km Rate"` 0, and uses its own vehicles (daily rate 50). Rentals are created, checked out, returned with no extra km and posted through `CGR Rental Mgt`. Leases through `CGR Lease Mgt`.

| Procedure | Arrange | Assert |
| --- | --- | --- |
| RentalRevenueSumsPostedContracts | HX4-A: posted Daily 2027-03-01..03 (150.00) and 2027-03-08..09 (100.00); HX4-B: posted 2027-03-01..04 (200.00) | A = 250.00; B = 200.00 |
| RentalRevenueDateFilterInclusive | HX4-C as A (posting dates 03-03 and 03-09) | filter 03-03..03-09: 250.00; 03-04..03-08: 0; 03-03..03-03: 150.00 |
| RentalRevenueIgnoresUnposted | HX4-D: one posted (150.00), one returned, not posted | 150.00 |
| LeaseRevenueCountsInvoicedLinesOnly | HX4-E: lease 2027-03-01, 3 months, base 100 (103.00 each), invoice 10000 and 20000 | 206.00 |
| LeaseRevenueDateFilterInclusive | HX4-F: same lease, all three invoiced | filter 04-01..04-01: 103.00; 03-01..05-01: 309.00; 03-02..03-31: 0 |
| UninvoicedLinesFollowVehicleChange | HX4-G lease as E, invoice 10000; `Validate("Vehicle No.", 'HX4-H')`, `Modify(true)` | right after: G = 103.00, H = 0; invoice 20000: G 103.00, H 103.00; invoice 30000: G 103.00, H 206.00 |
| RepeatedVehicleChangeFollowsLastVehicle | HX4-I lease as E, invoice 10000; change to HX4-J, then to HX4-K; invoice 20000 and 30000 | I = 103.00; J = 0; K = 206.00 |
| RevenueSourcesStaySeparate | HX4-L: one posted rental (150.00) and one lease, line 10000 invoiced (103.00) | Rental Revenue 150.00; Lease Revenue 103.00 |

Values: 2027-03-01 is a Monday; lease total 100 x 1.03 x 3 = 309.00. An implementation that assigns the line's vehicle at invoicing time instead of at validation is observably equivalent for every stated behavior; the oracle asserts revenue, never the private field design (review answer).

- [ ] **Step 6: correct/**: a `"Vehicle No."` field on `"CGR Lease Schedule Line"` set in `CreateSchedule`; `OnValidate` of Lease Contract `"Vehicle No."` moves uninvoiced lines; Reporting `tableextension 70500 "CGR Vehicle Revenue" extends "CGR Vehicle"` with the three fields (`Sum` with `Invoiced = const(true)` and the date filter).

- [ ] **Step 7: naive/** and kill mapping:

| Naive | Change | Rows lost |
| --- | --- | --- |
| no-follow | line Vehicle No. set in `CreateSchedule`, no `OnValidate` | UninvoicedLinesFollowVehicleChange, RepeatedVehicleChangeFollowsLastVehicle |
| all-lines | Lease Revenue without the Invoiced filter | LeaseRevenueCountsInvoicedLinesOnly, UninvoicedLinesFollowVehicleChange (H after validate) |
| moves-invoiced | `OnValidate` moves every line | UninvoicedLinesFollowVehicleChange (G becomes 0), RepeatedVehicleChangeFollowsLastVehicle |

- [ ] **Step 8: Host compile all variants, audit (Steps 5, 7).**

- [ ] **Step 9: Re-derive HX-003.** Slice D adds `Post` to `RentalMgt`, which HX-003's `correct/` and three `naive/` replace. Apply the slice D change to those four files (task changes kept), set HX-003 `refapp_version: refapp-v1-rc4`, host compile HX-003 `correct` and each naive. The HX-003 oracle is untouched. Commit, then run a fresh full `al-test-auditor` pass on HX-003 (template of M4-02 Step 7, table M4-06 Step 4, mapping M4-06 Step 6) to `H:\Temp3\harness-spike\M4\HX-003\audit-rc4-*.md`; its `TASK TREE` is the one M4-09 checks.

- [ ] **Step 10: `check` HX-001..HX-004, commit `feat(harness-tasks): refapp v1 slice D and HX-004 revenue per vehicle`, request gate M4-09 for HX-004 and HX-003.**

**Acceptance:** `check` `[OK]` for HX-001..HX-004; latest HX-004 audit and the fresh HX-003 audit name the committed trees and end `VERDICT: clean`; oracle has the eight procedures of Step 5; `git diff <rc3 sha> -- harness-tasks/tasks/HX-003/oracle` is empty.

---

### Task M4-09: gate jobs HX-004 and HX-003

**Lane:** ops. **Deps:** M4-01c, M4-08. **Target:** 10-05.

M4-03 Steps 1, 2, 4, 5, 6 with HX-004, then with HX-003 on the same commit (10 runs each). Tag `refapp-v1-rc4`.

**Acceptance:** the common gate acceptance line for both reports.

---

### Task M4-10: HX-005 (refactor: extensible pricing methods)

**Lane:** content. **Deps:** M4-08. **Target:** 10-05 to 10-06.

Spec 1b section 3 (interface plus extensible enum, strategy style) and 1b section 9. No refapp change: the task starts from slice D's hard-wired `case`. The review expects this task to be the most likely to saturate; the M4-17 pilot runs it first.

**Files:**
- Create: `tasks/HX-005/{task.yml,prompt.md}`, `correct/Rental/src/{PricingMethod.Enum.al,RentalPriceMethod.Interface.al,DailyPrice.Codeunit.al,WeekendPackagePrice.Codeunit.al,RentalPricing.Codeunit.al}`, `oracle/` (suffix 5, 85400-85499, deps Core, Fleet, Rental, Library Assert; `enumextension 85400 "HX005 Pricing Methods" extends "CGR Pricing Method"` value 85400 `"HX5 Flat Fee"` implemented by codeunit 85401 returning `DailyRate * 1.5 * (Contract."End Date" - Contract."Start Date" + 1)`, so the partner price depends on the forwarded contract and rate), `naive/{case-kept,excess-in-methods,surcharge-lost,early-rounding}/...`

- [ ] **Step 1: prompt.md**
```markdown
# Task 4250: Let partner apps add rental pricing methods

Partners want to ship their own rental pricing methods, for example a flat corporate rate, in their own apps without changing Rental. Today the pricing methods are hard-wired in `CGR Rental Pricing`.

Change Rental so that:

- "CGR Pricing Method" can be extended by other apps, and every method provides its base price through an interface named "CGR Rental Price Method" with one procedure: `CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal`, where DailyRate is the daily rate of the contract's vehicle.
- Daily and Weekend Package keep producing exactly the prices they produce today.
- The excess km charge stays common: it is added on top of the base price of every method, including methods added by other apps.
- The total is rounded to 0.01 once, after the excess km charge is added.
- `CGR Rental Pricing`, CalcAmount(Contract) keeps its signature and still returns the full price, and posting keeps using it.
```

- [ ] **Step 2: task.yml**: `kind: refactor`, `touches: [Rental]`, `coupling: [interface]`, `refapp_version: refapp-v1-rc5`, p2p 80010 {PostCreatesLedgerEntry, DailyPriceWithWeekendSurcharge, ExcessKmCharged}; f2p codeunit 85400.

- [ ] **Step 3: Oracle (normative)**, codeunit 85400 "HX005 Pricing Oracle". Each procedure sets Setup explicitly and uses its own vehicle; contracts are inserted directly (Start/End Date, Start Km, Return Km, Pricing Method) and priced with `CalcAmount`, except the posting row.

| Procedure | Setup (surcharge %, allowance/day, excess rate) | Rate | Contract | Expected |
| --- | --- | --- | --- | --- |
| DailyWeekdaysUnchanged | 25, 1000, 0 | 40 | Daily 2027-03-01..03, 0 km | 120.00 |
| DailyWeekendSurchargeUnchanged | 25, 1000, 0 | 40 | Daily 2027-03-05..08, 0 km | 180.00 |
| DailyFractionalSurcharge | 12.5, 1000, 0 | 33.33 | Daily 2027-03-05..08, 0 km | 141.65 |
| WeekendPackageUnchanged | 25, 1000, 0 | 40 | Weekend Package 2027-03-05..07, 0 km | 80.00 |
| ExcessKmBelowAllowance | 0, 100, 0.5 | 40 | Daily 2027-03-01..03, 299 km | 120.00 |
| ExcessKmAtAllowance | 0, 100, 0.5 | 40 | same, 300 km | 120.00 |
| ExcessKmAboveAllowance | 0, 100, 0.5 | 40 | same, 301 km | 120.50 |
| ExcessKmOnWeekendPackage | 0, 100, 0.5 | 40 | Weekend Package 2027-03-05..07, 400 km | 130.00 |
| PartnerMethodPriceUsed | 0, 1000, 0 | 40 | HX5 Flat Fee 2027-03-01..03, 0 km | 180.00 |
| PartnerMethodGetsExcessKm | 0, 100, 0.5 | 40 | HX5 Flat Fee 2027-03-01..01, 300 km | 160.00 |
| PartnerFractionalRoundedOnce | 0, 100, 0.005 | 33.33 | HX5 Flat Fee 2027-03-01..01, 101 km | 50.00 |
| PostingUsesPartnerMethod | 0, 1000, 0 | 40 | HX5 Flat Fee 2027-03-01..03, created, checked out, returned, posted via `CGR Rental Mgt` | one ledger entry, Amount 180.00 |

Values: 4 x 33.33 = 133.32 plus 2 x 4.16625 = 141.6525, rounded 141.65. 33.33 x 1.5 = 49.995 plus 1 km x 0.005 = 50.000, rounded 50.00; rounding the base first gives 50.00 + 0.005 = 50.01.

- [ ] **Step 4: naive/** and kill mapping:

| Naive | Change | Rows lost |
| --- | --- | --- |
| case-kept | enum extensible with interface and two implementations, but `CalcAmount` keeps a `case` over known values, `else` base 0 | PartnerMethodPriceUsed, PartnerMethodGetsExcessKm, PartnerFractionalRoundedOnce, PostingUsesPartnerMethod |
| excess-in-methods | excess km moved into Daily and Weekend Package; `CalcAmount` returns `CalcBasePrice` only | PartnerMethodGetsExcessKm, PartnerFractionalRoundedOnce |
| surcharge-lost | Daily implementation drops the weekend surcharge | DailyWeekendSurchargeUnchanged, DailyFractionalSurcharge |
| early-rounding | `CalcAmount` rounds the base price returned through the interface to 0.01 before adding the excess charge (the oracle's partner implementation is unchanged) | PartnerFractionalRoundedOnce (50.01, not 50.00) |

- [ ] **Step 5: Host compile all variants, audit (Steps 3, 4; auditor rule C: the partner method is exercised through the interface), `check` HX-001..HX-005, commit `feat(harness-tasks): HX-005 extensible pricing refactor`, request gate M4-11.**

**Acceptance:** `check` `[OK]` for HX-001..HX-005; latest audit `TASK TREE` matches and `VERDICT: clean`; oracle has the twelve procedures of Step 3.

---

### Task M4-11: gate job HX-005

**Lane:** ops. **Deps:** M4-01c, M4-10. **Target:** 10-06.

M4-03 Steps 1, 2, 4, 5, 6 with HX-005; 1 + 3 + 4 x 2 = 12 runs. The baseline oracle does not compile (no interface): quote `oracleCodes` in the note as `MISSING_FEATURE_CODES` evidence. Tag `refapp-v1-rc5`.

**Acceptance:** the common gate acceptance line.

---

### Task M4-12: refapp slice E and HX-006 (feature: return messages with sequence)

**Lane:** content. **Deps:** M4-10, M4-16 (P3). **Target:** 10-06 to 10-07.

Spec 1b section 3 (Integration -> Core: facade codeunit, JSON; reaction to Rental through the Core publisher).

**Files:**
- Create: `Integration/src/OutboxEntry.Table.al` (table 70401: Entry No. AutoIncrement, `"Event Type"` Text[50], `"Vehicle No."` Code[20], Payload Text[2048], `"Created At"` DateTime, Sent Boolean)
- Modify: `Integration/src/IntegrationFacade.Codeunit.al` (add `QueueVehicleCheckedOut(VehicleNo)`, `MarkSent(EntryNo: Integer)`, `PurgeSent()`)
- Create: `Integration/src/IntegrationSubscribers.Codeunit.al` (70402: on Core `OnAfterVehicleCheckedOut` calls `QueueVehicleCheckedOut`)
- Modify: `Test/src/IntegrationTests.Codeunit.al` (add `OutboxQueuesCheckout`: after a checkout the last outbox entry for the vehicle has Event Type `vehicleCheckedOut` and its payload parses with `vehicleNo` = the vehicle)
- Create: `tasks/HX-006/{task.yml,prompt.md}`, `correct/Integration/...`, `oracle/` (suffix 6, 85500-85599, deps Core, Fleet, Rental, Integration, Library Assert), `naive/{count-sequence,string-km,always-description}/...`

- [ ] **Step 1: prompt.md**
```markdown
# Feature 4262: Tell the partner portal about returns, in order

The partner portal gets a message in the integration outbox when a vehicle is checked out. It also needs to know when a vehicle comes back, and it processes messages per vehicle, so it needs their order.

1. When a rental vehicle is returned, queue an outbox entry with Event Type "vehicleReturned" and this JSON payload:
   `{"event":"vehicleReturned","vehicleNo":"<No.>","returnKm":<km>,"damage":<true|false>,"damageDescription":"<text>","sequence":<n>}`
   "returnKm" and "sequence" are JSON numbers and "damage" a JSON boolean. "damageDescription" is present only when damage was reported.
2. Every outbox entry of a vehicle, checkouts and returns alike, carries a sequence number per vehicle: 1 for the first message of that vehicle, then 2, 3 and so on in the order the events happened. Store it in a new field "Vehicle Sequence No." (Integer) on the outbox entry and in the payload's "sequence". The checkout payload becomes `{"event":"vehicleCheckedOut","vehicleNo":"<No.>","sequence":<n>}`. Payloads are compact JSON (no formatting whitespace between tokens; text values keep their own spaces) with the keys in the order shown.
3. Sent entries are purged regularly (`CGR Integration Facade`, PurgeSent). Purging does not restart the numbering of a vehicle.
```

- [ ] **Step 2: task.yml**: `kind: feature`, `touches: [Integration, Core, Rental]`, `coupling: [facade, events, core-facade]`, `refapp_version: refapp-v1-rc6`, p2p 80040 {OutboxQueuesCheckout}, 80010 {CheckOutMarksVehicleCheckedOut, ReturnWithoutDamageReleasesVehicle} (not `PayloadCarriesVehicleNo`, whose exact payload predates the sequence key); f2p codeunit 85500.

- [ ] **Step 3: Oracle (normative)**, codeunit 85500 "HX006 Outbox Oracle"; each procedure deletes the outbox entries of its own vehicles first; JSON types checked with `JsonToken.WriteTo` (text `1450`, not `"1450"`, per M4-16 P3). "Agreement" = for every entry of the vehicle, in entry order, `"Vehicle Sequence No."` equals the payload `sequence` and the expected 1, 2, 3...

| Procedure | Arrange | Assert |
| --- | --- | --- |
| ReturnQueuesMessageWithNumbers | HX6-A km 1000, check out, Return(1450, '') | 2 entries for A with agreement; last: Event Type `vehicleReturned`; payload text exactly `{"event":"vehicleReturned","vehicleNo":"HX6-A","returnKm":1450,"damage":false,"sequence":2}` (compact, ordered, no `damageDescription`, number and boolean types) |
| DamagedReturnCarriesDescription | HX6-B, Return(1300, `Bule på "dør"`) | payload text starts with `{"event":"vehicleReturned","vehicleNo":"HX6-B","returnKm":1300,"damage":true,"damageDescription":"` and ends with `","sequence":2}` (order and compactness, independent of how the text is escaped); `damageDescription` parses back to `Bule på "dør"` |
| CheckoutPayloadCarriesSequence | HX6-C, check out | payload text exactly `{"event":"vehicleCheckedOut","vehicleNo":"HX6-C","sequence":1}`; Vehicle Sequence No. 1 |
| SequenceIsPerVehicle | HX6-D check out, HX6-E check out, D return, D check out (new contract), E return | D: 3 entries with agreement (1, 2, 3); E: 2 entries with agreement (1, 2) |
| SequenceContinuesAfterPurge | HX6-F check out, return; `MarkSent` both; `PurgeSent`; check out again | 1 entry for F with agreement starting at 3 (field 3, payload 3) |
| FailedReturnLeavesNoMessage | HX6-G km 1000, check out; `asserterror` Return(999, '') | exactly 1 entry for G (the checkout), sequence 1 |

- [ ] **Step 4: correct/**: a per-vehicle counter table in Integration (for example 70403 `"CGR Vehicle Message Seq."`), a subscriber to Core `OnAfterVehicleReturned`, both payloads built with `JsonObject` in the specified key order. The oracle does not depend on the counter design.

- [ ] **Step 5: naive/** and kill mapping:

| Naive | Change | Rows lost |
| --- | --- | --- |
| count-sequence | sequence = count of the vehicle's outbox entries + 1 | SequenceContinuesAfterPurge |
| string-km | `returnKm` added as `Format(ReturnKm)` | ReturnQueuesMessageWithNumbers |
| always-description | `damageDescription` always added, empty without damage | ReturnQueuesMessageWithNumbers |

- [ ] **Step 6: Host compile all variants, audit (Steps 3, 5), `check` HX-001..HX-006, commit `feat(harness-tasks): refapp v1 slice E and HX-006 return messages`, request gate M4-13.**

**Acceptance:** `check` `[OK]` for HX-001..HX-006; latest audit `TASK TREE` matches and `VERDICT: clean`; oracle has the six procedures of Step 3.

---

### Task M4-13: gate job HX-006

**Lane:** ops. **Deps:** M4-01c, M4-12. **Target:** 10-07.

M4-03 Steps 1, 2, 4, 5, 6 with HX-006; 10 runs. Tag `refapp-v1-rc6`.

**Acceptance:** the common gate acceptance line.

---

### Task M4-17: difficulty pilot (developmental)

**Lane:** ops. **Deps:** M4-01c; a pilot runner cleared by Step 1; per task its gate (HX-002 after M4-05, HX-005 after M4-11, others after theirs). **Target:** HX-002 from 10-03, HX-005 on 10-06, others 10-07 only if the run budget below allows.

Owner decision `2026-09-25-m4-coverage-pilot.md`: one attempt per task, a frontier model through pi and OpenRouter only (no Team account), excluded from results, paid cap applies. Review section 1: HX-005 and HX-002 first. Round-2 ruling 6: a limited developmental screen. A pilot **pass** is evidence the task may be easy; a pilot **fail** is inconclusive (no compile tool, one attempt) and never evidence of difficulty.

Egress (decision `2026-09-25-egress.md`): every pilot attempt is a credential-bearing run. Unless it goes through the production adapter behind tested egress enforcement, it counts against the 5 supervised dev runs allowed before enforcement, across all lanes: at most 2 pilot attempts (HX-005, HX-002) unless the orchestrator allocates more, each supervised by the ops session for its full duration, no unattended retries, killed on unexpected network activity.

- [ ] **Step 1: Runner check (before any credential is released).** Use the production pi adapter behind egress enforcement if it exists (then the run is not counted against the 5). Otherwise the fallback runner must first be shown to meet the M0-03 carryover (findings section 8): (a) no secret in any argv, host or container (the spike `run-pi.ps1` passed the key as `--api-key`; the fixed runner reads it from the mounted secrets file into the environment of the pi process only); (b) the container is created and capture files opened inside the protected region, `docker rm -f` exit status is checked, and leftover owned containers (`cg-harness-*` prefix plus owner label) are swept at start. Evidence in `H:\Temp3\harness-spike\M4\pilot\runner-check.md`: the runner diff or adapter version, `docker inspect <container> --format "{{json .Config.Cmd}} {{json .Config.Env}}"` from a no-credential dry start showing no key, and a forced-failure run whose cleanup removed the container. No evidence: no pilot, `coord ask`.
- [ ] **Step 2: Model and estimate.** Pick the model with `deno task start models -p openrouter --live` and `deno task start models <slug> --check` (never hardcoded). Estimate per attempt = catalog input price x 3,000,000 tokens + output price x 150,000 tokens; write the estimate, spend to date and the dev-run count to date (from `H:\cg-coord\decisions\spend.md` and the orchestrator's run ledger) to `H:\Temp3\harness-spike\M4\pilot\plan.md`. Launch contract rule: at 80 percent of the USD 150 cap spent, `coord ask` and push notification. Additional conservative rule of this plan: stop and `coord ask` if the estimate for the planned attempts exceeds 20 percent of the unspent cap.
- [ ] **Step 3: Workspace.** `deno run --allow-all scripts/harness/gate-task.ts stage <task> H:\Temp3\harness-spike\M4\pilot\<task>\ws --rev <rc sha>`. Copy `prompt.md` next to it.
- [ ] **Step 4: Run pi (supervised).** Through the cleared runner with `--kill-after-s 1800`, the ops session watching the run; any network activity other than the provider and the backend: kill, record, `coord ask`. Record the dev-run number (n of 5) in `plan.md`.
- [ ] **Step 5: Judge.** `deno run --allow-all scripts/harness/gate-task.ts judge <Cronus281-283> <task> H:\Temp3\harness-spike\M4\pilot\<task>\ws --rev <rc sha>`.
- [ ] **Step 6: Record** in `H:\Temp3\harness-spike\M4\pilot\results.md`: task, model, `[PASS]`/`[FAIL]` (a fail is marked inconclusive), judge report path, cost (sum of pi assistant `message_end` `usage.cost.total`, findings section 4), dev-run number; append the cost to `spend.md`. A pass goes to lane-content and the orchestrator as a hardening candidate: content proposes a harder requirement (never a weaker oracle), the orchestrator decides before M4-14.

**Acceptance:** `runner-check.md` shows no key in argv and a checked cleanup (or names the production adapter behind enforcement); `plan.md` holds the estimate and the dev-run numbers made before each run; `results.md` has one row per piloted task with model, outcome, judge path, cost and dev-run number; `spend.md` has the matching lines.

---

### Task M4-14: freeze candidate

**Lane:** content. **Deps:** M4-03, M4-05, M4-07, M4-09, M4-11, M4-13, and any hardening decided from M4-17. **Target:** 10-08.

- [ ] **Step 1: Pre-repin drift record.** For each task run `deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-00N` while it still pins its latest rc tag (HX-003: rc4). Save the output to `H:\Temp3\harness-spike\M4\freeze\pre-repin-check.txt`. Any drift problem is fixed (re-derive, re-audit, re-gate) before Step 2.
- [ ] **Step 2:** Set `refapp_version: refapp-v1` in all six `task.yml`. No other change: `git diff <latest rc sha of the task> -- harness-tasks/tasks/HX-00N` shows only that line.
- [ ] **Step 3: Qualification manifest.** Create `harness/experiments/m4-qualify.yml` as a copy of M1's mock contract experiment with `id: m4-qualify`, `tasks: "harness-tasks/tasks/HX-*"`, `repeats: 1` and a hypothesis line saying it qualifies the v1 set (spec 1b section 8), and `H:\Temp3\harness-spike\M4\freeze\qualify-manifest.json` listing per task the positive variant (`correct` for HX-001 and HX-003 to HX-006, `reference-tests` for HX-002) and every named naive variant from its `naive/` folder. It is loaded by `harness validate` only in M4-15, after the local tag exists.
- [ ] **Step 4: Shared manifest test.** `tests/unit/harness/task-set-v1.test.ts`:
```typescript
import { assertEquals } from "@std/assert";
import { loadTaskSet } from "../../../src/harness/task.ts";

Deno.test("v1 task set: six tasks, kinds and refapp version", async () => {
  const set = await loadTaskSet("harness-tasks/tasks");
  assertEquals(set.map((t) => `${t.task.id}:${t.task.kind}:${t.task.refapp_version}`), [
    "HX-001:bugfix:refapp-v1",
    "HX-002:test-authoring:refapp-v1",
    "HX-003:feature:refapp-v1",
    "HX-004:feature:refapp-v1",
    "HX-005:refactor:refapp-v1",
    "HX-006:feature:refapp-v1",
  ]);
});
```
Run: `deno test --allow-all tests/unit/harness/task-set-v1.test.ts`. Expected: `ok | 1 passed`.
- [ ] **Step 5: Commit** `chore(harness-tasks): v1 freeze candidate pinned to refapp-v1`.
- [ ] **Step 6: Metadata-only re-attestation.** For each task dispatch `al-test-auditor`: "Re-attest `harness-tasks/tasks/HX-00N`: old audited tree `<TASK TREE of the latest full audit>`, new tree `<git rev-parse HEAD:harness-tasks/tasks/HX-00N>`. Confirm `git diff <old tree> <new tree>` changes only the `refapp_version` line of `task.yml` and nothing else. First line `TASK TREE: <new tree>`, then `FROM TREE: <old tree>`, the diff, last line `VERDICT: clean` or the deviation." Save to `H:\Temp3\harness-spike\M4\HX-00N\reattest-freeze.md`. Submit; the orchestrator creates the local provisional tag `refapp-v1` on this commit and does not push it.

**Acceptance:** the Step 2 diff check holds for all six; `task-set-v1.test.ts` passes; `pre-repin-check.txt` shows `[OK]` for all six; six `reattest-freeze.md` files name the committed trees and end `VERDICT: clean`; `qualify-manifest.json` lists every naive folder of every task.

---

### Task M4-15: freeze qualification

**Lane:** ops. **Deps:** M4-14 with the local `refapp-v1` tag; the M1 slice's `harness cell` with named mock variants and mutant scoring (cross-lane requests 2 and 3), the symbols lock. **Target:** 10-08 to 10-09.

- [ ] **Step 1: Stand-in re-gate.** `gate` for all six at `--rev refapp-v1`, spread over Cronus281-283. Expected: six reports with the common acceptance line (the `TASK TREE` is the one of `reattest-freeze.md`) and `tag_status: match`.
- [ ] **Step 2: Identity.** `deno task start harness validate` (the local tag now resolves) prints `[OK] 6 tasks, task set <hash>` with no `(provisional ...)` and loads `m4-qualify`. Quote it.
- [ ] **Step 3: Real pipeline, every variant.** For each entry of `qualify-manifest.json` run one `harness cell` with the named mock variant (positive, then each naive). Expected per judgment, checked on the raw judgment files, not only aggregate pass rates: positive `pass`, each naive `fail` with a scorer reason that names at least one oracle assertion failure (test-authoring: at least one surviving mutant); HX-002 target coverage `reference`, `mutant:0` and each named mutant; the judgment's artifact contains the submitted variant's files (hash of the variant folder recorded next to the judgment) and its task visible and oracle hashes equal the Step 2 identity. Record every campaign or cell id and judgment path in `H:\Temp3\harness-spike\M4\freeze\pipeline.md`. Any disagreement with Step 1 goes to `coord ask` with both files; neither side is edited to agree.
- [ ] **Step 4: Freeze record.** `H:\Temp3\harness-spike\M4\freeze\task-set.json`: `{ "refapp_version": "refapp-v1", "commit": "<sha>", "task_set_hash": "<hash>", "tasks": [{ "id", "gate_report", "promoted", "pipeline": [{ "variant", "judgment", "verdict", "expected" }] }] }`.
- [ ] **Step 5:** All six qualified: the orchestrator pushes `refapp-v1`. Any task not qualified: report to lane-content and the orchestrator at once; copy that candidate's reports to `H:\Temp3\harness-spike\M4\freeze\failed-<sha>\`, the unpushed local alias is deleted and the fixed commit is tagged instead. No real pipeline by 10-09, or fewer than six qualified: `coord ask` to the owner (launch contract).

**Acceptance:** `jq -e '[.tasks[] | select(.promoted and ([.pipeline[] | select(.verdict != .expected)] | length == 0))] | length == 6' task-set.json` exits 0; each task's `pipeline` has one entry per `qualify-manifest.json` variant; every gate report has `.source_commit` equal to the `refapp-v1` commit; `pipeline.md` quotes the non-provisional `validate` line.

---

## Integration check (orchestrator)

After each content task: `check` is `[OK]` for every task landed so far, and the latest audit (or re-attestation) of the new task names the committed task tree and ends `VERDICT: clean`. After each gate job: the common acceptance line, then tag `refapp-v1-rcN` at `.source_commit`. After M4-01c: the 35 gate unit tests pass. After M4-15: the freeze acceptance line, push of `refapp-v1`, `graphify update .`.

## Open questions

None left open in this plan. Round-2 rulings applied: M1-28 uses rc1 and M1-29 rc1 plus rc2 (cross-lane request 1), smoke codeunit 80000 kept for the M1-27 probe; the 10-02 date moved to 10-05 by the owner; lost-ASSERTERROR is an assertion and M1-16/M1-18 align (request 3); mock arms take named variants and `reference-tests/` as the test-authoring positive (request 2); mutant ids closed (request 4 updates the Part 1 wording); pilot accepted as a limited screen with the runner and egress conditions of M4-17. Closed in revision 2: reference-tests location, schema compatibility, baseline oracle compile failure, coverage (owner caveat), host compile, gate ownership, deletion, HX-001 premise, hidden regression rows, dates.

Unresolved cross-lane items go to `coord ask` (launch contract: no relabeling after the last review round): the four cross-lane requests above, and whether mutant scoring lands in the M1 slice by 10-08 (without it HX-002 cannot be real-pipeline qualified and M4-15 needs an owner exception).
