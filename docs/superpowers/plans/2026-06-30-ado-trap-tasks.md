# ADO Trap-Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reusable ADO-PR → trap-task pipeline plus a first batch of 4 hard/medium CentralGauge tasks (cohort `ado-trap-2026`) that probe AL runtime semantics, each proven by a discrimination probe.

**Architecture:** Build a reusable probe harness first (a Deno driver over the existing `al_verify_task` compile+test path). Then author each task as a quartet — prereq app, oracle test, a *correct* reference solution, and a *naive-trap* reference solution — and run the probe to prove the oracle separates correct from naive. Only then codify the method as a skill and register the tasks. Risk is front-loaded: the deterministic tasks come before the probe-gated ones.

**Tech Stack:** Deno 1.44+ / TypeScript 5, AL (Business Central 28), bccontainerhelper, Cronus BC containers, Zod task schema, Cliffy CLI.

## Global Constraints

- Tasks compile + run their oracle inside a **vanilla Cronus container**. Only base-app + the task's own prereq objects are available. NO Continia objects (CDO/CDC/CTS-SYS) anywhere. (Spec: "Key constraint".)
- Object-ID bands: prereq apps `69000–69999`, generated/model code `70000–79999`, test codeunits `80000–89999`. (CLAUDE.md prereq-apps rule.)
- **This batch's reserved IDs:** prereq `69600–69639`, model code `70900–70930`, tests `80290–80293`. (Collision-checked 2026-06-30: highest test id in use = 80273; highest prereq range = 69570.)
- Every new task carries id `CG-AL-X###`, `metadata.cohort: ado-trap-2026`, `metadata.source_pr: <id>`. Legacy = `CG-AL-[EMH]*`. (Spec: "Part C — Marking convention".)
- Task descriptions specify WHAT, never HOW; **no guiding notes / hints / pitfall warnings** (project rule + `validate-tasks` command). Specifying required *behavior* is allowed; explaining AL mechanics is not.
- Test codeunits: `Subtype = Test; TestPermissions = Disabled;` and use `Assert: Codeunit Assert` (base-app Assert, NOT "Library Assert"). (Pattern: `tests/al/hard/CG-AL-H054.Test.al`.)
- Discrimination-probe gate: a task ships only if the **correct** reference PASSES and the **naive** reference FAILS its oracle on a real container. Naive solutions are dev-only throwaways — never committed to `tasks/` or `tests/`.
- No production scoreboard ingest. Local dry-run only. (Spec: "Non-goals".)
- After any code change to `.ts`: `deno check <files>`, `deno lint <dirs>`, `deno fmt <files>` (scope to touched files — repo has CRLF/LF drift).

---

## Task 1: Probe harness (reusable discrimination-probe driver)

Builds the tool every later task uses. Self-tested against an EXISTING task (CG-AL-H054) with a known-good solution so the harness is proven before any new task exists.

**Files:**
- Modify: `mcp/al-tools-server.ts` — export `handleAlVerifyTask` (currently module-internal).
- Create: `scripts/trap-probe.ts` — CLI driver: given a task id, a solution directory, and an expected outcome, runs `al_verify_task` and asserts the outcome.
- Create (dev-only, git-ignored): `scratch/trap-probe/` working dirs for reference solutions.

**Interfaces:**
- Consumes: `handleAlVerifyTask({ projectDir: string, taskId: string, containerName?: string, target?: "Cloud"|"OnPrem" }): Promise<{ success: boolean; message?: string; testResults?: { total: number; passed: number; failed: number } }>` from `mcp/al-tools-server.ts`.
- Produces: `deno run -A scripts/trap-probe.ts --task <id> --solution <dir> --expect pass|fail [--container Cronus28]` → exit 0 when actual outcome matches `--expect`, exit 1 otherwise. This command is the gate invoked by every task below.

- [ ] **Step 1: Confirm the handler's return shape**

Read `mcp/al-tools-server.ts` around `handleAlVerifyTask` (line ~1066) and `handleAlVerify` to confirm the returned object's field names (`success`, `message`, and the test-count fields). Write the exact shape into `scripts/trap-probe.ts`'s local type. Do not guess — copy from source.

- [ ] **Step 2: Export the handler**

In `mcp/al-tools-server.ts`, change `async function handleAlVerifyTask(` to `export async function handleAlVerifyTask(`. Nothing else.

- [ ] **Step 3: Write the probe driver**

Create `scripts/trap-probe.ts`:

```typescript
// Discrimination-probe driver. Runs a task's oracle against a provided AL
// solution directory and asserts the pass/fail outcome.
// Usage: deno run -A scripts/trap-probe.ts --task CG-AL-X002 --solution <dir> --expect pass|fail [--container Cronus28]
import { parseArgs } from "@std/cli/parse-args";
import { handleAlVerifyTask } from "../mcp/al-tools-server.ts";

const a = parseArgs(Deno.args, {
  string: ["task", "solution", "expect", "container"],
  default: { container: "Cronus28" },
});

if (!a.task || !a.solution || !a.expect) {
  console.error("Required: --task <id> --solution <dir> --expect pass|fail");
  Deno.exit(2);
}
if (a.expect !== "pass" && a.expect !== "fail") {
  console.error(`--expect must be 'pass' or 'fail', got '${a.expect}'`);
  Deno.exit(2);
}

const res = await handleAlVerifyTask({
  projectDir: a.solution,
  taskId: a.task,
  containerName: a.container,
});

const passed = res.success === true;
const actual = passed ? "pass" : "fail";
console.log(`[trap-probe] ${a.task}: actual=${actual} expected=${a.expect}`);
if (res.message) console.log(`[trap-probe] message: ${res.message}`);

if (actual !== a.expect) {
  console.error(`[trap-probe] MISMATCH — discrimination NOT satisfied`);
  Deno.exit(1);
}
console.log(`[trap-probe] OK`);
```

- [ ] **Step 4: `deno check` the new script and the edited server**

Run: `deno check scripts/trap-probe.ts mcp/al-tools-server.ts`
Expected: no errors.

- [ ] **Step 5: Self-test the harness against a known-good CG-AL-H054 solution**

Create `scratch/trap-probe/h054-correct/` with `app.json` (id any GUID, name "Probe H054", idRanges 70540-70549, platform/application "27.0.0.0", runtime "16.0") and the known-good cache codeunit the task expects:

```al
codeunit 70540 "CG H054 Cache"
{
    SingleInstance = true;
    Access = Public;
    var
        Keys: List of [Code[20]];
        Vals: Dictionary of [Code[20], Integer];

    procedure Add(Key: Code[20]; Value: Integer)
    begin
        if Vals.ContainsKey(Key) then begin
            Vals.Set(Key, Value);
            exit;
        end;
        if Keys.Count() >= 5 then begin
            Vals.Remove(Keys.Get(1));
            Keys.RemoveAt(1);
        end;
        Keys.Add(Key);
        Vals.Add(Key, Value);
    end;

    procedure Get(Key: Code[20]; var Value: Integer): Boolean
    begin
        if not Vals.ContainsKey(Key) then
            exit(false);
        Value := Vals.Get(Key);
        exit(true);
    end;

    procedure Count(): Integer
    begin
        exit(Keys.Count());
    end;

    procedure Clear()
    begin
        Clear(Keys);
        Clear(Vals);
    end;
}
```

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-H054 --solution scratch/trap-probe/h054-correct --expect pass --container Cronus28`
Expected: `[trap-probe] OK`, exit 0. (Proves the harness compiles, publishes prereqs, runs the test, and reads pass/fail correctly. If this fails, the harness is broken — fix before proceeding; do not author tasks on a broken probe.)

- [ ] **Step 6: Commit**

```bash
git add mcp/al-tools-server.ts scripts/trap-probe.ts
git commit -m "feat(probe): export al_verify_task handler + trap-probe driver

Claude-Session: https://claude.ai/code/session_0176j51zPSS8PoShmasYUEMB"
```

---

## Task 2: CG-AL-X002 — Codeunit.Run rollback boundary (HARD, self-contained)

Lowest-risk task; proves the full author→probe loop end to end. Source: PR 50590 (run-once migration via `Codeunit.Run` so a failure rolls back and is catchable).

**The trap:** A failure inside the work must roll back all writes AND be caught without crashing the caller, then be retryable. Correct uses `Codeunit.Run` as the boundary. A `[TryFunction]` cannot wrap the writes (DB writes are blocked in try functions on-prem → compile error); a direct call lets the error escape and crash the caller.

**Files:**
- Create: `tests/al/dependencies/CG-AL-X002/app.json`
- Create: `tests/al/dependencies/CG-AL-X002/CGX002State.Table.al` (table 69620)
- Create: `tests/al/dependencies/CG-AL-X002/CGX002Input.Table.al` (table 69621)
- Create: `tests/al/dependencies/CG-AL-X002/CGX002Result.Table.al` (table 69622)
- Create: `tests/al/hard/CG-AL-X002.Test.al` (test codeunit 80291)
- Create: `tasks/hard/CG-AL-X002-codeunit-run-rollback.yml`
- Dev-only: `scratch/trap-probe/x002-correct/` and `scratch/trap-probe/x002-naive/`

**Interfaces:**
- Produces (model must implement): `codeunit 70910 "CG X002 Migration"` with `procedure RunOnce(): Boolean` and a `trigger OnRun()`. `RunOnce` returns true if the migration completed (or was already done), false if it failed and rolled back.
- Consumes: prereq tables `"CG X002 State"` (PK `Code[10]`, `Done Boolean`), `"CG X002 Input"` (`Entry No. Integer` PK, `Value Integer`), `"CG X002 Result"` (`Entry No. Integer` PK, `Value Integer`).

- [ ] **Step 1: Write the prereq app + tables**

`tests/al/dependencies/CG-AL-X002/app.json`:

```json
{
    "id": "a1b2c3d4-0a02-0000-0000-000000000001",
    "name": "CG-AL-X002 Prereq",
    "publisher": "CentralGauge",
    "version": "1.0.0.0",
    "platform": "27.0.0.0",
    "application": "27.0.0.0",
    "idRanges": [{ "from": 69620, "to": 69629 }],
    "runtime": "16.0",
    "features": ["NoImplicitWith"]
}
```

`tests/al/dependencies/CG-AL-X002/CGX002State.Table.al`:

```al
table 69620 "CG X002 State"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Done"; Boolean) { }
    }
    keys { key(PK; "Primary Key") { Clustered = true; } }
}
```

`tests/al/dependencies/CG-AL-X002/CGX002Input.Table.al`:

```al
table 69621 "CG X002 Input"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Value"; Integer) { }
    }
    keys { key(PK; "Entry No.") { Clustered = true; } }
}
```

`tests/al/dependencies/CG-AL-X002/CGX002Result.Table.al`:

```al
table 69622 "CG X002 Result"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Value"; Integer) { }
    }
    keys { key(PK; "Entry No.") { Clustered = true; } }
}
```

- [ ] **Step 2: Write the oracle test (codeunit 80291)**

`tests/al/hard/CG-AL-X002.Test.al`:

```al
codeunit 80291 "CG-AL-X002 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        State: Record "CG X002 State";
        Input: Record "CG X002 Input";
        Result: Record "CG X002 Result";
    begin
        State.DeleteAll();
        Input.DeleteAll();
        Result.DeleteAll();
        Commit();
    end;

    local procedure AddInput(EntryNo: Integer; Value: Integer)
    var
        Input: Record "CG X002 Input";
    begin
        Input.Init();
        Input."Entry No." := EntryNo;
        Input.Value := Value;
        Input.Insert();
    end;

    [Test]
    procedure CleanRunCompletesAndPersists()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
        State: Record "CG X002 State";
    begin
        // [GIVEN] Three valid inputs, no prior state
        Reset();
        AddInput(1, 10);
        AddInput(2, 20);
        AddInput(3, 30);
        Commit();

        // [WHEN] The migration runs
        Assert.IsTrue(Migration.RunOnce(), 'Clean run should return true');

        // [THEN] All result rows persist and the guard is set
        Assert.AreEqual(3, Result.Count(), 'All three inputs produce result rows');
        Assert.IsTrue(State.Get() and State.Done, 'Guard Done must be true after a clean run');
    end;

    [Test]
    procedure FailureRollsBackAndIsCatchable()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
        State: Record "CG X002 State";
    begin
        // [GIVEN] A poison input (negative value) between valid ones
        Reset();
        AddInput(1, 10);
        AddInput(2, -1);
        AddInput(3, 30);
        Commit();

        // [WHEN] The migration runs — it must NOT crash this test
        Assert.IsFalse(Migration.RunOnce(), 'Failed run should return false, not throw');

        // [THEN] Every write rolled back: no result rows, guard not set
        Assert.AreEqual(0, Result.Count(), 'A failed run rolls back all result rows');
        if State.Get() then
            Assert.IsFalse(State.Done, 'Guard must not be set when the run failed');
    end;

    [Test]
    procedure RetryAfterFixSucceeds()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
        Input: Record "CG X002 Input";
    begin
        // [GIVEN] A poison run happened, then the poison is removed
        Reset();
        AddInput(1, 10);
        AddInput(2, -1);
        Commit();
        Migration.RunOnce();
        Input.Get(2);
        Input.Value := 20;
        Input.Modify();
        Commit();

        // [WHEN] The migration is retried
        Assert.IsTrue(Migration.RunOnce(), 'Retry after fixing input should succeed');

        // [THEN] Both rows now persist
        Assert.AreEqual(2, Result.Count(), 'Retry produces the full result set');
    end;

    [Test]
    procedure AlreadyDoneIsNoOp()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
    begin
        // [GIVEN] A completed migration, then a late input arrives
        Reset();
        AddInput(1, 10);
        Commit();
        Migration.RunOnce();
        AddInput(2, 20);
        Commit();

        // [WHEN] The migration runs again
        Assert.IsTrue(Migration.RunOnce(), 'Re-run returns true');

        // [THEN] The late input is ignored (guard short-circuits)
        Assert.AreEqual(1, Result.Count(), 'Guard prevents re-processing');
    end;
}
```

- [ ] **Step 3: Write the task YAML (no hints)**

`tasks/hard/CG-AL-X002-codeunit-run-rollback.yml`:

```yaml
id: CG-AL-X002
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  Implement an idempotent, all-or-nothing migration over the existing
  "CG X002 Input" table (ID 69621), "CG X002 Result" table (ID 69622), and
  "CG X002 State" table (ID 69620).

  Create codeunit "CG X002 Migration" (ID 70910). It exposes:

      procedure RunOnce(): Boolean
      trigger OnRun()

  Behavior of RunOnce:
    - If the single "CG X002 State" record exists and its "Done" field is true,
      return true without doing anything else.
    - Otherwise process every "CG X002 Input" row in ascending "Entry No." order:
      for each row, create a "CG X002 Result" row whose "Entry No." and "Value"
      equal the input's "Entry No." and "Value". A "CG X002 Input" row whose
      "Value" is negative must raise an error with the message 'poison'.
    - When all inputs are processed without error, set the "CG X002 State"
      record's "Done" field to true and persist it.
    - If any input raises an error, RunOnce must return false, every "CG X002
      Result" row written during this call must be rolled back, and the "Done"
      field must remain false so a later call can retry. A failing call must not
      propagate the error to its caller.
    - A successful completion returns true.
  Access = Internal.
domains: [codeunits, error-transactions]
metadata:
  category: error-transactions
  tags: [codeunit-run, rollback, transaction-boundary, run-once-guard, idempotent]
  difficulty: hard
  cohort: ado-trap-2026
  source_pr: 50590
expected:
  compile: true
  testApp: tests/al/hard/CG-AL-X002.Test.al
  testCodeunitId: 80291
metrics:
  - compile_pass
  - tests_pass
  - pass_attempt
```

- [ ] **Step 4: Write the CORRECT reference solution (dev-only)**

`scratch/trap-probe/x002-correct/app.json` (id any GUID, name "Probe X002", idRanges 70910-70919, platform/application "27.0.0.0", runtime "16.0", `"features": ["NoImplicitWith"]`), and `scratch/trap-probe/x002-correct/CGX002Migration.Codeunit.al`:

```al
codeunit 70910 "CG X002 Migration"
{
    Access = Internal;

    procedure RunOnce(): Boolean
    var
        State: Record "CG X002 State";
    begin
        if State.Get() and State.Done then
            exit(true);
        exit(Codeunit.Run(Codeunit::"CG X002 Migration"));
    end;

    trigger OnRun()
    begin
        DoWork();
    end;

    local procedure DoWork()
    var
        State: Record "CG X002 State";
        Input: Record "CG X002 Input";
        Result: Record "CG X002 Result";
    begin
        Input.SetCurrentKey("Entry No.");
        if Input.FindSet() then
            repeat
                if Input.Value < 0 then
                    Error('poison');
                Result.Init();
                Result."Entry No." := Input."Entry No.";
                Result.Value := Input.Value;
                Result.Insert();
            until Input.Next() = 0;

        if not State.Get() then begin
            State.Init();
            State."Primary Key" := '';
            State.Insert();
        end;
        State.Done := true;
        State.Modify();
        Commit();
    end;
}
```

Note the app.json must also reference the prereq app `CG-AL-X002 Prereq` as a dependency so the tables resolve, OR rely on the harness's prereq auto-injection (Task 1 proved injection works via `al_verify_task`). Use the same mechanism the H054 self-test used.

- [ ] **Step 5: Probe the correct solution — expect PASS**

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X002 --solution scratch/trap-probe/x002-correct --expect pass`
Expected: `[trap-probe] OK`. If FAIL: the oracle or the correct solution is wrong — fix before continuing.

- [ ] **Step 6: Write the NAIVE solution (dev-only) — the [TryFunction] trap**

`scratch/trap-probe/x002-naive/CGX002Migration.Codeunit.al` (same app.json shape) — a model that "tries" the work with a TryFunction:

```al
codeunit 70910 "CG X002 Migration"
{
    Access = Internal;

    procedure RunOnce(): Boolean
    var
        State: Record "CG X002 State";
    begin
        if State.Get() and State.Done then
            exit(true);
        if not DoWork() then
            exit(false);
        if not State.Get() then begin
            State.Init();
            State.Insert();
        end;
        State.Done := true;
        State.Modify();
        exit(true);
    end;

    [TryFunction]
    local procedure DoWork()
    var
        Input: Record "CG X002 Input";
        Result: Record "CG X002 Result";
    begin
        if Input.FindSet() then
            repeat
                if Input.Value < 0 then
                    Error('poison');
                Result.Init();
                Result."Entry No." := Input."Entry No.";
                Result.Value := Input.Value;
                Result.Insert();
            until Input.Next() = 0;
    end;
}
```

- [ ] **Step 7: Probe the naive solution — expect FAIL**

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X002 --solution scratch/trap-probe/x002-naive --expect fail`
Expected: `[trap-probe] OK` (the naive solution fails to compile — `[TryFunction]` cannot contain `Insert` — so the oracle reports failure, which is the expected discrimination). If the naive solution unexpectedly PASSES, the oracle does not measure the trap → redesign the test (e.g. strengthen the rollback assertion) and re-probe both solutions.

- [ ] **Step 8: Commit the task (NOT the scratch solutions)**

```bash
git add tasks/hard/CG-AL-X002-codeunit-run-rollback.yml tests/al/hard/CG-AL-X002.Test.al tests/al/dependencies/CG-AL-X002
git commit -m "feat(tasks): CG-AL-X002 Codeunit.Run rollback boundary (ado-trap-2026)

Probe: correct PASS, naive (TryFunction write) FAIL.

Claude-Session: https://claude.ai/code/session_0176j51zPSS8PoShmasYUEMB"
```

---

## Task 3: CG-AL-X003 — Change-Log always-logged false positive (HARD, base-app-faithful)

Source: PR 50285. **The trap:** `Change Log Management.IsAlwaysLoggedTable()` returns true for posted sales tables regardless of the global Change Log flag. Correct code gates on `Change Log Setup."Change Log Activated"` FIRST. No prereq app — uses base-app objects only.

**Files:**
- Create: `tests/al/hard/CG-AL-X003.Test.al` (test codeunit 80292)
- Create: `tasks/hard/CG-AL-X003-changelog-activated-gate.yml`
- Dev-only: `scratch/trap-probe/x003-correct/`, `scratch/trap-probe/x003-naive/`

**Interfaces:**
- Produces (model must implement): `codeunit 70920 "CG X003 Audit Check"` with `procedure WouldLogSalesInvoiceChanges(): Boolean` — true only when the global Change Log is activated AND `Sales Invoice Header` is configured to log modifications.

- [ ] **Step 1: Write the oracle test (codeunit 80292)**

`tests/al/hard/CG-AL-X003.Test.al`:

```al
codeunit 80292 "CG-AL-X003 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure SetActivated(Activated: Boolean)
    var
        ChangeLogSetup: Record "Change Log Setup";
        ChangeLogMgt: Codeunit "Change Log Management";
    begin
        if not ChangeLogSetup.Get() then begin
            ChangeLogSetup.Init();
            ChangeLogSetup.Insert();
        end;
        ChangeLogSetup."Change Log Activated" := Activated;
        ChangeLogSetup.Modify();
        ChangeLogMgt.InitChangeLog();
    end;

    local procedure ConfigureSalesInvoiceLogging()
    var
        ChangeLogSetupTable: Record "Change Log Setup (Table)";
        ChangeLogMgt: Codeunit "Change Log Management";
    begin
        if not ChangeLogSetupTable.Get(Database::"Sales Invoice Header") then begin
            ChangeLogSetupTable.Init();
            ChangeLogSetupTable."Table No." := Database::"Sales Invoice Header";
            ChangeLogSetupTable.Insert();
        end;
        ChangeLogSetupTable."Log Modification" := ChangeLogSetupTable."Log Modification"::"All Fields";
        ChangeLogSetupTable.Modify();
        ChangeLogMgt.InitChangeLog();
    end;

    [Test]
    procedure NotAuditedWhenChangeLogInactive()
    var
        AuditCheck: Codeunit "CG X003 Audit Check";
    begin
        // [GIVEN] Change Log globally INACTIVE (even though posted sales tables are "always logged")
        SetActivated(false);

        // [WHEN/THEN] The detector must report no auditing
        Assert.IsFalse(
            AuditCheck.WouldLogSalesInvoiceChanges(),
            'Must return false when the global Change Log is not activated');
    end;

    [Test]
    procedure AuditedWhenActivatedAndConfigured()
    var
        AuditCheck: Codeunit "CG X003 Audit Check";
    begin
        // [GIVEN] Change Log activated AND Sales Invoice Header logging modifications
        SetActivated(true);
        ConfigureSalesInvoiceLogging();

        // [WHEN/THEN] The detector reports auditing active
        Assert.IsTrue(
            AuditCheck.WouldLogSalesInvoiceChanges(),
            'Must return true when activated and the table logs modifications');

        // cleanup so other tests in a shared session see a clean flag
        SetActivated(false);
    end;
}
```

- [ ] **Step 2: Write the task YAML (no hints)**

`tasks/hard/CG-AL-X003-changelog-activated-gate.yml`:

```yaml
id: CG-AL-X003
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  Create codeunit "CG X003 Audit Check" (ID 70920) with Access = Internal and a
  single procedure:

      procedure WouldLogSalesInvoiceChanges(): Boolean

  It returns whether a modification to a posted Sales Invoice (table "Sales
  Invoice Header") would be recorded by the standard Business Central Change Log.
  It returns true only when BOTH of the following hold:
    - the standard Change Log is globally activated, and
    - the "Sales Invoice Header" table is configured to log field modifications.
  In every other case it returns false.
domains: [codeunits]
metadata:
  category: error-transactions
  tags: [change-log, audit, base-app, posted-sales, always-logged]
  difficulty: hard
  cohort: ado-trap-2026
  source_pr: 50285
expected:
  compile: true
  testApp: tests/al/hard/CG-AL-X003.Test.al
  testCodeunitId: 80292
metrics:
  - compile_pass
  - tests_pass
  - pass_attempt
```

- [ ] **Step 3: Write the CORRECT reference (dev-only)**

`scratch/trap-probe/x003-correct/app.json` (idRanges 70920-70929, "27.0.0.0"/"16.0") + `CGX003AuditCheck.Codeunit.al`:

```al
codeunit 70920 "CG X003 Audit Check"
{
    Access = Internal;

    procedure WouldLogSalesInvoiceChanges(): Boolean
    var
        ChangeLogSetup: Record "Change Log Setup";
        ChangeLogMgt: Codeunit "Change Log Management";
        ModificationType: Option Insertion,Modification,Deletion;
    begin
        if not ChangeLogSetup.Get() then
            exit(false);
        if not ChangeLogSetup."Change Log Activated" then
            exit(false);
        exit(ChangeLogMgt.IsLogActive(
            Database::"Sales Invoice Header", 0, ModificationType::Modification));
    end;
}
```

(If `IsLogActive` with field 0 does not report table-level modification logging on the container's BC build, fall back to reading `Change Log Setup (Table)."Log Modification"` directly. The probe in Step 5 confirms which works.)

- [ ] **Step 4: Write the NAIVE reference (dev-only) — the always-logged trap**

`scratch/trap-probe/x003-naive/CGX003AuditCheck.Codeunit.al`:

```al
codeunit 70920 "CG X003 Audit Check"
{
    Access = Internal;

    procedure WouldLogSalesInvoiceChanges(): Boolean
    var
        ChangeLogMgt: Codeunit "Change Log Management";
    begin
        // Naive: trusts IsAlwaysLoggedTable, which is true for posted sales
        // tables regardless of the global Change Log flag.
        exit(ChangeLogMgt.IsAlwaysLoggedTable(Database::"Sales Invoice Header"));
    end;
}
```

- [ ] **Step 5: Probe correct (PASS) then naive (FAIL)**

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X003 --solution scratch/trap-probe/x003-correct --expect pass`
Expected: `[trap-probe] OK`.

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X003 --solution scratch/trap-probe/x003-naive --expect fail`
Expected: `[trap-probe] OK` (naive returns true in `NotAuditedWhenChangeLogInactive` → that test fails → oracle fails → discrimination satisfied).

If `IsAlwaysLoggedTable` returns false for `Sales Invoice Header` on this container (so the naive solution also returns false and the test passes), the false-positive premise does not hold here → the trap does not reproduce. In that case, drop X003 and record it in the probe report; do NOT ship a non-discriminating task.

- [ ] **Step 6: Commit the task**

```bash
git add tasks/hard/CG-AL-X003-changelog-activated-gate.yml tests/al/hard/CG-AL-X003.Test.al
git commit -m "feat(tasks): CG-AL-X003 Change Log always-logged gate (ado-trap-2026)

Probe: correct PASS, naive (IsAlwaysLoggedTable) FAIL.

Claude-Session: https://claude.ai/code/session_0176j51zPSS8PoShmasYUEMB"
```

---

## Task 4: CG-AL-X004 — list-then-insert + idempotent copy (MEDIUM, self-contained)

Source: PR 50590 (read matching rows into a `List` first, then insert; idempotent `Get`-before-`Insert`). **Primary (deterministic) discriminator = idempotency:** the target row's primary key is derived from the source, so a naive re-insert collides ("already exists") or a naive autoincrement doubles the count. The "read into a list before inserting" requirement is stated and verified as a secondary, container-confirmed check.

**Files:**
- Create: `tests/al/dependencies/CG-AL-X004/app.json` (idRanges 69630-69639)
- Create: `tests/al/dependencies/CG-AL-X004/CGX004Item.Table.al` (table 69630)
- Create: `tests/al/medium/CG-AL-X004.Test.al` (test codeunit 80293)
- Create: `tasks/medium/CG-AL-X004-list-then-insert.yml`
- Dev-only: `scratch/trap-probe/x004-correct/`, `scratch/trap-probe/x004-naive/`

**Interfaces:**
- Produces (model must implement): `codeunit 70930 "CG X004 Copier"` with `procedure CopyAToB(): Integer` returning the number of B rows created on that call.
- Consumes: prereq table `"CG X004 Item"` — `"Entry No." Integer` PK, `Category Code[1]`, `Tag Integer`.

- [ ] **Step 1: Write the prereq app + table**

`tests/al/dependencies/CG-AL-X004/app.json`:

```json
{
    "id": "a1b2c3d4-0a04-0000-0000-000000000001",
    "name": "CG-AL-X004 Prereq",
    "publisher": "CentralGauge",
    "version": "1.0.0.0",
    "platform": "27.0.0.0",
    "application": "27.0.0.0",
    "idRanges": [{ "from": 69630, "to": 69639 }],
    "runtime": "16.0",
    "features": ["NoImplicitWith"]
}
```

`tests/al/dependencies/CG-AL-X004/CGX004Item.Table.al`:

```al
table 69630 "CG X004 Item"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Category"; Code[1]) { }
        field(3; "Tag"; Integer) { }
    }
    keys { key(PK; "Entry No.") { Clustered = true; } }
}
```

- [ ] **Step 2: Write the oracle test (codeunit 80293)**

`tests/al/medium/CG-AL-X004.Test.al`:

```al
codeunit 80293 "CG-AL-X004 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Seed(CountA: Integer)
    var
        Item: Record "CG X004 Item";
        i: Integer;
    begin
        Item.DeleteAll();
        for i := 1 to CountA do begin
            Item.Init();
            Item."Entry No." := i;
            Item.Category := 'A';
            Item.Tag := i;
            Item.Insert();
        end;
        Commit();
    end;

    local procedure CountByCategory(Category: Code[1]): Integer
    var
        Item: Record "CG X004 Item";
    begin
        Item.SetRange(Category, Category);
        exit(Item.Count());
    end;

    [Test]
    procedure CopiesEachAtoExactlyOneB()
    var
        Copier: Codeunit "CG X004 Copier";
        Created: Integer;
    begin
        // [GIVEN] Four category-A items
        Seed(4);

        // [WHEN] The copy runs
        Created := Copier.CopyAToB();

        // [THEN] Exactly four category-B items now exist
        Assert.AreEqual(4, Created, 'CopyAToB reports four created');
        Assert.AreEqual(4, CountByCategory('B'), 'Exactly four B rows exist');
        Assert.AreEqual(4, CountByCategory('A'), 'A rows are untouched');
    end;

    [Test]
    procedure ReRunIsIdempotent()
    var
        Copier: Codeunit "CG X004 Copier";
    begin
        // [GIVEN] Four A items, already copied once
        Seed(4);
        Copier.CopyAToB();

        // [WHEN] The copy runs a second time
        Assert.AreEqual(0, Copier.CopyAToB(), 'Second run creates nothing new');

        // [THEN] Still exactly four B rows (no duplicates, no error)
        Assert.AreEqual(4, CountByCategory('B'), 'Still four B rows after re-run');
    end;
}
```

- [ ] **Step 3: Write the task YAML (no hints)**

`tasks/medium/CG-AL-X004-list-then-insert.yml`:

```yaml
id: CG-AL-X004
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  Using the existing "CG X004 Item" table (ID 69630), which has fields
  "Entry No." (Integer, primary key), "Category" (Code[1]), and "Tag" (Integer),
  create codeunit "CG X004 Copier" (ID 70930) with Access = Internal and:

      procedure CopyAToB(): Integer

  For every "CG X004 Item" whose "Category" is 'A', create one new "CG X004 Item"
  whose "Category" is 'B', whose "Tag" equals the source row's "Tag", and whose
  "Entry No." equals the source row's "Tag" plus 1000. If a row with that
  "Entry No." already exists, do not create or change it. The procedure returns
  the number of new rows it created on that call. Running CopyAToB more than once
  must never create duplicate 'B' rows and must never raise an error.
domains: [codeunits, records-runtime]
metadata:
  category: records-runtime
  tags: [list, find-set, idempotent, insert, iterate-safety]
  difficulty: medium
  cohort: ado-trap-2026
  source_pr: 50590
expected:
  compile: true
  testApp: tests/al/medium/CG-AL-X004.Test.al
  testCodeunitId: 80293
metrics:
  - compile_pass
  - tests_pass
  - pass_attempt
```

- [ ] **Step 4: Write the CORRECT reference (dev-only)**

`scratch/trap-probe/x004-correct/app.json` (idRanges 70930-70939) + `CGX004Copier.Codeunit.al`:

```al
codeunit 70930 "CG X004 Copier"
{
    Access = Internal;

    procedure CopyAToB(): Integer
    var
        Item: Record "CG X004 Item";
        Target: Record "CG X004 Item";
        Tags: List of [Integer];
        Tag: Integer;
        Created: Integer;
    begin
        // Read all source tags first, then insert — never insert while iterating.
        Item.SetRange(Category, 'A');
        if Item.FindSet() then
            repeat
                Tags.Add(Item.Tag);
            until Item.Next() = 0;

        foreach Tag in Tags do
            if not Target.Get(Tag + 1000) then begin
                Target.Init();
                Target."Entry No." := Tag + 1000;
                Target.Category := 'B';
                Target.Tag := Tag;
                Target.Insert();
                Created += 1;
            end;
        exit(Created);
    end;
}
```

- [ ] **Step 5: Probe the correct solution — expect PASS**

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X004 --solution scratch/trap-probe/x004-correct --expect pass`
Expected: `[trap-probe] OK`.

- [ ] **Step 6: Write the NAIVE reference (dev-only) — no idempotency guard**

`scratch/trap-probe/x004-naive/CGX004Copier.Codeunit.al`:

```al
codeunit 70930 "CG X004 Copier"
{
    Access = Internal;

    procedure CopyAToB(): Integer
    var
        Item: Record "CG X004 Item";
        Target: Record "CG X004 Item";
        Created: Integer;
    begin
        // Naive: inserts inside the loop with no Get-before-Insert guard.
        Item.SetRange(Category, 'A');
        if Item.FindSet() then
            repeat
                Target.Init();
                Target."Entry No." := Item.Tag + 1000;
                Target.Category := 'B';
                Target.Tag := Item.Tag;
                Target.Insert();
                Created += 1;
            until Item.Next() = 0;
        exit(Created);
    end;
}
```

- [ ] **Step 7: Probe the naive solution — expect FAIL**

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X004 --solution scratch/trap-probe/x004-naive --expect fail`
Expected: `[trap-probe] OK`. The `ReRunIsIdempotent` test re-runs the copy; the naive second insert hits the derived primary key that already exists → runtime "already exists" error → test fails → discrimination satisfied. If the naive solution unexpectedly passes both tests, the oracle is not discriminating → strengthen (e.g. assert the inner-loop insert-while-iterating also fails) and re-probe.

- [ ] **Step 8: Commit the task**

```bash
git add tasks/medium/CG-AL-X004-list-then-insert.yml tests/al/medium/CG-AL-X004.Test.al tests/al/dependencies/CG-AL-X004
git commit -m "feat(tasks): CG-AL-X004 list-then-insert idempotent copy (ado-trap-2026)

Probe: correct PASS, naive (no idempotency guard) FAIL.

Claude-Session: https://claude.ai/code/session_0176j51zPSS8PoShmasYUEMB"
```

---

## Task 5: CG-AL-X001 — bind must be inside the Codeunit.Run frame (HARD, probe-gated)

Source: PR 50285. **The trap:** a `Manual` event subscriber bound in the caller before `Codeunit.Run` does not reliably observe events raised inside the Run frame; the bind must happen inside `OnRun`. **This task's oracle is gated:** if the frame-isolation behavior does not reproduce deterministically on the container, X001 is dropped and replaced by a held-wave task (see Step 7 fallback).

**Files:**
- Create: `tests/al/dependencies/CG-AL-X001/app.json` (idRanges 69600-69619)
- Create: `tests/al/dependencies/CG-AL-X001/CGX001Counter.Table.al` (table 69600)
- Create: `tests/al/dependencies/CG-AL-X001/CGX001Publisher.Codeunit.al` (codeunit 69601)
- Create: `tests/al/dependencies/CG-AL-X001/CGX001AuditSub.Codeunit.al` (codeunit 69602, Manual)
- Create: `tests/al/hard/CG-AL-X001.Test.al` (test codeunit 80290)
- Create: `tasks/hard/CG-AL-X001-bind-inside-run-frame.yml`
- Dev-only: `scratch/trap-probe/x001-correct/`, `scratch/trap-probe/x001-naive/`

**Interfaces:**
- Produces (model must implement): `codeunit 70900 "CG X001 Worker"` with `procedure Process(ItemCount: Integer)` and a `trigger OnRun()`. The worker must run its per-item loop via `Codeunit.Run` and ensure the prereq `"CG X001 Audit Sub"` observes every raised event.
- Consumes: prereq `codeunit 69601 "CG X001 Publisher"` (`procedure Raise(ItemNo: Integer)` raising integration event `OnProcessItem`), `codeunit 69602 "CG X001 Audit Sub"` (`EventSubscriberInstance = Manual`, increments the counter on `OnProcessItem`), table 69600 `"CG X001 Counter"`.

- [ ] **Step 1: PROBE-GATE FIRST — confirm the frame-isolation behavior exists**

Before authoring, settle the empirical question. Build the prereq objects (Steps 2-3 below), a trivial worker that binds the manual subscriber **in the caller** before `Codeunit.Run`, and a second that binds **inside OnRun**. Run a throwaway test that raises one event inside the Run frame and reads the counter. Record both counters.

- If bind-in-caller → counter 0 AND bind-in-OnRun → counter 1: the trap reproduces. Proceed.
- If bind-in-caller also → counter 1 (or results are nondeterministic across two runs): the trap does NOT reproduce deterministically. **Skip to Step 7 (fallback) and do not author X001.**

Record the outcome in `docs/superpowers/plans/x001-probe-note.md` either way.

- [ ] **Step 2: Write the prereq counter table + publisher**

`tests/al/dependencies/CG-AL-X001/app.json`:

```json
{
    "id": "a1b2c3d4-0a01-0000-0000-000000000001",
    "name": "CG-AL-X001 Prereq",
    "publisher": "CentralGauge",
    "version": "1.0.0.0",
    "platform": "27.0.0.0",
    "application": "27.0.0.0",
    "idRanges": [{ "from": 69600, "to": 69619 }],
    "runtime": "16.0",
    "features": ["NoImplicitWith"]
}
```

`tests/al/dependencies/CG-AL-X001/CGX001Counter.Table.al`:

```al
table 69600 "CG X001 Counter"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Count"; Integer) { }
    }
    keys { key(PK; "Primary Key") { Clustered = true; } }
}
```

`tests/al/dependencies/CG-AL-X001/CGX001Publisher.Codeunit.al`:

```al
codeunit 69601 "CG X001 Publisher"
{
    procedure Raise(ItemNo: Integer)
    begin
        OnProcessItem(ItemNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnProcessItem(ItemNo: Integer)
    begin
    end;
}
```

- [ ] **Step 3: Write the Manual audit subscriber**

`tests/al/dependencies/CG-AL-X001/CGX001AuditSub.Codeunit.al`:

```al
codeunit 69602 "CG X001 Audit Sub"
{
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X001 Publisher", 'OnProcessItem', '', false, false)]
    local procedure OnProcessItem(ItemNo: Integer)
    var
        Counter: Record "CG X001 Counter";
    begin
        if not Counter.Get('') then begin
            Counter.Init();
            Counter."Primary Key" := '';
            Counter.Insert();
        end;
        Counter."Count" += 1;
        Counter.Modify();
    end;
}
```

- [ ] **Step 4: Write the oracle test (codeunit 80290)**

`tests/al/hard/CG-AL-X001.Test.al`:

```al
codeunit 80290 "CG-AL-X001 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure SubscriberObservesEveryEventRaisedDuringRun()
    var
        Worker: Codeunit "CG X001 Worker";
        Counter: Record "CG X001 Counter";
    begin
        // [GIVEN] A clean counter
        Counter.DeleteAll();
        Commit();

        // [WHEN] The worker processes five items through its Run frame
        Worker.Process(5);

        // [THEN] The manual audit subscriber observed all five events
        Counter.Get('');
        Assert.AreEqual(5, Counter."Count", 'Subscriber must observe every event raised inside the Run frame');
    end;
}
```

- [ ] **Step 5: Write the task YAML (no hints)**

`tasks/hard/CG-AL-X001-bind-inside-run-frame.yml`:

```yaml
id: CG-AL-X001
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  Use the existing "CG X001 Publisher" codeunit (ID 69601), whose procedure
  Raise(ItemNo: Integer) raises an integration event, and the existing manual
  event-subscriber codeunit "CG X001 Audit Sub" (ID 69602), which counts those
  events.

  Create codeunit "CG X001 Worker" (ID 70900) with Access = Internal and:

      procedure Process(ItemCount: Integer)
      trigger OnRun()

  Process must perform its work by invoking the worker through Codeunit.Run. The
  work, performed inside OnRun, calls "CG X001 Publisher".Raise(i) once for each i
  from 1 to ItemCount. The "CG X001 Audit Sub" subscriber must observe every one
  of those raised events during the run.
domains: [codeunits, interfaces-events]
metadata:
  category: interfaces-events
  tags: [bindsubscription, manual-subscriber, codeunit-run, event-frame]
  difficulty: hard
  cohort: ado-trap-2026
  source_pr: 50285
expected:
  compile: true
  testApp: tests/al/hard/CG-AL-X001.Test.al
  testCodeunitId: 80290
metrics:
  - compile_pass
  - tests_pass
  - pass_attempt
```

- [ ] **Step 6: Write both references + probe (correct PASS, naive FAIL)**

`scratch/trap-probe/x001-correct/CGX001Worker.Codeunit.al` (app.json idRanges 70900-70909):

```al
codeunit 70900 "CG X001 Worker"
{
    Access = Internal;
    var
        Items: Integer;

    procedure Process(ItemCount: Integer)
    begin
        Items := ItemCount;
        Codeunit.Run(Codeunit::"CG X001 Worker");
    end;

    trigger OnRun()
    var
        AuditSub: Codeunit "CG X001 Audit Sub";
        Publisher: Codeunit "CG X001 Publisher";
        i: Integer;
    begin
        BindSubscription(AuditSub);
        for i := 1 to Items do
            Publisher.Raise(i);
        UnbindSubscription(AuditSub);
    end;
}
```

`scratch/trap-probe/x001-naive/CGX001Worker.Codeunit.al` — binds in the caller before `Codeunit.Run`:

```al
codeunit 70900 "CG X001 Worker"
{
    Access = Internal;
    var
        Items: Integer;
        AuditSub: Codeunit "CG X001 Audit Sub";

    procedure Process(ItemCount: Integer)
    begin
        Items := ItemCount;
        BindSubscription(AuditSub);
        Codeunit.Run(Codeunit::"CG X001 Worker");
        UnbindSubscription(AuditSub);
    end;

    trigger OnRun()
    var
        Publisher: Codeunit "CG X001 Publisher";
        i: Integer;
    begin
        for i := 1 to Items do
            Publisher.Raise(i);
    end;
}
```

Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X001 --solution scratch/trap-probe/x001-correct --expect pass`
Run: `deno run -A scripts/trap-probe.ts --task CG-AL-X001 --solution scratch/trap-probe/x001-naive --expect fail`
Both must print `[trap-probe] OK`. If either mismatches, the trap is not cleanly discriminating → go to Step 7.

- [ ] **Step 7: FALLBACK if the gate fails — held-wave swap (TryFunction write-ban)**

If Step 1 or Step 6 shows X001 is non-discriminating, do NOT ship it. Instead author the held-wave trap **TryFunction-write-ban** as `CG-AL-X001` (reuse the id and cohort slot): a task requiring a procedure that attempts a database write, where the correct solution uses `Codeunit.Run` (returns Boolean success) and the naive `[TryFunction]` wrapping the write fails to compile. This mirrors X002's compile-discrimination and is deterministic. Author it with the same prereq/test/probe structure (new prereq under `tests/al/dependencies/CG-AL-X001/`, test `tests/al/hard/CG-AL-X001.Test.al` codeunit 80290), and record the swap in `x001-probe-note.md`.

- [ ] **Step 8: Commit the shipped task (X001 or its fallback)**

```bash
git add tasks/hard/CG-AL-X001-*.yml tests/al/hard/CG-AL-X001.Test.al tests/al/dependencies/CG-AL-X001 docs/superpowers/plans/x001-probe-note.md
git commit -m "feat(tasks): CG-AL-X001 bind-inside-Run-frame (ado-trap-2026)

Probe-gated; see x001-probe-note.md for the frame-isolation outcome.

Claude-Session: https://claude.ai/code/session_0176j51zPSS8PoShmasYUEMB"
```

---

## Task 6: The `extract-trap-task` skill (codify the proven method)

Author the pipeline skill only AFTER the first batch is built, so it documents a method that actually worked.

**Files:**
- Create: `.claude/skills/extract-trap-task/SKILL.md`
- Create: `.claude/skills/extract-trap-task/reference/containment-policy.md`

**Interfaces:**
- Consumes: `scripts/trap-probe.ts` (Task 1), the `create-task` + `validate-tasks` commands, the `refresh-task-taxonomy` skill.
- Produces: a documented 6-stage workflow (SELECT → EXTRACT → DISTILL → AUTHOR → DISCRIMINATION PROBE → VALIDATE+REGISTER) an operator runs against any approved ADO PR.

- [ ] **Step 1: Write `SKILL.md`**

Create `.claude/skills/extract-trap-task/SKILL.md` with YAML frontmatter (`name: extract-trap-task`, a `description` covering "turn an approved ADO PR into hard CentralGauge trap-tasks") and the six stages from the spec (`docs/superpowers/specs/2026-06-30-ado-pr-trap-tasks-design.md`, Part A). The body MUST include:
- The core insight: comment-justified PR decisions = latent traps. Quote the four worked examples from the spec.
- Per-stage instructions, naming the concrete tools: `mcp__azureDevOps__get_pull_request_changes` + `get_work_item` for EXTRACT; `containment-policy.md` for DISTILL; the `create-task` conventions for AUTHOR; `scripts/trap-probe.ts --expect pass|fail` for the PROBE gate; `validate-tasks`, dry-run, `sync-catalog --apply`, `refresh-task-taxonomy` for REGISTER.
- The hard gate, verbatim: "ship a task only if the correct reference PASSES and the naive reference FAILS the same oracle on a real container."
- The marking convention (X ids + `metadata.cohort` + `metadata.source_pr`).

- [ ] **Step 2: Write `reference/containment-policy.md`**

Create the containment decision checklist: distill a trap to self-contained AL unless the trap IS a base-app behavior (then keep the base-app object). Include the X001-X004 batch as worked examples (3 self-contained, 1 base-app-faithful).

- [ ] **Step 3: Verify the skill loads + reads cleanly**

Run: `ls .claude/skills/extract-trap-task/` and confirm both files exist. Read `SKILL.md` back and confirm no placeholders, every stage names a concrete tool, and the gate text is present.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/extract-trap-task
git commit -m "feat(skill): extract-trap-task ADO-PR -> trap-task pipeline

Claude-Session: https://claude.ai/code/session_0176j51zPSS8PoShmasYUEMB"
```

---

## Task 7: Validate, mark-verify, and dry-run the batch

**Files:**
- Modify (if validation flags anything): the four task YAMLs.

- [ ] **Step 1: Schema + guidance validation**

Run the `validate-tasks` command over the four new tasks. Confirm: all four load under the Zod schema, no GUIDANCE/MISSING_CONTEXT flags (descriptions reference their prereq objects + IDs), `metadata.category` is one of the 9 valid groups.

Manually confirm with a load smoke-test:
Run: `deno run -A -e 'import { parseTaskManifest } from "./src/tasks/interfaces.ts"; import { parse } from "@std/yaml"; for (const f of ["tasks/hard/CG-AL-X001-bind-inside-run-frame.yml","tasks/hard/CG-AL-X002-codeunit-run-rollback.yml","tasks/hard/CG-AL-X003-changelog-activated-gate.yml","tasks/medium/CG-AL-X004-list-then-insert.yml"]) { parseTaskManifest(parse(Deno.readTextFileSync(f)), f); console.log("OK", f); }'`
Expected: `OK` for all four (or whichever X001 variant shipped).

- [ ] **Step 2: Verify the cohort divider works**

Run: `git ls-files "tasks/**/CG-AL-X*.yml"`
Expected: exactly the four new task files. Confirms `tasks/**/CG-AL-X*.yml` selects the cohort and the legacy `CG-AL-[EMH]*` set is disjoint.

- [ ] **Step 3: Confirm difficulty plumbing (spec open note)**

Grep where `metadata.difficulty` is consumed:
Run: `grep -rn "metadata.difficulty\|\.difficulty" src/ cli/ site/src/lib/server | grep -iv test | head`
If the leaderboard/taxonomy reads `metadata.difficulty`, the explicit fields set in each YAML suffice. If only `inferDifficulty` (description keywords) is consulted, confirm each hard task's description carries a natural complexity signal or accept the inferred value. Record the finding in a one-line comment on the plan; no code change unless a task mis-tiers.

- [ ] **Step 4: Local dry-run bench (no ingest)**

Run a dry-run over the cohort to confirm the bench harness loads and routes them (never a live submission, per project rule):
Run: `deno task start bench --llms mock --tasks "tasks/**/CG-AL-X*.yml" --dry-run --no-ingest`
Expected: all four tasks enumerated and planned without error. (Confirm the exact dry-run flag name from `cli/commands/bench` if `--dry-run` differs.)

- [ ] **Step 5: Final probe sweep (regression)**

Re-run all shipped correct + naive probes in one pass to confirm the batch still discriminates end to end:
```bash
for t in X001 X002 X003 X004; do
  deno run -A scripts/trap-probe.ts --task CG-AL-$t --solution scratch/trap-probe/${t,,}-correct --expect pass || echo "FAIL correct $t"
  deno run -A scripts/trap-probe.ts --task CG-AL-$t --solution scratch/trap-probe/${t,,}-naive --expect fail || echo "FAIL naive $t"
done
```
Expected: no `FAIL` lines.

- [ ] **Step 6: Commit any validation fixes + a batch note**

```bash
git add tasks docs/superpowers/plans
git commit -m "chore(tasks): validate + dry-run ado-trap-2026 first batch

Claude-Session: https://claude.ai/code/session_0176j51zPSS8PoShmasYUEMB"
```

---

## Self-Review

**Spec coverage:**
- Pipeline (6 stages) → Task 6 (skill) + Task 1 (probe infra). ✓
- Discrimination probe → Task 1 + every task's probe steps. ✓
- First batch X001-X004 → Tasks 2-5. ✓ (risk order: X002, X003, X004, then probe-gated X001.)
- Mix-per-pattern containment → X001/X002/X004 self-contained, X003 base-app-faithful. ✓
- Marking convention (X ids + cohort + source_pr) → every YAML + Task 7 Step 2. ✓
- Scope guards (no ingest, no Continia objects, held-wave fallback) → Global Constraints + Task 5 Step 7. ✓
- Difficulty open note → Task 7 Step 3. ✓

**Placeholder scan:** No TBD/TODO. The two "if the probe shows X, redesign/drop" branches (X001 gate, X003 always-logged premise) are explicit decision steps with concrete fallbacks, not placeholders. The `--dry-run` flag carries a "confirm exact name" note because it is the one command not yet verified against source.

**Type consistency:** `handleAlVerifyTask` signature matches Task 1 export. Codeunit/table names and IDs are consistent across each task's prereq, test, YAML, and reference solutions (`CG X00N ...` names; tables 696xx; model code 709x0; tests 8029x). `CopyAToB`, `RunOnce`, `WouldLogSalesInvoiceChanges`, `Process` are referenced identically in each task's test and reference solution.

**Known soft spots (carried as in-task gates, not silent):** X001 frame-isolation reproduction (Task 5 Step 1 gate + fallback), X003 `IsAlwaysLoggedTable` premise on the container (Task 3 Step 5 branch), X004 secondary iterate-safety check (Task 4 Step 7 — primary idempotency discriminator is deterministic regardless).
