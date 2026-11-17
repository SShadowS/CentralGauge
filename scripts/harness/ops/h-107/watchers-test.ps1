# H-107 tests for stop-bridge.ps1 and watch-qualify.ps1: scratch dirs, fake heartbeat and logs, headless launches.
# Nothing is killed: every run ends by the script's own exit paths (a scratch stop file if a check fails).
$ErrorActionPreference = 'Stop'
$B = 'H:\cg-coord\tasks\H-102\stop-bridge.ps1'; $W = 'H:\cg-coord\tasks\M8-21\ops\watch-qualify.ps1'
$pw = 'C:\Program Files\PowerShell\7\pwsh.exe'
$D = Join-Path ([IO.Path]::GetTempPath()) "watchers-test-$PID"; New-Item -ItemType Directory -Path $D | Out-Null
$fail = 0; $n = 0
function Check($d, $ok) { $script:n++; if ($ok) { "[OK]   $d" } else { "[FAIL] $d"; $script:fail++ } }
function Launch([string[]]$a) { Start-Process 'C:\Windows\System32\conhost.exe' -PassThru -ArgumentList (@('--headless', "`"$pw`"", '-NoProfile', '-File') + $a) }
function Ends($p, [int]$s, [string]$stopFile) { if ($p.WaitForExit($s * 1000)) { return $true }; New-Item -ItemType File $stopFile -Force | Out-Null; $p.WaitForExit(30000) | Out-Null; $false }
function Fresh($f) { Set-Content $f 'hb'; (Get-Item $f).LastWriteTime = Get-Date }

# ---- stop-bridge.ps1
$Pd = Join-Path $D 'priv'; New-Item -ItemType Directory $Pd | Out-Null; $HB = Join-Path $D 'heartbeat'; Fresh $HB
$RL = Join-Path $D 'run.log'; Set-Content $RL 'START x'
$p = Launch @($B, '-Private', $Pd, '-RunLog', $RL, '-EverySeconds', '1', '-Heartbeat', $HB, '-NoRegister')
Start-Sleep -Seconds 4
Check "bridge: quiet while heartbeat fresh and no host stop" (-not (Test-Path "$Pd\STOP"))
New-Item -ItemType File "$Pd\STOP.host-low" | Out-Null; Start-Sleep -Seconds 3
Check "bridge: STOP.host-low becomes STOP" (Test-Path "$Pd\STOP")
Add-Content $RL 'EXIT 1 z'
Check "bridge: exits when the run log has EXIT" (Ends $p 15 "$Pd\STOP-bridge")
Remove-Item "$Pd\STOP", "$Pd\STOP.host-low"
(Get-Item $HB).LastWriteTime = (Get-Date).AddSeconds(-400)
$p = Launch @($B, '-Private', $Pd, '-EverySeconds', '1', '-Heartbeat', $HB, '-NoRegister')
Start-Sleep -Seconds 4
Check "bridge: stale hostwatch heartbeat writes STOP" (Test-Path "$Pd\STOP")
New-Item -ItemType File "$Pd\STOP-bridge" | Out-Null
Check "bridge: exits on STOP-bridge" (Ends $p 15 "$Pd\STOP-bridge")
Remove-Item "$Pd\STOP", "$Pd\STOP-bridge"; Fresh $HB
$p = Launch @($B, '-Private', $Pd, '-EverySeconds', '1', '-Heartbeat', $HB, '-MaxHours', '0.002', '-NoRegister')
Check "bridge: exits at max lifetime" (Ends $p 30 "$Pd\STOP-bridge")
$bl = Get-Content "$Pd\stop-bridge.log" -Raw
Check "bridge: logs each exit reason" ($bl -match 'logged EXIT' -and $bl -match 'exiting: STOP-bridge' -and $bl -match 'exiting: max lifetime')

# ---- watch-qualify.ps1 (stdout captured to a file)
$L = Join-Path $D 'q.log'; $O = Join-Path $D 'w.out'
Set-Content $L @('START 2026-11-16T00:00:00Z HEAD 0a233bb5', "`e[32m[OK]`e[39m HX-010 correct: pass (a)", "`e[31m[FAIL]`e[39m HX-010 naive/x: fail (b)", '--coord-lease Cronus281=SECRET [FAIL]', '[container:bc] Compilation succeeded (errors=0, warnings=0)')
function Watch([string]$extra, [string]$out) { Start-Process 'C:\Windows\System32\conhost.exe' -PassThru -ArgumentList '--headless',
    "`"$pw`"", '-NoProfile', '-Command', "`"& '$W' -Log '$L' -Total 5 -IntervalS 1 $extra *> '$out'`"" }
$p = Watch '-ProgressS 3' $O
Start-Sleep -Seconds 5
Add-Content $L @("`e[32m[OK]`e[39m HX-011 naive/y: pass (c)", "`e[31m[FAIL]`e[39m HX-011 correct: fail (d)", '[FAIL] image missing', 'EXIT 1 2026-11-16T00:01:00Z')
Check "watch: exits when the log has EXIT" (Ends $p 15 "$L.STOP-watch")
$txt = Get-Content $O -Raw
Check "watch: prints START" ($txt -match 'START 2026')
Check "watch: hides expected verdicts" ($txt -notmatch 'HX-010 correct: pass' -and $txt -notmatch 'HX-010 naive/x: fail')
Check "watch: prints unexpected verdicts" ($txt -match 'HX-011 naive/y: pass' -and $txt -match 'HX-011 correct: fail')
Check "watch: never prints a coord-lease line or compile noise" ($txt -notmatch 'SECRET' -and $txt -notmatch 'Compilation succeeded')
Check "watch: progress counts all verdicts" ($txt -match 'progress .*: 2/5 judge-fixtures done, 0 naive passed')
Check "watch: logs the EXIT exit" ($txt -match 'watcher exiting: target logged EXIT')
Set-Content $L 'START y'
$p = Watch '-MaxS 4' "$O.2"
Check "watch: exits at max lifetime" ((Ends $p 20 "$L.STOP-watch") -and ((Get-Content "$O.2" -Raw) -match 'max lifetime 4s'))
$p = Watch '' "$O.3"
Start-Sleep -Seconds 3; New-Item -ItemType File "$L.STOP-watch" | Out-Null
Check "watch: exits on STOP-watch" ((Ends $p 15 "$L.STOP-watch") -and ((Get-Content "$O.3" -Raw) -match 'STOP-watch'))
Remove-Item -Recurse -Force $D
"pass $($n - $fail) fail $fail"
exit $fail
