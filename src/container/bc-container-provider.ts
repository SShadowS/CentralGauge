/**
 * Real Business Central Container Provider using bccontainerhelper PowerShell module
 * This provider integrates with Windows bccontainerhelper for real AL compilation and testing
 *
 * NOTE: All bccontainerhelper Import-Module/Install-Module calls are pinned to
 * version 6.1.11. Version 6.1.12 introduced a regression where the PSSession
 * opened into a BC v28+ container does not auto-load the NAV admin module, so
 * `Get-NavServerInstance` (used internally by Publish-BcContainerApp) fails
 * intermittently as sessions are recycled mid-task. Bump deliberately after
 * verifying the regression is fixed upstream.
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
import { PwshContainerSession } from "./pwsh-session.ts";
import { ContainerSessionSlot } from "./session-slot.ts";
import { CompileSessionPool } from "./compile-session-pool.ts";
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

export interface BcContainerProviderOptions {
  /** Enable persistent pwsh session reuse. Default true. */
  persistentPwsh?: boolean;
  /**
   * Per-container compile session pool size. Should match the
   * `compileConcurrency` of the corresponding `CompileQueue` so per-container
   * compile parallelism isn't capped by the pool. Default 3 (matches
   * CompileQueue's default `compileConcurrency`).
   *
   * Set to 0 to disable the pool and fall back to spawn-per-call (every
   * compile pays the ~15 s bccontainerhelper module-load tax). Useful for
   * memory-constrained machines: each pool slot holds a warm pwsh proc
   * with bccontainerhelper loaded (~250 MB).
   *
   * Env override: `CENTRALGAUGE_COMPILE_POOL_PER_CONTAINER`.
   */
  compilePoolPerContainer?: number;
  /** Test seam: factory for creating sessions. Default uses real spawn. */
  sessionFactory?: (name: string) => PwshContainerSession;
}

export class BcContainerProvider implements ContainerProvider {
  readonly name = "bccontainer";
  readonly platform = "windows" as const;

  // Cached compiler folder path (reuse across compilations)
  private compilerFolderCache: Map<string, string> = new Map();

  // Container credentials (configured per container)
  private credentialsCache: Map<string, ContainerCredentials> = new Map();

  // Serializes all compiler folder creation (shared cache folder cannot be
  // written concurrently by multiple New-BcCompilerFolder calls).
  private static compilerFolderQueue: Promise<void> = Promise.resolve();

  // Compiler cache: when enabled, uses a persistent cache folder to avoid
  // re-downloading artifacts on every run, and a deterministic folder name
  // to prevent GUID folder accumulation.
  private _compilerCacheEnabled = true;
  private static readonly COMPILER_CACHE_DIR =
    "C:\\ProgramData\\BcContainerHelper\\compiler-cache";

  // Per-container session slots. Each slot owns its own lock + session ref +
  // disposing/disposed flags + lifecycle metrics. See `ContainerSessionSlot`
  // in `./session-slot.ts` for the full lifecycle contract. One slot per
  // container — used by runTests (test phase is inherently serial via the
  // CompileQueue's per-container testMutex).
  private readonly slots = new Map<string, ContainerSessionSlot>();
  // Per-container pool of warm compile slots. Lazy-grown up to
  // compilePoolPerContainer (default 3). Used by compileProject so multiple
  // parallel compiles per container don't either (a) serialize through one
  // pwsh stdin pipe or (b) pay the ~15 s bccontainerhelper module-load tax
  // on every spawn. See `CompileSessionPool` in `./compile-session-pool.ts`.
  private readonly compilePools = new Map<string, CompileSessionPool>();
  private readonly persistentEnabled: boolean;
  private readonly compilePoolPerContainer: number;
  private readonly _sessionFactory: (name: string) => PwshContainerSession;

  constructor(options: BcContainerProviderOptions = {}) {
    this.persistentEnabled = options.persistentPwsh ??
      (Deno.env.get("CENTRALGAUGE_PWSH_PERSISTENT") !== "0");
    this.compilePoolPerContainer = options.compilePoolPerContainer ??
      Number(
        Deno.env.get("CENTRALGAUGE_COMPILE_POOL_PER_CONTAINER") ?? "3",
      );
    this._sessionFactory = options.sessionFactory ??
      ((name) => new PwshContainerSession(name));
  }

  /**
   * Enable or disable the persistent compiler cache.
   * When enabled (default), uses a cache folder so subsequent runs skip artifact downloads,
   * and uses a deterministic folder name to avoid GUID folder accumulation.
   */
  setCompilerCacheEnabled(enabled: boolean): void {
    this._compilerCacheEnabled = enabled;
  }

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

  /**
   * Lazy-create the per-container session slot. The slot encapsulates the
   * session lifecycle (lock, session ref, disposing/disposed flags, metrics).
   */
  private getOrCreateSlot(name: string): ContainerSessionSlot {
    let slot = this.slots.get(name);
    if (!slot) {
      slot = new ContainerSessionSlot(name, {
        persistentEnabled: this.persistentEnabled,
        factory: () => this._sessionFactory(name),
        fallback: (script) => this.executePowerShell(script),
      });
      this.slots.set(name, slot);
    }
    return slot;
  }

  /**
   * Lazy-create the per-container compile session pool. Each pool slot is a
   * separate ContainerSessionSlot wrapping its own pwsh proc — true parallel
   * compile up to compilePoolPerContainer.
   *
   * Returns null when persistent sessions are disabled OR the pool is sized
   * to 0; caller falls back to spawn-per-call.
   */
  private getOrCreateCompilePool(name: string): CompileSessionPool | null {
    if (!this.persistentEnabled || this.compilePoolPerContainer <= 0) {
      return null;
    }
    let pool = this.compilePools.get(name);
    if (!pool) {
      pool = new CompileSessionPool(name, {
        poolMax: this.compilePoolPerContainer,
        slotFactory: () =>
          new ContainerSessionSlot(name, {
            persistentEnabled: true,
            factory: () => this._sessionFactory(name),
            fallback: (script) => this.executePowerShell(script),
          }),
      });
      this.compilePools.set(name, pool);
    }
    return pool;
  }

  /**
   * Recycle the per-container test session AND every compile pool slot if any
   * has reached its configured threshold. No-op when no slot/pool exists yet.
   *
   * Each slot serializes recycle behind any in-flight execute on itself.
   */
  async maybeRecycleSession(name: string): Promise<void> {
    if (!this.persistentEnabled) return;
    const tasks: Promise<void>[] = [];
    const slot = this.slots.get(name);
    if (slot) tasks.push(slot.maybeRecycle());
    const pool = this.compilePools.get(name);
    if (pool) tasks.push(pool.maybeRecycle());
    await Promise.all(tasks);
  }

  /**
   * Dispose all per-container session slots AND compile pools in parallel.
   * Each slot acquires its own lock so an in-flight call completes before its
   * session is killed; new callers are rejected via each slot's `disposing`
   * flag. Idempotent.
   */
  async dispose(): Promise<void> {
    await Promise.all([
      ...Array.from(this.slots.values()).map((slot) => slot.dispose()),
      ...Array.from(this.compilePools.values()).map((pool) => pool.dispose()),
    ]);
    this.slots.clear();
    this.compilePools.clear();
  }

  /**
   * Execute a script via the per-container session slot.
   * Slot handles: lock, session reuse, init, retry-on-crash, fallback.
   */
  private async runScriptThroughSession(
    containerName: string,
    script: string,
  ): Promise<{ output: string; exitCode: number }> {
    return await this.getOrCreateSlot(containerName).runScript(script);
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
        Install-Module bccontainerhelper -RequiredVersion 6.1.11 -Force -AllowClobber -Scope CurrentUser
        Import-Module bccontainerhelper -RequiredVersion 6.1.11
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
      if (Get-BcContainer -containerName "${config.name}" -ErrorAction SilentlyContinue) {
        Write-Output "Removing existing container: ${config.name}"
        Remove-BcContainer -containerName "${config.name}"
      }
    `);

    // Create new container
    const setupScript = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue

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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11

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
   * Get or create a compiler folder for the container (cached for performance).
   * Concurrent calls for the same container are deduped to avoid file-lock races.
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

    // Serialize: all compiler folder creation shares a cache folder on disk,
    // so only one New-BcCompilerFolder can run at a time across all containers.
    const promise = BcContainerProvider.compilerFolderQueue.then(() =>
      this.createCompilerFolder(containerName)
    );
    BcContainerProvider.compilerFolderQueue = promise.then(() => {}).catch(
      () => {},
    );
    return await promise;
  }

  /**
   * Create a compiler folder unless another queued call already created it.
   */
  private async createCompilerFolder(containerName: string): Promise<string> {
    // Re-check cache inside the serialized queue — a preceding queued call
    // for the same container may have already created it.
    const cached = this.compilerFolderCache.get(containerName);
    if (cached) {
      try {
        await Deno.stat(cached);
        return cached;
      } catch {
        this.compilerFolderCache.delete(containerName);
      }
    }

    log.info(`Creating compiler folder for ${containerName}...`);

    const cacheParams = this._compilerCacheEnabled
      ? ` -containerName "CentralGauge-${containerName}" -cacheFolder "${BcContainerProvider.COMPILER_CACHE_DIR}"`
      : "";

    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
      $artifactUrl = Get-BcContainerArtifactUrl -containerName "${containerName}"
      Write-Output "ARTIFACT_URL:$artifactUrl"
      $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl -includeTestToolkit${cacheParams}
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
   * Pre-create compiler folders for all given containers at startup.
   * Runs serialized to avoid cache races, but happens before any work
   * is enqueued so compile queue timeouts are not affected.
   */
  async warmupCompilerFolders(containerNames: string[]): Promise<void> {
    for (const name of containerNames) {
      await this.getOrCreateCompilerFolder(name);
    }
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
      // Compile uses the per-container CompileSessionPool when available.
      // Pool keeps N (default 3) warm pwsh procs per container so up to N
      // parallel compiles each get their own warm slot — no module-load tax
      // and no stdin-pipe contention. Falls back to spawn-per-call when the
      // pool is disabled (persistentPwsh=false, compilePoolPerContainer=0,
      // or env override).
      const pool = this.getOrCreateCompilePool(containerName);
      const result = pool
        ? await pool.runScript(script)
        : await this.executePowerShell(script);

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

    // Parse app name/publisher from filename pattern: Publisher_Name_Version.app
    const fileNameParts = appFileName.replace(".app", "").split("_");
    const publisher = fileNameParts[0] || "";
    const appName = fileNameParts.slice(1, -1).join("_") || "";

    const script = `
      Write-Output "[CG-PIN] provider.publishApp bccontainerhelper@6.1.11 usePwshForBc24=False sentinel=2026-04-25-B"
      Write-Output "[CG-PIN] shell=$($PSVersionTable.PSEdition)/$($PSVersionTable.PSVersion) host=$([Environment]::MachineName) user=$([Environment]::UserName) pid=$PID"
      Write-Output "[CG-PIN] modulepath=$(($env:PSModulePath -split ';' | Select-Object -First 3) -join '|')"
      Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
      # Use Windows PowerShell inside the container — pwsh sessions don't auto-load
      # Microsoft.Dynamics.Nav.Management (it's a .NET Framework module), so after
      # any Unpublish-BcContainerApp on a cached pwsh session, Get-NavServerInstance
      # disappears and Publish-BcContainerApp fails. Verified by direct repro.
      $bcContainerHelperConfig.usePwshForBc24 = $false

      # Unpublish any existing version first (always force-republish to pick up schema changes)
      $oldApp = Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object { $_.Name -eq "${appName}" -and $_.Publisher -eq "${publisher}" }
      if ($oldApp) {
        # First remove all non-prereq CentralGauge apps (benchmark apps that may depend on this prereq)
        $nonPrereqApps = @(Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object {
          $_.Publisher -eq "CentralGauge" -and $_.Name -notlike "*Prereq*"
        })
        foreach ($dep in $nonPrereqApps) {
          try {
            Write-Host "Removing dependent app: $($dep.Name) v$($dep.Version)"
            Unpublish-BcContainerApp -containerName "${containerName}" -appName $dep.Name -publisher $dep.Publisher -version $dep.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
          } catch { }
        }

        Write-Host "Unpublishing existing app: $($oldApp.Name) v$($oldApp.Version)"
        Unpublish-BcContainerApp -containerName "${containerName}" -appName $oldApp.Name -publisher $oldApp.Publisher -version $oldApp.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
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
    const result = await this.runScriptThroughSession(containerName, script);
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.11
      $result = Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock { ${command} }
      Write-Output $result
    `;

    return await this.executePowerShell(script);
  }

  async isHealthy(containerName: string): Promise<boolean> {
    try {
      const script = `
        Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
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
   * When compiler cache is enabled, keeps the folders for reuse across runs.
   * Removes all cached compiler folders from this session otherwise.
   */
  async cleanupCompilerFolders(): Promise<void> {
    if (this.compilerFolderCache.size === 0) {
      return;
    }

    if (this._compilerCacheEnabled) {
      log.info(
        `Keeping ${this.compilerFolderCache.size} compiler folder(s) for cache reuse`,
      );
      this.compilerFolderCache.clear();
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

  /**
   * Clear all compiler folders on startup so they are recreated fresh.
   * Removes both CentralGauge-specific output folders and the shared
   * artifact cache to ensure a clean slate every run.
   */
  static async clearCompilerCache(): Promise<void> {
    const compilerDir = "C:\\ProgramData\\BcContainerHelper\\compiler";

    // Remove CentralGauge-specific compiler output folders
    try {
      for await (const entry of Deno.readDir(compilerDir)) {
        if (entry.isDirectory && entry.name.startsWith("CentralGauge-")) {
          const folderPath = `${compilerDir}\\${entry.name}`;
          try {
            await Deno.remove(folderPath, { recursive: true });
            log.info(`Cleared compiler folder: ${entry.name}`);
          } catch {
            log.warn(`Failed to clear compiler folder: ${entry.name}`);
          }
        }
      }
    } catch (error) {
      // NotFound is expected (directory doesn't exist yet), warn on anything else
      if (error instanceof Deno.errors.NotFound) return;
      log.warn(`Could not enumerate compiler directory: ${error}`);
    }

    // Purge the shared artifact cache
    try {
      await Deno.remove(BcContainerProvider.COMPILER_CACHE_DIR, {
        recursive: true,
      });
      log.info("Cleared compiler cache directory");
    } catch {
      // cache directory doesn't exist — nothing to clear
    }
  }
}
