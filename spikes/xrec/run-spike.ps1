$ErrorActionPreference = 'Stop'

# Pin to 6.1.11; 6.1.12+ disables PSSession for BC v28
Import-Module BcContainerHelper -RequiredVersion 6.1.11
$bcContainerHelperConfig.usePwshForBc24 = $false

$ContainerName = 'Cronus28'
$AppFolder     = 'U:\Git\CentralGauge\spikes\xrec'
$AppFile       = Join-Path $AppFolder 'CentralGauge_CG xRec Spikes_1.0.0.0.app'
$AppId         = 'abcd1234-9999-0000-0000-000000000001'
$CompilerCacheRoot = 'C:\bcArtifacts.cache'

Write-Host '=== Step 1: artifact URL ===' -ForegroundColor Cyan
$artifactUrl = Get-BcContainerArtifactUrl -containerName $ContainerName
Write-Host "ArtifactUrl: $artifactUrl"

Write-Host '=== Step 2: create compiler folder ===' -ForegroundColor Cyan
$CompilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl -includeTestToolkit -containerName $ContainerName -cacheFolder $CompilerCacheRoot
Write-Host "CompilerFolder: $CompilerFolder"

Write-Host '=== Step 3: compile spike app ===' -ForegroundColor Cyan
$compiledFile = Compile-AppWithBcCompilerFolder -compilerFolder $CompilerFolder -appProjectFolder $AppFolder -appOutputFolder $AppFolder -appSymbolsFolder (Join-Path $CompilerFolder 'symbols')
Write-Host "Produced: $compiledFile"

Write-Host '=== Step 4: uninstall any prior install ===' -ForegroundColor Cyan
try {
    Uninstall-BcContainerApp -containerName $ContainerName -name 'CG xRec Spikes' -force -ErrorAction SilentlyContinue
    Unpublish-BcContainerApp -containerName $ContainerName -name 'CG xRec Spikes' -force -ErrorAction SilentlyContinue
} catch { Write-Host "Pre-clean: $_" }

Write-Host '=== Step 5: publish + sync + install ===' -ForegroundColor Cyan
Publish-BcContainerApp -containerName $ContainerName -appFile $compiledFile -skipVerification -sync -install -credential (New-Object pscredential('sshadows', (ConvertTo-SecureString '1234' -AsPlainText -Force)))

Write-Host '=== Step 6: run spike tests ===' -ForegroundColor Cyan
$sharedFolder = $bcContainerHelperConfig.hostHelperFolder
$resultsFile = Join-Path $sharedFolder 'spike-results.xml'
if (Test-Path $resultsFile) { Remove-Item $resultsFile }

Run-TestsInBcContainer `
    -containerName $ContainerName `
    -credential (New-Object pscredential('sshadows', (ConvertTo-SecureString '1234' -AsPlainText -Force))) `
    -extensionId $AppId `
    -testCodeunit 90099 `
    -XUnitResultFileName $resultsFile `
    -detailed `
    -returnTrueIfAllPassed:$false `
    -ErrorAction Continue 2>&1 | Tee-Object -Variable runOutput | Write-Host

Write-Host '=== Step 7: dump XUnit results ===' -ForegroundColor Cyan
if (Test-Path $resultsFile) {
    Get-Content $resultsFile -Raw
} else {
    Write-Host '(no XUnit file produced)'
}

Write-Host '=== DONE ===' -ForegroundColor Green
