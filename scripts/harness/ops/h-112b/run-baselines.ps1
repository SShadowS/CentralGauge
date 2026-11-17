# H-112b: baseline Cronus281, 282, 283 on golden-o09-v3, one at a time. Per container: >= 18 GB free, ops lease,
# start, wait for the web client, `harness baseline create`, `harness env check`, stop, release. Stops at the first
# failure (lease, start, health, baseline or env check), stops that container, releases its lease and exits non-zero.
# Run from anywhere; the harness runs from jobs\W2-05-gates (clean, detached at 7cf16d4d). Log: run-baselines.log.
# The lease token is read from the lease file and never printed.
# -SkipEnvCheck: baseline only (orchestrator 2026-11-17: env checks wait for the owner's egress grant text).
# -EnvOnly: no baseline, only the env check (after the baselines). The egress reason is the owner grant's exact text.
param([string[]]$Containers = @('Cronus281', 'Cronus282', 'Cronus283'), [switch]$SkipEnvCheck, [switch]$EnvOnly)
$EgressReason = 'owner grant decisions/2026-11-17-egress-grant-m12.md: M12 setup, smoke and confirmatory campaign, no ingest, NST egress unenforced in golden-o09-v3 (disclosed)'
$ErrorActionPreference = 'Continue'
$Containers = @($Containers -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })   # pwsh -File passes "a,b" as one string
$env:CG_COORD_ROOT = 'H:\cg-coord'; $env:DOCKER_CONTEXT = 'desktop-windows'
$coordTs = 'H:/cg-coord/jobs/orch-master/scripts/coord/coord.ts'
$wt = 'H:\cg-coord\jobs\W2-05-gates'; $lin = 'infra\harness-reset\lineages\golden-o09-v3.json'
$log = 'H:\cg-coord\tasks\H-112b\run-baselines.log'; $leaseDir = 'H:\cg-coord\jobs\W2-10'
function Say([string]$m) { $l = "$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')) $m"; Add-Content $log $l; $l }
function Harness([string[]]$a) {
  Push-Location $wt
  try { $o = & deno task start harness @a 2>&1 | ForEach-Object { "$_" -replace "`e\[[0-9;]*m", '' }; $rc = $LASTEXITCODE } finally { Pop-Location }
  $o | Where-Object { $_ -notmatch '(?i)token|coord-lease' } | ForEach-Object { Add-Content $log "    $_" }
  return @{ rc = $rc; out = ($o -join "`n") }
}
function Release([string]$c, [string]$n) {
  $f = "$leaseDir\lease-$n.json"; if (-not (Test-Path $f)) { return }
  $t = (Get-Content $f -Raw | ConvertFrom-Json).token
  & deno run --allow-all $coordTs release $c $t *> $null
  if ($LASTEXITCODE -eq 0) { Move-Item $f "$f.released-$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ssZ'))"; Say "$c lease released" }
  else { Say "$c ALERT lease release failed (rc $LASTEXITCODE)" }
}
Say "start: $($Containers -join ', ') at $(git -C $wt rev-parse --short HEAD)"
foreach ($c in $Containers) {
  $n = $c.Substring(6)
  $free = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)
  if ($free -lt 18) { Say "$c REFUSED: free RAM $free GB < 18"; exit 3 }
  $o = & deno run --allow-all $coordTs lease $c ops 2>&1; $j = ($o -join "`n") | ConvertFrom-Json -ErrorAction SilentlyContinue
  if (-not $j.token) { Say "$c REFUSED: lease failed"; exit 3 }
  ($o -join "`n") | Set-Content "$leaseDir\lease-$n.json" -NoNewline
  Say "$c lease attempt $($j.attempt), free $free GB"
  if (-not @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" | Where-Object { $_.CommandLine -match 'heartbeat\.ps1' }).Count) {
    Start-Process conhost.exe -ArgumentList '--headless', '"C:\Program Files\PowerShell\7\pwsh.exe"', '-NoProfile', '-File', "$leaseDir\heartbeat.ps1"; Say 'heartbeat started'
  }
  docker start $c *> $null; Say "$c started (rc $LASTEXITCODE)"
  $up = $false
  foreach ($i in 1..60) {
    try { $r = Invoke-WebRequest "http://$c/BC/?tenant=default" -MaximumRedirection 0 -TimeoutSec 10 -SkipHttpErrorCheck; if ($r.StatusCode -in 200, 302) { $up = $true; break } } catch {}
    Start-Sleep -Seconds 20
  }
  $ok = $false
  if (-not $up) { Say "$c FAIL: web client not up after 20 min" }
  else {
    Say "$c web client up"
    if ($EnvOnly) { $b = @{ rc = 0; out = '' }; Say "$c baseline skipped (-EnvOnly)" }
    else {
      $b = Harness @('baseline', 'create', $c, '--lineage', $lin, '--symbol-store', 'H:\cg-coord\jobs\M8-16a\results\harness\symbols', '--results-dir', 'H:\cg-coord\results\harness')
      Say "$c baseline create rc $($b.rc): $((($b.out -split "`n") | Where-Object { $_ -match '\[(OK|FAIL)\]' }) -join ' | ')"
    }
    if ($b.rc -eq 0 -and $SkipEnvCheck) { $ok = $true; Say "$c env check skipped (held for the egress grant)" }
    elseif ($b.rc -eq 0) {
      $e = Harness @('env', 'check', '--lineage', $lin, '--containers', $c, '--symbol-store', 'H:\cg-coord\jobs\M8-16a\results\harness\symbols', '--results-dir', 'H:\cg-coord\results\harness', '--unverified-bc-egress-ok', $EgressReason)
      Say "$c env check rc $($e.rc): $((($e.out -split "`n") | Where-Object { $_ -match 'env_fp|\[(OK|FAIL)\]' }) -join ' | ')"
      $ok = $e.rc -eq 0
    }
  }
  docker stop $c *> $null; Say "$c stopped (rc $LASTEXITCODE)"
  Release $c $n
  if (-not $ok) { Say "STOPPED at $c"; exit 1 }
}
Say 'done: all containers baselined'
