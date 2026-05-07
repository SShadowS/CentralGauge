<#
.SYNOPSIS
  Discover vendor-prefixed model slugs from a debug dir of *-session-*.jsonl files.

.DESCRIPTION
  Scans every *.jsonl under -DebugDir, extracts provider/model from the first
  record that has them, and prints unique vendor-prefixed slugs (one per line).

.EXAMPLE
  .\cycle-discover.ps1 -DebugDir H:\Temp3
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$DebugDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $DebugDir)) { throw "DebugDir not found: $DebugDir" }

$slugs = New-Object System.Collections.Generic.HashSet[string]

# Known LLM providers — filename prefix MUST be one of these.
# `compilation-*.jsonl` and `tests-*.jsonl` are kind-based, not provider-based:
# they carry `provider: "compilation"` / `provider: "tests"` (the file kind),
# which would synthesize bogus slugs like `compilation/claude-opus-4-7`.
$llmProviders = @(
  'anthropic', 'openai', 'openrouter', 'gemini', 'google', 'azure-openai',
  'azure', 'local', 'mock', 'xai', 'x-ai', 'deepseek', 'qwen'
)

Get-ChildItem -Path $DebugDir -Filter *.jsonl -File | Where-Object {
  $prefix = ($_.Name -split '-', 2)[0]
  $llmProviders -contains $prefix
} | ForEach-Object {
  # First pass: find a record that carries `provider` (debug_session_start
  # or any record that includes it). Provider is invariant per file because
  # the filename is `${provider}-${ts}-session-*.jsonl`.
  $provider = $null
  $reader = [System.IO.File]::OpenText($_.FullName)
  try {
    while (-not $reader.EndOfStream -and -not $provider) {
      $line = $reader.ReadLine()
      if (-not $line) { continue }
      try {
        $rec = $line | ConvertFrom-Json -ErrorAction Stop
      } catch { continue }
      if ($rec.provider) { $provider = $rec.provider }
    }
  } finally { $reader.Dispose() }

  if (-not $provider) { return }

  # Second pass: collect every distinct `model` (or `config.model`) record.
  # A single provider file holds one model per request, but multiple models
  # may share the same provider file across the session — scan everything.
  $reader = [System.IO.File]::OpenText($_.FullName)
  try {
    while (-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if (-not $line) { continue }
      try {
        $rec = $line | ConvertFrom-Json -ErrorAction Stop
      } catch { continue }

      $model = $rec.model
      if (-not $model -and $rec.config) { $model = $rec.config.model }
      if (-not $model) { continue }

      $null = $slugs.Add("$provider/$model")
    }
  } finally { $reader.Dispose() }
}

$slugs | Sort-Object
