# Read-only pool tag snapshot (NtQuerySystemInformation class 22). Emits one object per tag.
# Diff mode: .\pooltags2.ps1 -DiffSeconds 120   -> tags whose outstanding allocs/bytes changed most.
param([int]$DiffSeconds = 0, [int]$Top = 30)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PT2 {
  [DllImport("ntdll.dll")] public static extern int NtQuerySystemInformation(int c, IntPtr b, int l, out int r);
}
"@
function Get-PoolTags {
  $M = [Runtime.InteropServices.Marshal]
  $len = 1MB
  while ($true) {
    $buf = $M::AllocHGlobal($len)
    $r = 0
    $st = [PT2]::NtQuerySystemInformation(22, $buf, $len, [ref]$r)
    if ($st -eq 0) { break }
    $M::FreeHGlobal($buf)
    if ($st -ne -1073741820) { throw ("status 0x{0:X}" -f $st) }
    $len = [Math]::Max($r, $len * 2)
  }
  $n = $M::ReadInt32($buf)
  # SYSTEM_POOLTAG x64: Tag@0 PagedAllocs@4 PagedFrees@8 PagedUsed@16 NonPagedAllocs@24 NonPagedFrees@28 NonPagedUsed@32, 40 bytes
  # alloc/free counters are 32-bit and wrap, so the difference is taken mod 2^32
  for ($i = 0; $i -lt $n; $i++) {
    $p = [IntPtr]($buf.ToInt64() + 8 + $i * 40)
    $tb = New-Object byte[] 4
    $M::Copy($p, $tb, 0, 4)
    [pscustomobject]@{
      Tag   = [Text.Encoding]::ASCII.GetString($tb)
      NPMB  = [Math]::Round($M::ReadInt64($p, 32) / 1MB, 1)
      NPOut = ([int64]$M::ReadInt32($p, 24) - [int64]$M::ReadInt32($p, 28)) -band 0xFFFFFFFFL
      PMB   = [Math]::Round($M::ReadInt64($p, 16) / 1MB, 1)
      POut  = ([int64]$M::ReadInt32($p, 4) - [int64]$M::ReadInt32($p, 8)) -band 0xFFFFFFFFL
    }
  }
  $M::FreeHGlobal($buf)
}
if ($DiffSeconds -le 0) { Get-PoolTags; return }
$a = [hashtable]::new([StringComparer]::Ordinal); Get-PoolTags | ForEach-Object { $a[$_.Tag] = $_ }
Start-Sleep -Seconds $DiffSeconds
Get-PoolTags | ForEach-Object {
  $o = $a[$_.Tag]; if (-not $o) { return }
  [pscustomobject]@{ Tag = $_.Tag; dNPOut = $_.NPOut - $o.NPOut; dPOut = $_.POut - $o.POut
    dMB = [Math]::Round(($_.NPMB + $_.PMB) - ($o.NPMB + $o.PMB), 1); NPOut = $_.NPOut; POut = $_.POut; NPMB = $_.NPMB; PMB = $_.PMB }
} | Sort-Object { [Math]::Abs($_.dNPOut) + [Math]::Abs($_.dPOut) } -Descending | Select-Object -First $Top
