# H-107 low-churn port of running-checkpoint-loop.sh: one pwsh process. Every -EverySeconds (1800) it posts
# `coord checkpoint <id> <run> <token> <phase> --note "<label> <n>/<total> cells (campaign <8>); host <reading>"` for
# each row of <Dir>\running.tsv (id, run, token, phase, campaign, total cells, label; tab separated). A token of
# TOKEN-FROM-CLAIM is read from <ClaimRoot>\<id>\claim-out.json. <n> is the number of entries in <Exec>\<campaign>.
# The host reading is the text after the timestamp on the last `verdict=` line of hostwatch.log. Tokens are never
# printed or logged. One deno process per checkpoint, no git-bash.
# Exits by itself (logged to <Dir>\running-checkpoint.log): when running.tsv has no row (its runs are done), when
# <Dir>\STOP-running-ckpt exists, or after -MaxHours (0 = none). Registers itself in H:\cg-coord\daemons.tsv at start
# and unregisters on every exit. Start detached with no window:
#   Start-Process conhost.exe -ArgumentList '--headless','"C:\Program Files\PowerShell\7\pwsh.exe"','-NoProfile','-File','H:\cg-coord\jobs\W2-10\running-checkpoint.ps1'
# Test hooks: -Dir, -Coord (a stand-in command script), -Exec, -ClaimRoot, -HostLog, -EverySeconds, -NoRegister.
param([string]$Dir = 'H:\cg-coord\jobs\W2-10', [int]$EverySeconds = 1800, [double]$MaxHours = 0,
  [string]$Coord = 'H:\cg-coord\jobs\orch-master\scripts\coord\coord.ts',
  [string]$Exec = 'H:\cg-coord\jobs\M8-16a\results\harness\executions', [string]$ClaimRoot = 'H:\cg-coord\tasks',
  [string]$HostLog = 'H:\cg-coord\jobs\W2-10\hostwatch\hostwatch.log', [switch]$NoRegister)
$ErrorActionPreference = 'Continue'
$log = Join-Path $Dir 'running-checkpoint.log'; $stop = Join-Path $Dir 'STOP-running-ckpt'; $tsv = Join-Path $Dir 'running.tsv'
function Say([string]$s) { Add-Content -LiteralPath $log -Value ("[rc] {0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $s) }
function ReadShared([string]$p) { # the writer holds the file open
  try { $fs = [IO.File]::Open($p, 'Open', 'Read', 'ReadWrite'); try { (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() } } catch { '' }
}
$deno = 'C:\Users\SShadowS\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.EXE'
$env:CG_COORD_ROOT = 'H:\cg-coord'
if (-not $NoRegister) {
  Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1'
  Register-Daemon -ProcessId $PID -Script $PSCommandPath -Owner ops -Purpose 'coord checkpoint of running.tsv runs every 30 min (running-checkpoint.ps1)' `
    -MaxHours $(if ($MaxHours -gt 0) { "$MaxHours" } else { 'none' }) -StopFile $stop
}
$sw = [Diagnostics.Stopwatch]::StartNew(); $why = $null
Say "started (pid $PID)"
try {
  while (-not $why) {
    if (Test-Path -LiteralPath $stop) { $why = 'STOP-running-ckpt'; break }
    if ($MaxHours -gt 0 -and $sw.Elapsed.TotalHours -ge $MaxHours) { $why = "max lifetime $MaxHours h"; break }
    $rows = @((ReadShared $tsv) -split "\r?\n" | Where-Object { $_ -match '\S' -and ($_ -split "`t")[0] })
    if (-not $rows) { $why = 'running.tsv has no run'; break }
    $last = @((ReadShared $HostLog) -split "\r?\n" | Where-Object { $_ -match 'verdict=' })[-1]
    $mem = if ($last) { ($last -split ' ', 2)[1] } else { '' }
    foreach ($r in $rows) {
      $id, $run, $tok, $phase, $camp, $total, $label = $r -split "`t"
      if ($tok -eq 'TOKEN-FROM-CLAIM') { try { $tok = (Get-Content -LiteralPath (Join-Path $ClaimRoot "$id\claim-out.json") -Raw | ConvertFrom-Json).token } catch { $tok = $null } }
      if (-not $tok) { Say "checkpoint failed: $id (no token)"; continue }
      $cd = Join-Path $Exec $camp
      $n = if ($camp -and (Test-Path -LiteralPath $cd)) { @(Get-ChildItem -LiteralPath $cd -Force).Count } else { 0 }
      $short = if ($camp.Length -gt 8) { $camp.Substring(0, 8) } else { $camp }
      & $deno run --allow-all $Coord checkpoint $id $run $tok $phase --note "$label $n/$total cells (campaign $short); host $mem" *> $null
      if ($LASTEXITCODE -ne 0) { Say "checkpoint failed: $id (rc $LASTEXITCODE)" }
    }
    # Sleep in 5 s steps so the stop file is seen quickly.
    $until = $sw.Elapsed.TotalSeconds + $EverySeconds
    while ($sw.Elapsed.TotalSeconds -lt $until -and -not (Test-Path -LiteralPath $stop)) { Start-Sleep -Seconds 5 }
  }
} finally {
  Say "exiting: $(if ($why) { $why } else { 'error or signal' })"
  if (-not $NoRegister) { Unregister-Daemon -ProcessId $PID -StartUtc (Get-ProcStartUtc $PID) }
}
