# BC container control for the owner. Agents must NOT run start or stop (launch contract);
# they may run `status`.
#
#   pwsh -File scripts\coord\containers.ps1 status [-Web]
#   pwsh -File scripts\coord\containers.ps1 start  [-Names Cronus281,Cronus282]
#   pwsh -File scripts\coord\containers.ps1 stop   [-Names ...] [-Force]
#   pwsh -File scripts\coord\containers.ps1 pause  [-Reason "..."] [-TimeoutMin 90] [-NoStop]
#   pwsh -File scripts\coord\containers.ps1 resume
#
# pause: sets the global coord pause (no new claims or leases), waits until every lane has
# released its container lease (running container jobs finish first), then stops the
# containers that were running and remembers them. resume: starts exactly those again,
# waits for the BC login page, then clears the pause. The orchestrator wakes the lanes.
#
# `stop` refuses a container that a harness lane currently leases in the coord root,
# unless -Force.
param(
  [Parameter(Mandatory, Position = 0)][ValidateSet('status', 'start', 'stop', 'pause', 'resume')][string]$Action,
  [string[]]$Names = @('Cronus28', 'Cronus281', 'Cronus282', 'Cronus283', 'Cronus284', 'Cronus285'),
  [switch]$Web,
  [switch]$Force,
  [string]$Reason = 'owner needs the machine',
  [int]$TimeoutMin = 90,
  [switch]$NoStop,
  [string]$CoordRoot = $(if ($env:CG_COORD_ROOT) { $env:CG_COORD_ROOT } else { 'H:\cg-coord' })
)
$ErrorActionPreference = 'Stop'
# BC containers exist only under Docker Desktop's Windows context (CLAUDE.md).
$env:DOCKER_CONTEXT = 'desktop-windows'
$coord = Join-Path $PSScriptRoot 'coord.ts'

function Get-State([string]$name) {
  $s = docker inspect -f '{{.State.Status}}' $name 2>$null
  if ($LASTEXITCODE -ne 0) { return 'missing' }
  return $s.Trim()
}

function Get-Holder([string]$name) {
  if (-not (Test-Path (Join-Path $CoordRoot 'coord.json'))) { return $null }
  $env:CG_COORD_ROOT = $CoordRoot
  $out = & deno run --allow-all $coord holder $name 2>$null
  if ($LASTEXITCODE -ne 0) { return 'unknown' }
  $h = ($out | Out-String | ConvertFrom-Json)
  if ($h) { return $h.lane } else { return $null }
}

function Invoke-Coord([string[]]$argv) {
  $env:CG_COORD_ROOT = $CoordRoot
  $out = & deno run --allow-all $coord @argv 2>&1
  if ($LASTEXITCODE -ne 0) { throw "coord $($argv -join ' ') failed: $out" }
  return ($out | Out-String)
}

function Test-Web([string]$name) {
  try {
    $r = Invoke-WebRequest -Uri "http://$name/BC/?tenant=default" -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 5
    return "http $($r.StatusCode)"
  } catch {
    return 'no response'
  }
}

switch ($Action) {
  'status' {
    foreach ($n in $Names) {
      $row = [ordered]@{ Container = $n; State = (Get-State $n); LeasedBy = (Get-Holder $n) }
      if ($Web -and $row.State -eq 'running') { $row.Web = Test-Web $n }
      [pscustomobject]$row
    }
  }
  'start' {
    foreach ($n in $Names) {
      $state = Get-State $n
      if ($state -eq 'running') { Write-Host "[OK] $n already running"; continue }
      if ($state -eq 'missing') { Write-Host "[FAIL] $n does not exist under context desktop-windows"; continue }
      docker start $n | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Host "[OK] $n started (BC service tier may need a minute; check with: status -Web)" }
      else { Write-Host "[FAIL] $n did not start" }
    }
  }
  'stop' {
    foreach ($n in $Names) {
      $state = Get-State $n
      if ($state -ne 'running') { Write-Host "[OK] $n not running ($state)"; continue }
      $holder = Get-Holder $n
      if ($holder -and -not $Force) {
        Write-Host "[SKIP] $n is leased by lane '$holder'; stopping it would break that job. Use -Force to stop anyway."
        continue
      }
      docker stop $n | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Host "[OK] $n stopped" } else { Write-Host "[FAIL] $n did not stop" }
    }
  }
  'pause' {
    $state = Invoke-Coord @('pause-state') | ConvertFrom-Json
    if (-not $state.paused) { Invoke-Coord @('pause', $Reason) | Out-Null; Write-Host "[OK] pause set: $Reason" }
    else { Write-Host "[OK] already paused since $($state.since): $($state.reason)" }
    $deadline = (Get-Date).AddMinutes($TimeoutMin)
    while ($true) {
      $state = Invoke-Coord @('pause-state') | ConvertFrom-Json
      if ($state.drained) { break }
      $held = ($state.leases | ForEach-Object { "$($_.container) ($($_.lane))" }) -join ', '
      if ((Get-Date) -gt $deadline) {
        Write-Host "[FAIL] not drained after $TimeoutMin min; still leased: $held. Containers left running. Ask the orchestrator what is holding them."
        exit 1
      }
      Write-Host "$(Get-Date -Format HH:mm:ss) waiting for leases to be released: $held"
      Start-Sleep -Seconds 30
    }
    Write-Host '[OK] drained: no container leases held'
    if ($NoStop) { Write-Host '[OK] -NoStop: containers left running'; exit 0 }
    $remember = Join-Path $CoordRoot 'paused-containers.txt'
    $stopped = @()
    foreach ($n in $Names) {
      if ((Get-State $n) -eq 'running') { docker stop $n | Out-Null; $stopped += $n; Write-Host "[OK] $n stopped" }
    }
    $orphans = docker ps --filter 'name=cg-harness-' --format '{{.Names}}'
    foreach ($o in $orphans) { docker stop $o | Out-Null; Write-Host "[OK] sandbox $o stopped (no lease held, so it was an orphan)" }
    Set-Content $remember ($stopped -join "`n")
    Write-Host "[OK] paused. Resume with: containers.ps1 resume"
  }
  'resume' {
    $remember = Join-Path $CoordRoot 'paused-containers.txt'
    $toStart = if (Test-Path $remember) { @(Get-Content $remember | Where-Object { $_ }) } else { @() }
    foreach ($n in $toStart) { docker start $n | Out-Null; Write-Host "[OK] $n started" }
    foreach ($n in $toStart) {
      $until = (Get-Date).AddMinutes(10)
      while ((Test-Web $n) -notlike 'http 2*' -and (Get-Date) -lt $until) { Start-Sleep -Seconds 15 }
      $w = Test-Web $n
      if ($w -like 'http 2*') { Write-Host "[OK] $n web $w" } else { Write-Host "[WARN] $n web not answering yet ($w); lanes check before leasing" }
    }
    if (Test-Path $remember) { Move-Item $remember (Join-Path $CoordRoot "paused-containers-$(Get-Date -Format yyyyMMddTHHmmss).txt") }
    Invoke-Coord @('resume') | Out-Null
    Write-Host '[OK] pause cleared. The orchestrator messages the lanes on its next sweep; tell it "resume" to do it now.'
  }
}
