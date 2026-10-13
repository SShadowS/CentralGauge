# M10: install the AL language server plugin from the recipe in C:\cg-lsp\al-lsp.json.
# The wrapper and al-call-hierarchy come from the one al-lsp-for-agents release that
# `harness images build` resolved (M10-10: -Release, -Url, -Sha256, the asset digest the
# GitHub API publishes); the AL extension and .NET are hash-pinned in the recipe.
# The hash of every downloaded artifact is checked; a gzip-wrapped VSIX is
# decompressed after the check; every installed executable is checked again.
# Any mismatch fails the image build. Build time only (ContainerAdministrator);
# cg-lockdown makes C:\cg-lsp read-only afterwards.
# -LibOnly defines the check functions and stops (host tests dot-source it; nothing is installed).
param([switch]$LibOnly, [string]$Release, [string]$Url, [string]$Sha256)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Saves the exact bytes on the wire: the pins hash the raw body, and Invoke-WebRequest
# transport-decodes a Content-Encoding: gzip answer (the Marketplace sends one, M10-08a).
# One deadline covers headers and body (a stalled body cannot hang the build), and the
# bytes reach $out only after the hash check: a wrong or broken download leaves no file.
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

# M10-10: the release `images build` resolved, checked strictly before any download. The URL
# must be exactly the recipe repo's release download URL for that tag and the recipe asset.
function Assert-ReleaseArgs($src, [string]$release, [string]$url, [string]$sha) {
  if ($src.repo -cne 'SShadowS/al-lsp-for-agents') { throw ('source.repo must be SShadowS/al-lsp-for-agents, got: ' + $src.repo) }
  if ($src.asset -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.zip\z') { throw ('source.asset must be a .zip file name, got: ' + $src.asset) }
  if (((@($src.exes) | Sort-Object) -join ',') -cne 'al-call-hierarchy.exe,al-lsp-wrapper.exe') { throw ('source.exes must be exactly al-call-hierarchy.exe and al-lsp-wrapper.exe, got: ' + (@($src.exes) -join ',')) }
  if ($src.dependency_source -cnotmatch '^(embedded|symbols)\z') { throw ('source.dependency_source must be embedded or symbols, got: ' + $src.dependency_source) }
  if ($release -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+\z') { throw ('LSP release tag must be v<major>.<minor>.<patch>, got: ' + $release) }
  if ($sha -cnotmatch '^[0-9a-f]{64}\z') { throw ('LSP wrapper sha256 must be 64 lowercase hex, got: ' + $sha) }
  $want = 'https://github.com/' + $src.repo + '/releases/download/' + $release + '/' + $src.asset
  if ($url -cne $want) { throw ('LSP wrapper URL must be ' + $want + ', got: ' + $url) }
}

# The one verified release zip: screened, extracted, and exactly the named exes taken from it
# (each must occur once in it; no other exe). Returns name -> sha256 of the installed copies.
function Install-WrapperZip([string]$zip, $names, [string]$bin) {
  Assert-ZipSafe $zip
  $dir = $zip + '.d'
  Expand-Archive -LiteralPath $zip -DestinationPath $dir
  $hashes = [ordered]@{}
  foreach ($name in @($names)) {
    if (Test-Path -LiteralPath "$bin\$name") { throw ('wrapper exe named twice: ' + $name) }
    $found = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Filter $name)
    if ($found.Count -ne 1) { throw ('wrapper archive must hold exactly one ' + $name + ', found ' + $found.Count) }
    Copy-Item -LiteralPath $found[0].FullName -Destination "$bin\$name"
    $hashes[$name] = (Get-FileHash -LiteralPath "$bin\$name" -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $exes = (@(Get-ChildItem -LiteralPath $bin -Force) | ForEach-Object { $_.Name } | Sort-Object) -join ','
  if ($exes -ne 'al-call-hierarchy.exe,al-lsp-wrapper.exe') { throw ('wrapper bin must hold exactly al-call-hierarchy.exe and al-lsp-wrapper.exe, got: ' + $exes) }
  return $hashes
}

# AL_SEM_DEPENDENCY_SOURCE (al-lsp-for-agents v1.18.4+): the recipe's mode decides it. "embedded"
# (the upstream default: calls followed into dependency source) leaves it unset; another mode sets it.
function Set-DependencySource($def) {
  $mode = $def.source.dependency_source
  if ($mode -cnotmatch '^(embedded|symbols)\z') { throw ('source.dependency_source must be embedded or symbols, got: ' + $mode) }
  if ($null -ne $def.lsp_json.al.env.PSObject.Properties['AL_SEM_DEPENDENCY_SOURCE']) { throw 'lsp_json env must not set AL_SEM_DEPENDENCY_SOURCE: source.dependency_source does' }
  if ($mode -cne 'embedded') { Add-Member -InputObject $def.lsp_json.al.env -NotePropertyName 'AL_SEM_DEPENDENCY_SOURCE' -NotePropertyValue $mode }
}

function Test-Gzip([string]$path) {
  $s = [IO.File]::OpenRead($path)
  try { $b = New-Object byte[] 2; $n = $s.Read($b, 0, 2); return ($n -eq 2 -and $b[0] -eq 0x1f -and $b[1] -eq 0x8b) } finally { $s.Close() }
}

# Refuse an archive entry that could write outside the destination: rooted, drive-qualified
# or stream-named (a colon), or holding a '..' segment. Checked on the entry list before any extraction.
function Assert-ZipSafe([string]$zip) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $z = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($e in $z.Entries) {
      $name = $e.FullName
      if ($name -match '^[\\/]' -or $name.Contains(':') -or (($name -split '[\\/]') -contains '..')) {
        throw ('unsafe archive entry in ' + $zip + ': ' + $name)
      }
    }
  } finally { $z.Dispose() }
}

# Every .exe under $root, recursively, must be in the manifest (relative path -> sha256) with that
# hash, and every manifest entry must exist: a missing, extra or changed executable fails.
function Assert-ExeManifest([string]$root, $manifest) {
  $prefix = $root.TrimEnd('\') + '\'
  $want = @{}
  foreach ($m in $manifest.PSObject.Properties) { $want[$m.Name.ToLowerInvariant()] = $m.Value }
  $have = @{}
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force | Where-Object { $_.Extension -ieq '.exe' })
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($prefix.Length).ToLowerInvariant()
    $have[$rel] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  foreach ($k in @($have.Keys | Sort-Object)) {
    if (-not $want.ContainsKey($k)) { throw ('unexpected executable: ' + $k) }
  }
  foreach ($k in @($want.Keys | Sort-Object)) {
    if (-not $have.ContainsKey($k)) { throw ('missing executable: ' + $k) }
    if ($have[$k] -ne $want[$k]) { throw ('hash mismatch for ' + $k + ': got ' + $have[$k]) }
  }
}

if ($LibOnly) { return }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object System.Text.UTF8Encoding $false
$def = Get-Content 'C:\cg-lsp\al-lsp.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$tmp = 'C:\cg-lsp-tmp'
$plugin = 'C:\cg-lsp\al-language-server-go-windows'
New-Item -ItemType Directory -Force -Path $tmp, "$plugin\bin", "$plugin\.claude-plugin" | Out-Null

# 0. The probe files copied next to this definition must match its recorded hashes.
$probeNames = @($def.probe.PSObject.Properties | ForEach-Object { $_.Name })
if ($probeNames.Count -ne 2 -or $probeNames -notcontains 'lsp-probe.mjs' -or $probeNames -notcontains 'lsp-probe-lib.mjs') { throw 'probe must list exactly lsp-probe.mjs and lsp-probe-lib.mjs' }
foreach ($p in $def.probe.PSObject.Properties) {
  $h = (Get-FileHash -LiteralPath "C:\cg-lsp\$($p.Name)" -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($h -ne $p.Value) { throw ('hash mismatch for ' + $p.Name + ': got ' + $h) }
}

# 1. The wrapper and al-call-hierarchy, both from the one resolved release: its zip must hash to
# the API digest (no digest, no install). Their exe hashes are derived from that verified zip,
# recorded in al-lsp-resolved.json and joined to the exe manifest (a recipe that still pins one
# of them fails: Add-Member refuses a duplicate name).
$src = $def.source
Assert-ReleaseArgs $src $Release $Url $Sha256
[Console]::Out.WriteLine('[..] install-lsp: ' + $src.repo + ' ' + $Release + ', ' + $src.asset + ' sha256:' + $Sha256)
Get-Pinned @{ url = $Url; algorithm = 'SHA256'; hash = $Sha256 } "$tmp\wrapper.zip"
[Console]::Out.WriteLine('[OK] verified ' + $src.asset + ' ' + $Release + ' sha256:' + $Sha256)
$wrapperExes = Install-WrapperZip "$tmp\wrapper.zip" $src.exes "$plugin\bin"
foreach ($name in @($wrapperExes.Keys)) {
  Add-Member -InputObject $def.exes -NotePropertyName ('al-language-server-go-windows\bin\' + $name) -NotePropertyValue $wrapperExes[$name]
  [Console]::Out.WriteLine('[OK] ' + $name + ' sha256:' + $wrapperExes[$name])
}
$resolved = [ordered]@{ release = $Release; asset = $src.asset; sha256 = $Sha256; dependency_source = $src.dependency_source; exes = $wrapperExes }
[IO.File]::WriteAllText('C:\cg-lsp\al-lsp-resolved.json', (ConvertTo-Json -InputObject $resolved -Depth 5), $utf8)

# 2. AL extension (a VSIX is a zip, sometimes served gzip-wrapped): its extension folder only.
Get-Pinned $def.pins.al_extension "$tmp\al.download"
if (Test-Gzip "$tmp\al.download") {
  $in = [IO.File]::OpenRead("$tmp\al.download")
  $gz = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
  $out = [IO.File]::Create("$tmp\al.zip")
  try { $gz.CopyTo($out) } finally { $out.Close(); $gz.Close(); $in.Close() }
} else {
  Move-Item -LiteralPath "$tmp\al.download" -Destination "$tmp\al.zip"
}
Assert-ZipSafe "$tmp\al.zip"
Expand-Archive -LiteralPath "$tmp\al.zip" -DestinationPath "$tmp\al"
Move-Item -LiteralPath "$tmp\al\extension" -Destination 'C:\cg-lsp\al'
# The compiler and tools are not the agent's: the enumerated files go (a missing one fails the build),
# then nothing named alc.*, altool.*, aldoc.* or almcp.* may remain anywhere in the extension tree.
foreach ($name in $def.pins.al_extension.remove) {
  Remove-Item -LiteralPath "C:\cg-lsp\al\bin\$name" -Force
}
foreach ($prefix in 'alc', 'altool', 'aldoc', 'almcp') {
  $left = @(Get-ChildItem -LiteralPath 'C:\cg-lsp\al' -File -Recurse | Where-Object { $_.Name -like ($prefix + '.*') })
  if ($left.Count -ne 0) { throw ('strip left files for ' + $prefix + ': ' + (($left | ForEach-Object { $_.Name }) -join ', ')) }
}
$ca = (Get-FileHash -LiteralPath 'C:\cg-lsp\al\bin\Microsoft.Dynamics.Nav.CodeAnalysis.dll' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ca -ne $def.lineage.extension.sha256) { throw ('extension CodeAnalysis differs from lineage: ' + $ca) }

# 3. ASP.NET Core runtime 10 (holds Microsoft.NETCore.App too), private to the LSP.
Get-Pinned $def.pins.dotnet "$tmp\dotnet.zip"
Assert-ZipSafe "$tmp\dotnet.zip"
Expand-Archive -LiteralPath "$tmp\dotnet.zip" -DestinationPath 'C:\cg-lsp\dotnet'

# 4. Plugin files from the hashed definition (single source of truth).
$noDiag = @($def.lsp_json.al.args) -contains '--no-diagnostics'
if ($noDiag -ne ($def.diagnostics -eq 'sidecar-off')) { throw ('lsp_json args disagree with diagnostics ' + $def.diagnostics) }
Set-DependencySource $def
Add-Member -InputObject $def.plugin_json -NotePropertyName 'version' -NotePropertyValue $Release.Substring(1)
[IO.File]::WriteAllText("$plugin\.lsp.json", (ConvertTo-Json -InputObject $def.lsp_json -Depth 10), $utf8)
[IO.File]::WriteAllText("$plugin\.claude-plugin\plugin.json", (ConvertTo-Json -InputObject $def.plugin_json -Depth 10), $utf8)

# 5. Every executable under C:\cg-lsp is exactly the expected set: the recipe's pins plus the two
# wrapper exes from the verified release (DLLs are covered by the archive hashes).
Assert-ExeManifest 'C:\cg-lsp' $def.exes

Remove-Item -LiteralPath $tmp -Recurse -Force
[Console]::Out.WriteLine('[OK] install-lsp: wrapper ' + $Release + ' (' + $src.asset + ' sha256:' + $Sha256 + ', dependency source ' + $src.dependency_source + '), AL ' + $def.pins.al_extension.version + ', .NET ' + $def.pins.dotnet.version + ', diagnostics ' + $def.diagnostics)
exit 0
