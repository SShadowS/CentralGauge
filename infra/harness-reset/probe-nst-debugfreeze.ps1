param(
  [Parameter(Mandatory)][string]$Container,
  [int]$Seconds = 70,
  # Exit WITHOUT DebugActiveProcessStop: the killed-holder path (DebugSetProcessKillOnExit(FALSE) must detach on exit)
  [switch]$NoDetach,
  [string]$Out
)
# H-35 run 004 PROBE (owner addendum 5 option (i); lane-ops, leased container, not product code): does attaching as a
# debugger (DebugActiveProcess + DebugBreakProcess, never ContinueDebugEvent) freeze the NST, including threads the
# thread pool creates meanwhile? DebugSetProcessKillOnExit(FALSE): when this holder exits or is killed, the system
# detaches and the NST runs on. Polls the NST threads every second for $Seconds (span >= 2 healthcheck ticks), then
# detaches (unless -NoDetach). One JSON line per poll plus status lines; also to $Out when given.
$ErrorActionPreference = 'Stop'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')

$r = Invoke-InContainer $Container { param($secs, $noDetach)
  if (-not ('CgDebugFreeze' -as [type])) {
    Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CgDebugFreeze {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugActiveProcess(int pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugActiveProcessStop(int pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugSetProcessKillOnExit(bool kill);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugBreakProcess(IntPtr proc);
  // DEBUG_EVENT is large; only the code is read here
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool WaitForDebugEvent(byte[] ev, int ms);
  public static int Err() { return Marshal.GetLastWin32Error(); }
}
'@
  }
  $log = [Collections.Generic.List[string]]::new()
  $p = @(Get-Process -Name 'Microsoft.Dynamics.Nav.Server')[0]
  $log.Add("pid=$($p.Id) threads_before=$(@($p.Threads).Count)")
  $att = [CgDebugFreeze]::DebugActiveProcess($p.Id); $log.Add("attach=$att err=$([CgDebugFreeze]::Err())")
  $k = [CgDebugFreeze]::DebugSetProcessKillOnExit($false); $log.Add("killOnExit(false)=$k err=$([CgDebugFreeze]::Err())")
  $b = [CgDebugFreeze]::DebugBreakProcess($p.Handle); $log.Add("break=$b err=$([CgDebugFreeze]::Err())")
  # read the first pending event (CREATE_PROCESS) without continuing: the debuggee stays stopped
  $ev = New-Object byte[] 4096
  $w = [CgDebugFreeze]::WaitForDebugEvent($ev, 5000); $log.Add("first_event=$w code=$([BitConverter]::ToInt32($ev, 0)) err=$([CgDebugFreeze]::Err())")
  try {
    $t0 = Get-Date
    $seen = @{}
    while (((Get-Date) - $t0).TotalSeconds -lt $secs) {
      $p.Refresh()
      $th = @($p.Threads)
      $new = @($th | Where-Object { -not $seen.ContainsKey($_.Id) })
      foreach ($x in $th) { $seen[$x.Id] = $true }
      $states = ($th | Group-Object { "$($_.ThreadState)/$($_.WaitReason)" } | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ','
      $cpu = [Math]::Round($p.TotalProcessorTime.TotalMilliseconds)
      $log.Add((@{ t = [int]((Get-Date) - $t0).TotalSeconds; threads = $th.Count; cpu_ms = $cpu; new = @($new | ForEach-Object { "$($_.Id)@$($_.StartTime.ToString('HH:mm:ss.fff'))" }); states = $states } | ConvertTo-Json -Compress))
      Start-Sleep -Seconds 1
    }
  } finally {
    if (-not $noDetach) {
      $d = [CgDebugFreeze]::DebugActiveProcessStop($p.Id); $log.Add("detach=$d err=$([CgDebugFreeze]::Err())")
    } else { $log.Add('exit without detach (killed-holder path)') }
  }
  $log -join "`n"
} $Seconds, ([bool]$NoDetach)
$r
if ($Out) { Set-Content -LiteralPath $Out -Value $r -Encoding utf8 }
