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

# H-01t: a FRESH security object, never the existing DACL edited: protected (no
# inherited ACEs) with exactly SYSTEM F, Administrators F and Users RX (OI|CI on
# directories). Whatever the old DACL held (explicit ACEs of any SID, callback or
# conditional ACEs that rule enumeration may not show) is replaced wholesale. Only the
# Access section is written (a fresh object has no owner set), so the owner is kept.
function Set-ThreeAces($item, [bool]$isDir) {
  $sec = if ($isDir) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
  $sec.SetAccessRuleProtection($true, $false)
  $inherit = if ($isDir) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($g in @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier $g[0]
    $sec.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $g[1], $inherit, 'None', 'Allow')))
  }
  $item.SetAccessControl($sec)
}

# H-01t: every entry of a supplied path, depth first, never descending into a reparse
# point (junction, symlink, mount point): the walk itself does not follow links.
function Get-Tree($item) {
  $item
  # A type check, not PSIsContainer: .NET children carry no provider properties.
  if ($item -is [System.IO.DirectoryInfo] -and -not (Test-Reparse $item)) {
    foreach ($c in $item.EnumerateFileSystemInfos()) { Get-Tree $c }
  }
}
function Test-Reparse($item) {
  ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
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
  # H-01t: the raw DACL, every ACE: anything but a plain allow or deny ACE (a
  # callback or conditional ACE, an object ACE, an unknown type) is not understood
  # and fails closed, as does a missing DACL (everyone full control).
  $raw = New-Object System.Security.AccessControl.RawSecurityDescriptor -ArgumentList @($acl.GetSecurityDescriptorBinaryForm(), 0)
  if ($null -eq $raw.DiscretionaryAcl) { '[FAIL] null-dacl ' + $p }
  else {
    foreach ($a in $raw.DiscretionaryAcl) {
      $plain = ($a -is [System.Security.AccessControl.CommonAce]) -and -not $a.IsCallback -and
        ($a.AceType -eq [System.Security.AccessControl.AceType]::AccessAllowed -or $a.AceType -eq [System.Security.AccessControl.AceType]::AccessDenied)
      if (-not $plain) {
        $who = if ($a -is [System.Security.AccessControl.KnownAce]) { [string]$a.SecurityIdentifier } else { '?' }
        '[FAIL] ace ' + $a.AceType + ' ' + $who + ' ' + $p
      }
    }
  }
  if (Test-Reparse $item) { '[FAIL] reparse ' + $p }
}

# H-01t: a reparse point anywhere under a supplied path refuses the whole run before
# any ACL changes (no icacls /T through a link).
if (-not $VerifyOnly) {
  foreach ($p in $Path) {
    if (-not (Test-Path -LiteralPath $p)) { throw ('cg-lockdown: missing ' + $p) }
    foreach ($i in @(Get-Tree (Get-Item -LiteralPath $p -Force))) {
      if (Test-Reparse $i) { throw ('cg-lockdown: reparse point ' + $i.FullName + ' under ' + $p + ': refused, nothing changed') }
    }
  }
  foreach ($p in $Path) { Lock $p }
}
$fails = @()
$count = 0
foreach ($p in $Path) {
  foreach ($i in @(Get-Tree (Get-Item -LiteralPath $p -Force))) {
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
