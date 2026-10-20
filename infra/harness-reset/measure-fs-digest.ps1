param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$Out,
  [string]$Label = ''
)
# H-35 S3 L4 measurement (lane-ops, leased container only): the NST identity, per-root sizes, one fsDigest and its cost,
# written as JSON to $Out. Diffing captures around a deployment / idle wait names the volatile files.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')
. (Join-Path $PSScriptRoot 'fs-digest.ps1')

$roots = @(Get-FsDigestCandidateRoots $Container)
$facts = @(Get-FsDigestFacts $Container $roots)
$sw = [Diagnostics.Stopwatch]::StartNew()
$lines = @(Get-FsDigest $Container $roots)
$ms = $sw.ElapsedMilliseconds
[pscustomobject]@{
  container = $Container; label = $Label; at = (Get-Date).ToUniversalTime().ToString('o')
  digest_version = $FsDigestVersion; roots = $roots; facts = $facts; digest_ms = $ms; file_count = $lines.Count; lines = $lines
} | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $Out
Write-Output "FS_DIGEST files=$($lines.Count) ms=$ms errors=$(@($lines | Where-Object { $_ -like 'E|*' }).Count) -> $Out"
