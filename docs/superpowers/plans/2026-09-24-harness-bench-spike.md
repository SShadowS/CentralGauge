# Harness Bench Spike (M0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the measurable unknowns in spec 1a section 13 with real containers and real harnesses, and record the answers in a findings doc that the M1 to M4 plans are written from.

**Architecture:** Throwaway measurement scripts under `scripts/spikes/harness/`, one refapp skeleton (7 apps, the fixed acyclic graph) that later seeds spec 1b, and one spike sandbox image carrying both Claude Code and pi. Only three outputs survive the spike: the findings doc, the refapp skeleton, and the recorded harness log fixtures under `tests/fixtures/harness/`.

**Tech Stack:** Deno + TypeScript (existing `BcContainerProvider`), PowerShell, Windows containers (servercore ltsc2025), Claude Code 2.1.282, pi (`@earendil-works/pi-coding-agent`) 0.87.1, AL Tools NuGet, Laya (local decision model), Python for the Laya call.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a) and `docs/superpowers/specs/2026-09-24-harness-refapp-design.md` (1b).

## Global Constraints

- Spike code is throwaway. Do not import it from `src/` or `cli/`. Label every spike file header `// SPIKE (throwaway): harness bench M0`.
- Never run container-touching work while a bench is live: check `find results/.bench-running.json -mmin -2` first; if it prints a path, stop.
- Docker commands against Windows containers are prefixed `DOCKER_CONTEXT=desktop-windows` when run ad hoc (CLAUDE.md: ad-hoc operator commands are not covered by the pin).
- Refapp ID bands: 70000-74999 objects (sub-range per module), 80000-84999 `Test` app. Never use 75000-79999.
- App manifests: `"platform": "28.0.0.0"`, `"application": "28.0.0.0"`, `"runtime": "17.0"`, `"features": ["NoImplicitWith"]`, publisher `CentralGauge` (so `prenukeCentralGaugeApps` cleans them).
- App ids are hex GUIDs: `c6a1e000-0000-4000-8000-00000000000N`, N = 1 Core, 2 Fleet, 3 Rental, 4 Leasing, 5 Integration, 6 Reporting, 7 Test.
- Secrets never go through `docker run -e`. They are files under a read-only `C:\cg-secrets` mount.
- Model ids are never hardcoded in spike scripts; they are CLI parameters. Discover names with `deno task start models -p <provider> --live`.
- Bulky diagnostic output (raw harness logs, timing traces) goes to `H:\Temp3\harness-spike\`, not the repo. Only sanitized fixtures are committed.
- No em dash in any committed text.
- Spike deadline: 2026-09-29. The findings doc gates the M1 to M4 plans.

## Review Focus

1. **A leftover published app from a previous timing run** makes the next publish fail with "same App ID and Version". Expected: every timing run starts with `prenukeCentralGaugeApps`. Pinned in Task 2 Step 2 (script calls prenuke before each run) and Step 4 (run twice back to back; second run must succeed).
2. **An API key ends up in a committed fixture.** Captured stream-json and pi JSON can echo environment or config. Expected: fixtures are redacted before commit and a check refuses a fixture containing any secret value. Pinned in Task 4 Step 5.
3. **A hard-killed sandbox leaves an orphan container** that holds a port or a mount. Expected: every spike container is named `cg-harness-spike-*` and `run-sandbox.ts` removes it in `finally`. Pinned in Task 3 Step 6 (kill test, then `docker ps -a --filter name=cg-harness-spike` must be empty).
4. **The backend accepts a path outside the workspace** (`..\\` in the app name). Expected: 400. Pinned in Task 5 Step 4.
5. **The docker context has flipped** and containers appear absent. Expected: the spike reports "container not found under context X" instead of a timing of zero. Pinned in Task 2 Step 3 (script asserts `isHealthy` first and prints the context).

---

### Task 1: Refapp skeleton with the fixed dependency graph

Seven minimal apps that exercise every cross-app coupling style from spec 1b section 3 and the acyclic graph: Core; Fleet -> Core; Rental -> Core, Fleet; Leasing -> Core; Integration -> Core; Reporting -> Rental, Leasing, Fleet; Test -> all.

**Files:**
- Create: `harness-tasks/refapp/Core/app.json`, `harness-tasks/refapp/Core/src/CoreEvents.Codeunit.al`, `harness-tasks/refapp/Core/src/MaintenanceStrategy.Interface.al`, `harness-tasks/refapp/Core/src/MaintenanceStrategy.Enum.al`, `harness-tasks/refapp/Core/src/DefaultMaintenance.Codeunit.al`, `harness-tasks/refapp/Core/src/LeaseMath.Codeunit.al`
- Create: `harness-tasks/refapp/Fleet/app.json`, `harness-tasks/refapp/Fleet/src/Vehicle.Table.al`, `harness-tasks/refapp/Fleet/src/FleetMgt.Codeunit.al`, `harness-tasks/refapp/Fleet/src/FleetStrategies.EnumExt.al`, `harness-tasks/refapp/Fleet/src/HeavyDutyMaintenance.Codeunit.al`
- Create: `harness-tasks/refapp/Rental/app.json`, `harness-tasks/refapp/Rental/src/RentalMgt.Codeunit.al`
- Create: `harness-tasks/refapp/Leasing/app.json`, `harness-tasks/refapp/Leasing/src/LeaseMgt.Codeunit.al`
- Create: `harness-tasks/refapp/Integration/app.json`, `harness-tasks/refapp/Integration/src/IntegrationFacade.Codeunit.al`
- Create: `harness-tasks/refapp/Reporting/app.json`, `harness-tasks/refapp/Reporting/src/VehicleStatus.Query.al`
- Create: `harness-tasks/refapp/Test/app.json`, `harness-tasks/refapp/Test/src/SkeletonTests.Codeunit.al`
- Create: `harness-tasks/refapp/.gitignore`

**Interfaces:**
- Produces: app folder names `Core, Fleet, Rental, Leasing, Integration, Reporting, Test` and the build order constant used by Task 2: `["Core","Fleet","Rental","Leasing","Integration","Reporting","Test"]`. Test codeunit id `80000`.

- [ ] **Step 1: Write the manifests**

`harness-tasks/refapp/Core/app.json`:
```json
{
  "id": "c6a1e000-0000-4000-8000-000000000001",
  "name": "CGR Core",
  "publisher": "CentralGauge",
  "version": "1.0.0.0",
  "platform": "28.0.0.0",
  "application": "28.0.0.0",
  "idRanges": [{ "from": 70000, "to": 70099 }],
  "runtime": "17.0",
  "target": "OnPrem",
  "features": ["NoImplicitWith"],
  "internalsVisibleTo": [
    { "id": "c6a1e000-0000-4000-8000-000000000004", "name": "CGR Leasing", "publisher": "CentralGauge" }
  ]
}
```

For every other app, same shape with these values (dependencies are `{ "id", "name", "publisher": "CentralGauge", "version": "1.0.0.0" }` entries, no `internalsVisibleTo`):

| Folder | id suffix | name | idRanges | dependencies |
| --- | --- | --- | --- | --- |
| Fleet | 2 | CGR Fleet | 70100-70199 | Core |
| Rental | 3 | CGR Rental | 70200-70299 | Core, Fleet |
| Leasing | 4 | CGR Leasing | 70300-70399 | Core |
| Integration | 5 | CGR Integration | 70400-70499 | Core |
| Reporting | 6 | CGR Reporting | 70500-70599 | Rental, Leasing, Fleet |
| Test | 7 | CGR Test | 80000-80099 | Core, Fleet, Rental, Leasing, Integration, Reporting, plus `{ "id": "dd0be2ea-f733-4d65-bb34-a28f4624fb14", "name": "Library Assert", "publisher": "Microsoft", "version": "28.0.0.0" }` |

`harness-tasks/refapp/.gitignore`:
```
.alpackages/
output/
*.app
```

- [ ] **Step 2: Write Core**

`CoreEvents.Codeunit.al`:
```al
codeunit 70000 "CGR Core Events"
{
    procedure RaiseVehicleCheckedOut(VehicleNo: Code[20])
    begin
        OnAfterVehicleCheckedOut(VehicleNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterVehicleCheckedOut(VehicleNo: Code[20])
    begin
    end;
}
```

`MaintenanceStrategy.Interface.al`:
```al
interface "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer;
}
```

`MaintenanceStrategy.Enum.al`:
```al
enum 70000 "CGR Maintenance Strategy" implements "CGR Maintenance Strategy"
{
    Extensible = true;

    value(0; Default)
    {
        Implementation = "CGR Maintenance Strategy" = "CGR Default Maintenance";
    }
}
```

`DefaultMaintenance.Codeunit.al`:
```al
codeunit 70001 "CGR Default Maintenance" implements "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 15000);
    end;
}
```

`LeaseMath.Codeunit.al`:
```al
codeunit 70002 "CGR Lease Math"
{
    internal procedure RateFactor(Months: Integer): Decimal
    begin
        exit(1 + Months / 100);
    end;
}
```

- [ ] **Step 3: Write Fleet**

`Vehicle.Table.al`:
```al
table 70100 "CGR Vehicle"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Mileage; Integer) { }
        field(3; "Checked Out"; Boolean) { }
        field(4; Strategy; Enum "CGR Maintenance Strategy") { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
```

`FleetMgt.Codeunit.al`:
```al
codeunit 70100 "CGR Fleet Mgt"
{
    procedure IsAvailable(VehicleNo: Code[20]): Boolean
    var
        Vehicle: Record "CGR Vehicle";
        Result: Boolean;
        IsHandled: Boolean;
    begin
        OnBeforeIsAvailable(VehicleNo, Result, IsHandled);
        if IsHandled then
            exit(Result);
        if not Vehicle.Get(VehicleNo) then
            exit(false);
        exit(not Vehicle."Checked Out");
    end;

    procedure NextServiceKm(VehicleNo: Code[20]): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Strategy: Interface "CGR Maintenance Strategy";
    begin
        Vehicle.Get(VehicleNo);
        Strategy := Vehicle.Strategy;
        exit(Strategy.NextServiceKm(Vehicle.Mileage));
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeIsAvailable(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    begin
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure MarkCheckedOut(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
    end;
}
```

`FleetStrategies.EnumExt.al`:
```al
enumextension 70100 "CGR Fleet Strategies" extends "CGR Maintenance Strategy"
{
    value(70100; "Heavy Duty")
    {
        Implementation = "CGR Maintenance Strategy" = "CGR Heavy Duty Maintenance";
    }
}
```

`HeavyDutyMaintenance.Codeunit.al`:
```al
codeunit 70101 "CGR Heavy Duty Maintenance" implements "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 5000);
    end;
}
```

- [ ] **Step 4: Write Rental, Leasing, Integration, Reporting**

`Rental/src/RentalMgt.Codeunit.al` (legacy direct call to Fleet, plus raising through the Core facade so Fleet reacts without depending on Rental):
```al
codeunit 70200 "CGR Rental Mgt"
{
    var
        NotAvailableErr: Label 'Vehicle %1 is not available.', Comment = '%1 = vehicle number';

    procedure CheckOut(VehicleNo: Code[20])
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
        CoreEvents: Codeunit "CGR Core Events";
    begin
        if not FleetMgt.IsAvailable(VehicleNo) then
            Error(NotAvailableErr, VehicleNo);
        CoreEvents.RaiseVehicleCheckedOut(VehicleNo);
    end;
}
```

`Leasing/src/LeaseMgt.Codeunit.al` (uses a Core `internal` procedure via `internalsVisibleTo`):
```al
codeunit 70300 "CGR Lease Mgt"
{
    procedure MonthlyRate(BaseRate: Decimal; Months: Integer): Decimal
    var
        LeaseMath: Codeunit "CGR Lease Math";
    begin
        exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));
    end;
}
```

`Integration/src/IntegrationFacade.Codeunit.al`:
```al
codeunit 70400 "CGR Integration Facade"
{
    procedure VehicleCheckedOutPayload(VehicleNo: Code[20]): Text
    var
        Payload: JsonObject;
        Result: Text;
    begin
        Payload.Add('event', 'vehicleCheckedOut');
        Payload.Add('vehicleNo', VehicleNo);
        Payload.WriteTo(Result);
        exit(Result);
    end;
}
```

`Reporting/src/VehicleStatus.Query.al`:
```al
query 70500 "CGR Vehicle Status"
{
    QueryType = Normal;

    elements
    {
        dataitem(Vehicle; "CGR Vehicle")
        {
            column(VehicleNo; "No.") { }
            column(CheckedOut; "Checked Out") { }
            column(Mileage; Mileage) { }
        }
    }
}
```

- [ ] **Step 5: Write the Test app**

`Test/src/SkeletonTests.Codeunit.al`:
```al
codeunit 80000 "CGR Skeleton Tests"
{
    Subtype = Test;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure CheckOutMarksVehicleCheckedOut()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        CreateVehicle('SPIKE-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        RentalMgt.CheckOut('SPIKE-001');
        Vehicle.Get('SPIKE-001');
        Assert.IsTrue(Vehicle."Checked Out", 'Fleet subscriber must mark the vehicle checked out');
    end;

    [Test]
    procedure CheckOutTwiceFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        CreateVehicle('SPIKE-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        RentalMgt.CheckOut('SPIKE-002');
        asserterror RentalMgt.CheckOut('SPIKE-002');
        Assert.ExpectedError('Vehicle SPIKE-002 is not available.');
    end;

    [Test]
    procedure HeavyDutyStrategyFromFleetExtension()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        CreateVehicle('SPIKE-003', 1000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('SPIKE-003'), 'Heavy Duty adds 5000 km (Integer vs Integer)');
    end;

    [Test]
    procedure LeaseRateUsesCoreInternal()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Expected: Decimal;
    begin
        Expected := 112;
        Assert.AreEqual(Expected, LeaseMgt.MonthlyRate(100, 12), '12 months adds 12 percent');
    end;

    [Test]
    procedure PayloadCarriesVehicleNo()
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"SPIKE-004"}',
            Facade.VehicleCheckedOutPayload('SPIKE-004'), 'Payload shape');
    end;

    local procedure CreateVehicle(VehicleNo: Code[20]; Mileage: Integer; Strategy: Enum "CGR Maintenance Strategy")
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Strategy;
        Vehicle.Insert();
    end;
}
```

- [ ] **Step 6: Check ids**

Run: `deno task id-audit`
Expected: no failure mentioning `harness-tasks/refapp`. If the audit does not scan `harness-tasks/` yet, note that in the findings doc (M1 extends it) and grep manually: `grep -rhoE "^(codeunit|table|enum|enumextension|query) [0-9]+" harness-tasks/refapp | sort` shows only 70000-70599 and 80000.

Compilation is verified in Task 2; this task has no standalone compile step because each app needs its dependencies' `.app` files.

- [ ] **Step 7: Commit**

```bash
git add harness-tasks/refapp
git commit -m "feat(harness): refapp skeleton, 7 apps on the fixed dependency graph"
```

---

### Task 2: Multi-app compile, publish and test timing

**Files:**
- Create: `scripts/spikes/harness/multiapp-timing.ts`

**Interfaces:**
- Consumes: `BcContainerProvider` from `src/container/bc-container-provider.ts`: `compileProject(containerName, project: ALProject): Promise<CompilationResult>` (`artifactPath` on success), `publishApp(containerName, appPath): Promise<void>`, `runTests(containerName, project, appFilePath?, testCodeunitId?): Promise<TestResult>`, `prenukeCentralGaugeApps(names)`, `ensureTestHarness(names)`, `isHealthy(name)`. `ALProject = { path, appJson, sourceFiles, testFiles }` from `src/container/types.ts`.
- Produces: `H:\Temp3\harness-spike\multiapp-<stamp>.json` with `{ set, run, spans: { [app]: { compileMs, publishMs } }, testMs, testsPassed, testsTotal }[]`, summarized in the findings doc.

- [ ] **Step 1: Write the script**

```ts
// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/multiapp-timing.ts <container> [runs]
import { join } from "@std/path";
import type { ALProject } from "../../../src/container/types.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

const ORDER = ["Core", "Fleet", "Rental", "Leasing", "Integration", "Reporting", "Test"];
const SETS: Record<string, string[]> = {
  "3-app": ["Core", "Fleet", "Rental"],
  "7-app": ORDER,
};
const REFAPP = join(Deno.cwd(), "harness-tasks", "refapp");
const OUT_DIR = "H:\\Temp3\\harness-spike";

async function stageCopy(apps: string[], runDir: string): Promise<void> {
  for (const app of apps) {
    const src = join(REFAPP, app);
    const dst = join(runDir, app);
    await Deno.mkdir(join(dst, "src"), { recursive: true });
    await Deno.copyFile(join(src, "app.json"), join(dst, "app.json"));
    for await (const e of Deno.readDir(join(src, "src"))) {
      await Deno.copyFile(join(src, "src", e.name), join(dst, "src", e.name));
    }
  }
}

async function loadProject(dir: string): Promise<ALProject> {
  const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
  const files: string[] = [];
  for await (const e of Deno.readDir(join(dir, "src"))) files.push(join(dir, "src", e.name));
  return { path: dir, appJson, sourceFiles: files, testFiles: [] };
}

async function main() {
  const container = Deno.args[0];
  const runs = Number(Deno.args[1] ?? "3");
  if (!container) throw new Error("usage: multiapp-timing.ts <container> [runs]");
  console.log(`[spike] DOCKER_CONTEXT=${Deno.env.get("DOCKER_CONTEXT") ?? "(inherited)"}`);

  const provider = new BcContainerProvider();
  if (!(await provider.isHealthy(container))) {
    throw new Error(`container ${container} not healthy/visible under current docker context`);
  }
  await provider.ensureTestHarness([container]);
  await Deno.mkdir(OUT_DIR, { recursive: true });
  const rows: unknown[] = [];

  for (const [set, apps] of Object.entries(SETS)) {
    for (let run = 1; run <= runs; run++) {
      await provider.prenukeCentralGaugeApps([container]);
      const runDir = await Deno.makeTempDir({ prefix: `cg-harness-spike-${set}-` });
      await stageCopy(apps, runDir);
      const built: string[] = [];
      const spans: Record<string, { compileMs: number; publishMs: number }> = {};
      let testMs = 0, testsPassed = 0, testsTotal = 0;

      for (const app of apps) {
        const dir = join(runDir, app);
        await Deno.mkdir(join(dir, ".alpackages"), { recursive: true });
        for (const dep of built) await Deno.copyFile(dep, join(dir, ".alpackages", dep.split(/[/\\]/).pop()!));
        const project = await loadProject(dir);

        const c0 = Date.now();
        const compiled = await provider.compileProject(container, project);
        const compileMs = Date.now() - c0;
        if (!compiled.success || !compiled.artifactPath) {
          throw new Error(`${app} failed to compile: ${compiled.errors.map((e) => `${e.code} ${e.message}`).join("; ")}`);
        }

        if (app === "Test") {
          const t0 = Date.now();
          const result = await provider.runTests(container, project, compiled.artifactPath, 80000);
          testMs = Date.now() - t0;
          testsPassed = result.passedTests;
          testsTotal = result.totalTests;
          spans[app] = { compileMs, publishMs: 0 };
        } else {
          const p0 = Date.now();
          await provider.publishApp(container, compiled.artifactPath);
          spans[app] = { compileMs, publishMs: Date.now() - p0 };
        }
        built.push(compiled.artifactPath);
      }
      const row = { set, run, spans, testMs, testsPassed, testsTotal };
      console.log(JSON.stringify(row));
      rows.push(row);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await Deno.writeTextFile(join(OUT_DIR, `multiapp-${stamp}.json`), JSON.stringify(rows, null, 2));
  await provider.prenukeCentralGaugeApps([container]);
  await provider.dispose();
}

await main();
```

- [ ] **Step 2: Type-check**

Run: `deno check scripts/spikes/harness/multiapp-timing.ts`
Expected: no errors. If `TestResult` names differ from `passedTests`/`totalTests`, read `src/container/types.ts` `interface TestResult` and use its field names.

- [ ] **Step 3: Confirm no bench is live, then run once**

Run: `find results/.bench-running.json -mmin -2` (expect no output), then
`DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/spikes/harness/multiapp-timing.ts Cronus28 1`
Expected: two JSON rows; the `7-app` row shows `testsPassed: 5, testsTotal: 5`. A compile error here is a skeleton bug: fix the AL in Task 1's files, amend nothing, commit the fix separately.

- [ ] **Step 4: Run the measurement**

Run: `DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/spikes/harness/multiapp-timing.ts Cronus28 3`
Expected: 6 rows, every run succeeds (proves prenuke clears the previous run's apps). Record in the findings doc: median compile and publish per app, median 3-app total, median 7-app total including test, and the ratio 7-app / today's single-candidate `prepare-candidate` span (14.6 s, CLAUDE.md).

- [ ] **Step 5: Commit**

```bash
git add scripts/spikes/harness/multiapp-timing.ts
git commit -m "chore(spike): harness multi-app compile/publish/test timing"
```

---

### Task 3: Spike sandbox image with Claude Code and pi

**Files:**
- Create: `scripts/spikes/harness/image/Dockerfile.windows`
- Create: `scripts/spikes/harness/image/run-claude.ps1`
- Create: `scripts/spikes/harness/image/run-pi.ps1`
- Create: `scripts/spikes/harness/run-sandbox.ts`

**Interfaces:**
- Produces: image tag `centralgauge/harness-spike:windows`; `run-sandbox.ts <harness> <model> <workspaceDir> <promptFile> [--kill-after-s N] [--mcp-config file]` writing captured stdout to `H:\Temp3\harness-spike\<harness>-<stamp>.jsonl` and stderr to `.stderr.txt`. Used by Tasks 4, 5 and 6.

- [ ] **Step 1: Write the Dockerfile**

Based on `docker/agent-sandbox/Dockerfile.windows`, with pinned versions and both harnesses:

```dockerfile
# SPIKE (throwaway): harness bench M0
FROM mcr.microsoft.com/windows/servercore:ltsc2025
SHELL ["powershell", "-Command", "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue';"]

RUN Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi' -OutFile 'nodejs.msi'; \
    Start-Process msiexec.exe -ArgumentList '/i', 'nodejs.msi', '/quiet', '/norestart' -Wait; \
    Remove-Item -Force nodejs.msi; \
    [Environment]::SetEnvironmentVariable('PATH', 'C:\Program Files\nodejs;' + $env:PATH, [EnvironmentVariableTarget]::Machine)

RUN Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/PortableGit-2.47.1-64-bit.7z.exe' -OutFile 'git-portable.exe'; \
    Start-Process -FilePath '.\git-portable.exe' -ArgumentList '-o', 'C:\Git', '-y' -Wait; \
    Remove-Item -Force git-portable.exe; \
    [Environment]::SetEnvironmentVariable('PATH', 'C:\Git\cmd;C:\Git\bin;C:\Git\usr\bin;' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)

RUN $env:PATH = 'C:\Program Files\nodejs;' + $env:PATH; \
    npm install -g @anthropic-ai/claude-code@2.1.282 @earendil-works/pi-coding-agent@0.87.1; \
    [Environment]::SetEnvironmentVariable('PATH', (npm config get prefix) + ';' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)

RUN New-Item -ItemType Directory -Path C:\workspace -Force
WORKDIR C:/workspace
COPY run-claude.ps1 C:/run-claude.ps1
COPY run-pi.ps1 C:/run-pi.ps1
```

- [ ] **Step 2: Write the entrypoints**

`run-claude.ps1` (key from the secrets mount, structured output to stdout):
```powershell
# SPIKE (throwaway): harness bench M0
param([Parameter(Mandatory)][string]$Model, [string]$McpConfig = "")
$ErrorActionPreference = 'Stop'
$token = (Get-Content 'C:\cg-secrets\claude-oauth-token' -Raw).Trim()
if (-not $token -or $token -like 'REPLACE_ME*') { throw 'claude-oauth-token is missing or a placeholder' }
$env:CLAUDE_CODE_OAUTH_TOKEN = $token
$env:CLAUDE_CODE_GIT_BASH_PATH = 'C:\Git\bin\bash.exe'
$prompt = Get-Content 'C:\task\prompt.md' -Raw
$claudeArgs = @('-p', $prompt, '--output-format', 'stream-json', '--verbose', '--model', $Model, '--dangerously-skip-permissions')
if ($McpConfig) { $claudeArgs += @('--mcp-config', $McpConfig) }
Set-Location C:\workspace
& claude @claudeArgs
exit $LASTEXITCODE
```

`run-pi.ps1`:
```powershell
# SPIKE (throwaway): harness bench M0
param([Parameter(Mandatory)][string]$Provider, [Parameter(Mandatory)][string]$Model, [string]$KeyFile = 'openrouter-api-key')
$ErrorActionPreference = 'Stop'
$key = (Get-Content "C:\cg-secrets\$KeyFile" -Raw).Trim()
if (-not $key -or $key -like 'REPLACE_ME*') { throw "$KeyFile is missing or a placeholder" }
$prompt = Get-Content 'C:\task\prompt.md' -Raw
Set-Location C:\workspace
& pi --mode json --no-session -a --provider $Provider --model $Model --api-key $key $prompt
exit $LASTEXITCODE
```

- [ ] **Step 3: Build**

Run: `cd scripts/spikes/harness/image && DOCKER_CONTEXT=desktop-windows docker build -f Dockerfile.windows -t centralgauge/harness-spike:windows .`
Expected: build succeeds. Then `DOCKER_CONTEXT=desktop-windows docker run --rm centralgauge/harness-spike:windows powershell -Command "claude --version; pi --version"` prints `2.1.282` and `0.87.1`.

- [ ] **Step 4: Write the runner**

```ts
// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/run-sandbox.ts <claude|pi> <model> <workspaceDir> <promptFile>
//          [--provider p] [--key-file f] [--kill-after-s N] [--mcp-config C:\\path\\in\\container]
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

const a = parseArgs(Deno.args, { string: ["provider", "key-file", "kill-after-s", "mcp-config"] });
const [harness, model, workspace, promptFile] = a._.map(String);
if (!harness || !model || !workspace || !promptFile) throw new Error("usage: see header");

const OUT = "H:\\Temp3\\harness-spike";
const SECRETS = Deno.env.get("CG_SPIKE_SECRETS") ?? "H:\\Temp3\\harness-spike\\secrets";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = `cg-harness-spike-${harness}-${stamp}`.toLowerCase();
await Deno.mkdir(OUT, { recursive: true });
const taskDir = await Deno.makeTempDir({ prefix: "cg-harness-spike-task-" });
await Deno.copyFile(promptFile, join(taskDir, "prompt.md"));

const entry = harness === "claude"
  ? ["C:\\run-claude.ps1", "-Model", model, ...(a["mcp-config"] ? ["-McpConfig", a["mcp-config"]] : [])]
  : ["C:\\run-pi.ps1", "-Provider", a.provider ?? "openrouter", "-Model", model, "-KeyFile", a["key-file"] ?? "openrouter-api-key"];

const args = [
  "run", "--name", name,
  "--mount", `type=bind,src=${workspace},dst=C:\\workspace`,
  "--mount", `type=bind,src=${taskDir},dst=C:\\task,readonly`,
  "--mount", `type=bind,src=${SECRETS},dst=C:\\cg-secrets,readonly`,
  "centralgauge/harness-spike:windows", "powershell", "-File", ...entry,
];
const env = { DOCKER_CONTEXT: Deno.env.get("DOCKER_CONTEXT") ?? "desktop-windows" };
const t0 = Date.now();
const child = new Deno.Command("docker", { args, env, stdout: "piped", stderr: "piped" }).spawn();
const outFile = await Deno.open(join(OUT, `${harness}-${stamp}.jsonl`), { write: true, create: true });
const errFile = await Deno.open(join(OUT, `${harness}-${stamp}.stderr.txt`), { write: true, create: true });
let killTimer: number | undefined;
if (a["kill-after-s"]) {
  killTimer = setTimeout(() => {
    new Deno.Command("docker", { args: ["kill", name], env }).outputSync();
  }, Number(a["kill-after-s"]) * 1000);
}
try {
  await Promise.all([child.stdout.pipeTo(outFile.writable), child.stderr.pipeTo(errFile.writable)]);
  const status = await child.status;
  console.log(JSON.stringify({ name, exit: status.code, wallMs: Date.now() - t0, out: join(OUT, `${harness}-${stamp}.jsonl`) }));
} finally {
  if (killTimer) clearTimeout(killTimer);
  new Deno.Command("docker", { args: ["rm", "-f", name], env }).outputSync();
  await Deno.remove(taskDir, { recursive: true });
}
```

Secrets directory: `H:\Temp3\harness-spike\secrets\`. Placeholders and a README exist; the owner fills them. A value starting with `REPLACE_ME` is refused.

- [ ] **Step 5: Smoke both harnesses**

Create `H:\Temp3\harness-spike\prompts\smoke.md` with: `Create a file named hello.txt containing the word hello, then list the files in the current directory.`
Create an empty workspace dir `H:\Temp3\harness-spike\ws-smoke`.

Run:
```
deno run --allow-all scripts/spikes/harness/run-sandbox.ts claude <claude-model> H:\Temp3\harness-spike\ws-smoke H:\Temp3\harness-spike\prompts\smoke.md
deno run --allow-all scripts/spikes/harness/run-sandbox.ts pi <pi-model> H:\Temp3\harness-spike\ws-smoke H:\Temp3\harness-spike\prompts\smoke.md --provider anthropic
```
Expected: exit 0 for both, `hello.txt` exists in the workspace dir, each `.jsonl` has a final result record (Claude: `"type":"result"`; pi: `"type":"agent_settled"`).

- [ ] **Step 6: Hard-kill capture test**

Create `prompts/long.md`: `Write 40 small AL codeunits, one file each, numbered 70000 to 70039, each with one procedure that returns its own id. Create them one at a time.`
Run each harness with `--kill-after-s 25`.
Expected: the `.jsonl` file is non-empty and ends in a complete JSON line or a partial last line; record which. Then `DOCKER_CONTEXT=desktop-windows docker ps -a --filter name=cg-harness-spike` prints no containers.

- [ ] **Step 7: Commit**

```bash
git add scripts/spikes/harness/image scripts/spikes/harness/run-sandbox.ts
git commit -m "chore(spike): harness sandbox image with Claude Code and pi"
```

---

### Task 4: Log shape probe and recorded fixtures

Find out what each harness actually reports: tool calls, tool errors, skill invocation, MCP calls, sub-agents, retries, compaction, usage fields, and whether pi loads project resources non-interactively.

**Files:**
- Create: `scripts/spikes/harness/probe-workspace/` (copy of `harness-tasks/refapp/Fleet` plus `.claude/skills/fleet-notes/SKILL.md` and `.pi/skills/fleet-notes/SKILL.md`)
- Create: `scripts/spikes/harness/probe-prompt.md`
- Create: `scripts/spikes/harness/summarize-log.ts`
- Create: `scripts/spikes/harness/redact-fixture.ts`
- Create: `tests/fixtures/harness/claude-code/probe.jsonl`, `tests/fixtures/harness/pi/probe.jsonl`

**Interfaces:**
- Consumes: `run-sandbox.ts` from Task 3.
- Produces: committed, redacted fixtures used by the M2 and M3 trace-parser tests; the usage-field table in the findings doc.

- [ ] **Step 1: Write the probe skill and prompt**

`.claude/skills/fleet-notes/SKILL.md` and `.pi/skills/fleet-notes/SKILL.md` (same content):
```markdown
---
name: fleet-notes
description: Use when asked about the Fleet app's maintenance strategies.
---
The Fleet app adds the "Heavy Duty" maintenance strategy (+5000 km). Default is +15000 km.
```

`probe-prompt.md`:
```markdown
Do these steps in order and report the result of each:
1. Use the fleet-notes skill to state the Heavy Duty interval.
2. Read src/FleetMgt.Codeunit.al and name its public procedures.
3. Run the shell command `cg-al --version` and report its output.
4. If you have a tool for spawning a sub-agent, use it to count the .al files under src. Otherwise count them yourself.
5. If you have an MCP tool named al_compile or similar, call it on this folder. Otherwise say that you have none.
```

- [ ] **Step 2: Run the probe on both harnesses**

Copy `probe-workspace` to a fresh dir each run (the harness may write to it). Run `run-sandbox.ts` for `claude` and for `pi` with the probe prompt. For the MCP step on Claude, start the existing al-tools server on the host first (from `.claude/rules/docker-sandbox.md`):
```
deno run --allow-all mcp/al-tools-server.ts --http --port 3100 --auth-token <token> --workspace-map "C:\\workspace=<host probe dir>"
```
and place `mcp.json` in the workspace root:
```json
{ "mcpServers": { "al-tools": { "type": "http", "url": "http://host.docker.internal:3100/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```
passing `--mcp-config C:\workspace\mcp.json`. Use a throwaway token; the file is not committed.
Expected: both runs exit; step 3 produces a tool error (command not found).

- [ ] **Step 3: Write the log summarizer**

```ts
// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/summarize-log.ts <claude|pi> <file.jsonl>
const [harness, file] = Deno.args;
const types = new Map<string, number>();
const toolNames = new Map<string, number>();
const usageKeys = new Set<string>();
let toolErrors = 0;
let bad = 0;

function walkUsage(u: unknown, prefix = "") {
  if (!u || typeof u !== "object") return;
  for (const [k, v] of Object.entries(u)) {
    usageKeys.add(prefix + k);
    if (v && typeof v === "object") walkUsage(v, prefix + k + ".");
  }
}

for (const line of (await Deno.readTextFile(file)).split("\n")) {
  if (!line.trim()) continue;
  let rec: Record<string, unknown>;
  try { rec = JSON.parse(line.replace(/\r$/, "")); } catch { bad++; continue; }
  const t = String(rec.type ?? "?");
  types.set(t, (types.get(t) ?? 0) + 1);
  const msg = rec.message as Record<string, unknown> | undefined;
  if (msg?.usage) walkUsage(msg.usage, "message.usage.");
  if (rec.usage) walkUsage(rec.usage, "usage.");
  const content = Array.isArray(msg?.content) ? msg!.content as Record<string, unknown>[] : [];
  for (const c of content) {
    if (c.type === "tool_use" || c.type === "toolCall") {
      const n = String(c.name ?? "?");
      toolNames.set(n, (toolNames.get(n) ?? 0) + 1);
    }
    if (c.type === "tool_result" && c.is_error === true) toolErrors++;
  }
  if (t === "tool_execution_end" && (rec as { isError?: boolean }).isError) toolErrors++;
}
console.log(JSON.stringify({
  harness, file, badLines: bad,
  recordTypes: Object.fromEntries(types),
  toolCalls: Object.fromEntries(toolNames),
  toolErrors,
  usageKeys: [...usageKeys].sort(),
}, null, 2));
```

Run it on both probe logs. If a harness nests tool calls in a shape the script does not catch (tool count 0 while the log visibly has calls), extend the matcher for that shape and note the shape in the findings doc: that is exactly the information M2/M3 need.

- [ ] **Step 4: Fill the findings table**

For each harness record in the findings doc (Task 8): tool call shape, tool error shape, skill invocation visible (yes/no, record type), MCP call visible (yes/no, pi MCP support at all), sub-agent visible, retry and compaction events (seen or not seen in this run), usage keys (exact list), cost reported (field name or none), project skills loaded non-interactively (pi with `-a`: yes/no).

- [ ] **Step 5: Redact and commit fixtures**

```ts
// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/redact-fixture.ts <in.jsonl> <out.jsonl> <secretsDir>
const [input, output, secretsDir] = Deno.args;
let text = await Deno.readTextFile(input);
const secrets: string[] = [];
for await (const e of Deno.readDir(secretsDir)) {
  const v = (await Deno.readTextFile(`${secretsDir}\\${e.name}`)).trim();
  if (v.length >= 8) secrets.push(v);
}
for (const s of secrets) text = text.split(s).join("[REDACTED]");
text = text.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]").replace(/Bearer [A-Za-z0-9._-]{16,}/g, "Bearer [REDACTED]");
for (const s of secrets) {
  if (text.includes(s)) throw new Error("secret survived redaction");
}
await Deno.writeTextFile(output, text);
console.log(`[OK] redacted ${input} -> ${output}`);
```

Run for both probe logs into `tests/fixtures/harness/claude-code/probe.jsonl` and `tests/fixtures/harness/pi/probe.jsonl`. Then:
Run: `grep -c "REDACTED" tests/fixtures/harness/*/probe.jsonl` and `grep -rE "sk-[A-Za-z0-9]{20,}" tests/fixtures/harness` (expect no output from the second).

```bash
git add scripts/spikes/harness/probe-workspace scripts/spikes/harness/probe-prompt.md scripts/spikes/harness/summarize-log.ts scripts/spikes/harness/redact-fixture.ts tests/fixtures/harness
git commit -m "chore(spike): harness log shape probe + redacted fixtures"
```

---

### Task 5: cg-al backend round trip with a scoped token

**Files:**
- Create: `scripts/spikes/harness/backend-spike.ts`
- Create: `scripts/spikes/harness/image/cg-al.ps1` (and add `COPY cg-al.ps1 C:/cg-al.ps1` plus a `cg-al.cmd` shim to the Dockerfile; rebuild)

**Interfaces:**
- Consumes: `BcContainerProvider.compileProject`, refapp folders from Task 1.
- Produces: latency numbers for `cg-al compile` through the backend; the auth and path-validation behavior the M1 backend copies.

- [ ] **Step 1: Write the backend**

```ts
// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/backend-spike.ts <container> <hostWorkspace> <token>
import { join, resolve, SEPARATOR } from "@std/path";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

const [container, hostWorkspace, token] = Deno.args;
const root = resolve(hostWorkspace);
const provider = new BcContainerProvider();
let requests = 0;

Deno.serve({ hostname: "0.0.0.0", port: 3200 }, async (req) => {
  if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== "/compile") return new Response("not found", { status: 404 });
  const { app } = await req.json() as { app?: string };
  if (!app || !/^[A-Za-z][A-Za-z0-9 ]*$/.test(app)) return new Response("bad app name", { status: 400 });
  const dir = resolve(join(root, app));
  if (!dir.startsWith(root + SEPARATOR)) return new Response("outside workspace", { status: 400 });
  requests++;
  const t0 = Date.now();
  const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
  const result = await provider.compileProject(container, { path: dir, appJson, sourceFiles: [], testFiles: [] });
  const body = { request: requests, success: result.success, errors: result.errors.length, backendMs: Date.now() - t0, compilerMs: result.duration };
  console.log(JSON.stringify({ app, ...body }));
  return Response.json(body);
});
```

- [ ] **Step 2: Write the client**

`cg-al.ps1`:
```powershell
# SPIKE (throwaway): harness bench M0
param([Parameter(Mandatory)][ValidateSet('compile')][string]$Op, [Parameter(Mandatory)][string]$App)
$token = (Get-Content 'C:\cg-secrets\backend-token' -Raw).Trim()
$body = @{ app = $App } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri 'http://host.docker.internal:3200/compile' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
$r | ConvertTo-Json -Compress
if (-not $r.success) { exit 1 }
```
Dockerfile addition: `COPY cg-al.ps1 C:/cg-al.ps1` and `RUN Set-Content -Path C:\Windows\System32\cg-al.cmd -Value '@powershell -NoProfile -File C:\cg-al.ps1 %*'`. Rebuild the image.

- [ ] **Step 3: Round trip from the sandbox**

Stage a workspace with `Core` from the refapp. Write a token to `secrets\backend-token`. Start the backend with that workspace. Run a container interactively:
`DOCKER_CONTEXT=desktop-windows docker run --rm --name cg-harness-spike-cgal --mount type=bind,src=<ws>,dst=C:\workspace --mount type=bind,src=<secrets>,dst=C:\cg-secrets,readonly centralgauge/harness-spike:windows cmd /c "cg-al compile Core & cg-al compile Core & cg-al compile Core"`
Expected: three JSON lines with `success: true`. Record client-observed and `backendMs` medians in the findings doc.

- [ ] **Step 4: Negative checks**

Run from the host:
```
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3200/compile -d '{"app":"Core"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer <token>" http://localhost:3200/compile -d '{"app":"..\\\\x"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer <token>" http://localhost:3200/compile -d '{"app":"C:\\\\Windows"}'
```
Expected: `401`, `400`, `400`.

- [ ] **Step 5: Commit**

```bash
git add scripts/spikes/harness/backend-spike.ts scripts/spikes/harness/image
git commit -m "chore(spike): cg-al backend round trip with scoped token"
```

---

### Task 6: AL Tools NuGet compiling offline inside the sandbox

**Files:**
- Create: `scripts/spikes/harness/image/Dockerfile.nuget.windows`
- Modify: findings doc only

**Interfaces:**
- Produces: yes/no plus timing for the `toolchain: al-tools-nuget` component; the exact package id, version and command line.

- [ ] **Step 1: Confirm the package id and latest version**

Run: `curl -s "https://azuresearch-usnc.nuget.org/query?q=Microsoft.Dynamics.BusinessCentral.Development.Tools&prerelease=false" | jq '.data[] | {id, version}'`
Expected: an entry with the tool package id and a version. Use exactly that id and version below. If no such package exists, search `q=BusinessCentral altool` and record what the AL Tools NuGet is actually called.

- [ ] **Step 2: Write the image**

```dockerfile
# SPIKE (throwaway): harness bench M0
FROM centralgauge/harness-spike:windows
SHELL ["powershell", "-Command", "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue';"]
RUN Invoke-WebRequest -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile 'C:\dotnet-install.ps1'; \
    & C:\dotnet-install.ps1 -Channel 8.0 -InstallDir 'C:\dotnet'; \
    [Environment]::SetEnvironmentVariable('PATH', 'C:\dotnet;C:\dotnet-tools;' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)
ARG AL_TOOLS_ID
ARG AL_TOOLS_VERSION
RUN & C:\dotnet\dotnet.exe tool install $env:AL_TOOLS_ID --version $env:AL_TOOLS_VERSION --tool-path C:\dotnet-tools
```
Build: `DOCKER_CONTEXT=desktop-windows docker build -f Dockerfile.nuget.windows --build-arg AL_TOOLS_ID=<id> --build-arg AL_TOOLS_VERSION=<version> -t centralgauge/harness-spike-nuget:windows scripts/spikes/harness/image`

- [ ] **Step 3: Seed symbols and compile with no network**

Find the compiler cache symbols on the host: `ls C:/ProgramData/BcContainerHelper/ | grep compiler-cache-` then copy `<that dir>\symbols\*.app` into `<ws>\.alpackages\`. Stage `Core` into `<ws>`.
Run:
`DOCKER_CONTEXT=desktop-windows docker run --rm --network none --name cg-harness-spike-nuget --mount type=bind,src=<ws>,dst=C:\workspace centralgauge/harness-spike-nuget:windows powershell -Command "Measure-Command { al compile /project:C:\workspace\Core /out:C:\workspace\Core\out.app /packagecachepath:C:\workspace\.alpackages } | Select-Object TotalSeconds; Test-Path C:\workspace\Core\out.app"`
Expected: `True`. Record TotalSeconds (first and a second run). If the command name is not `al`, use the one from the tool manifest (`C:\dotnet-tools` listing) and record it.

- [ ] **Step 4: Compile Fleet against Core's output**

Copy `Core\out.app` into `.alpackages`, stage `Fleet`, compile it the same way.
Expected: `True`. This proves the in-container toolchain handles cross-app dependencies from pre-seeded symbols.

- [ ] **Step 5: Commit**

```bash
git add scripts/spikes/harness/image/Dockerfile.nuget.windows
git commit -m "chore(spike): AL Tools NuGet offline compile in sandbox"
```

---

### Task 7: Rules plus Laya classification on real calls

**Files:**
- Create: `scripts/spikes/harness/classify-rules.ts`
- Create: `scripts/spikes/harness/laya_classify.py`
- Create: `H:\Temp3\harness-spike\labels.csv` (hand labels, not committed)

**Interfaces:**
- Consumes: probe and smoke logs from Tasks 3 and 4.
- Produces: rule coverage percent, Laya accuracy and latency on the residue; feeds the M2 categorization design.

- [ ] **Step 1: Write the rule classifier with its self-check**

```ts
// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/classify-rules.ts <file.jsonl>... > calls.jsonl
export type Category = "compile" | "test" | "publish" | "symbols" | "read" | "search" | "edit" | "vcs" | "other";

const BUILTIN: Record<string, Category> = {
  Read: "read", Glob: "search", Grep: "search", Edit: "edit", Write: "edit", MultiEdit: "edit",
  read: "read", grep: "search", find: "search", ls: "search", edit: "edit", write: "edit",
};
const SHELL_RULES: [RegExp, Category][] = [
  [/^\s*cg-al\s+compile\b/i, "compile"],
  [/^\s*cg-al\s+test\b/i, "test"],
  [/^\s*cg-al\s+symbols\b/i, "symbols"],
  [/^\s*(al|altool)(\.exe)?\s+compile\b/i, "compile"],
  [/\balc(\.exe)?\s/i, "compile"],
  [/^\s*git\s/i, "vcs"],
  [/^\s*(cat|type|Get-Content|head|tail)\b/i, "read"],
  [/^\s*(ls|dir|Get-ChildItem|find|rg|grep|Select-String)\b/i, "search"],
];
const MCP_RULES: [RegExp, Category][] = [[/compile/i, "compile"], [/test/i, "test"], [/publish/i, "publish"], [/symbol/i, "symbols"]];

export function classify(tool: string, command?: string): Category | null {
  if (tool.startsWith("mcp__")) {
    for (const [re, c] of MCP_RULES) if (re.test(tool)) return c;
    return null;
  }
  if ((tool === "Bash" || tool === "bash" || tool === "PowerShell") && command) {
    for (const [re, c] of SHELL_RULES) if (re.test(command)) return c;
    return null;
  }
  return BUILTIN[tool] ?? null;
}

function selfCheck() {
  const cases: [string, string | undefined, Category | null][] = [
    ["Bash", "cg-al compile Core", "compile"],
    ["Bash", "al compile /project:C:\\workspace\\Core", "compile"],
    ["Bash", "git status", "vcs"],
    ["Read", undefined, "read"],
    ["mcp__al-tools__al_compile", undefined, "compile"],
    ["Bash", "python make_stuff.py", null],
  ];
  for (const [t, cmd, want] of cases) {
    const got = classify(t, cmd);
    if (got !== want) throw new Error(`classify(${t}, ${cmd}) = ${got}, want ${want}`);
  }
}

if (import.meta.main) {
  selfCheck();
  let total = 0, ruled = 0;
  for (const file of Deno.args) {
    for (const line of (await Deno.readTextFile(file)).split("\n")) {
      if (!line.trim()) continue;
      let rec: Record<string, unknown>;
      try { rec = JSON.parse(line); } catch { continue; }
      const msg = rec.message as { content?: Record<string, unknown>[] } | undefined;
      for (const c of msg?.content ?? []) {
        if (c.type !== "tool_use" && c.type !== "toolCall") continue;
        const input = (c.input ?? c.arguments ?? {}) as Record<string, unknown>;
        const command = typeof input.command === "string" ? input.command : undefined;
        const tool = String(c.name);
        const category = classify(tool, command);
        total++;
        if (category) ruled++;
        console.log(JSON.stringify({ file, tool, command, category }));
      }
    }
  }
  console.error(`[rules] ${ruled}/${total} classified by rule`);
}
```

Run: `deno run --allow-all scripts/spikes/harness/classify-rules.ts H:/Temp3/harness-spike/*.jsonl > H:/Temp3/harness-spike/calls.jsonl`
Expected: self-check passes silently; stderr prints the rule coverage. Record it.

- [ ] **Step 2: Hand-label the calls**

Write `H:\Temp3\harness-spike\labels.csv` with columns `index,category` for every line of `calls.jsonl` (index = 0-based line number), using the category list from Step 1. If fewer than 40 calls exist, run the probe prompt once more per harness first.

- [ ] **Step 3: Classify the residue with Laya**

Install Laya locally per its upstream README (https://laya-ai.com/, Python package, local checkpoint). Write `laya_classify.py` using Laya's documented "choice" decision type:
- input: `calls.jsonl` lines where `category` is null
- state per call: `{"tool": ..., "command": ...}`
- question: choice over `compile, test, publish, symbols, read, search, edit, vcs, other`
- output per call: JSON line `{"index", "choice", "probability", "ms"}` to `H:\Temp3\harness-spike\laya.jsonl`

Record the exact package name, version, checkpoint and invocation in the findings doc, since M2 depends on them.

- [ ] **Step 4: Score**

Compute, for rule-classified calls and for Laya calls separately: accuracy against `labels.csv`, and for Laya the accuracy at probability >= 0.8 and the share of calls below 0.8 (those become `unclassified`). Record median and p95 Laya latency.

- [ ] **Step 5: Commit**

```bash
git add scripts/spikes/harness/classify-rules.ts scripts/spikes/harness/laya_classify.py
git commit -m "chore(spike): tool call classification, rules + local Laya"
```

---

### Task 8: Findings doc and the M1 to M4 gate

**Files:**
- Create: `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md`
- Modify: `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (only where a finding contradicts it)

- [ ] **Step 1: Write the findings doc**

Same style as `docs/superpowers/specs/2026-09-06-batch-spikes-findings.md`: observed values, log paths under `H:\Temp3\harness-spike\`, no speculation. Sections, each with the numbers from its task:

1. Multi-app timing (Task 2): per-app compile/publish medians, 3-app and 7-app totals, test time, ratio to `prepare-candidate` 14.6 s.
2. Dependency graph (Tasks 1-2): compiled and published as designed, or what had to change.
3. Harness capture (Task 3): versions, smoke result, hard-kill behavior, orphan check.
4. Log shapes (Task 4): the per-harness table from Task 4 Step 4.
5. Backend round trip (Task 5): latency medians, negative checks.
6. AL Tools NuGet (Task 6): package id, version, command, offline compile times, cross-app compile result.
7. Classification (Task 7): rule coverage, Laya package/invocation, accuracy, unclassified share, latency.
8. Decisions for M1 to M4: one line per spec assumption that a finding confirms or breaks.

- [ ] **Step 2: Apply the decision rules**

Write each outcome into section 8:

- If 7-app total (compile + publish + test) median exceeds 10 minutes: M1 must publish only changed apps per `cg-al test` call (keep unchanged dependencies published), and the default concurrency is one execution per container.
- If pi has no MCP support: MCP arms are Claude Code only for the talk; pi arms compare skills, instructions and models.
- If a harness reports no cost: cost per solved task for that harness is estimated from reported tokens and the catalog pricing snapshot, labelled `cost_source: estimated`.
- If the NuGet compile fails offline: the `toolchain` component is deferred past the talk.
- If Laya accuracy at probability >= 0.8 is below 90 percent: M2 ships rules only and marks the residue `unclassified`; Laya waits.

Update the spec sections these outcomes change, in the same commit.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-harness-spikes-findings.md docs/superpowers/specs/2026-09-24-harness-bench-design.md
git commit -m "docs(spec): harness spike findings and M1-M4 decisions"
```

---

## Roadmap after the spike (plans written from the findings)

| Milestone | Scope (spec 1a/1b sections) | Window | Plan file |
| --- | --- | --- | --- |
| M0 | This plan | 2026-09-25 to 09-29 | this file |
| M1 | Records, manifests and hashing, refapp staging, verdict workspace, backend, mock harness, runner with campaigns, console + JSON report (1a 4-11) | 09-30 to 10-08 | `2026-09-30-harness-core.md` |
| M2 | Claude Code adapter, trace parser, metrics contract, rule categorization (1a 5, 12 item 2) | 10-06 to 10-10 | `2026-10-06-harness-claude-code.md` |
| M3 | pi adapter, al-tools MCP component, toolchain component if the spike allows (1a 12 items 3-4) | 10-09 to 10-13 | `2026-10-09-harness-pi.md` |
| M4 | Refapp v1 content and at least 6 gated tasks (1b), in parallel from 09-30 | 09-30 to 10-16 | `2026-09-30-harness-refapp-v1.md` |
| M5 | Talk campaigns: Claude Code MCP/skill arms, Claude Code vs pi head-to-head | 10-16 to 10-22 | operator runbook, no code |
