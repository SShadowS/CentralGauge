# H-35c (design-r5 2.5): the agent sandbox identity's access probe. Runs
# inside the sandbox image with its normal mounts, as the sandbox user.
# Lists every file named like this run's canary on every file-system drive
# it can see; prints one "HIT <path>" line each, then "DONE <files seen>".
# Read-only: it lists names, it opens nothing.
param([Parameter(Mandatory = $true)][string]$Token)
$ErrorActionPreference = 'SilentlyContinue'
$name = "cg-canary-$Token.txt"
$seen = 0
foreach ($d in Get-PSDrive -PSProvider FileSystem) {
  Get-ChildItem -LiteralPath $d.Root -Recurse -Force -File -ErrorAction SilentlyContinue |
    ForEach-Object {
      $seen++
      if ($_.Name -ieq $name) { Write-Output "HIT $($_.FullName)" }
    }
}
Write-Output "DONE $seen"
