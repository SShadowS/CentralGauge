<#
.SYNOPSIS
  Run `centralgauge cycle` against a debug dir, optionally sharded across N parallel shells.

.DESCRIPTION
  1. Calls cycle-discover.ps1 to enumerate vendor-prefixed slugs from -DebugDir.
  2. Splits slugs into -Parallel buckets and launches each in a background job.

  Each model has its own lifecycle lock, so parallel shells do not contend.
  Uses --from debug-capture so bench is skipped (debug bundles already exist).
  Passes -DebugDir through to cycle via --debug-dir (no symlink needed).

.PARAMETER DebugDir
  Path to the dir holding *-session-*.jsonl. Forwarded to cycle's --debug-dir.

.PARAMETER Parallel
  Number of parallel shells. Default 3.

.PARAMETER AnalyzerModel
  Override analyzer LLM slug (default: lifecycle.analyzer_model from .centralgauge.yml,
  falling back to anthropic/claude-opus-4-6).

.PARAMETER Slugs
  Override discovered slugs with an explicit list (skip auto-discovery).

.PARAMETER DryRun
  Pass --dry-run to cycle (prints plan, no writes).

.EXAMPLE
  .\cycle-run.ps1 -DebugDir H:\Temp3 -Parallel 3

.EXAMPLE
  .\cycle-run.ps1 -DebugDir H:\Temp3 -Slugs anthropic/claude-opus-4-7,openai/gpt-5.5
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$DebugDir,

  [int]$Parallel = 3,

  [string]$AnalyzerModel,

  [string[]]$Slugs,

  [switch]$DryRun,

  [string[]]$ForceRerun,

  [string]$SessionId
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$DebugDirAbs = (Resolve-Path $DebugDir).Path

# Refresh PATH from registry. The debug-capture step shells `tar | zstd` and
# inherits this process's PATH; if pwsh was started before zstd was installed
# (scoop / winget) the shims dir is not yet on PATH and bash fails with
# `zstd: command not found`.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') +
            ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

$zstd = Get-Command zstd -ErrorAction SilentlyContinue
if (-not $zstd) {
  throw "zstd not found on PATH. Install with: scoop install zstd  (or winget install Facebook.Zstd) and reopen the shell."
}
Write-Host "[OK] zstd at $($zstd.Source)"

# Discover slugs unless caller passed -Slugs
if (-not $Slugs -or $Slugs.Count -eq 0) {
  $discoverScript = Join-Path $PSScriptRoot 'cycle-discover.ps1'
  $Slugs = & $discoverScript -DebugDir $DebugDirAbs
}

# Same CSV-binding quirk as -ForceRerun: pwsh CLI may bind `-Slugs a,b,c` as a
# single string. Split on comma to recover an array.
$Slugs = @($Slugs | ForEach-Object { $_ -split ',' } |
            Where-Object { $_ -ne '' })

if (-not $Slugs -or $Slugs.Count -eq 0) {
  throw "No slugs discovered. Pass -Slugs explicitly or check $DebugDirAbs"
}

Write-Host "[INFO] $($Slugs.Count) slugs:"
$Slugs | ForEach-Object { Write-Host "  $_" }

# Shard into buckets
$buckets = @{}
for ($i = 0; $i -lt $Parallel; $i++) { $buckets[$i] = @() }
for ($i = 0; $i -lt $Slugs.Count; $i++) {
  $buckets[$i % $Parallel] += $Slugs[$i]
}

# Build base args
$baseArgs = @('task', 'start', 'cycle', '--from', 'debug-capture', '--debug-dir', $DebugDirAbs)
if ($AnalyzerModel) { $baseArgs += @('--analyzer-model', $AnalyzerModel) }
if ($SessionId)     { $baseArgs += @('--session', $SessionId) }
if ($DryRun) { $baseArgs += '--dry-run' }
if ($ForceRerun) {
  # Accept either ["a","b","c"] or ["a,b,c"] (pwsh CLI quirk: -P a,b,c may
  # arrive as a single CSV string rather than a 3-element array).
  $rerunSteps = @($ForceRerun | ForEach-Object { $_ -split ',' } |
                  Where-Object { $_ -ne '' })
  foreach ($step in $rerunSteps) { $baseArgs += @('--force-rerun', $step) }
}

# Launch background jobs
$jobs = for ($i = 0; $i -lt $Parallel; $i++) {
  $bucketSlugs = $buckets[$i]
  if ($bucketSlugs.Count -eq 0) { continue }

  $llmArgs = @()
  foreach ($s in $bucketSlugs) { $llmArgs += @('--llms', $s) }
  $allArgs = $baseArgs + $llmArgs

  Write-Host "[LAUNCH] shard $i ($($bucketSlugs.Count) models): $($bucketSlugs -join ', ')"

  Start-Job -Name "cycle-shard-$i" -ScriptBlock {
    param($cwd, $argList)
    Set-Location $cwd
    & deno @argList 2>&1
  } -ArgumentList $repoRoot, $allArgs
}

Write-Host "`n[INFO] $($jobs.Count) jobs launched. Streaming output..."
$jobs | Receive-Job -Wait -AutoRemoveJob
