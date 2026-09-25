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
Set-Location C:\workspace
$prompt | & claude @claudeArgs
exit $LASTEXITCODE
