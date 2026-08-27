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

# Map every prereq app id -> its source directory, so a chained dependency can
# be followed by id rather than by guessing a directory name.
function Get-PrereqIndex([string]$depsRoot) {
    $index = @{}
    if (-not (Test-Path $depsRoot)) { return $index }
    foreach ($dir in Get-ChildItem $depsRoot -Directory) {
        $manifest = Join-Path $dir.FullName 'app.json'
        if (-not (Test-Path $manifest)) { continue }
        try {
            $m = Get-Content -Raw $manifest | ConvertFrom-Json
            if ($m.id) { $index[[string]$m.id] = $dir.FullName }
        } catch { }
    }
    return $index
}

# Dependency-ordered prereq chain for one task: dependencies before dependents,
# so alc always sees a prereq's own prereqs first.
function Get-PrereqChain([string]$taskId, [string]$depsRoot, [hashtable]$index) {
    $start = Join-Path $depsRoot $taskId
    if (-not (Test-Path (Join-Path $start 'app.json'))) { return @() }

    $ordered = New-Object System.Collections.ArrayList
    $seen = @{}

    function Add-Node([string]$dir) {
        $manifest = Join-Path $dir 'app.json'
        if (-not (Test-Path $manifest)) { return }
        $m = Get-Content -Raw $manifest | ConvertFrom-Json
        $key = [string]$m.id
        if ($seen.ContainsKey($key)) { return }
        $seen[$key] = $true
        foreach ($dep in @($m.dependencies)) {
            if (-not $dep) { continue }
            $depDir = $index[[string]$dep.id]
            if ($depDir) { Add-Node $depDir }
        }
        [void]$ordered.Add([pscustomobject]@{ Dir = $dir; Manifest = $m })
    }

    Add-Node $start
    return $ordered
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

    # A SEEDED reference solution carries the bench's fixed candidate app id,
    # which every task shares. Publishing task B's app under that id while task
    # A's package is still on the container is a same-id/different-name
    # conflict, so give each task its own. Authored solutions already have a
    # per-task id from their draft manifest and are left alone.
    if ($app.id -eq '00000000-cafe-0000-0000-be4c00decade') {
        if ($id -notmatch '([XHME])(\d{3})$') {
            throw "Cannot derive an app GUID for seeded task '$id'."
        }
        $sDigit = switch ($Matches[1]) { 'X' { '6' } 'H' { '7' } 'M' { '8' } 'E' { '9' } }
        $app.id = "a1b2c3d4-${sDigit}$($Matches[2])-0000-0000-000000000$($Matches[2])"
        Write-Host "  seeded app id -> $($app.id)"
    }
    $appId = $app.id
    $app | ConvertTo-Json -Depth 10 | Set-Content $appManifest -Encoding UTF8

    # --- tests/: the committed oracle plus its companions ---
    Get-ChildItem $testsDir -File | Remove-Item -Force
    Copy-Item $oracle $testsDir
    # A companion the SOLUTION references has to live in app/, or the app does
    # not compile. One only the ORACLE references stays in tests/, so it is not
    # mutated and is not published twice. Decide from what the app sources
    # actually name, rather than from the filename.
    $appSourceText = (Get-ChildItem $appDir -Filter '*.al' -File |
        ForEach-Object { Get-Content -Raw $_.FullName }) -join "`n"
    foreach ($companion in (Get-CompanionPaths $id)) {
        $companionText = Get-Content -Raw $companion
        # e.g. `enum 70001 "CG Product Type"` -> CG Product Type
        $declared = [regex]::Matches(
            $companionText,
            '(?im)^\s*(?:table|codeunit|page|report|enum|interface|query|xmlport|profile|tableextension|pageextension|enumextension)\s+\d+\s+"([^"]+)"'
        ) | ForEach-Object { $_.Groups[1].Value }

        $neededByApp = $false
        foreach ($name in $declared) {
            if ($appSourceText -match [regex]::Escape('"' + $name + '"')) { $neededByApp = $true; break }
        }

        if ($neededByApp) {
            Copy-Item $companion $appDir -Force
            Write-Host "  companion -> app/ (referenced by the solution): $(Split-Path $companion -Leaf)"
        } else {
            Copy-Item $companion $testsDir -Force
        }
    }

    # The oracle app is Global scope and depends on the app under mutation, so
    # it carries its own manifest rather than compiling into the same project.
    #
    # The task letter is usually NOT a hex digit, and an app.json carrying an
    # invalid GUID does not compile (.claude/rules/prereq-apps.md), so each
    # series gets its own hex-valid segment prefix instead. X keeps '2' so every
    # layout prepared before this change still resolves to the same ids.
    if ($id -notmatch '([XHME])(\d{3})$') {
        throw "Cannot derive a GUID segment from task id '$id' - expected a CG-AL-<X|H|M|E>### id."
    }
    $series = $Matches[1]
    $shortId = $Matches[2]
    $seriesDigit = switch ($series) {
        'X' { '2' }   # unchanged from the original single-series convention
        'H' { '3' }
        'M' { '4' }
        'E' { '5' }
        default { throw "No GUID segment digit assigned for series '$series'" }
    }
    $testsManifest = [ordered]@{
        id           = "a1b2c3d4-${seriesDigit}${shortId}-0000-0000-000000000${shortId}"
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

    # Let the oracle see the app's internals. Several solutions are
    # `Access = Internal`, which is fine at bench time (one app) and fatal here
    # (two apps): AL0161. Stripping the access modifier would change the code
    # under test, so declare the tests app instead.
    $appJ = Get-Content -Raw $appManifest | ConvertFrom-Json
    $ivt = @([pscustomobject]@{
        id        = $testsManifest.id
        name      = $testsManifest.name
        publisher = $testsManifest.publisher
    })
    $appJ | Add-Member -NotePropertyName internalsVisibleTo -NotePropertyValue $ivt -Force
    $appJ | ConvertTo-Json -Depth 20 | Set-Content $appManifest -Encoding UTF8

    # --- prereqs: compile the chain into $dest so both compiles can see it ---
    $depsRoot = Join-Path (Join-Path (Join-Path $Repo "tests") "al") "dependencies"
    $prereqIndex = Get-PrereqIndex $depsRoot
    $chain = Get-PrereqChain $id $depsRoot $prereqIndex
    $chainDeps = @()
    $prereqOk = $true
    foreach ($node in $chain) {
        $pName = [string]$node.Manifest.name
        $pOut = Join-Path $dest ("prereq_" + ($pName -replace '[^A-Za-z0-9]', '_') + ".app")
        # Each prereq compiles against the BC cache plus $dest, so a chained
        # prereq resolves the one it depends on from this same directory.
        & $AlcPath "/project:$($node.Dir)" "/out:$pOut" "/packagecachepath:$PackageCachePath" "/packagecachepath:$dest" *>> (Join-Path $dest 'compile-prereq.log')
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $pOut)) {
            Write-Host "[FAIL] $id - prereq '$pName' compile failed, see compile-prereq.log"
            $prereqOk = $false
            break
        }
        # Collect EVERY node: AL has no transitive object visibility, so an app
        # must depend directly on each app whose objects it names.
        $chainDeps += [pscustomobject]@{
            id        = [string]$node.Manifest.id
            name      = $pName
            publisher = [string]$node.Manifest.publisher
            version   = [string]$node.Manifest.version
        }
    }
    if (-not $prereqOk) {
        $skipped += "$id (prereq compile failed)"
        continue
    }

    # Declare the prereq on both sides. Without this alc has the symbols on its
    # package-cache path but no reason to load them.
    if ($chainDeps.Count -gt 0) {
        $chainIds = @($chainDeps | ForEach-Object { [string]$_.id })
        foreach ($mf in @($appManifest, (Join-Path $testsDir 'app.json'))) {
            $j = Get-Content -Raw $mf | ConvertFrom-Json
            $deps = @()
            if ($j.PSObject.Properties.Name -contains 'dependencies' -and $j.dependencies) {
                $deps = @($j.dependencies | Where-Object { $chainIds -notcontains [string]$_.id })
            }
            $deps += $chainDeps
            $j | Add-Member -NotePropertyName dependencies -NotePropertyValue $deps -Force
            $j | ConvertTo-Json -Depth 20 | Set-Content $mf -Encoding UTF8
        }
    }

    & $AlcPath "/project:$appDir" "/out:$appOut" "/packagecachepath:$PackageCachePath" "/packagecachepath:$dest" *> (Join-Path $dest 'compile-app.log')
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
