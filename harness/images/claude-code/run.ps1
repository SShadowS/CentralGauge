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
  $instructions = @(Get-ChildItem 'C:\config\bundle\instructions' -File)
  if ($instructions.Count -ne 1) { throw "bundle instructions must hold exactly one file, found $($instructions.Count)" }
  Copy-Item -LiteralPath $instructions[0].FullName -Destination "$userHome\.claude\CLAUDE.md" -Force
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
$claudeArgs = @('-p', '--output-format', 'stream-json', '--verbose', '--model', $cfg.settings.api_models.main, '--dangerously-skip-permissions', '--max-budget-usd', $cfg.limits.max_budget_usd)
Set-Location C:\workspace
$prompt | & claude @claudeArgs
exit $LASTEXITCODE
