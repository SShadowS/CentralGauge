param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$Lineage
)
# H-35 S3 L4: one fsDigest(W) capture over the lineage's fs.roots (src/harness/reset.ts goldenReset.fsDigest).
# stdout = the digest lines (fs-digest.ps1 format), then `T|<their count>`; any failure prints an E| line and
# exits 1 (fails closed). The walk runs with the NST suspended (fs-digest.ps1 Invoke-FsCaptureCore).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
try {
  Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
  . (Join-Path $PSScriptRoot 'reset-lib.ps1')
  . (Join-Path $PSScriptRoot 'fs-digest.ps1')
  $bchVersion = "$((Get-Command Invoke-ScriptInBcContainer -ErrorAction SilentlyContinue).Module.Version)"
  if ($bchVersion -ne '6.1.14') { throw "bccontainerhelper resolved to '$bchVersion', pinned 6.1.14" }
  $lin = Get-Content -Raw $Lineage | ConvertFrom-Json
  if (-not $lin.fs) { throw 'the lineage has no fs section' }
  if ([int]$lin.fs.digest_version -ne $FsDigestVersion) {
    throw "lineage fs.digest_version $($lin.fs.digest_version), fs-digest.ps1 is $FsDigestVersion"
  }
  $out = @(Invoke-FsCaptureCore $Container @($lin.fs.roots))
  $out
  if ($out | Where-Object { $_ -like 'E|(fs-capture)|*' }) { exit 1 }
} catch {
  Write-Output "E|(fs-capture)|$((($_.Exception.Message -replace '[\r\n|]+', ' ').Trim()))"
  exit 1
}
exit 0
