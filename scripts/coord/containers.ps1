# BC container control for the owner. Agents must NOT run start or stop (launch contract);
# they may run `status`.
#
#   pwsh -File scripts\coord\containers.ps1 status [-Web]
#   pwsh -File scripts\coord\containers.ps1 start  [-Names Cronus281,Cronus282]
#   pwsh -File scripts\coord\containers.ps1 stop   [-Names ...] [-Force]
#
# `stop` refuses a container that a harness lane currently leases in the coord root,
# unless -Force.
param(
  [Parameter(Mandatory, Position = 0)][ValidateSet('status', 'start', 'stop')][string]$Action,
  [string[]]$Names = @('Cronus28', 'Cronus281', 'Cronus282', 'Cronus283', 'Cronus284', 'Cronus285'),
  [switch]$Web,
  [switch]$Force,
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
}
