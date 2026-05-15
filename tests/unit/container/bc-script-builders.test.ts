import { assert, assertStringIncludes } from "@std/assert";
import {
  buildCleanupStaleCandidatesScript,
  buildPrepareCandidateScript,
  buildPublishScript,
  buildTestScript,
} from "../../../src/container/bc-script-builders.ts";

// Pre-publish cleanup must NOT unpublish the CG Test Harness. The harness has
// publisher "CentralGauge" and would otherwise be swept up with stale
// candidate apps every test run — once removed, every subsequent task's SOAP
// path fails and falls back to legacy, tanking bench wall time.

Deno.test("buildPublishScript excludes CG Test Harness from cleanup", () => {
  const script = buildPublishScript("Cronus28", "C:\\\\some\\\\app.app");
  assertStringIncludes(script, `$_.Name -ne "CG Test Harness"`);
});

Deno.test("buildPublishScript still excludes prereq apps from cleanup", () => {
  const script = buildPublishScript("Cronus28", "C:\\\\some\\\\app.app");
  assertStringIncludes(script, `$_.Name -notlike "*Prereq*"`);
});

// All benchmark candidates share a single BENCHMARK_APP_ID; the cleanup
// script must sweep prior candidates (different Name, same App ID) before a
// publish or BC rejects with "same App ID and Version as a previously
// published Extension". The filter must NOT touch prereqs or the harness.

Deno.test("buildCleanupStaleCandidatesScript scopes to CentralGauge publisher", () => {
  const script = buildCleanupStaleCandidatesScript(
    "Cronus28",
    "CG Test Harness",
  );
  assertStringIncludes(script, `$_.Publisher -eq "CentralGauge"`);
});

Deno.test("buildCleanupStaleCandidatesScript excludes prereqs", () => {
  const script = buildCleanupStaleCandidatesScript(
    "Cronus28",
    "CG Test Harness",
  );
  assertStringIncludes(script, `$_.Name -notlike "*Prereq*"`);
});

Deno.test("buildCleanupStaleCandidatesScript excludes the test harness", () => {
  const script = buildCleanupStaleCandidatesScript(
    "Cronus28",
    "CG Test Harness",
  );
  assertStringIncludes(script, `$_.Name -ne "CG Test Harness"`);
});

Deno.test("buildCleanupStaleCandidatesScript honors the supplied harness name", () => {
  // Defensive: ensure the harness name interpolates rather than being hard-coded
  // in the builder. A typo in BcContainerProvider.HARNESS_APP_NAME would
  // otherwise silently include the harness in the sweep.
  const script = buildCleanupStaleCandidatesScript(
    "Cronus28",
    "CG Alt Harness",
  );
  assertStringIncludes(script, `$_.Name -ne "CG Alt Harness"`);
});

Deno.test("buildCleanupStaleCandidatesScript targets the given container", () => {
  const script = buildCleanupStaleCandidatesScript(
    "Cronus281",
    "CG Test Harness",
  );
  assertStringIncludes(script, `-containerName "Cronus281"`);
});

Deno.test("buildCleanupStaleCandidatesScript uses Unpublish-BcContainerApp with -unInstall -force", () => {
  // The benchmark relies on app being fully removed (not just unpublished)
  // before the next publish. Missing -unInstall leaves the app installed and
  // blocks Publish; missing -force makes the call interactive in pwsh
  // sessions where confirmation prompts fail silently.
  const script = buildCleanupStaleCandidatesScript(
    "Cronus28",
    "CG Test Harness",
  );
  assert(
    /Unpublish-BcContainerApp[^\n]*-unInstall[^\n]*-force/.test(script),
    "cleanup must invoke Unpublish-BcContainerApp with both -unInstall and -force",
  );
});

Deno.test("buildTestScript composes publish (with harness exclusion) and run-tests", () => {
  const script = buildTestScript(
    "Cronus28",
    { username: "u", password: "p" },
    "C:\\some\\app.app",
    "00000000-cafe-0000-0000-be4c00decade",
    80052,
  );
  // The harness exclusion (from buildPublishScript) must survive composition.
  assertStringIncludes(script, `$_.Name -ne "CG Test Harness"`);
  // The test step must reference the codeunit being run.
  assertStringIncludes(script, `-testCodeunit "80052"`);
  // The script must end up calling Run-TestsInBcContainer.
  assert(
    /Run-TestsInBcContainer\s/.test(script),
    "buildTestScript should invoke Run-TestsInBcContainer",
  );
});

// buildPrepareCandidateScript: combined cleanup + publish, designed to pay
// the BCH Windows-PowerShell bridge cost ONCE per task instead of twice.

Deno.test("buildPrepareCandidateScript routes cleanup through Invoke-ScriptInBcContainer", () => {
  const script = buildPrepareCandidateScript(
    "Cronus28",
    "C:\\\\some\\\\app.app",
    "CG Test Harness",
  );
  // Cleanup MUST go through in-container PSSession (~4 s) not host-side
  // Unpublish-BcContainerApp (~120 s with workaround on).
  assertStringIncludes(
    script,
    `Invoke-ScriptInBcContainer -containerName "Cronus28"`,
  );
  assertStringIncludes(script, `Get-NAVAppInfo -ServerInstance BC`);
  assert(
    /Uninstall-NAVApp/.test(script),
    "must call Uninstall-NAVApp inside container",
  );
  assert(
    /Unpublish-NAVApp/.test(script),
    "must call Unpublish-NAVApp inside container",
  );
});

Deno.test("buildPrepareCandidateScript cleanup filter matches the legacy buildPublishScript exclusions", () => {
  const script = buildPrepareCandidateScript(
    "Cronus28",
    "C:\\\\some\\\\app.app",
    "CG Test Harness",
  );
  // Same Publisher + Name filter the legacy cleanup uses, just inside the
  // container instead of on the host.
  assertStringIncludes(script, `$_.Publisher -eq "CentralGauge"`);
  assertStringIncludes(script, `$_.Name -notlike "*Prereq*"`);
  assertStringIncludes(script, `$_.Name -ne $harnessName`);
});

Deno.test("buildPrepareCandidateScript publishes via BCH wrapper with sync+install", () => {
  const script = buildPrepareCandidateScript(
    "Cronus28",
    "C:\\\\some\\\\app.app",
    "CG Test Harness",
  );
  // Publish step still uses the host-side BCH wrapper because it needs
  // -sync -syncMode ForceSync -install in one call.
  assert(
    /Publish-BcContainerApp[^\n]*-sync[^\n]*-syncMode ForceSync[^\n]*-install/
      .test(script),
    "must invoke Publish-BcContainerApp with -sync -syncMode ForceSync -install",
  );
  assertStringIncludes(script, "PREPARE_PUBLISH_START:");
  assertStringIncludes(script, "PREPARE_PUBLISH_END:");
  assertStringIncludes(script, "PREPARE_PUBLISH_OK");
});

Deno.test("buildPrepareCandidateScript honors the supplied harness name", () => {
  // The harness exclusion is interpolated, not hard-coded. A typo in
  // HARNESS_APP_NAME on the TS side would otherwise sweep the harness.
  const script = buildPrepareCandidateScript(
    "Cronus28",
    "C:\\\\some\\\\app.app",
    "CG Alt Harness",
  );
  assertStringIncludes(script, `-argumentList "CG Alt Harness"`);
});

Deno.test("buildPrepareCandidateScript emits marker keys host-side parser expects", () => {
  const script = buildPrepareCandidateScript(
    "Cronus28",
    "C:\\\\some\\\\app.app",
    "CG Test Harness",
  );
  // The provider's prepareCandidateApp method greps these markers.
  assertStringIncludes(script, "PREPARE_CLEANUP_NONE");
  assertStringIncludes(script, "PREPARE_CLEANUP_FOUND:");
  assertStringIncludes(script, "PREPARE_CLEANUP_REMOVE:");
  assertStringIncludes(script, "PREPARE_PUBLISH_OK");
  assertStringIncludes(script, "PREPARE_PUBLISH_FAILED:");
});

Deno.test("buildPrepareCandidateScript exits non-zero on publish failure", () => {
  const script = buildPrepareCandidateScript(
    "Cronus28",
    "C:\\\\some\\\\app.app",
    "CG Test Harness",
  );
  // Without this, the host-side check for PREPARE_PUBLISH_OK would still
  // bail with the right error, but the slot exit code would be 0 — leading
  // to confusing trace data. Make the script's exit code reflect the
  // failure.
  assert(
    /PREPARE_PUBLISH_FAILED[^\n]*[\s\S]*?exit 1/.test(script),
    "publish failure path must emit PREPARE_PUBLISH_FAILED then exit 1",
  );
});
