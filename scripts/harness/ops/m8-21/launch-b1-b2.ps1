# M8-21 back resplit launcher (decisions\2026-11-17-m8-21-back-resplit.md). Run it yourself in PowerShell:
#   pwsh -NoProfile -File H:\cg-coord\tasks\M8-21\ops\launch-b1-b2.ps1
# It waits for the stopping back half to exit (up to 45 min), archives qualify-back.log, checks everything, launches
# b1 (Cronus281) and b2 (Cronus282) headless and detached, and registers both runs in daemons.tsv. It refuses (and
# launches nothing) if any check fails. Closing this window afterwards does not stop the runs.
$ErrorActionPreference = 'Stop'
$ops = 'H:\cg-coord\tasks\M8-21\ops'; $m8 = 'H:\cg-coord\m8\freeze-m8-21'; $sha = 'd32bb274390860ec63d5b0b636658551612d3d3e'
$bash = '"C:\Program Files\Git\bin\bash.exe"'
function Refuse($why) { Write-Host "REFUSED: $why (nothing launched)" -ForegroundColor Red; exit 3 }

# 1. The old back half must have exited.
$back = "$ops\qualify-back.log"
if (Test-Path $back) {
  $t0 = Get-Date
  while (-not (Select-String -LiteralPath $back -Pattern '^EXIT ' -Quiet)) {
    if (((Get-Date) - $t0).TotalMinutes -gt 45) { Refuse 'the old back half has not exited after 45 min' }
    Write-Host "waiting for the old back half to exit ($([int]((Get-Date) - $t0).TotalMinutes) min)..."; Start-Sleep -Seconds 30
  }
  Write-Host "old back half: $((Get-Content $back -Tail 1))"
  $to = "$ops\qualify-back-refreeze2.log"
  if (Test-Path $to) { Refuse "$to already exists" }
  Move-Item $back $to; Write-Host "archived qualify-back.log -> qualify-back-refreeze2.log"
}

# 2. Checks.
foreach ($wt in 'W2-05-gates', 'W2-05-gates-b') {
  $h = (git -C "H:\cg-coord\jobs\$wt" rev-parse HEAD).Trim(); $d = git -C "H:\cg-coord\jobs\$wt" status --porcelain
  if ($h -ne $sha -or $d) { Refuse "$wt is not clean at d32bb274 (HEAD $h)" }
}
foreach ($s in 'b1', 'b2') {
  foreach ($f in "$m8\qualify-manifest-$s.json", "$ops\run-qualify-$s.sh") { if (-not (Test-Path $f)) { Refuse "missing $f" } }
  if (Test-Path "$ops\qualify-$s.log") { Refuse "qualify-$s.log already exists (already launched?)" }
  if (@(Get-ChildItem "$m8\private-$s" -File | Where-Object Name -match '^STOP($|\.|-bridge$)').Count) { Refuse "a STOP file is in private-$s" }
  if (-not @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" | Where-Object { $_.CommandLine -match "stop-bridge\.ps1.*private-$s" }).Count) { Refuse "no stop bridge for private-$s" }
}
$q = @(Get-ChildItem H:\cg-coord\harness-quarantine -Filter *.json | ForEach-Object { Get-Content $_.FullName -Raw | ConvertFrom-Json })
if (@($q | Where-Object { $_.container -in 'Cronus281', 'Cronus282' }).Count) { Refuse "a quarantine or in-use record is still there: $(($q | ForEach-Object { "$($_.container) $($_.state)" }) -join ', ')" }
$free = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)
if ($free -lt 18) { Refuse "free RAM $free GB < 18" }
Write-Host "checks OK: worktrees clean at d32bb274, manifests and scripts present, bridges running, no STOP, no quarantine, free $free GB" -ForegroundColor Green

# 3. Launch both, headless and detached.
foreach ($s in 'b1', 'b2') {
  Start-Process conhost.exe -ArgumentList '--headless', $bash, "-c `"cd /h/cg-coord/tasks/M8-21/ops && exec bash run-qualify-$s.sh > qualify-$s.log 2>&1`""
}
Start-Sleep -Seconds 8

# 4. Find each run's top bash, register it, show its START line.
Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1'
foreach ($x in @(@{ s = 'b1'; c = 'Cronus281'; n = 42 }, @{ s = 'b2'; c = 'Cronus282'; n = 44 })) {
  $top = @(Get-CimInstance Win32_Process -Filter "Name='bash.exe'" | Where-Object { $_.CommandLine -match "exec bash run-qualify-$($x.s)\.sh" -and $_.CommandLine -match 'Git\\bin\\bash' } | Sort-Object CreationDate)[0]
  if ($top) {
    Register-Daemon -ProcessId $top.ProcessId -Script "$ops\run-qualify-$($x.s).sh" -Owner ops -Purpose "M8-21 back resplit $($x.s) ($($x.c), $($x.n) variants), owner launch" -MaxHours 20 -StopFile "$m8\private-$($x.s)\STOP"
    Write-Host "$($x.s): launched on $($x.c), pid $($top.ProcessId), registered; $((Get-Content "$ops\qualify-$($x.s).log" -TotalCount 1))" -ForegroundColor Green
  } else { Write-Host "$($x.s): no run process found; check $ops\qualify-$($x.s).log" -ForegroundColor Red }
}
