# H-107 low-churn port of heartbeat.sh: one pwsh process. Every -EverySeconds (120) it runs
# `coord heartbeat Cronus<n> <token>` (one deno process, no git-bash) for each held lease, i.e. each non-empty
# <Dir>\lease-<n>.json for n in -Numbers (281 282 283). The token is read with ConvertFrom-Json, never printed.
# Exits by itself (logged to <Dir>\heartbeat.log): when no lease file is left (as before), when <Dir>\STOP-heartbeat
# exists, or after -MaxHours (0 = none). It registers itself in H:\cg-coord\daemons.tsv at start and unregisters on
# every exit. Start detached with no window (pwsh -WindowStyle Hidden still flashes a console):
#   Start-Process conhost.exe -ArgumentList '--headless','"C:\Program Files\PowerShell\7\pwsh.exe"','-NoProfile','-File','H:\cg-coord\jobs\W2-10\heartbeat.ps1'
# Test hooks: -Dir, -Coord (a stand-in command script), -EverySeconds, -NoRegister.
param([string]$Dir = 'H:\cg-coord\jobs\W2-10', [string]$Numbers = '281,282,283', [int]$EverySeconds = 120,
  [double]$MaxHours = 0, [string]$Coord = 'H:\cg-coord\jobs\orch-master\scripts\coord\coord.ts', [switch]$NoRegister)
$ErrorActionPreference = 'Continue'
$log = Join-Path $Dir 'heartbeat.log'
function Say([string]$s) { Add-Content -LiteralPath $log -Value ("[hb] {0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $s) }
$deno = 'C:\Users\SShadowS\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.EXE'
$env:CG_COORD_ROOT = 'H:\cg-coord'
if (-not $NoRegister) {
  Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1'
  Register-Daemon -ProcessId $PID -Script $PSCommandPath -Owner ops -Purpose 'coord lease heartbeat every 2 min per held lease (heartbeat.ps1)' `
    -MaxHours $(if ($MaxHours -gt 0) { "$MaxHours" } else { 'none' }) -StopFile (Join-Path $Dir 'STOP-heartbeat')
}
$sw = [Diagnostics.Stopwatch]::StartNew()
$why = $null
Say "started (pid $PID)"
try {
  while (-not $why) {
    if (Test-Path -LiteralPath (Join-Path $Dir 'STOP-heartbeat')) { $why = 'STOP-heartbeat'; break }
    if ($MaxHours -gt 0 -and $sw.Elapsed.TotalHours -ge $MaxHours) { $why = "max lifetime $MaxHours h"; break }
    $held = 0
    foreach ($n in ($Numbers -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
      $f = Join-Path $Dir "lease-$n.json"
      if (-not (Test-Path -LiteralPath $f) -or (Get-Item -LiteralPath $f).Length -eq 0) { continue }
      $held++
      try { $tok = (Get-Content -LiteralPath $f -Raw | ConvertFrom-Json).token } catch { $tok = $null }
      if (-not $tok) { Say "Cronus$n lease file unreadable"; continue }
      & $deno run --allow-all $Coord heartbeat "Cronus$n" $tok *> $null
      if ($LASTEXITCODE -ne 0) { Say "Cronus$n heartbeat failed (rc $LASTEXITCODE)" }
    }
    if ($held -eq 0) { $why = 'no lease file left'; break }
    # Sleep in 5 s steps so the stop file is seen quickly.
    $until = $sw.Elapsed.TotalSeconds + $EverySeconds
    while ($sw.Elapsed.TotalSeconds -lt $until -and -not (Test-Path -LiteralPath (Join-Path $Dir 'STOP-heartbeat'))) { Start-Sleep -Seconds 5 }
  }
} finally {
  Say "exiting: $(if ($why) { $why } else { 'error or signal' })"
  if (-not $NoRegister) { Unregister-Daemon -ProcessId $PID -StartUtc (Get-ProcStartUtc $PID) }
}
