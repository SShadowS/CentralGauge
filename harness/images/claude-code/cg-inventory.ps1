# Component inventory (Harness v2 spec section 4, feasibility gate 1). run.ps1 calls it after
# the bundle copies, before any credential is read and before claude starts. It proves every
# staged component (C:\config\bundle, hashed by the runner in writeConfigDir) is installed byte
# for byte under ~/.claude, and that nothing undeclared sits in a scope Claude Code reads: the
# user scope, the workspace (recursively), its ancestors, the managed-settings folder.
# One JSON line on stdout (UTF-8, no BOM), nothing else; errors go to stderr:
#   {"type":"cg_inventory","v":1,"ok":true|false,"installed":[...],"problems":[...]}
# Exit 0 when ok, 5 when refused; an unexpected error exits non-zero with no record.
# The parameters exist for the host tests; run.ps1 passes none. Windows PowerShell 5.1.
# Files are compared by SHA256 of their bytes, so no text read (and no encoding guess) happens.
param(
  [string]$ConfigDir = 'C:\config',
  [string]$HomeDir = $env:USERPROFILE,
  [string]$Workspace = 'C:\workspace',
  [string]$Ancestors = 'C:\',
  [string]$ManagedDir = 'C:\Program Files\ClaudeCode'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$problems = New-Object System.Collections.Generic.List[string]

# Every file under $root (hidden ones too): relative path with forward slashes -> SHA256.
# .NET hashing, not Get-FileHash: that cmdlet autoloads Microsoft.PowerShell.Utility, which
# fails when a PowerShell 7 parent leaks its PSModulePath into powershell.exe.
$sha = [System.Security.Cryptography.SHA256]::Create()
function Get-Tree([string]$root) {
  $tree = @{}
  if (-not (Test-Path -LiteralPath $root)) { return $tree }
  $base = (Get-Item -LiteralPath $root -Force).FullName.TrimEnd('\') + '\'
  foreach ($f in @(Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
    $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($f.FullName)))
    $tree[$f.FullName.Substring($base.Length).Replace('\', '/')] = $hash
  }
  return $tree
}

# Expected user-scope tree: destination (relative to ~/.claude) -> hash, and its component.
$bundle = Join-Path $ConfigDir 'bundle'
$want = @{}
$owner = @{}
$staged = @()
if (Test-Path -LiteralPath $bundle) {
  $staged = @(Get-ChildItem -LiteralPath $bundle -Force | ForEach-Object { $_.Name } | Sort-Object)
}
foreach ($name in $staged) {
  if (@('instructions', 'skills', 'agents') -cnotcontains $name) {
    $problems.Add("$name is staged but this image cannot install it")
    continue
  }
  $tree = Get-Tree (Join-Path $bundle $name)
  if ($tree.Count -eq 0) { $problems.Add("$name is staged but empty"); continue }
  foreach ($k in @($tree.Keys | Sort-Object)) {
    $dest = $null
    if ($name -cne 'instructions') { $dest = "$name/$k" }
    elseif ($k -ceq 'CLAUDE.md' -or $k.StartsWith('rules/')) { $dest = $k }
    elseif ($k -cne 'AGENTS.md') { $problems.Add("instructions: $k is staged but not installable") }
    if ($null -ne $dest) { $want[$dest] = $tree[$k]; $owner[$dest] = $name }
  }
}

# Positive and negative at user scope in one comparison.
$have = Get-Tree (Join-Path $HomeDir '.claude')
$broken = @{}
foreach ($k in @($want.Keys | Sort-Object)) {
  if (-not $have.ContainsKey($k)) {
    $problems.Add("$($owner[$k]): $k is staged but not installed"); $broken[$owner[$k]] = $true
  } elseif ($have[$k] -ne $want[$k]) {
    $problems.Add("$($owner[$k]): $k differs from the staged copy"); $broken[$owner[$k]] = $true
  }
}
foreach ($k in @($have.Keys | Sort-Object)) {
  if (-not $want.ContainsKey($k)) { $problems.Add("undeclared file in the user scope: .claude/$k") }
}
$userConfig = Join-Path $HomeDir '.claude.json'
if (Test-Path -LiteralPath $userConfig) { $problems.Add("undeclared user config present: $userConfig") }

# Project scope: the workspace recursively (nested memory loads lazily), its ancestors directly.
$scoped = @('CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude', '.mcp.json')
foreach ($e in @(Get-ChildItem -LiteralPath $Workspace -Recurse -Force | Where-Object { $scoped -contains $_.Name })) {
  $problems.Add("undeclared project-scope entry: $($e.FullName)")
}
foreach ($dir in @($Ancestors.Split(';') | Where-Object { $_ })) {
  foreach ($n in $scoped) {
    $p = Join-Path $dir $n
    if (Test-Path -LiteralPath $p) { $problems.Add("undeclared project-scope entry: $p") }
  }
}
if (Test-Path -LiteralPath $ManagedDir) { $problems.Add("managed Claude Code settings present: $ManagedDir") }

# @() at every array site: PowerShell 5.1 would otherwise emit a one-element array as a bare
# string and an empty pipeline as null.
$installed = @($owner.Values | Sort-Object -Unique | Where-Object { -not $broken.ContainsKey($_) })
$ok = $problems.Count -eq 0
$rec = [ordered]@{ type = 'cg_inventory'; v = 1; ok = $ok; installed = @($installed); problems = @($problems) }
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $rec -Compress -Depth 3))
if ($ok) { exit 0 }
exit 5
