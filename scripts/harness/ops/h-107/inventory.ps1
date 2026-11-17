# H-107 read-only inventory: bash/sh/sleep processes with creation time, parent chain and whether a live
# claude.exe is an ancestor. Command lines are cut to 160 chars and any "--coord-lease X=..." value is masked.
$all = @{}
Get-CimInstance Win32_Process | ForEach-Object { $all[[int]$_.ProcessId] = $_ }
function Chain([int]$id) {
  $out = @(); $seen = @{}
  while ($all.ContainsKey($id) -and -not $seen.ContainsKey($id)) {
    $seen[$id] = 1; $p = $all[$id]
    $pp = [int]$p.ParentProcessId
    # A parent created after the child is a reused PID, not the real parent.
    if ($all.ContainsKey($pp) -and $all[$pp].CreationDate -gt $p.CreationDate) { break }
    $id = $pp; if ($all.ContainsKey($id)) { $out += $all[$id].Name }
  }
  $out
}
$all.Values | Where-Object { $_.Name -in @("bash.exe", "sh.exe", "sleep.exe") } | Sort-Object CreationDate | ForEach-Object {
  $c = Chain ([int]$_.ProcessId)
  $cl = ($_.CommandLine -replace '(--coord-lease\s+\S+=)\S+', '$1***')
  [pscustomobject]@{
    pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name
    created = $_.CreationDate.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    claude_ancestor = ($c -contains "claude.exe")
    chain = ($c -join "<")
    cmd = if ($cl) { $cl.Substring(0, [Math]::Min(160, $cl.Length)) } else { "" }
  }
} | Format-Table -AutoSize -Wrap | Out-String -Width 400
