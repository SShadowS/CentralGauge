# H-03: install the @anthropic-ai/claude-code release `harness images build` resolved from the npm
# registry (dist-tag latest): the main package and its win32-x64 platform package, each verified
# against the registry's dist.integrity (sha512) before anything is installed. Only those two
# verified archives are installed: npm runs offline with --ignore-scripts (install.cjs, or any other
# lifecycle script, never runs; npm cannot fetch), and if npm fails the same two files are installed
# with tar.exe. Never a re-download, never online npm. The claude.exe hash expected everywhere is
# taken from the verified platform archive before the install; the postconditions are the same for
# both paths. Build time only (ContainerAdministrator); cg-lockdown makes C:\cg-npm read-only.
# -LibOnly defines the functions and stops (host tests dot-source it; nothing is installed).
param(
  [switch]$LibOnly,
  [string]$Version,
  [string]$MainUrl,
  [string]$MainIntegrity,
  [string]$WinUrl,
  [string]$WinIntegrity
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Saves the exact bytes on the wire; one deadline covers headers and body, and the bytes reach $out
# only after the hash check: a wrong or broken download leaves no file (install-lsp.ps1's pattern).
function Get-Pinned($pin, [string]$out, [int]$timeoutSec = 900) {
  Add-Type -AssemblyName System.Net.Http
  $part = $out + '.part'
  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSec)
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AutomaticDecompression = [Net.DecompressionMethods]::None
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds($timeoutSec)
  try {
    $r = $client.GetAsync($pin.url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    try {
      [void]$r.EnsureSuccessStatusCode()
      $f = [IO.File]::Create($part)
      try {
        $copy = $r.Content.CopyToAsync($f)
        $left = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if (-not $copy.Wait($left)) { throw ('download of ' + $pin.url + ' timed out after ' + $timeoutSec + ' s') }
      } finally { $r.Dispose(); $f.Close() } # dispose first: it aborts a stalled copy before the file closes
    } finally { $r.Dispose() }
    $got = (Get-FileHash -LiteralPath $part -Algorithm $pin.algorithm).Hash.ToLowerInvariant()
    if ($got -ne $pin.hash) { throw ('hash mismatch for ' + $pin.url + ': got ' + $got) }
    Move-Item -LiteralPath $part -Destination $out
  } finally {
    $client.Dispose()
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
  }
}

# An npm dist.integrity (sha512-<base64 of 64 bytes>) as the lowercase hex Get-FileHash reports.
function ConvertFrom-Sri([string]$sri) {
  if ($sri -cnotmatch '^sha512-[A-Za-z0-9+/]{86}==\z') { throw ('integrity must be sha512-<base64>, got: ' + $sri) }
  $bytes = [Convert]::FromBase64String($sri.Substring(7))
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

# The resolution `images build` passed, checked strictly before any download: both URLs must be
# exactly the registry tarball URLs of that version.
function Assert-ClaudeArgs([string]$v, [string]$mainUrl, [string]$mainSri, [string]$winUrl, [string]$winSri) {
  if ($v -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z') { throw ('Claude Code version must be <major>.<minor>.<patch>, got: ' + $v) }
  $wantMain = 'https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-' + $v + '.tgz'
  $wantWin = 'https://registry.npmjs.org/@anthropic-ai/claude-code-win32-x64/-/claude-code-win32-x64-' + $v + '.tgz'
  if ($mainUrl -cne $wantMain) { throw ('Claude Code URL must be ' + $wantMain + ', got: ' + $mainUrl) }
  if ($winUrl -cne $wantWin) { throw ('Claude Code win32-x64 URL must be ' + $wantWin + ', got: ' + $winUrl) }
  [void](ConvertFrom-Sri $mainSri)
  [void](ConvertFrom-Sri $winSri)
}

# Every entry of an npm tarball sits under package/: nothing rooted, drive-qualified, stream-named
# (a colon), backslashed or holding a '..' segment. Checked on the entry list before any extraction.
function Assert-TarEntries($entries) {
  $all = @($entries)
  if ($all.Count -eq 0) { throw 'unsafe archive entry: the archive lists no entry' }
  foreach ($n in $all) {
    if ($n -cnotmatch '^package/' -or $n.Contains('\') -or $n.Contains(':') -or (($n -split '/') -contains '..')) {
      throw ('unsafe archive entry: ' + $n)
    }
  }
}

# A verified archive, screened, then extracted with tar.exe; no link or reparse point may result.
function Expand-Verified([string]$tar, [string]$tgz, [string]$dest) {
  $entries = @(& $tar -tzf $tgz)
  if ($LASTEXITCODE -ne 0) { throw ('tar.exe could not list ' + $tgz + ' (exit ' + $LASTEXITCODE + ')') }
  Assert-TarEntries $entries
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  & $tar -xzf $tgz -C $dest | Out-Host
  if ($LASTEXITCODE -ne 0) { throw ('tar.exe could not extract ' + $tgz + ' (exit ' + $LASTEXITCODE + ')') }
  $links = @(Get-ChildItem -LiteralPath $dest -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if ($links.Count -ne 0) { throw ('archive ' + $tgz + ' extracted a link or reparse point: ' + $links[0].FullName) }
}

function Assert-PackageJson([string]$dir, [string]$name, [string]$v) {
  $p = Get-Content -LiteralPath (Join-Path $dir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($p.name -cne $name -or $p.version -cne $v) {
    throw ($dir + '\package.json names ' + $p.name + '@' + $p.version + ', want ' + $name + '@' + $v)
  }
}

# The claude.exe hash every later check expects, from the verified platform archive itself.
function Get-ExpectedExe([string]$tar, [string]$winTgz, [string]$scratch, [string]$v) {
  $x = Join-Path $scratch 'expect-win32-x64'
  Expand-Verified $tar $winTgz $x
  Assert-PackageJson (Join-Path $x 'package') '@anthropic-ai/claude-code-win32-x64' $v
  $exe = Join-Path $x 'package\claude.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw ('the verified platform archive ' + $winTgz + ' has no package/claude.exe') }
  return (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
}

# npm, offline and without scripts, on the two verified archives; on an npm failure the same two
# archives with tar.exe. Either way install.cjs's one job (the platform claude.exe over the main
# package's bin\claude.exe stub) is done here, and npm's shims are removed. Returns npm or tar.
function Install-ClaudeCode([string]$npm, [string]$tar, [string]$mainTgz, [string]$winTgz, [string]$prefix, [string]$scratch) {
  $nm = Join-Path $prefix 'node_modules'
  $scope = Join-Path $nm '@anthropic-ai'
  $common = @('install', '-g', '--prefix', $prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', 'http://127.0.0.1:9/')
  $method = 'npm'
  & $npm @common $winTgz | Out-Host
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    & $npm @common '--omit=optional' $mainTgz | Out-Host
    $code = $LASTEXITCODE
  }
  if ($code -ne 0) {
    [Console]::Out.WriteLine('[WARN] npm install failed (exit ' + $code + '): installing the same verified archives with tar.exe')
    if (Test-Path -LiteralPath $nm) { Remove-Item -LiteralPath $nm -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $scope | Out-Null
    foreach ($p in @(@{ tgz = $mainTgz; name = 'claude-code' }, @{ tgz = $winTgz; name = 'claude-code-win32-x64' })) {
      $x = Join-Path $scratch ('tar-' + $p.name)
      Expand-Verified $tar $p.tgz $x
      Move-Item -LiteralPath (Join-Path $x 'package') -Destination (Join-Path $scope $p.name)
    }
    $method = 'tar'
  }
  $src = Join-Path $scope 'claude-code-win32-x64\claude.exe'
  $dst = Join-Path $scope 'claude-code\bin\claude.exe'
  if ((Test-Path -LiteralPath $src -PathType Leaf) -and (Test-Path -LiteralPath $dst -PathType Leaf)) {
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  foreach ($s in 'claude', 'claude.cmd', 'claude.ps1') {
    $f = Join-Path $prefix $s
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
  }
  return $method
}

# The same postconditions for both install paths: exactly the two packages at the resolved version,
# no link, and exactly two executables, both the claude.exe of the verified platform archive.
function Assert-ClaudeInstall([string]$prefix, [string]$v, [string]$exeHash) {
  $nm = Join-Path $prefix 'node_modules'
  if (-not (Test-Path -LiteralPath $nm -PathType Container)) { throw ($prefix + ' has no node_modules: nothing was installed') }
  $top = (@(Get-ChildItem -LiteralPath $prefix -Force | ForEach-Object { $_.Name }) | Sort-Object) -join ','
  if ($top -cne 'node_modules') { throw ($prefix + ' must hold only node_modules, got: ' + $top) }
  $mods = @(Get-ChildItem -LiteralPath $nm -Force | ForEach-Object { $_.Name } | Where-Object { $_ -cne '.package-lock.json' })
  if (($mods -join ',') -cne '@anthropic-ai') { throw ($nm + ' must hold only @anthropic-ai, got: ' + ($mods -join ',')) }
  $scope = Join-Path $nm '@anthropic-ai'
  $pkgs = @(Get-ChildItem -LiteralPath $scope -Force | ForEach-Object { $_.Name })
  if ($pkgs.Count -ne 2 -or $pkgs -cnotcontains 'claude-code' -or $pkgs -cnotcontains 'claude-code-win32-x64') {
    throw ($scope + ' must hold exactly claude-code and claude-code-win32-x64, got: ' + ($pkgs -join ','))
  }
  Assert-PackageJson (Join-Path $scope 'claude-code') '@anthropic-ai/claude-code' $v
  Assert-PackageJson (Join-Path $scope 'claude-code-win32-x64') '@anthropic-ai/claude-code-win32-x64' $v
  $items = @(Get-ChildItem -LiteralPath $prefix -Recurse -Force)
  $links = @($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if ($links.Count -ne 0) { throw ('link or reparse point under ' + $prefix + ': ' + $links[0].FullName) }
  $root = $prefix.TrimEnd('\') + '\'
  $want = @('node_modules\@anthropic-ai\claude-code\bin\claude.exe', 'node_modules\@anthropic-ai\claude-code-win32-x64\claude.exe')
  $exes = @($items | Where-Object { -not $_.PSIsContainer -and $_.Extension -ieq '.exe' } | ForEach-Object { $_.FullName.Substring($root.Length) })
  foreach ($e in $exes) { if ($want -notcontains $e) { throw ('unexpected executable under ' + $prefix + ': ' + $e) } }
  foreach ($e in $want) {
    $p = Join-Path $prefix $e
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw ('missing executable: ' + $e) }
    $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($h -ne $exeHash) { throw ('hash mismatch for ' + $e + ': got ' + $h + ', the verified platform archive has ' + $exeHash) }
  }
}

function Assert-ClaudeVersion([string]$exe, [string]$v) {
  $out = @(& $exe --version)
  if ($LASTEXITCODE -ne 0) { throw ('claude --version failed (exit ' + $LASTEXITCODE + ')') }
  $first = [string]($out | Select-Object -First 1)
  if (-not $first.StartsWith($v + ' ')) { throw ('claude --version printed "' + $first + '", want "' + $v + ' ..."') }
}

if ($LibOnly) { return }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object System.Text.UTF8Encoding $false
$prefix = 'C:\cg-npm'
$tmp = 'C:\cg-npm-tmp'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$npm = 'C:\Program Files\nodejs\npm.cmd'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# 1. The resolution, then both archives, each against its registry integrity.
Assert-ClaudeArgs $Version $MainUrl $MainIntegrity $WinUrl $WinIntegrity
[Console]::Out.WriteLine('[..] install-claude-code: @anthropic-ai/claude-code ' + $Version + ' ' + $MainIntegrity + ', @anthropic-ai/claude-code-win32-x64 ' + $WinIntegrity)
Get-Pinned @{ url = $MainUrl; algorithm = 'SHA512'; hash = (ConvertFrom-Sri $MainIntegrity) } "$tmp\claude-code.tgz"
Get-Pinned @{ url = $WinUrl; algorithm = 'SHA512'; hash = (ConvertFrom-Sri $WinIntegrity) } "$tmp\claude-code-win32-x64.tgz"
[Console]::Out.WriteLine('[OK] verified both archives against their registry integrity')

# 2. Before any install: the expected claude.exe from the verified platform archive; the main
# archive screened and named the same way.
$exeHash = Get-ExpectedExe $tar "$tmp\claude-code-win32-x64.tgz" $tmp $Version
Expand-Verified $tar "$tmp\claude-code.tgz" "$tmp\expect-main"
Assert-PackageJson "$tmp\expect-main\package" '@anthropic-ai/claude-code' $Version
[Console]::Out.WriteLine('[OK] expected claude.exe sha256:' + $exeHash + ' (from the verified platform archive)')

# 3. Install (npm offline without scripts, or tar.exe), then the same postconditions either way.
$method = Install-ClaudeCode $npm $tar "$tmp\claude-code.tgz" "$tmp\claude-code-win32-x64.tgz" $prefix $tmp
Assert-ClaudeInstall $prefix $Version $exeHash
Assert-ClaudeVersion "$prefix\node_modules\@anthropic-ai\claude-code\bin\claude.exe" $Version

# 4. What the image installed, read back by `images build` and every imageFacts with an owner.
$resolved = [ordered]@{
  version           = $Version
  packages          = [ordered]@{
    '@anthropic-ai/claude-code'           = [ordered]@{ tarball = $MainUrl; integrity = $MainIntegrity }
    '@anthropic-ai/claude-code-win32-x64' = [ordered]@{ tarball = $WinUrl; integrity = $WinIntegrity }
  }
  claude_exe_sha256 = $exeHash
  install_method    = $method
}
[IO.File]::WriteAllText("$prefix\claude-code-resolved.json", (ConvertTo-Json -InputObject $resolved -Depth 5), $utf8)
Remove-Item -LiteralPath $tmp -Recurse -Force
[Console]::Out.WriteLine('[OK] install-claude-code: ' + $Version + ' installed with ' + $method + ', claude.exe sha256:' + $exeHash)
exit 0
