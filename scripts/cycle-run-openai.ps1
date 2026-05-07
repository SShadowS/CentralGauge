<#
.SYNOPSIS
  Run `centralgauge cycle` on the openai/* slugs found in -DebugDir.

.DESCRIPTION
  Thin wrapper around cycle-run.ps1: discovers slugs from -DebugDir, filters
  to those under the `openai/` prefix, then forwards to cycle-run.ps1.

  Use this while a bench against non-openai models is still running — the
  openai models are not being touched, so processing them in parallel is
  safe (each model holds its own lifecycle lock keyed by (model, task_set)).

.PARAMETER DebugDir
  Path to dir holding *-session-*.jsonl. Forwarded to --debug-dir.

.PARAMETER Parallel
  Number of parallel shards across the openai slugs. Default 2.

.PARAMETER AnalyzerModel
  Override analyzer LLM slug. Default: lifecycle.analyzer_model from
  .centralgauge.yml (typically anthropic/claude-opus-4-6).

.PARAMETER DryRun
  Print plan without writing events.

.EXAMPLE
  .\cycle-run-openai.ps1 -DebugDir H:\Temp3

.EXAMPLE
  .\cycle-run-openai.ps1 -DebugDir H:\Temp3 -Parallel 4 -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$DebugDir,

  [int]$Parallel = 2,

  [string]$AnalyzerModel,

  [switch]$DryRun,

  [string[]]$ForceRerun,

  [string]$SessionId
)

$ErrorActionPreference = 'Stop'

$discoverScript = Join-Path $PSScriptRoot 'cycle-discover.ps1'
$runScript      = Join-Path $PSScriptRoot 'cycle-run.ps1'

$DebugDirAbs = (Resolve-Path $DebugDir).Path

$allSlugs = & $discoverScript -DebugDir $DebugDirAbs
$openai = @($allSlugs | Where-Object { $_ -like 'openai/*' })

if ($openai.Count -eq 0) {
  throw "No openai/* slugs discovered under $DebugDirAbs"
}

Write-Host "[INFO] $($openai.Count) openai slugs:"
$openai | ForEach-Object { Write-Host "  $_" }

$forward = @{
  DebugDir = $DebugDirAbs
  Slugs    = $openai
  Parallel = $Parallel
}
if ($AnalyzerModel) { $forward.AnalyzerModel = $AnalyzerModel }
if ($DryRun)        { $forward.DryRun = $true }
if ($ForceRerun)    { $forward.ForceRerun = $ForceRerun }
if ($SessionId)     { $forward.SessionId = $SessionId }

& $runScript @forward
