# H-107 low-churn port of watch-qualify-n.sh: one pwsh process, no children per poll. Prints events on stdout (for a
# Monitor): new log lines that matter (START, unexpected verdicts, [FAIL], EXIT, STOP, error, quarantine, ...), a
# progress line every -ProgressS, and LOW RAM when the newest memlog sample is under -LowMb.
# Expected judge-fixture verdicts (naive fail, positive pass) are counted, not printed. Never prints coord-lease or
# "Task start" lines. Exits by itself: when the log has an "EXIT " line, after -MaxS (default 1740, under the 30-min
# Monitor limit), or when <log>.STOP-watch exists. A truncated log (a relaunch) restarts the count.
# usage: pwsh -NoProfile -File watch-qualify.ps1 -Log <qualify log> -Total <variants> [-IntervalS 10] [-LowMb 8000]
param([Parameter(Mandatory)][string]$Log, [Parameter(Mandatory)][int]$Total, [int]$IntervalS = 10, [int]$MaxS = 1740,
  [int]$ProgressS = 1200, [int]$LowMb = 8000, [string]$MemDir = 'H:\cg-coord\jobs\W2-10\memlog')
$ansi = "`e\[[0-9;]*m"
$skip = 'coord-lease|Task start|Compilation succeeded'
$expected = ' HX-\d+ naive/\S+: fail \(| HX-\d+ [^/ ]+: pass \('
$event = ': pass \(|START|\[FAIL\]|EXIT|STOP|error|quarantin|panic|uncaught|refus|not found|variants as expected'
$verdict = ' HX-\d+ \S+: (pass|fail) \('
$sw = [Diagnostics.Stopwatch]::StartNew(); $n = 0; $nextProg = $ProgressS; $nextMem = 60
$done = 0; $naivePass = 0; $posFail = 0
"watcher armed on $Log (pid $PID, max ${MaxS}s)"
while ($true) {
  if (Test-Path -LiteralPath "$Log.STOP-watch") { "watcher exiting: $Log.STOP-watch"; exit 0 }
  if ($sw.Elapsed.TotalSeconds -ge $MaxS) { "watcher exiting: max lifetime ${MaxS}s"; exit 0 }
  # The run holds the log open for writing: open it with FileShare.ReadWrite (ReadAllLines throws a sharing
  # violation on a live log, which left $lines empty).
  $lines = @()
  if (Test-Path -LiteralPath $Log) {
    try {
      $fs = [IO.FileStream]::new($Log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
      $sr = [IO.StreamReader]::new($fs)
      try { $lines = $sr.ReadToEnd() -split "`r?`n"; if ($lines.Count -and $lines[-1] -eq '') { $lines = $lines[0..($lines.Count - 2)] } } finally { $sr.Dispose() }
    } catch { "watcher: log read failed: $($_.Exception.Message)"; $lines = @() ; Start-Sleep -Seconds $IntervalS; continue }
  }
  if ($lines.Count -lt $n) { "log truncated (relaunch?): $($lines.Count) lines"; $n = 0; $done = 0; $naivePass = 0; $posFail = 0 }
  $exitSeen = $false
  for ($i = $n; $i -lt $lines.Count; $i++) {
    $l = $lines[$i] -replace $ansi, ''
    if ($l -match $verdict) { $done++; if ($l -match ' HX-\d+ naive/\S+: pass \(') { $naivePass++ } elseif ($l -match ' HX-\d+ [^/ ]+: fail \(') { $posFail++ } }
    if ($l -match '^EXIT ') { $exitSeen = $true }
    if ($l -match $skip -or $l -match $expected) { continue }
    if ($l -match $event) { $l.Substring(0, [Math]::Min(300, $l.Length)) }
  }
  $n = $lines.Count
  if ($exitSeen) { "watcher exiting: target logged EXIT"; exit 0 }
  $t = $sw.Elapsed.TotalSeconds
  if ($t -ge $nextProg) { $nextProg += $ProgressS; "progress $((Get-Date).ToUniversalTime().ToString('HH:mm:ssZ')): $done/$Total judge-fixtures done, $naivePass naive passed (unexpected), $posFail positive failed (unexpected)" }
  if ($t -ge $nextMem) {
    $nextMem += 60
    $m = Join-Path $MemDir ("memlog-" + (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd') + ".log")
    if (Test-Path -LiteralPath $m) {
      $last = Select-String -LiteralPath $m -Pattern 'avail_mb=(\d+)' | Select-Object -Last 1
      if ($last -and [int]$last.Matches[0].Groups[1].Value -lt $LowMb) { "LOW RAM avail_mb=$($last.Matches[0].Groups[1].Value) (under $LowMb)" }
    }
  }
  Start-Sleep -Seconds $IntervalS
}
