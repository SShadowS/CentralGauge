# H-35 S3 L4 (design-r5 2.4 as amended: decisions\2026-10-20-h-35-l4-scope.md). Dot-sourced after reset-lib.ps1.
# Scope: L4 detects differences in the specified file/stream contents and recorded metadata between observation
# points within declared roots, excluding recorded exclusions and untraversed reparse targets. It is not a complete
# write history or persistence boundary.
#
# fsDigest(W): every entry under the roots, hashed in full every time (no size/mtime gate). One line per entry,
# sorted ordinal by path, fields separated by '|':
#   D|<attrs>|<lastWriteUtcTicks>|<path>                    directory (its own named streams follow as S lines)
#   F|<sha256>|<size>|<attrs>|<lastWriteUtcTicks>|<path>    file, unnamed stream
#   S|<sha256>|<size>|<path>:<stream>                       named NTFS stream of a file or directory
#   L|<attrs>|<lastWriteUtcTicks>|<path>|<target>           reparse point (a root too): recorded, never followed
#   E|<path>|<reason>                                       access error or change during the scan: fails closed
# A file, stream or directory that changes while it is read or enumerated is an E line. fs-capture.ps1 brackets
# the walk with Test-NstQuiescent and ends the capture with `T|<entry lines>` (src/harness/reset.ts fsDiff
# refuses a capture without it). DIGEST_VERSION enters env_fp through the lineage; bump it on any change to the
# line format or the walk.
$FsDigestVersion = 2

# Observation point (decision item 3): no user or background session on the NST. Throws when it cannot tell.
function Test-NstQuiescent([string]$Container) {
  $n = Invoke-InContainer $Container {
    @(Get-NAVServerSession -ServerInstance BC -Tenant default -ErrorAction Stop |
        Where-Object { $_.SessionID -ge 0 -or "$($_.ClientType)" -eq 'Background' }).Count
  }
  if ("$n".Trim() -notmatch '^\d+$') { throw "NST session count unreadable: '$n'" }
  [int]"$n".Trim() -eq 0
}

function Get-FsDigest([string]$Container, [string[]]$Roots) {
  $lines = Invoke-InContainer $Container { param($roots)
    $sha = [Security.Cryptography.SHA256]::Create()
    function Get-Sha([byte[]]$b) { [BitConverter]::ToString($sha.ComputeHash($b)).Replace('-', '').ToLower() }
    function Clean([string]$s) { ($s -replace '[\r\n|]+', ' ').Trim() }
    # FindFirstStreamW: Get-Item -Stream misses directory streams in Windows PowerShell 5.1.
    if (-not ('CgFsStreams' -as [type])) {
      Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class CgFsStreams {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct W32 { public long Size; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 296)] public string Name; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr FindFirstStreamW(string p, int level, out W32 d, int flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool FindNextStreamW(IntPtr h, out W32 d);
  [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr h);
  public static string[] Names(string path) {
    var r = new List<string>(); W32 d;
    IntPtr h = FindFirstStreamW(path, 0, out d, 0);
    if (h == new IntPtr(-1)) {
      int e = Marshal.GetLastWin32Error();
      if (e == 38) return r.ToArray(); // ERROR_HANDLE_EOF: no streams (a directory without ADS)
      throw new System.ComponentModel.Win32Exception(e);
    }
    try {
      do { r.Add(d.Name); } while (FindNextStreamW(h, out d));
      int e = Marshal.GetLastWin32Error();
      if (e != 38) throw new System.ComponentModel.Win32Exception(e); // only ERROR_HANDLE_EOF ends it
    } finally { FindClose(h); }
    return r.ToArray();
  }
}
'@
    }
    function ReadStream([string]$path, [string]$name) {
      $b = [byte[]](Get-Content -LiteralPath $path -Stream $name -Encoding Byte -Raw -ErrorAction Stop)
      if ($null -eq $b) { $b = [byte[]]@() }
      , $b
    }
    function Streams($item) {
      foreach ($n in [CgFsStreams]::Names($item.FullName)) {
        if ($n -eq '::$DATA') { continue }
        $name = $n -replace '^:([^:]*):\$DATA$', '$1'
        $p = "$($item.FullName):$name"
        try {
          # read twice: a stream rewritten during the scan is an error, never a record
          $h1 = Get-Sha (ReadStream $item.FullName $name)
          $b = ReadStream $item.FullName $name
          if ((Get-Sha $b) -ne $h1) { "E|$p|changed during the scan" }
          else { "S|$h1|$($b.Length)|$p" }
        } catch { "E|$p|$(Clean $_.Exception.Message)" }
      }
    }
    # One entry; a directory's children are enumerated, then its last-write time is re-read (a child added or
    # removed meanwhile changes it).
    function Entry($i) {
      try {
        # enumeration reads the parent's index, which NTFS updates lazily: stat the entry itself
        $i = Get-Item -LiteralPath $i.FullName -Force -ErrorAction Stop
        $attrs = [int]$i.Attributes
        $t = $i.LastWriteTimeUtc.Ticks
        if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          "L|$attrs|$t|$($i.FullName)|$(Clean "$($i.Target)")"
        } elseif ($i.PSIsContainer) {
          $lines = @("D|$attrs|$t|$($i.FullName)") + @(Streams $i)
          foreach ($c in @(Get-ChildItem -LiteralPath $i.FullName -Force -ErrorAction Stop)) { $lines += @(Entry $c) }
          $after = Get-Item -LiteralPath $i.FullName -Force -ErrorAction Stop
          if ($after.LastWriteTimeUtc.Ticks -ne $t) { $lines += "E|$($i.FullName)|changed during the scan" }
          $lines
        } else {
          $b = [IO.File]::ReadAllBytes($i.FullName)
          $after = Get-Item -LiteralPath $i.FullName -Force -ErrorAction Stop
          if ($after.Length -ne $b.Length -or $after.LastWriteTimeUtc.Ticks -ne $t) {
            "E|$($i.FullName)|changed during the scan"
          } else {
            "F|$(Get-Sha $b)|$($b.Length)|$attrs|$t|$($i.FullName)"
            Streams $i
          }
        }
      } catch { "E|$($i.FullName)|$(Clean $_.Exception.Message)" }
    }
    foreach ($r in $roots) {
      if (-not (Test-Path -LiteralPath $r)) { "E|$r|root missing"; continue }
      try { Entry (Get-Item -LiteralPath $r -Force -ErrorAction Stop) }
      catch { "E|$r|$(Clean $_.Exception.Message)" }
    }
  } (, $Roots)
  Sort-Ordinal $lines { $p = $args[0] -split '\|'; switch ($p[0]) { 'F' { $p[5] } 'E' { $p[1] } default { $p[3] } } }
}

# The NST service identity (account, groups, privileges) and every root's file count and bytes (measurement only).
function Get-FsDigestFacts([string]$Container, [string[]]$Roots) {
  Invoke-InContainer $Container { param($roots)
    $svc = Get-CimInstance Win32_Service -Filter "Name='MicrosoftDynamicsNavServer`$BC'"
    "service_account|$($svc.StartName)"
    "service_path|$($svc.PathName)"
    foreach ($r in $roots) {
      $f = @(Get-ChildItem -LiteralPath $r -Recurse -Force -File -ErrorAction SilentlyContinue)
      "root|$r|files=$($f.Count)|bytes=$(($f | Measure-Object Length -Sum).Sum)"
    }
  } (, $Roots)
}

# Candidate roots of W for discovery on the image (decision 2026-10-20 item 2): resolved absolute paths.
function Get-FsDigestCandidateRoots([string]$Container) {
  Invoke-InContainer $Container {
    $svc = Get-CimInstance Win32_Service -Filter "Name='MicrosoftDynamicsNavServer`$BC'"
    $exe = ($svc.PathName -replace '^"([^"]+)".*$', '$1')
    @(
      'C:\Windows\Temp',
      'C:\Windows\System32\config\systemprofile\AppData',
      (Split-Path -Parent $exe),
      'C:\ProgramData\Microsoft\Microsoft Dynamics NAV',
      'C:\Run\my'
    ) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { (Get-Item -LiteralPath $_ -Force).FullName }
  }
}
