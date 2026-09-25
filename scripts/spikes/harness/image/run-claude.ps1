# SPIKE (throwaway): harness bench M0
param([Parameter(Mandatory)][string]$Model, [string]$McpConfig = "")
$ErrorActionPreference = 'Stop'
$token = (Get-Content 'C:\cg-secrets\claude-oauth-token' -Raw).Trim()
if (-not $token -or $token -like 'REPLACE_ME*') { throw 'claude-oauth-token is missing or a placeholder' }
$env:CLAUDE_CODE_OAUTH_TOKEN = $token
$env:CLAUDE_CODE_GIT_BASH_PATH = 'C:\Git\bin\bash.exe'
$prompt = Get-Content 'C:\task\prompt.md' -Raw
$claudeArgs = @('-p', $prompt, '--output-format', 'stream-json', '--verbose', '--model', $Model, '--dangerously-skip-permissions')
if ($McpConfig) { $claudeArgs += @('--mcp-config', $McpConfig) }
Set-Location C:\workspace
& claude @claudeArgs
exit $LASTEXITCODE
