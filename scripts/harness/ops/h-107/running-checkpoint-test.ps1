# H-107 running-checkpoint.ps1 test: scratch dir, a fake running.tsv, executions dir, claim file and hostwatch log, and
# a fake coord script that records its arguments. It never kills: every run ends by the script's own exit paths (or a
# scratch STOP file if a check fails).
$ErrorActionPreference = 'Stop'
$S = 'H:\cg-coord\jobs\W2-10\running-checkpoint.ps1'
$D = Join-Path ([IO.Path]::GetTempPath()) "rc-test-$PID"; New-Item -ItemType Directory -Path $D | Out-Null
$E = Join-Path $D 'exec'; $C = Join-Path $D 'claims'; $HL = Join-Path $D 'hostwatch.log'; $T = Join-Path $D 'running.tsv'
New-Item -ItemType Directory -Path (Join-Path $E 'camp1234abcdef'), (Join-Path $C 'X-1') | Out-Null
1..3 | ForEach-Object { New-Item -ItemType Directory -Path (Join-Path $E "camp1234abcdef\cell$_") | Out-Null }
'{"runId":"001","token":"tok-claim"}' | Set-Content (Join-Path $C 'X-1\claim-out.json')
Set-Content $HL @('2026-11-17T00:00:00Z verdict=ok free=10GB', '2026-11-17T00:00:15Z verdict=ok free=31GB commit=40%')
$fake = Join-Path $D 'fake-coord.ts'
Set-Content $fake "Deno.writeTextFileSync('$($D -replace '\\','/')/calls.txt', JSON.stringify(Deno.args) + '\n', { append: true });"
$fail = 0; $n = 0
function Check($d, $ok) { $script:n++; if ($ok) { "[OK]   $d" } else { "[FAIL] $d"; $script:fail++ } }
function Run([string[]]$extra, [int]$waitS, [scriptblock]$during = {}) {
  $p = Start-Process 'C:\Windows\System32\conhost.exe' -PassThru -ArgumentList (@('--headless', '"C:\Program Files\PowerShell\7\pwsh.exe"', '-NoProfile', '-File', $S, '-Dir', $D, '-Coord', $fake,
      '-Exec', $E, '-ClaimRoot', $C, '-HostLog', $HL, '-NoRegister') + $extra)
  & $during
  if (-not $p.WaitForExit($waitS * 1000)) { New-Item -ItemType File (Join-Path $D 'STOP-running-ckpt') -Force | Out-Null; $p.WaitForExit(15000) | Out-Null; return $false }
  return $true
}
function LogHas($re) { (Get-Content (Join-Path $D 'running-checkpoint.log') -Raw) -match $re }
Set-Content $T ("X-1`t001`tTOKEN-FROM-CLAIM`tgates`tcamp1234abcdef`t10`tmy run")
# 1. Checkpoints the row (token from the claim file, cell count, host reading), then exits on its stop file.
$ok = Run @('-EverySeconds', '2') 40 { Start-Sleep -Seconds 10; New-Item -ItemType File (Join-Path $D 'STOP-running-ckpt') | Out-Null }
$calls = @(Get-Content (Join-Path $D 'calls.txt') | ForEach-Object { ,($_ | ConvertFrom-Json) })
Check "exits on STOP-running-ckpt" ($ok -and (LogHas 'exiting: STOP-running-ckpt'))
Check "checkpoints at least twice" ($calls.Count -ge 2)
Check "passes id, run, claim token and phase" (($calls[0][0..4] -join ' ') -eq 'checkpoint X-1 001 tok-claim gates')
Check "note has the label, cell count, short campaign and last host reading" ($calls[0][6] -eq 'my run 3/10 cells (campaign camp1234); host verdict=ok free=31GB commit=40%')
Remove-Item (Join-Path $D 'STOP-running-ckpt')
# 2. Exits when running.tsv has no run (emptied during the run).
$ok = Run @('-EverySeconds', '2') 40 { Start-Sleep -Seconds 6; Set-Content $T '' }
Check "exits when running.tsv has no run" ($ok -and (LogHas 'exiting: running.tsv has no run'))
# 3. Exits at its max lifetime (0.002 h = 7.2 s), with an inline token.
Set-Content $T ("X-2`t002`ttok-inline`tp`tnone`t5`tl")
$ok = Run @('-EverySeconds', '2', '-MaxHours', '0.002') 40
Check "exits at max lifetime" ($ok -and (LogHas 'exiting: max lifetime 0.002 h'))
Check "a missing campaign dir counts 0 cells" (@(Get-Content (Join-Path $D 'calls.txt') | Where-Object { $_ -match '"l 0/5 cells' }).Count -ge 1)
Check "no token reaches the log" (-not (LogHas 'tok-'))
Remove-Item -Recurse -Force $D
"pass $($n - $fail) fail $fail"
exit $fail
