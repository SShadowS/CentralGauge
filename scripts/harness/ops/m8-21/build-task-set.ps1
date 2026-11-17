# M8-21 Step 5: builds the freeze record (plan M8-21 Step 5 shape) as JSON on stdout. Read-only; the caller reviews it
# and writes H:\Temp3\harness-spike\M8\freeze\task-set.json with the Write tool. Inputs:
#   selection  H:\Temp3\harness-spike\M8\selection\m8-19t\selection-n40.json (owner-approved, decisions\2026-11-14-n39-selection.md)
#   gates      the Step 4 rows (-Step4, from m821-step4.ts): latest promoted Step 1 report per task + derived procedures
#   pipeline   the three Step 3 indexes (front, b1, b2) under H:\cg-coord\results\harness\qualify
param([Parameter(Mandatory)][string]$Step4, [string[]]$Deviations = @())
$ErrorActionPreference = 'Stop'
$rev = '2fb244fef52548979754541f471d44d089f3d3f3'; $m8 = 'H:\cg-coord\m8\freeze-m8-21'; $q = 'H:\cg-coord\results\harness\qualify'
$repo = 'U:\Git\CentralGauge-wt\lane-ops'
$sel = Get-Content 'H:\Temp3\harness-spike\M8\selection\m8-19t\selection-n40.json' -Raw | ConvertFrom-Json
$pipe = @{}
foreach ($s in 'front', 'b1', 'b2') {
  $ix = "$q\$((Get-FileHash "$m8\qualify-manifest-$s.json").Hash.ToLower())\index.json"
  if (-not (Test-Path $ix)) { continue }
  foreach ($e in (Get-Content $ix -Raw | ConvertFrom-Json).entries) {
    if (-not $pipe.ContainsKey($e.task)) { $pipe[$e.task] = [Collections.Generic.List[object]]::new() }
    $pipe[$e.task].Add([ordered]@{ variant = $e.variant; verdict = $e.verdict; expected = $e.expected })
  }
}
$tasks = foreach ($row in Get-Content $Step4 | Where-Object { $_ -match '^HX-\d+\t' }) {
  $c = $row -split "`t"; $g = Get-Content $c[5] -Raw | ConvertFrom-Json
  if ($g.source_commit -ne $rev -or $g.tag_status -ne 'match') { throw "$($c[0]): gate report $($c[5]) source_commit $($g.source_commit) tag_status $($g.tag_status)" }
  [ordered]@{
    id = $c[0]; gate_report = $c[5]; promoted = [bool]$g.promoted
    pipeline = @($pipe[$c[0]] | Sort-Object { $_.variant })
    new_requirement_procedures = @($c[4] | ConvertFrom-Json)
  }
}
[ordered]@{
  refapp_version = 'refapp-v2'; commit = $rev
  refapp_tree = (git -C $repo rev-parse "refapp-v2:harness-tasks/refapp").Trim()
  task_set_hash = '098ffb70afae'  # step2-validate.log: "[OK] 152 tasks, task set 098ffb70afae"
  n = @($sel.selection.selected).Count
  confirmatory = @($sel.selection.selected); held_out = @($sel.held_out)
  by_stratum = $sel.selection.by_stratum
  deviations = @(@($sel.selection.deviations) + @($sel.selection.shortfalls | ForEach-Object { "shortfall: $_" }) + $Deviations)
  seals = @($sel.seals)
  excluded_experiments = @($sel.campaigns.experiment | Where-Object { $_ -like 'v2-screen-*' } | Sort-Object -Unique)
  tasks = @($tasks | Sort-Object { $_.id })
} | ConvertTo-Json -Depth 6
