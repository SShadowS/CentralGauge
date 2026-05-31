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
import { fromFileUrl } from "@std/path";
import { Logger } from "../logger/mod.ts";
import {
  captureRawTail,
  redactSensitive,
  writeArtifact,
} from "../health/mod.ts";

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
import {
  buildCleanupStaleCandidatesScript,
  buildCompileScript,
  buildPrepareCandidateScript,
  buildTestScript,
} from "./bc-script-builders.ts";
import { resolveSoapTimeoutMs, runTestsViaSoap } from "./soap-test-client.ts";
import { getTracer, getUnixOriginMicros } from "../tracing/tracer.ts";
import { mergeIntoTracer } from "../tracing/parse-trace-lines.ts";

/**
 * Stable numeric tid for a container's pwsh-cmdlets sub-lane. Used to
 * route pwsh-side `[TRACE]` events from `CG-Trace` into the right
 * Perfetto lane. Chosen to NOT collide with the tracer's reserved range
 * (orchestrator=1, compile-queue=2, llm-pool=3) or its container-slot
 * allocations (100, 110, 120, …) by sitting in the 5000+ band.
 */
function stableContainerPwshTid(containerName: string): number {
  let h = 0;
  for (let i = 0; i < containerName.length; i++) {
    h = (h * 31 + containerName.charCodeAt(i)) & 0x7fffffff;
  }
  // 5000–9999 reserved for pwsh sub-lanes.
  return 5000 + (h % 5000);
}
import type { SoapTestRunnerConfig } from "./soap-test-client.ts";
import { projectUsesTestPage } from "./test-routing.ts";

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

// Markers that ONLY appear when the container / BC service / test tooling
// itself failed — never from model AL code. Always classified as infra.
const UNCONDITIONAL_INFRA_TEST_MARKERS = [
  /SYSLIB0014/,
  /ServicePointManager.*obsolete/i,
  /Get-NavServerInstance.*not recognized/i,
  /CommandNotFoundException.*Get-NavServerInstance/i,
  /Publish-BcContainerApp.*timed out/i,
  /PUBLISH_FAILED/,
  /Run-TestsInBcContainer.*failed/i,
  /container .* not running/i,
];

// `TEST_ERROR:<msg>` is a generic catch-all around Run-TestsInBcContainer — it
// fires for ANY exception, including model-induced ones (a faulting test, a
// runaway that the harness aborts). Treat it as infra ONLY when its message
// carries a genuine infrastructure signature; otherwise it is a real test
// failure (score 0, do NOT retry). Deliberately excludes bare "timeout" — a
// model infinite loop surfaces as a test timeout and must be scored, not retried.
const TEST_ERROR_INFRA_SIGNATURES = [
  /SYSLIB0014/i,
  /\b(?:econnreset|econnrefused|etimedout|enotfound)\b/i,
  /socket hang up/i,
  // Allow intervening words: real .NET phrasings are "connection was reset",
  // "underlying connection was closed", "connection forcibly closed".
  /connection\b.{0,30}\b(?:reset|refused|closed|forcibly)/i,
  /unable to connect to the remote server/i,
  /PSSession.*(?:disconnected|broken|closed|removed)/i,
  /SQL.*(?:server|service).*(?:down|unavailable|not responding)/i,
  /Get-NavServerInstance.*(?:not recognized|not found)/i,
  /container .* not running/i,
];

/**
 * Decide whether legacy test-harness output is an INFRA failure (vs a
 * model/test failure). Unconditional markers are always infra; a bare
 * `TEST_ERROR:` is infra only when its message matches an infra signature.
 * A generic test-runner exception (e.g. the model's code faulting) must be
 * scored as a failure, not retried as infra. Pure + exported for testing.
 */
export function isInfraTestFailure(output: string): boolean {
  if (UNCONDITIONAL_INFRA_TEST_MARKERS.some((re) => re.test(output))) {
    return true;
  }
  const m = output.match(/TEST_ERROR:([^\r\n]*)/);
  if (m) {
    return TEST_ERROR_INFRA_SIGNATURES.some((re) => re.test(m[1]!));
  }
  return false;
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

  // Source folder of the CG Test Harness AL app (compiled + published once per
  // container so the SOAP test path is available).
  private static readonly HARNESS_APP_DIR = "infra/cg-test-harness";
  private static readonly HARNESS_APP_NAME = "CG Test Harness";
  // Bump HARNESS_APP_VERSION (and infra/cg-test-harness/app.json) to force
  // redeployment after changing the harness source.
  private static readonly HARNESS_APP_VERSION = "1.0.0.0";

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

  // Optional directory for raw PS output artifacts (populated by setArtifactDir).
  private artifactDir?: string;

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
   * Set the directory where raw PowerShell output artifacts are written on
   * failure. When set, wrapPwshFailure writes the full redacted output to a
   * file and stores the path in ContainerError.rawOutputArtifactPath.
   * When unset (default), the artifact step is skipped.
   */
  setArtifactDir(dir: string): void {
    this.artifactDir = dir;
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
   * Pre-nuke any leftover CentralGauge-published apps in the given containers
   * before the bench starts. A previous bench run that was killed mid-test
   * may have left prereq or main apps in BC NST's catalog; without removal
   * the next bench's first publishApp hits the bccontainerhelper@6.1.14
   * Unpublish-success-but-not-really race on every prereq. Single
   * spawn-per-call per container, idempotent.
   *
   * Removes non-Prereq apps first, then prereqs (handles dependency order).
   * Errors per-app are swallowed (best-effort cleanup) — the next layer
   * (publishApp's verify-unpublish guard) catches anything left behind.
   */
  async prenukeCentralGaugeApps(containerNames: string[]): Promise<void> {
    if (!this.isWindows()) return;
    await Promise.all(
      containerNames.map(async (name) => {
        const script = `
          Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
          $bcContainerHelperConfig.usePwshForBc24 = $false
          $existing = @(Get-BcContainerAppInfo -containerName "${name}" | Where-Object { $_.Publisher -eq "CentralGauge" -and $_.Name -ne "${BcContainerProvider.HARNESS_APP_NAME}" })
          if ($existing.Count -eq 0) {
            Write-Output "PRENUKE_CLEAN: ${name}"
            return
          }
          Write-Output "PRENUKE_FOUND: ${name} count=$($existing.Count)"
          # Two passes: non-prereq first (they may depend on prereqs), then prereqs.
          $nonPrereq = @($existing | Where-Object { $_.Name -notlike "*Prereq*" })
          $prereq    = @($existing | Where-Object { $_.Name -like  "*Prereq*" })
          foreach ($app in @($nonPrereq + $prereq)) {
            try {
              Write-Output "PRENUKE_REMOVE: $($app.Name) v$($app.Version)"
              Unpublish-BcContainerApp -containerName "${name}" -appName $app.Name -publisher $app.Publisher -version $app.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
              # Verify; if BCH lied, fall through to NST-level cleanup.
              $stillThere = Get-BcContainerAppInfo -containerName "${name}" | Where-Object { $_.Name -eq $app.Name -and $_.Publisher -eq $app.Publisher -and $_.Version -eq $app.Version }
              if ($stillThere) {
                Invoke-ScriptInBcContainer -containerName "${name}" -scriptblock {
                  param($n, $p, $v)
                  try { Uninstall-NAVApp -ServerInstance BC -Name $n -Publisher $p -Version $v -Force -ErrorAction SilentlyContinue } catch { }
                  try { Unpublish-NAVApp -ServerInstance BC -Name $n -Publisher $p -Version $v -ErrorAction SilentlyContinue } catch { }
                } -argumentList $app.Name, $app.Publisher, $app.Version
              }
            } catch {
              Write-Output "PRENUKE_WARN: $($app.Name) - $($_.Exception.Message)"
            }
          }
          Write-Output "PRENUKE_DONE: ${name}"
        `;
        try {
          const result = await this.executePowerShell(script);
          if (result.output.includes("PRENUKE_FOUND")) {
            log.info(`Pre-nuked stale CentralGauge apps in ${name}`, {
              output: result.output.split("\n")
                .filter((l) => l.startsWith("PRENUKE_"))
                .join(" | "),
            });
          }
        } catch (e) {
          log.warn(`prenukeCentralGaugeApps failed for ${name}`, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }),
    );
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
   *
   * `scriptLabel` is used purely for tracing — pass "cleanup" / "publish" /
   * "test" / "compile" so the Perfetto trace can distinguish call types on
   * the same container slot lane. Optional; defaults to "unknown".
   */
  private async runScriptThroughSession(
    containerName: string,
    script: string,
    scriptLabel = "unknown",
  ): Promise<{ output: string; exitCode: number }> {
    const tracer = getTracer();
    if (!tracer.enabled) {
      return await this.getOrCreateSlot(containerName).runScript(script);
    }
    // When tracing is enabled, prepend env-var assignments so the pwsh
    // `CG-Trace` helper inside the script can emit bench-relative
    // timestamps. The pwsh sub-lane gets a numeric tid pre-allocated by
    // the tracer; we resolve it via getTracer().instant on a dummy
    // sentinel? Simpler: just emit the env-init and a numeric tid the
    // parser maps to a "<container> (pwsh cmdlets)" lane. The tracer's
    // pushPreformed will register the lane name on first sight.
    const unixOrigin = getUnixOriginMicros() ?? 0;
    const pwshLaneName = `${containerName} (pwsh cmdlets)`;
    // Pre-allocate a numeric tid for this container's pwsh sub-lane by
    // emitting a quiet sentinel instant onto it through the public API.
    // This way the SAME numeric tid the host-side spans use for sublane
    // "pwsh" gets reused; the pwsh helper just needs the number.
    tracer.instant("pwsh-lane-init", {
      tid: containerName,
      sublane: "pwsh",
      cat: ["pwsh", "internal"],
    });
    // Read it back from the trace event we just emitted is awkward; the
    // safer approach is to expose the resolution from the tracer. For now
    // we compute it inline with the same formula the tracer uses:
    //   container "slot" base = 100 + N*10, "pwsh" sublane = base + 1.
    // Caveat: order of first-allocation matters. Since we already emitted
    // the instant above, the lane is now registered; passing tid via
    // pushPreformed will just match. The pwsh-side numeric tid is sent
    // through env, and the parser's mergeIntoTracer will pushPreformed
    // with that tid — pushPreformed registers thread_name metadata if
    // unseen. So the host doesn't need to predict the exact number;
    // mergeIntoTracer + pwsh just need to AGREE.
    //
    // We don't know the resolved numeric here without exposing it. So
    // pass a stable string env that the host-side parser turns back into
    // the right tid. Simpler: skip CG-Trace's tid-matching with host —
    // give the pwsh side a fresh per-container numeric (we'll generate
    // one from a hash) and let pushPreformed register a NEW lane with
    // `defaultLaneName = "<container> (pwsh cmdlets)"`.
    //
    // The numeric: stable hash of containerName, base + offset.
    const pwshTid = stableContainerPwshTid(containerName);
    const script2 = `
$env:CG_TRACE_BENCH_START_UNIX_MICROS = "${unixOrigin}"
$env:CG_TRACE_TID = "${pwshTid}"
${script}
`;
    const result = await tracer.span(
      "runScriptThroughSession",
      {
        tid: containerName,
        sublane: "slot",
        cat: ["pwsh", "slot"],
        args: { scriptLabel, scriptBytes: script.length },
      },
      () => this.getOrCreateSlot(containerName).runScript(script2),
    );
    // Parse + forward [TRACE] lines into the tracer; return filtered stdout.
    const filtered = mergeIntoTracer(result.output, pwshLaneName);
    return { output: filtered, exitCode: result.exitCode };
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

  /**
   * Build a ContainerError carrying the tail of redacted output and (when an
   * artifact dir is configured) the path to the full output written to disk.
   *
   * This is the canonical failure wrapper for any PS-invocation site in this
   * provider: every "failed" path should funnel through here so the
   * orchestrator receives identical structure regardless of the underlying
   * call site.
   *
   * When `artifactDir` is unset (default), the helper is synchronous in
   * practice — no IO is performed.  When `artifactDir` is set via
   * `setArtifactDir()`, `writeArtifact` is awaited before the error is
   * constructed, so callers must still `await` the result.
   */
  /**
   * Async variant: like buildPwshError but also writes the full redacted
   * output to an artifact file when artifactDir is configured, stamping
   * rawOutputArtifactPath on the returned error.
   *
   * Reserved for use by the orchestrator and CLI wiring tasks — call sites
   * inside this class use the sync buildPwshError directly to avoid an extra
   * micro-task tick per failure.
   */
  protected async wrapPwshFailure(opts: {
    containerName: string;
    operation:
      | "setup"
      | "start"
      | "stop"
      | "compile"
      | "publish"
      | "test"
      | "health";
    message: string;
    output: string;
    exitCode?: number;
    artifactKey?: string;
  }): Promise<ContainerError> {
    const redacted = redactSensitive(opts.output);
    const tail = captureRawTail(redacted, 4096);
    let artifactPath: string | undefined;
    if (this.artifactDir) {
      artifactPath = await writeArtifact(
        this.artifactDir,
        opts.artifactKey ??
          `${opts.operation}-${opts.containerName}-${Date.now()}`,
        redacted,
      );
    }
    return new ContainerError(
      opts.message,
      opts.containerName,
      opts.operation,
      {
        rawOutput: tail,
        ...(artifactPath !== undefined
          ? { rawOutputArtifactPath: artifactPath }
          : {}),
        ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
      },
    );
  }

  /**
   * Synchronous fast path used by the 10 throw sites when artifact writing is
   * not configured. Produces a ContainerError with the redacted output tail
   * and exit code but without an artifactPath.
   *
   * Kept separate from wrapPwshFailure to avoid an extra micro-task tick at
   * every throw site (async wrapPwshFailure would add a tick even when the
   * body is entirely synchronous, which upsets Deno's cross-test resource
   * leak detector for tests that clean up in a `finally` block).
   */
  private buildPwshError(opts: {
    containerName: string;
    operation:
      | "setup"
      | "start"
      | "stop"
      | "compile"
      | "publish"
      | "test"
      | "health";
    message: string;
    output: string;
    exitCode?: number;
  }): ContainerError {
    const redacted = redactSensitive(opts.output);
    const tail = captureRawTail(redacted, 4096);
    return new ContainerError(
      opts.message,
      opts.containerName,
      opts.operation,
      {
        rawOutput: tail,
        ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
      },
    );
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
        Install-Module bccontainerhelper -RequiredVersion 6.1.14 -Force -AllowClobber -Scope CurrentUser
        Import-Module bccontainerhelper -RequiredVersion 6.1.14
        Write-Output "MODULE_INSTALLED"
      `);

      if (installResult.exitCode !== 0) {
        throw this.buildPwshError({
          containerName: config.name,
          operation: "setup",
          message: "Failed to install bccontainerhelper",
          output: installResult.output,
          exitCode: installResult.exitCode,
        });
      }
    }

    // Remove existing container if it exists
    await this.executePowerShell(`
      Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
      if (Get-BcContainer -containerName "${config.name}" -ErrorAction SilentlyContinue) {
        Write-Output "Removing existing container: ${config.name}"
        Remove-BcContainer -containerName "${config.name}"
      }
    `);

    // Create new container
    const setupScript = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue

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
      throw this.buildPwshError({
        containerName: config.name,
        operation: "setup",
        message: "Failed to create BC container",
        output: result.output,
        exitCode: result.exitCode,
      });
    }

    log.info(`Container ${config.name} setup complete`);
  }

  async start(containerName: string): Promise<void> {
    log.info(`Starting container: ${containerName}`);

    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14
      Start-BcContainer -containerName "${containerName}"
      Write-Output "Container ${containerName} started"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw this.buildPwshError({
        containerName,
        operation: "start",
        message: "Failed to start container",
        output: result.output,
        exitCode: result.exitCode,
      });
    }

    log.info(`Container ${containerName} started`);
  }

  async stop(containerName: string): Promise<void> {
    log.info(`Stopping container: ${containerName}`);

    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14
      Stop-BcContainer -containerName "${containerName}"
      Write-Output "Container ${containerName} stopped"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw this.buildPwshError({
        containerName,
        operation: "stop",
        message: "Failed to stop container",
        output: result.output,
        exitCode: result.exitCode,
      });
    }

    log.info(`Container ${containerName} stopped`);
  }

  async remove(containerName: string): Promise<void> {
    log.info(`Removing container: ${containerName}`);

    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14
      Remove-BcContainer -containerName "${containerName}"
      Write-Output "Container ${containerName} removed"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw this.buildPwshError({
        containerName,
        operation: "stop",
        message: "Failed to remove container",
        output: result.output,
        exitCode: result.exitCode,
      });
    }

    log.info(`Container ${containerName} removed`);
  }

  async status(containerName: string): Promise<ContainerStatus> {
    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14

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
      throw this.buildPwshError({
        containerName,
        operation: "health",
        message: `Container ${containerName} not found`,
        output: result.output,
      });
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
      Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
      $artifactUrl = Get-BcContainerArtifactUrl -containerName "${containerName}"
      Write-Output "ARTIFACT_URL:$artifactUrl"
      $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl -includeTestToolkit${cacheParams}
      Write-Output "COMPILER_FOLDER:$compilerFolder"
    `;

    const result = await this.executePowerShell(script);

    const compilerFolder = extractCompilerFolder(result.output);
    if (!compilerFolder) {
      throw this.buildPwshError({
        containerName,
        operation: "compile",
        message: "Failed to create compiler folder",
        output: result.output,
      });
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
   * Ensure the `CG Test Harness` app is published on each container. Compiles
   * it from `infra/cg-test-harness/` against the container's compiler folder
   * and publishes it, unless the expected name+version is already installed.
   * Idempotent; safe to call at every bench startup.
   */
  async ensureTestHarness(containerNames: string[]): Promise<void> {
    if (!this.isWindows()) return;
    for (const name of containerNames) {
      try {
        const installed = await this.executePowerShell(`
          Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
          $a = Get-BcContainerAppInfo -containerName "${name}" | Where-Object {
            $_.Name -eq "${BcContainerProvider.HARNESS_APP_NAME}" -and
            $_.Version -eq "${BcContainerProvider.HARNESS_APP_VERSION}"
          }
          if ($a) { Write-Output "HARNESS_PRESENT" } else { Write-Output "HARNESS_ABSENT" }
        `);
        if (installed.output.includes("HARNESS_PRESENT")) {
          log.info(`Test harness already published on ${name}`);
          continue;
        }

        const compilerFolder = await this.getOrCreateCompilerFolder(name);
        // Resolve the harness source dir against this module's location so it
        // works regardless of the process cwd (other paths in this provider
        // are likewise absolute). This file lives at src/container/, so
        // ../../ reaches the repo root.
        const projectDir = fromFileUrl(
          new URL(
            `../../${BcContainerProvider.HARNESS_APP_DIR}`,
            import.meta.url,
          ),
        );
        const outputDir = `${projectDir}\\output`;
        await Deno.mkdir(outputDir, { recursive: true });

        const escapedCompiler = compilerFolder.replace(/\\/g, "\\\\");
        const escapedProject = projectDir.replace(/\\/g, "\\\\");
        const escapedOutput = outputDir.replace(/\\/g, "\\\\");
        const result = await this.executePowerShell(`
          Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
          $bcContainerHelperConfig.usePwshForBc24 = $false
          Get-ChildItem "${escapedOutput}" -Filter *.app -ErrorAction SilentlyContinue | Remove-Item -Force
          $app = Compile-AppWithBcCompilerFolder -compilerFolder "${escapedCompiler}" \`
            -appProjectFolder "${escapedProject}" -appOutputFolder "${escapedOutput}" -ErrorAction Stop
          # Remove any existing CG Test Harness (any version) before publishing.
          # Publishing over a different installed version makes the ForceSync
          # publish+install conflict (tenant left OperationalWithSyncPending).
          # The harness is schemaless, so the unpublish is clean.
          $old = @(Get-BcContainerAppInfo -containerName "${name}" | Where-Object { $_.Name -eq "${BcContainerProvider.HARNESS_APP_NAME}" })
          foreach ($o in $old) {
            Unpublish-BcContainerApp -containerName "${name}" -appName $o.Name -publisher $o.Publisher -version $o.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
          }
          Publish-BcContainerApp -containerName "${name}" -appFile $app \`
            -skipVerification -sync -syncMode ForceSync -install -ErrorAction Stop
          Write-Output "HARNESS_PUBLISHED:$app"
        `);
        if (!result.output.includes("HARNESS_PUBLISHED:")) {
          // The surrounding catch logs this non-fatally; include the output
          // tail in the message so compile/publish failures are visible
          // without --debug.
          throw new Error(
            `Failed to compile/publish CG Test Harness on ${name}:\n${
              result.output.slice(-2000)
            }`,
          );
        }
        log.info(`Test harness published on ${name}`);
      } catch (e) {
        // Non-fatal: runTests() falls back to the legacy path when the harness
        // is unavailable, so a deploy failure must not abort the bench.
        log.warn(`ensureTestHarness failed for ${name}; SOAP path disabled`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
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

    return await getTracer().span(
      "compile",
      {
        tid: containerName,
        cat: ["compile", "container"],
        args: {
          taskId: (project.appJson as { id?: string })?.id,
          container: containerName,
        },
      },
      () => this.compileProjectInner(containerName, project, contextLog),
    );
  }

  private async compileProjectInner(
    containerName: string,
    project: ALProject,
    contextLog: typeof log,
  ): Promise<CompilationResult> {
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

    // Parse app name/publisher/version from filename pattern: Publisher_Name_Version.app
    const fileNameParts = appFileName.replace(".app", "").split("_");
    const publisher = fileNameParts[0] || "";
    const appName = fileNameParts.slice(1, -1).join("_") || "";
    const appVersion = fileNameParts[fileNameParts.length - 1] || "";

    const script = `
      Write-Output "[CG-PIN] provider.publishApp bccontainerhelper@6.1.14 usePwshForBc24=False sentinel=2026-05-03-A"
      Write-Output "[CG-PIN] shell=$($PSVersionTable.PSEdition)/$($PSVersionTable.PSVersion) host=$([Environment]::MachineName) user=$([Environment]::UserName) pid=$PID"
      Write-Output "[CG-PIN] modulepath=$(($env:PSModulePath -split ';' | Select-Object -First 3) -join '|')"
      Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
      # Use Windows PowerShell inside the container — pwsh sessions don't auto-load
      # Microsoft.Dynamics.Nav.Management (it's a .NET Framework module), so after
      # any Unpublish-BcContainerApp on a cached pwsh session, Get-NavServerInstance
      # disappears and Publish-BcContainerApp fails. Reverified 6.1.14 (see
      # scripts/microbench-soap.ts log + scripts/bcch-pwsh-repro.ps1).
      $bcContainerHelperConfig.usePwshForBc24 = $false

      # FAST PATH: prereqs and other apps with stable IDs (e.g. main app's
      # fixed BENCHMARK_APP_ID) are bytewise stable per (Name, Publisher,
      # Version). If BC's catalog already has an exact match, republish is a
      # no-op AND avoids hitting bccontainerhelper@6.1.14's
      # Unpublish-then-Publish race where Unpublish reports success but BC's
      # NST keeps the app registered, breaking the subsequent Publish with
      # "same App ID and Version as a previously published Extension".
      $oldApp = Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object { $_.Name -eq "${appName}" -and $_.Publisher -eq "${publisher}" }
      $alreadyPublished = ($oldApp -and $oldApp.Version -eq "${appVersion}")

      if ($alreadyPublished) {
        Write-Output "PREREQ_ALREADY_PUBLISHED: $($oldApp.Name) v$($oldApp.Version) (skip republish)"
        Write-Host "PUBLISH_SUCCESS"
      } else {
        if ($oldApp) {
          # Different version present — must unpublish before republish.
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

          # DEFENSIVE PATH: bccontainerhelper@6.1.14's Unpublish reports success
          # even when BC NST's app catalog still lists the app. Verify and force
          # an NST-level uninstall+unpublish if so. Without this, the subsequent
          # Publish fails with "same App ID and Version".
          $stillThere = Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object { $_.Name -eq $oldApp.Name -and $_.Publisher -eq $oldApp.Publisher -and $_.Version -eq $oldApp.Version }
          if ($stillThere) {
            Write-Host "WARN: Unpublish reported success but app still listed; forcing NST-level cleanup"
            try {
              Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
                param($name, $pub, $ver)
                try { Uninstall-NAVApp -ServerInstance BC -Name $name -Publisher $pub -Version $ver -Force -ErrorAction SilentlyContinue } catch { }
                try { Unpublish-NAVApp -ServerInstance BC -Name $name -Publisher $pub -Version $ver -ErrorAction SilentlyContinue } catch { }
              } -argumentList $oldApp.Name, $oldApp.Publisher, $oldApp.Version
            } catch {
              Write-Host "WARN: NST-level cleanup threw: $($_.Exception.Message)"
            }
          }
        }

        # Publish the new app using the host path (bccontainerhelper translates it)
        Publish-BcContainerApp -containerName "${containerName}" -appFile "${escapedHostPath}" -skipVerification -sync -syncMode ForceSync -install -ErrorAction Stop
        Write-Host "PUBLISH_SUCCESS"
      }
    `;

    // Route through the persistent per-container session slot so the BCH
    // module-load + Windows-PowerShell sub-session spin-up (~120 s) is paid
    // once at session init, not per task. See BenchBattleplan.md Phase 2.
    const result = await this.runScriptThroughSession(
      containerName,
      script,
      "publish",
    );

    // Cleanup the copied file
    try {
      await Deno.remove(sharedAppPath);
    } catch {
      // Ignore cleanup errors
    }

    if (!result.output.includes("PUBLISH_SUCCESS")) {
      throw this.buildPwshError({
        containerName,
        operation: "publish",
        message: "Publish failed",
        output: result.output,
      });
    }

    log.info("App published successfully");
  }

  /**
   * Unpublish any prior CentralGauge candidate app before publishing a new one.
   *
   * Every benchmark candidate shares the fixed `BENCHMARK_APP_ID`
   * ("00000000-cafe-0000-0000-be4c00decade", see compile-queue.ts) but each
   * task gets a distinct Name (e.g. `CentralGauge_CG-AL-E001_1`). `publishApp`
   * only handles same-Name updates: a different-named candidate from a prior
   * task slips past its cleanup branch and BC then rejects the publish with
   * "same App ID and Version as a previously published Extension".
   *
   * The legacy `buildPublishScript` cleanup (script-builder layer) used to
   * sweep these up, but the SOAP-fork path in `runTests()` calls `publishApp`
   * directly and skips that script. Calling this first restores the same
   * pre-publish hygiene.
   *
   * Filter mirrors `buildPublishScript`:
   *   Publisher == "CentralGauge" AND Name != "CG Test Harness" AND
   *   Name -notlike "*Prereq*"
   *
   * Best-effort: failures are swallowed (the subsequent `publishApp`'s own
   * guard catches anything left behind and throws a recoverable error).
   */
  async cleanupStaleCandidates(containerName: string): Promise<void> {
    if (!this.isWindows()) return;
    const script = buildCleanupStaleCandidatesScript(
      containerName,
      BcContainerProvider.HARNESS_APP_NAME,
    );
    try {
      // Route through the persistent per-container session slot rather than
      // `executePowerShell` so we don't pay the cold-pwsh + BCH module-load
      // + Windows-PowerShell sub-session spin-up (~120 s/call) on every
      // task. The slot pays this once at session init; subsequent
      // Get-BcContainerAppInfo / Unpublish-BcContainerApp calls amortize.
      // See BenchBattleplan.md Phase 2.
      const result = await this.runScriptThroughSession(
        containerName,
        script,
        "cleanup",
      );
      if (result.output.includes("CANDIDATE_CLEANUP_FOUND")) {
        log.info(`Cleaned up stale candidates in ${containerName}`, {
          output: result.output.split("\n")
            .filter((l) => l.startsWith("CANDIDATE_CLEANUP_"))
            .join(" | "),
        });
      }
    } catch (e) {
      // Non-fatal: publishApp's own guard will catch anything left behind.
      log.warn(`cleanupStaleCandidates failed for ${containerName}`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Combined cleanup + publish in ONE warm-slot script invocation.
   *
   * Replaces the SOAP fork's previous `cleanupStaleCandidates()` +
   * `publishApp()` two-call sequence. Smoke trace
   * `results/smoke-trace-<stamp>/trace.json` showed each call was paying ~120 s
   * of BCH Windows-PowerShell sub-session spin-up because BCH disposes
   * the bridge at end-of-script. Combining halves that overhead AND
   * routes cleanup through `Invoke-ScriptInBcContainer` (direct in-container
   * `Uninstall-NAVApp` / `Unpublish-NAVApp`, ~4 s per diagnostic 2.D4)
   * instead of the slow host-side `Unpublish-BcContainerApp` BCH wrapper.
   *
   * Filter for what counts as a stale candidate to remove:
   *   Publisher == "CentralGauge" AND
   *   Name -notlike "*Prereq*" AND
   *   Name != "CG Test Harness"
   *
   * See `buildPrepareCandidateScript` for the emitted markers.
   */
  async prepareCandidateApp(
    containerName: string,
    appPath: string,
  ): Promise<void> {
    log.info(`Preparing candidate app on container: ${containerName}`);

    // Copy the .app to the BCH shared folder so it's reachable from inside
    // the container without changing the script's path scheme.
    const appFileName = appPath.split(/[/\\]/).pop()!;
    const uuid = crypto.randomUUID().slice(0, 8);
    const sharedFolder =
      `C:\\ProgramData\\BcContainerHelper\\Extensions\\${containerName}\\my`;
    const sharedAppPath = `${sharedFolder}\\${uuid}_${appFileName}`;
    await Deno.mkdir(sharedFolder, { recursive: true });
    await Deno.copyFile(appPath, sharedAppPath);
    const escapedHostPath = sharedAppPath.replace(/\\/g, "\\\\");

    const script = buildPrepareCandidateScript(
      containerName,
      escapedHostPath,
      BcContainerProvider.HARNESS_APP_NAME,
      this.getCredentials(containerName),
    );

    let result: { output: string; exitCode: number };
    try {
      result = await this.runScriptThroughSession(
        containerName,
        script,
        "prepare-candidate",
      );
    } finally {
      // Best-effort cleanup of the staged file regardless of outcome.
      try {
        await Deno.remove(sharedAppPath);
      } catch {
        // ignore
      }
    }

    if (!result.output.includes("PREPARE_PUBLISH_OK")) {
      throw this.buildPwshError({
        containerName,
        operation: "publish",
        message: "prepareCandidateApp failed",
        output: result.output,
      });
    }
    if (result.output.includes("PREPARE_CLEANUP_FOUND")) {
      log.info(`Cleaned stale candidates in ${containerName}`, {
        output: result.output.split("\n")
          .filter((l) => l.startsWith("PREPARE_CLEANUP_"))
          .join(" | "),
      });
    }
  }

  /**
   * Unpublish lingering CentralGauge prereq apps whose Name is not in the
   * expected set. Prevents cross-task ID collisions when a previous task's
   * prereq remains installed (e.g. M001 Prereq's Product table 69001 vs
   * E002 Prereq's Product Category table 69001).
   *
   * Filename convention: Publisher_Name_Version.app
   */
  async cleanupOrphanedPrereqs(
    containerName: string,
    expectedPrereqAppPaths: string[],
  ): Promise<void> {
    const expected = expectedPrereqAppPaths
      .map((p) => p.split(/[/\\]/).pop() ?? "")
      .map((fileName) => {
        const parts = fileName.replace(".app", "").split("_");
        const publisher = parts[0] ?? "";
        const name = parts.slice(1, -1).join("_");
        return { publisher, name };
      })
      .filter((x) => x.name.length > 0);

    // Quote and join as PowerShell string array literals, e.g.
    //   $expectedNames = @('CG-AL-E002 Prereq','CG-AL-H022 Prereq')
    const escapeForPS = (s: string) => s.replace(/'/g, "''");
    const expectedNamesLit = expected.length === 0 ? "@()" : "@(" +
      expected.map((e) => `'${escapeForPS(e.name)}'`).join(",") +
      ")";

    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
      $bcContainerHelperConfig.usePwshForBc24 = $false

      $expectedNames = ${expectedNamesLit}
      $orphans = @(Get-BcContainerAppInfo -containerName "${containerName}" | Where-Object {
        $_.Publisher -eq "CentralGauge" -and
        $_.Name -like "*Prereq*" -and
        ($expectedNames -notcontains $_.Name)
      })
      foreach ($app in $orphans) {
        try {
          Write-Output "PREREQ_ORPHAN_REMOVE: $($app.Name) v$($app.Version)"
          Unpublish-BcContainerApp -containerName "${containerName}" -appName $app.Name -publisher $app.Publisher -version $app.Version -unInstall -doNotSaveData -doNotSaveSchema -force -ErrorAction SilentlyContinue
        } catch {
          Write-Output "PREREQ_ORPHAN_WARN: $($app.Name) - $($_.Exception.Message)"
        }
      }
      Write-Output "PREREQ_CLEANUP_DONE"
    `;

    await this.executePowerShell(script);
  }

  /**
   * Whether the SOAP harness path is enabled. **On by default** — opt out
   * by setting `CENTRALGAUGE_SOAP_TEST_RUNNER=0` (escape hatch — forces
   * the legacy client-session path for every test).
   *
   * SOAP test step is ~38× faster than legacy `Run-TestsInBcContainer`
   * (microbench: 14.7s → 0.11s). Phase 2 (warm-slot routing for
   * `cleanupStaleCandidates` + `publishApp`) eliminated the fresh-pwsh
   * cleanup overhead that previously cancelled the gain.
   */
  private soapTestRunnerEnabled(): boolean {
    return Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER") !== "0";
  }

  /** Build the harness SOAP config for a container from env + credentials. */
  private soapConfigFor(containerName: string): SoapTestRunnerConfig {
    const portRaw = Deno.env.get("CENTRALGAUGE_BC_SOAP_PORT") ?? "7047";
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `CENTRALGAUGE_BC_SOAP_PORT is not a valid port: "${portRaw}"`,
      );
    }
    return {
      host: containerName,
      port,
      company: Deno.env.get("CENTRALGAUGE_BC_COMPANY") ?? "My Company",
      tenant: Deno.env.get("CENTRALGAUGE_BC_TENANT") ?? "default",
      credentials: this.getCredentials(containerName),
      timeoutMs: resolveSoapTimeoutMs(
        Deno.env.get("CENTRALGAUGE_SOAP_TIMEOUT_MS"),
      ),
    };
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

    // --- Hybrid routing -----------------------------------------------------
    // Non-TestPage codeunits run ~38x faster through the headless SOAP harness.
    // TestPage codeunits must use the legacy client-session path below — a
    // web-service session cannot open a TestPage.
    if (
      this.soapTestRunnerEnabled() &&
      testCodeunitId &&
      project.testFiles?.length > 0 &&
      !(await projectUsesTestPage(project))
    ) {
      const tracer = getTracer();
      const traceArgs = {
        taskId: (project.appJson as { id?: string } | undefined)?.id,
        container: containerName,
        path: "soap" as const,
      };
      try {
        // Combined cleanup + publish in ONE warm-slot script. Previously
        // these were two separate calls each paying ~120 s of BCH
        // Windows-PowerShell sub-session spin-up (smoke trace
        // results/smoke-trace-<stamp>/trace.json). The new `prepareCandidateApp`:
        //   (a) cleans prior CentralGauge non-prereq non-harness apps via
        //       Invoke-ScriptInBcContainer { Uninstall-NAVApp + Unpublish-NAVApp }
        //       (~4 s end-to-end per diagnostic 2.D4); and
        //   (b) Publish-BcContainerApp -sync -syncMode ForceSync -install
        //       in the same script. One bridge setup, not two.
        await tracer.span(
          "prepare-candidate",
          {
            tid: containerName,
            cat: ["container", "cleanup", "publish"],
            args: traceArgs,
          },
          () => this.prepareCandidateApp(containerName, actualAppFilePath!),
        );
        const soapResult = await tracer.span(
          "test.soap.total",
          { tid: containerName, cat: ["soap", "test"], args: traceArgs },
          () =>
            runTestsViaSoap(
              this.soapConfigFor(containerName),
              testCodeunitId,
              extensionId,
            ),
        );
        this.logTestResult(
          soapResult.success,
          soapResult.passedTests,
          soapResult.totalTests,
          contextLog,
        );
        contextLog.debug("Ran tests via SOAP harness", {
          durationMs: soapResult.duration,
        });
        return soapResult;
      } catch (e) {
        getTracer().instant("soap-fallback-to-legacy", {
          tid: containerName,
          cat: ["soap", "fallback"],
          args: {
            errorType: e instanceof Error ? e.constructor.name : "unknown",
            errorMessage: e instanceof Error ? e.message : String(e),
          },
        });
        // Any harness problem (deploy missing, fault, network) falls back to
        // the legacy path so the bench never loses a test run to the new path.
        const warnCtx: Record<string, unknown> = {
          error: e instanceof Error ? e.message : String(e),
        };
        if (e instanceof ContainerError) {
          warnCtx["operation"] = e.operation;
          if (e.rawOutput && e.rawOutput.length > 0) {
            // Tail of the redacted pwsh output (buildPwshError already
            // captures up to 4096 chars). Trim to keep the log line bounded.
            warnCtx["rawOutputTail"] = e.rawOutput.slice(-2000);
          }
        }
        contextLog.warn(
          "SOAP harness path failed; falling back to client-session path",
          warnCtx,
        );
      }
    }
    // --- Legacy client-session path (unchanged below) ----------------------

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
    const result = await getTracer().span(
      "test.legacy.total",
      {
        tid: containerName,
        cat: ["legacy", "test"],
        args: {
          taskId: extensionId,
          container: containerName,
          path: "legacy",
        },
      },
      () => this.runScriptThroughSession(containerName, script, "test-legacy"),
    );
    const duration = Date.now() - startTime;

    // Infra-failure detection (NOT model AL failures). A genuine
    // container/BC/test-tool failure throws a ContainerError so the
    // orchestrator classifies + records it without penalizing the model.
    // A bare TEST_ERROR (generic Run-TestsInBcContainer exception) is treated
    // as a real test failure unless its message carries an infra signature —
    // see isInfraTestFailure — so model-induced faults aren't uselessly
    // retried as infra. Order is handled inside the helper.
    if (isInfraTestFailure(result.output)) {
      throw this.buildPwshError({
        containerName,
        operation: "test",
        message: "BC test harness failed (infra)",
        output: result.output,
      });
    }

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
      Import-Module bccontainerhelper -RequiredVersion 6.1.14
      Copy-ToNavContainer -containerName "${containerName}" -localPath "${localPath}" -containerPath "${containerPath}"
      Write-Output "Copied ${localPath} to ${containerName}:${containerPath}"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw this.buildPwshError({
        containerName,
        operation: "compile",
        message: "Failed to copy to container",
        output: result.output,
        exitCode: result.exitCode,
      });
    }
  }

  async copyFromContainer(
    containerName: string,
    containerPath: string,
    localPath: string,
  ): Promise<void> {
    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14
      Copy-FromNavContainer -containerName "${containerName}" -containerPath "${containerPath}" -localPath "${localPath}"
      Write-Output "Copied ${containerName}:${containerPath} to ${localPath}"
    `;

    const result = await this.executePowerShell(script);

    if (result.exitCode !== 0) {
      throw this.buildPwshError({
        containerName,
        operation: "compile",
        message: "Failed to copy from container",
        output: result.output,
        exitCode: result.exitCode,
      });
    }
  }

  async executeCommand(
    containerName: string,
    command: string,
  ): Promise<{ output: string; exitCode: number }> {
    const script = `
      Import-Module bccontainerhelper -RequiredVersion 6.1.14
      $result = Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock { ${command} }
      Write-Output $result
    `;

    return await this.executePowerShell(script);
  }

  async isHealthy(containerName: string): Promise<boolean> {
    try {
      const script = `
        Import-Module bccontainerhelper -RequiredVersion 6.1.14 -WarningAction SilentlyContinue
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
