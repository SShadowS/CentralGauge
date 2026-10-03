# H-01 run 004: make harness-owned files and trees read-only for the agent user.
# The servercore C:\ root grants Authenticated Users Modify, inherited by every
# root-COPYed file and every directory made under C:\, so ContainerUser could rewrite
# harness scripts and shims. For each path: inheritance off, an explicit ACL of
# SYSTEM and Administrators full control and Users read/execute; a directory's
# children are reset to inherit only that. Then every path (and everything under a
# directory) is checked: an owner outside the admin set, or any allow ACE giving a
# non-admin SID a write, delete, ACL or ownership right, prints a [FAIL] line and
# exits 1, so a wrong shape fails the image build.
# -VerifyOnly runs the check alone.
param(
  [switch]$VerifyOnly,
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$Path
)
$ErrorActionPreference = 'Stop'

# SYSTEM, Administrators, ContainerAdministrator, TrustedInstaller, CREATOR OWNER.
$Admin = @(
  'S-1-5-18',
  'S-1-5-32-544',
  'S-1-5-93-2-1',
  'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
)
$AdminAce = $Admin + 'S-1-3-0'
# WriteData, AppendData, WriteExtendedAttributes, DeleteSubdirectoriesAndFiles,
# WriteAttributes, Delete, ChangePermissions, TakeOwnership, GENERIC_ALL, GENERIC_WRITE.
$WriteMask = 0x2 -bor 0x4 -bor 0x10 -bor 0x40 -bor 0x100 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x10000000 -bor 0x40000000

function Invoke-Icacls([string[]]$IcaclsArgs) {
  & icacls.exe @IcaclsArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ('icacls ' + ($IcaclsArgs -join ' ') + ' failed: ' + $LASTEXITCODE) }
}

# H-01s: the DACL is rebuilt from scratch: protected (inherited ACEs dropped), every
# explicit ACE purged whatever its SID, then exactly SYSTEM F, Administrators F and
# Users RX. icacls /inheritance:r + /grant:r kept explicit ACEs of other SIDs (the
# servercore C:\ root shape put Authenticated Users Modify on C:\cg-al.ps1 and C:\Git).
# Only the Access section is read and written, so the owner is left as it is.
function Set-ThreeAces($item, [bool]$isDir) {
  $sidType = [System.Security.Principal.SecurityIdentifier]
  $acl = $item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($r in @($acl.GetAccessRules($true, $true, $sidType))) { $acl.PurgeAccessRules($r.IdentityReference) }
  $inherit = if ($isDir) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($g in @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier $g[0]
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $g[1], $inherit, 'None', 'Allow')))
  }
  $item.SetAccessControl($acl)
}

function Lock([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { throw ('cg-lockdown: missing ' + $p) }
  $item = Get-Item -LiteralPath $p -Force
  if ($item.PSIsContainer) {
    Set-ThreeAces $item $true
    # Children: explicit ACEs removed, inheritance on, so each inherits only the three.
    if (Get-ChildItem -LiteralPath $p -Force | Select-Object -First 1) {
      Invoke-Icacls @((Join-Path $p '*'), '/reset', '/T', '/Q')
    }
  } else {
    Set-ThreeAces $item $false
  }
}

function Problems($item) {
  $sidType = [System.Security.Principal.SecurityIdentifier]
  $p = $item.FullName
  # .NET, not Get-Acl: no module load (a pwsh 7 PSModulePath breaks it in Windows PowerShell).
  $acl = $item.GetAccessControl()
  $owner = $acl.GetOwner($sidType).Value
  if ($Admin -notcontains $owner) { '[FAIL] owner ' + $owner + ' ' + $p }
  foreach ($r in $acl.GetAccessRules($true, $true, $sidType)) {
    $sid = $r.IdentityReference.Value
    if ($r.AccessControlType -ne 'Allow' -or $AdminAce -contains $sid) { continue }
    if (([int64]$r.FileSystemRights -band $WriteMask) -ne 0) { '[FAIL] write ' + $sid + ' ' + $p }
  }
}

if (-not $VerifyOnly) { foreach ($p in $Path) { Lock $p } }
$fails = @()
$count = 0
foreach ($p in $Path) {
  $items = @(Get-Item -LiteralPath $p -Force)
  if ($items[0].PSIsContainer) { $items += @(Get-ChildItem -LiteralPath $p -Recurse -Force) }
  foreach ($i in $items) {
    $count++
    $fails += @(Problems $i)
  }
}
if ($fails.Count -gt 0) {
  $fails | ForEach-Object { [Console]::Out.WriteLine($_) }
  exit 1
}
[Console]::Out.WriteLine('[OK] cg-lockdown: ' + $count + ' entries read-only for non-admins')
exit 0
