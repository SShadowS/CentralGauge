# H-107: registers the hourly scheduled task "cg-coord-reaper" (owner-approved 2026-11-16). Non-elevated, current
# user, runs only while the user is logged on, hidden pwsh window, one reaper.ps1 pass per hour (dry-run unless
# H:\cg-coord\jobs\reaper\MODE says "kill"). Remove: Unregister-ScheduledTask -TaskName cg-coord-reaper -Confirm:$false
# conhost --headless: pwsh -WindowStyle Hidden still flashes a console (it exists before pwsh can hide it).
$a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\conhost.exe' `
  -Argument '--headless "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -NonInteractive -File H:\cg-coord\jobs\reaper\reaper.ps1' `
  -WorkingDirectory 'H:\cg-coord\jobs\reaper'
$t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Force -TaskName 'cg-coord-reaper' -Description 'H-107 orphan reaper (lane-ops), hourly, dry-run by default' `
  -Action $a -Trigger $t -Principal $p -Settings $s | Out-Null
Get-ScheduledTask -TaskName 'cg-coord-reaper' | ForEach-Object { "{0} {1} next {2}" -f $_.TaskName, $_.State, (Get-ScheduledTaskInfo $_).NextRunTime }
