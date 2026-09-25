# SPIKE (throwaway): harness bench M0
param([Parameter(Mandatory)][ValidateSet('compile')][string]$Op, [Parameter(Mandatory)][string]$App)
$token = (Get-Content 'C:\cg-secrets\backend-token' -Raw).Trim()
$body = @{ app = $App } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri 'http://host.docker.internal:3200/compile' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
$r | ConvertTo-Json -Compress
if (-not $r.success) { exit 1 }
