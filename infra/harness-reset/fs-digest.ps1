# H-35 S3 L4 (design-r5 2.4): fsDigest over the roots of W inside the container. Dot-sourced after reset-lib.ps1.
# One line per file, sorted ordinal: "<sha256>|<size>|<full path>"; an unreadable file is "error|<size>|<path>|<reason>"
# (never skipped: a locked file the agent wrote must still show as a difference).

# W roots (proposal, pending a ruling): the NST service profile, the NST server folder (logs, caches, Apps, Temp),
# the BCH shared folder. The SQL data folder is the DB reset's (content root), not L4's.
$FsDigestRoots = @(
  'C:\Windows\Temp',
  'C:\Windows\System32\config\systemprofile\AppData',
  'C:\ProgramData\Microsoft\Microsoft Dynamics NAV',
  'C:\Program Files\Microsoft Dynamics NAV',
  'C:\Run\my'
)

function Get-FsDigest([string]$Container, [string[]]$Roots = $FsDigestRoots) {
  Invoke-InContainer $Container { param($roots)
    foreach ($r in $roots) {
      if (-not (Test-Path -LiteralPath $r)) { "missing|0|$r"; continue }
      Get-ChildItem -LiteralPath $r -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
        try { "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())|$($_.Length)|$($_.FullName)" }
        catch { "error|$($_.Length)|$($_.FullName)|$(($_.Exception.Message -replace '[\r\n|]+', ' ').Trim())" }
      }
    }
  } (, $Roots) | Sort-Object { ($_ -split '\|')[2] } -CaseSensitive
}

# The NST service identity and every root's file count and bytes (measurement only).
function Get-FsDigestFacts([string]$Container, [string[]]$Roots = $FsDigestRoots) {
  Invoke-InContainer $Container { param($roots)
    $svc = Get-CimInstance Win32_Service -Filter "Name='MicrosoftDynamicsNavServer`$BC'"
    "service_account|$($svc.StartName)"
    foreach ($r in $roots) {
      $f = @(Get-ChildItem -LiteralPath $r -Recurse -Force -File -ErrorAction SilentlyContinue)
      "root|$r|files=$($f.Count)|bytes=$(($f | Measure-Object Length -Sum).Sum)"
    }
  } (, $Roots)
}
