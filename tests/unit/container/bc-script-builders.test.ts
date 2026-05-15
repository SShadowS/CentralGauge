import { assert, assertStringIncludes } from "@std/assert";
import {
  buildCleanupStaleCandidatesScript,
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
