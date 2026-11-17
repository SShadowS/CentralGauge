# H-110 step 1 (read-only): per-variant phase times from the M8-21 qualify verdict records. One TSV row per verdict:
# part, container, judgment start (UTC), variant kind, wall minutes, spans (s), reset count and summed reset phases (s).
# Reads only ids, counts and timings. Usage: pwsh -File phase-table.ps1 > phase-table.tsv
$q = 'H:\cg-coord\results\harness\qualify'
$parts = @{ front = '52086e5c'; b1 = '1f581c84'; b2 = '3a0457e3' }
$rphases = 'snapshot_guard', 'quiesce', 'verify_sha', 'stop', 'restore', 'start', 'healthy', 'runner_verify', 'postconditions'
$head = @('part', 'container', 'start_utc', 'kind', 'wall_min', 'reconstruct_s', 'provisioning_s', 'compile_s', 'publish_s', 'test_s', 'queue_s', 'total_s', 'resets', 'reset_s') + ($rphases | ForEach-Object { "r_$_" })
$head -join "`t"
foreach ($p in $parts.GetEnumerator() | Sort-Object Name) {
  $dir = (Get-ChildItem $q -Directory | Where-Object Name -like "$($p.Value)*").FullName
  $ix = Get-Content "$dir\index.json" -Raw | ConvertFrom-Json
  $kind = @{}
  foreach ($e in $ix.entries) {
    $jid = ($e.judgment_path -split '/')[-2]
    $kind[$jid] = if ($e.variant -eq 'reference-tests') { 'test-authoring' } elseif ($e.variant -like 'naive/*') { 'naive' } else { 'correct' }
    if ($e.variant -like 'naive/*' -and $ix.entries.Where({ $_.task -eq $e.task -and $_.variant -eq 'reference-tests' }).Count) { $kind[$jid] = 'naive-ta' }
  }
  foreach ($f in Get-ChildItem "$dir\verdicts" -Filter *.json -ErrorAction SilentlyContinue) {
    $v = Get-Content $f.FullName -Raw | ConvertFrom-Json
    $jf = Get-ChildItem 'H:\cg-coord\results\harness\fixtures' -Recurse -Directory -Filter $v.judgment_id -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $jf) { continue }
    $j = Get-Content "$($jf.FullName)\judgment.json" -Raw | ConvertFrom-Json
    $s = $v.spans; $rs = @($v.resets)
    $sum = @{}; foreach ($ph in $rphases) { $sum[$ph] = ($rs | ForEach-Object { $_.phases_ms.$ph } | Measure-Object -Sum).Sum / 1000 }
    $row = @($p.Name, ($v.containers | Select-Object -First 1), ([datetime]$j.started_at).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'),
      $kind[$v.judgment_id], [Math]::Round(([datetime]$j.ended_at - [datetime]$j.started_at).TotalMinutes, 2),
      [Math]::Round($s.reconstruct_ms / 1000, 1), [Math]::Round($s.provisioning_ms / 1000, 1), [Math]::Round($s.compile_ms / 1000, 1),
      [Math]::Round($s.candidate_publish_ms / 1000, 1), [Math]::Round($s.test_ms / 1000, 1), [Math]::Round($s.queue_ms / 1000, 1),
      [Math]::Round($s.total_ms / 1000, 1), $rs.Count, [Math]::Round(($sum.Values | Measure-Object -Sum).Sum, 1)) + ($rphases | ForEach-Object { [Math]::Round($sum[$_], 1) })
    $row -join "`t"
  }
}
