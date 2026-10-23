param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$OutDir,
  [Parameter(Mandatory)][string]$Name
)
# H-35 S3 (lane-ops, building a lineage, on a container right after a verified reset to its golden): write the
# content-root sidecar <OutDir>\<Name>.content.txt (sorted "table|hash" lines, exclusions removed) and print the
# lineage's `content_root` section as JSON. The exclusions are content-root.ps1's measured $ContentRootExclusions.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')
. (Join-Path $PSScriptRoot 'content-root.ps1')

$exclude = @($ContentRootExclusions | ForEach-Object { $_.pattern })
$tables = @(Get-GoldenContentTables $Container)
$root = Get-GoldenContentRoot $tables $exclude
$lines = Sort-Ordinal @($tables | Where-Object { $t = $_.t; -not ($exclude | Where-Object { $t -like $_ }) } |
    ForEach-Object { "$($_.t)|$($_.h)" })
$file = Join-Path $OutDir "$Name.content.txt"
# LF endings, no BOM: the harness hashes the bytes.
[IO.File]::WriteAllText($file, (($lines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
[ordered]@{
  path    = "$Name.content.txt"
  sha256  = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  root    = $root
  exclude = @($ContentRootExclusions | ForEach-Object { [ordered]@{ pattern = $_.pattern; reason = $_.reason } })
} | ConvertTo-Json -Depth 4
