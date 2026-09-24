# Project-wide Harness Bench status without an LLM.
#   pwsh -File U:\Git\CentralGauge\scripts\coord\status.ps1            one snapshot
#   pwsh -File U:\Git\CentralGauge\scripts\coord\status.ps1 -Watch 30  refresh every 30 s
param([int]$Watch = 0, [string]$CoordRoot = $(if ($env:CG_COORD_ROOT) { $env:CG_COORD_ROOT } else { 'H:\cg-coord' }))
$env:CG_COORD_ROOT = $CoordRoot
$coord = Join-Path $PSScriptRoot 'coord.ts'
if ($Watch -gt 0) { & deno run --allow-all $coord overview --watch $Watch } else { & deno run --allow-all $coord overview }
