# SPIKE (throwaway): harness bench M0
param([Parameter(Mandatory)][string]$Provider, [Parameter(Mandatory)][string]$Model, [string]$KeyFile = 'openrouter-api-key')
$ErrorActionPreference = 'Stop'
$key = (Get-Content "C:\cg-secrets\$KeyFile" -Raw).Trim()
if (-not $key -or $key -like 'REPLACE_ME*') { throw "$KeyFile is missing or a placeholder" }
$prompt = Get-Content 'C:\task\prompt.md' -Raw
Set-Location C:\workspace
& pi --mode json --no-session -a --provider $Provider --model $Model --api-key $key $prompt
exit $LASTEXITCODE
