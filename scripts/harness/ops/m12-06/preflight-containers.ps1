# M12-06 Steps 4 and 8: start the pool containers under ops leases (each start only at >= 18 GB free), record free
# RAM after each start, run `harness env check` on lineage golden-o09-v3 from the campaign checkout, check the
# quarantine dir, stop, release. Containers that cannot start for RAM in the first pass get a second pass alone.
# Lease tokens are read from lease files and never printed. Log: preflight-containers.log.
param([string[]]$Containers = @('Cronus281', 'Cronus282', 'Cronus283'))
$EgressReason = 'owner grant decisions/2026-11-17-egress-grant-m12.md: M12 setup, smoke and confirmatory campaign, no ingest, NST egress unenforced in golden-o09-v3 (disclosed)'
$ErrorActionPreference = 'Continue'
$Containers = @($Containers -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$env:CG_COORD_ROOT = 'H:\cg-coord'; $env:DOCKER_CONTEXT = 'desktop-windows'
$coordTs = 'H:/cg-coord/jobs/orch-master/scripts/coord/coord.ts'
$wt = 'H:\cg-coord\jobs\M12-run'; $lin = 'infra\harness-reset\lineages\golden-o09-v3.json'
$log = 'H:\cg-coord\tasks\M12-06\preflight-containers.log'; $leaseDir = 'H:\cg-coord\jobs\W2-10'
function Say([string]$m) { $l = "$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')) $m"; Add-Content $log $l; Write-Host $l }   # Write-Host: functions return only their value
function FreeGb { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1) }
function Release([string]$c) {
  $f = "$leaseDir\lease-$($c.Substring(6)).json"; if (-not (Test-Path $f)) { return }
  $t = (Get-Content $f -Raw | ConvertFrom-Json).token
  & deno run --allow-all $coordTs release $c $t *> $null
  if ($LASTEXITCODE -eq 0) { Move-Item $f "$f.released-$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ssZ'))"; Say "$c lease released" }
  else { Say "$c ALERT lease release failed (rc $LASTEXITCODE)" }
}
function StartOne([string]$c) {
  $free = FreeGb
  if ($free -lt 18) { Say "$c NOT STARTED: free RAM $free GB < 18"; return $false }
  $o = & deno run --allow-all $coordTs lease $c ops 2>&1; $j = ($o -join "`n") | ConvertFrom-Json -ErrorAction SilentlyContinue
  if (-not $j.token) { Say "$c REFUSED: lease failed"; return $false }
  ($o -join "`n") | Set-Content "$leaseDir\lease-$($c.Substring(6)).json" -NoNewline
  Say "$c lease attempt $($j.attempt), free before start $free GB"
  if (-not @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" | Where-Object { $_.CommandLine -match 'heartbeat\.ps1' }).Count) {
    Start-Process conhost.exe -ArgumentList '--headless', '"C:\Program Files\PowerShell\7\pwsh.exe"', '-NoProfile', '-File', "$leaseDir\heartbeat.ps1"; Say 'heartbeat started'
  }
  docker start $c *> $null; Say "$c started (rc $LASTEXITCODE)"
  foreach ($i in 1..60) {
    try { $r = Invoke-WebRequest "http://$c/BC/?tenant=default" -MaximumRedirection 0 -TimeoutSec 10 -SkipHttpErrorCheck; if ($r.StatusCode -in 200, 302) { Start-Sleep -Seconds 60; Say "$c web client up; free RAM $(FreeGb) GB (60 s after up)"; return $true } } catch {}
    Start-Sleep -Seconds 20
  }
  Say "$c FAIL: web client not up after 20 min"; docker stop $c *> $null; Release $c; return $false
}
function EnvCheck([string[]]$up) {
  Push-Location $wt
  try { $o = & deno task start harness env check --lineage $lin --containers ($up -join ',') --symbol-store 'H:\cg-coord\jobs\M8-16a\results\harness\symbols' --results-dir 'H:\cg-coord\results\harness' --unverified-bc-egress-ok $EgressReason 2>&1 | ForEach-Object { "$_" -replace "`e\[[0-9;]*m", '' }; $rc = $LASTEXITCODE } finally { Pop-Location }
  $o | Where-Object { $_ -notmatch '(?i)token|coord-lease' } | ForEach-Object { Add-Content $log "    $_" }
  Say "env check [$($up -join ',')] rc $rc"
  return $rc
}
function StopAll([string[]]$up) { foreach ($c in $up) { docker stop $c *> $null; Say "$c stopped (rc $LASTEXITCODE)"; Release $c } }

Say "start: $($Containers -join ', ') at $(git -C $wt rev-parse --short HEAD); free RAM $(FreeGb) GB"
$bench = @('H:\cg-coord\jobs\M12-run\results\.bench-running.json', 'U:\Git\CentralGauge\results\.bench-running.json') | Where-Object { (Test-Path $_) -and ((Get-Item $_).LastWriteTime -gt (Get-Date).AddMinutes(-2)) }
if ($bench) { Say "REFUSED: bench live ($($bench -join ', '))"; exit 3 }
Say 'no bench live'
$rc = 0; $todo = @($Containers)
while ($todo.Count) {
  $up = @(); $left = @()
  foreach ($c in $todo) { if ($left.Count -or -not (StartOne $c)) { $left += $c } else { $up += $c } }
  if (-not $up.Count) { Say "STOPPED: none of $($todo -join ',') could start"; exit 1 }
  Say "pass: up $($up -join ','); free RAM with all up $(FreeGb) GB"
  if ((EnvCheck $up) -ne 0) { $rc = 1 }
  StopAll $up
  $todo = $left
}
$q = Get-ChildItem 'H:\cg-coord\harness-quarantine' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $n = $_.FullName; $Containers | Where-Object { $n -match $_ } }
Say "quarantine records for $($Containers -join ','): $(@($q).Count) $(($q | ForEach-Object Name) -join ', ')"
Say "done rc $rc; free RAM $(FreeGb) GB"
exit $rc
