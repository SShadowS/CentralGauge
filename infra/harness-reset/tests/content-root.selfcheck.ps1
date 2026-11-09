param([string]$Dir = (Split-Path -Parent $PSScriptRoot))
# Host-only self-check of Get-ContentRootTolerance (H-84), no container:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra\harness-reset\tests\content-root.selfcheck.ps1
$ErrorActionPreference = 'Stop'
. (Join-Path $Dir 'reset-lib.ps1')
. (Join-Path $Dir 'content-root.ps1')
function Assert($cond, $msg) { if (-not $cond) { throw "FAIL: $msg" } }
$TABLE = '$ndo$taskscheduling'
$ROW = '3B03CE83E23A588F69B96B6E1B0119C2F94AC56C28084B8E1F7DE492B1616731'
function T([string]$name, [string]$h) { [pscustomobject]@{ t = $name; n = 1; h = $h; ms = 0; err = $null } }
function Tables([string]$ts, [string]$a = 'AAAA', [string]$name = $TABLE) { @((T 'Item' $a), (T $name $ts), (T 'Active Session' 'volatile')) }
$ex = @('Active Session')
function Tol($live, [string]$recorded, [string]$liveRoot = '') {
  $stored = @{ 'Item' = 'AAAA'; $TABLE = $recorded }
  $expected = Get-GoldenContentRoot (Tables $recorded) $ex
  Get-ContentRootTolerance $live $ex $stored $expected
}

# the row purged by the platform, the lineage records it: accepted, and says what it accepted
$r = Tol (Tables 'empty') $ROW
Assert ($null -ne $r) 'purged row: accepted'
Assert ($r.table -ceq $TABLE -and $r.observed -ceq 'empty' -and $r.policy -ceq $ContentRootEmptyPolicy.id) "purged row: provenance $r"
Assert ($r.policy -match '^[a-z0-9-]+$') "policy id shape: $($r.policy)"
# the root it would report as the observed one still differs from the lineage's
Assert ((Get-GoldenContentRoot (Tables 'empty') $ex) -cne (Get-GoldenContentRoot (Tables $ROW) $ex)) 'raw root differs'
# the input is not rewritten
$live = Tables 'empty'
Tol $live $ROW | Out-Null
Assert ($live[1].h -ceq 'empty') 'the live rows stay as observed'

# asymmetric (the v3 direction): the lineage records empty, a row is present
Assert ($null -eq (Tol (Tables $ROW) 'empty')) 'lineage empty, live row: refused'
# an altered row still present at the read
Assert ($null -eq (Tol (Tables 'DEADBEEF') $ROW)) 'altered row present: refused'
# any other table's mismatch, alone or beside a purged row
Assert ($null -eq (Tol (Tables $ROW 'BBBB') $ROW)) 'other table differs: refused'
Assert ($null -eq (Tol (Tables 'empty' 'BBBB') $ROW)) 'other table differs beside a purged row: refused'
# another table emptied is not accepted
$other = @((T 'Item' 'empty'), (T $TABLE $ROW), (T 'Active Session' 'v'))
Assert ($null -eq (Tol $other $ROW)) 'another table emptied: refused'
# a similar name is not this table
Assert ($null -eq (Tol (Tables 'empty' 'AAAA' '$NDO$TASKSCHEDULING') $ROW)) 'other case: refused'
Assert ($null -eq (Tol (Tables 'empty' 'AAAA' '$ndo$taskscheduling2') $ROW)) 'longer name: refused'
# the table absent from the live set
$gone = @((T 'Item' 'AAAA'), (T 'Active Session' 'v'))
Assert ($null -eq (Tol $gone $ROW)) 'table absent: refused'
# the sidecar's hash is bound by the lineage root: a wrong one cannot pass
$expected = Get-GoldenContentRoot (Tables $ROW) $ex
$lie = @{ 'Item' = 'AAAA'; $TABLE = 'CAFE' }
Assert ($null -eq (Get-ContentRootTolerance (Tables 'empty') $ex $lie $expected)) 'a sidecar not matching the lineage root: refused'
# the sidecar has no row for it
Assert ($null -eq (Get-ContentRootTolerance (Tables 'empty') $ex @{ 'Item' = 'AAAA' } $expected)) 'nothing recorded: refused'
'CONTENT ROOT SELFCHECK OK'
