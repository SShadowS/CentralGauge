# M8-21 Step 3 acceptance (decisions\2026-11-17-m8-21-back-resplit.md), read-only. For each part (front, b1, b2):
# index exists for the manifest sha, 0 bad entries (verdict == expected, rev 2fb244fe, judgment file present), exact
# coverage of its manifest; then union of the parts == e01239c1 with no duplicates; one harness_commit (d32bb274),
# lineage golden-o09-v2 and env_fp 2552e6986e78 across every part. Parts without an index yet are reported, not failed.
$m8 = 'H:\cg-coord\m8\freeze-m8-21'; $q = 'H:\cg-coord\results\harness\qualify'; $fx = 'H:\cg-coord\results\harness'
$full = 'H:\Temp3\harness-spike\M8\freeze\qualify-manifest.json'
$rev = '2fb244fef52548979754541f471d44d089f3d3f3'; $head = 'd32bb274390860ec63d5b0b636658551612d3d3e'
$fails = [Collections.Generic.List[string]]::new()
function Want($path) { # manifest -> @{ 'HX-1/variant' = 'pass'|'fail' }
  $w = @{}; $t = (Get-Content $path -Raw | ConvertFrom-Json).tasks
  foreach ($p in $t.PSObject.Properties) {
    if ($p.Value.rev -ne $rev) { $fails.Add("$path $($p.Name) rev $($p.Value.rev)") }
    $w["$($p.Name)/$($p.Value.positive)"] = 'pass'; foreach ($n in $p.Value.naive) { $w["$($p.Name)/naive/$n"] = 'fail' }
  }
  $w
}
$all = Want $full; $fullSha = (Get-FileHash $full).Hash.ToLower()
if (-not $fullSha.StartsWith('e01239c1')) { $fails.Add("full manifest sha $fullSha") }
$seen = @{}; $done = 0; $commits = @{}; $pins = @{}
foreach ($s in 'front', 'b1', 'b2') {
  $mf = "$m8\qualify-manifest-$s.json"; $sha = (Get-FileHash $mf).Hash.ToLower(); $want = Want $mf
  $ix = "$q\$sha\index.json"
  if (-not (Test-Path $ix)) { "{0}: no index yet ({1}, {2} variants)" -f $s, $sha.Substring(0, 8), $want.Count; continue }
  $j = Get-Content $ix -Raw | ConvertFrom-Json; $bad = 0; $keys = @{}
  if ($j.manifest_sha256 -ne $sha) { $fails.Add("$s index manifest_sha256 $($j.manifest_sha256)") }
  foreach ($e in $j.entries) {
    $k = "$($e.task)/$($e.variant)"
    if ($keys.ContainsKey($k)) { $fails.Add("$s duplicate $k") }; $keys[$k] = 1
    if ($seen.ContainsKey($k)) { $fails.Add("$s $k also in $($seen[$k])") } else { $seen[$k] = $s }
    $jp = Join-Path $fx (($e.judgment_path -replace '^.*?(fixtures/)', '$1') -replace '/', '\')
    $why = @()
    if ($e.verdict -notin 'pass', 'fail' -or $e.verdict -ne $e.expected) { $why += "verdict $($e.verdict) expected $($e.expected)" }
    if ($want.ContainsKey($k) -and $want[$k] -ne $e.expected) { $why += "manifest expects $($want[$k])" }
    if ($e.rev -ne $rev) { $why += "rev $($e.rev)" }
    if (-not (Test-Path -LiteralPath $jp)) { $why += "no judgment file" }
    if ($why) { $bad++; $fails.Add("$s bad $k : $($why -join '; ')") }
  }
  $miss = @($want.Keys | Where-Object { -not $keys.ContainsKey($_) }); $extra = @($keys.Keys | Where-Object { -not $want.ContainsKey($_) })
  foreach ($m in $miss) { $fails.Add("$s missing $m") }; foreach ($x in $extra) { $fails.Add("$s not in its manifest $x") }
  Select-String -Path "$q\$sha\runs\*\*.json" -Pattern '"harness_commit":\s*"([0-9a-f]+)"' | ForEach-Object { $commits["$s $($_.Matches[0].Groups[1].Value)"] = 1 }
  # The b parts write no env-pins dir, so lineage and env_fp come from the run log (and the env_fp in every run record).
  $fs = [IO.File]::Open("H:\cg-coord\tasks\M8-21\ops\qualify-$s.log", 'Open', 'Read', 'ReadWrite'); $lg = (New-Object IO.StreamReader($fs)).ReadToEnd(); $fs.Close()
  $lin = @([regex]::Matches($lg, 'environment: lineage (\S+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
  $efp = @([regex]::Matches($lg, '\[OK\] Cronus\d+ env_fp ([0-9a-f]{12})') | ForEach-Object { $_.Groups[1].Value })
  $efp += @(Select-String -Path "$q\$sha\runs\*\*.json" -Pattern '"env_fp":\s*"([0-9a-f]{12})' | ForEach-Object { $_.Matches[0].Groups[1].Value })
  if (-not $lin -or -not $efp) { $fails.Add("$s no lineage or env_fp found") }
  foreach ($l in $lin) { foreach ($e2 in @($efp | Select-Object -Unique)) { $pins["$s $l $e2"] = 1 } }
  $done++; "{0}: index {1}, {2} entries, {3} bad, {4} missing, {5} extra" -f $s, $sha.Substring(0, 8), @($j.entries).Count, $bad, $miss.Count, $extra.Count
}
foreach ($c in $commits.Keys) { if ($c -notmatch " $head$") { $fails.Add("harness_commit $c") } }
foreach ($p in $pins.Keys) { if ($p -notmatch ' golden-o09-v2 2552e6986e78$') { $fails.Add("env pin $p") } }
"harness_commit: $(($commits.Keys | Sort-Object) -join ', ')"; "env pins: $(($pins.Keys | Sort-Object) -join ', ')"
if ($done -eq 3) {
  $un = @($all.Keys | Where-Object { -not $seen.ContainsKey($_) }); $ov = @($seen.Keys | Where-Object { -not $all.ContainsKey($_) })
  foreach ($u in $un) { $fails.Add("e01239c1 not covered $u") }; foreach ($o in $ov) { $fails.Add("not in e01239c1 $o") }
  "union: $($seen.Count) of $($all.Count) e01239c1 variants, $($un.Count) uncovered, $($ov.Count) extra"
}
if ($fails.Count) { "FAIL ($($fails.Count)):"; $fails | ForEach-Object { "  $_" }; exit 1 }
if ($done -eq 3) { 'ACCEPTED: all three indexes pass' } else { "OK so far ($done of 3 indexes)" }
