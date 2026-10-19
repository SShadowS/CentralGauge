param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$Lineage
)
# H-35 S3 post-cleanup inventory check (design-r4 2): after a judge deployment's cleanup, the app inventory at both
# scopes (Get-GoldenInventory) must equal the lineage's stored inventory. Protocol (src/harness/reset.ts
# parseVerifyOutput): one `VERIFY_DIFF <+|-> <line>` per difference (+ present now, - missing now), then exactly one
# `VERIFY_OK` (exit 0), `VERIFY_DIRTY <n>` or `VERIFY_FAILED <reason>` (exit 1). Other stdout is ignored.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')

try {
  $bchVersion = "$((Get-Command Invoke-ScriptInBcContainer -ErrorAction SilentlyContinue).Module.Version)"
  if ($bchVersion -ne '6.1.14') { throw "bccontainerhelper resolved to '$bchVersion', pinned 6.1.14" }
  $lin = Get-Content -Raw $Lineage | ConvertFrom-Json
  $invFile = Join-Path (Split-Path -Parent $Lineage) $lin.inventory.path
  if ((Get-FileHash $invFile -Algorithm SHA256).Hash.ToLower() -ne $lin.inventory.sha256) { throw "stored inventory sha mismatch ($invFile)" }
  $stored = @(Get-Content $invFile)
  $now = @(Get-GoldenInventory $Container)
  if ($now.Count -eq 0) { throw 'empty live inventory' }
  $d = @(Compare-Object $stored $now -CaseSensitive)
} catch {
  Write-Output "VERIFY_FAILED $((($_.Exception.Message -replace '[\r\n]+', ' ').Trim()))"
  exit 1
}
foreach ($x in $d) { Write-Output "VERIFY_DIFF $(if ($x.SideIndicator -eq '=>') { '+' } else { '-' }) $($x.InputObject)" }
if ($d.Count -gt 0) { Write-Output "VERIFY_DIRTY $($d.Count)"; exit 1 }
Write-Output 'VERIFY_OK'
exit 0
