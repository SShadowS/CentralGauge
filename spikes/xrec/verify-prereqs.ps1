$ErrorActionPreference = 'Stop'
Import-Module BcContainerHelper -RequiredVersion 6.1.11
$bcContainerHelperConfig.usePwshForBc24 = $false

$artifactUrl = Get-BcContainerArtifactUrl -containerName Cronus28
$cf = New-BcCompilerFolder -artifactUrl $artifactUrl -includeTestToolkit -containerName Cronus28 -cacheFolder C:\bcArtifacts.cache

$repoRoot = (Get-Location).Path
$projects = @(
    Join-Path $repoRoot 'tests\al\dependencies\CG-AL-M043'
    Join-Path $repoRoot 'tests\al\dependencies\CG-AL-M044'
    Join-Path $repoRoot 'tests\al\dependencies\CG-AL-M045'
    Join-Path $repoRoot 'tests\al\dependencies\CG-AL-H027'
)

$results = @()
foreach ($p in $projects) {
    Write-Host "=== Compiling $p ===" -ForegroundColor Cyan
    try {
        Compile-AppWithBcCompilerFolder -compilerFolder $cf -appProjectFolder $p -appOutputFolder $p -appSymbolsFolder (Join-Path $cf 'symbols') | Out-Null
        $results += [pscustomobject]@{ Project = $p; Result = 'PASS' }
    } catch {
        $results += [pscustomobject]@{ Project = $p; Result = "FAIL: $_" }
    }
}

Write-Host '=== SUMMARY ===' -ForegroundColor Yellow
$results | Format-Table -AutoSize
