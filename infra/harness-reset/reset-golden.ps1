param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$Lineage,
  [string]$Company = 'My Company'
)
# H-35 S3 reset contract (O-09, lineage golden-o09-v1): restore a sha-verified golden.bak into the single-tenant CRONUS
# DB of $Container and prove the result. Steps, each printed as `RESET_STEP <name> <ms>`:
#   snapshot_guard, quiesce   preconditions (no DB snapshot; no user or background session)
#   verify_sha                golden.bak sha256 equals the lineage
#   stop, restore, start      NST stop, RESTORE DATABASE ... WITH REPLACE, NST start
#   healthy                   docker healthy, web 200/301/302, tenant Operational (10 min limit)
#   runner_verify             runner rows (ID, Package ID, version) published and installed + SOAP no-op
#   postconditions            inventory equals the lineage's stored inventory, tenant Operational, subset fingerprint
#                             equals the lineage (orchestrator ruling: a mismatch fails the reset)
# Then exactly one `RESET_OK`, or `RESET_FAILED <step> <reason>`; exit 0 only with RESET_OK. Other stdout is ignored.
# Run: pwsh -NoProfile -File reset-golden.ps1 -Container <c> -Lineage <abs path>, with DOCKER_CONTEXT pinned.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
# BCH pin: src/container/bcch-config.ts BCCH_PINNED_VERSION (6.1.14). A bare pwsh here resolves 6.1.15 and
# Import-Module -RequiredVersion can silently keep an already-loaded version, so the resolved version is checked below.
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')
. (Join-Path $PSScriptRoot 'content-root.ps1')

function Fail([string]$step, [string]$reason) {
  $one = ($reason -replace '[\r\n]+', ' ').Trim()
  if ($one.Length -gt 300) { $one = $one.Substring(0, 300) }
  Write-Output "RESET_FAILED $step $one"
  exit 1
}
function Step([string]$name, [scriptblock]$body) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { & $body | Out-Null } catch { Fail $name $_.Exception.Message }
  Write-Output "RESET_STEP $name $($sw.ElapsedMilliseconds)"
}

$bchVersion = "$((Get-Command Invoke-ScriptInBcContainer -ErrorAction SilentlyContinue).Module.Version)"
if ($bchVersion -ne '6.1.14') { Fail 'lineage' "bccontainerhelper resolved to '$bchVersion', pinned 6.1.14" }
try {
  $lin = Get-Content -Raw $Lineage | ConvertFrom-Json
  $golden = $lin.golden_path_template.Replace('{container}', $Container)
  $invFile = Join-Path (Split-Path -Parent $Lineage) $lin.inventory.path
  if ((Get-FileHash $invFile -Algorithm SHA256).Hash.ToLower() -ne $lin.inventory.sha256) { throw "stored inventory sha mismatch ($invFile)" }
  $storedInventory = Get-Content $invFile
} catch { Fail 'lineage' $_.Exception.Message }

Step snapshot_guard {
  $n = Invoke-InContainer $Container { (Invoke-Sqlcmd -Query "SELECT COUNT(*) AS n FROM sys.databases WHERE source_database_id = DB_ID('CRONUS')").n }
  if ([int]$n -gt 0) { throw "a database snapshot of CRONUS exists ($n)" }
}
Step quiesce {
  $q = Invoke-InContainer $Container {
    # system sessions carry negative ids, which Remove-NAVServerSession refuses; the NST stop ends them
    Get-NAVServerSession -ServerInstance BC -Tenant default | Where-Object { $_.SessionID -ge 0 } |
      ForEach-Object { Remove-NAVServerSession -ServerInstance BC -Tenant default -SessionId $_.SessionID -Force }
    $s = @(Get-NAVServerSession -ServerInstance BC -Tenant default)
    "$(@($s | Where-Object { $_.SessionID -ge 0 }).Count)|$(@($s | Where-Object { "$($_.ClientType)" -eq 'Background' }).Count)"
  }
  if ("$q".Trim() -ne '0|0') { throw "not quiescent (user|background sessions = $q)" }
}
Step verify_sha {
  if (-not (Test-Path $golden)) { throw "golden.bak not found: $golden" }
  $h = (Get-FileHash $golden -Algorithm SHA256).Hash.ToLower()
  if ($h -ne $lin.golden_sha256) { throw "golden.bak sha256 $h does not match the lineage" }
}
Step stop { Invoke-InContainer $Container { Stop-Service 'MicrosoftDynamicsNavServer$BC' } }
Step restore {
  Invoke-InContainer $Container { param($p)
    $files = Invoke-Sqlcmd -Query "RESTORE FILELISTONLY FROM DISK = '$p'"
    $cur = Invoke-Sqlcmd -Query "SELECT type_desc, physical_name FROM sys.master_files WHERE database_id = DB_ID('CRONUS')"
    $move = ($files | ForEach-Object {
        $kind = if ($_.Type -eq 'L') { 'LOG' } else { 'ROWS' }
        "MOVE '$($_.LogicalName)' TO '$(($cur | Where-Object type_desc -eq $kind | Select-Object -First 1).physical_name)'" }) -join ', '
    Invoke-Sqlcmd -QueryTimeout 0 -Query "ALTER DATABASE [CRONUS] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE [CRONUS] FROM DISK = '$p' WITH REPLACE, $move; ALTER DATABASE [CRONUS] SET MULTI_USER"
  } $golden
}
Step start { Invoke-InContainer $Container { Start-Service 'MicrosoftDynamicsNavServer$BC' } }
Step healthy {
  $deadline = (Get-Date).AddMinutes(10)
  $ok = $false
  while (-not $ok -and (Get-Date) -lt $deadline) {
    try {
      if ((docker inspect -f '{{.State.Health.Status}}' $Container) -eq 'healthy') {
        $r = Invoke-WebRequest "http://$Container/BC/?tenant=default" -MaximumRedirection 0 -SkipHttpErrorCheck -TimeoutSec 10 -ErrorAction SilentlyContinue
        if ($r -and $r.StatusCode -in 200, 301, 302) {
          $st = Invoke-InContainer $Container { (Get-NAVTenant -ServerInstance BC -Tenant default).State.ToString() }
          $ok = ("$st".Trim() -eq 'Operational')
        }
      }
    } catch { }
    if (-not $ok) { Start-Sleep -Seconds 2 }
  }
  if (-not $ok) { throw 'not healthy within 10 minutes' }
}
Step runner_verify {
  $r = $lin.runner
  $rows = Invoke-InContainer $Container { param($id)
    $p = (Invoke-Sqlcmd -Database CRONUS -Query "SELECT CONCAT(LOWER(CONVERT(varchar(36),[Package ID])),'|',[Version Major],'.',[Version Minor],'.',[Version Build],'.',[Version Revision]) AS r FROM [Published Application] WHERE [ID] = '$id'").r
    $i = (Invoke-Sqlcmd -Database CRONUS -Query "SELECT CONCAT(LOWER(CONVERT(varchar(36),[Package ID])),'|',[Version Major],'.',[Version Minor],'.',[Version Build],'.',[Version Revision]) AS r FROM [NAV App Installed App] WHERE [App ID] = '$id'").r
    "$p;$i"
  } $r.app_id
  $want = "$($r.package_id)|$($r.version)"
  if ("$rows".Trim() -ne "$want;$want") { throw "runner rows '$rows', expected published and installed '$want'" }
  $env = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="urn:microsoft-dynamics-schemas/codeunit/CGTestRunner"><soap:Body><t:RunTests><t:extensionId></t:extensionId><t:testCodeunitId>99999</t:testCodeunitId></t:RunTests></soap:Body></soap:Envelope>'
  $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($lin.soap_user):$($lin.soap_password)"))
  $url = "http://$($Container):7047/BC/ws/$([Uri]::EscapeDataString($Company))/Codeunit/CGTestRunner?tenant=default"
  $resp = Invoke-WebRequest $url -Method Post -Body $env -ContentType 'text/xml; charset=utf-8' -SkipHttpErrorCheck -TimeoutSec 120 `
    -Headers @{ SOAPAction = 'urn:microsoft-dynamics-schemas/codeunit/CGTestRunner:RunTests'; Authorization = "Basic $auth" }
  # the harness codeunit answers the empty no-op with a SOAP fault naming the filter: the runner is reachable and runs
  $okRunner = ($resp.StatusCode -eq 200) -or ("$($resp.Content)" -match 'no test methods found for the given filter')
  if (-not $okRunner) { throw "SOAP no-op HTTP $($resp.StatusCode): $("$($resp.Content)".Substring(0, [Math]::Min(200, "$($resp.Content)".Length)))" }
}
Step postconditions {
  $now = Get-GoldenInventory $Container
  $d = Compare-Object $storedInventory $now
  if ($d) { throw "inventory differs from the lineage ($(@($d).Count) lines), first: $(($d | Select-Object -First 1).InputObject)" }
  $st = Invoke-InContainer $Container { (Get-NAVTenant -ServerInstance BC -Tenant default).State.ToString() }
  if ("$st".Trim() -ne 'Operational') { throw "tenant $st" }
  $fp = Get-GoldenFingerprint $Container
  if ($fp -ne $lin.golden_fingerprint) { throw "subset fingerprint $fp does not match the lineage" }
  # H-35 S3 content root (complete values and LOBs) on every restore, when the lineage records one (owner: +~23 s).
  if ($lin.content_root) {
    $cr = $lin.content_root
    $exclude = @($cr.exclude | ForEach-Object { $_.pattern })
    $tables = @(Get-GoldenContentTables $Container)
    $root = Get-GoldenContentRoot $tables $exclude
    if ($root -ne $cr.root) {
      $stored = @{}
      foreach ($l in Get-Content (Join-Path (Split-Path -Parent $Lineage) $cr.path)) { $p = $l -split '\|', 2; $stored[$p[0]] = $p[1] }
      $live = @($tables | Where-Object { $t = $_.t; -not ($exclude | Where-Object { $t -like $_ }) })
      $diff = @($live | Where-Object { $stored[$_.t] -ne $_.h } | ForEach-Object { $_.t }) +
        @($stored.Keys | Where-Object { $k = $_; -not ($live | Where-Object { $_.t -eq $k }) })
      throw "content root $root does not match the lineage ($($diff.Count) table(s), first: $(($diff | Select-Object -First 3) -join ', '))"
    }
  }
}
Write-Output 'RESET_OK'
exit 0
