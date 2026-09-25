# Mock harness (spec 1a section 11): exercises the full pipeline without a model.
# Reads C:\config\settings.json (settings.mode, settings.variant, settings.cg_al) and
# C:\config\variant\ (the runner copies the resolved variant there; C:\task never holds
# solutions), applies it to C:\workspace with .delete semantics, optionally calls cg-al,
# and prints JSON lines: mock_init, mock_apply, mock_cg_al, mock_usage_limit, mock_done.
# Windows PowerShell 5.1 and pwsh 7. CG_MOCK_CONFIG, CG_MOCK_WORKSPACE and CG_MOCK_CG_AL
# override the container paths (unit tests run this script on the host).
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$Config = if ($env:CG_MOCK_CONFIG) { $env:CG_MOCK_CONFIG } else { 'C:\config' }
$Workspace = if ($env:CG_MOCK_WORKSPACE) { $env:CG_MOCK_WORKSPACE } else { 'C:\workspace' }
$CgAl = if ($env:CG_MOCK_CG_AL) { $env:CG_MOCK_CG_AL } else { 'C:\cg-al.ps1' }
$Version = '1'

function Emit([string]$type, [hashtable]$data) {
  $data['type'] = $type
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 6 -InputObject $data))
  [Console]::Out.Flush()
}

function Apply-Variant {
  $src = Join-Path $Config 'variant'
  $copied = 0
  $deleted = 0
  if (Test-Path -LiteralPath $src) {
    $base = (Resolve-Path -LiteralPath $src).Path.TrimEnd('\')
    foreach ($f in Get-ChildItem -LiteralPath $src -Recurse -File -Force) {
      $rel = $f.FullName.Substring($base.Length + 1)
      if ($rel -eq '.delete') { continue }
      $dst = Join-Path $Workspace $rel
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
      Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
      $copied++
    }
    $list = Join-Path $src '.delete'
    if (Test-Path -LiteralPath $list) {
      foreach ($raw in (Get-Content -LiteralPath $list -Encoding UTF8)) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $segs = @($line.Replace('\', '/').Split('/') | Where-Object { $_ -ne '' -and $_ -ne '.' })
        if ($segs.Count -eq 0 -or $segs -contains '..' -or $line -match '^[A-Za-z]:' -or $line.StartsWith('/')) {
          throw ".delete entry escapes the workspace: $line"
        }
        $p = Join-Path $Workspace ($segs -join '\')
        if (-not (Test-Path -LiteralPath $p)) { throw ".delete entry not found: $line" }
        Remove-Item -LiteralPath $p -Recurse -Force
        $deleted++
      }
    }
  }
  Emit 'mock_apply' @{ copied = $copied; deleted = $deleted }
}

function Call-CgAl([string[]]$argv) {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $CgAl @argv
  Emit 'mock_cg_al' @{ args = $argv; exit = $LASTEXITCODE; out = "$out" }
}

function Each-File([string]$filter, [scriptblock]$act) {
  foreach ($f in Get-ChildItem -LiteralPath $Workspace -Recurse -File -Filter $filter) { & $act $f }
}

$cfg = Get-Content (Join-Path $Config 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$s = $cfg.settings
$mode = "$($s.mode)"
Emit 'mock_init' @{ version = $Version; mode = $mode }

switch ($mode) {
  'apply' { Apply-Variant }
  'crash' { [Console]::Error.WriteLine('mock: crash before any work'); exit 3 }
  'crash-after-work' { Apply-Variant; [Console]::Error.WriteLine('mock: crash after work'); exit 3 }
  'sleep' { Apply-Variant; while ($true) { Start-Sleep -Seconds 5 } }
  'usage-limit' {
    Emit 'mock_usage_limit' @{ resets_at = [DateTimeOffset]::UtcNow.AddHours(1).ToUnixTimeSeconds() }
    exit 2
  }
  # Hostile rows (M1-30): each must be caught by the freeze, the backend or the verdict.
  'hostile-edit-tests' {
    Apply-Variant
    # Every shipped test now passes vacuously.
    Each-File '*.al' { param($f)
      if ($f.FullName -match '\\Test\\') {
        $t = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
        Set-Content -LiteralPath $f.FullName -Value ($t -replace '(?m)^\s*Assert\.[^\r\n]*$', '') -Encoding UTF8 -NoNewline
      }
    }
  }
  'hostile-app' {
    Apply-Variant
    foreach ($d in Get-ChildItem -LiteralPath $Workspace -Directory) {
      if (Test-Path -LiteralPath (Join-Path $d.FullName 'app.json')) {
        [IO.File]::WriteAllBytes((Join-Path $d.FullName "$($d.Name).app"), [byte[]](0x4E, 0x41, 0x56, 0x58, 1, 2, 3))
      }
    }
  }
  'hostile-junction' {
    Apply-Variant
    New-Item -ItemType Junction -Path (Join-Path $Workspace 'host-link') -Target 'C:\Windows\System32\drivers\etc' | Out-Null
  }
  'hostile-case-alias' {
    Apply-Variant
    $d = Join-Path $Workspace 'case-alias'
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    & fsutil.exe file setCaseSensitiveInfo $d enable | Out-Null
    Set-Content -LiteralPath (Join-Path $d 'a.txt') -Value 'lower' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $d 'A.txt') -Value 'upper' -Encoding UTF8
  }
  'hostile-app-id' {
    Apply-Variant
    Each-File 'app.json' { param($f)
      $j = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      $j.id = [guid]::NewGuid().ToString()
      Set-Content -LiteralPath $f.FullName -Value (ConvertTo-Json -Depth 8 -InputObject $j) -Encoding UTF8
    }
    Call-CgAl @('compile')
  }
  'hostile-probe-backend' {
    Apply-Variant
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Config 'cg-al-probe.ps1')
  }
  default { [Console]::Error.WriteLine("mock: unknown mode $mode"); exit 64 }
}
if ($s.cg_al) {
  Call-CgAl @('compile')
  Call-CgAl @('test')
}
Emit 'mock_done' @{ status = 'ok' }
exit 0
