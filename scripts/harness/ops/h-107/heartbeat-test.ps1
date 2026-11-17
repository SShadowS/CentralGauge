# H-107 heartbeat.ps1 test: scratch dir, fake lease files, a fake coord script that records its arguments.
# It never kills: every run ends by the script's own exit paths (or a scratch STOP file if a check fails).
$ErrorActionPreference = 'Stop'
$H = 'H:\cg-coord\jobs\W2-10\heartbeat.ps1'
$D = Join-Path ([IO.Path]::GetTempPath()) "hb-test-$PID"; New-Item -ItemType Directory -Path $D | Out-Null
$fake = Join-Path $D 'fake-coord.ts'
Set-Content $fake "Deno.writeTextFileSync('$($D -replace '\\','/')/calls.txt', Deno.args.join(' ') + '\n', { append: true });"
$fail = 0; $n = 0
function Check($d, $ok) { $script:n++; if ($ok) { "[OK]   $d" } else { "[FAIL] $d"; $script:fail++ } }
function Run([string[]]$extra, [int]$waitS, [scriptblock]$during = {}) {
  $p = Start-Process 'C:\Windows\System32\conhost.exe' -PassThru -ArgumentList (@('--headless', '"C:\Program Files\PowerShell\7\pwsh.exe"', '-NoProfile', '-File', $H, '-Dir', $D, '-Coord', $fake,
      '-NoRegister', '-Numbers', '901,902') + $extra)
  & $during
  if (-not $p.WaitForExit($waitS * 1000)) { New-Item -ItemType File (Join-Path $D 'STOP-heartbeat') -Force | Out-Null; $p.WaitForExit(15000) | Out-Null; return $false }
  return $true
}
'{"attempt":"1","token":"tok-901"}' | Set-Content (Join-Path $D 'lease-901.json')
'{"attempt":"2","token":"tok-902"}' | Set-Content (Join-Path $D 'lease-902.json')
# 1. Beats both leases, then exits on STOP-heartbeat.
$ok = Run @('-EverySeconds', '2') 40 { Start-Sleep -Seconds 12; New-Item -ItemType File (Join-Path $D 'STOP-heartbeat') | Out-Null }
$calls = Get-Content (Join-Path $D 'calls.txt')
Check "exits on STOP-heartbeat" $ok
Check "beats Cronus901 with its token" (@($calls | Where-Object { $_ -eq 'heartbeat Cronus901 tok-901' }).Count -ge 2)
Check "beats Cronus902 with its token" (@($calls | Where-Object { $_ -eq 'heartbeat Cronus902 tok-902' }).Count -ge 2)
Check "logs the exit reason" ((Get-Content (Join-Path $D 'heartbeat.log') -Raw) -match 'exiting: STOP-heartbeat')
Remove-Item (Join-Path $D 'STOP-heartbeat')
# 2. Exits when no lease file is left (one removed now, the other during the run).
Remove-Item (Join-Path $D 'lease-902.json')
$ok = Run @('-EverySeconds', '2') 40 { Start-Sleep -Seconds 6; Remove-Item (Join-Path $D 'lease-901.json') }
Check "exits when no lease file is left" ($ok -and (Get-Content (Join-Path $D 'heartbeat.log') -Raw) -match 'exiting: no lease file left')
# 3. Exits at its max lifetime (0.002 h = 7.2 s).
'{"token":"tok-901"}' | Set-Content (Join-Path $D 'lease-901.json')
$ok = Run @('-EverySeconds', '2', '-MaxHours', '0.002') 40
Check "exits at max lifetime" ($ok -and (Get-Content (Join-Path $D 'heartbeat.log') -Raw) -match 'exiting: max lifetime 0.002 h')
Check "the token never reaches the log" (-not ((Get-Content (Join-Path $D 'heartbeat.log') -Raw) -match 'tok-'))
Remove-Item -Recurse -Force $D
"pass $($n - $fail) fail $fail"
exit $fail
