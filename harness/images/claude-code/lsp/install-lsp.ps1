# M10: install the AL language server plugin from the pins in C:\cg-lsp\al-lsp.json.
# The hash of every downloaded artifact is checked; a gzip-wrapped VSIX is
# decompressed after the check; every installed executable is checked again.
# Any mismatch fails the image build. Build time only (ContainerAdministrator);
# cg-lockdown makes C:\cg-lsp read-only afterwards.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object System.Text.UTF8Encoding $false
$def = Get-Content 'C:\cg-lsp\al-lsp.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$tmp = 'C:\cg-lsp-tmp'
$plugin = 'C:\cg-lsp\al-language-server-go-windows'
New-Item -ItemType Directory -Force -Path $tmp, "$plugin\bin", "$plugin\.claude-plugin" | Out-Null

function Get-Pinned($pin, [string]$out) {
  Invoke-WebRequest -UseBasicParsing -Uri $pin.url -OutFile $out
  $got = (Get-FileHash -LiteralPath $out -Algorithm $pin.algorithm).Hash.ToLowerInvariant()
  if ($got -ne $pin.hash) { throw ('hash mismatch for ' + $pin.url + ': got ' + $got) }
}

function Test-Gzip([string]$path) {
  $s = [IO.File]::OpenRead($path)
  try { $b = New-Object byte[] 2; $n = $s.Read($b, 0, 2); return ($n -eq 2 -and $b[0] -eq 0x1f -and $b[1] -eq 0x8b) } finally { $s.Close() }
}

# 0. The probe files copied next to this definition must match its recorded hashes.
$probeNames = @($def.probe.PSObject.Properties | ForEach-Object { $_.Name })
if ($probeNames.Count -ne 2 -or $probeNames -notcontains 'lsp-probe.mjs' -or $probeNames -notcontains 'lsp-probe-lib.mjs') { throw 'probe must list exactly lsp-probe.mjs and lsp-probe-lib.mjs' }
foreach ($p in $def.probe.PSObject.Properties) {
  $h = (Get-FileHash -LiteralPath "C:\cg-lsp\$($p.Name)" -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($h -ne $p.Value) { throw ('hash mismatch for ' + $p.Name + ': got ' + $h) }
}

# 1. Wrapper releases: each zip is hash-checked, only the exes its source names are
# taken (a zip also holds the other exe at another version), each exe is hash-checked.
$n = 0
foreach ($src in @($def.pins.wrapper)) {
  $n++
  Get-Pinned $src "$tmp\wrapper$n.zip"
  Expand-Archive -LiteralPath "$tmp\wrapper$n.zip" -DestinationPath "$tmp\wrapper$n"
  foreach ($p in $src.files.PSObject.Properties) {
    if (Test-Path -LiteralPath "$plugin\bin\$($p.Name)") { throw ('wrapper exe named by two sources: ' + $p.Name) }
    $found = @(Get-ChildItem -LiteralPath "$tmp\wrapper$n" -Recurse -File -Filter $p.Name)
    if ($found.Count -ne 1) { throw ('wrapper archive ' + $src.release + ' must hold exactly one ' + $p.Name) }
    Copy-Item -LiteralPath $found[0].FullName -Destination "$plugin\bin\$($p.Name)"
    $h = (Get-FileHash -LiteralPath "$plugin\bin\$($p.Name)" -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($h -ne $p.Value) { throw ('hash mismatch for ' + $p.Name + ' (' + $src.release + '): got ' + $h) }
  }
}
$exes = (@(Get-ChildItem -LiteralPath "$plugin\bin" -Force) | ForEach-Object { $_.Name } | Sort-Object) -join ','
if ($exes -ne 'al-call-hierarchy.exe,al-lsp-wrapper.exe') { throw ('wrapper bin must hold exactly al-call-hierarchy.exe and al-lsp-wrapper.exe, got: ' + $exes) }

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
Expand-Archive -LiteralPath "$tmp\dotnet.zip" -DestinationPath 'C:\cg-lsp\dotnet'

# 4. Plugin files from the hashed definition (single source of truth).
$noDiag = @($def.lsp_json.al.args) -contains '--no-diagnostics'
if ($noDiag -ne ($def.diagnostics -eq 'sidecar-off')) { throw ('lsp_json args disagree with diagnostics ' + $def.diagnostics) }
[IO.File]::WriteAllText("$plugin\.lsp.json", (ConvertTo-Json -InputObject $def.lsp_json -Depth 10), $utf8)
[IO.File]::WriteAllText("$plugin\.claude-plugin\plugin.json", (ConvertTo-Json -InputObject $def.plugin_json -Depth 10), $utf8)

Remove-Item -LiteralPath $tmp -Recurse -Force
[Console]::Out.WriteLine('[OK] install-lsp: wrapper ' + ((@($def.pins.wrapper) | ForEach-Object { $_.release }) -join ' + ') + ', AL ' + $def.pins.al_extension.version + ', .NET ' + $def.pins.dotnet.version + ', diagnostics ' + $def.diagnostics)
exit 0
