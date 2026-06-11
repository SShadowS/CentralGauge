// src/container/bcch-config.ts
//
// Single source of truth for the two bccontainerhelper settings that govern how
// scripts execute INSIDE a BC v28 container. Both are emitted by `bcchConfigInit`
// at the top of every BCH script we run, so behavior does not depend on the
// machine-level `BcContainerHelper.config.json`.
//
// Background (commit 449a5ae, GH issue #12):
// - `usePsSessionForBc28 = $false` (BCH default since 6.1.12) -> BCH uses
//   `docker exec` instead of a PowerShell-7 remote PSSession. The PS7 remote
//   session is the one that loses the .NET-Framework NAV admin module after an
//   Unpublish, breaking the next Publish with "Get-NavServerInstance is not
//   recognized". Forcing it `$false` avoids that class of bug entirely.
// - `usePwshForBc24 = $true` -> fast in-container pwsh. Under docker exec this
//   is SAFE (verified end-to-end: microbench + chained-prereq nuke + canary on
//   BC28), and ~30-40x faster than the WinPS-5.1 workaround.
//
// So the safe-AND-fast config is: usePsSessionForBc28=$false + usePwshForBc24=$true.
// Both are now the defaults here and are written by our scripts, so operators
// need no env vars. The env knobs remain as escape hatches:
//
//   CENTRALGAUGE_BCCH_USE_PWSH_BC24=0       -> force the slow WinPS workaround
//   CENTRALGAUGE_BCCH_USE_PSSESSION_BC28=1  -> re-enable the PS7 remote session
//
// Only touch those for diagnostics. Re-enabling the PSSession reintroduces the
// Get-NavServerInstance-after-Unpublish bug on affected images.

/**
 * The single bccontainerhelper version every host-side script pins to.
 * Bump here (and re-verify per the CLAUDE.md checklist) — never inline a
 * version string at a script site.
 */
export const BCCH_PINNED_VERSION = "6.1.14";

/**
 * The PowerShell lines that import bccontainerhelper at the pinned version
 * AND fail loudly when a different version would actually serve the cmdlets.
 *
 * Why (GH #13): `Import-Module -RequiredVersion X` silently resolves to an
 * already-loaded version when X isn't installed or another version was
 * imported earlier in the session — the pin can *appear* validated on one
 * machine while a different BCH runs underneath on another. `Get-Command`
 * reports the module the cmdlets will actually dispatch to, which stays
 * truthful even with two versions loaded side-by-side.
 *
 * Emits no output on success so callers that parse script output
 * (JSON/markers) are unaffected.
 */
export function bcchImport(): string {
  return [
    `Import-Module bccontainerhelper -RequiredVersion ${BCCH_PINNED_VERSION} -WarningAction SilentlyContinue -ErrorAction Stop`,
    `$cgBcchResolved = (Get-Command Invoke-ScriptInBcContainer -ErrorAction Stop).Module.Version.ToString()`,
    `if ($cgBcchResolved -ne '${BCCH_PINNED_VERSION}') { throw "[CG-PIN] bccontainerhelper version mismatch: requested ${BCCH_PINNED_VERSION}, resolved $cgBcchResolved" }`,
  ].join("\n");
}

function envFlag(name: string): "on" | "off" | "unset" {
  const raw = (Deno.env.get(name) ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return "on";
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return "off";
  }
  return "unset"; // empty or unrecognized -> fall to the default
}

/**
 * Resolve `usePwshForBc24`. Default `true` (fast in-container pwsh). Returns
 * `false` only when `CENTRALGAUGE_BCCH_USE_PWSH_BC24` is explicitly set to a
 * falsey value (force the slow WinPS workaround).
 */
export function bcchUsePwshForBc24(): boolean {
  return envFlag("CENTRALGAUGE_BCCH_USE_PWSH_BC24") !== "off";
}

/**
 * Resolve `usePsSessionForBc28`. Default `false` (docker exec — BCH's own
 * default and what makes fast pwsh safe). Returns `true` only when
 * `CENTRALGAUGE_BCCH_USE_PSSESSION_BC28` is explicitly truthy (diagnostics;
 * reintroduces the PS7 Unpublish bug on affected images).
 */
export function bcchUsePsSessionForBc28(): boolean {
  return envFlag("CENTRALGAUGE_BCCH_USE_PSSESSION_BC28") === "on";
}

/**
 * The PowerShell lines that pin both BCH execution settings. Emit this at the
 * top of every BCH script (after `Import-Module`) so behavior is independent of
 * the machine-level config file. Two assignments, newline-separated.
 */
export function bcchConfigInit(): string {
  return [
    `$bcContainerHelperConfig.usePsSessionForBc28 = $${
      bcchUsePsSessionForBc28() ? "true" : "false"
    }`,
    `$bcContainerHelperConfig.usePwshForBc24 = $${
      bcchUsePwshForBc24() ? "true" : "false"
    }`,
  ].join("\n");
}

/** `"True"` / `"False"` — for `[CG-PIN]` sentinel lines so bench output proves the mode. */
export function bcchUsePwshForBc24Sentinel(): string {
  return bcchUsePwshForBc24() ? "True" : "False";
}
