# H-107 registry self-test on a scratch path (never the live daemons.tsv). Exit 0 when all checks pass.
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\daemons.psm1" -Force
$p = Join-Path ([IO.Path]::GetTempPath()) "daemons-test-$PID.tsv"
$fail = 0; $n = 0
function Check($d, $ok) { $script:n++; if ($ok) { "[OK]   $d" } else { "[FAIL] $d"; $script:fail++ } }
Register-Daemon -ProcessId $PID -Script 'C:\x\a.ps1' -Owner ops -Purpose 'test a' -MaxHours 2 -StopFile 'C:\x\a.STOP' -Path $p
$r = @(Read-Daemons $p)
Check "one row after register" ($r.Count -eq 1)
Check "start_utc matches the live process" ($r[0].start_utc -eq (Get-ProcStartUtc $PID))
Register-Daemon -ProcessId $PID -Script 'C:\x\a2.ps1' -Owner ops -Purpose 'test a again' -Path $p
$r = @(Read-Daemons $p)
Check "re-register replaces the row (pid+start)" ($r.Count -eq 1 -and $r[0].script -eq 'C:\x\a2.ps1' -and $r[0].max_hours -eq 'none')
Register-Daemon -ProcessId 999999 -StartUtc '2000-01-01T00:00:00.000Z' -Script 'C:\x\b.sh' -Owner orch -Purpose 'other' -Path $p
Check "a second row is added" (@(Read-Daemons $p).Count -eq 2)
Unregister-Daemon -ProcessId 999999 -StartUtc '2000-01-01T00:00:00.000Z' -Path $p
$r = @(Read-Daemons $p)
Check "unregister removes only that row" ($r.Count -eq 1 -and $r[0].pid -eq "$PID")
$e = $null; try { Register-Daemon -ProcessId $PID -Script "a`tb" -Owner ops -Purpose x -Path $p } catch { $e = $_ }
Check "a tab in a field is refused" ($null -ne $e)
$e = $null; try { Register-Daemon -ProcessId 999998 -Script a -Owner ops -Purpose x -Path $p } catch { $e = $_ }
Check "a dead pid without -StartUtc is refused" ($null -ne $e)
# Concurrent writers: 8 jobs register distinct fake rows at once; all 8 must survive.
$mod = "$PSScriptRoot\daemons.psm1"
$jobs = 1..8 | ForEach-Object { Start-Job -ArgumentList $mod, $p, $_ { param($m, $path, $i)
    Import-Module $m; Register-Daemon -ProcessId (800000 + $i) -StartUtc '2000-01-01T00:00:00.000Z' -Script "s$i" -Owner t -Purpose c -Path $path } }
$jobs | Wait-Job | Receive-Job -ErrorAction Continue | Out-Null; $jobs | Remove-Job
Check "8 concurrent registrations all kept" (@(Read-Daemons $p | Where-Object { $_.owner -eq 't' }).Count -eq 8)
Check "no lock or tmp file left" (-not (Test-Path "$p.lock") -and -not (Get-ChildItem (Split-Path $p) -Filter "$(Split-Path $p -Leaf).tmp-*"))
Remove-Item $p -Force
"pass $($n - $fail) fail $fail ($($PSVersionTable.PSVersion))"
exit $fail
