# H-107 reaper test with planted processes, a scratch dir and a scratch registry. Finishes in about a minute.
# Safety:
#  - the scratch registry starts as a copy of the live H:\cg-coord\daemons.tsv, so live daemons are never candidates;
#  - the kill-mode pass runs with -OnlyPids <the planted orphan>, so it can stop nothing else;
#  - cleanup stops only the planted PIDs, each re-checked by creation time.
# Plants are real orphans whatever the caller (a Claude session or a plain terminal): a launcher script, started
# through conhost --headless, starts the process, writes its PID to a file and exits, so the parent pid is dead.
# Planted processes end by themselves after 90 s. A failed plant marks its checks FAIL instead of throwing.
$ErrorActionPreference = 'Continue'
Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1' -Force
$R = 'H:\cg-coord\jobs\reaper\reaper.ps1'
$pw = 'C:\Program Files\PowerShell\7\pwsh.exe'; $conhost = 'C:\Windows\System32\conhost.exe'
# The Git\bin\bash.exe launcher, not usr\bin\bash.exe: started from Windows, usr\bin\bash has no MSYS PATH, cannot find
# `sleep` and exits at once. The launcher stays alive as the planted PID with the real bash as its child.
$bash = 'C:\Program Files\Git\bin\bash.exe'; $sleepExe = 'C:\Program Files\Git\usr\bin\sleep.exe'
$D = Join-Path ([IO.Path]::GetTempPath()) "reaper-test-$PID"; New-Item -ItemType Directory -Path $D | Out-Null
$Reg = Join-Path $D 'daemons.tsv'; Copy-Item 'H:\cg-coord\daemons.tsv' $Reg
$tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
$fail = 0; $n = 0
function Check($d, $ok) { $script:n++; if ($ok) { "[OK]   $d" } else { "[FAIL] $d"; $script:fail++ } }
function Proc($id) { if ($id) { Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue } }
function Plant([string]$exe, [string]$argLine, [string]$name) {
  $pidFile = Join-Path $D "$name.pid"; $launcher = Join-Path $D "$name-launch.ps1"
  # Single-quoted PowerShell literals in the launcher; the argument line is passed as one pre-quoted string.
  Set-Content $launcher ("(Start-Process '{0}' -WindowStyle Hidden -PassThru -ArgumentList '{1}').Id | Set-Content '{2}'" -f $exe, ($argLine -replace "'", "''"), $pidFile)
  $l = Start-Process $conhost -PassThru -ArgumentList '--headless', "`"$pw`"", '-NoProfile', '-File', "`"$launcher`""
  $l.WaitForExit(30000) | Out-Null
  if (-not (Test-Path $pidFile)) { return $null }
  Proc ([int](Get-Content $pidFile))
}
$passNo = 0
function Pass([string[]]$extra = @()) {
  $script:passNo++; $logF = Join-Path $D ((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd') + '.log')
  $before = if (Test-Path $logF) { @(Get-Content $logF).Count } else { 0 }
  $a = @('--headless', "`"$pw`"", '-NoProfile', '-File', $R, '-Dir', "`"$D`"", '-Registry', "`"$Reg`"", '-MinAgeMin', '0', '-NoAsk') + $extra
  (Start-Process $conhost -PassThru -ArgumentList $a).WaitForExit(60000) | Out-Null
  if (Test-Path $logF) { @(Get-Content $logF | Select-Object -Skip $before) } else { @() }
}
function Has($lines, [string]$like) { @($lines | Where-Object { $_ -like $like }).Count }

$orphan = Plant $bash "-c `"sleep 90; : orphan-$tag`"" 'orphan'
$osleep = Plant $sleepExe '90' 'osleep'
# Decoy: an orphan whose command line names a live-registry script (MSYS form); kill mode must refuse it.
# It names the first script actually listed in the live registry (MSYS form), so it tracks registry changes.
$liveRows = @(Read-Daemons 'H:\cg-coord\daemons.tsv')
$liveMsys = (($liveRows[0].script -replace '\\', '/') -replace '^([A-Za-z]):/', { '/' + $_.Groups[1].Value.ToLower() + '/' })
$decoy = Plant $bash "-c `"sleep 90; : decoy-$tag $liveMsys`"" 'decoy'
# Guards (H-107 fix 2026-11-17): an unregistered orphan launcher with a live powershell child, and one whose command
# line mentions harness. Neither may be a candidate (owner-launched runs have no claude.exe ancestor).
$guardKid = Plant $bash "-c `"powershell.exe -NoProfile -Command Start-Sleep -Seconds 90; : guardkid-$tag`"" 'guardkid'
$guardH = Plant $bash "-c `"sleep 90; : harness-guard-$tag`"" 'guardh'
$kidP = Start-Process $conhost -PassThru -ArgumentList '--headless', "`"$bash`"", "-c `"sleep 90; : kid-$tag`""
Start-Sleep -Seconds 2
$kid = @(Get-CimInstance Win32_Process -Filter "Name='bash.exe'" | Where-Object { $_.CommandLine -like "*kid-$tag*" })[0]
# The session child's headless conhost ($kidP) is planted too: cleanup stops it, or it outlives its bash.
$kidHost = Get-CimInstance Win32_Process -Filter "ProcessId=$($kidP.Id)"
$planted = @($orphan, $osleep, $kid, $decoy, $kidHost, $guardKid, $guardH) | Where-Object { $_ }
Start-Sleep -Seconds 2
# Their descendants (the real bash, the guard's powershell), two levels, so cleanup stops them too; matched by parent
# pid and a creation time after the parent.
foreach ($lvl in 1, 2) {
  $all = @(Get-CimInstance Win32_Process)
  $planted += @($all | Where-Object { $c = $_; $c.ProcessId -notin $planted.ProcessId -and @($planted | Where-Object { $_.ProcessId -eq $c.ParentProcessId -and $_.CreationDate -le $c.CreationDate }).Count })
}
Check "planted the orphan bash" ($null -ne $orphan)
Check "planted the orphan sleep" ($null -ne $osleep)
Check "planted the session child (claude.exe ancestor through this test)" ($null -ne $kid)
$o = "pid=$($orphan.ProcessId) "

$l = Pass
Check "orphan bash is a candidate" ($orphan -and (Has $l "*candidate $o*unregistered bash.exe*") -eq 1)
# The session child only has a claude.exe ancestor when this test itself runs under a Claude session.
$underClaude = $false; $cur = Proc $PID
while ($cur -and -not $underClaude) { $par = Proc $cur.ParentProcessId; if (-not $par -or $par.CreationDate -gt $cur.CreationDate) { break }; $underClaude = $par.Name -eq 'claude.exe'; $cur = $par }
if ($underClaude) { Check "session child bash is not a candidate" ($kid -and (Has $l "*candidate pid=$($kid.ProcessId) *") -eq 0) }
else { "[SKIP] session child check: this test is not running under a claude.exe" }
Check "planted the guard launchers" ($null -ne $guardKid -and $null -ne $guardH)
Check "unregistered launcher with a live powershell child: not a candidate, logged as protected" ($guardKid -and (Has $l "*candidate pid=$($guardKid.ProcessId) *") -eq 0 -and (Has $l "*protected pid=$($guardKid.ProcessId) *live descendant*") -eq 1)
Check "unregistered bash whose command line mentions harness: not a candidate" ($guardH -and (Has $l "*candidate pid=$($guardH.ProcessId) *") -eq 0 -and (Has $l "*protected pid=$($guardH.ProcessId) *harness*") -eq 1)
Check "live daemons (copied registry) are not candidates" (@($liveRows | Where-Object { (Has $l "*candidate pid=$($_.pid) *") -gt 0 }).Count -eq 0)
Check "fresh orphan sleep (age < 90 + grace) is not a candidate" ($osleep -and (Has $l "*candidate pid=$($osleep.ProcessId) *") -eq 0)
$l = Pass @('-SleepGraceS:-89')
Check "orphan sleep past its argument + grace is a candidate" ($osleep -and (Has $l "*candidate pid=$($osleep.ProcessId) *unregistered sleep 90 s still alive*") -eq 1)

if ($orphan) {
  Register-Daemon -ProcessId $orphan.ProcessId -Script 'x' -Owner test -Purpose 'registered orphan' -MaxHours none -Path $Reg
  $l = Pass
  Check "registered (max none): not a candidate" ((Has $l "*candidate $o*") -eq 0)
  Register-Daemon -ProcessId $orphan.ProcessId -Script 'x' -Owner test -Purpose 'registered orphan' -MaxHours 0.0001 -Path $Reg
  $l = Pass
  Check "registered past max_hours: a candidate" ((Has $l "*candidate $o*past max_hours*") -eq 1)
  Check "dry-run kills nothing" ($null -ne (Proc $orphan.ProcessId))
  Set-Content -Path (Join-Path $D 'MODE') -Value 'kill'
  $l = Pass @('-OnlyPids', "$($orphan.ProcessId),$($decoy.ProcessId)")
  Start-Sleep -Seconds 1
  Check "kill mode refuses a pid naming a live-registry script (hard rule)" ($decoy -and $null -ne (Proc $decoy.ProcessId) -and (Has $l "*kill refused pid=$($decoy.ProcessId)*live-registry script*") -eq 1)
  Check "kill mode stops the planted candidate by pid" ($null -eq (Proc $orphan.ProcessId))
  Check "kill mode logs it" ((Has $l "*killed pid=$($orphan.ProcessId) *") -eq 1)
  Check "kill mode stops nothing outside -OnlyPids" ((Has $l '*killed pid=*') -eq 1)
  Check "kill mode leaves the session child alone" ($kid -and $null -ne (Proc $kid.ProcessId))
} else { foreach ($c in 'registered (max none)', 'registered past max_hours', 'dry-run kills nothing', 'kill mode (4 checks)') { Check "$c (skipped: no orphan planted)" $false } }
Check "no reaper.lock left" (-not (Test-Path (Join-Path $D 'reaper.lock')))

foreach ($p in $planted) {
  $q = Proc $p.ProcessId
  if ($q -and $q.CreationDate -eq $p.CreationDate) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
Remove-Item -Recurse -Force $D -ErrorAction SilentlyContinue
"pass $($n - $fail) fail $fail"
exit $fail
