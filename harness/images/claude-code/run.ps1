# Claude Code entrypoint (D9): translate C:\config to native config, run
# non-interactively, stream-json to stdout. The OAuth token is read from the
# read-only secrets mount and passed to the claude process as env only.
# Windows PowerShell 5.1: every text read names UTF-8 (the default is ANSI),
# bundle files are copied byte for byte, and the prompt goes to claude on
# stdin (native argument quoting drops embedded double quotes and a .cmd shim
# can cut an argument at a newline).
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$global:OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$cfg = Get-Content 'C:\config\settings.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$userHome = $env:USERPROFILE
New-Item -ItemType Directory -Force -Path "$userHome\.claude" | Out-Null
# MCP components (settings.mcp, set only from components.mcp): validated before
# anything runs. mcp.json holds the non-secret backend env only; the server
# reads the backend token from C:\cg-secrets itself.
$mcpArgs = @()
if ($null -ne $cfg.settings.PSObject.Properties['mcp']) {
  $mcp = $cfg.settings.mcp
  if (-not ($mcp -is [array]) -or $mcp.Count -eq 0 -or @($mcp | Select-Object -Unique).Count -ne $mcp.Count -or @($mcp | Where-Object { $_ -cne 'al-tools' }).Count -gt 0) {
    [Console]::Error.WriteLine('[FAIL] settings.mcp must be a non-empty list of known MCP components (al-tools)')
    exit 4
  }
  if ([string]::IsNullOrEmpty($env:CG_BACKEND_URL) -or [string]::IsNullOrEmpty($env:CG_EXECUTION_ID)) {
    [Console]::Error.WriteLine('[FAIL] MCP components need CG_BACKEND_URL and CG_EXECUTION_ID')
    exit 4
  }
  $servers = @{}
  foreach ($name in $mcp) {
    $servers[$name] = @{ type = 'stdio'; command = 'node'; args = @('C:\al-tools-mcp.mjs');
      env = @{ CG_BACKEND_URL = $env:CG_BACKEND_URL; CG_EXECUTION_ID = $env:CG_EXECUTION_ID } }
  }
  $mcpPath = "$userHome\mcp.json"
  [IO.File]::WriteAllText($mcpPath, (ConvertTo-Json -InputObject @{ mcpServers = $servers } -Depth 6), $utf8)
  $mcpArgs = @('--mcp-config', $mcpPath, '--strict-mcp-config')
}
if (Test-Path 'C:\config\bundle\instructions') {
  $dir = 'C:\config\bundle\instructions'
  $names = @(Get-ChildItem $dir -File | ForEach-Object { $_.Name })
  $extra = @($names | Where-Object { $_ -notin @('AGENTS.md', 'CLAUDE.md') })
  if ($extra.Count -gt 0) { throw "instructions bundle holds unexpected files: $($extra -join ', ')" }
  if ($names -notcontains 'CLAUDE.md') { throw 'Claude Code instructions bundle must hold CLAUDE.md' }
  if (($names -contains 'AGENTS.md') -and ((Get-FileHash "$dir\AGENTS.md").Hash -ne (Get-FileHash "$dir\CLAUDE.md").Hash)) {
    throw 'AGENTS.md and CLAUDE.md differ: the parity rule needs byte-identical files'
  }
  Copy-Item -LiteralPath "$dir\CLAUDE.md" -Destination "$userHome\.claude\CLAUDE.md" -Force
}
if (Test-Path 'C:\config\bundle\skills') {
  Copy-Item 'C:\config\bundle\skills' "$userHome\.claude\skills" -Recurse -Force
}
$env:CLAUDE_CODE_OAUTH_TOKEN = (Get-Content 'C:\cg-secrets\claude-oauth-token' -Raw -Encoding UTF8).Trim()
$env:CLAUDE_CODE_GIT_BASH_PATH = 'C:\Git\bin\bash.exe'
$env:DISABLE_TELEMETRY = '1'
$env:DISABLE_ERROR_REPORTING = '1'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
$prompt = Get-Content 'C:\task\prompt.md' -Raw -Encoding UTF8
# Session-control tools the manifest disallows (settings.native.disallowed_tools, M1-32b).
if (-not $cfg.settings.disallowed_tools) { throw 'settings.disallowed_tools missing from C:\config\settings.json' }
$claudeArgs = @('-p', '--output-format', 'stream-json', '--verbose', '--model', $cfg.settings.api_models.main, '--dangerously-skip-permissions', '--max-budget-usd', $cfg.limits.max_budget_usd, '--disallowedTools', ($cfg.settings.disallowed_tools -join ','))
$claudeArgs += $mcpArgs
Set-Location C:\workspace
$prompt | & claude @claudeArgs
exit $LASTEXITCODE
