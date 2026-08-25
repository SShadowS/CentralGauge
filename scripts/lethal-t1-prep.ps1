<#
.SYNOPSIS
    Phase A of the LethAL T1 oracle bypass-audit sweep (docs/reasoning-suite/tooling-plan.md).

.DESCRIPTION
    Builds the per-task working layout scratch/lethal-t1/<id>/ that sweep.ps1
    consumes, for one or more promoted diagnose tasks:

        <id>/app/          reference solution (reference/solutions/<id>/), version-bumped
        <id>/tests/        the committed oracle (tests/al/<difficulty>/<id>.Test.al) + companions
        <id>/lethal.config.json
        <id>/app-build.app, <id>/tests-build.app

    Both apps are compiled locally with alc against the keyed compiler-cache
    symbols directory, which doubles as the package cache, so no symbol
    download is needed.

    This was done ad hoc for the 2026-08-24 sweep over X065-X100. It is a
    script now because every build batch owes a sweep over its new oracles,
    and reconstructing the layout by hand each time is where the hour goes.

    Nothing here touches a container: sweep.ps1 does the publishing. Run that
    afterwards, and never while a bench is live.

.PARAMETER Tasks
    Task ids to prepare (e.g. CG-AL-X111). Defaults to every task that has a
    reference solution and a committed oracle but no lethal-t1 layout yet.

.PARAMETER Force
    Rebuild the layout for tasks that already have one.

.PARAMETER Version
    Version stamped on both generated apps. Bump it above the previous sweep's
    when re-preparing a task whose oracle changed - see the parameter comment.

.EXAMPLE
    pwsh -Command "& ./scripts/lethal-t1-prep.ps1 -Tasks @('CG-AL-X101') -Force -Version 1.0.0.4"

.EXAMPLE
    pwsh -File scripts/lethal-t1-prep.ps1 -Tasks CG-AL-X111,CG-AL-X112
.EXAMPLE
    pwsh -File scripts/lethal-t1-prep.ps1        # everything not yet prepared
#>
param(
    [string[]]$Tasks,
    [string]$Repo = 'U:\git\CentralGauge',
    [string]$Base = 'U:\git\CentralGauge\scratch\lethal-t1',
    [string]$Container = 'Cronus28',
    [string]$AlcPath = 'C:/Users/SShadowS/.vscode/extensions/ms-dynamics-smb.al-18.0.2668733/bin/alc.exe',
    [string]$AltoolPath = 'C:/Users/SShadowS/.vscode/extensions/ms-dynamics-smb.al-18.0.2668733/bin/altool.exe',
    [string]$PackageCachePath = 'C:/ProgramData/BcContainerHelper/compiler-cache-15ff3c5d109b/symbols',
    [string]$ControlSymbolPath = 'U:/git/LethAL/extensions/lethal-control/lethal-control.app',
    # Version stamped on both generated apps.
    #
    # 1.0.0.2 is right for a task's FIRST sweep (above 1.0.0.0, so a later
    # plain re-install does not need Start-NAVAppDataUpgrade).
    #
    # Re-sweeping a task whose oracle changed is different, and the failure is
    # opaque: publish returns a bare "Status Code UnprocessableEntity" and only
    # the inner message names the cause - "Cannot install ... because a newer
    # version 1.0.20690.34635 was already installed". LethAL stamps its
    # instrumented build with a LARGE generated version, so bumping to 1.0.0.4
    # is still far below it and fails identically. Use something clearly above
    # that stamp - 2.0.0.0 works - or uninstall the instrumented app first.
    [string]$Version = '1.0.0.2',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $AlcPath)) {
    throw "alc.exe not found at $AlcPath. AL extension 18.x moved the binaries from bin/win32/ to bin/ - pass -AlcPath explicitly."
}
if (-not (Test-Path $PackageCachePath)) {
    throw "Symbols dir not found at $PackageCachePath. The compiler cache is keyed by artifact URL, so the hex suffix changes with the BC version - pass -PackageCachePath explicitly."
}

$refRoot = Join-Path $Repo 'reference\solutions'
$taskRoot = Join-Path $Repo 'tasks'

function Get-OraclePath([string]$id) {
    foreach ($difficulty in @('hard', 'medium', 'easy')) {
        $p = Join-Path $Repo "tests\al\$difficulty\$id.Test.al"
        if (Test-Path $p) { return $p }
    }
    return $null
}

# Companion files share the reserved "<id>." prefix and ship to both probe
# sides, so the oracle app needs them too (see .claude/rules/prereq-apps.md).
function Get-CompanionPaths([string]$id) {
    $oracle = Get-OraclePath $id
    if (-not $oracle) { return @() }
    $dir = Split-Path $oracle -Parent
    Get-ChildItem $dir -Filter "$id.*.al" |
        Where-Object { $_.Name -ne "$id.Test.al" } |
        ForEach-Object { $_.FullName }
}

if (-not $Tasks) {
    $Tasks = Get-ChildItem $refRoot -Directory |
        Where-Object { Get-OraclePath $_.Name } |
        Where-Object { $Force -or -not (Test-Path (Join-Path $Base "$($_.Name)\tests-build.app")) } |
        ForEach-Object { $_.Name } |
        Sort-Object
}

if (-not $Tasks) {
    Write-Host '[OK] nothing to prepare - every task with a reference solution already has a layout.'
    return
}

Write-Host "[prep] $($Tasks.Count) task(s): $($Tasks -join ', ')"

$prepared = @()
$skipped = @()

foreach ($id in $Tasks) {
    $refDir = Join-Path $refRoot $id
    $oracle = Get-OraclePath $id

    if (-not (Test-Path $refDir)) {
        Write-Host "[SKIP] $id - no reference solution at $refDir"
        $skipped += "$id (no reference solution)"
        continue
    }
    if (-not $oracle) {
        Write-Host "[SKIP] $id - no committed oracle under tests/al/"
        $skipped += "$id (no oracle)"
        continue
    }

    $dest = Join-Path $Base $id
    $appDir = Join-Path $dest 'app'
    $testsDir = Join-Path $dest 'tests'

    if ((Test-Path (Join-Path $dest 'tests-build.app')) -and -not $Force) {
        Write-Host "[SKIP] $id - already prepared (use -Force to rebuild)"
        $skipped += "$id (already prepared)"
        continue
    }

    Write-Host "== $id"
    New-Item -ItemType Directory -Force -Path $appDir, $testsDir | Out-Null

    # --- app/: the reference solution, minus any incidental oracle copy ---
    Get-ChildItem $appDir -File | Remove-Item -Force
    Get-ChildItem $refDir -File |
        Where-Object { $_.Name -notlike '*.Test.al' } |
        ForEach-Object { Copy-Item $_.FullName $appDir }

    $appManifest = Join-Path $appDir 'app.json'
    $app = Get-Content $appManifest -Raw | ConvertFrom-Json
    $app.version = $Version
    $app.name = "$id correct"
    $appId = $app.id
    $app | ConvertTo-Json -Depth 10 | Set-Content $appManifest -Encoding UTF8

    # --- tests/: the committed oracle plus its companions ---
    Get-ChildItem $testsDir -File | Remove-Item -Force
    Copy-Item $oracle $testsDir
    foreach ($companion in (Get-CompanionPaths $id)) { Copy-Item $companion $testsDir }

    # The oracle app is Global scope and depends on the app under mutation, so
    # it carries its own manifest rather than compiling into the same project.
    # X-series numeric suffix only: the 'X' is not a hex digit, and an app.json
    # carrying an invalid GUID does not compile (.claude/rules/prereq-apps.md).
    if ($id -notmatch 'X(\d{3})$') { throw "Cannot derive a GUID segment from task id '$id' - expected a CG-AL-X### id." }
    $shortId = $Matches[1]
    $testsManifest = [ordered]@{
        id           = "a1b2c3d4-2$shortId-0000-0000-000000000$shortId"
        name         = "$id LethAL Tests"
        publisher    = 'CentralGauge'
        version      = $Version
        platform     = '28.0.0.0'
        application  = '28.0.0.0'
        idRanges     = @(@{ from = 80000; to = 89999 })
        runtime      = '17.0'
        target       = 'OnPrem'
        features     = @('NoImplicitWith')
        dependencies = @(
            @{ id = $appId; name = "$id correct"; publisher = 'CentralGauge'; version = '1.0.0.0' },
            @{ id = 'dd0be2ea-f733-4d65-bb34-a28f4624fb14'; name = 'Library Assert'; publisher = 'Microsoft'; version = '28.0.0.0' },
            @{ id = 'e7320ebb-08b3-4406-b1ec-b4927d3e280b'; name = 'Any'; publisher = 'Microsoft'; version = '28.0.0.0' },
            @{ id = '5d86850b-0d76-4eca-bd7b-951ad998e997'; name = 'Tests-TestLibraries'; publisher = 'Microsoft'; version = '28.0.0.0' }
        )
    }
    $testsManifest | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $testsDir 'app.json') -Encoding UTF8

    # --- lethal.config.json ---
    $config = [ordered]@{
        bcdev = [ordered]@{
            mcpCommand        = @('bun', 'x', 'bc-dev-mcp')
            server            = "http://$Container"
            serverInstance    = 'BC'
            # Without an explicit tenant the web service answers 401.
            tenant            = 'default'
            company           = 'My Company'
            username          = 'sshadows'
            password          = '1234'
            packageCachePath  = $PackageCachePath
            controlSymbolPath = $ControlSymbolPath
            # LethAL fabricates the pre-18.x bin/win32/ paths without checking
            # and its doctor still reports [ok], so both are pinned here.
            alcPath           = $AlcPath
            altoolPath        = $AltoolPath
            env               = [ordered]@{ BC_DEV_USER = 'sshadows'; BC_DEV_PASSWORD = '1234' }
        }
    }
    $config | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $dest 'lethal.config.json') -Encoding UTF8

    # --- compile both sides ---
    $appOut = Join-Path $dest 'app-build.app'
    $testsOut = Join-Path $dest 'tests-build.app'
    Remove-Item $appOut, $testsOut -ErrorAction SilentlyContinue

    & $AlcPath "/project:$appDir" "/out:$appOut" "/packagecachepath:$PackageCachePath" *> (Join-Path $dest 'compile-app.log')
    if (-not (Test-Path $appOut)) {
        Write-Host "[FAIL] $id - app compile failed, see compile-app.log"
        $skipped += "$id (app compile failed)"
        continue
    }

    # The oracle resolves the app under test from the freshly built .app, so
    # the app output directory joins the package cache for this compile.
    & $AlcPath "/project:$testsDir" "/out:$testsOut" "/packagecachepath:$PackageCachePath" "/packagecachepath:$dest" *> (Join-Path $dest 'compile-tests.log')
    if (-not (Test-Path $testsOut)) {
        Write-Host "[FAIL] $id - tests compile failed, see compile-tests.log"
        $skipped += "$id (tests compile failed)"
        continue
    }

    Write-Host "[OK] $id prepared"
    $prepared += $id
}

Write-Host ''
Write-Host "[prep] prepared: $($prepared.Count)$(if ($prepared) { " ($($prepared -join ', '))" })"
if ($skipped) { Write-Host "[prep] skipped:  $($skipped -join '; ')" }
Write-Host ''
Write-Host 'Next: scratch/lethal-t1/sweep.ps1 (serial, container work - never while a bench is live).'
