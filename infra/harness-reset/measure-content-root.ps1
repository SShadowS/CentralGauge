param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$Out,
  [string]$Label = ''
)
# H-35 S3 measurement (lane-ops, leased container only): per-table content hashes + cost, written as JSON to $Out.
# Diffing two captures (after two restores, and after an idle wait) names the volatile tables the lineage must exclude.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')
. (Join-Path $PSScriptRoot 'content-root.ps1')

$sw = [Diagnostics.Stopwatch]::StartNew()
$tables = @(Get-GoldenContentTables $Container)
$total = $sw.ElapsedMilliseconds
$root = try { Get-GoldenContentRoot $tables } catch { "error: $($_.Exception.Message)" }
[pscustomobject]@{
  container = $Container; label = $Label; at = (Get-Date).ToUniversalTime().ToString('o')
  total_ms = $total; table_count = $tables.Count; root_unexcluded = $root; tables = $tables
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $Out
Write-Output "CONTENT_ROOT $root tables=$($tables.Count) ms=$total -> $Out"
