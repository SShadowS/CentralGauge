#Requires -Version 7
<#
.SYNOPSIS
  Fast authoring loop for a SINGLE trap-task against ~3 models.

.DESCRIPTION
  FULLY LOCAL — never touches the prod scoreboard:
    * --no-ingest                    -> results are not uploaded
    * CENTRALGAUGE_BENCH_PRECHECK=0  -> belt-and-braces; --no-ingest alone
      already gates the precheck (bench-command.ts: `benchPrecheckEnabled &&
      options.ingest !== false`), but run-xbench.ps1 records a real prod
      pollution incident, so both stay.

  Container split is deliberate. The sanity lane runs the known-good reference
  solution through trap-probe on Cronus28; the model bench runs on the OTHER
  three containers. endOfRunNuke unpublishes apps but does NOT roll back data,
  and a trap oracle containing Commit() defeats the test runner's rollback —
  its rows then collide with the next run's [GIVEN] seed and score as a FALSE
  FAILURE with no infra signature to trigger a reroute. Sharing containers
  between lane and bench would manufacture exactly the false failures this
  loop exists to detect. Cronus28 is also the only container with credentials
  wired for trap-probe (others 401).

.PARAMETER TraceFile
  Optional path to write a Chrome Trace Format file for the bench run (forwarded
  as bench's own `--trace-file`). Omit for the normal authoring loop; useful for
  measuring startup-phase (`setup.*`) span durations, e.g. when comparing a cold
  vs warm compiler-cache run.

.EXAMPLE
  .\run-xiterate.ps1 tasks/hard/CG-AL-X037-inner-commit.yml

.EXAMPLE
  .\run-xiterate.ps1 tasks/hard/CG-AL-X037-inner-commit.yml -Models "anthropic/claude-opus-4-8,anthropic/claude-sonnet-4-6"

.EXAMPLE
  .\run-xiterate.ps1 tasks/hard/CG-AL-X035-poisoned-rescue.yml -NoSanity -TraceFile results/trace-cold.json
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $TaskPath,

  [string] $Models = "anthropic/claude-opus-4-8,anthropic/claude-sonnet-4-6,anthropic/claude-haiku-4-5-20251001",

  # Bench containers. Cronus28 is deliberately EXCLUDED — it belongs to the
  # sanity lane. See .DESCRIPTION.
  [string] $Containers = "Cronus282,Cronus283,Cronus284",

  [string] $SanityContainer = "Cronus28",

  [string] $DebugOutput = "h:\Temp3",

  # Skip the sanity lane even when a reference solution exists.
  [switch] $NoSanity,

  # Write a Chrome Trace Format file via bench's own --trace-file. Omitted by
  # default, in which case $benchArgs is byte-identical to before this param
  # existed.
  [string] $TraceFile
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path $TaskPath)) { throw "Task file not found: $TaskPath" }

$env:CENTRALGAUGE_BENCH_PRECHECK = "0"

# Resolve the task id from the YAML's `id:` field — NOT the filename. The
# reference solution lives at scratch/<id>/correct/ and trap-probe takes an id.
$idLine = Select-String -Path $TaskPath -Pattern '^id:\s*(\S+)' | Select-Object -First 1
if (-not $idLine) { throw "No 'id:' field found in $TaskPath" }
$taskId = $idLine.Matches[0].Groups[1].Value
Write-Host "Task: $taskId  ($TaskPath)" -ForegroundColor Cyan

# ---- Sanity lane (optional, no LLM calls) -------------------------------
$correctDir = Join-Path "scratch" (Join-Path $taskId "correct")
if (-not $NoSanity -and (Test-Path $correctDir)) {
  Write-Host "Sanity lane: $correctDir on $SanityContainer" -ForegroundColor Cyan
  deno run -A scripts/trap-probe.ts `
    --task $taskId `
    --solution $correctDir `
    --expect pass `
    --container $SanityContainer
  $probe = $LASTEXITCODE
  if ($probe -eq 3) {
    Write-Host "[WARN] Sanity lane inconclusive (infra). Re-run it before trusting an all-fail result." -ForegroundColor Yellow
  } elseif ($probe -ne 0) {
    throw "Sanity lane FAILED: the reference solution does not pass this oracle. Fix the test before spending model calls."
  } else {
    Write-Host "[OK] Oracle is satisfiable — an all-models-fail result is real signal." -ForegroundColor Green
  }
} elseif (-not $NoSanity) {
  Write-Host "No reference solution at $correctDir — skipping sanity lane." -ForegroundColor DarkGray
}

# ---- Model bench --------------------------------------------------------
$benchArgs = @(
  "--llms",         $Models,
  "-t",             $TaskPath,
  "--no-ingest",
  "--no-dashboard",
  "--stream",
  "--containers",   $Containers,
  "--runs",         "1",
  "--attempts",     "2",
  "--debug-output", $DebugOutput,
  "--debug-level",  "verbose",
  "--debug"
)
if ($TraceFile) {
  $benchArgs += @("--trace-file", $TraceFile)
}

Write-Host "Benching $taskId | models=$Models | containers=$Containers | LOCAL" -ForegroundColor Green
deno task start bench @benchArgs
exit $LASTEXITCODE
