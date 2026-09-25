$ErrorActionPreference = 'Continue'
function Call($label, [string[]]$a) {
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File C:\cg-al.ps1 @a
  Write-Output (ConvertTo-Json -Compress -InputObject @{ label = $label; exit = $LASTEXITCODE; out = "$o" })
}
function Raw($label, $path, $body, $exec) {
  $token = (Get-Content C:\cg-secrets\backend-token -Raw).Trim()
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($env:CG_BACKEND_URL)$path" `
      -Headers @{ Authorization = "Bearer $token"; 'X-CG-Execution' = $exec } -ContentType 'application/json' -Body $body -TimeoutSec 60
    $s = [int]$r.StatusCode
  } catch [System.Net.WebException] { $s = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 } }
  Write-Output (ConvertTo-Json -Compress -InputObject @{ label = $label; status = $s })
}
Call 'compile' @('compile')
Call 'test' @('test')
Call 'symbols' @('symbols')
Raw 'other-execution' '/v1/symbols' '{}' '00000000-0000-4000-8000-000000000000'
Raw 'oracle-path' '/v1/oracle' '{}' $env:CG_EXECUTION_ID
Raw 'list-apps' '/v1/apps' '{}' $env:CG_EXECUTION_ID
Raw 'traversal' '/v1/compile' '{"apps":["..\\Rental"]}' $env:CG_EXECUTION_ID
Raw 'hidden-codeunit' '/v1/test' '{"codeunits":[85001]}' $env:CG_EXECUTION_ID
Raw 'malformed' '/v1/compile' '{"apps":' $env:CG_EXECUTION_ID
