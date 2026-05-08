$ErrorActionPreference = 'Stop'
Import-Module BcContainerHelper -RequiredVersion 6.1.11
$bcContainerHelperConfig.usePwshForBc24 = $false

$ContainerName = 'Cronus28'

Write-Host 'Uninstalling CG xRec Spikes from Cronus28...' -ForegroundColor Cyan
try {
    Uninstall-BcContainerApp -containerName $ContainerName -name 'CG xRec Spikes' -force -ErrorAction SilentlyContinue
    Unpublish-BcContainerApp -containerName $ContainerName -name 'CG xRec Spikes' -force -ErrorAction SilentlyContinue
    Write-Host 'Cleanup done.' -ForegroundColor Green
} catch {
    Write-Host "Cleanup error (may be already gone): $_" -ForegroundColor Yellow
}
