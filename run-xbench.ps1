#Requires -Version 7
<#
.SYNOPSIS
  Local shakedown bench of the ado-trap-2026 X-cohort (25 trap-tasks: CG-AL-X*).

.DESCRIPTION
  FULLY LOCAL — never touches the prod scoreboard:
    * --no-ingest              -> results are not uploaded
    * CENTRALGAUGE_BENCH_PRECHECK=0 -> disables the startup precheck / catalog auto-seed
      (with --no-ingest alone the precheck once polluted prod — both are needed)

  First pass (default) is a VALIDATION run: one strong model, --runs 1, to confirm the
  suite is solvable + well-calibrated before spending time on wider/deeper runs.

.EXAMPLE
  .\run-xbench.ps1
    Shakedown: opus-4-8, runs=1, 5 containers, local-only.

.EXAMPLE
  .\run-xbench.ps1 -Model "anthropic/claude-opus-4-8,anthropic/claude-sonnet-4-6,anthropic/claude-haiku-4-5-20251001" -Runs 3
    Real discrimination spread (strong -> mid -> weak). Still local (--no-ingest).
    To put results on the scoreboard, remove --no-ingest below and re-enable the precheck.
#>
param(
  [string]$Model       = "anthropic/claude-opus-4-8",
  [int]   $Runs        = 1,
  [string]$Tasks       = "tasks/**/CG-AL-X*.yml",   # scope: e.g. "tasks/hard/CG-AL-X03[345]-*.yml" for the hard batch
  [string]$Containers  = "Cronus28,Cronus282,Cronus283,Cronus284,Cronus285", # add Cronus281 for a 6th worker
  [string]$DebugOutput = "debug/",
  [switch]$SkipCheck
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot   # repo root (this script lives there)

# Keep the run local: precheck/catalog-seed can reach prod even with --no-ingest.
$env:CENTRALGAUGE_BENCH_PRECHECK = "0"

# Verify the model is callable first (skip for a comma-separated multi-model list).
if (-not $SkipCheck -and ($Model -notmatch ",")) {
  Write-Host "Verifying $Model is callable..." -ForegroundColor Cyan
  deno task start models $Model --check
  if ($LASTEXITCODE -ne 0) { throw "Model '$Model' failed --check; aborting before bench." }
}

$benchArgs = @(
  "--llms",             $Model,
  "-t",                 $Tasks,   # default: all X-cohort; override with -Tasks for a subset
  "--no-ingest",
  "--stream",
  "--containers",       $Containers,
  "--runs",             "$Runs",
  "--debug-output",     $DebugOutput,
  "--task-concurrency", "12",
  "--max-concurrency",  "20",
  "--debug-level",      "verbose",
  "--debug"
)

Write-Host "Benching 25 X-cohort tasks | model=$Model runs=$Runs | LOCAL (no-ingest, precheck off)" -ForegroundColor Green
deno task start bench @benchArgs
exit $LASTEXITCODE
