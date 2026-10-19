param(
  [Parameter(Mandatory)][string]$Container,
  [Parameter(Mandatory)][string]$OutDir,
  [Parameter(Mandatory)][string]$Name,
  # The discovery survey artifact (decision 2026-10-20 item 5), copied next to the lineage as <Name>.survey.json.
  [Parameter(Mandatory)][string]$Survey
)
# H-35 S3 L4 (lane-ops, building a lineage, on a container right after a verified reset to its golden): print the
# lineage's `fs` section as JSON: the W roots resolved on this image, the NST identity measurement, the fsDigest
# version, no exclusions (add each with a disposition only from a measured difference), and the survey's sha256.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT = 'desktop-windows' }
Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue *> $null
. (Join-Path $PSScriptRoot 'reset-lib.ps1')
. (Join-Path $PSScriptRoot 'fs-digest.ps1')

$roots = @(Get-FsDigestCandidateRoots $Container)
$identity = @(Get-FsDigestFacts $Container $roots | Where-Object { $_ -like 'service_*' })
$surveyFile = Join-Path $OutDir "$Name.survey.json"
Copy-Item -LiteralPath $Survey -Destination $surveyFile
[ordered]@{
  digest_version = $FsDigestVersion
  roots          = $roots
  identity       = $identity
  exclude        = @()
  survey         = [ordered]@{ path = "$Name.survey.json"; sha256 = (Get-FileHash $surveyFile -Algorithm SHA256).Hash.ToLower() }
} | ConvertTo-Json -Depth 4
