# H-01 run 005: pi's harness-generated configuration, staged admin-owned.
# The harness runs this once per execution as ContainerAdministrator (docker
# exec, after its privilege check, before any credential or ready), so the
# agent (ContainerUser) never writes it. pi reads settings.json from its agent
# dir at every start and locks it by making a settings.json.lock directory
# beside it; C:\pi-agent (Dockerfile) therefore lets Users add subdirectories
# (their own, through CREATOR OWNER) but never create, replace or delete a file.
# Validates settings.pi_settings and the instructions bundle, refuses a
# non-empty agent dir, writes settings.json, AGENTS.md (when the bundle has
# one) and auth.json ({}) with an explicit ACL (SYSTEM and Administrators full,
# Users read/execute) owned by Administrators, then verifies the shape: any
# problem prints a [FAIL] line and exits 1.
# -VerifyOnly <dir> runs the check alone. -Dir, -Config and -Owner exist for
# the host tests; the harness passes none of them.
# Windows PowerShell 5.1: every text read names UTF-8.
param(
  [string]$VerifyOnly,
  [string]$Dir = 'C:\pi-agent',
  [string]$Config = 'C:\config',
  [string]$Owner = 'S-1-5-32-544'
)
$ErrorActionPreference = 'Stop'

# SYSTEM, Administrators, ContainerAdministrator, TrustedInstaller (as cg-lockdown).
$Admin = @(
  'S-1-5-18',
  'S-1-5-32-544',
  'S-1-5-93-2-1',
  'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
)
$CreatorOwner = 'S-1-3-0'
# WriteData, AppendData, WriteExtendedAttributes, DeleteSubdirectoriesAndFiles,
# WriteAttributes, Delete, ChangePermissions, TakeOwnership, GENERIC_ALL, GENERIC_WRITE.
$WriteMask = 0x2 -bor 0x4 -bor 0x10 -bor 0x40 -bor 0x100 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x10000000 -bor 0x40000000
# AppendData on a directory is AddSubdirectory: the one write right a
# non-admin may hold, on the directory itself only (never inherited).
$AddSubdirectory = 0x4

function Invoke-Icacls([string[]]$IcaclsArgs) {
  & icacls.exe @IcaclsArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ('icacls ' + ($IcaclsArgs -join ' ') + ' failed: ' + $LASTEXITCODE) }
}

function Problems($item, [bool]$isRoot) {
  $sidType = [System.Security.Principal.SecurityIdentifier]
  $p = $item.FullName
  # .NET, not Get-Acl: no module load (a pwsh 7 PSModulePath breaks it in Windows PowerShell).
  $acl = $item.GetAccessControl()
  $owner = $acl.GetOwner($sidType).Value
  if ($Admin -notcontains $owner) { '[FAIL] owner ' + $owner + ' ' + $p }
  foreach ($r in $acl.GetAccessRules($true, $true, $sidType)) {
    $sid = $r.IdentityReference.Value
    if ($r.AccessControlType -ne 'Allow' -or $Admin -contains $sid) { continue }
    $rights = [int64]$r.FileSystemRights
    if ($sid -eq $CreatorOwner) {
      # Applies only to what a user creates inside (its own lock dirs).
      if ($isRoot -and ($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and ($rights -band $WriteMask) -ne 0) {
        '[FAIL] creator owner not inherit-only ' + $p
      }
      continue
    }
    if ($isRoot) {
      if (($rights -band ($WriteMask -band (-bnot $AddSubdirectory))) -ne 0) { '[FAIL] write ' + $sid + ' ' + $p }
      if (($rights -band $AddSubdirectory) -ne 0 -and $r.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::None) {
        '[FAIL] inherited append ' + $sid + ' ' + $p
      }
    } elseif (($rights -band $WriteMask) -ne 0) {
      '[FAIL] write ' + $sid + ' ' + $p
    }
  }
}

function Test-Shape([string]$d) {
  $fails = @(Problems (Get-Item -LiteralPath $d -Force) $true)
  foreach ($i in @(Get-ChildItem -LiteralPath $d -Recurse -Force)) { $fails += @(Problems $i $false) }
  if ($fails.Count -gt 0) {
    $fails | ForEach-Object { [Console]::Out.WriteLine($_) }
    exit 1
  }
  [Console]::Out.WriteLine('[OK] cg-pi-stage: ' + $d + ' holds only admin-owned configuration')
  exit 0
}

if ($VerifyOnly) { Test-Shape $VerifyOnly }

$cfg = Get-Content (Join-Path $Config 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
# The recorded agent settings must disable billing outside message_end; never write null or partial settings.
$ps = $cfg.settings.pi_settings
if ($null -eq $ps -or $null -eq $ps.compaction -or -not (($ps.compaction.enabled -is [bool]) -and (-not $ps.compaction.enabled)) -or ($ps.cacheWarming -isnot [string]) -or ($ps.cacheWarming -cne 'off')) {
  [Console]::Error.WriteLine('[FAIL] settings.pi_settings must set compaction.enabled false and cacheWarming off')
  exit 4
}
$agents = $null
# Not $dir: PowerShell names are case-insensitive, and $Dir is the agent dir.
$bundle = Join-Path $Config 'bundle\instructions'
if (Test-Path $bundle) {
  $names = @(Get-ChildItem $bundle -File | ForEach-Object { $_.Name })
  $extra = @($names | Where-Object { $_ -notin @('AGENTS.md', 'CLAUDE.md') })
  if ($extra.Count -gt 0) { throw "instructions bundle holds unexpected files: $($extra -join ', ')" }
  if ($names -notcontains 'AGENTS.md') { throw 'pi instructions bundle must hold AGENTS.md' }
  if (($names -contains 'CLAUDE.md') -and ((Get-FileHash "$bundle\AGENTS.md").Hash -ne (Get-FileHash "$bundle\CLAUDE.md").Hash)) {
    throw 'AGENTS.md and CLAUDE.md differ: the parity rule needs byte-identical files'
  }
  $agents = [IO.File]::ReadAllBytes("$bundle\AGENTS.md")
}
# Runs once, before the agent: anything already in the agent dir refuses.
if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
  [Console]::Out.WriteLine('[FAIL] missing ' + $Dir)
  exit 1
}
$present = @(Get-ChildItem -LiteralPath $Dir -Force | ForEach-Object { $_.Name })
if ($present.Count -gt 0) {
  [Console]::Out.WriteLine('[FAIL] ' + $Dir + ' is not empty: ' + ($present -join ', '))
  exit 1
}
$utf8 = New-Object System.Text.UTF8Encoding $false
function Write-Locked([string]$name, [byte[]]$bytes) {
  $p = Join-Path $Dir $name
  [IO.File]::WriteAllBytes($p, $bytes)
  # Owner first, while the inherited ACL still grants the writer WRITE_OWNER.
  Invoke-Icacls @($p, '/setowner', ('*' + $Owner), '/Q')
  Invoke-Icacls @($p, '/inheritance:r', '/grant:r', '*S-1-5-18:F', '*S-1-5-32-544:F', '*S-1-5-32-545:RX', '/Q')
}
Write-Locked 'settings.json' $utf8.GetBytes((ConvertTo-Json -InputObject $ps -Depth 8))
if ($null -ne $agents) { Write-Locked 'AGENTS.md' $agents }
# pi creates auth.json (and an auth.json.lock) when it is missing.
Write-Locked 'auth.json' $utf8.GetBytes('{}')
Test-Shape $Dir
