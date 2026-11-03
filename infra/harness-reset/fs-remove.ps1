param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$Lineage,
  [Parameter(Mandatory)][string]$Items
)
# H-35c: recover's remediation (src/harness/reset.ts goldenReset.fsRemove). Removes, in the given order, entries a
# quarantine record shows a deployment CREATED: $Items is a JSON array of {path, kind: "F"|"D"} (the harness orders
# it deepest first, files before directories). Inside the container, per item:
#   - the path must lie under one of the lineage's fs.roots;
#   - absent: nothing to do (REMOVED, it is gone);
#   - a reparse point, or the wrong kind: REFUSED;
#   - F: a plain file, removed;  D: an EMPTY directory, removed (never recursive: a non-empty one is REFUSED).
# stdout: REMOVED|<path> or REFUSED|<path>|<why> per item; exit 1 on any refusal or failure (fails closed).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
try {
  Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
  $bchVersion = "$((Get-Command Invoke-ScriptInBcContainer -ErrorAction SilentlyContinue).Module.Version)"
  if ($bchVersion -ne '6.1.14') { throw "bccontainerhelper resolved to '$bchVersion', pinned 6.1.14" }
  $lin = Get-Content -Raw $Lineage | ConvertFrom-Json
  if (-not $lin.fs) { throw 'the lineage has no fs section' }
  $list = @(Get-Content -Raw $Items | ConvertFrom-Json)
  $out = Invoke-ScriptInBcContainer -containerName $Container -argumentList @(, $list), @($lin.fs.roots) -scriptblock {
    param($list, $roots)
    $norm = { param($p) ($p -replace '/', '\').TrimEnd('\').ToLowerInvariant() }
    foreach ($i in $list) {
      $p = [string]$i.path
      $np = & $norm $p
      if (-not ($roots | Where-Object { $r = & $norm $_; $np.StartsWith("$r\") })) { "REFUSED|$p|outside the lineage roots"; continue }
      $item = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
      if (-not $item) { "REMOVED|$p"; continue }
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { "REFUSED|$p|reparse point"; continue }
      if ($i.kind -eq 'F') {
        if ($item.PSIsContainer) { "REFUSED|$p|a directory, recorded as a file"; continue }
        try { Remove-Item -LiteralPath $p -Force; "REMOVED|$p" } catch { "REFUSED|$p|$(($_.Exception.Message -replace '[\r\n|]+', ' ').Trim())" }
      } elseif ($i.kind -eq 'D') {
        if (-not $item.PSIsContainer) { "REFUSED|$p|a file, recorded as a directory"; continue }
        if (@(Get-ChildItem -LiteralPath $p -Force).Count -gt 0) { "REFUSED|$p|not empty"; continue }
        try { Remove-Item -LiteralPath $p -Force; "REMOVED|$p" } catch { "REFUSED|$p|$(($_.Exception.Message -replace '[\r\n|]+', ' ').Trim())" }
      } else { "REFUSED|$p|unknown kind $($i.kind)" }
    }
  }
  $out
  if ($out | Where-Object { "$_" -like 'REFUSED|*' }) { exit 1 }
} catch {
  Write-Output "REFUSED|(fs-remove)|$((($_.Exception.Message -replace '[\r\n|]+', ' ').Trim()))"
  exit 1
}
exit 0
