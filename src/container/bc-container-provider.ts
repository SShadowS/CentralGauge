/**
 * Real Business Central Container Provider using bccontainerhelper PowerShell module
 * This provider integrates with Windows bccontainerhelper for real AL compilation and testing
 */

import type { ContainerProvider } from "./interface.ts";
import type {
  ALProject,
  CompilationResult,
  ContainerConfig,
  ContainerCredentials,
  ContainerStatus,
  TestResult,
} from "./types.ts";
import { ensureDir } from "@std/fs";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("container:bc");
import { ContainerError } from "../errors.ts";
import {
  calculateTestMetrics,
  extractArtifactPath,
  extractCompilerFolder,
  isCompilationSuccessful,
  isContainerNotFound,
  isModuleMissing,
  mapHealthStatus,
  parseCompilationErrors,
  parseCompilationWarnings,
  parseStatusOutput,
  parseTestResults,
} from "./bc-output-parsers.ts";
import { buildCompileScript, buildTestScript } from "./bc-script-builders.ts";

/**
 * Parse timing markers from PowerShell output and log sub-timings.
 * Markers format: "PHASE_START:timestamp" and "PHASE_END:timestamp"
 * Note: PRECLEAN removed - fixed app ID with ForceSync handles updates in place
 */
function logSubTimings(output: string, contextLog: Logger = log): void {
  const lines = output.split("\n");
  const timestamps: Record<string, number> = {};

  for (const line of lines) {
    const match = line.match(/^(PUBLISH|TEST)_(START|END):(\d+)/);
    if (match && match[1] && match[2] && match[3]) {
      const phase = match[1];
      const type = match[2];
      const ts = match[3];
      timestamps[`${phase}_${type}`] = parseInt(ts, 10);
    }
  }

  // Calculate and log durations
  const timings: Record<string, string> = {};
  const phases = ["PUBLISH", "TEST"];
  for (const phase of phases) {
    const start = timestamps[`${phase}_START`];
    const end = timestamps[`${phase}_END`];
    if (start && end) {
      timings[phase] = `${((end - start) / 1000).toFixed(1)}s`;
    }
  }
  if (Object.keys(timings).length > 0) {
    contextLog.debug("Sub-timings", timings);
  }
}

export class BcContainerProvider implements ContainerProvider {
  readonly name = "bccontainer";
  readonly platform = "windows" as const;

  // Cached compiler folder path (reuse across compilations)
  private compilerFolderCache: Map<string, string> = new Map();

  // Container credentials (configured per container)
  private credentialsCache: Map<string, ContainerCredentials> = new Map();

  /**
   * Configure credentials for a container
   */
  setCredentials(
    containerName: string,
    credentials: ContainerCredentials,
  ): void {
    this.credentialsCache.set(containerName, credentials);
  }

  /**
   * Get credentials for a container (falls back to config defaults)
   */
  private getCredentials(containerName: string): ContainerCredentials {
    return this.credentialsCache.get(containerName) ||
      { username: "admin", password: "admin" };
  }

  private isWindows(): boolean {
    return Deno.build.os === "windows";
  }

  private async executePowerShell(
    script: string,
  ): Promise<{ output: string; exitCode: number }> {
    if (!this.isWindows()) {
      throw new ContainerError(
        "BcContainerProvider requires Windows with bccontainerhelper PowerShell module",
        "bccontainer",
        "setup",
      );
    }

    const process = new Deno.Command("pwsh", {
      args: [
        "-NoProfile",
        "-Command",
        script,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await process.output();
    const output = new TextDecoder().decode(stdout);
    const error = new TextDecoder().decode(stderr);

    return {
      output: output + (error ? `\nSTDERR: ${error}` : ""),
      exitCode: code,
    };
  }

  async setup(config: ContainerConfig): Promise<void> {
    log.info(`Setting up container: ${config.name}`);

    // Store credentials if provided
    if (config.credentials) {
      this.setCredentials(config.name, config.credentials);
    }

    // Check if bccontainerhelper is available
    const checkModule = await this.executePowerShell(`
      if (-not (Get-Module -ListAvailable -Name bccontainerhelper)) {
        Write-Output "MISSING_MODULE"
      } else {
        Write-Output "MODULE_AVAILABLE"
      }
    `);

    if (isModuleMissing(checkModule.output)) {
      log.info("Installing bccontainerhelper module...");
      const installResult = await this.executePowerShell(`
        Install-Module bccontainerhelper -Force -AllowClobber -Scope CurrentUser
        Import-Module bccontainerhelper
        Write-Output "MODULE_INSTALLED"
      `);

      if (installResult.exitCode !== 0) {
        throw new ContainerError(
          `Failed to install bccontainerhelper: ${installResult.output}`,
          config.name,
          "setup",
        );
      }
    }

    // Remove existing container if it exists
    await this.executePowerShell(`
      Import-Module bccontainerhelper -WarningAction SilentlyContinue
      if (Get-BcContainer -containerName "${config.name}" -ErrorAction SilentlyContinue) {
        Write-Output "Removing existing container: ${config.name}"
        Remove-BcContainer -containerName "${config.name}"
      }
    `);

    // Create new container
    const setupScript = `
      Import-Module bccontainerhelper -WarningAction SilentlyContinue

      Write-Output "Creating Business Central container: ${config.name}"
      New-BcContainer \`
        -containerName "${config.name}" \`
        -bcVersion "${config.bcVersion || "24.0"}" \`
        -accept_eula \`
        ${config.includeAL ? "-includeAL" : ""} \`
        ${config.includeTestToolkit ? "-includeTestToolkit" : ""} \`
        -auth NavUserPassword \`
        -memoryLimit "${config.memoryLimit || "8G"}" \`
        -accept_outdated \`
        -updateHosts

      Write-Output "Container ${config.name} created successfully"
    `;

    const result = await this.executePowerShell(setupScript);

    if (result.exitCode !== 0) {
      throw new ContainerError(
        `Failed to create BC container: ${result.output}`,
        config.name,
        "setup",
      );
    }

    log.info(`Container ${config.name} setup complete`);
  }

  async start(containerName: string): Promise<void> {
    log.info(`Starting container: ${containerName}`);

    const script = `
      Import-Module bccontainerhelper
      Start-BcContainer -containerName "${containerName}"
      Write-Output "Container ${containerName} started"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw new ContainerError(
        `Failed to start container: ${result.output}`,
        containerName,
        "start",
      );
    }

    log.info(`Container ${containerName} started`);
  }

  async stop(containerName: string): Promise<void> {
    log.info(`Stopping container: ${containerName}`);

    const script = `
      Import-Module bccontainerhelper
      Stop-BcContainer -containerName "${containerName}"
      Write-Output "Container ${containerName} stopped"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw new ContainerError(
        `Failed to stop container: ${result.output}`,
        containerName,
        "stop",
      );
    }

    log.info(`Container ${containerName} stopped`);
  }

  async remove(containerName: string): Promise<void> {
    log.info(`Removing container: ${containerName}`);

    const script = `
      Import-Module bccontainerhelper
      Remove-BcContainer -containerName "${containerName}"
      Write-Output "Container ${containerName} removed"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw new ContainerError(
        `Failed to remove container: ${result.output}`,
        containerName,
        "stop",
      );
    }

    log.info(`Container ${containerName} removed`);
  }

  async status(containerName: string): Promise<ContainerStatus> {
    const script = `
      Import-Module bccontainerhelper

      # Check if container exists using Get-BcContainers (plural)
      $containers = Get-BcContainers
      if ($containers -contains "${containerName}") {
        # Get container info via docker inspect
        $inspectJson = docker inspect "${containerName}" 2>$null | ConvertFrom-Json
        if ($inspectJson) {
          $state = $inspectJson.State
          $isRunning = $state.Running
          $health = if ($state.Health) { $state.Health.Status } else { if ($isRunning) { "running" } else { "stopped" } }
          $uptime = if ($isRunning -and $state.StartedAt) {
            $startTime = [DateTime]::Parse($state.StartedAt)
            [int]((Get-Date) - $startTime).TotalSeconds
          } else { 0 }
          # Try to get BC version from container labels
          $bcVersion = $inspectJson.Config.Labels.'nav.version'

          Write-Output "STATUS_START"
          Write-Output "NAME:${containerName}"
          Write-Output "RUNNING:$isRunning"
          Write-Output "HEALTH:$health"
          if ($bcVersion) { Write-Output "BCVERSION:$bcVersion" }
          Write-Output "UPTIME:$uptime"
          Write-Output "STATUS_END"
        } else {
          Write-Output "CONTAINER_NOT_FOUND"
        }
      } else {
        Write-Output "CONTAINER_NOT_FOUND"
      }
    `;

    const result = await this.executePowerShell(script);

    if (isContainerNotFound(result.output)) {
      throw new ContainerError(
        `Container ${containerName} not found`,
        containerName,
        "health",
      );
    }

    const statusData = parseStatusOutput(result.output);
    const healthRaw = statusData["HEALTH"] || "stopped";
    const health = mapHealthStatus(healthRaw);
    const bcVersion = statusData["BCVERSION"];
    const uptime = parseInt(statusData["UPTIME"] || "0");

    return {
      name: statusData["NAME"] || containerName,
      isRunning: statusData["RUNNING"] === "True",
      health,
      ...(bcVersion && { bcVersion }),
      ...(uptime > 0 && { uptime }),
    };
  }

  /**
   * Get or create a compiler folder for the container (cached for performance)
   */
  private async getOrCreateCompilerFolder(
    containerName: string,
  ): Promise<string> {
    // Check cache first
    const cached = this.compilerFolderCache.get(containerName);
    if (cached) {
      // Verify it still exists
      try {
        await Deno.stat(cached);
        return cached;
      } catch {
        // Cache entry invalid, will recreate
        this.compilerFolderCache.delete(containerName);
      }
    }

    log.info(`Creating compiler folder for ${containerName}...`);

    const script = `
      Import-Module bccontainerhelper -WarningAction SilentlyContinue
      $artifactUrl = Get-BcContainerArtifactUrl -containerName "${containerName}"
      Write-Output "ARTIFACT_URL:$artifactUrl"
      $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl -includeTestToolkit
      Write-Output "COMPILER_FOLDER:$compilerFolder"
    `;

    const result = await this.executePowerShell(script);

    const compilerFolder = extractCompilerFolder(result.output);
    if (!compilerFolder) {
      throw new ContainerError(
        `Failed to create compiler folder: ${result.output}`,
        containerName,
        "compile",
      );
    }

    this.compilerFolderCache.set(containerName, compilerFolder);

    log.info(`Compiler folder ready: ${compilerFolder}`);
    return compilerFolder;
  }

  /**
   * Build a compilation result from PowerShell output
   */
  private buildCompilationResult(
    output: string,
    duration: number,
    contextLog: Logger = log,
  ): CompilationResult {
    const errors = parseCompilationErrors(output);
    const warnings = parseCompilationWarnings(output);
    const artifactPath = extractArtifactPath(output);
    const success = isCompilationSuccessful(output, errors.length);

    if (success) {
      contextLog.info(`Compilation succeeded`, {
        errors: errors.length,
        warnings: warnings.length,
      });
    } else {
      contextLog.error(`Compilation failed`, {
        errors: errors.length,
        warnings: warnings.length,
      });
    }

    return {
      success,
      errors,
      warnings,
      output,
      duration,
      ...(artifactPath && { artifactPath }),
    };
  }

  async compileProject(
    containerName: string,
    project: ALProject,
    options?: { label?: string },
  ): Promise<CompilationResult> {
    const contextLog = options?.label ? log.child(options.label) : log;
    contextLog.info(`Compiling AL project for container: ${containerName}`);

    const startTime = Date.now();
    const projectPath = project.path.replace(/\\/g, "\\\\");

    try {
      const compilerFolder = await this.getOrCreateCompilerFolder(
        containerName,
      );
      const escapedCompilerFolder = compilerFolder.replace(/\\/g, "\\\\");

      // Output to a subfolder of the compiler folder (which IS shared with container)
      // Use a unique folder per project with a random suffix to avoid collisions
      // when multiple compilations of the same project run in parallel
      const appJson = project.appJson as { name?: string };
      const uniqueSuffix = crypto.randomUUID().slice(0, 8);
      const projectName = `${
        (appJson.name || "app").replace(/[^a-zA-Z0-9-_]/g, "_")
      }_${uniqueSuffix}`;
      const outputDir = `${compilerFolder}\\output\\${projectName}`.replace(
        /\\/g,
        "\\\\",
      );
      await Deno.mkdir(`${compilerFolder}\\output\\${projectName}`, {
        recursive: true,
      });

      const script = buildCompileScript(
        escapedCompilerFolder,
        projectPath,
        outputDir,
      );
      const result = await this.executePowerShell(script);

      return this.buildCompilationResult(
        result.output,
        Date.now() - startTime,
        contextLog,
      );
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

      return {
        success: false,
        errors: [{
          file: "unknown",
          line: 0,
          column: 0,
          code: "SYSTEM",
          message: errorMessage,
          severity: "error",
        }],
        warnings: [],
        output: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  async publishApp(
    containerName: string,
    appPath: string,
  ): Promise<void> {
    log.info(`Publishing app to container: ${containerName}`);

    // Copy the app to the shared "my" folder which is mounted in the container
    const appFileName = appPath.split(/[/\\]/).pop()!;
    const uuid = crypto.randomUUID().slice(0, 8);
    const sharedFolder =
      `C:\\ProgramData\\BcContainerHelper\\Extensions\\${containerName}\\my`;
    const sharedAppPath = `${sharedFolder}\\${uuid}_${appFileName}`;

    await Deno.mkdir(sharedFolder, { recursive: true });
    await Deno.copyFile(appPath, sharedAppPath);

    // Use the host path - bccontainerhelper will translate it to container path internally
    const escapedHostPath = sharedAppPath.replace(/\\/g, "\\\\");

    // Parse app name/publisher/version from filename pattern: Publisher_Name_Version.app
    const fileNameParts = appFileName.replace(".app", "").split("_");
    const publisher = fileNameParts[0] || "";
    const appName = fileNameParts.slice(1, -1).join("_") || "";
    const version = fileNameParts[fileNameParts.length - 1] || "";

    const script = `
      Import-Module bccontainerhelper -WarningAction SilentlyContinue

      # Check if exact same version is already published - skip if so
      $existingApp = Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object { $_.Name -eq "${appName}" -and $_.Publisher -eq "${publisher}" -and $_.Version -eq "${version}" }
      if ($existingApp) {
        Write-Host "App already published with same version, skipping: $($existingApp.Name) v${version}"
        Write-Host "PUBLISH_SUCCESS"
        exit 0
      }

      # Unpublish any existing different version first
      $oldApp = Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object { $_.Name -eq "${appName}" -and $_.Publisher -eq "${publisher}" }
      if ($oldApp) {
        Write-Host "Unpublishing existing app: $($oldApp.Name) v$($oldApp.Version)"
        Unpublish-BcContainerApp -containerName "${containerName}" -appName $oldApp.Name -publisher $oldApp.Publisher -version $oldApp.Version -uninstall -ErrorAction SilentlyContinue
      }

      # Publish the new app using the host path (bccontainerhelper translates it)
      Publish-BcContainerApp -containerName "${containerName}" -appFile "${escapedHostPath}" -skipVerification -sync -syncMode ForceSync -install -ErrorAction Stop
      Write-Host "PUBLISH_SUCCESS"
    `;

    const result = await this.executePowerShell(script);

    // Cleanup the copied file
    try {
      await Deno.remove(sharedAppPath);
    } catch {
      // Ignore cleanup errors
    }

    if (!result.output.includes("PUBLISH_SUCCESS")) {
      throw new ContainerError(
        `Publish failed: ${result.output}`,
        containerName,
        "setup",
        { appPath },
      );
    }

    log.info("App published successfully");
  }

  async runTests(
    containerName: string,
    project: ALProject,
    appFilePath?: string,
    testCodeunitId?: number,
    options?: { label?: string },
  ): Promise<TestResult> {
    const contextLog = options?.label ? log.child(options.label) : log;
    contextLog.info(`Running tests in container: ${containerName}`);

    const startTime = Date.now();
    const credentials = this.getCredentials(containerName);

    // Use provided app file path or search for one
    let actualAppFilePath = appFilePath;
    if (!actualAppFilePath) {
      const appFileResult = await this.ensureCompiledApp(
        containerName,
        project,
        startTime,
      );
      if (!appFileResult.success) {
        return appFileResult.failureResult!;
      }
      actualAppFilePath = appFileResult.appFilePath!;
    }

    // Extract extensionId from app.json for test filtering
    const appJson = project.appJson as { id?: string };
    const extensionId = appJson.id || "";

    // Copy main app to shared folder accessible by container
    const appFileName = actualAppFilePath.split(/[/\\]/).pop()!;
    const uuid = crypto.randomUUID().slice(0, 8);
    const sharedFolder =
      `C:\\ProgramData\\BcContainerHelper\\Extensions\\${containerName}\\my`;
    await ensureDir(sharedFolder);
    const sharedAppPath = `${sharedFolder}\\${uuid}_${appFileName}`;
    await Deno.copyFile(actualAppFilePath, sharedAppPath);

    // Build and execute the test script (prereqs already published)
    const script = buildTestScript(
      containerName,
      credentials,
      sharedAppPath,
      extensionId,
      testCodeunitId,
    );
    const result = await this.executePowerShell(script);
    const duration = Date.now() - startTime;

    // Log sub-timings from PowerShell markers
    logSubTimings(result.output, contextLog);

    // Debug: Check for marker presence
    const hasPublishStart = result.output.includes("PUBLISH_START:");
    const hasPublishEnd = result.output.includes("PUBLISH_END:");
    const hasTestStart = result.output.includes("TEST_START:");
    const hasTestEnd = result.output.includes("TEST_END:");
    contextLog.debug("Markers", {
      PUBLISH_START: hasPublishStart,
      PUBLISH_END: hasPublishEnd,
      TEST_START: hasTestStart,
      TEST_END: hasTestEnd,
    });

    // Cleanup copied file
    try {
      await Deno.remove(sharedAppPath);
    } catch {
      // Ignore cleanup errors
    }

    // Parse and return results
    const { results, allPassed, publishFailed } = parseTestResults(
      result.output,
    );
    const { totalTests, passedTests, failedTests, success } =
      calculateTestMetrics(results, allPassed, publishFailed);

    this.logTestResult(success, passedTests, totalTests, contextLog);

    // Debug: Log raw output when no tests are found (helps diagnose parsing issues)
    if (totalTests === 0) {
      contextLog.warn("No tests detected");
      contextLog.debug("Raw output", { output: result.output });
    }

    return {
      success,
      totalTests,
      passedTests,
      failedTests,
      results,
      duration,
      output: result.output,
    };
  }

  /** Ensure we have a compiled app file, compiling if necessary */
  private async ensureCompiledApp(
    containerName: string,
    project: ALProject,
    startTime: number,
  ): Promise<{
    success: boolean;
    appFilePath?: string;
    failureResult?: TestResult;
  }> {
    // Try to find existing compiled app
    let appFilePath = await this.findCompiledAppFile(project);

    if (!appFilePath) {
      log.warn("No compiled app found, compiling first...");
      const compileResult = await this.compileProject(containerName, project);
      if (!compileResult.success) {
        return {
          success: false,
          failureResult: this.createFailedTestResult(
            startTime,
            `Compilation failed: ${compileResult.output}`,
          ),
        };
      }
      appFilePath = compileResult.artifactPath;
    }

    if (!appFilePath) {
      return {
        success: false,
        failureResult: this.createFailedTestResult(
          startTime,
          "No compiled app file available for testing",
        ),
      };
    }

    return { success: true, appFilePath };
  }

  /** Find the first .app file in the project output directory */
  private async findCompiledAppFile(
    project: ALProject,
  ): Promise<string | undefined> {
    const outputDir = `${project.path}\\output`;
    try {
      for await (const entry of Deno.readDir(outputDir)) {
        if (entry.isFile && entry.name.endsWith(".app")) {
          return `${outputDir}\\${entry.name}`;
        }
      }
    } catch {
      // Output directory doesn't exist or is empty
    }
    return undefined;
  }

  /** Create a failed test result */
  private createFailedTestResult(
    startTime: number,
    output: string,
  ): TestResult {
    return {
      success: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      results: [],
      duration: Date.now() - startTime,
      output,
    };
  }

  /** Log the test result */
  private logTestResult(
    success: boolean,
    passedTests: number,
    totalTests: number,
    contextLog: Logger = log,
  ): void {
    if (success) {
      contextLog.info(`Tests passed: ${passedTests}/${totalTests}`);
    } else {
      contextLog.error(`Tests failed: ${passedTests}/${totalTests} passed`);
    }
  }

  async copyToContainer(
    containerName: string,
    localPath: string,
    containerPath: string,
  ): Promise<void> {
    const script = `
      Import-Module bccontainerhelper
      Copy-ToNavContainer -containerName "${containerName}" -localPath "${localPath}" -containerPath "${containerPath}"
      Write-Output "Copied ${localPath} to ${containerName}:${containerPath}"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw new ContainerError(
        `Failed to copy to container: ${result.output}`,
        containerName,
        "compile",
        { localPath, containerPath },
      );
    }
  }

  async copyFromContainer(
    containerName: string,
    containerPath: string,
    localPath: string,
  ): Promise<void> {
    const script = `
      Import-Module bccontainerhelper
      Copy-FromNavContainer -containerName "${containerName}" -containerPath "${containerPath}" -localPath "${localPath}"
      Write-Output "Copied ${containerName}:${containerPath} to ${localPath}"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw new ContainerError(
        `Failed to copy from container: ${result.output}`,
        containerName,
        "compile",
        { localPath, containerPath },
      );
    }
  }

  async executeCommand(
    containerName: string,
    command: string,
  ): Promise<{ output: string; exitCode: number }> {
    const script = `
      Import-Module bccontainerhelper
      $result = Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock { ${command} }
      Write-Output $result
    `;

    return await this.executePowerShell(script);
  }

  async isHealthy(containerName: string): Promise<boolean> {
    try {
      const script = `
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        $result = Test-BcContainer -containerName "${containerName}"
        Write-Output "HEALTHY:$result"
      `;
      const result = await this.executePowerShell(script);
      return result.output.includes("HEALTHY:True");
    } catch {
      return false;
    }
  }

  /**
   * Clean up compiler folders to free disk space.
   * Removes all cached compiler folders from this session.
   */
  async cleanupCompilerFolders(): Promise<void> {
    if (this.compilerFolderCache.size === 0) {
      return;
    }

    log.info(
      `Cleaning up ${this.compilerFolderCache.size} compiler folder(s)...`,
    );

    for (const [containerName, folderPath] of this.compilerFolderCache) {
      try {
        await Deno.remove(folderPath, { recursive: true });
        log.info(`Removed compiler folder: ${folderPath}`);
      } catch (error) {
        log.warn(`Failed to remove compiler folder ${folderPath}: ${error}`);
      }
      this.compilerFolderCache.delete(containerName);
    }
  }

  /**
   * Clean up all compiler folders in the BcContainerHelper directory.
   * Use this to reclaim disk space from previous runs.
   */
  async cleanupAllCompilerFolders(): Promise<
    { removed: number; failed: number }
  > {
    const compilerDir = "C:\\ProgramData\\BcContainerHelper\\compiler";
    let removed = 0;
    let failed = 0;

    log.info(`Cleaning up all compiler folders in ${compilerDir}...`);

    try {
      for await (const entry of Deno.readDir(compilerDir)) {
        if (entry.isDirectory) {
          const folderPath = `${compilerDir}\\${entry.name}`;
          try {
            await Deno.remove(folderPath, { recursive: true });
            removed++;
          } catch {
            failed++;
          }
        }
      }
    } catch (error) {
      log.warn(`Could not access compiler directory: ${error}`);
    }

    if (removed > 0) {
      log.info(`Removed ${removed} compiler folder(s)`);
    }
    if (failed > 0) {
      log.warn(`Failed to remove ${failed} folder(s)`);
    }

    // Clear the cache
    this.compilerFolderCache.clear();

    return { removed, failed };
  }
}
