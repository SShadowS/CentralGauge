# cg-al: thin client for the Harness Bench backend (spec 1a section 5 item 4).
# Usage: cg-al compile [App ...] | cg-al test [codeunit ...] | cg-al symbols | cg-al --version
# The token is read from a file (never argv, never env). CG_BACKEND_URL and
# CG_EXECUTION_ID are non-secret env vars set by the runner.
# Exit codes (by backend status):
#   0  200 and ok
#   1  the agent's fault: 200 not ok (compile/test failed, violations), or a
#      request the agent caused to be refused: 400 (bad JSON, unknown app,
#      non-runnable codeunit), 404, 413 (body too large), 422 (workspace over
#      the limits), 429 (a second concurrent request), 409 (the workspace
#      changed while it was snapshotted: retry)
#   2  environment/infra: no response, 408, 5xx, backend token unavailable
#   3  401 unauthorized
#   64 usage
param(
  [Parameter(Position = 0)][string]$Op,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
if ($Op -eq '--version') { Write-Output '{"cg_al":"1"}'; exit 0 }
if ($Op -notin @('compile', 'test', 'symbols')) {
  [Console]::Error.WriteLine('usage: cg-al compile [App ...] | test [codeunit ...] | symbols')
  exit 64
}
$secrets = if ($env:CG_SECRETS_DIR) { $env:CG_SECRETS_DIR } else { 'C:\cg-secrets' }
$Rest = @($Rest | Where-Object { $_ })
$codeunits = @()
if ($Op -eq 'test') {
  foreach ($a in $Rest) {
    $n = 0
    if (-not [int]::TryParse($a, [ref]$n)) {
      [Console]::Error.WriteLine("usage: cg-al test [codeunit ...] (not a codeunit number: $a)")
      exit 64
    }
    $codeunits += $n
  }
}
# A missing or unreadable token is the environment's fault (2), never the agent's code (1).
try {
  $token = (Get-Content (Join-Path $secrets 'backend-token') -Raw -ErrorAction Stop).Trim()
} catch {
  Write-Output (ConvertTo-Json -InputObject @{ op = $Op; error = 'backend token unavailable' } -Compress)
  exit 2
}
$body = switch ($Op) {
  'compile' { @{ apps = @($Rest) } }
  'test' { @{ codeunits = @($codeunits) } }
  default { @{} }
}
$json = ConvertTo-Json -InputObject $body -Compress -Depth 4
$status = 0
$content = ''
try {
  $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($env:CG_BACKEND_URL)/v1/$Op" `
    -Headers @{ Authorization = "Bearer $token"; 'X-CG-Execution' = $env:CG_EXECUTION_ID } `
    -ContentType 'application/json' -Body $json -TimeoutSec 1800
  $status = [int]$r.StatusCode
  $content = $r.Content
} catch [System.Net.WebException] {
  $resp = $_.Exception.Response
  if ($null -eq $resp) {
    $content = ConvertTo-Json -InputObject @{ error = $_.Exception.Message } -Compress
  } else {
    $status = [int]$resp.StatusCode
    $content = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
  }
}
$result = $content
try { $result = $content | ConvertFrom-Json } catch { }
$out = @{ op = $Op; client = @{ script_ms = [int]$sw.ElapsedMilliseconds; status = $status }; result = $result }
Write-Output (ConvertTo-Json -InputObject $out -Compress -Depth 12)
if ($status -eq 200 -and $result.ok) { exit 0 }
if ($status -eq 200) { exit 1 }
if ($status -eq 401) { exit 3 }
if ($status -in @(400, 404, 409, 413, 422, 429)) { exit 1 }
exit 2
