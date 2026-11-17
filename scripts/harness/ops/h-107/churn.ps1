# H-107 churn measurement (read-only): over -Seconds, counts distinct bash/sh/sleep processes seen (polled every
# -PollMs; processes shorter than the poll interval can be missed, so this is a lower bound), and the Toke pool tag
# growth (outstanding paged allocations) from pooltags2.ps1. One pwsh process, no children per poll.
param([int]$Seconds = 300, [int]$PollMs = 200, [string]$Label = "sample")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Toke { (& "$here\pooltags2.ps1" | Where-Object Tag -eq "Toke") }
$names = @("bash", "sh", "sleep")
$seen = @{}
$t0 = Toke
$start = Get-Date
$end = $start.AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  foreach ($p in Get-Process -Name $names -ErrorAction SilentlyContinue) {
    try { $k = "$($p.Id)|$($p.StartTime.ToFileTimeUtc())" } catch { $k = "$($p.Id)|?" }
    if (-not $seen.ContainsKey($k)) { $seen[$k] = $p.ProcessName }
  }
  Start-Sleep -Milliseconds $PollMs
}
$t1 = Toke
$mins = ((Get-Date) - $start).TotalMinutes
$byName = $seen.Values | Group-Object | ForEach-Object { "$($_.Name)=$($_.Count)" }
[pscustomobject]@{
  label            = $Label
  start_utc        = $start.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  minutes          = [Math]::Round($mins, 2)
  distinct_seen    = $seen.Count
  by_name          = ($byName -join " ")
  per_min          = [Math]::Round($seen.Count / $mins, 1)
  toke_pout_start  = $t0.POut
  toke_pout_end    = $t1.POut
  toke_per_min     = [Math]::Round(($t1.POut - $t0.POut) / $mins, 1)
  toke_pmb_end     = $t1.PMB
} | ConvertTo-Json -Compress
