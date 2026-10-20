param(
  [Parameter(Mandatory)][string]$Container,
  # The lineage whose nst_config section to read; prints `NST_CONFIG <sha256>` (exit 0) or `NST_CONFIG_FAILED <reason>`.
  [string]$Lineage,
  # lane-ops, building a lineage: print the nst_config section as JSON instead (the default path and exclude list).
  [switch]$New
)
# H-35 run 004 #4 (r5 3, nst_config): the live NST config digest (reset-lib.ps1 Get-NstConfigDigest), read-only.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
# The keys that carry the container's hostname (measured on Cronus281/282/283/285: the only differences between
# them, tasks\H-35\ops\nstconfig). Every other key is behaviour and enters the digest.
$NstConfigHostKeys = @('PublicODataBaseUrl', 'PublicSOAPBaseUrl', 'PublicWebBaseUrl', 'PublicWinBaseUrl')
$NstConfigPath = 'C:\Program Files\Microsoft Dynamics NAV\280\Service\CustomSettings.config'
try {
  Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
  . (Join-Path $PSScriptRoot 'reset-lib.ps1')
  $bchVersion = "$((Get-Command Invoke-ScriptInBcContainer -ErrorAction SilentlyContinue).Module.Version)"
  if ($bchVersion -ne '6.1.14') { throw "bccontainerhelper resolved to '$bchVersion', pinned 6.1.14" }
  if ($New) {
    $d = (Get-NstConfigDigest $Container $NstConfigPath $NstConfigHostKeys) -split '\|'
    [ordered]@{ digest_version = 1; path = $NstConfigPath; exclude_keys = $NstConfigHostKeys; sha256 = $d[0]; keys = [int]$d[1] } |
      ConvertTo-Json -Depth 3
    exit 0
  }
  if (-not $Lineage) { throw 'pass -Lineage or -New' }
  $n = (Get-Content -Raw $Lineage | ConvertFrom-Json).nst_config
  if (-not $n) { throw 'the lineage has no nst_config section' }
  if ([int]$n.digest_version -ne 1) { throw "nst_config.digest_version $($n.digest_version), this script is 1" }
  $sha = ((Get-NstConfigDigest $Container $n.path @($n.exclude_keys)) -split '\|')[0]
  Write-Output "NST_CONFIG $sha"
} catch {
  Write-Output "NST_CONFIG_FAILED $((($_.Exception.Message -replace '[\r\n]+', ' ').Trim()))"
  exit 1
}
exit 0
