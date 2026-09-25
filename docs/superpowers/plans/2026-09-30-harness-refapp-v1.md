# Harness Bench Refapp v1 and Task Set (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the M0 refapp skeleton into refapp v1 and author six gated harness tasks (HX-001 to HX-006) that are qualified and frozen by 2026-10-09, with HX-001 complete and gated by 2026-10-01 so the 10-02 end-to-end gate has a task.

**Architecture:** lane-content writes AL only: refapp slices under `harness-tasks/refapp/`, and per task `task.yml`, `prompt.md`, `overlay/`, `oracle/`, `correct/`, `naive/`, and for the test-authoring task `mutants/` and `reference-tests/`. Every container run is a lane-ops job through one interim script, `scripts/harness/gate-task.ts`, that stages refapp + layers, compiles and publishes on a leased Cronus container, runs the listed tests over SOAP and writes a gate report under `H:\Temp3\harness-spike\M4\<task>\`. The same script has two container-free subcommands: `check` (static rules, the orchestrator's acceptance check) and `compile` (host `al compile` against the cached symbols, lane-content's fast loop). Tasks are authored one at a time because every slice edits shared refapp files; ops gates interleave.

**Tech Stack:** AL (BC 28, runtime 17.0, `NoImplicitWith`), Library Assert, the repo SOAP test harness (`infra/cg-test-harness`, TestIsolation = Codeunit), Deno + TypeScript for the gate script (`BcContainerProvider`, `runTestsViaSoap`, `loadTask` from M1-01), host AL Tools (`al compile`).

**Spec:** `docs/superpowers/specs/2026-09-24-harness-refapp-design.md` (1b, primary). Also 1a `docs/superpowers/specs/2026-09-24-harness-bench-design.md` sections 5-8 and 14, findings `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` sections 1, 2 and 8, the M1 plan `docs/superpowers/plans/2026-09-30-harness-core.md` (M1-01 schema), and the launch contract `docs/superpowers/runbooks/harness-autonomy/launch-contract.md`.

## Global Constraints

- lane-content never touches a container (launch contract, lane.md). Every compile/publish/test on a Cronus container is a lane-ops job named in this plan, run from a clean checkout of the named commit (`git worktree add H:\cg-coord\jobs\<id>-<n> <sha>`), with a lease, on Cronus281 to Cronus283 (lane.md: content gate runs).
- Host compile (`gate-task.ts compile`) runs the `al` dotnet tool on the host against the read-only BCH symbol cache. It starts no container and publishes nothing. It is a pre-check only; the container gate is authoritative.
- ID bands (1b section 4): refapp modules Core 70000-70099, Fleet 70100-70199, Rental 70200-70299, Leasing 70300-70399, Integration 70400-70499, Reporting 70500-70599; `Test` app 80000-84999; hidden oracles 85000-89999, HX-00N owns 85000+(N-1)*100 to 85099+(N-1)*100. Never 75000-79999.
- App ids are static: refapp `c6a1e000-0000-4000-8000-00000000000N` (existing), oracle of HX-00N `c6a1e000-0000-4000-8001-00000000000N`, name `CGR Oracle HX-00N`, publisher `CentralGauge`, dependencies only `CGR <module>` for modules in `fail_to_pass.depends_on` plus Library Assert. An oracle never depends on `CGR Test` (agent-editable).
- Every test codeunit (visible, oracle, reference, naive) has `Subtype = Test;` and `TestPermissions = Disabled;` (findings section 2, M0-01a).
- The SOAP harness runs with TestIsolation = Codeunit: data rolls back after each test codeunit, not after each procedure. Every procedure uses its own vehicle and contract keys and sets every Setup value it depends on.
- Oracles are hidden tests; the rules of CLAUDE.md "Writing AL Tests" apply in full: no placeholder assertions, every requirement in `prompt.md` is asserted, boundaries probed on both sides, interface behavior tested through an implementing codeunit.
- Prompts follow CLAUDE.md "Writing Task Specifications": ticket style, what to build or what users see, never how; required names and signatures are stated, AL rules and pitfalls are not. A prompt never names an oracle codeunit, procedure or mutant (checked by `gate-task.ts check`).
- The oracle tables in this plan are normative. An implemented oracle contains at least every row, with the same inputs and expected values. After the first gate run of a task, an oracle may change only to fix a defect the auditor or the owner confirmed; the change is recorded in `H:\Temp3\harness-spike\M4\<task>\oracle-changes.md` (what, why, who confirmed) and followed by a new auditor pass and a full re-gate. Removing a procedure, an assertion or loosening an expected value to get a green gate is forbidden (launch contract, "Forbidden without the owner").
- A slice that edits a refapp file which an earlier task's `overlay/`, `correct/`, `naive/` or `mutants/` replaces must re-derive those task files (slice change plus task change), re-pin that task to the new slice's rc tag, and have the slice's ops gate task re-gate it on the same commit. `check` flags every such file (Review Focus 5). Known case: slice D edits `RentalMgt`, which HX-003 replaces (M4-08 Step 9, M4-09).
- Keep tasks hard (CLAUDE.md, Benchmark Tasks). A gate failure caused by the task being too easy is redesigned, never softened.
- Refapp breadth stays at what HX-001 to HX-006 need. Number series, dimensions, API pages and the HTTP mock from 1b sections 2-3 are not built in M4 (cut order item 4 covers breadth beyond the six).
- Evidence (gate reports, auditor output, oracle change notes) goes to `H:\Temp3\harness-spike\M4\<task>\`. Nothing else outside the repo and the coord root.
- `deno fmt`, `deno check`, `deno lint` on changed `.ts` files only. `.al` files are not formatted by deno.
- No em dash in any committed text.
- Dates: content task N lands in the order below. A slip of more than one day against the 10-01 (HX-001) or 10-09 (six frozen) gates goes to the owner.

## Review Focus

1. **A listed oracle procedure never runs** (renamed, not discovered, zero tests after publish) and the gate counts it as a naive failure, so a task "discriminates" on nothing. Expected: a missing procedure is `missing`, never `fail`, and blocks promotion. Pinned in M4-01 (`setStatus: missing wins`, `decideGate: naive with a missing oracle procedure is refused`).
2. **A naive variant fails by compile error or by breaking the refapp build**, not by losing assertions (1b section 8). Expected: refused with the variant named. Pinned in M4-01 (`decideGate: naive compile failure is refused`).
3. **A flaky oracle** (fixed keys reused across procedures inside one codeunit, a Setup value inherited from an earlier procedure, `WorkDate` or `Today` dependence) passes once and fails on repeat. Expected: `correct/` must pass three fresh runs. Pinned in M4-01 (`decideGate: one flaky correct run blocks promotion`) and by the per-procedure key rule in every oracle table.
4. **A prompt leaks the oracle** (procedure names, oracle codeunit ids, mutant names), or an oracle or layer object sits outside its band. Expected: `check` fails. Pinned in M4-01 (`checkTask: prompt leak`, `checkTask: oracle id in visible band`, `checkTask: missing TestPermissions`).
5. **A later refapp slice edits a file that an earlier task's overlay or correct/ replaces**, so the earlier task silently reverts the slice or no longer starts green. Expected: `check` flags the drift against the task's pinned tag, and the freeze re-gates every task on the final commit. Pinned in M4-01 (`baseDrift: flags a replaced file that changed since the tag`) and M4-15.

## Decisions argued from the spec

- **Interim gate script, not the M1 pipeline.** 1b section 8 says the `mock` harness runs both solutions "through the real pipeline", but the verdict workspace, staging and mock harness are M1 Part 2 (M1 plan, "Part 2, after M0-08") and do not exist on 09-30. HX-001 must be gated by 10-01 (launch contract). So `gate-task.ts` implements the 1b section 8 checks directly, reusing the spike's publish path (`publishApp` for every app, never `prepareCandidateApp`, findings section 2 change 2). M4-15 re-runs each task through the mock harness when `harness cell` exists.
- **Gate expectations (1b section 8, 1a section 7).** Baseline (refapp + overlay): all seven apps build, `pass_to_pass` passes, `fail_to_pass` fails (a baseline oracle that does not compile against the unchanged refapp counts as failing: the oracle needs the change). `correct/`: every scorer passes. Each `naive/<x>`: all seven apps and the oracle build, and at least one listed oracle procedure runs and fails (the workbench `--strict-fail-mode` evidence rule, `src/workbench/probe.ts`). Test-authoring: reference tests pass on `correct/` and fail on mutant 0 (the staged state) and every listed mutant; each naive test suite passes on `correct/` and leaves at least one mutant alive.
- **Determinism** is not a separate 1b gate. It is added here because 1a D7 runs 3 repeats and records results per procedure (1a section 7): `correct/` (or the reference tests on `correct/`) runs 3 times, each naive 2 times, every run from a fresh prenuke.
- **Layer semantics** (1b section 5): `overlay/`, `correct/`, `naive/<x>/`, `mutants/<m>/`, `reference-tests/` mirror the workspace (`<Module>/src/...`) and replace or add files by relative path; nothing is deleted. A "removed feature" is expressed by replacing a file with its stubbed version. Order: refapp, overlay, correct, mutant, test suite.
- **Refapp versioning** (1b section 5, "git-tagged, resolved to an immutable commit"). A tag is never moved. Each task is gated against the commit it lands on, and the orchestrator tags that commit `refapp-v1-rcN` (N = task number) on acceptance; the task pins that tag. M4-14 re-pins all six to `refapp-v1`, tagged once, and M4-15 re-gates all six on it. Executions made before the freeze (the 10-02 end-to-end run) are pipeline proof, not campaign data.
- **Reference tests of the test-authoring task live in `reference-tests/`**, not in `correct/`: 1a section 7 resets production code to the reference sources for `mutant_kill`, so tests inside `correct/` would risk being handed to the verdict as if the agent wrote them. See Open questions 1.
- **Coupling tags** use the 1b section 3 edges: `events` (Rental -> Core), `internal` (Leasing -> Core), `interface` (strategy enum + interface across apps), `queries` (Reporting: table extensions, cross-app FlowFields, queries), `facade` (Integration facade + JSON), `ishandled` (Rental -> Fleet IsHandled events and the legacy direct call), `core-facade` (reaction through a Core publisher).

## Task set, coverage and schedule

| Task | Kind | Touches | Coupling | Author (content) | Gate (ops) | Target |
| --- | --- | --- | --- | --- | --- | --- |
| HX-001 | bugfix | Rental, Fleet, Core | events, core-facade | M4-02 | M4-03 | 10-01 |
| HX-002 | test-authoring | Leasing, Core, Test | internal | M4-04 | M4-05 | 10-02 |
| HX-003 | feature | Fleet, Rental, Core | ishandled, interface | M4-06 | M4-07 | 10-03 |
| HX-004 | feature | Reporting, Leasing, Rental | queries, internal | M4-08 | M4-09 | 10-05 |
| HX-005 | refactor | Rental | interface | M4-10 | M4-11 | 10-06 |
| HX-006 | feature | Integration, Core | facade, events, core-facade | M4-12 | M4-13 | 10-07 |
| freeze | | | | M4-14 | M4-15 | 10-08 to 10-09 |

Kinds: every 1b kind at least once. Coupling styles used by two tasks: events, core-facade, internal, interface. Used once: ishandled, queries, facade (1b section 9 asks two per style for the ~10-task v1; see Open questions 4). In-app styles: posting codeunit chain (HX-004, HX-005), event subscriber instance mode (manual binding in HX-003), temporary state none (Open questions 4).

HX-002 is second on purpose: 1a section 12 item 6 needs a test-authoring task to prove `mutant_kill` in M1.

## File Structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `scripts/harness/gate-task.ts` | `check`, `compile`, `gate` for one task | M4-01 |
| `tests/unit/harness/gate-task.test.ts` | pure parts of the gate script | M4-01 |
| `harness-tasks/refapp/<Module>/src/*.al` | refapp v1, grown per slice | M4-02, 04, 06, 08, 10, 12 |
| `harness-tasks/refapp/Test/src/*.al` | visible tests and test library | same |
| `harness-tasks/tasks/HX-00N/task.yml` | M1-01 schema | per task |
| `harness-tasks/tasks/HX-00N/prompt.md` | ticket text | per task |
| `harness-tasks/tasks/HX-00N/overlay/` | injected bug or starting state | per task |
| `harness-tasks/tasks/HX-00N/oracle/` | hidden test app (`app.json`, `src/`) | f2p tasks |
| `harness-tasks/tasks/HX-00N/correct/` | reference solution | per task |
| `harness-tasks/tasks/HX-00N/naive/<x>/` | plausible wrong solutions, at least two | per task |
| `harness-tasks/tasks/HX-002/mutants/<m>/`, `reference-tests/` | test-authoring only | M4-04 |
| `H:\Temp3\harness-spike\M4\HX-00N\` | `gate-*.json`, `audit-*.md`, `oracle-changes.md` | evidence |

---

### Task M4-01: gate script (`check`, `compile`, `gate`)

**Lane:** ops. **Deps:** M1-01 (`loadTask`, `HarnessTaskSchema`). **Target:** 09-30.

Spec 1b section 8 (the gate), 1a section 7 (mutant 0, zero tests is infra), findings section 2 (publish every app with `publishApp`; `prepareCandidateApp` cleanup removes refapp dependencies), findings section 6 (`al compile` offline).

**Files:**
- Create: `scripts/harness/gate-task.ts`
- Test: `tests/unit/harness/gate-task.test.ts`

**Interfaces:**
- Consumes: `loadTask(dir): Promise<LoadedTask>`, `HarnessTaskSchema`, `type HarnessTask`, `type LoadedTask` (M1-01); `BcContainerProvider` (`setCredentials`, `isHealthy`, `ensureTestHarness`, `prenukeCentralGaugeApps`, `compileProject`, `publishApp`, `dispose`); `runTestsViaSoap`, `resolveSoapTimeoutMs`, `type SoapTestRunnerConfig` (`src/container/soap-test-client.ts`).
- Produces (CLI, used by every later task):
  - `deno run --allow-all scripts/harness/gate-task.ts check <taskDir>...` exit 0 when every task passes the static rules (warnings allowed).
  - `deno run --allow-all scripts/harness/gate-task.ts compile <taskDir> <variant>` host compile of a staged variant; `<variant>` is `baseline`, `correct`, `naive/<x>`, or `tests:<suite>@<mutant|correct>`.
  - `deno run --allow-all scripts/harness/gate-task.ts gate <container> <taskDir>` writes `H:\Temp3\harness-spike\M4\<id>\gate-<stamp>.json` with `{ task, commit, container, refapp_version, at, promoted, reasons, runs[] }`; exit 0 promoted, 1 not promoted, 3 infra.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/gate-task.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import type { GateRun, RunSummary, Variant } from "../../../scripts/harness/gate-task.ts";
import {
  checkTask,
  decideGate,
  gatePlan,
  layers,
  parseVariant,
  setStatus,
  stageWorkspace,
  testCodeunitsIn,
} from "../../../scripts/harness/gate-task.ts";
import { HarnessTaskSchema, loadTask } from "../../../src/harness/task.ts";

async function write(root: string, rel: string, text: string): Promise<void> {
  await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
  await Deno.writeTextFile(join(root, rel), text);
}

const F2P = HarnessTaskSchema.parse({
  id: "HX-001",
  refapp_version: "refapp-v1-rc1",
  kind: "bugfix",
  prompt: "prompt.md",
  source: "refapp",
  scorers: ["build", "pass_to_pass", "fail_to_pass"],
  pass_to_pass: [{ codeunit: 80010, procedures: ["Visible"] }],
  fail_to_pass: {
    depends_on: ["Core"],
    tests: [{ codeunit: 85000, procedures: ["Hidden"] }],
  },
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

const S = (o: Partial<RunSummary>): RunSummary => ({
  build: true,
  p2p: "pass",
  oracleBuild: null,
  f2p: null,
  own: null,
  ...o,
});
const run = (variant: Variant, summary: RunSummary, repeat = 1): GateRun => ({
  variant,
  repeat,
  summary,
});
function f2pHappy(): GateRun[] {
  return [
    run({ kind: "baseline" }, S({ oracleBuild: true, f2p: "fail" })),
    ...[1, 2, 3].map((i) =>
      run({ kind: "correct" }, S({ oracleBuild: true, f2p: "pass" }), i)
    ),
    ...["a", "b"].flatMap((name) =>
      [1, 2].map((i) =>
        run({ kind: "naive", name }, S({ oracleBuild: true, f2p: "fail" }), i)
      )
    ),
  ];
}
function taHappy(): GateRun[] {
  const t = (suite: string, mutant: string | null, own: RunSummary["own"], i = 1) =>
    run({ kind: "tests", suite, mutant }, S({ own }), i);
  return [
    run({ kind: "baseline" }, S({})),
    t("reference-tests", null, "pass", 1),
    t("reference-tests", null, "pass", 2),
    t("reference-tests", null, "pass", 3),
    t("reference-tests", "m0", "fail"),
    t("reference-tests", "m1", "fail"),
    ...["naive/a", "naive/b"].flatMap((s) => [
      t(s, null, "pass"),
      t(s, "m0", "fail"),
      t(s, "m1", "pass"),
    ]),
  ];
}

Deno.test("layers: order refapp < overlay < correct < mutant < suite", () => {
  assertEquals(layers({ kind: "baseline" }), ["overlay"]);
  assertEquals(layers({ kind: "correct" }), ["overlay", "correct"]);
  assertEquals(layers({ kind: "naive", name: "x" }), ["overlay", "naive/x"]);
  assertEquals(
    layers({ kind: "tests", suite: "reference-tests", mutant: "m0" }),
    ["overlay", "reference-tests"],
  );
  assertEquals(
    layers({ kind: "tests", suite: "naive/x", mutant: "m1" }),
    ["overlay", "correct", "mutants/m1", "naive/x"],
  );
});

Deno.test("parseVariant: round trips the CLI spellings", () => {
  assertEquals(parseVariant("correct"), { kind: "correct" });
  assertEquals(parseVariant("naive/skip"), { kind: "naive", name: "skip" });
  assertEquals(parseVariant("tests:reference-tests@correct"), {
    kind: "tests",
    suite: "reference-tests",
    mutant: null,
  });
  assertEquals(parseVariant("tests:naive/a@m0"), {
    kind: "tests",
    suite: "naive/a",
    mutant: "m0",
  });
});

Deno.test("stageWorkspace: later layers win, build output skipped, layer outside a module refused", async () => {
  const root = await Deno.makeTempDir();
  const refapp = join(root, "refapp");
  const task = join(root, "task");
  await write(refapp, "Core/app.json", "{}");
  await write(refapp, "Core/src/A.al", "base");
  await write(refapp, "Core/.alpackages/x.app", "bin");
  await write(task, "overlay/Core/src/A.al", "bug");
  await write(task, "correct/Core/src/A.al", "fix");
  await write(task, "correct/Core/src/B.al", "new");
  const out = join(root, "out");
  await stageWorkspace(refapp, task, ["overlay", "correct"], out);
  assertEquals(await Deno.readTextFile(join(out, "Core/src/A.al")), "fix");
  assertEquals(await Deno.readTextFile(join(out, "Core/src/B.al")), "new");
  await assertRejects(() => Deno.stat(join(out, "Core/.alpackages/x.app")));
  await write(task, "naive/bad/Elsewhere/x.al", "x");
  await assertRejects(
    () => stageWorkspace(refapp, task, ["naive/bad"], join(root, "o2")),
    Error,
    "module folder",
  );
});

Deno.test("testCodeunitsIn: only Subtype = Test codeunits", async () => {
  const root = await Deno.makeTempDir();
  await write(root, "Test/src/T.al", "codeunit 80100 \"T\"\n{\n    Subtype = Test;\n}\n");
  await write(root, "Test/src/L.al", "codeunit 80101 \"L\"\n{\n}\n");
  assertEquals(await testCodeunitsIn(root), [80100]);
});

Deno.test("setStatus: missing wins over fail", () => {
  const refs = [{ codeunit: 85000, procedures: ["A", "B"] }];
  assertEquals(
    setStatus([{ codeunit: 85000, procedure: "A", passed: false }], refs),
    "missing",
  );
  assertEquals(
    setStatus([
      { codeunit: 85000, procedure: "A", passed: false },
      { codeunit: 85000, procedure: "B", passed: true },
    ], refs),
    "fail",
  );
});

Deno.test("decideGate: happy f2p task is promoted", () => {
  assertEquals(decideGate(F2P, f2pHappy()), { promoted: true, reasons: [] });
});

const F2P_BAD: Array<[string, (r: GateRun[]) => void, string]> = [
  ["one flaky correct run blocks promotion", (r) => {
    r[2]!.summary = S({ oracleBuild: true, f2p: "fail" });
  }, "correct/"],
  ["naive compile failure is refused", (r) => {
    r[4]!.summary = S({ build: false });
  }, "naive/a"],
  ["naive with a missing oracle procedure is refused", (r) => {
    r[5]!.summary = S({ oracleBuild: true, f2p: "missing" });
  }, "naive/a"],
  ["baseline that already passes the oracle is refused", (r) => {
    r[0]!.summary = S({ oracleBuild: true, f2p: "pass" });
  }, "baseline"],
  ["only one naive variant is refused", (r) => {
    r.splice(6, 2);
  }, "fewer than two"],
];
for (const [name, mutate, needle] of F2P_BAD) {
  Deno.test(`decideGate: ${name}`, () => {
    const runs = f2pHappy();
    mutate(runs);
    const d = decideGate(F2P, runs);
    assertEquals(d.promoted, false);
    assert(d.reasons.some((x) => x.includes(needle)), d.reasons.join("; "));
  });
}

Deno.test("decideGate: baseline oracle that does not compile counts as failing", () => {
  const runs = f2pHappy();
  runs[0]!.summary = S({ oracleBuild: false });
  assertEquals(decideGate(F2P, runs).promoted, true);
});

Deno.test("decideGate: test-authoring happy path, surviving mutant, over-strong naive", () => {
  assertEquals(decideGate(TA, taHappy()).promoted, true);
  const survivor = taHappy();
  survivor[5]!.summary = S({ own: "pass" });
  assert(decideGate(TA, survivor).reasons.some((x) => x.includes("mutant m1")));
  const strong = taHappy();
  strong[8]!.summary = S({ own: "fail" });
  assert(decideGate(TA, strong).reasons.some((x) => x.includes("naive/a")));
});

Deno.test("gatePlan: run counts", () => {
  assertEquals(gatePlan(F2P, ["a", "b"]).length, 1 + 3 + 2 * 2);
  assertEquals(gatePlan(TA, ["a", "b"]).length, 1 + 3 + 2 + 2 * 3);
});

async function fixtureTask(root: string, promptText: string): Promise<string> {
  const refapp = join(root, "harness-tasks/refapp");
  await write(refapp, "Core/app.json", "{}");
  await write(refapp, "Core/src/A.al", "codeunit 70000 \"A\"\n{\n}\n");
  await write(
    refapp,
    "Test/src/V.al",
    "codeunit 80010 \"V\"\n{\n    Subtype = Test;\n    TestPermissions = Disabled;\n    [Test]\n    procedure Visible()\n    begin\n    end;\n}\n",
  );
  const dir = join(root, "harness-tasks/tasks/HX-001");
  await write(dir, "task.yml", `id: HX-001
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
    publisher: "CentralGauge",
    idRanges: [{ from: 85000, to: 85099 }],
    dependencies: [{ name: "CGR Core" }, { name: "Library Assert" }],
  }));
  await write(
    dir,
    "oracle/src/O.al",
    "codeunit 85000 \"O\"\n{\n    Subtype = Test;\n    TestPermissions = Disabled;\n    [Test]\n    procedure Hidden()\n    begin\n    end;\n}\n",
  );
  await write(dir, "overlay/Core/src/A.al", "codeunit 70000 \"A\"\n{\n}\n");
  await write(dir, "correct/Core/src/A.al", "codeunit 70000 \"A\"\n{\n}\n");
  await write(dir, "naive/x/Core/src/A.al", "codeunit 70000 \"A\"\n{\n}\n");
  await write(dir, "naive/y/Core/src/A.al", "codeunit 70000 \"A\"\n{\n}\n");
  return dir;
}

Deno.test("checkTask: clean fixture has no problems", async () => {
  const root = await Deno.makeTempDir();
  const dir = await fixtureTask(root, "# Bug\nReturns fail.\n");
  const { problems } = await checkTask(await loadTask(dir), join(root, "harness-tasks/refapp"), root);
  assertEquals(problems, []);
});

Deno.test("checkTask: prompt leak, oracle id in visible band, missing TestPermissions, one naive", async () => {
  const root = await Deno.makeTempDir();
  const dir = await fixtureTask(root, "Make Hidden pass.\n");
  await write(dir, "oracle/src/P.al", "codeunit 80001 \"P\"\n{\n    Subtype = Test;\n}\n");
  await Deno.remove(join(dir, "naive/y"), { recursive: true });
  const { problems } = await checkTask(await loadTask(dir), join(root, "harness-tasks/refapp"), root);
  const all = problems.join("\n");
  assertStringIncludes(all, "hidden name Hidden");
  assertStringIncludes(all, "object id 80001 outside Oracle");
  assertStringIncludes(all, "TestPermissions");
  assertStringIncludes(all, "at least two");
});

Deno.test("baseDrift: flags a replaced file that changed since the tag", async () => {
  const root = await Deno.makeTempDir();
  const dir = await fixtureTask(root, "# Bug\n");
  const git = (...args: string[]) =>
    new Deno.Command("git", { args, cwd: root, stdout: "null", stderr: "null" }).output();
  await git("init", "-q");
  await git("add", "-A");
  await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x");
  await git("tag", "refapp-v1-rc1");
  await write(join(root, "harness-tasks/refapp"), "Core/src/A.al", "codeunit 70000 \"A\"\n{\n    // slice\n}\n");
  const { problems } = await checkTask(await loadTask(dir), join(root, "harness-tasks/refapp"), root);
  assert(problems.some((p) => p.includes("changed since refapp-v1-rc1")), problems.join("; "));
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/gate-task.test.ts`
Expected: FAIL, `Module not found ".../scripts/harness/gate-task.ts"`.

- [ ] **Step 3: Implement**

`scripts/harness/gate-task.ts`:

```typescript
// Interim authoring gate for harness tasks (spec 1b section 8). Used until the
// M1 Part 2 mock harness runs task solutions through the real verdict
// pipeline; M4-15 cross-checks against that pipeline when it exists.
//
//   gate-task.ts check <taskDir>...              static rules, no container
//   gate-task.ts compile <taskDir> <variant>      host al compile, no container
//   gate-task.ts gate <container> <taskDir>       lane-ops container job
import * as colors from "@std/fmt/colors";
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import type { ALProject } from "../../src/container/types.ts";
import type { SoapTestRunnerConfig } from "../../src/container/soap-test-client.ts";
import type { HarnessTask, LoadedTask } from "../../src/harness/task.ts";
import { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import {
  resolveSoapTimeoutMs,
  runTestsViaSoap,
} from "../../src/container/soap-test-client.ts";
import { loadTask } from "../../src/harness/task.ts";

export const BUILD_ORDER = [
  "Core",
  "Fleet",
  "Rental",
  "Leasing",
  "Integration",
  "Reporting",
  "Test",
];
/** Spec 1b section 4. Oracle is the hidden test app of a task. */
export const RANGES: Record<string, [number, number]> = {
  Core: [70000, 70099],
  Fleet: [70100, 70199],
  Rental: [70200, 70299],
  Leasing: [70300, 70399],
  Integration: [70400, 70499],
  Reporting: [70500, 70599],
  Test: [80000, 84999],
  Oracle: [85000, 89999],
};
const CORRECT_RUNS = 3;
const NAIVE_RUNS = 2;
const EVIDENCE_ROOT = "H:\\Temp3\\harness-spike\\M4";
const SYMBOLS = Deno.env.get("CG_AL_SYMBOLS") ??
  "C:\\ProgramData\\BcContainerHelper\\compiler-cache-15ff3c5d109b\\symbols";

export type Variant =
  | { kind: "baseline" }
  | { kind: "correct" }
  | { kind: "naive"; name: string }
  /** Test-authoring: a test suite on correct code (mutant null), the staged state ("m0") or a mutant. */
  | { kind: "tests"; suite: string; mutant: string | null };

export function variantName(v: Variant): string {
  switch (v.kind) {
    case "baseline":
    case "correct":
      return v.kind;
    case "naive":
      return `naive/${v.name}`;
    case "tests":
      return `tests:${v.suite}@${v.mutant ?? "correct"}`;
  }
}

export function parseVariant(s: string): Variant {
  if (s === "baseline" || s === "correct") return { kind: s };
  if (s.startsWith("naive/")) return { kind: "naive", name: s.slice(6) };
  const m = s.match(/^tests:(.+)@(.+)$/);
  if (m) {
    return {
      kind: "tests",
      suite: m[1]!,
      mutant: m[2] === "correct" ? null : m[2]!,
    };
  }
  throw new Error(`unknown variant ${s}`);
}

/** Layer folders over the refapp snapshot, in order (spec 1a section 7: mutant 0 = staged state). */
export function layers(v: Variant): string[] {
  switch (v.kind) {
    case "baseline":
      return ["overlay"];
    case "correct":
      return ["overlay", "correct"];
    case "naive":
      return ["overlay", `naive/${v.name}`];
    case "tests":
      if (v.mutant === "m0") return ["overlay", v.suite];
      if (v.mutant === null) return ["overlay", "correct", v.suite];
      return ["overlay", "correct", `mutants/${v.mutant}`, v.suite];
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

async function subdirs(p: string): Promise<string[]> {
  if (!(await exists(p))) return [];
  const out: string[] = [];
  for await (const e of Deno.readDir(p)) if (e.isDirectory) out.push(e.name);
  return out.sort();
}

/** Copy files by relative path. Refuses links, skips build output. */
async function copyTree(src: string, dst: string, moduleRooted: boolean) {
  for await (const e of walk(src, { followSymlinks: false })) {
    if (e.isSymlink) throw new Error(`link refused: ${e.path}`);
    if (!e.isFile) continue;
    const rel = relative(src, e.path);
    const parts = rel.split(/[\\/]/);
    if (
      parts.includes(".alpackages") || parts.includes("output") ||
      rel.toLowerCase().endsWith(".app")
    ) continue;
    if (moduleRooted && !BUILD_ORDER.includes(parts[0]!)) {
      throw new Error(`${e.path}: layer files must sit under a module folder`);
    }
    await Deno.mkdir(dirname(join(dst, rel)), { recursive: true });
    await Deno.copyFile(e.path, join(dst, rel));
  }
}

/** Refapp modules, then each layer folder over them (spec 1b section 5). */
export async function stageWorkspace(
  refappDir: string,
  taskDir: string,
  layerDirs: string[],
  out: string,
): Promise<void> {
  for (const m of BUILD_ORDER) {
    await copyTree(join(refappDir, m), join(out, m), false);
  }
  for (const l of layerDirs) {
    const src = join(taskDir, l);
    if (!(await exists(src))) {
      if (l === "overlay") continue; // a feature may start from the plain refapp
      throw new Error(`layer folder missing: ${l}`);
    }
    await copyTree(src, out, true);
  }
}

const OBJECT_RE =
  /^\s*(table|tableextension|page|pageextension|codeunit|report|reportextension|query|xmlport|enum|enumextension|permissionset|permissionsetextension)\s+(\d+)\s/gim;
export function objectIds(al: string): number[] {
  return [...al.matchAll(OBJECT_RE)].map((m) => Number(m[2]));
}
const isTestCodeunit = (al: string) => /Subtype\s*=\s*Test\s*;/i.test(al);

export async function testCodeunitsIn(dir: string): Promise<number[]> {
  const ids: number[] = [];
  for await (const e of walk(dir, { exts: [".al"], followSymlinks: false })) {
    if (!e.isFile) continue;
    const text = await Deno.readTextFile(e.path);
    if (isTestCodeunit(text)) ids.push(...objectIds(text));
  }
  return ids.sort((a, b) => a - b);
}

export interface ProcResult {
  codeunit: number;
  procedure: string;
  passed: boolean;
  message?: string;
}
export interface RunResult {
  variant: string;
  usesOracle: boolean;
  ownCodeunits: number[];
  builds: { app: string; ok: boolean; detail?: string }[];
  tests: ProcResult[];
}
export type SetStatus = "pass" | "fail" | "missing";
export interface RunSummary {
  build: boolean;
  p2p: SetStatus;
  oracleBuild: boolean | null;
  f2p: SetStatus | null;
  own: SetStatus | null;
}
type Ref = { codeunit: number; procedures: string[] };

/** A listed procedure that never ran is infra (GH #13 zero-tests rule), never a fail. */
export function setStatus(tests: ProcResult[], refs: Ref[]): SetStatus {
  const found = refs.flatMap((r) =>
    r.procedures.map((p) =>
      tests.find((t) => t.codeunit === r.codeunit && t.procedure === p)
    )
  );
  if (found.some((t) => t === undefined)) return "missing";
  return found.every((t) => t?.passed) ? "pass" : "fail";
}

export function summarize(task: HarnessTask, run: RunResult): RunSummary {
  const built = (app: string) =>
    run.builds.some((b) => b.app === app && b.ok);
  const own = run.tests.filter((t) => run.ownCodeunits.includes(t.codeunit));
  return {
    build: BUILD_ORDER.every(built),
    p2p: setStatus(run.tests, task.pass_to_pass),
    oracleBuild: run.usesOracle ? built("Oracle") : null,
    f2p: run.usesOracle && task.fail_to_pass && built("Oracle")
      ? setStatus(run.tests, task.fail_to_pass.tests)
      : null,
    own: run.ownCodeunits.length === 0
      ? null
      : own.length === 0
      ? "missing"
      : own.every((t) => t.passed)
      ? "pass"
      : "fail",
  };
}

export interface GateRun {
  variant: Variant;
  repeat: number;
  summary: RunSummary;
}

export function gatePlan(
  task: HarnessTask,
  naive: string[],
): { variant: Variant; repeat: number }[] {
  const plan: { variant: Variant; repeat: number }[] = [];
  const add = (variant: Variant, n: number) => {
    for (let i = 1; i <= n; i++) plan.push({ variant, repeat: i });
  };
  add({ kind: "baseline" }, 1);
  if (task.kind !== "test-authoring") {
    add({ kind: "correct" }, CORRECT_RUNS);
    for (const name of naive) add({ kind: "naive", name }, NAIVE_RUNS);
    return plan;
  }
  const mutants = ["m0", ...task.mutants];
  add({ kind: "tests", suite: "reference-tests", mutant: null }, CORRECT_RUNS);
  for (const m of mutants) {
    add({ kind: "tests", suite: "reference-tests", mutant: m }, 1);
  }
  for (const name of naive) {
    add({ kind: "tests", suite: `naive/${name}`, mutant: null }, 1);
    for (const m of mutants) {
      add({ kind: "tests", suite: `naive/${name}`, mutant: m }, 1);
    }
  }
  return plan;
}

/** Spec 1b section 8 gate, plus three correct runs for determinism. */
export function decideGate(
  task: HarnessTask,
  runs: GateRun[],
): { promoted: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const need = (ok: boolean, why: string) => {
    if (!ok) reasons.push(why);
  };
  const base = runs.filter((r) => r.variant.kind === "baseline");
  if (task.kind !== "test-authoring") {
    need(
      base.length > 0 &&
        base.every(({ summary: s }) =>
          s.build && s.p2p === "pass" &&
          (s.oracleBuild === false || s.f2p === "fail")
        ),
      "baseline must build, pass pass_to_pass and fail fail_to_pass",
    );
    const correct = runs.filter((r) => r.variant.kind === "correct");
    need(
      correct.length >= CORRECT_RUNS &&
        correct.every(({ summary: s }) =>
          s.build && s.p2p === "pass" && s.oracleBuild === true &&
          s.f2p === "pass"
        ),
      `correct/ must pass every scorer in all ${CORRECT_RUNS} runs`,
    );
    const names = [
      ...new Set(
        runs.flatMap((r) => r.variant.kind === "naive" ? [r.variant.name] : []),
      ),
    ];
    need(names.length >= 2, "fewer than two naive variants (spec 1b section 8)");
    for (const name of names) {
      const rs = runs.filter((r) =>
        r.variant.kind === "naive" && r.variant.name === name
      );
      need(
        rs.length >= NAIVE_RUNS &&
          rs.every(({ summary: s }) =>
            s.build && s.oracleBuild === true && s.f2p === "fail"
          ),
        `naive/${name} must build and lose oracle assertions in all ${NAIVE_RUNS} runs`,
      );
    }
    return { promoted: reasons.length === 0, reasons };
  }
  need(
    base.length > 0 &&
      base.every(({ summary: s }) => s.build && s.p2p === "pass"),
    "baseline must build and pass pass_to_pass",
  );
  const suiteRuns = (suite: string, mutant: string | null | undefined) =>
    runs.filter((r) =>
      r.variant.kind === "tests" && r.variant.suite === suite &&
      (mutant === undefined
        ? r.variant.mutant !== null
        : r.variant.mutant === mutant)
    );
  const ref = suiteRuns("reference-tests", null);
  need(
    ref.length >= CORRECT_RUNS &&
      ref.every(({ summary: s }) =>
        s.build && s.p2p === "pass" && s.own === "pass"
      ),
    `reference tests must pass on correct/ in all ${CORRECT_RUNS} runs`,
  );
  for (const m of ["m0", ...task.mutants]) {
    const rs = suiteRuns("reference-tests", m);
    need(
      rs.length > 0 &&
        rs.every(({ summary: s }) => s.build && s.own === "fail"),
      `reference tests must kill mutant ${m}`,
    );
  }
  const naive = [
    ...new Set(
      runs.flatMap((r) =>
        r.variant.kind === "tests" && r.variant.suite.startsWith("naive/")
          ? [r.variant.suite]
          : []
      ),
    ),
  ];
  need(naive.length >= 2, "fewer than two naive variants (spec 1b section 8)");
  for (const suite of naive) {
    const onCorrect = suiteRuns(suite, null);
    need(
      onCorrect.length > 0 &&
        onCorrect.every(({ summary: s }) => s.build && s.own === "pass"),
      `${suite} must pass on correct/, or it fails for the wrong reason`,
    );
    need(
      suiteRuns(suite, undefined).some(({ summary: s }) =>
        s.build && s.own === "pass"
      ),
      `${suite} must leave at least one mutant alive`,
    );
  }
  return { promoted: reasons.length === 0, reasons };
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "null",
  }).output();
  return { ok: r.success, out: new TextDecoder().decode(r.stdout) };
}
const eol = (s: string) => s.replaceAll("\r\n", "\n");

interface AlFile {
  file: string;
  source: string;
  module: string;
  text: string;
}

/** Static rules. Problems block; warnings do not. */
export async function checkTask(
  loaded: LoadedTask,
  refappDir: string,
  repoRoot: string,
): Promise<{ problems: string[]; warnings: string[] }> {
  const { task, dir } = loaded;
  const problems: string[] = [];
  const warnings: string[] = [];
  const naive = await subdirs(join(dir, "naive"));
  if (naive.length < 2) {
    problems.push("naive/ needs at least two variants (spec 1b section 8)");
  }
  if (task.mutants.includes("m0")) {
    problems.push("mutant name m0 is reserved for the staged state");
  }
  const testAuthoring = task.kind === "test-authoring";
  if (testAuthoring && !(await exists(join(dir, "reference-tests")))) {
    problems.push("test-authoring needs reference-tests/");
  }

  const scan: [string, string | null][] = [
    ["oracle", "Oracle"],
    ["overlay", null],
    ["correct", null],
    ["reference-tests", null],
    ...naive.map((n): [string, null] => [`naive/${n}`, null]),
    ...task.mutants.map((m): [string, null] => [`mutants/${m}`, null]),
  ];
  const files: AlFile[] = [];
  for (const m of BUILD_ORDER) {
    const root = join(refappDir, m);
    if (!(await exists(root))) continue;
    for await (const e of walk(root, { exts: [".al"], followSymlinks: false })) {
      if (!e.isFile) continue;
      files.push({
        file: join("refapp", m, relative(root, e.path)),
        source: "refapp",
        module: m,
        text: await Deno.readTextFile(e.path),
      });
    }
  }
  for (const [rel, fixed] of scan) {
    const root = join(dir, rel);
    if (!(await exists(root))) continue;
    for await (const e of walk(root, { exts: [".al"], followSymlinks: false })) {
      if (!e.isFile) continue;
      const inner = relative(root, e.path);
      files.push({
        file: join(rel, inner),
        source: rel,
        module: fixed ?? inner.split(/[\\/]/)[0]!,
        text: await Deno.readTextFile(e.path),
      });
    }
  }
  for (const f of files) {
    const range = RANGES[f.module];
    if (!range) {
      problems.push(`${f.file}: not under a module folder`);
      continue;
    }
    for (const id of objectIds(f.text)) {
      if (id < range[0] || id > range[1]) {
        problems.push(
          `${f.file}: object id ${id} outside ${f.module} range ${range[0]}-${range[1]}`,
        );
      }
    }
    if (
      isTestCodeunit(f.text) && !/TestPermissions\s*=\s*Disabled\s*;/i.test(f.text)
    ) {
      problems.push(`${f.file}: test codeunit without TestPermissions = Disabled`);
    }
    if (/Assert\.(IsTrue\(\s*true|IsFalse\(\s*false)\b/i.test(f.text)) {
      problems.push(`${f.file}: placeholder assertion`);
    }
    if (
      testAuthoring &&
      (f.source === "reference-tests" || f.source.startsWith("naive/")) &&
      f.module !== "Test"
    ) {
      problems.push(`${f.file}: test-authoring suites add files under Test/ only`);
    }
  }

  const declares = (pool: AlFile[], codeunit: number, proc: string) =>
    pool.some((f) =>
      objectIds(f.text)[0] === codeunit &&
      new RegExp(`procedure\\s+${proc}\\s*\\(`, "i").test(f.text)
    );
  const visible = files.filter((f) =>
    f.module === "Test" && (f.source === "refapp" || f.source === "overlay")
  );
  for (const r of task.pass_to_pass) {
    for (const p of r.procedures) {
      if (!declares(visible, r.codeunit, p)) {
        problems.push(`pass_to_pass ${r.codeunit}.${p} not found in shipped tests`);
      }
    }
  }
  const hidden: string[] = [...task.mutants];
  if (task.fail_to_pass) {
    const oracle = files.filter((f) => f.module === "Oracle");
    for (const r of task.fail_to_pass.tests) {
      hidden.push(String(r.codeunit), ...r.procedures);
      for (const p of r.procedures) {
        if (!declares(oracle, r.codeunit, p)) {
          problems.push(`fail_to_pass ${r.codeunit}.${p} not found in oracle/`);
        }
      }
    }
    if (task.fail_to_pass.depends_on.includes("Test")) {
      problems.push("oracle must not depend on the agent-editable Test app");
    }
    const app = JSON.parse(
      await Deno.readTextFile(join(dir, "oracle", "app.json")),
    ) as {
      publisher?: string;
      idRanges?: { from: number; to: number }[];
      dependencies?: { name: string }[];
    };
    const allowed = new Set([
      ...task.fail_to_pass.depends_on.map((m) => `CGR ${m}`),
      "Library Assert",
    ]);
    for (const d of app.dependencies ?? []) {
      if (!allowed.has(d.name)) {
        problems.push(`oracle/app.json: dependency ${d.name} not in depends_on`);
      }
    }
    if (app.publisher !== "CentralGauge") {
      problems.push("oracle/app.json: publisher must be CentralGauge");
    }
    for (const r of app.idRanges ?? []) {
      if (r.from < 85000 || r.to > 89999) {
        problems.push("oracle/app.json: idRanges outside 85000-89999");
      }
    }
  }
  const prompt = await Deno.readTextFile(join(dir, task.prompt));
  for (const h of hidden) {
    if (new RegExp(`\\b${h}\\b`).test(prompt)) {
      problems.push(`prompt.md mentions hidden name ${h}`);
    }
  }
  if (/\b(oracle|mutants?)\b/i.test(prompt)) {
    problems.push("prompt.md mentions the oracle or mutants");
  }

  const tag = task.refapp_version;
  if (!(await git(repoRoot, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`])).ok) {
    warnings.push(`refapp_version ${tag} does not resolve yet (tagged on acceptance)`);
  } else {
    for (const f of files) {
      if (f.source === "refapp" || f.module === "Oracle") continue;
      const inner = f.file.slice(f.source.length + 1).replaceAll("\\", "/");
      const current = join(refappDir, inner);
      if (!(await exists(current))) continue;
      const atTag = await git(repoRoot, [
        "show",
        `${tag}:harness-tasks/refapp/${inner}`,
      ]);
      if (
        atTag.ok && eol(atTag.out) !== eol(await Deno.readTextFile(current))
      ) {
        problems.push(`${f.file}: refapp base changed since ${tag}`);
      }
    }
  }
  return { problems, warnings };
}

interface Ctx {
  provider: BcContainerProvider;
  container: string;
  soap: SoapTestRunnerConfig;
  refapp: string;
}

async function loadProject(dir: string): Promise<ALProject> {
  const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
  const sourceFiles: string[] = [];
  for await (
    const e of walk(join(dir, "src"), { exts: [".al"], followSymlinks: false })
  ) if (e.isFile) sourceFiles.push(e.path);
  return { path: dir, appJson, sourceFiles, testFiles: [] };
}

async function stageVariant(
  loaded: LoadedTask,
  refapp: string,
  v: Variant,
  ws: string,
): Promise<{ apps: string[]; usesOracle: boolean }> {
  await stageWorkspace(refapp, loaded.dir, layers(v), ws);
  const usesOracle = loaded.task.fail_to_pass !== null && v.kind !== "tests";
  if (usesOracle) {
    await copyTree(join(loaded.dir, "oracle"), join(ws, "Oracle"), false);
  }
  return {
    apps: usesOracle ? [...BUILD_ORDER, "Oracle"] : BUILD_ORDER,
    usesOracle,
  };
}

async function runVariant(
  ctx: Ctx,
  loaded: LoadedTask,
  v: Variant,
): Promise<RunResult> {
  const { task, dir } = loaded;
  const ws = await Deno.makeTempDir({ prefix: `cg-harness-gate-${task.id}-` });
  try {
    const { apps, usesOracle } = await stageVariant(loaded, ctx.refapp, v, ws);
    const own = v.kind === "tests" ? await testCodeunitsIn(join(dir, v.suite)) : [];
    const result: RunResult = {
      variant: variantName(v),
      usesOracle,
      ownCodeunits: own,
      builds: [],
      tests: [],
    };
    await ctx.provider.prenukeCentralGaugeApps([ctx.container]);
    const built: string[] = [];
    const appIds: Record<string, string> = {};
    for (const app of apps) {
      const appDir = join(ws, app);
      await Deno.mkdir(join(appDir, ".alpackages"), { recursive: true });
      for (const dep of built) {
        await Deno.copyFile(dep, join(appDir, ".alpackages", dep.split(/[/\\]/).pop()!));
      }
      const project = await loadProject(appDir);
      appIds[app] = (project.appJson as { id: string }).id;
      const compiled = await ctx.provider.compileProject(ctx.container, project);
      if (!compiled.success || !compiled.artifactPath) {
        result.builds.push({
          app,
          ok: false,
          detail: compiled.errors.map((e) => `${e.code} ${e.message}`).join("; "),
        });
        break;
      }
      try {
        // Never runTests()/prepareCandidateApp: its cleanup removes the refapp apps (findings section 2).
        await ctx.provider.publishApp(ctx.container, compiled.artifactPath);
      } catch (err) {
        result.builds.push({
          app,
          ok: false,
          detail: `publish: ${err instanceof Error ? err.message : String(err)}`,
        });
        break;
      }
      result.builds.push({ app, ok: true });
      built.push(compiled.artifactPath);
    }
    const ok = (app: string) => result.builds.some((b) => b.app === app && b.ok);
    const suites: { app: string; codeunit: number }[] = [];
    if (ok("Test")) {
      for (const t of task.pass_to_pass) suites.push({ app: "Test", codeunit: t.codeunit });
      for (const c of own) suites.push({ app: "Test", codeunit: c });
    }
    if (usesOracle && task.fail_to_pass && ok("Oracle")) {
      for (const t of task.fail_to_pass.tests) {
        suites.push({ app: "Oracle", codeunit: t.codeunit });
      }
    }
    const seen = new Set<number>();
    for (const s of suites) {
      if (seen.has(s.codeunit)) continue;
      seen.add(s.codeunit);
      const res = await runTestsViaSoap(ctx.soap, s.codeunit, appIds[s.app] ?? "");
      for (const c of res.results) {
        result.tests.push({
          codeunit: s.codeunit,
          procedure: c.name,
          passed: c.passed,
          ...(c.error ? { message: c.error } : {}),
        });
      }
    }
    return result;
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

async function hostCompile(
  loaded: LoadedTask,
  refapp: string,
  v: Variant,
): Promise<number> {
  const ws = await Deno.makeTempDir({ prefix: `cg-harness-compile-${loaded.task.id}-` });
  try {
    const { apps } = await stageVariant(loaded, refapp, v, ws);
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
        args: [
          "compile",
          `/project:${join(ws, app)}`,
          `/out:${join(pkg, `${app}.app`)}`,
          `/packagecachepath:${pkg}`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder().decode(r.stdout) +
        new TextDecoder().decode(r.stderr);
      const errors = text.split(/\r?\n/).filter((l) => /error [A-Z]{2}\d+/.test(l));
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

async function gate(
  container: string,
  loaded: LoadedTask,
  repo: string,
  refapp: string,
): Promise<number> {
  const { problems } = await checkTask(loaded, refapp, repo);
  if (problems.length > 0) {
    for (const p of problems) console.log(`${colors.red("[FAIL]")} ${p}`);
    return 1;
  }
  if ((await git(repo, ["status", "--porcelain", "--", "harness-tasks"])).out.trim()) {
    console.error(`${colors.red("[FAIL]")} harness-tasks has uncommitted changes; gate a clean commit`);
    return 1;
  }
  const commit = (await git(repo, ["rev-parse", "HEAD"])).out.trim();
  const credentials = {
    username: Deno.env.get("CG_GATE_BC_USER") ?? "sshadows",
    password: Deno.env.get("CG_GATE_BC_PASSWORD") ?? "1234",
  };
  const provider = new BcContainerProvider();
  provider.setCredentials(container, credentials);
  if (!(await provider.isHealthy(container))) {
    console.error(
      `${colors.red("[INFRA]")} ${container} not healthy or not visible under DOCKER_CONTEXT=${
        Deno.env.get("DOCKER_CONTEXT") ?? "(inherited)"
      }`,
    );
    return 3;
  }
  await provider.ensureTestHarness([container]);
  const ctx: Ctx = {
    provider,
    container,
    refapp,
    soap: {
      host: container,
      port: 7047,
      company: "My Company",
      tenant: "default",
      credentials,
      timeoutMs: resolveSoapTimeoutMs(undefined),
    },
  };
  const runs: GateRun[] = [];
  const results: RunResult[] = [];
  let infra: string | undefined;
  try {
    for (const step of gatePlan(loaded.task, await subdirs(join(loaded.dir, "naive")))) {
      const result = await runVariant(ctx, loaded, step.variant);
      const summary = summarize(loaded.task, result);
      runs.push({ ...step, summary });
      results.push(result);
      console.log(`[gate] ${loaded.task.id} ${result.variant} #${step.repeat} ${JSON.stringify(summary)}`);
    }
  } catch (err) {
    infra = err instanceof Error ? err.message : String(err);
  } finally {
    await provider.prenukeCentralGaugeApps([container]);
    await provider.dispose();
  }
  const decision = infra
    ? { promoted: false, reasons: [`infra: ${infra}`] }
    : decideGate(loaded.task, runs);
  const outDir = join(EVIDENCE_ROOT, loaded.task.id);
  await Deno.mkdir(outDir, { recursive: true });
  const file = join(outDir, `gate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await Deno.writeTextFile(
    file,
    JSON.stringify(
      {
        task: loaded.task.id,
        commit,
        container,
        refapp_version: loaded.task.refapp_version,
        at: new Date().toISOString(),
        ...decision,
        runs: runs.map((r, i) => ({
          variant: variantName(r.variant),
          repeat: r.repeat,
          summary: r.summary,
          result: results[i],
        })),
      },
      null,
      2,
    ),
  );
  console.log(
    `${decision.promoted ? colors.green("[OK]") : colors.red("[FAIL]")} ${loaded.task.id} gate -> ${file}`,
  );
  for (const r of decision.reasons) console.log(`  - ${r}`);
  return infra ? 3 : decision.promoted ? 0 : 1;
}

async function main(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;
  const repo = (await git(Deno.cwd(), ["rev-parse", "--show-toplevel"])).out.trim();
  const refapp = join(repo, "harness-tasks", "refapp");
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
    if (cmd === "gate" && rest.length === 2) {
      return await gate(rest[0]!, await loadTask(rest[1]!), repo, refapp);
    }
  } catch (err) {
    console.error(`${colors.red("[FAIL]")} ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  console.error(
    "usage: gate-task.ts check <taskDir>... | compile <taskDir> <variant> | gate <container> <taskDir>",
  );
  return 2;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/gate-task.test.ts`
Expected: `ok | 17 passed | 0 failed`.

- [ ] **Step 5: Verify the host toolchain `compile` relies on**

No task exists yet, so check the `al` tool against the cached symbols directly (Core has no refapp dependencies):
```bash
al compile '/project:U:\Git\CentralGauge\harness-tasks\refapp\Core' "/out:$TEMP\\core.app" '/packagecachepath:C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols'
```
Expected: exit 0, no `error AL` lines. If it fails, put the output in the M4-01 submit note and mark `compile` unavailable (lane-content then asks ops for compile jobs); `check` and `gate` are unaffected.

- [ ] **Step 6: Check, lint, format, commit**

```bash
deno check scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
deno lint scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
deno fmt scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
git add scripts/harness/gate-task.ts tests/unit/harness/gate-task.test.ts
git commit -m "feat(harness): interim task gate script (check, compile, gate)"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/gate-task.test.ts` prints `ok | 17 passed | 0 failed`; `deno check` and `deno lint` clean on both files.

---

### Task M4-02: refapp slice A and HX-001 (bugfix: damaged return)

**Lane:** content. **Deps:** M4-01 (Steps 7 on; Steps 1-6 can start at once). **Target:** 09-30.

Spec 1b sections 3 (Rental -> Core events, Fleet reacting to Rental through a Core publisher, in-app subscriber), 5, 6, 8, 9 (prompt describes what users observe). HX-001 is the anchor task for the 10-02 end-to-end gate: moderate difficulty, but the root cause is two event hops away from the symptom (Rental raises a Core event, a Fleet subscriber calls damage registration, whose own event is handled by a second Fleet subscriber that modifies the same vehicle).

**Files:**
- Modify: `harness-tasks/refapp/Core/src/CoreEvents.Codeunit.al`
- Create: `harness-tasks/refapp/Core/src/Setup.Table.al`
- Modify: `harness-tasks/refapp/Fleet/src/Vehicle.Table.al`, `harness-tasks/refapp/Fleet/src/FleetMgt.Codeunit.al`
- Create: `harness-tasks/refapp/Fleet/src/DamageEntry.Table.al`, `DamageMgt.Codeunit.al`, `FleetReturnHandler.Codeunit.al`, `VehicleBlockSubscriber.Codeunit.al`
- Create: `harness-tasks/refapp/Rental/src/RentalStatus.Enum.al`, `RentalContract.Table.al`
- Modify: `harness-tasks/refapp/Rental/src/RentalMgt.Codeunit.al`
- Modify: `harness-tasks/refapp/Test/app.json` (idRanges 80000-84999)
- Delete: `harness-tasks/refapp/Test/src/SkeletonTests.Codeunit.al` (its tests move into the module test codeunits below)
- Create: `harness-tasks/refapp/Test/src/TestLibrary.Codeunit.al`, `RentalTests.Codeunit.al`, `FleetTests.Codeunit.al`, `LeasingTests.Codeunit.al`, `IntegrationTests.Codeunit.al`
- Create: `harness-tasks/tasks/HX-001/{task.yml,prompt.md}`, `overlay/Fleet/src/FleetReturnHandler.Codeunit.al`, `correct/Fleet/src/FleetReturnHandler.Codeunit.al`, `oracle/app.json`, `oracle/src/ReturnOracle.Codeunit.al`, `naive/skip-modify-on-damage/Fleet/src/FleetReturnHandler.Codeunit.al`, `naive/drop-block/Fleet/src/VehicleBlockSubscriber.Codeunit.al`

**Interfaces:**
- Produces (refapp v1 API used by later tasks and oracles):
  - `"CGR Core Events"`: `RaiseVehicleCheckedOut(VehicleNo: Code[20])`, `RaiseVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])`, events `OnAfterVehicleCheckedOut`, `OnAfterVehicleReturned` (same parameters).
  - table 70003 `"CGR Setup"`: `GetOrCreate()`, `NextContractNo(): Code[20]`, `NextLeaseNo(): Code[20]`.
  - table 70100 `"CGR Vehicle"` fields 1 No., 2 Mileage, 3 Checked Out, 4 Strategy, 5 Blocked, 6 Last Service Km, 7 Daily Rate, 8 Description.
  - table 70101 `"CGR Damage Entry"`; codeunit 70102 `"CGR Damage Mgt"`: `RegisterDamage(VehicleNo: Code[20]; Description: Text[100]): Integer`, `RepairDamage(EntryNo: Integer)`, event `OnAfterDamageRegistered(var DamageEntry)`.
  - codeunit 70100 `"CGR Fleet Mgt"`: `IsAvailable(VehicleNo): Boolean` (event `OnBeforeIsAvailable(VehicleNo; var Result; var IsHandled)`), `NextServiceKm(VehicleNo): Integer`.
  - enum 70200 `"CGR Rental Status"` (Open, Checked Out, Returned, Posted); table 70200 `"CGR Rental Contract"`; codeunit 70200 `"CGR Rental Mgt"`: `CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; EndDate: Date): Code[20]`, `CheckOut(ContractNo: Code[20])`, `Return(ContractNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])`.
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
```

`Fleet/src/FleetMgt.Codeunit.al`: keep the skeleton, change the last line of `IsAvailable` to
```al
        exit(not Vehicle."Checked Out" and not Vehicle.Blocked);
```

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
        if OpenDamage.IsEmpty() then
            if Vehicle.Get(DamageEntry."Vehicle No.") then begin
                Vehicle.Blocked := false;
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
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
```

`Fleet/src/FleetReturnHandler.Codeunit.al` (the correct refapp version; also copied verbatim to `tasks/HX-001/correct/Fleet/src/`):
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

`Rental/src/RentalMgt.Codeunit.al` (the direct `FleetMgt.IsAvailable` call and direct Vehicle read are the 1b section 3 "legacy direct call left in on purpose"):
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

- [ ] **Step 4: Visible tests (Test app)**

`Test/app.json`: `"idRanges": [{ "from": 80000, "to": 84999 }]`. Delete `SkeletonTests.Codeunit.al`.

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

Visible test codeunits (each `Subtype = Test; TestPermissions = Disabled;`, `Assert: Codeunit "Library Assert"`, `Lib: Codeunit "CGR Test Library"`, one vehicle key per procedure):

| Codeunit | Procedure | Arrange / act | Assert |
| --- | --- | --- | --- |
| 80010 "CGR Rental Tests" | CheckOutMarksVehicleCheckedOut | vehicle T-RENT-001 km 1000, contract, CheckOut | vehicle Checked Out true; contract Status Checked Out; Start Km 1000 |
| 80010 | CheckOutTwiceFails | T-RENT-002, two contracts, check out first | `asserterror` CheckOut second; `ExpectedError('Vehicle T-RENT-002 is not available.')` |
| 80010 | ReturnWithoutDamageReleasesVehicle | T-RENT-003 km 1000, check out, Return(1300, '') | vehicle Checked Out false, Mileage 1300, Blocked false; contract Returned, Return Km 1300 |
| 80010 | ReturnBelowStartKmFails | T-RENT-004 km 1000, check out | `asserterror` Return(999, ''); `ExpectedError('Return km 999 is below the start km 1000.')`; contract still Checked Out |
| 80020 "CGR Fleet Tests" | HeavyDutyStrategyFromFleetExtension | T-FLT-001 km 1000 Heavy Duty | `NextServiceKm` = 6000 |
| 80020 | BlockedVehicleNotAvailable | T-FLT-002, RegisterDamage('Dent') | vehicle Blocked true; `IsAvailable` false |
| 80020 | RepairLastDamageUnblocks | T-FLT-003, two RegisterDamage | repair first: Blocked true, IsAvailable false; repair second: Blocked false, IsAvailable true |
| 80030 "CGR Leasing Tests" | LeaseRateUsesCoreInternal | none | `MonthlyRate(100, 12)` = 112 |
| 80040 "CGR Integration Tests" | PayloadCarriesVehicleNo | none | `VehicleCheckedOutPayload('T-INT-001')` = `{"event":"vehicleCheckedOut","vehicleNo":"T-INT-001"}` |

Example, the first row in full (the rest follow the same shape):
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
  - { codeunit: 80020, procedures: [HeavyDutyStrategyFromFleetExtension, BlockedVehicleNotAvailable, RepairLastDamageUnblocks] }
fail_to_pass:
  depends_on: [Core, Fleet, Rental]
  tests:
    - { codeunit: 85000, procedures: [ReturnWithDamageReleasesAndBlocksVehicle, ReturnWithDamageRegistersOneOpenDamageEntry, ReturnWithDamageCompletesContract, DamagedVehicleCannotBeRentedAgain, RepairAfterDamagedReturnMakesVehicleAvailable, ReturnWithoutDamageLeavesVehicleUnblocked] }
mutants: []
contamination: null
limits: { timeout_min: 30 }
```

`tasks/HX-001/prompt.md`:
```markdown
# Bug 4127: Returning a damaged vehicle fails

Reported by the front desk, Aarhus branch.

When a customer returns a rental vehicle and the clerk records damage on the return, the return fails with:

> Another user has modified the record for this CGR Vehicle after you retrieved it from the database.

Nobody else is working on that vehicle. Returns without damage work. Because the return fails, the contract stays checked out, the damage is not recorded and the vehicle still shows as out.

Expected: a return with damage completes like any other return (the contract is returned, the vehicle is back with the return mileage), the damage is recorded, and the vehicle cannot be rented out again until the damage is repaired.

To reproduce: create a rental contract, check it out, then return it with a damage description (`CGR Rental Mgt`, Return).
```

`tasks/HX-001/overlay/Fleet/src/FleetReturnHandler.Codeunit.al` (the injected bug: damage is registered, and through `OnAfterDamageRegistered` the vehicle is modified, before the handler modifies its stale copy):
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

`tasks/HX-001/correct/Fleet/src/FleetReturnHandler.Codeunit.al`: byte-identical to the refapp file from Step 2.

`tasks/HX-001/naive/skip-modify-on-damage/Fleet/src/FleetReturnHandler.Codeunit.al` (makes the error go away by not saving the vehicle when damage is reported):
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
        if DamageDescription <> '' then begin
            DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
            exit;
        end;
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        Vehicle.Modify(true);
    end;
}
```

`tasks/HX-001/naive/drop-block/Fleet/src/VehicleBlockSubscriber.Codeunit.al` (removes the conflicting modify instead of fixing the order; overlay handler stays):
```al
codeunit 70104 "CGR Vehicle Block Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Damage Mgt", 'OnAfterDamageRegistered', '', false, false)]
    local procedure BlockDamagedVehicle(var DamageEntry: Record "CGR Damage Entry")
    begin
    end;
}
```

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

`tasks/HX-001/oracle/src/ReturnOracle.Codeunit.al`:
```al
codeunit 85000 "HX001 Return Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RentalMgt: Codeunit "CGR Rental Mgt";
        DamageTxt: Label 'Scratch on rear door', Locked = true;

    [Test]
    procedure ReturnWithDamageReleasesAndBlocksVehicle()
    var
        Vehicle: Record "CGR Vehicle";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-A'), 1450, DamageTxt);
        Vehicle.Get('HX001-A');
        Assert.IsFalse(Vehicle."Checked Out", 'A returned vehicle must not stay checked out');
        Assert.AreEqual(1450, Vehicle.Mileage, 'Vehicle mileage must be the return km');
        Assert.IsTrue(Vehicle.Blocked, 'A vehicle returned with damage must be blocked');
    end;

    [Test]
    procedure ReturnWithDamageRegistersOneOpenDamageEntry()
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-B'), 1450, DamageTxt);
        DamageEntry.SetRange("Vehicle No.", 'HX001-B');
        Assert.AreEqual(1, DamageEntry.Count(), 'Exactly one damage entry for the return');
        DamageEntry.FindFirst();
        Assert.AreEqual(DamageTxt, DamageEntry.Description, 'Damage description from the return');
        Assert.IsFalse(DamageEntry.Repaired, 'New damage is open');
        Assert.AreEqual(WorkDate(), DamageEntry."Reported On", 'Damage reported on the work date');
    end;

    [Test]
    procedure ReturnWithDamageCompletesContract()
    var
        Contract: Record "CGR Rental Contract";
        ContractNo: Code[20];
    begin
        ContractNo := CheckedOutContract('HX001-C');
        RentalMgt.Return(ContractNo, 1450, DamageTxt);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract status after return');
        Assert.AreEqual(1450, Contract."Return Km", 'Contract return km');
        Assert.AreEqual(DamageTxt, Contract."Damage Description", 'Contract damage description');
    end;

    [Test]
    procedure DamagedVehicleCannotBeRentedAgain()
    var
        NextContractNo: Code[20];
    begin
        RentalMgt.Return(CheckedOutContract('HX001-D'), 1450, DamageTxt);
        NextContractNo := RentalMgt.CreateContract('HX001-D', 'Next Customer', 20270310D, 20270312D);
        asserterror RentalMgt.CheckOut(NextContractNo);
        Assert.ExpectedError('Vehicle HX001-D is not available.');
    end;

    [Test]
    procedure RepairAfterDamagedReturnMakesVehicleAvailable()
    var
        DamageEntry: Record "CGR Damage Entry";
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-E'), 1450, DamageTxt);
        DamageEntry.SetRange("Vehicle No.", 'HX001-E');
        DamageEntry.FindFirst();
        DamageMgt.RepairDamage(DamageEntry."Entry No.");
        Assert.IsTrue(FleetMgt.IsAvailable('HX001-E'), 'Repaired vehicle is available again');
        Vehicle.Get('HX001-E');
        Assert.AreEqual(1450, Vehicle.Mileage, 'Repair keeps the return mileage');
    end;

    [Test]
    procedure ReturnWithoutDamageLeavesVehicleUnblocked()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-F'), 1200, '');
        Vehicle.Get('HX001-F');
        Assert.IsFalse(Vehicle.Blocked, 'No damage, no block');
        Assert.IsFalse(Vehicle."Checked Out", 'Vehicle is back');
        Assert.AreEqual(1200, Vehicle.Mileage, 'Mileage from the return');
        DamageEntry.SetRange("Vehicle No.", 'HX001-F');
        Assert.IsTrue(DamageEntry.IsEmpty(), 'No damage entry without damage');
    end;

    local procedure CheckedOutContract(VehicleNo: Code[20]) ContractNo: Code[20]
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
        Vehicle.Mileage := 1000;
        Vehicle.Insert();
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Oracle Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
    end;
}
```

The last procedure is a hidden regression row: it passes on the baseline; the scorer still fails on the baseline through the other five.

- [ ] **Step 6: Host compile every variant (requires M4-01)**

```bash
for v in baseline correct naive/skip-modify-on-damage naive/drop-block; do
  deno run --allow-all scripts/harness/gate-task.ts compile harness-tasks/tasks/HX-001 "$v" || break
done
```
Expected: `[OK]` for all seven apps and `Oracle` in each variant. A compile error is fixed in the AL, never by removing an oracle row.

- [ ] **Step 7: al-test-auditor pass**

Dispatch the `al-test-auditor` agent with this prompt (the same template is used by every content task, with the task id and plan section swapped):

> Audit harness task `U:\Git\CentralGauge\harness-tasks\tasks\HX-001`. The layout differs from `tasks/`: the specification is `prompt.md` plus `task.yml`; the oracle is `oracle/src/*.al` (hidden test app, ids 85000-89999; visible tests are `harness-tasks/refapp/Test`, 80000-84999). Apply your rule sets A, B, C and E to the pair (prompt.md, oracle). In addition: (1) compare the oracle against the normative table in `docs/superpowers/plans/2026-09-30-harness-refapp-v1.md` Task M4-02 Step 5 and report any row missing or with a different expected value; (2) report any requirement in prompt.md with no assertion; (3) report any assertion that depends on something prompt.md does not state; (4) report state shared between procedures of one codeunit (the harness rolls back per codeunit, not per procedure). Read-only. End with a line `VERDICT: clean` or `VERDICT: <n> critical, <m> major`.

Save the output verbatim to `H:\Temp3\harness-spike\M4\HX-001\audit-1.md`. Fix every critical and major finding in the task (never by weakening an oracle row; a finding that asks to weaken one goes to `coord ask`), then re-run the auditor to `audit-2.md` until the verdict line is clean.

- [ ] **Step 8: Static check, commit, request the gate job**

```bash
deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-001
git add harness-tasks/refapp harness-tasks/tasks/HX-001
git commit -m "feat(harness-tasks): refapp v1 slice A and HX-001 damaged return bugfix"
```
Expected from `check`: `[WARN] ... refapp-v1-rc1 does not resolve yet` and `[OK]`. Then message lane-ops: `need container job: deno run --allow-all scripts/harness/gate-task.ts gate <Cronus281-283> harness-tasks/tasks/HX-001 at <sha> for M4-03, report to lane-content`.

**Acceptance:** `deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-001` prints `[OK]` (the unresolved-tag warning is allowed); `H:\Temp3\harness-spike\M4\HX-001\` holds an `audit-*.md` whose last line is `VERDICT: clean`; the oracle file contains all six procedures of Step 5.

---

### Task M4-03: gate job HX-001

**Lane:** ops. **Deps:** M4-01, M4-02. **Target:** 10-01.

- [ ] **Step 1:** Bench-live check (`find results/.bench-running.json -mmin -2` prints nothing), lease a content container (Cronus281-283), checkpoint the job in the note, `git worktree add H:\cg-coord\jobs\M4-03-<n> <sha from M4-02>`.
- [ ] **Step 2:** In that worktree: `deno run --allow-all scripts/harness/gate-task.ts gate <container> harness-tasks/tasks/HX-001`. Expected: 8 runs (baseline, correct x3, 2 naive x2), exit 0, `[OK] HX-001 gate -> H:\Temp3\harness-spike\M4\HX-001\gate-<stamp>.json`.
- [ ] **Step 3: Premise check.** In the report, the baseline run's failing oracle procedures carry the stale-record message (`jq -r '.runs[0].result.tests[] | select(.passed==false) | .message' <file>` contains `has modified the record`). If the baseline fails for another reason, or passes, the task premise does not hold on BC 28: report to lane-content and the orchestrator; HX-001 goes back to M4-02, not forward.
- [ ] **Step 4:** Exit 1 (not promoted): send the `reasons` and the report path to lane-content; do not edit AL. Exit 3 (infra): release, re-lease another content container, rerun once; a second infra exit goes to `coord ask`.
- [ ] **Step 5:** Release the lease, remove the job worktree, report the path to lane-content and the orchestrator. The orchestrator tags the gated commit `refapp-v1-rc1` on acceptance.

**Acceptance:** `jq -e '.promoted == true and .commit == "<M4-02 sha>" and (.runs | length) == 8' H:\Temp3\harness-spike\M4\HX-001\gate-<stamp>.json` exits 0, and the Step 3 message check holds.

---

### Task M4-04: refapp slice B and HX-002 (test-authoring: lease schedule)

**Lane:** content. **Deps:** M4-02. **Target:** 10-01 to 10-02.

Spec 1a section 7 (test-authoring boundary: agent tests must build, discover at least one test, pass on reference code, fail on every mutant by an assertion; mutant 0 is the staged buggy state), 1b section 3 (Leasing -> Core `internal` with `internalsVisibleTo`), 1b section 8 (reference tests kill every mutant).

**Files:**
- Modify: `harness-tasks/refapp/Core/src/LeaseMath.Codeunit.al`
- Create: `harness-tasks/refapp/Leasing/src/LeaseContract.Table.al`, `LeaseScheduleLine.Table.al`
- Modify: `harness-tasks/refapp/Leasing/src/LeaseMgt.Codeunit.al`
- Modify: `harness-tasks/refapp/Test/src/LeasingTests.Codeunit.al`, `TestLibrary.Codeunit.al` (add `CreateLease`)
- Create: `harness-tasks/tasks/HX-002/{task.yml,prompt.md}`, `overlay/Leasing/src/LeaseMgt.Codeunit.al`, `correct/Leasing/src/LeaseMgt.Codeunit.al`, `mutants/{no-carry,first-due-shift,invoiced-rebuilt,flat-factor}/...`, `reference-tests/Test/src/LeaseScheduleTests.Codeunit.al`, `naive/{drift-repro-only,totals-only}/Test/src/*.al`

**Interfaces:**
- Produces: table 70300 `"CGR Lease Contract"` (No. Code[20], Vehicle No. Code[20] with no TableRelation (Leasing cannot see Fleet), Customer Name Text[100], Start Date, Months Integer, Base Rate Decimal); table 70301 `"CGR Lease Schedule Line"` (PK Contract No., Line No.; Due Date, Amount Decimal, Invoiced Boolean); `"CGR Lease Mgt"`: `MonthlyRate(BaseRate; Months): Decimal` (unchanged), `CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; Months: Integer; BaseRate: Decimal): Code[20]`, `CreateSchedule(ContractNo: Code[20])`, `InvoiceLine(ContractNo: Code[20]; LineNo: Integer)`. Core `"CGR Lease Math"` internal: `RateFactor`, `LeaseTotal(BaseRate; Months): Decimal`, `SplitInstallments(Total; Count; var Amounts: List of [Decimal])`.

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

- [ ] **Step 2: Leasing tables and `CGR Lease Mgt`**. `CreateContract` uses `Setup.NextLeaseNo()`; `InvoiceLine` gets the line and sets `Invoiced := true`. The correct `CreateSchedule` (refapp and `correct/`):
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

- [ ] **Step 3: Overlay (mutant 0, the reported drift).** `overlay/Leasing/src/LeaseMgt.Codeunit.al` = the correct file with the loop computing due dates cumulatively:
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

- [ ] **Step 4: Mutants** (each folder holds one whole file, identical to `correct/` or the refapp file except for the change):

| Mutant | File | Change |
| --- | --- | --- |
| no-carry | `mutants/no-carry/Core/src/LeaseMath.Codeunit.al` | `SplitInstallments` adds `Installment` for every line (no rounding carry) |
| first-due-shift | `mutants/first-due-shift/Leasing/src/LeaseMgt.Codeunit.al` | `'<+%1M>'` with `i` instead of `i - 1` |
| invoiced-rebuilt | `mutants/invoiced-rebuilt/Leasing/src/LeaseMgt.Codeunit.al` | no invoiced check; `DeleteAll` removes invoiced lines too |
| flat-factor | `mutants/flat-factor/Core/src/LeaseMath.Codeunit.al` | `RateFactor` returns `1 + (Months div 100)` |

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
mutants: [no-carry, first-due-shift, invoiced-rebuilt, flat-factor]
contamination: null
limits: { timeout_min: 30 }
```

`prompt.md`:
```markdown
# Task 4188: Automated tests for lease schedules

Finance reports that schedules of leases starting at the end of a month drift. A 12-month lease starting 31 January 2027 has its March installment due on 28 March instead of 31 March, and every later installment stays on the 28th.

Before anyone changes the scheduling code we want automated tests that pin down how a lease schedule must behave. Add them to the Test app. Do not fix the scheduling code in this task: your tests will be run against the corrected scheduling code, where they must pass, and against the current code, where they must catch the drift.

How a lease schedule must behave (schedules are created with `CGR Lease Mgt`, CreateSchedule):

- One schedule line per month of the lease, line numbers 10000, 20000, 30000 and so on.
- The first installment is due on the lease start date; installment n is due n-1 months after the start date.
- The lease total is base rate x months x rate factor, rounded to 0.01, where the rate factor is 1 + months/100. Every installment is the total divided by the number of months, rounded to 0.01, except the last one, which takes the remainder so that the installments add up exactly to the total.
- Creating the schedule again replaces the existing lines.
- A lease with an invoiced schedule line cannot be rescheduled: the attempt fails and the schedule stays as it was.
```

- [ ] **Step 6: Reference tests** (`reference-tests/Test/src/LeaseScheduleTests.Codeunit.al`, codeunit 80100 "CGR Lease Schedule Tests"; each procedure creates its own lease through `CreateContract`):

| Procedure | Arrange | Assert | Kills |
| --- | --- | --- | --- |
| DueDatesFollowStartDate | start 2027-01-31, 12 months, base 10.07 | line 10000 due 2027-01-31, 20000 2027-02-28, 30000 2027-03-31, 120000 2027-12-31 | m0, first-due-shift |
| OneLinePerMonthNumbered | same lease | 12 lines; line numbers 10000..120000 step 10000 | first-due-shift not required |
| InstallmentsCarryRoundingToLastLine | same lease | lines 10000-110000 each 11.28; line 120000 11.26; sum 135.34 | no-carry, flat-factor |
| RescheduleReplacesLines | same lease, CreateSchedule twice | 12 lines, same amounts | none (spec coverage) |
| InvoicedLeaseCannotBeRescheduled | same lease, InvoiceLine(10000) | `asserterror` CreateSchedule; still 12 lines; line 10000 still Invoiced; amounts unchanged | invoiced-rebuilt |

Values: 10.07 x 1.12 x 12 = 135.3408, total 135.34; 135.34 / 12 = 11.2783, installment 11.28; 11 x 11.28 = 124.08; last 11.26.

- [ ] **Step 7: Naive test suites** (under `naive/<x>/Test/src/`, codeunit 80101, pass on `correct/`, leave mutants alive):
  - `drift-repro-only`: one procedure asserting the 31 January lease's line 30000 is due 2027-03-31. Kills m0 and first-due-shift; no-carry, invoiced-rebuilt, flat-factor survive.
  - `totals-only`: one procedure asserting 12 lines exist and every amount is positive. Kills nothing but proves the gate detects weak suites.

- [ ] **Step 8: Visible tests.** `LeasingTests` 80030 keeps `LeaseRateUsesCoreInternal` and adds nothing about schedules (the task is to write them). `TestLibrary` gets `CreateLease(VehicleNo; StartDate; Months; BaseRate): Code[20]`.

- [ ] **Step 9: Host compile, audit, check, commit, request gate.** Compile variants `baseline`, `tests:reference-tests@correct`, `tests:reference-tests@m0`, each `tests:reference-tests@<mutant>`, each `tests:naive/<x>@correct`. Auditor prompt as in M4-02 Step 7 with `reference-tests/` as the audited test code and the table of Step 6 as the normative rows; output `H:\Temp3\harness-spike\M4\HX-002\audit-*.md`. Then `check` HX-001 and HX-002 (slice B must not flag drift on HX-001), commit `feat(harness-tasks): refapp v1 slice B and HX-002 lease schedule tests`, and request `gate` for M4-05.

**Acceptance:** `gate-task.ts check harness-tasks/tasks/HX-001 harness-tasks/tasks/HX-002` prints `[OK]` for both; last `audit-*.md` line `VERDICT: clean`; `reference-tests/` contains the five procedures of Step 6.

---

### Task M4-05: gate job HX-002

**Lane:** ops. **Deps:** M4-01, M4-04. **Target:** 10-02.

Same procedure as M4-03 Steps 1, 2, 4, 5 with `harness-tasks/tasks/HX-002`. Expected 21 runs: baseline 1, reference tests on correct x3, reference tests on m0 and the four mutants (5), and each of the two naive suites on correct, m0 and the four mutants (2 x 6). Tag on acceptance: `refapp-v1-rc2`.

**Acceptance:** `jq -e '.promoted == true and .commit == "<M4-04 sha>" and (.runs | length) == 21' H:\Temp3\harness-spike\M4\HX-002\gate-<stamp>.json` exits 0.

---

### Task M4-06: refapp slice C and HX-003 (feature: service-due vehicles)

**Lane:** content. **Deps:** M4-04. **Target:** 10-02 to 10-03.

Spec 1b section 3 (Rental -> Fleet: IsHandled business events plus one legacy direct call; Fleet -> Core: interface plus extensible enum), in-app style "event subscriber instance modes" (the oracle binds a manual subscriber).

**Files:**
- Modify: `Fleet/src/FleetMgt.Codeunit.al` (`NextServiceKm` counts from `"Last Service Km"`)
- Modify: `Core/src/Setup.Table.al` (field 4 `"Suspend Rentals"` Boolean)
- Create: `Rental/src/RentalFleetSubscribers.Codeunit.al` (codeunit 70201: subscribes to Fleet `OnBeforeIsAvailable`; when Setup `"Suspend Rentals"` is true sets `Result := false; IsHandled := true`, otherwise does nothing)
- Modify: `Rental/src/RentalMgt.Codeunit.al` (add legacy `SwapVehicle(ContractNo: Code[20]; NewVehicleNo: Code[20])`: contract must be Checked Out; reads the new `Vehicle."Checked Out"` directly and errors `NotAvailableErr` when true or Blocked; sets old vehicle Checked Out false and new vehicle Checked Out true by direct `Modify`; sets contract Vehicle No. and Start Km := new vehicle Mileage)
- Modify: `Test/src/FleetTests.Codeunit.al` (`HeavyDutyStrategyFromFleetExtension` sets Last Service Km 1000, expects 6000), `RentalTests.Codeunit.al` (add `SwapMovesContractToFreeVehicle`, `SuspendRentalsBlocksCheckout`)
- Create: `tasks/HX-003/{task.yml,prompt.md}`, `correct/...`, `oracle/app.json` (id suffix 3, idRanges 85200-85299, deps Core, Fleet, Rental, Library Assert), `oracle/src/ServiceOracle.Codeunit.al` (85200), `oracle/src/AvailabilityOverride.Codeunit.al` (85201, `EventSubscriberInstance = Manual`, subscribes `OnBeforeIsAvailable`, sets `Result := true; IsHandled := true`), `oracle/src/ShortInterval.Codeunit.al` (85202 implements `"CGR Maintenance Strategy"`, `exit(CurrentKm + 1000)`), `oracle/src/Strategies.EnumExt.al` (enumextension 85200 value 85200 `"HX3 Short"`), `naive/{checkout-only,after-ishandled,hardcoded-interval}/...`
- No overlay (feature starts from the plain refapp).

- [ ] **Step 1: Slice C refapp changes** as listed, then host compile `baseline` and run `check` on HX-001 and HX-002 (drift must stay clean; `FleetMgt` is not replaced by either).

- [ ] **Step 2: prompt.md**
```markdown
# Feature 4203: Keep vehicles that are due for service off the road

The workshop wants vehicles that have reached their service interval kept away from new rentals until they have been serviced.

A vehicle is due for service when its mileage has reached the next service km that its maintenance strategy gives for the mileage at its last service ("Last Service Km"). Default vehicles go 15,000 km between services and Heavy Duty vehicles 5,000 km; other apps can add strategies.

- Checking out a rental contract for a vehicle that is due for service fails with the error "Vehicle <No.> is due for service." and leaves the contract and the vehicle unchanged.
- Swapping a checked-out contract to a vehicle that is due for service fails with the same error and leaves the contract on its current vehicle.
- The fleet availability check (`CGR Fleet Mgt`, IsAvailable) reports a vehicle that is due for service as not available.
- This is a safety rule: extensions that customize vehicle availability cannot make a vehicle that is due for service available. For vehicles that are not due, their customizations keep working as today.
```

- [ ] **Step 3: task.yml**: `kind: feature`, `touches: [Fleet, Rental, Core]`, `coupling: [ishandled, interface]`, `refapp_version: refapp-v1-rc3`, `pass_to_pass` = 80010 {CheckOutMarksVehicleCheckedOut, CheckOutTwiceFails, SwapMovesContractToFreeVehicle, SuspendRentalsBlocksCheckout} and 80020 {HeavyDutyStrategyFromFleetExtension, BlockedVehicleNotAvailable}, `fail_to_pass.depends_on: [Core, Fleet, Rental]`, tests codeunit 85200 with the procedures below, `limits: { timeout_min: 30 }`.

- [ ] **Step 4: Oracle (normative)**, codeunit 85200 "HX003 Service Oracle", one vehicle key per procedure, every vehicle created with Blocked false, Checked Out false:

| Procedure | Arrange | Assert |
| --- | --- | --- |
| DefaultVehicleDueIsRefused | HX3-A Default, Last Service 10000, Mileage 25000 | `asserterror` CheckOut; `ExpectedError('Vehicle HX3-A is due for service.')`; contract Open; vehicle Checked Out false |
| DefaultVehicleBelowIntervalRents | HX3-B Default, 10000 / 24999 | CheckOut succeeds; contract Checked Out |
| HeavyDutyDueAtFiveThousand | HX3-C Heavy Duty, 10000 / 15000 | refused, message for HX3-C |
| HeavyDutyBelowIntervalRents | HX3-D Heavy Duty, 10000 / 14999 | CheckOut succeeds |
| ExtensionStrategyIsRespected | HX3-E "HX3 Short", 10000 / 11000; HX3-F "HX3 Short", 10000 / 10999 | E refused with its message; F checks out |
| SwapToDueVehicleIsRefused | HX3-G Default not due, checked out on contract; HX3-H Default 0 / 15000 | `asserterror` SwapVehicle(contract, HX3-H); message for HX3-H; contract Vehicle No. HX3-G; G Checked Out true; H Checked Out false |
| AvailabilityReportsDueVehicle | HX3-I due, HX3-J not due | `IsAvailable(HX3-I)` false; `IsAvailable(HX3-J)` true |
| OverrideCannotReleaseDueVehicle | `BindSubscription(Override)`; HX3-K due | `IsAvailable` false; CheckOut refused with the due message; `UnbindSubscription` |
| OverrideStillAppliesToVehiclesNotDue | bind; HX3-L not due, Blocked true | `IsAvailable` true; CheckOut succeeds; unbind |

- [ ] **Step 5: correct/** (one valid solution; the oracle accepts any): `FleetMgt` gets `IsDueForService(VehicleNo): Boolean` (`Mileage >= NextServiceKm(VehicleNo)`), `IsAvailable` returns false for a due vehicle before raising `OnBeforeIsAvailable`, and `RentalMgt.CheckOut` and `SwapVehicle` raise `DueForServiceErr: Label 'Vehicle %1 is due for service.'` before the availability check.

- [ ] **Step 6: naive/**
  - `checkout-only`: only `CheckOut` checks due (correct message, strategy used); `SwapVehicle` and `IsAvailable` unchanged. Loses SwapToDueVehicleIsRefused, AvailabilityReportsDueVehicle.
  - `after-ishandled`: due check inside `IsAvailable` after the `IsHandled` exit; `CheckOut` and `SwapVehicle` call `IsAvailable` and raise the due message when `IsDueForService`. Loses the two override rows.
  - `hardcoded-interval`: correct structure, due = `Mileage >= "Last Service Km" + 15000`. Loses HeavyDutyDueAtFiveThousand and ExtensionStrategyIsRespected.

- [ ] **Step 7: Host compile all variants, audit (normative table Step 4), check HX-001..HX-003, commit `feat(harness-tasks): refapp v1 slice C and HX-003 service-due vehicles`, request gate M4-07.**

**Acceptance:** `check` prints `[OK]` for HX-001, HX-002, HX-003; last `audit-*.md` `VERDICT: clean`; oracle has the nine procedures of Step 4.

---

### Task M4-07: gate job HX-003

**Lane:** ops. **Deps:** M4-01, M4-06. **Target:** 10-03.

M4-03 Steps 1, 2, 4, 5 with HX-003. Expected 10 runs (baseline, correct x3, 3 naive x2 = 1 + 3 + 6). Baseline: the oracle does not compile against the plain refapp or its due rows fail; either is accepted. Tag `refapp-v1-rc3`.

**Acceptance:** `jq -e '.promoted == true and .commit == "<M4-06 sha>" and (.runs | length) == 10' <report>` exits 0.

---

### Task M4-08: refapp slice D and HX-004 (feature: revenue per vehicle)

**Lane:** content. **Deps:** M4-06. **Target:** 10-04 to 10-05.

Spec 1b section 3 (Reporting -> Rental/Leasing/Fleet: table extensions, cross-app FlowFields) and in-app style "posting codeunit chains".

**Files:**
- Modify: `Core/src/Setup.Table.al` (fields 5 `"Weekend Surcharge %"` Decimal, 6 `"Km Allowance per Day"` Integer, 7 `"Excess Km Rate"` Decimal)
- Create: `Rental/src/PricingMethod.Enum.al` (enum 70201, `Extensible = false`, values `Daily` 0, `"Weekend Package"` 1), field 10 `"Pricing Method"` on `"CGR Rental Contract"`
- Create: `Rental/src/RentalPricing.Codeunit.al` (codeunit 70203), `RentalPost.Codeunit.al` (70204, `TableNo = "CGR Rental Contract"`), `RentalPostLedger.Codeunit.al` (70205), `RentalLedgerEntry.Table.al` (table 70205: Entry No. AutoIncrement, Contract No., Vehicle No., Posting Date, Amount, Km Driven)
- Modify: `RentalMgt.Codeunit.al` (add `Post(ContractNo: Code[20])`: `Contract.Get`; `Codeunit.Run(Codeunit::"CGR Rental-Post", Contract)`)
- Modify: `Test/src/RentalTests.Codeunit.al` (add `PostCreatesLedgerEntry`, `DailyPriceWithWeekendSurcharge`, `ExcessKmCharged`)
- Create: `tasks/HX-004/{task.yml,prompt.md}`, `correct/{Leasing,Reporting}/...`, `oracle/` (suffix 4, 85300-85399, deps Core, Fleet, Rental, Leasing, Reporting, Library Assert), `naive/{no-follow,all-lines,moves-invoiced}/...`

- [ ] **Step 1: Pricing (the hard-wired base HX-005 refactors).** `"CGR Rental Pricing".CalcAmount(Contract: Record "CGR Rental Contract"): Decimal`:
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

- [ ] **Step 2: Posting chain.** `"CGR Rental-Post"` `OnRun`: status must be Returned (`NotReturnedErr`), `OnBeforePostRentalContract(Rec)`, `Amount := Pricing.CalcAmount(Rec)`, `"CGR Rental-Post Ledger".InsertEntry(Rec, Amount)` (Posting Date := Contract."End Date", Km Driven := Return Km - Start Km), `Rec.Status := Posted; Rec.Modify(true)`, `OnAfterPostRentalContract(Rec, Amount)`.

- [ ] **Step 3: prompt.md**
```markdown
# Feature 4231: Revenue per vehicle

Controlling wants to see what each vehicle earns from rentals and from leases, for any period.

Add three fields to the vehicle, in the Reporting app:

- "Date Filter": a date filter.
- "Rental Revenue" (Decimal): the total amount of the rental ledger entries of the vehicle, limited to posting dates within the date filter when one is set.
- "Lease Revenue" (Decimal): the total amount of the invoiced lease schedule lines for the vehicle, limited to due dates within the date filter. Lines that are not invoiced do not count.

Both revenue fields are calculated fields (FlowFields), so they can be used on lists and in queries.

When the vehicle of a lease contract is changed (validating its "Vehicle No."), the schedule lines that are not invoiced yet move with the lease to the new vehicle; lines already invoiced stay with the vehicle they were invoiced on.
```

- [ ] **Step 4: task.yml**: `kind: feature`, `touches: [Reporting, Leasing, Rental, Fleet]`, `coupling: [queries, internal]`, `refapp_version: refapp-v1-rc4`, p2p = 80010 {PostCreatesLedgerEntry, DailyPriceWithWeekendSurcharge, ExcessKmCharged}, 80030 {LeaseRateUsesCoreInternal}; f2p codeunit 85300, procedures below.

- [ ] **Step 5: Oracle (normative)**, codeunit 85300 "HX004 Revenue Oracle". Every procedure first sets Setup `"Weekend Surcharge %"` 0, `"Km Allowance per Day"` 1000, `"Excess Km Rate"` 0 and uses its own vehicles (daily rate 50). Rentals are created, checked out, returned with no extra km and posted through `CGR Rental Mgt`.

| Procedure | Arrange | Assert |
| --- | --- | --- |
| RentalRevenueSumsPostedContracts | HX4-A: posted Daily 2027-03-01..03 (150.00) and 2027-03-08..09 (100.00); HX4-B: posted 2027-03-01..04 (200.00) | A `CalcFields("Rental Revenue")` = 250.00; B = 200.00 |
| RentalRevenueRespectsDateFilter | HX4-C: same two contracts as A | `SetRange("Date Filter", 20270301D, 20270305D)`: 150.00 |
| RentalRevenueIgnoresUnposted | HX4-D: one posted (150.00), one returned not posted | 150.00 |
| LeaseRevenueCountsInvoicedLinesOnly | HX4-E: lease start 2027-03-01, 3 months, base 100 (lines 103.00 each), invoice 10000 and 20000 | `Lease Revenue` = 206.00 |
| LeaseRevenueRespectsDateFilter | HX4-F: same lease, all three invoiced | filter 2027-03-01..2027-03-31: 103.00; no filter: 309.00 |
| UninvoicedLinesFollowVehicleChange | HX4-G lease as E, invoice 10000; `Validate("Vehicle No.", 'HX4-H')`, `Modify(true)`; invoice 20000 | G = 103.00 and H = 103.00; then invoice 30000: G still 103.00, H = 206.00 |
| RevenueSourcesStaySeparate | HX4-I: one posted rental (150.00) and one lease with line 10000 invoiced (103.00) | Rental Revenue 150.00; Lease Revenue 103.00 |

Values: 2027-03-01 is a Monday, so the first two contracts have no weekend days; lease total 100 x 1.03 x 3 = 309.00, installments 103.00.

- [ ] **Step 6: correct/**: `"Vehicle No."` field on `"CGR Lease Schedule Line"` (Code[20]), set in `CreateSchedule`; `OnValidate` of Lease Contract `"Vehicle No."` modifies uninvoiced lines of the contract; Reporting `tableextension 70500 "CGR Vehicle Revenue" extends "CGR Vehicle"` with `"Date Filter"` (FlowFilter), `"Rental Revenue"` (Sum of ledger Amount where Vehicle No. = No., Posting Date = Date Filter) and `"Lease Revenue"` (Sum of schedule line Amount where Vehicle No. = No., Invoiced = true, Due Date = Date Filter). The Leasing changes live in Leasing, the FlowFields in Reporting.

- [ ] **Step 7: naive/**
  - `no-follow`: line Vehicle No. set in `CreateSchedule`, no `OnValidate`. Loses UninvoicedLinesFollowVehicleChange.
  - `all-lines`: Lease Revenue without the `Invoiced = const(true)` filter. Loses LeaseRevenueCountsInvoicedLinesOnly.
  - `moves-invoiced`: `OnValidate` moves every line. Loses UninvoicedLinesFollowVehicleChange (G becomes 0).

- [ ] **Step 8: Host compile all variants, audit (table Step 5).**

- [ ] **Step 9: Re-derive HX-003.** Slice D adds `Post` to `RentalMgt`, which HX-003's `correct/` and all three `naive/` variants replace. Apply the slice D change to those four files (keep each task change as it was), set HX-003 `refapp_version: refapp-v1-rc4`, and host compile HX-003 `correct` and each naive. The HX-003 oracle is not touched.

- [ ] **Step 10: Check HX-001..HX-004, commit `feat(harness-tasks): refapp v1 slice D and HX-004 revenue per vehicle`, request gate M4-09 for HX-004 and HX-003.**

**Acceptance:** `check` `[OK]` for HX-001..HX-004 (no drift problem on HX-003 once its tag resolves); last audit `VERDICT: clean`; oracle has the seven procedures of Step 5; `git diff <rc3 sha> -- harness-tasks/tasks/HX-003/oracle` is empty.

---

### Task M4-09: gate job HX-004

**Lane:** ops. **Deps:** M4-01, M4-08. **Target:** 10-05.

M4-03 Steps 1, 2, 4, 5 with HX-004, then again with HX-003 (re-derived in M4-08 Step 9) on the same commit. Expected 10 runs each. Tag `refapp-v1-rc4`.

**Acceptance:** for both HX-004 and HX-003 reports, `jq -e '.promoted == true and .commit == "<M4-08 sha>" and (.runs | length) == 10' <report>` exits 0.

---

### Task M4-10: HX-005 (refactor: extensible pricing methods)

**Lane:** content. **Deps:** M4-08. **Target:** 10-05 to 10-06.

Spec 1b section 3 (interface plus extensible enum implementing it, strategy style) and 1b section 9 (a refactor whose oracle proves the new extension point by extending it from another app). No refapp change: the task starts from slice D's hard-wired `case`.

**Files:**
- Create: `tasks/HX-005/{task.yml,prompt.md}`, `correct/Rental/src/{PricingMethod.Enum.al,RentalPriceMethod.Interface.al,DailyPrice.Codeunit.al,WeekendPackagePrice.Codeunit.al,RentalPricing.Codeunit.al}`, `oracle/` (suffix 5, 85400-85499, deps Core, Fleet, Rental, Library Assert; `enumextension 85400 "HX005 Pricing Methods" extends "CGR Pricing Method"` value 85400 `"HX5 Flat Fee"` implemented by codeunit 85401 returning `DailyRate * 1.5`), `naive/{case-kept,excess-in-methods,surcharge-lost}/...`

- [ ] **Step 1: prompt.md**
```markdown
# Task 4250: Let partner apps add rental pricing methods

Partners want to ship their own rental pricing methods, for example a flat corporate rate, in their own apps without changing Rental. Today the pricing methods are hard-wired in `CGR Rental Pricing`.

Change Rental so that:

- "CGR Pricing Method" can be extended by other apps, and every method provides its price through an interface named "CGR Rental Price Method" with one procedure: `CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal`.
- Daily and Weekend Package keep producing exactly the prices they produce today.
- The excess km charge stays common: it is added on top of the base price of every method, including methods added by other apps.
- `CGR Rental Pricing`, CalcAmount(Contract) keeps its signature and still returns the full price, and posting keeps using it.
```

- [ ] **Step 2: task.yml**: `kind: refactor`, `touches: [Rental]`, `coupling: [interface]`, `refapp_version: refapp-v1-rc5`, p2p 80010 {PostCreatesLedgerEntry, DailyPriceWithWeekendSurcharge, ExcessKmCharged}, f2p codeunit 85400.

- [ ] **Step 3: Oracle (normative)**, codeunit 85400 "HX005 Pricing Oracle". Each procedure sets Setup explicitly and uses its own vehicle (daily rate 40); contracts are inserted directly with Start/End Date, Start Km, Return Km and Pricing Method, then priced with `CalcAmount`.

| Procedure | Setup (surcharge %, allowance/day, excess rate) | Contract | Expected |
| --- | --- | --- | --- |
| DailyWeekdaysUnchanged | 25, 1000, 0 | Daily 2027-03-01..03 (Mon-Wed), 0 km | 120.00 |
| DailyWeekendSurchargeUnchanged | 25, 1000, 0 | Daily 2027-03-05..08 (Fri-Mon), 0 km | 180.00 |
| WeekendPackageUnchanged | 25, 1000, 0 | Weekend Package 2027-03-05..07, 0 km | 80.00 |
| ExcessKmOnDaily | 0, 100, 0.5 | Daily 2027-03-01..03, 450 km | 195.00 |
| ExcessKmOnWeekendPackage | 0, 100, 0.5 | Weekend Package 2027-03-05..07, 400 km | 130.00 |
| PartnerMethodPriceUsed | 0, 1000, 0 | HX5 Flat Fee 2027-03-01..03, 0 km | 60.00 |
| PartnerMethodGetsExcessKm | 0, 100, 0.5 | HX5 Flat Fee 2027-03-01..01, 300 km | 160.00 |
| PostingUsesPartnerMethod | 0, 1000, 0 | HX5 Flat Fee, created, checked out, returned, posted via `CGR Rental Mgt` | one ledger entry, Amount 60.00 |

- [ ] **Step 4: naive/**
  - `case-kept`: enum made extensible with the interface and two implementations, but `CalcAmount` keeps a `case` over the known values with `else` base 0. Loses both partner rows and the posting row.
  - `excess-in-methods`: excess km moved into the Daily and Weekend Package implementations; `CalcAmount` returns `CalcBasePrice` only. Loses PartnerMethodGetsExcessKm.
  - `surcharge-lost`: Daily implementation drops the weekend surcharge loop. Loses DailyWeekendSurchargeUnchanged.

- [ ] **Step 5: Host compile all variants, audit (table Step 3; auditor rule C applies: the partner method is exercised through the interface), check HX-001..HX-005, commit `feat(harness-tasks): HX-005 extensible pricing refactor`, request gate M4-11.**

**Acceptance:** `check` `[OK]` for HX-001..HX-005; last audit `VERDICT: clean`; oracle has the eight procedures of Step 3.

---

### Task M4-11: gate job HX-005

**Lane:** ops. **Deps:** M4-01, M4-10. **Target:** 10-06.

M4-03 Steps 1, 2, 4, 5 with HX-005. Expected 10 runs; baseline oracle does not compile (no interface), accepted. Tag `refapp-v1-rc5`.

**Acceptance:** `jq -e '.promoted == true and .commit == "<M4-10 sha>" and (.runs | length) == 10' <report>` exits 0.

---

### Task M4-12: refapp slice E and HX-006 (feature: return messages with sequence)

**Lane:** content. **Deps:** M4-10. **Target:** 10-06 to 10-07.

Spec 1b section 3 (Integration -> Core: facade codeunit, JSON; reaction to Rental through the Core publisher).

**Files:**
- Create: `Integration/src/OutboxEntry.Table.al` (table 70401: Entry No. AutoIncrement, `"Event Type"` Text[50], `"Vehicle No."` Code[20], Payload Text[2048], `"Created At"` DateTime, Sent Boolean)
- Modify: `Integration/src/IntegrationFacade.Codeunit.al` (add `QueueVehicleCheckedOut(VehicleNo)`, `MarkSent(EntryNo: Integer)`, `PurgeSent()` which deletes Sent entries)
- Create: `Integration/src/IntegrationSubscribers.Codeunit.al` (70402: subscribes Core `OnAfterVehicleCheckedOut`, calls `QueueVehicleCheckedOut`)
- Modify: `Test/src/IntegrationTests.Codeunit.al` (add `OutboxQueuesCheckout`: after a checkout the last outbox entry for the vehicle has Event Type `vehicleCheckedOut` and its payload parses with `vehicleNo` = the vehicle)
- Create: `tasks/HX-006/{task.yml,prompt.md}`, `correct/Integration/...`, `oracle/` (suffix 6, 85500-85599, deps Core, Fleet, Rental, Integration, Library Assert), `naive/{count-sequence,string-km,always-description}/...`

- [ ] **Step 1: prompt.md**
```markdown
# Feature 4262: Tell the partner portal about returns, in order

The partner portal gets a message in the integration outbox when a vehicle is checked out. It also needs to know when a vehicle comes back, and it processes messages per vehicle, so it needs their order.

1. When a rental vehicle is returned, queue an outbox entry with Event Type "vehicleReturned" and this JSON payload:
   `{"event":"vehicleReturned","vehicleNo":"<No.>","returnKm":<km>,"damage":<true|false>,"damageDescription":"<text>","sequence":<n>}`
   "returnKm" and "sequence" are JSON numbers and "damage" a JSON boolean. "damageDescription" is present only when damage was reported.
2. Every outbox entry of a vehicle, checkouts and returns alike, carries a sequence number per vehicle: 1 for the first message of that vehicle, then 2, 3 and so on in the order the events happened. Store it in a new field "Vehicle Sequence No." (Integer) on the outbox entry, and add it as the last key of the checkout payload:
   `{"event":"vehicleCheckedOut","vehicleNo":"<No.>","sequence":<n>}`
3. Sent entries are purged regularly (`CGR Integration Facade`, PurgeSent). Purging does not restart the numbering of a vehicle.
```

- [ ] **Step 2: task.yml**: `kind: feature`, `touches: [Integration, Core, Rental]`, `coupling: [facade, events, core-facade]`, `refapp_version: refapp-v1-rc6`, p2p 80040 {OutboxQueuesCheckout} and 80010 {CheckOutMarksVehicleCheckedOut, ReturnWithoutDamageReleasesVehicle} (not `PayloadCarriesVehicleNo`: its exact payload predates the sequence key), f2p codeunit 85500.

- [ ] **Step 3: Oracle (normative)**, codeunit 85500 "HX006 Outbox Oracle"; each procedure deletes outbox entries of its own vehicles first and uses its own keys; JSON types are checked with `JsonToken.WriteTo` (text `1450`, not `"1450"`).

| Procedure | Arrange | Assert |
| --- | --- | --- |
| ReturnQueuesMessageWithNumbers | HX6-A km 1000, check out, Return(1450, '') | 2 entries for A; last: Event Type `vehicleReturned`, Vehicle Sequence No. 2; payload `event` `vehicleReturned`, `vehicleNo` `HX6-A`, `returnKm` token text `1450`, `damage` token text `false`, no `damageDescription` key, `sequence` token text `2` |
| DamagedReturnCarriesDescription | HX6-B, Return(1300, 'Dent') | `damage` `true`; `damageDescription` `Dent` |
| CheckoutPayloadCarriesSequence | HX6-C, check out | payload text exactly `{"event":"vehicleCheckedOut","vehicleNo":"HX6-C","sequence":1}`; Vehicle Sequence No. 1 |
| SequenceIsPerVehicle | HX6-D check out, HX6-E check out, D return, D check out (new contract) | D entries 1, 2, 3 in entry order; E entry 1 |
| SequenceContinuesAfterPurge | HX6-F check out, return; `MarkSent` both; `PurgeSent`; check out again | the new entry has Vehicle Sequence No. 3 and payload `sequence` 3 |
| FailedReturnLeavesNoMessage | HX6-G km 1000, check out; `asserterror` Return(999, '') | exactly 1 entry for G (the checkout) |

- [ ] **Step 4: correct/**: a per-vehicle counter table in Integration (for example table 70403 `"CGR Vehicle Message Seq."`, PK Vehicle No., Last Sequence No.), a subscriber to Core `OnAfterVehicleReturned`, and the facade building both payloads with `JsonObject` in the specified key order.

- [ ] **Step 5: naive/**
  - `count-sequence`: sequence = count of the vehicle's outbox entries + 1. Loses SequenceContinuesAfterPurge.
  - `string-km`: `returnKm` added as `Format(ReturnKm)`. Loses ReturnQueuesMessageWithNumbers.
  - `always-description`: `damageDescription` always added (empty when no damage). Loses ReturnQueuesMessageWithNumbers.

- [ ] **Step 6: Host compile all variants, audit (table Step 3), check HX-001..HX-006, commit `feat(harness-tasks): refapp v1 slice E and HX-006 return messages`, request gate M4-13.**

**Acceptance:** `check` `[OK]` for HX-001..HX-006; last audit `VERDICT: clean`; oracle has the six procedures of Step 3.

---

### Task M4-13: gate job HX-006

**Lane:** ops. **Deps:** M4-01, M4-12. **Target:** 10-07.

M4-03 Steps 1, 2, 4, 5 with HX-006. Expected 10 runs. Tag `refapp-v1-rc6`.

**Acceptance:** `jq -e '.promoted == true and .commit == "<M4-12 sha>" and (.runs | length) == 10' <report>` exits 0.

---

### Task M4-14: freeze preparation

**Lane:** content. **Deps:** M4-03, M4-05, M4-07, M4-09, M4-11, M4-13. **Target:** 10-08.

- [ ] **Step 1:** Set `refapp_version: refapp-v1` in all six `task.yml`. No other change: every oracle, overlay, correct and naive file stays byte-identical to its gated commit (`git diff <rcN sha> -- harness-tasks/tasks/HX-00N` shows only the `refapp_version` line).
- [ ] **Step 2:** `deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-00*`: `[OK]` for all six; the only allowed warning is `refapp-v1 does not resolve yet`.
- [ ] **Step 3:** If M1-10 has merged: `deno task start harness validate` loads all six tasks (it fails on the unresolved `refapp-v1` tag until the orchestrator tags; that failure is expected before Step 4).
- [ ] **Step 4:** Commit `chore(harness-tasks): pin v1 task set to refapp-v1`, submit. The orchestrator tags that commit `refapp-v1` (never moved afterwards) and pushes the tag.

**Acceptance:** the Step 1 diff check holds for all six tasks against their rc tags; `check` prints `[OK]` six times.

---

### Task M4-15: freeze gate

**Lane:** ops. **Deps:** M4-14 and the `refapp-v1` tag. **Target:** 10-08 to 10-09.

- [ ] **Step 1:** In a job worktree at the `refapp-v1` commit, run `gate` for all six tasks, spread over Cronus281-283 (one lease per container, tasks queued per container). Expected: six reports, all `promoted: true`, all with the `refapp-v1` commit.
- [ ] **Step 2:** If M1 Part 2 ships `centralgauge harness cell` with the `mock` harness before 10-09: for each task run the mock harness on `correct` and on the first `naive/` variant through the real verdict pipeline (1b section 8, last sentence) and record each judgment path in `H:\Temp3\harness-spike\M4\freeze\mock-pipeline.md`. A disagreement between the pipeline and `gate-task.ts` goes to `coord ask` with both files; it is not resolved by editing either. If `harness cell` is not available, the file says so in one line.
- [ ] **Step 3:** Write `H:\Temp3\harness-spike\M4\freeze\task-set.json`: `{ "refapp_version": "refapp-v1", "commit": "<sha>", "tasks": [{ "id", "gate_report", "promoted" }] }`, plus the M1-04 task-set identity (`id`, visible hash, oracle hash) when M1-04 has merged.
- [ ] **Step 4:** Any task that fails its freeze gate is reported to lane-content and the orchestrator at once. Fewer than six promoted tasks on 10-09 goes to the owner (launch contract: fewer than 6 tasks needs the owner).

**Acceptance:** `jq -e '[.tasks[] | select(.promoted)] | length == 6' H:\Temp3\harness-spike\M4\freeze\task-set.json` exits 0, and each listed `gate_report` has `.commit` equal to the `refapp-v1` commit.

---

## Integration check (orchestrator)

After each content task merges: `deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-*` is `[OK]` for every task landed so far, and the latest `audit-*.md` of the new task ends `VERDICT: clean`. After each ops gate task: the `jq` acceptance line of that task, then tag `refapp-v1-rcN` at the gated commit. After M4-15: the freeze acceptance line; `graphify update .`.

## Open questions

1. **Reference tests location.** 1b section 5 has no folder for the test-authoring reference tests; this plan uses `reference-tests/`. M1-04 must decide whether it is hashed (it is authoring-only, like `naive/`, so this plan assumes neither hash) and M1-01's loader must not reject it (it does not today). Confirm.
2. **M1 schema fields this plan depends on** (M1-01 as of 09-25, under revision): `refapp_version` free string resolved to a tag (rc tags), `kind: test-authoring` with `mutants` names matching `^[A-Za-z0-9_-]+$` and `mutants/<m>` folders, `fail_to_pass.depends_on` over `MODULES`, `pass_to_pass` band 80000-84999, oracle band 85000-89999, `touches` including `Test` (HX-002), free-string `coupling` (M1 open question 7; this plan's vocabulary is `events, internal, interface, queries, facade, ishandled, core-facade`), optional `overlay/` (HX-003, HX-005 have none), no `oracle/` for test-authoring. A change to any of these needs a task.yml edit here.
3. **Baseline oracle that does not compile.** For features and the refactor the oracle references objects that do not exist yet, so the baseline "fails fail_to_pass" by oracle compile failure. This plan accepts that for the baseline only (naive must compile). The M1 verdict must score an oracle compile failure on an agent workspace as `fail`, not infra. Confirm.
4. **Coverage below 1b section 9.** With six tasks, `ishandled`, `queries` and `facade` are exercised once, and the in-app styles single-instance state, temporary tables and `CommitBehavior` not at all. 1b section 9 states the two-per-style rule for the ~10-task v1; tasks 7-10 are cut order item 4. Owner to confirm six is the M4 bar and the rest follows after 10-16.
5. **Host compile for lane-content.** `gate-task.ts compile` runs `al` on the host against `C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols` (read-only). It touches no container, but the lane rules only say "Only lane-ops touches containers". Confirm lane-content may run it; otherwise every compile error costs an ops round trip.
6. **Gate script ownership.** `gate-task.ts` is written by lane-ops (M4-01) because it is container tooling and infra is on M1. It duplicates part of M1 Part 2 staging; it is retired when `harness cell` with the mock harness can gate a task. Confirm, or move M4-01 to lane-infra.
7. **Removed-feature overlays.** 1b section 5 mentions overlays that remove a feature; layers here never delete files. No v1 task needs deletion. If M1 staging supports deletion, the semantics must be written down before a task uses it.
8. **HX-001 premise.** The task relies on BC 28 raising the stale-record error when a subscriber modifies the vehicle through a second record variable in the same transaction. M4-03 Step 3 verifies it on the baseline; if it does not hold, HX-001 is redesigned and the 10-01 target slips.
9. **Oracle hidden regression rows.** Some `fail_to_pass` procedures pass on the baseline (for example `ReturnWithoutDamageLeavesVehicleUnblocked`). 1b only requires the scorer to fail on the baseline. If M1 or the report treats `fail_to_pass` strictly per procedure (SWE-bench style), these rows move to a hidden `pass_to_pass` list, which the schema does not have today.
10. **1a section 14 vs launch contract dates.** 1a section 14 targets six gated tasks by 10-16; the launch contract requires them qualified and frozen by 10-09. This plan follows the launch contract.
