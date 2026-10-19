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
#   L|<attrs>|<lastWriteUtcTicks>|<path>|<target>           reparse point: recorded, never followed (out of coverage)
#   E|<path>|<reason>                                       access error or change during the scan: fails closed
# DIGEST_VERSION enters env_fp through the lineage; bump it on any change to the line format or the walk.
$FsDigestVersion = 1

function Get-FsDigest([string]$Container, [string[]]$Roots) {
  Invoke-InContainer $Container { param($roots)
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
    try { do { r.Add(d.Name); } while (FindNextStreamW(h, out d)); } finally { FindClose(h); }
    return r.ToArray();
  }
}
'@
    }
    function Streams($item) {
      foreach ($n in [CgFsStreams]::Names($item.FullName)) {
        if ($n -eq '::$DATA') { continue }
        $name = $n -replace '^:([^:]*):\$DATA$', '$1'
        $b = [byte[]](Get-Content -LiteralPath $item.FullName -Stream $name -Encoding Byte -Raw -ErrorAction Stop)
        if ($null -eq $b) { $b = [byte[]]@() }
        "S|$(Get-Sha $b)|$($b.Length)|$($item.FullName):$name"
      }
    }
    function Walk([string]$dir) {
      foreach ($i in @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop)) {
        $attrs = [int]$i.Attributes
        $t = $i.LastWriteTimeUtc.Ticks
        try {
          if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            "L|$attrs|$t|$($i.FullName)|$(Clean "$($i.Target)")"
          } elseif ($i.PSIsContainer) {
            "D|$attrs|$t|$($i.FullName)"
            Streams $i
            Walk $i.FullName
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
    }
    # Observation point (decision item 3): the NST must be quiescent, else the digest fails closed.
    if (Get-Command Get-NAVServerSession -ErrorAction SilentlyContinue) {
      $busy = @(Get-NAVServerSession -ServerInstance BC -Tenant default -ErrorAction SilentlyContinue |
          Where-Object { $_.SessionID -ge 0 -or "$($_.ClientType)" -eq 'Background' }).Count
      if ($busy -gt 0) { "E|(nst)|not quiescent: $busy user or background session(s)" }
    }
    foreach ($r in $roots) {
      if (-not (Test-Path -LiteralPath $r)) { "E|$r|root missing"; continue }
      try {
        $ri = Get-Item -LiteralPath $r -Force -ErrorAction Stop
        "D|$([int]$ri.Attributes)|$($ri.LastWriteTimeUtc.Ticks)|$($ri.FullName)"
        Streams $ri
        Walk $ri.FullName
      } catch { "E|$r|$(Clean $_.Exception.Message)" }
    }
  } (, $Roots) | Sort-Object { $p = $_ -split '\|'; if ($p[0] -in 'F') { $p[5] } elseif ($p[0] -eq 'S') { $p[3] } elseif ($p[0] -eq 'E') { $p[1] } else { $p[3] } } -CaseSensitive
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
