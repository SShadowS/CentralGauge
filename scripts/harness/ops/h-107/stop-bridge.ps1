# H-107 low-churn port of stop-bridge.sh (v2 semantics): one pwsh process, no children.
# Hostwatch writes <P>\STOP.host-low / STOP.host-all; harness qualify reads only <P>\STOP. This bridge writes <P>\STOP
# when a STOP.host-* appears, or when the hostwatch heartbeat is older than 180 s (fail-safe). It never reads memory
# itself: hostwatch alone decides which target stops, by priority.
# Exits by itself: when -RunLog has an "EXIT " line, when <P>\STOP-bridge exists, or after -MaxHours (default 96).
# Registers in H:\cg-coord\daemons.tsv (unless -NoRegister) and unregisters on exit. Log: <P>\stop-bridge.log.
# Start (no window; pwsh -WindowStyle Hidden still flashes a console):
#   Start-Process conhost.exe -ArgumentList '--headless','"C:\Program Files\PowerShell\7\pwsh.exe"','-NoProfile','-File',
#     'H:\cg-coord\tasks\H-102\stop-bridge.ps1','-Private','<dir>','-RunLog','<qualify log>'
param([Parameter(Mandatory)][string]$Private, [string]$RunLog, [int]$EverySeconds = 15, [double]$MaxHours = 96,
  [string]$Heartbeat = 'H:\cg-coord\jobs\W2-10\hostwatch\heartbeat', [int]$StaleS = 180, [switch]$NoRegister)
$log = Join-Path $Private 'stop-bridge.log'
function Say([string]$s) { Add-Content -LiteralPath $log -Value ("[bridge] {0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $s) }
function Stop-Run([string]$why) {
  $f = Join-Path $Private 'STOP'
  if (-not (Test-Path -LiteralPath $f)) { New-Item -ItemType File -Path $f | Out-Null; Say "STOP written: $why" }
}
if (-not $NoRegister) {
  Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1'
  Register-Daemon -ProcessId $PID -Script $PSCommandPath -Owner ops -Purpose "graceful-stop bridge for $Private" `
    -MaxHours "$MaxHours" -StopFile (Join-Path $Private 'STOP-bridge')
}
$sw = [Diagnostics.Stopwatch]::StartNew(); $why = $null
Say "started (pid $PID) for $Private$(if ($RunLog) { ", run log $RunLog" })"
try {
  while ($true) {
    if (Test-Path -LiteralPath (Join-Path $Private 'STOP-bridge')) { $why = 'STOP-bridge'; break }
    if ($sw.Elapsed.TotalHours -ge $MaxHours) { $why = "max lifetime $MaxHours h"; break }
    if ($RunLog -and (Test-Path -LiteralPath $RunLog) -and (Select-String -LiteralPath $RunLog -Pattern '^EXIT ' -Quiet)) { $why = "$RunLog logged EXIT"; break }
    foreach ($f in Get-ChildItem -LiteralPath $Private -Filter 'STOP.host-*' -File -ErrorAction SilentlyContinue) { Stop-Run "hostwatch $($f.Name)" }
    $hb = Get-Item -LiteralPath $Heartbeat -ErrorAction SilentlyContinue
    $age = if ($hb) { ((Get-Date) - $hb.LastWriteTime).TotalSeconds } else { [double]::MaxValue }
    if ($age -gt $StaleS) { Stop-Run "hostwatch heartbeat $(if ($hb) { "$([int]$age)s old" } else { 'missing' })" }
    Start-Sleep -Seconds $EverySeconds
  }
} finally {
  Say "exiting: $(if ($why) { $why } else { 'error or signal' })"
  if (-not $NoRegister) { Unregister-Daemon -ProcessId $PID -StartUtc (Get-ProcStartUtc $PID) }
}
