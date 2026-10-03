# pi entrypoint (spec 1a section 5 item 3; findings sections 3 and 4; M1-33
# credential release). Waits for the runner's ready file, points pi at its
# agent directory (settings staged by the harness), writes our cg_entry record, then runs
# pi 0.87.1 in JSON mode with the prompt on stdin. This script never reads the
# provider key: the budget guard (-e C:\cg-budget.ts) is its only holder.
# Windows PowerShell 5.1: every text read names UTF-8.
$ErrorActionPreference = 'Stop'
# H-01: first, before any config, secret or ready read; any non-zero exits 86.
& 'C:\cg-nonadmin.ps1'
if ($LASTEXITCODE -ne 0) { exit 86 }
$utf8 = New-Object System.Text.UTF8Encoding $false
$global:OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$cfg = Get-Content 'C:\config\settings.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$budget = [double]$cfg.limits.max_budget_usd
# The recorded agent settings must disable billing outside message_end; never write null or partial settings.
$ps = $cfg.settings.pi_settings
if ($null -eq $ps -or $null -eq $ps.compaction -or -not (($ps.compaction.enabled -is [bool]) -and (-not $ps.compaction.enabled)) -or ($ps.cacheWarming -isnot [string]) -or ($ps.cacheWarming -cne 'off')) {
  [Console]::Error.WriteLine('[FAIL] settings.pi_settings must set compaction.enabled false and cacheWarming off')
  exit 4
}
function Write-NotReady {
  $entry = @{ type = 'cg_entry'; pi_version = ''; max_budget_usd = $budget; ready = $false }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $entry -Compress))
  exit 3
}
$timeout = 600
if ($null -ne $env:CG_READY_TIMEOUT_S) {
  $timeout = 0
  if (-not [int]::TryParse($env:CG_READY_TIMEOUT_S, [ref]$timeout) -or $timeout -le 0) {
    [Console]::Error.WriteLine('[FAIL] CG_READY_TIMEOUT_S must be a positive integer')
    Write-NotReady
  }
}
$sw = [Diagnostics.Stopwatch]::StartNew()
while (-not (Test-Path 'C:\cg-secrets\ready')) {
  if ($sw.Elapsed.TotalSeconds -ge $timeout) { Write-NotReady }
  Start-Sleep -Milliseconds 500
}
# A placed cell (M1-33d): the proxy URL carries this execution's credential,
# so it is set here, in this process only, never by docker -e (the argv and
# docker inspect never hold it). No file (not placed): no proxy.
if (Test-Path 'C:\cg-secrets\proxy-credential') {
  $proxyCred = (Get-Content 'C:\cg-secrets\proxy-credential' -Raw -Encoding UTF8).Trim()
  $env:HTTPS_PROXY = "http://$proxyCred@172.30.60.1:3128"
  $env:HTTP_PROXY = $env:HTTPS_PROXY
  Remove-Variable proxyCred
}
$env:PI_CODING_AGENT_DIR = 'C:\pi-agent'
# H-01 run 005: settings.json, the instructions and auth.json were validated and
# staged admin-owned by the harness (C:\cg-pi-stage.ps1) before ready; the agent
# user only reads them.
if (-not (Test-Path -LiteralPath "$env:PI_CODING_AGENT_DIR\settings.json" -PathType Leaf)) {
  [Console]::Error.WriteLine('[FAIL] C:\pi-agent\settings.json was not staged by the harness')
  exit 5
}
$env:PI_OFFLINE = '1'
$env:CG_MAX_BUDGET_USD = [string]$budget
$version = (& pi --version | Out-String).Trim()
$entry = @{ type = 'cg_entry'; pi_version = $version; max_budget_usd = $budget; ready = $true }
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $entry -Compress))
$piArgs = @('--mode', 'json', '--no-session', '--offline', '--no-approve', '--no-extensions', '-e', 'C:\cg-budget.ts', '--no-skills', '--no-prompt-templates', '--no-themes')
if (Test-Path 'C:\config\bundle\skills') { $piArgs += @('--skill', 'C:\config\bundle\skills') }
if ($cfg.settings.thinking) { $piArgs += @('--thinking', $cfg.settings.thinking) }
$piArgs += @('--provider', $cfg.settings.provider, '--model', $cfg.settings.api_models.main)
Set-Location C:\workspace
Get-Content 'C:\task\prompt.md' -Raw -Encoding UTF8 | & pi @piArgs
exit $LASTEXITCODE
