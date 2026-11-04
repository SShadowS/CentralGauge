# H-35c (design-r5 2.5): the agent sandbox identity's access probe. Runs
# inside the sandbox image with its normal mounts, as the sandbox user.
# 1. Lists every file named like this run's canary on every file-system drive
#    it can see: one "HIT <path>" line each.
# 2. Sol r1 #6: tries every known canary path (-Known, one per line) by name,
#    so a folder that refuses listing but serves a known name still counts:
#    one "OPEN <path>" line per canary it can read.
# Then "ERR <n>" (listing errors, for the record) and "DONE <files seen>".
# Read-only: it lists names and reads only the canaries.
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Known = ''
)
$name = "cg-canary-$Token.txt"
$seen = 0
$errs = @()
foreach ($d in Get-PSDrive -PSProvider FileSystem) {
  Get-ChildItem -LiteralPath $d.Root -Recurse -Force -File -ErrorAction SilentlyContinue -ErrorVariable +errs |
    ForEach-Object {
      $seen++
      if ($_.Name -ieq $name) { Write-Output "HIT $($_.FullName)" }
    }
}
if ($Known -and (Test-Path -LiteralPath $Known)) {
  foreach ($p in Get-Content -LiteralPath $Known) {
    if (-not $p) { continue }
    try {
      $null = [System.IO.File]::ReadAllText($p)
      Write-Output "OPEN $p"
    } catch { }
  }
}
Write-Output "ERR $($errs.Count)"
Write-Output "DONE $seen"
