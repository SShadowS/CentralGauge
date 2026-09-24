# Harness Bench watchdog. Read-only: reports stale runs, stale leases and open questions
# to the owner with a Windows message. Never changes coord state, never resumes a session.
# Scheduled every 15 minutes by the start sheet (docs/superpowers/runbooks/harness-autonomy/start-sheet.md).
param(
  [string]$CoordRoot = 'H:\cg-coord',
  [string]$Repo = 'U:\Git\CentralGauge'
)
$ErrorActionPreference = 'Stop'
$env:CG_COORD_ROOT = $CoordRoot
$coord = Join-Path $Repo 'scripts\coord\coord.ts'
$log = Join-Path $CoordRoot 'watchdog.log'
$state = Join-Path $CoordRoot 'watchdog-last.txt'

try {
  $stale = (& deno run --allow-all $coord stale 2>&1 | Out-String).Trim()
  $questions = (& deno run --allow-all $coord questions 2>&1 | ConvertFrom-Json)
} catch {
  $msg = "Harness watchdog: coord failed: $($_.Exception.Message)"
  Add-Content $log "$(Get-Date -Format s) $msg"
  & msg.exe $env:USERNAME /TIME:0 $msg
  exit 1
}

$lines = @()
if ($stale -and $stale -ne '(nothing stale)') { $lines += "STALE:`n$stale" }
if ($questions.Count -gt 0) {
  $lines += "OPEN QUESTIONS ($($questions.Count)):"
  foreach ($q in $questions) { $lines += "- $($q.id): $(($q.text -split "`n")[0])" }
}
$text = $lines -join "`n"
Add-Content $log "$(Get-Date -Format s) $(if ($text) { $text -replace "`n", ' | ' } else { 'ok' })"

# Only notify when something changed since the last notification.
$previous = if (Test-Path $state) { Get-Content $state -Raw } else { '' }
if ($text -and $text -ne $previous.Trim()) {
  & msg.exe $env:USERNAME /TIME:0 "Harness Bench needs attention:`n$text"
}
Set-Content $state $text
