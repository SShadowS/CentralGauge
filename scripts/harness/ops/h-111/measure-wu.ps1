# H-111 step 1 (read-only, runs INSIDE a container via docker exec): Windows Update facts. Changes nothing.
'== services'
foreach ($n in 'wuauserv', 'UsoSvc', 'WaaSMedicSvc', 'BITS', 'TrustedInstaller', 'DoSvc') {
  $s = Get-CimInstance Win32_Service -Filter "Name='$n'" -ErrorAction SilentlyContinue
  if ($s) { '{0} start={1} state={2} delayed={3}' -f $n, $s.StartMode, $s.State, $s.DelayedAutoStart } else { "$n absent" }
}
'== wuauserv triggers'
sc.exe qtriggerinfo wuauserv
'== UsoSvc triggers'
sc.exe qtriggerinfo UsoSvc
'== System log: service state changes for update services (7036/7040/7042)'
$names = 'Windows Update|Update Orchestrator|Windows Update Medic|Background Intelligent|Windows Modules Installer|Delivery Optimization'
Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 7036, 7040, 7042 } -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match $names } |
  ForEach-Object { '{0} id={1} {2}' -f $_.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $_.Id, ($_.Message -replace '\s+', ' ') }
'== System log oldest event'
(Get-WinEvent -LogName System -Oldest -MaxEvents 1).TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
'== scheduled tasks under UpdateOrchestrator / WindowsUpdate / WaaSMedic'
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskPath -match 'UpdateOrchestrator|WindowsUpdate|WaaSMedic' } |
  ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; '{0}{1} state={2} last={3} next={4}' -f $_.TaskPath, $_.TaskName, $_.State, $i.LastRunTime, $i.NextRunTime }
'== C:\Windows\Temp'
$d = Get-Item 'C:\Windows\Temp'
'dir LastWriteTimeUtc={0} attrs={1}' -f $d.LastWriteTimeUtc.ToString('o'), [int]$d.Attributes
Get-ChildItem 'C:\Windows\Temp' -Force -ErrorAction SilentlyContinue | ForEach-Object { '  {0} {1} {2}' -f $_.Name, $_.Length, $_.LastWriteTimeUtc.ToString('o') }
'== C:\Windows\SoftwareDistribution'
if (Test-Path 'C:\Windows\SoftwareDistribution') {
  Get-ChildItem 'C:\Windows\SoftwareDistribution' -Force -ErrorAction SilentlyContinue | ForEach-Object { '  {0} {1}' -f $_.Name, $_.LastWriteTimeUtc.ToString('o') }
} else { 'absent' }
'== WindowsUpdate policy keys'
foreach ($k in 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate', 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU') {
  if (Test-Path $k) { "$k"; Get-ItemProperty $k | Format-List | Out-String -Width 200 } else { "$k absent" }
}
