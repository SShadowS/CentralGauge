/**
 * PowerShell script builders for BC container operations.
 * These pure functions generate PowerShell scripts used by BcContainerProvider.
 */

import type { ContainerCredentials } from "./types.ts";
import {
  BCCH_PINNED_VERSION,
  bcchConfigInit,
  bcchImport,
  bcchUsePwshForBc24Sentinel,
} from "./bcch-config.ts";

/**
 * Escape a value for embedding inside a PowerShell *single-quoted* string
 * literal (doubling embedded `'`). Single-quoted strings do not interpolate
 * `$variables`/`$(subexpressions)` or interpret backtick escapes, so wrapping
 * a value in `'...'` after this escape is the safe way to splice untrusted or
 * config-sourced data (credentials, names) into a generated script — unlike
 * double-quoted interpolation (`"${value}"`), which lets a value containing
 * `$(...)` execute arbitrary PowerShell.
 */
export function escapeForPS(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * PowerShell helper injected at the top of any BCH script when tracing is
 * enabled (caller passes a non-zero `traceTid`). When tracing is disabled,
 * the helper is omitted entirely so scripts are byte-identical to the
 * pre-tracing version.
 *
 * Emits `[TRACE] {…}` lines via `[Console]::Out.WriteLine` — bypasses the
 * pwsh success-stream pipeline so wrapped cmdlets' return values are
 * preserved exactly (`Write-Output` would corrupt them).
 *
 * The pwsh side computes bench-relative `ts` via Unix wall-clock minus
 * the origin TS injected as `CG_TRACE_BENCH_START_UNIX_MICROS`.
 * `dur` is captured with `Stopwatch` (monotonic) so wall-clock jumps
 * mid-call don't poison it.
 *
 * Body failures propagate unchanged; trace emission inside `finally` runs
 * in a nested try/catch and routes failures to stderr as
 * `[TRACE-EMIT-ERROR]`.
 */
export function buildPwshTraceHelper(): string {
  return `
$global:CGTraceUnixOrigin = $env:CG_TRACE_BENCH_START_UNIX_MICROS
$global:CGTraceTid        = [int]$env:CG_TRACE_TID

function CG-Trace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]      $Name,
        [Parameter(Mandatory)] [scriptblock] $Body,
        [hashtable]                          $TraceArgs = @{}
    )
    if (-not $global:CGTraceUnixOrigin -or $global:CGTraceTid -eq 0) {
        return & $Body
    }
    $nowMicros = if ([DateTimeOffset].GetMethod('ToUnixTimeMicroseconds')) {
        [DateTimeOffset]::UtcNow.ToUnixTimeMicroseconds()
    } else {
        [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000
    }
    $tsMicros = $nowMicros - [long]$global:CGTraceUnixOrigin
    $sw       = [System.Diagnostics.Stopwatch]::StartNew()
    $ok       = $true
    $errType  = $null
    $errMsg   = $null
    try {
        & $Body
    } catch {
        $ok      = $false
        $errType = $_.Exception.GetType().FullName
        $errMsg  = $_.Exception.Message
        if ($errMsg.Length -gt 200) { $errMsg = $errMsg.Substring(0, 200) }
        throw
    } finally {
        try {
            $durMicros = [long]($sw.ElapsedTicks * 1000000 / [System.Diagnostics.Stopwatch]::Frequency)
            $finalArgs = @{} + $TraceArgs
            $finalArgs['ok'] = $ok
            if (-not $ok) {
                $finalArgs['errorType']    = $errType
                $finalArgs['errorMessage'] = $errMsg
            }
            $event = @{
                name = $Name
                ph   = 'X'
                ts   = [long]$tsMicros
                dur  = $durMicros
                pid  = 0
                tid  = $global:CGTraceTid
                cat  = 'pwsh,bcch'
                args = $finalArgs
            } | ConvertTo-Json -Compress -Depth 5
            [Console]::Out.WriteLine("[TRACE] $event")
        } catch {
            [Console]::Error.WriteLine("[TRACE-EMIT-ERROR] $($_.Exception.Message)")
        }
    }
}
`;
}

/**
 * Build the PowerShell script for compiling an AL project
 */
export function buildCompileScript(
  compilerFolder: string,
  projectPath: string,
  outputDir: string,
): string {
  return `
      Write-Output "[CG-PIN] buildCompileScript bccontainerhelper@${BCCH_PINNED_VERSION} sentinel=2026-04-25-B"
      Write-Output "[CG-PIN] shell=$($PSVersionTable.PSEdition)/$($PSVersionTable.PSVersion) host=$([Environment]::MachineName) user=$([Environment]::UserName) pid=$PID"
      Write-Output "[CG-PIN] modulepath=$(($env:PSModulePath -split ';' | Select-Object -First 3) -join '|')"
      ${bcchImport()}

      try {
        $result = Compile-AppWithBcCompilerFolder \`
          -compilerFolder "${compilerFolder}" \`
          -appProjectFolder "${projectPath}" \`
          -appOutputFolder "${outputDir}" \`
          -ErrorAction Stop 2>&1

        # Check for compiled app file
        $appFile = Get-ChildItem -Path "${outputDir}" -Filter "*.app" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($appFile) {
          Write-Output "COMPILE_SUCCESS"
          Write-Output "APP_FILE:$($appFile.FullName)"
        } else {
          Write-Output "COMPILE_ERROR"
          Write-Output "ERROR:No .app file was generated"
        }
      } catch {
        Write-Output "COMPILE_ERROR"
        Write-Output "ERROR:$($_.Exception.Message)"
        # Output the full error for parsing
        $_ | Out-String | ForEach-Object { Write-Output "DETAIL:$_" }
      }
    `;
}

/**
 * Build the PowerShell script that unpublishes any prior CentralGauge
 * benchmark candidate app from a container.
 *
 * Mirrors the `buildPublishScript` cleanup filter, scoped to candidates only:
 *   Publisher == "CentralGauge" AND Name -notlike "*Prereq*" AND
 *   Name != "CG Test Harness"
 *
 * Used by `BcContainerProvider.cleanupStaleCandidates` to clear the catalog
 * before publishing a new candidate. Every benchmark candidate shares the
 * fixed `BENCHMARK_APP_ID`; without this sweep, the next Publish fails with
 * "same App ID and Version as a previously published Extension".
 */
export function buildCleanupStaleCandidatesScript(
  containerName: string,
  harnessAppName: string,
): string {
  return `
      ${bcchImport()}
      ${bcchConfigInit()}
      $stale = @(Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object {
        $_.Publisher -eq "CentralGauge" -and
        $_.Name -notlike "*Prereq*" -and
        $_.Name -ne "${harnessAppName}"
      })
      if ($stale.Count -eq 0) {
        Write-Output "CANDIDATE_CLEANUP_NONE"
        return
      }
      Write-Output "CANDIDATE_CLEANUP_FOUND: $($stale.Count)"
      foreach ($app in $stale) {
        try {
          Write-Output "CANDIDATE_CLEANUP_REMOVE: $($app.Name) v$($app.Version)"
          Unpublish-BcContainerApp -containerName "${containerName}" -appName $app.Name -publisher $app.Publisher -version $app.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
          # bccontainerhelper@6.1.14 sometimes reports Unpublish success while BC
          # NST still has the app. Verify and force NST-level cleanup if so —
          # otherwise the next Publish hits "same App ID and Version".
          $stillThere = Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object {
            $_.Name -eq $app.Name -and $_.Publisher -eq $app.Publisher -and $_.Version -eq $app.Version
          }
          if ($stillThere) {
            Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
              param($n, $p, $v)
              # Apps are published per-tenant; Unpublish-NAVApp without -Tenant
              # silently no-ops on a tenant-scoped app. Tenant first, global fallback.
              try { Uninstall-NAVApp -ServerInstance BC -Name $n -Publisher $p -Version $v -Tenant default -Force -ErrorAction SilentlyContinue } catch { }
              try { Uninstall-NAVApp -ServerInstance BC -Name $n -Publisher $p -Version $v -Force -ErrorAction SilentlyContinue } catch { }
              try { Unpublish-NAVApp -ServerInstance BC -Name $n -Publisher $p -Version $v -Tenant default -ErrorAction SilentlyContinue } catch { }
              try { Unpublish-NAVApp -ServerInstance BC -Name $n -Publisher $p -Version $v -ErrorAction SilentlyContinue } catch { }
            } -argumentList $app.Name, $app.Publisher, $app.Version
          }
        } catch {
          Write-Output "CANDIDATE_CLEANUP_WARN: $($app.Name) - $($_.Exception.Message)"
        }
      }
      Write-Output "CANDIDATE_CLEANUP_DONE"
    `;
}

/**
 * Build the combined "prepare candidate app" script: targeted cleanup of
 * prior CentralGauge candidate(s) via direct in-container NAV cmdlets,
 * followed by a Publish-BcContainerApp of the new candidate. ONE script
 * invocation through the warm slot.
 *
 * Why this exists. The trace smoke (results/smoke-trace-<stamp>/trace.json)
 * showed `cleanupStaleCandidates` and `publishApp` each costing ~120 s
 * even on the warm per-container session slot, because BCH's
 * Windows-PowerShell sub-session (under `usePwshForBc24 = $false`) is
 * disposed at end-of-script. Combining the two into one script pays the
 * bridge setup ONCE instead of twice.
 *
 * Cleanup uses `Invoke-ScriptInBcContainer { Get-NAVAppInfo | Uninstall-NAVApp; Unpublish-NAVApp }`
 * inside the container. Diagnostic 2.D4 showed this path runs in ~4 s on
 * a corrupted post-Run-TestsInBcContainer container — well-behaved, no
 * BCH wrapper retry needed.
 *
 * Filter mirrors `buildCleanupStaleCandidatesScript`:
 *   Publisher == "CentralGauge" AND Name -notlike "*Prereq*" AND
 *   Name != harnessAppName
 *
 * Output markers (host-side parser keys off these):
 *   PREPARE_CLEANUP_FOUND:<n>
 *   PREPARE_CLEANUP_REMOVE:<name> v<version>
 *   PREPARE_CLEANUP_WARN:<name> - <reason>
 *   PREPARE_PUBLISH_START:<unix-ms>
 *   PREPARE_PUBLISH_END:<unix-ms>
 *   PREPARE_PUBLISH_OK
 *   PREPARE_PUBLISH_FAILED:<msg>
 */
export function buildPrepareCandidateScript(
  containerName: string,
  escapedAppFile: string,
  harnessAppName: string,
  credentials: ContainerCredentials = { username: "admin", password: "admin" },
): string {
  // Publish the candidate via the BC development-service HTTP endpoint
  // (`POST :<devport>/<instance>/dev/apps`, the F5/VS Code path) instead of
  // the PSSession-based Publish-NAVApp wrapper. Skips the host->container
  // file copy + WinPS bridge marshalling; keeps the ForceSync schema apply
  // (real server work). Microbench (E001, n=3): publish ~5.7s -> ~4.1s,
  // prepare-candidate ~8.8s -> ~7.1s (~20-30% faster on the serial mutex
  // hold). Default ON; opt out with CENTRALGAUGE_DEV_ENDPOINT_PUBLISH=0.
  //
  // The dev endpoint authenticates over HTTP Basic (the container runs
  // -auth NavUserPassword), so it REQUIRES an explicit -credential — unlike
  // the legacy wrapper, which rides the session's Windows auth. Build the
  // PSCredential inline (mirrors buildRunTestsScript) only when enabled.
  const useDevEndpoint =
    Deno.env.get("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH") !== "0";
  const devCredentialSetup = useDevEndpoint
    ? `      $cgPubPassword = ConvertTo-SecureString '${
      escapeForPS(credentials.password)
    }' -AsPlainText -Force
      $cgPubCredential = New-Object PSCredential('${
      escapeForPS(credentials.username)
    }', $cgPubPassword)
`
    : "";
  const devEndpointFlag = useDevEndpoint
    ? " -useDevEndpoint -credential $cgPubCredential"
    : "";
  return `
      ${bcchImport()}
      ${bcchConfigInit()}
      ${buildPwshTraceHelper()}
${devCredentialSetup}
      # --- A-prime cleanup: direct in-container NAV cmdlets ---
      # Bypasses BCH's host-side wrapper entirely. Reuses the container's
      # already-running Windows PowerShell + Microsoft.Dynamics.Nav.Management
      # PSSession (cached by Invoke-ScriptInBcContainer). Diagnostic 2.D4
      # measured this at ~4 s end-to-end.
      try {
        $cleanupReport = CG-Trace -Name "Invoke-ScriptInBcContainer:cleanup" -TraceArgs @{container="${containerName}"} -Body {
          Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
          param($harnessName)
          $stale = @(Get-NAVAppInfo -ServerInstance BC | Where-Object {
            $_.Publisher -eq "CentralGauge" -and
            $_.Name -notlike "*Prereq*" -and
            $_.Name -ne $harnessName
          })
          if ($stale.Count -eq 0) {
            Write-Output "PREPARE_CLEANUP_NONE"
            return
          }
          Write-Output "PREPARE_CLEANUP_FOUND:$($stale.Count)"
          foreach ($app in $stale) {
            try {
              Write-Output "PREPARE_CLEANUP_REMOVE:$($app.Name) v$($app.Version)"
              # Apps are published per-tenant; Unpublish-NAVApp without -Tenant
              # silently no-ops on a tenant-scoped app. Tenant first, global fallback.
              try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -Force -ErrorAction SilentlyContinue } catch { }
              try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Force -ErrorAction SilentlyContinue } catch { }
              $done = $false
              try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -ErrorAction Stop; $done = $true } catch { }
              if (-not $done) {
                try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -ErrorAction Stop; $done = $true } catch { }
              }
              if (-not $done) {
                Write-Output "PREPARE_CLEANUP_WARN:$($app.Name) - unpublish failed (tenant+global)"
              }
            } catch {
              Write-Output "PREPARE_CLEANUP_WARN:$($app.Name) - $($_.Exception.Message)"
            }
          }
          } -argumentList "${harnessAppName}"
        }
        $cleanupReport | ForEach-Object { Write-Output $_ }
      } catch {
        Write-Output "PREPARE_CLEANUP_WARN:invoke-script - $($_.Exception.Message)"
      }

      # --- Publish new candidate via the host-side BCH wrapper ---
      # Sync + install in one call so the next SOAP test can run immediately.
      try {
        Write-Output "PREPARE_PUBLISH_START:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        CG-Trace -Name "Publish-BcContainerApp" -TraceArgs @{container="${containerName}";appFile="${escapedAppFile}"} -Body {
          Publish-BcContainerApp -containerName "${containerName}" -appFile "${escapedAppFile}" -skipVerification -sync -syncMode ForceSync -install${devEndpointFlag} -ErrorAction Stop
        }
        Write-Output "PREPARE_PUBLISH_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        Write-Output "PREPARE_PUBLISH_OK"
      } catch {
        Write-Output "PREPARE_PUBLISH_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        Write-Output "PREPARE_PUBLISH_FAILED:$($_.Exception.Message)"
        exit 1
      }
    `;
}

/**
 * Build the per-task "orphan prereq" cleanup script: removes CentralGauge
 * prereq apps left resident by a PRIOR task before the current task publishes
 * its own prereqs. Without this, two tasks whose prereqs declare the same
 * object ID (e.g. table 69225 across CG-AL-H022/H023/H024/H026) end up resident
 * simultaneously and the next publish fails with "defined in multiple apps",
 * scoring an innocent fixture as an `infra` failure. See GitHub issue #10.
 *
 * Why in-container (issue #10). The previous implementation ran host-side
 * `Unpublish-BcContainerApp` through `executePowerShell` (cold `pwsh`), which is
 * unreliable under pwsh 7 with `usePwshForBc24 = $false` — it dies after the
 * first app and the sweep silently no-ops, so orphans accumulate. This builder
 * mirrors `buildPrepareCandidateScript`: the actual uninstall/unpublish runs
 * INSIDE the container via `Invoke-ScriptInBcContainer { Get-NAVAppInfo |
 * Uninstall-NAVApp; Unpublish-NAVApp }`, which works regardless of host shell.
 * Route it through `runScriptThroughSession` (the warm slot), NOT a fresh
 * `powershell.exe`, to avoid re-paying the ~120 s BCH bridge setup per task.
 *
 * Two-phase ordering (issue #10). The prior task's CANDIDATE app is usually
 * still installed when this runs (candidate cleanup happens later, inside
 * `runTests` -> `prepareCandidateApp`), and that candidate depends on the prior
 * task's prereqs. Removing a prereq while a dependent candidate is still
 * resident fails ("still in use"), so we remove non-prereq CentralGauge apps
 * (except the harness) FIRST, then the orphan prereqs — the same ordering the
 * bench-startup prenuke uses.
 *
 * Empirical leaf-first removal. Removable = every CentralGauge non-prereq
 * candidate + every orphan prereq (a `*Prereq*` app NOT in the current task's
 * `expectedPrereqNames`), treated as ONE set (the old Phase-1/Phase-2 split
 * wedged when a candidate survived and left its prereqs pinned forever). Each
 * pass attempts to unpublish EVERY removable app: leaves succeed; a non-leaf
 * throws "required by the following apps", is swallowed, and is retried next
 * pass once its dependents are gone — peeling the chain (candidate -> H024
 * Prereq -> H022 Prereq) one layer per pass. We do NOT read Get-NAVAppInfo
 * `.Dependencies` (not reliably populated); progress is measured by re-querying
 * the removable count after each pass.
 *
 * Continue while a pass makes progress (>= 1 removed). If a full pass removes
 * nothing, the survivors are pinned by a KEPT app (expected prereq / harness /
 * Microsoft): emit `PREREQ_CLEANUP_BLOCKED:<name> v<version>` for diagnosis and
 * stop; the final recount fires `PREREQ_CLEANUP_INCOMPLETE:<remaining>` so the
 * caller fails with correct attribution instead of accumulating silently.
 *
 * `expectedPrereqNames` are the Names of the CURRENT task's prereqs (kept).
 *
 * Output markers (host-side parser keys off these):
 *   PREREQ_CLEANUP_NONE
 *   PREREQ_CLEANUP_FOUND:<n>
 *   PREREQ_CLEANUP_REMOVE:<name> v<version>
 *   PREREQ_CLEANUP_WARN:<name> - <reason>
 *   PREREQ_CLEANUP_BLOCKED:<name> v<version>
 *   PREREQ_CLEANUP_INCOMPLETE:<remaining>
 *   PREREQ_CLEANUP_DONE
 */
export function buildPrereqCleanupScript(
  containerName: string,
  expectedPrereqNames: string[],
  harnessAppName: string,
): string {
  const expectedNamesLit = expectedPrereqNames.length === 0
    ? "@()"
    : "@(" + expectedPrereqNames.map((n) => `'${escapeForPS(n)}'`).join(",") +
      ")";
  return `
      ${bcchImport()}
      ${bcchConfigInit()}

      $expectedNames = ${expectedNamesLit}
      try {
        $report = Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
          param($expected, $harnessName)
          $out = @()

          # Removable = CentralGauge apps we are allowed to drop: every
          # non-prereq candidate, plus orphan prereqs NOT in the current task's
          # expected set. The harness + expected prereqs are kept.
          $isRemovable = {
            param($a)
            if ($a.Publisher -ne "CentralGauge") { return $false }
            if ($a.Name -eq $harnessName) { return $false }
            if ($a.Name -like "*Prereq*") { return ($expected -notcontains $a.Name) }
            return $true
          }
          $snapshot = { @(Get-NAVAppInfo -ServerInstance BC) }

          $removable0 = @((& $snapshot) | Where-Object { & $isRemovable $_ })
          if ($removable0.Count -eq 0) {
            $out += "PREREQ_CLEANUP_NONE"
          } else {
            $out += "PREREQ_CLEANUP_FOUND:$($removable0.Count)"
          }

          # Empirical leaf-first removal (does NOT read app dependency metadata,
          # which Get-NAVAppInfo does not reliably populate): each pass attempts
          # to unpublish EVERY removable app. Leaves succeed; a non-leaf throws
          # "required by the following apps", is swallowed, and is retried next
          # pass once its dependents are gone. Continue while a pass makes
          # progress (>= 1 removed). If a full pass removes nothing, the
          # survivors are pinned by a KEPT app -> emit BLOCKED + stop.
          $maxPasses = 25
          for ($pass = 1; $pass -le $maxPasses; $pass++) {
            $removable = @((& $snapshot) | Where-Object { & $isRemovable $_ })
            $before = $removable.Count
            if ($before -eq 0) { break }
            foreach ($app in $removable) {
              # The bench installs candidates/prereqs per-TENANT, so an app's
              # published package is tenant-scoped: Unpublish-NAVApp WITHOUT
              # -Tenant reports "not published" and silently leaves it (the real
              # cause of the stuck chain). Try tenant scope first, then global as
              # a fallback for any globally-published app.
              try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -Force -ErrorAction SilentlyContinue } catch { }
              try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Force -ErrorAction SilentlyContinue } catch { }
              $done = $false
              try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -ErrorAction Stop; $done = $true } catch { }
              if (-not $done) {
                try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -ErrorAction Stop; $done = $true } catch { }
              }
              if ($done) {
                $out += "PREREQ_CLEANUP_REMOVE:$($app.Name) v$($app.Version)"
              }
              # else: non-leaf this pass (a dependent still published) OR not
              # found in either scope -> retried next pass; the no-progress
              # guard breaks + emits BLOCKED if nothing can be removed.
            }
            $after = @((& $snapshot) | Where-Object { & $isRemovable $_ }).Count
            if ($after -eq 0) { break }
            if ($after -ge $before) {
              # No progress in a full pass -> genuinely stuck: a KEPT app
              # (expected prereq / harness / Microsoft) depends on these.
              foreach ($s in @((& $snapshot) | Where-Object { & $isRemovable $_ })) {
                $out += "PREREQ_CLEANUP_BLOCKED:$($s.Name) v$($s.Version)"
              }
              break
            }
          }

          $remaining = @((& $snapshot) | Where-Object { & $isRemovable $_ }).Count
          if ($remaining -gt 0) { $out += "PREREQ_CLEANUP_INCOMPLETE:$remaining" }
          $out += "PREREQ_CLEANUP_DONE"
          $out
        } -argumentList (,$expectedNames), "${escapeForPS(harnessAppName)}"
        $report | ForEach-Object { Write-Output $_ }
      } catch {
        Write-Output "PREREQ_CLEANUP_WARN:invoke-script - $($_.Exception.Message)"
      }
    `;
}

/**
 * Build the publish app script block
 */
export function buildPublishScript(
  containerName: string,
  escapedAppFile: string,
): string {
  return `
      # Unpublish existing apps that might conflict, EXCEPT prereqs (which we depend on)
      # Prereq apps have "Prereq" in their name by convention
      # Clean up:
      # 1. CentralGauge apps (from our benchmarks)
      # 2. Apps with common default publishers that agents might use
      # 3. Apps with task-related names like "Task App"
      $publishersToClean = @("CentralGauge", "Default Publisher", "Default", "")
      $conflictApps = @(Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object {
        ($publishersToClean -contains $_.Publisher -or $_.Name -like "*Task*") -and
        $_.Name -notlike "*Prereq*" -and
        $_.Name -ne "CG Test Harness" -and
        $_.Publisher -ne "Microsoft"
      })
      foreach ($app in $conflictApps) {
        try {
          Write-Output "CLEANUP:Removing $($app.Name) by $($app.Publisher)"
          Unpublish-BcContainerApp -containerName "${containerName}" -appName $app.Name -publisher $app.Publisher -version $app.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
        } catch { }
      }

      # Publish the app with ForceSync for destructive schema changes
      try {
        Write-Output "PUBLISH_START:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        Publish-BcContainerApp -containerName "${containerName}" -appFile "${escapedAppFile}" -skipVerification -sync -syncMode ForceSync -install -ErrorAction Stop
        Write-Output "PUBLISH_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
      } catch {
        Write-Output "PUBLISH_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        Write-Output "PUBLISH_FAILED:$($_.Exception.Message)"
        exit 1
      }
    `;
}

/**
 * Build the run tests script block
 */
export function buildRunTestsScript(
  containerName: string,
  extensionId: string,
  testCodeunitId?: number,
): string {
  // Build extensionId parameter if provided
  const extensionIdParam = extensionId ? `-extensionId "${extensionId}"` : "";
  // Use specific codeunit ID if provided, otherwise scan all with "*"
  const codeunitFilter = testCodeunitId ? testCodeunitId.toString() : "*";

  return `
      # Run tests
      Write-Output "TEST_START:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
      try {
        # Use -detailed for verbose output
        # The *>&1 captures all streams (including Write-Host) and outputs them
        $results = Run-TestsInBcContainer -containerName "${containerName}" -credential $credential ${extensionIdParam} -testCodeunit "${codeunitFilter}" -detailed -ErrorAction Stop *>&1

        # Output each line and count test results for accurate pass/fail detection
        $passedCount = 0
        $failedCount = 0
        foreach ($line in $results) {
          $lineStr = "$line"
          Write-Output $lineStr
          # Match test result lines: "Testfunction <name> Success/Failure"
          # Use capture group to determine pass/fail status
          if ($lineStr -match "Testfunction\s+\S+\s+(Success|Failure)") {
            if ($Matches[1] -eq "Success") {
              $passedCount++
            } else {
              $failedCount++
            }
          }
        }

        if ($failedCount -eq 0 -and $passedCount -gt 0) {
          Write-Output "ALL_TESTS_PASSED"
        } elseif ($failedCount -gt 0) {
          Write-Output "SOME_TESTS_FAILED"
        }
      } catch {
        Write-Output "TEST_ERROR:$($_.Exception.Message)"
      }
      Write-Output "TEST_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    `;
}

/**
 * Build the post-test cleanup script block
 */
export function buildPostCleanupScript(containerName: string): string {
  return `
      # POST-TEST CLEANUP: Uninstall and unpublish the test app
      try {
        Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
          $apps = Get-NAVAppInfo -ServerInstance BC | Where-Object { $_.Publisher -eq "CentralGauge" }
          if ($apps) {
            foreach ($app in $apps) {
              $version = $app.Version.ToString()
              Write-Host "CLEANUP:Removing app $($app.Name) (Publisher=$($app.Publisher))"
              # Tenant-scoped first (per-tenant install), then global fallback.
              try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $version -Tenant default -Force -ErrorAction SilentlyContinue } catch {}
              try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $version -Force -ErrorAction SilentlyContinue } catch {}
              try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $version -Tenant default -ErrorAction SilentlyContinue } catch {}
              try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $version -ErrorAction SilentlyContinue } catch {}
            }
          }
        }
      } catch {
        Write-Output "CLEANUP_WARNING:$($_.Exception.Message)"
      }
    `;
}

/**
 * Build the complete PowerShell script for publishing and running tests
 */
export function buildTestScript(
  containerName: string,
  credentials: ContainerCredentials,
  appFilePath: string,
  extensionId: string,
  testCodeunitId?: number,
): string {
  const escapedAppFile = appFilePath.replace(/\\/g, "\\\\");

  // Prereqs are already published by publishApp() - just publish main app and run tests
  // Note: PRECLEAN removed - fixed app ID with ForceSync handles updates in place (~13s savings)
  return `
      Write-Output "[CG-PIN] buildTestScript bccontainerhelper@${BCCH_PINNED_VERSION} usePwshForBc24=${bcchUsePwshForBc24Sentinel()} sentinel=2026-04-25-B"
      Write-Output "[CG-PIN] shell=$($PSVersionTable.PSEdition)/$($PSVersionTable.PSVersion) host=$([Environment]::MachineName) user=$([Environment]::UserName) pid=$PID"
      Write-Output "[CG-PIN] modulepath=$(($env:PSModulePath -split ';' | Select-Object -First 3) -join '|')"
      ${bcchImport()}
      # Use Windows PowerShell inside the container — pwsh sessions don't auto-load
      # Microsoft.Dynamics.Nav.Management (it's a .NET Framework module), so after
      # any Unpublish-BcContainerApp on a cached pwsh session, Get-NavServerInstance
      # disappears and Publish-BcContainerApp fails. Reverified 6.1.14 (see
      # scripts/microbench-soap.ts log + scripts/bcch-pwsh-repro.ps1).
      ${bcchConfigInit()}

      $password = ConvertTo-SecureString '${
    escapeForPS(credentials.password)
  }' -AsPlainText -Force
      $credential = New-Object PSCredential('${
    escapeForPS(credentials.username)
  }', $password)

      ${buildPublishScript(containerName, escapedAppFile)}
      ${buildRunTestsScript(containerName, extensionId, testCodeunitId)}
    `;
}

/** Harness Bench: every CentralGauge app with its installed state (verified in M1-27). */
/** Container names as Docker allows them; anything else never reaches a script. */
function harnessContainerName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new Error(
      `refusing an unsafe container name: ${JSON.stringify(name)}`,
    );
  }
  return name;
}

export function buildListHarnessAppsScript(containerName: string): string {
  const cn = harnessContainerName(containerName);
  return `
      ${bcchImport()}
      ${bcchConfigInit()}
      try {
        $cgRows = Invoke-ScriptInBcContainer -containerName '${cn}' -scriptblock {
          Get-NAVAppInfo -ServerInstance BC -Tenant default -TenantSpecificProperties |
            Where-Object { $_.Publisher -eq "CentralGauge" } |
            ForEach-Object {
              "CG_APP:" + (@{ id = "$($_.AppId)"; name = $_.Name; publisher = $_.Publisher; version = "$($_.Version)"; installed = [bool]$_.IsInstalled } | ConvertTo-Json -Compress)
            }
        }
        $cgRows | ForEach-Object { Write-Output $_ }
        Write-Output "CG_APPS_DONE"
      } catch {
        Write-Output "CG_APPS_FAILED:$($_.Exception.Message)"
      }
    `;
}

/**
 * The in-container removal scriptblock body (param($ids, $allow)): fail
 * closed. Per app, immediately before any mutation: publisher CentralGauge,
 * id on the trusted allowlist, name matching its allowlist regex. Then
 * uninstall (no saved data) if installed, verify it is no longer installed,
 * clean its schema, unpublish (tenant scope, then global), verify it is
 * gone. No step's error is suppressed: any failure prints
 * SYNC_REMOVE_FAILED:<id> <step> <message> and stops the block. The one
 * retry: an uninstall that fails in a pass is retried in the next pass (a
 * dependent listed later goes first); a pass with no progress fails.
 * Exported so unit tests run it in pwsh against stubbed cmdlets.
 */
export function buildHarnessRemoveBlock(): string {
  return `
            param([string[]]$ids, [hashtable]$allow)
            function Remove-CgApp($id, $app) {
              if ($app.Publisher -ne 'CentralGauge' -or -not $allow.ContainsKey($id) -or "$($app.Name)" -cnotmatch $allow[$id]) {
                return "failed check publisher=$($app.Publisher) name=$($app.Name)"
              }
              $st = @(Get-NAVAppInfo -ServerInstance BC -Id $id -Version $app.Version -Tenant default -TenantSpecificProperties)
              if (@($st | Where-Object { $_.IsInstalled }).Count -gt 0) {
                try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -DoNotSaveData -ErrorAction Stop }
                catch { return "retry uninstall $($_.Exception.Message)" }
              }
              $st = @(Get-NAVAppInfo -ServerInstance BC -Id $id -Version $app.Version -Tenant default -TenantSpecificProperties)
              if (@($st | Where-Object { $_.IsInstalled }).Count -gt 0) { return "failed verify-uninstalled still installed" }
              try { Sync-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Mode Clean -Force -ErrorAction Stop }
              catch { return "failed clean $($_.Exception.Message)" }
              try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -ErrorAction Stop }
              catch {
                $tenantError = $_.Exception.Message
                try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -ErrorAction Stop }
                catch { return "failed unpublish tenant: $tenantError; global: $($_.Exception.Message)" }
              }
              if (@(Get-NAVAppInfo -ServerInstance BC -Id $id -Version $app.Version).Count -gt 0) { return "failed verify-gone still published" }
              return "ok"
            }
            $pending = @($ids)
            for ($cgPass = 1; $cgPass -le $ids.Count; $cgPass++) {
              $next = @()
              $why = @{}
              foreach ($id in $pending) {
                foreach ($app in @(Get-NAVAppInfo -ServerInstance BC -Id $id)) {
                  $r = Remove-CgApp $id $app
                  if ($r -eq 'ok') { Write-Output "SYNC_REMOVE:$id v$($app.Version)" }
                  elseif ($r -like 'retry *') { $next += $id; $why[$id] = $r.Substring(6); break }
                  else { Write-Output "SYNC_REMOVE_FAILED:$id $($r.Substring(7))"; return }
                }
              }
              if ($next.Count -eq 0) { return }
              if ($next.Count -eq $pending.Count) {
                foreach ($id in $next) { Write-Output "SYNC_REMOVE_FAILED:$id $($why[$id])" }
                return
              }
              $pending = $next
            }
            foreach ($id in $pending) { Write-Output "SYNC_REMOVE_FAILED:$id passes exhausted" }
`;
}

/**
 * Harness Bench app sync in ONE warm-slot script (bc-container-quirks.md):
 * a read-only pre-check of every removal id (publisher, trusted allowlist,
 * name), then the fail-closed removal block (buildHarnessRemoveBlock), then
 * publish of the given files in order with ForceSync + install. Removal is
 * scoped to trusted ids only, unlike buildPrepareCandidateScript, whose
 * filter removes the refapp dependencies. Any removal failure exits 1 before
 * a publish.
 * ponytail: the dev-endpoint credential block duplicates
 * buildPrepareCandidateScript; extract a shared helper when a third caller
 * appears.
 *
 * Markers: SYNC_REMOVE:<id> v<ver>, SYNC_REMOVE_REFUSED:<id> <why>,
 * SYNC_REMOVE_FAILED:<id> <step> <msg>, SYNC_PUBLISH_MS:<i>:<stopwatch ms>,
 * SYNC_PUBLISH_FAILED:<i>:<msg>, SYNC_DONE.
 */
export function buildSyncHarnessAppsScript(
  containerName: string,
  removeIds: string[],
  appFiles: string[],
  credentials: ContainerCredentials = { username: "admin", password: "admin" },
  /** Trusted allowlist: app id to the regex its name must match (trustedHarnessAppIds). */
  allow: ReadonlyMap<string, string> = new Map(),
  /** Owned apps about to be published: purge kept tenant data when not published (M1-15a). */
  clean: { id: string; name: string }[] = [],
): string {
  const cn = harnessContainerName(containerName);
  const useDevEndpoint =
    Deno.env.get("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH") !== "0";
  const credentialSetup = useDevEndpoint
    ? `      $cgPubPassword = ConvertTo-SecureString '${
      escapeForPS(credentials.password)
    }' -AsPlainText -Force
      $cgPubCredential = New-Object PSCredential('${
      escapeForPS(credentials.username)
    }', $cgPubPassword)
`
    : "";
  const flag = useDevEndpoint
    ? " -useDevEndpoint -credential $cgPubCredential"
    : "";
  const list = (xs: string[]) =>
    xs.length === 0
      ? "@()"
      : `@(${xs.map((x) => `'${escapeForPS(x)}'`).join(", ")})`;
  const cleanList = clean.length === 0
    ? "@()"
    : `@(${
      clean.map((c) =>
        `@{ id = '${escapeForPS(c.id)}'; name = '${escapeForPS(c.name)}' }`
      ).join(", ")
    })`;
  const table = `@{ ${
    [...allow].map(([id, re]) => `'${escapeForPS(id)}' = '${escapeForPS(re)}'`)
      .join("; ")
  } }`;
  return `
      ${bcchImport()}
      ${bcchConfigInit()}
${credentialSetup}
      $cgRemoveIds = ${list(removeIds)}
      $cgAllow = ${table}
      if ($cgRemoveIds.Count -gt 0) {
        # Read-only pre-check, before anything is uninstalled: a foreign or
        # unexpected app sharing an id refuses the whole sync, untouched.
        try {
          $cgCheck = Invoke-ScriptInBcContainer -containerName '${cn}' -scriptblock {
            param([string[]]$ids, [hashtable]$allow)
            foreach ($id in $ids) {
              if (-not $allow.ContainsKey($id)) { Write-Output "SYNC_REMOVE_REFUSED:$id not on the removal allowlist"; continue }
              foreach ($app in @(Get-NAVAppInfo -ServerInstance BC -Id $id)) {
                if ($app.Publisher -ne 'CentralGauge' -or "$($app.Name)" -cnotmatch $allow[$id]) {
                  Write-Output "SYNC_REMOVE_REFUSED:$id publisher=$($app.Publisher) name=$($app.Name)"
                }
              }
            }
          } -argumentList $cgRemoveIds, $cgAllow
        } catch {
          $cgCheck = @("SYNC_REMOVE_REFUSED:check $($_.Exception.Message)")
        }
        $cgCheck | ForEach-Object { Write-Output $_ }
        if (@($cgCheck | Where-Object { "$_" -like 'SYNC_REMOVE_REFUSED:*' }).Count -gt 0) { exit 1 }
        try {
          $cgReport = Invoke-ScriptInBcContainer -containerName '${cn}' -scriptblock {
${buildHarnessRemoveBlock()}
          } -argumentList $cgRemoveIds, $cgAllow
        } catch {
          $cgReport = @("SYNC_REMOVE_FAILED:invoke $($_.Exception.Message)")
        }
        $cgReport | ForEach-Object { Write-Output $_ }
        # A contaminated container is never published onto.
        if (@($cgReport | Where-Object { "$_" -like 'SYNC_REMOVE_FAILED:*' }).Count -gt 0) { exit 1 }
      }
      $cgClean = ${cleanList}
      if ($cgClean.Count -gt 0) {
        # Owned apps about to be published that are NOT published now may still
        # have tenant data at a higher version (the bench prenuke keeps data);
        # BC then refuses the lower version. Purge that data by name (M1-15a).
        # A published app is left to the removal path above.
        try {
          $cgCleanOut = Invoke-ScriptInBcContainer -containerName '${cn}' -scriptblock {
            param($items, [hashtable]$allow)
            foreach ($it in $items) {
              $id = "$($it.id)"
              $name = "$($it.name)"
              if (-not $allow.ContainsKey($id) -or $name -cnotmatch $allow[$id]) {
                Write-Output "SYNC_CLEAN_REFUSED:$id $name not on the removal allowlist"
                continue
              }
              if (@(Get-NAVAppInfo -ServerInstance BC -Id $id).Count -gt 0) { continue }
              try {
                Sync-NAVApp -ServerInstance BC -Tenant default -Name $name -Publisher 'CentralGauge' -Mode Clean -Force -ErrorAction Stop
                Write-Output "SYNC_CLEAN:$id"
              } catch {
                # Nothing to clean is not an error; a real problem surfaces at the publish below.
                Write-Output "SYNC_CLEAN_WARN:$id $($_.Exception.Message)"
              }
            }
          } -argumentList $cgClean, $cgAllow
        } catch {
          $cgCleanOut = @("SYNC_CLEAN_WARN:invoke $($_.Exception.Message)")
        }
        $cgCleanOut | ForEach-Object { Write-Output $_ }
        if (@($cgCleanOut | Where-Object { "$_" -like 'SYNC_CLEAN_REFUSED:*' }).Count -gt 0) { exit 1 }
      }
      $cgFiles = ${list(appFiles)}
      for ($i = 0; $i -lt $cgFiles.Count; $i++) {
        $cgSw = [Diagnostics.Stopwatch]::StartNew()
        try {
          Publish-BcContainerApp -containerName '${cn}' -appFile $cgFiles[$i] -skipVerification -sync -syncMode ForceSync -install${flag} -ErrorAction Stop
          Write-Output "SYNC_PUBLISH_MS:$($i):$($cgSw.ElapsedMilliseconds)"
        } catch {
          Write-Output "SYNC_PUBLISH_MS:$($i):$($cgSw.ElapsedMilliseconds)"
          Write-Output "SYNC_PUBLISH_FAILED:$($i):$(($_.Exception.Message) -replace '\\s+', ' ')"
          exit 1
        }
      }
      Write-Output "SYNC_DONE"
    `;
}
