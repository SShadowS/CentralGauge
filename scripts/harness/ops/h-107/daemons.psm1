# H-107 daemon registry: H:\cg-coord\daemons.tsv lists every process meant to outlive its Claude session.
# Works in Windows PowerShell 5.1 and pwsh 7. Import: Import-Module H:\cg-coord\jobs\daemons\daemons.psm1
#
# Format: UTF-8 text, one row per daemon, tab-separated, lines starting with "#" are comments:
#   pid  start_utc  script  owner  purpose  max_hours  stop_file
#   pid        Windows process id of the top-level process (the one Start-Process returned).
#   start_utc  its creation time, yyyy-MM-ddTHH:mm:ss.fffZ (Win32_Process.CreationDate), so a reused pid
#              never matches a row. A process matches a row only when both pid and start_utc match.
#   script     the script it runs (Windows path).
#   owner      owning lane or session (ops, orchestrator, ...).
#   purpose    a short text (no tabs).
#   max_hours  a number, or "none" for a host daemon that runs until stopped.
#   stop_file  the file that makes it exit by itself (Windows path), or "none".
# Every write takes daemons.tsv.lock (exclusive create; a lock older than 60 s is broken, since writers
# hold it for milliseconds), writes daemons.tsv.tmp-<pid>, then renames it over daemons.tsv.
$script:Registry = 'H:\cg-coord\daemons.tsv'
$script:Cols = 'pid', 'start_utc', 'script', 'owner', 'purpose', 'max_hours', 'stop_file'

function Get-ProcStartUtc([int]$ProcessId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

function Read-Daemons([string]$Path = $script:Registry) {
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*(#|$)') { continue }
    $f = $line -split "`t"
    if ($f.Count -ne $script:Cols.Count) { Write-Warning "daemons.tsv: malformed row skipped: $line"; continue }
    $o = [ordered]@{}; for ($i = 0; $i -lt $f.Count; $i++) { $o[$script:Cols[$i]] = $f[$i] }
    [pscustomobject]$o
  }
}

function Use-RegistryLock([string]$Path, [scriptblock]$Body) {
  $lock = "$Path.lock"; $fs = $null
  for ($i = 0; $i -lt 100 -and -not $fs; $i++) {
    try { $fs = [IO.File]::Open($lock, 'CreateNew', 'Write', 'None') }
    catch {
      $age = try { ((Get-Date) - (Get-Item -LiteralPath $lock -ErrorAction Stop).LastWriteTime).TotalSeconds } catch { 0 }
      if ($age -gt 60) { Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Milliseconds 100
    }
  }
  if (-not $fs) { throw "daemons registry: could not take $lock" }
  try { & $Body } finally { $fs.Dispose(); Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue }
}

function Write-Daemons($Rows, [string]$Path) {
  $tmp = "$Path.tmp-$PID"
  $lines = @("# H-107 daemon registry; format: H:\cg-coord\jobs\daemons\daemons.psm1 header. Edit only through it.",
    ("# " + ($script:Cols -join "`t")))
  foreach ($r in $Rows) { $lines += (($script:Cols | ForEach-Object { [string]$r.$_ }) -join "`t") }
  [IO.File]::WriteAllLines($tmp, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
  if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($tmp, $Path, [NullString]::Value) } else { [IO.File]::Move($tmp, $Path) }
}

function Register-Daemon {
  param([Parameter(Mandatory)][int]$ProcessId, [Parameter(Mandatory)][string]$Script,
    [Parameter(Mandatory)][string]$Owner, [Parameter(Mandatory)][string]$Purpose,
    [string]$MaxHours = 'none', [string]$StopFile = 'none', [string]$StartUtc, [string]$Path = $script:Registry)
  if (-not $StartUtc) { $StartUtc = Get-ProcStartUtc $ProcessId }
  if (-not $StartUtc) { throw "Register-Daemon: no live process $ProcessId" }
  foreach ($v in $Script, $Owner, $Purpose, $MaxHours, $StopFile) { if ($v -match "[`t`r`n]") { throw "Register-Daemon: tab or newline in '$v'" } }
  if ($MaxHours -ne 'none' -and $MaxHours -notmatch '^\d+(\.\d+)?$') { throw "Register-Daemon: max_hours '$MaxHours'" }
  Use-RegistryLock $Path {
    $rows = @(Read-Daemons $Path | Where-Object { -not ($_.pid -eq "$ProcessId" -and $_.start_utc -eq $StartUtc) })
    $rows += [pscustomobject][ordered]@{ pid = "$ProcessId"; start_utc = $StartUtc; script = $Script; owner = $Owner
      purpose = $Purpose; max_hours = $MaxHours; stop_file = $StopFile }
    Write-Daemons $rows $Path
  }
}

function Unregister-Daemon {
  param([Parameter(Mandatory)][int]$ProcessId, [string]$StartUtc, [string]$Path = $script:Registry)
  Use-RegistryLock $Path {
    $rows = @(Read-Daemons $Path)
    $keep = @($rows | Where-Object { -not ($_.pid -eq "$ProcessId" -and (-not $StartUtc -or $_.start_utc -eq $StartUtc)) })
    if ($keep.Count -ne $rows.Count) { Write-Daemons $keep $Path }
  }
}

Export-ModuleMember -Function Get-ProcStartUtc, Read-Daemons, Register-Daemon, Unregister-Daemon
