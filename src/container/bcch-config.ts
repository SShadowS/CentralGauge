// src/container/bcch-config.ts
//
// Single source of truth for the bccontainerhelper `usePwshForBc24` pin.
//
// Background (commit 449a5ae, GH issue #12):
// - With the flag TRUE (BCH default), bccontainerhelper opens a pwsh 7 PSSession
//   INSIDE the container. pwsh 7 is .NET Core; the BC NAV admin module
//   (Microsoft.Dynamics.Nav.Management) is .NET Framework and doesn't auto-load
//   there, so after any Unpublish the session drops the module bindings and the
//   next `Get-NavServerInstance` (called internally by Publish-BcContainerApp)
//   fails "is not recognized". Setting it FALSE uses Windows PowerShell 5.1
//   in-container, where the module loads — fixing publish/test.
// - BUT on BC28 / Windows Server 2025 / ltsc2025 the FALSE (WinPS 5.1) path
//   costs ~380-440s per heavy op (~30-40x), dominating bench wall time and
//   blowing the 300s session timeout (GH #12).
//
// So the value is image-dependent and must be configurable, NOT hardcoded.
// Default stays FALSE — the verified-safe behavior — so no existing run changes.
// Operators who have confirmed their image does NOT hit the
// Get-NavServerInstance-after-Unpublish bug can opt into fast pwsh-7 mode:
//
//   CENTRALGAUGE_BCCH_USE_PWSH_BC24=1   (or true / yes)
//
// We deliberately do NOT auto-gate on BC version: the original April failure was
// never re-tested on BC28, so a silent flip could reintroduce the publish break.

/**
 * Resolve the `usePwshForBc24` value. Default `false` (the pinned, verified
 * workaround). Returns `true` only when the opt-in env knob is explicitly set.
 */
export function bcchUsePwshForBc24(): boolean {
  const raw = (Deno.env.get("CENTRALGAUGE_BCCH_USE_PWSH_BC24") ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * The PowerShell assignment line embedding the resolved value, e.g.
 * `$bcContainerHelperConfig.usePwshForBc24 = $false`. Use this everywhere the
 * pin is emitted into a BCH script so all sites honor the same knob.
 */
export function bcchUsePwshForBc24Line(): string {
  return `$bcContainerHelperConfig.usePwshForBc24 = $${
    bcchUsePwshForBc24() ? "true" : "false"
  }`;
}

/** `"True"` / `"False"` — for `[CG-PIN]` sentinel lines so bench output proves the mode. */
export function bcchUsePwshForBc24Sentinel(): string {
  return bcchUsePwshForBc24() ? "True" : "False";
}
