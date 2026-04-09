/**
 * PowerShell script builders for BC container operations.
 * These pure functions generate PowerShell scripts used by BcContainerProvider.
 */

import type { ContainerCredentials } from "./types.ts";

/**
 * Build the PowerShell script for compiling an AL project
 */
export function buildCompileScript(
  compilerFolder: string,
  projectPath: string,
  outputDir: string,
): string {
  return `
      Import-Module bccontainerhelper -WarningAction SilentlyContinue

      try {
        $result = Compile-AppWithBcCompilerFolder \`
          -compilerFolder "${compilerFolder}" \`
          -appProjectFolder "${projectPath}" \`
          -appOutputFolder "${outputDir}" \`
          -ErrorAction Stop 2>&1

        # Check for compiled app file
        $appFile = Get-ChildItem -Path "${outputDir}" -Filter "*.app" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($appFile) {
          Write-Output "COMPILE_SUCCESS"
          Write-Output "APP_FILE:$($appFile.FullName)"
        } else {
          Write-Output "COMPILE_ERROR"
          Write-Output "ERROR:No .app file was generated"
        }
      } catch {
        Write-Output "COMPILE_ERROR"
        Write-Output "ERROR:$($_.Exception.Message)"
        # Output the full error for parsing
        $_ | Out-String | ForEach-Object { Write-Output "DETAIL:$_" }
      }
    `;
}

/**
 * Build the publish app script block
 */
export function buildPublishScript(
  containerName: string,
  escapedAppFile: string,
): string {
  return `
      # Unpublish existing apps that might conflict, EXCEPT prereqs (which we depend on)
      # Prereq apps have "Prereq" in their name by convention
      # Clean up:
      # 1. CentralGauge apps (from our benchmarks)
      # 2. Apps with common default publishers that agents might use
      # 3. Apps with task-related names like "Task App"
      $publishersToClean = @("CentralGauge", "Default Publisher", "Default", "")
      $conflictApps = @(Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object {
        ($publishersToClean -contains $_.Publisher -or $_.Name -like "*Task*") -and
        $_.Name -notlike "*Prereq*" -and
        $_.Publisher -ne "Microsoft"
      })
      foreach ($app in $conflictApps) {
        try {
          Write-Output "CLEANUP:Removing $($app.Name) by $($app.Publisher)"
          Unpublish-BcContainerApp -containerName "${containerName}" -appName $app.Name -publisher $app.Publisher -version $app.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
        } catch { }
      }

      # Publish the app with ForceSync for destructive schema changes
      try {
        Write-Output "PUBLISH_START:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        Publish-BcContainerApp -containerName "${containerName}" -appFile "${escapedAppFile}" -skipVerification -sync -syncMode ForceSync -install -ErrorAction Stop
        Write-Output "PUBLISH_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
      } catch {
        Write-Output "PUBLISH_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        Write-Output "PUBLISH_FAILED:$($_.Exception.Message)"
        exit 1
      }
    `;
}

/**
 * Build the run tests script block
 */
export function buildRunTestsScript(
  containerName: string,
  extensionId: string,
  testCodeunitId?: number,
): string {
  // Build extensionId parameter if provided
  const extensionIdParam = extensionId ? `-extensionId "${extensionId}"` : "";
  // Use specific codeunit ID if provided, otherwise scan all with "*"
  const codeunitFilter = testCodeunitId ? testCodeunitId.toString() : "*";

  return `
      # Run tests
      Write-Output "TEST_START:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
      try {
        # Use -detailed for verbose output
        # The *>&1 captures all streams (including Write-Host) and outputs them
        $results = Run-TestsInBcContainer -containerName "${containerName}" -credential $credential ${extensionIdParam} -testCodeunit "${codeunitFilter}" -detailed -ErrorAction Stop *>&1

        # Output each line and count test results for accurate pass/fail detection
        $passedCount = 0
        $failedCount = 0
        foreach ($line in $results) {
          $lineStr = "$line"
          Write-Output $lineStr
          # Match test result lines: "Testfunction <name> Success/Failure"
          # Use capture group to determine pass/fail status
          if ($lineStr -match "Testfunction\s+\S+\s+(Success|Failure)") {
            if ($Matches[1] -eq "Success") {
              $passedCount++
            } else {
              $failedCount++
            }
          }
        }

        if ($failedCount -eq 0 -and $passedCount -gt 0) {
          Write-Output "ALL_TESTS_PASSED"
        } elseif ($failedCount -gt 0) {
          Write-Output "SOME_TESTS_FAILED"
        }
      } catch {
        Write-Output "TEST_ERROR:$($_.Exception.Message)"
      }
      Write-Output "TEST_END:$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    `;
}

/**
 * Build the post-test cleanup script block
 */
export function buildPostCleanupScript(containerName: string): string {
  return `
      # POST-TEST CLEANUP: Uninstall and unpublish the test app
      try {
        Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
          $apps = Get-NAVAppInfo -ServerInstance BC | Where-Object { $_.Publisher -eq "CentralGauge" }
          if ($apps) {
            foreach ($app in $apps) {
              $version = $app.Version.ToString()
              Write-Host "CLEANUP:Removing app $($app.Name) (Publisher=$($app.Publisher))"
              try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $version -Force -ErrorAction SilentlyContinue } catch {}
              try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $version -ErrorAction SilentlyContinue } catch {}
            }
          }
        }
      } catch {
        Write-Output "CLEANUP_WARNING:$($_.Exception.Message)"
      }
    `;
}

/**
 * Build the complete PowerShell script for publishing and running tests
 */
export function buildTestScript(
  containerName: string,
  credentials: ContainerCredentials,
  appFilePath: string,
  extensionId: string,
  testCodeunitId?: number,
): string {
  const escapedAppFile = appFilePath.replace(/\\/g, "\\\\");

  // Prereqs are already published by publishApp() - just publish main app and run tests
  // Note: PRECLEAN removed - fixed app ID with ForceSync handles updates in place (~13s savings)
  return `
      Import-Module bccontainerhelper -WarningAction SilentlyContinue
      # Use Windows PowerShell inside container — pwsh sessions lose Nav management module state
      $bcContainerHelperConfig.usePwshForBc24 = $false

      $password = ConvertTo-SecureString "${credentials.password}" -AsPlainText -Force
      $credential = New-Object PSCredential("${credentials.username}", $password)

      ${buildPublishScript(containerName, escapedAppFile)}
      ${buildRunTestsScript(containerName, extensionId, testCodeunitId)}
    `;
}
