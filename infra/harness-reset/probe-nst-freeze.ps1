param(
  [Parameter(Mandatory)][string]$Container,
  [int]$Seconds = 70,
  [string]$Out
)
# H-35 run 004 PROBE (lane-ops, leased container, not product code): does a job-object freeze
# (NtSetInformationJobObject, JobObjectFreezeInformation = 18) hold the NST, including threads the thread pool creates
# while frozen (NtSuspendProcess does not: lane-ops saw 26 -> 29 threads, 2 unsuspended, during a walk)? The NST is
# put into a NAMED job (Global\cg-nst-freeze; a process cannot leave a job, so the job stays, without limits), frozen,
# its threads polled every second for $Seconds (spanning >= 2 healthcheck ticks), then thawed. Prints one JSON line
# per poll and a summary; writes everything to $Out when given. Always thaws in finally.
$ErrorActionPreference = 'Stop'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')

$r = Invoke-InContainer $Container { param($secs)
  if (-not ('CgJobFreeze' -as [type])) {
    Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CgJobFreeze {
  [StructLayout(LayoutKind.Sequential)]
  public struct FREEZE { public uint Flags; public byte Freeze; public byte Swap; public byte R0; public byte R1; public uint High; public uint Low; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateJobObjectW(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("ntdll.dll")] public static extern int NtSetInformationJobObject(IntPtr job, int cls, ref FREEZE info, int len);
  public static int Set(IntPtr job, bool freeze) {
    var f = new FREEZE(); f.Flags = 1; f.Freeze = (byte)(freeze ? 1 : 0); // FreezeOperation
    return NtSetInformationJobObject(job, 18, ref f, Marshal.SizeOf(typeof(FREEZE)));
  }
}
'@
  }
  $log = [Collections.Generic.List[string]]::new()
  $p = @(Get-Process -Name 'Microsoft.Dynamics.Nav.Server')[0]
  $job = [CgJobFreeze]::CreateJobObjectW([IntPtr]::Zero, 'Global\cg-nst-freeze')
  if ($job -eq [IntPtr]::Zero) { return "ERR CreateJobObject $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $assigned = [CgJobFreeze]::AssignProcessToJobObject($job, $p.Handle)
  $log.Add("assign=$assigned err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())")
  $st = [CgJobFreeze]::Set($job, $true)
  $log.Add("freeze_status=0x$('{0:X8}' -f $st)")
  try {
    $t0 = Get-Date
    $seen = @{}
    while (((Get-Date) - $t0).TotalSeconds -lt $secs) {
      $p.Refresh()
      $th = @($p.Threads)
      $new = @($th | Where-Object { -not $seen.ContainsKey($_.Id) })
      foreach ($x in $th) { $seen[$x.Id] = $true }
      $states = ($th | Group-Object { "$($_.ThreadState)/$($_.WaitReason)" } | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ','
      $log.Add((@{ t = [int]((Get-Date) - $t0).TotalSeconds; threads = $th.Count; new = @($new | ForEach-Object { "$($_.Id)@$($_.StartTime.ToString('HH:mm:ss.fff'))" }); states = $states } | ConvertTo-Json -Compress))
      Start-Sleep -Seconds 1
    }
  } finally {
    $th = [CgJobFreeze]::Set($job, $false)
    $log.Add("thaw_status=0x$('{0:X8}' -f $th)")
  }
  $log -join "`n"
} $Seconds
$r
if ($Out) { Set-Content -LiteralPath $Out -Value $r -Encoding utf8 }
