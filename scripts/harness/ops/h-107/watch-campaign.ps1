#Requires -Version 7
# M12-05: low-churn per-campaign watcher, the pwsh replacement for scripts/harness/ops/watch.sh. One pwsh process
# that sleeps internally and reads every file itself: no bash, no Start-Process and no child pwsh in its loop, so it
# adds no git-bash token leak (H-107) over a 7 to 15 day campaign. `harness run` reads its stop files itself, so this
# only writes <Prefix>.watch (the stops.sh `watch` name) and never anything else under the prefix.
#
# Every -EverySeconds it writes <Prefix>.watch (exclusive create, retried once, ALERT on a failed write) when:
#   - free RAM is under 4 GB, or there has been no good RAM reading for more than -StallSeconds (default 90);
#   - the hostwatch heartbeat is older than 180 s, more than 60 s in the future, missing or empty;
#   - the hostwatch registry does not list -Prefix or cannot be read (nothing else would stop this campaign);
#   - every -Pool container is quarantined, or the quarantine records cannot be read. One quarantined container
#     of several only logs an ALERT line (once per container).
# It also logs, to <prefix dir>\cost.log, the total list-price cost of the campaign every 20 executions as one
# number (never per arm), when -Experiment names the campaign's experiment.
# Host-busy (log only, never a stop): from the newest memlog file (H:\cg-coord\jobs\W2-10\memlog, 15 s samples of
# the top processes by private bytes), a process outside -QuietAllow at or above -BusyMb in three samples in a row
# logs "HOST-BUSY start <process> <UTC of the first sample>", three quiet samples in a row log "HOST-BUSY end <UTC>".
# A missing memlog, or one whose newest sample is older than 120 s, logs "HOST-BUSY unknown <UTC>" (once until it
# is readable again). The memlog has no CPU column, so busy is judged on memory only.
# Log: <prefix dir>\watch.log. One watcher per prefix: lock dir <Prefix>.watch-ps.lock (stops.sh lock_take
# semantics, through hostwatch.ps1's Lock-Take); a second instance exits 3.
# Exits (logged): the run log's "EXIT " (or harness "exit ") line, <Prefix>.STOP-watch, -MaxHours, -Iter polls
# (tests). Registers in H:\cg-coord\daemons.tsv (or -DaemonRegistry) after the lock and unregisters on every exit,
# unless -NoRegister.
# Start detached with no window:
#   Start-Process conhost.exe -ArgumentList '--headless','"C:\Program Files\PowerShell\7\pwsh.exe"','-NoProfile','-File','<this script>','-Prefix',...
# Test hooks: -Feed (one free-GB reading per poll; STALL = no reading), -Iter, -StallSeconds, -DaemonRegistry.
param(
  [Parameter(Mandatory)][string]$Prefix,
  [Parameter(Mandatory)][string]$RunLog,
  [string]$Pool = 'Cronus281',
  [string]$Results = 'H:\cg-coord\results\harness',
  [int]$EverySeconds = 60,
  [double]$MaxHours = 400,
  [string]$Heartbeat = 'H:\cg-coord\jobs\W2-10\hostwatch\heartbeat',
  [string]$Registry = 'H:\cg-coord\jobs\W2-10\hostwatch\targets.tsv',
  [string]$QuarantineDir = 'H:\cg-coord\harness-quarantine',
  [switch]$NoRegister,
  [string]$Experiment = '',
  [string]$MemlogDir = 'H:\cg-coord\jobs\W2-10\memlog',
  [string]$QuietAllow = 'docker*,com.docker*,vmmem*,Microsoft.Dynamics.Nav*,sqlservr*,deno*,pwsh*,claude*,node*',
  [int]$BusyMb = 3000,
  [string]$Feed = '',
  [int]$Iter = 0,
  [int]$StallSeconds = 90,
  [string]$DaemonRegistry = 'H:\cg-coord\daemons.tsv',
  [string]$FromUtc = ''   # memlog samples before this are ignored (default: 60 s before the start); tests set it earlier
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'hostwatch.ps1') -LibOnly   # Add-Line, Get-Utc, Write-Stop, Read-Registry, ConvertTo-MsysPath, Lock-Take, Lock-Release

$Dir = Split-Path -Parent $Prefix
$script:LOG = Join-Path $Dir 'watch.log'; $script:LockLog = $script:LOG
$CostLog = Join-Path $Dir 'cost.log'
$PoolNames = @($Pool -split '[,\s]+' | Where-Object { $_ })
$Allow = @($QuietAllow -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
function Say([string]$m) { if (-not (Add-Line $script:LOG "[watch] $(Get-Utc) $m")) { [Console]::Error.WriteLine("watch-campaign: $m") } }

function Stop-Campaign([string]$why) {
  $rc = Write-Stop $Prefix 'watch' $why
  if ($rc -eq 2) { Start-Sleep -Seconds 1; $rc = Write-Stop $Prefix 'watch' $why }
  switch ($rc) { 0 { Say "$Prefix.watch written ($why)" } 2 { Say "ALERT could not write $Prefix.watch twice ($why)" } }
}

# One free-RAM reading in GB, or $null (no reading). In-process; the feed replaces it in tests.
function Read-FreeGb([int]$k) {
  if ($Feed) {
    $ls = @(); try { $ls = [IO.File]::ReadAllLines($Feed) } catch {}
    $v = if ($k - 1 -lt $ls.Count) { $ls[$k - 1].Trim() } else { 'STALL' }
  } else {
    try { $v = [string]::Format([cultureinfo]::InvariantCulture, '{0:F1}', (Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 45 -ErrorAction Stop).FreePhysicalMemory / 1MB) }
    catch { $v = '' }
  }
  $d = 0.0
  if ($v -match '^[0-9]+(\.[0-9]+)?$' -and [double]::TryParse($v, [Globalization.NumberStyles]::Float, [cultureinfo]::InvariantCulture, [ref]$d)) { return $d }
  return $null
}

# stops.sh hb_check: "OK" or why not.
function Test-Heartbeat {
  try {
    $f = [IO.FileInfo]::new($Heartbeat)
    if (-not $f.Exists) { return "hostwatch heartbeat missing ($Heartbeat)" }
    if ($f.Length -eq 0) { return "hostwatch heartbeat empty ($Heartbeat; a failed write?)" }
    $age = [int]([DateTime]::UtcNow - $f.LastWriteTimeUtc).TotalSeconds
    if ($age -gt 180) { return "hostwatch heartbeat ${age}s old ($Heartbeat)" }
    if ($age -lt -60) { return "hostwatch heartbeat $(-$age)s in the future ($Heartbeat; clock moved?)" }
    return 'OK'
  } catch { return "hostwatch heartbeat unreadable ($Heartbeat)" }
}

# Quarantined pool containers, or $null when a record cannot be read (never "none").
function Get-Quarantined {
  if (-not [IO.Directory]::Exists($QuarantineDir)) { return $null }
  $q = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($f in [IO.Directory]::GetFiles($QuarantineDir, '*.json')) {
    try { $r = [IO.File]::ReadAllText($f) | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
    if ($r.state -eq 'quarantined' -and $PoolNames -contains $r.container) { [void]$q.Add($r.container) }
  }
  return , ([string[]]@($q))   # the comma keeps an empty list from collapsing to $null (= unreadable)
}

# The campaign id of -Experiment (latest campaign record naming it), or ''.
function Get-CampaignId {
  if (-not $Experiment) { return '' }
  $id = ''
  try {
    foreach ($f in [IO.Directory]::GetFiles((Join-Path $Results 'campaigns'), '*.json')) {
      try { $c = [IO.File]::ReadAllText($f) | ConvertFrom-Json -ErrorAction Stop; if ($c.experiment.id -eq $Experiment) { $id = $c.id } } catch {}
    }
  } catch {}
  return $id
}
# Total list-price cost of a campaign's executions: [n, usd]. Never split by arm.
function Get-Cost([string]$cid) {
  $usd = 0.0; $n = 0
  foreach ($f in [IO.Directory]::GetFiles((Join-Path $Results "executions\$cid"), '*.json')) {
    $n++
    try {
      $e = [IO.File]::ReadAllText($f) | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $e.telemetry.cost_usd) { $usd += [double]$e.telemetry.cost_usd }
      elseif ($e.telemetry.raw_usage.modelUsage) { foreach ($p in $e.telemetry.raw_usage.modelUsage.PSObject.Properties) { $usd += [double]$p.Value.costUSD } }
    } catch {}
  }
  return @($n, [Math]::Round($usd, 2))
}

# The run log has ended: an "EXIT " (ops wrapper) or "exit " (harness) line after the last "=== [" marker.
function Test-RunEnded {
  try {
    $fs = [IO.File]::Open($RunLog, 'Open', 'Read', 'ReadWrite'); try { $t = [IO.StreamReader]::new($fs).ReadToEnd() } finally { $fs.Dispose() }
  } catch { return $false }
  $i = $t.LastIndexOf("`n=== ["); if ($i -ge 0) { $t = $t.Substring($i) }
  return [regex]::IsMatch($t, '(?m)^(EXIT|exit) ')
}

# ---- HOST-BUSY from the memlog (log only).
$script:MemFile = ''; $script:MemPos = 0L; $script:MemTail = ''
$script:Busy = $false; $script:BusyRun = 0; $script:QuietRun = 0; $script:BusyFirst = $null; $script:QuietFirst = $null
$script:Unknown = $false; $script:LastSample = $null
# Only samples from about the watcher's start count, so a new campaign never logs windows from before it began.
$script:From = if ($FromUtc) { [DateTime]::Parse($FromUtc, [cultureinfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal) } else { [DateTime]::UtcNow.AddSeconds(-60) }
$script:FromText = $script:From.ToString('yyyy-MM-ddTHH:mm:ssZ', [cultureinfo]::InvariantCulture)
function Test-Allowed([string]$name) { foreach ($a in $Allow) { if ($name -like $a) { return $true } }; return $false }
function Step-Sample([string]$ts, [string[]]$procs) {
  $hit = $null
  foreach ($l in $procs) {
    if ($l -match '^\s*\d+\s+\d+\s+(\d+)MB (\S+)') { if ([int]$Matches[1] -ge $BusyMb -and -not (Test-Allowed $Matches[2])) { $hit = $Matches[2]; break } }
  }
  if ($hit) {
    $script:QuietRun = 0
    if ($script:BusyRun -eq 0) { $script:BusyFirst = $ts; $script:BusyName = $hit }
    $script:BusyRun++
    if (-not $script:Busy -and $script:BusyRun -ge 3) { $script:Busy = $true; Say "HOST-BUSY start $($script:BusyName) $($script:BusyFirst)" }
  } else {
    $script:BusyRun = 0
    if ($script:QuietRun -eq 0) { $script:QuietFirst = $ts }
    $script:QuietRun++
    if ($script:Busy -and $script:QuietRun -ge 3) { $script:Busy = $false; Say "HOST-BUSY end $($script:QuietFirst)" }
  }
}
function Read-Memlog {
  $f = $null
  try { $f = [IO.Directory]::GetFiles($MemlogDir, 'memlog-*.log') | Sort-Object | Select-Object -Last 1 } catch {}
  if ($f) {
    if ($f -ne $script:MemFile) { $script:MemFile = $f; $script:MemPos = 0L; $script:MemTail = '' }
    try {
      $fs = [IO.File]::Open($f, 'Open', 'Read', 'ReadWrite')
      try { [void]$fs.Seek($script:MemPos, 'Begin'); $new = [IO.StreamReader]::new($fs).ReadToEnd(); $script:MemPos = $fs.Length } finally { $fs.Dispose() }
      # keep the last (possibly incomplete) sample for the next read: a block is complete when the next "===" starts
      $text = $script:MemTail + $new
      $blocks = [regex]::Split($text, '(?m)^(?==== )') | Where-Object { $_ -match '^=== ' }
      $script:MemTail = if ($blocks) { $blocks[-1] } else { '' }
      foreach ($b in @($blocks | Select-Object -SkipLast 1) + @($blocks | Select-Object -Last 1)) {
        if ($b -match '^=== (\S+)') {
          $ts = $Matches[1]
          if ($script:LastSample -and $ts -le $script:LastSample) { continue }   # the tail block is re-read once complete
          $script:LastSample = $ts
          if ($ts -lt $script:FromText) { continue }   # same fixed ISO format, so text order is time order
          Step-Sample $ts @($b -split "`n" | Select-Object -Skip 1)
        }
      }
    } catch {}
  }
  $fresh = $false
  if ($script:LastSample) {
    $t = [DateTime]::MinValue
    if ([DateTime]::TryParse($script:LastSample, [cultureinfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal, [ref]$t)) {
      $fresh = ([DateTime]::UtcNow - $t).TotalSeconds -le 120
    }
  }
  if (-not $fresh -and -not $script:Unknown) { $script:Unknown = $true; Say "HOST-BUSY unknown $(Get-Utc) (memlog missing or stale: $MemlogDir)" }
  elseif ($fresh -and $script:Unknown) { $script:Unknown = $false; Say "HOST-BUSY known again $(Get-Utc)" }
}

# ---- Main.
if (-not [IO.Directory]::Exists($Dir)) { [Console]::Error.WriteLine("watch-campaign: prefix directory $Dir missing"); exit 2 }
$Lock = "$Prefix.watch-ps.lock"
$lk = Lock-Take $Lock
if ($lk -ne 0) { [Console]::Error.WriteLine("watch-campaign: another watcher holds $Lock"); exit 3 }
$code = 0; $why = $null; $registered = $false
try {
  if (-not $NoRegister) {
    try {
      Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1' -ErrorAction Stop
      Register-Daemon -ProcessId $PID -Script $PSCommandPath -Owner ops -Path $DaemonRegistry -StopFile "$Prefix.STOP-watch" `
        -MaxHours "$MaxHours" -Purpose "M12-05 campaign watcher for $Prefix (pool $($PoolNames -join ','))"
      $registered = $true
    } catch { Say "ALERT daemon registry write failed: $($_.Exception.Message)" }
  }
  Say "started (pid $PID) prefix $Prefix pool $($PoolNames -join ',') every ${EverySeconds}s"
  $sw = [Diagnostics.Stopwatch]::StartNew(); $lastGood = 0.0; $badN = 0; $k = 0
  $alerted = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $nextCost = 20
  while ($true) {
    $k++
    if ([IO.File]::Exists("$Prefix.STOP-watch")) { $why = 'STOP-watch'; break }
    if ($sw.Elapsed.TotalHours -ge $MaxHours) { $why = "max lifetime $MaxHours h"; break }
    $free = Read-FreeGb $k
    $now = $sw.Elapsed.TotalSeconds
    if ($null -ne $free) {
      $lastGood = $now; $badN = 0
      if ($free -lt 4) { Stop-Campaign ([string]::Format([cultureinfo]::InvariantCulture, 'free RAM {0:F1} GB, floor 4 GB', $free)) }
    } else {
      $badN++; $age = [Math]::Max([int]($now - $lastGood), $badN * $EverySeconds)
      Say "bad RAM reading, ${age}s since the last good one"
      if ($age -gt $StallSeconds) { Stop-Campaign "no good RAM reading for ${age}s" }
    }
    $hb = Test-Heartbeat; if ($hb -ne 'OK') { Stop-Campaign $hb }
    $reg = Read-Registry $Registry
    $me = ConvertTo-MsysPath $Prefix
    if (-not $reg.Ok -or -not ($reg.P | Where-Object { $_ -ieq $me })) { Stop-Campaign "not listed in the hostwatch registry $Registry (or it cannot be read)" }
    $q = Get-Quarantined
    if ($null -eq $q) { Stop-Campaign "quarantine records unreadable ($QuarantineDir)" }
    elseif ($q.Count -ge $PoolNames.Count) { Stop-Campaign "every pool container quarantined ($($PoolNames -join ','))" }
    else { foreach ($c in $q) { if ($alerted.Add($c)) { Say "ALERT $c quarantined ($($q.Count) of $($PoolNames.Count) pool containers)" } } }
    $cid = Get-CampaignId
    if ($cid) {
      $cn = Get-Cost $cid
      if ($cn[0] -ge $nextCost) {
        [void](Add-Line $CostLog ([string]::Format([cultureinfo]::InvariantCulture, '[cost] {0} {1} {2} n={3} usd={4}', (Get-Utc), $Experiment, $cid, $cn[0], $cn[1])))
        $nextCost = ([Math]::Floor($cn[0] / 20) + 1) * 20
      }
    }
    Read-Memlog
    if (Test-RunEnded) { $why = 'run log EXIT'; break }
    if ($Iter -gt 0 -and $k -ge $Iter) { $why = "$Iter polls (test)"; break }
    # sleep in short steps so STOP-watch is seen quickly
    $until = $sw.Elapsed.TotalSeconds + $EverySeconds
    while ($sw.Elapsed.TotalSeconds -lt $until -and -not [IO.File]::Exists("$Prefix.STOP-watch")) { Start-Sleep -Milliseconds 500 }
  }
} catch {
  Say "exiting on error: $($_.Exception.Message)"; $code = 4
} finally {
  if ($why) { Say "exiting: $why" }
  if ($registered) { try { Unregister-Daemon -ProcessId $PID -Path $DaemonRegistry } catch { Say "ALERT daemon registry removal failed: $($_.Exception.Message)" } }
  Lock-Release $Lock
}
exit $code
