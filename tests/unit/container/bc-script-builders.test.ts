import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildCleanupStaleCandidatesScript,
  buildPrepareCandidateScript,
  buildPrereqCleanupScript,
  buildPublishScript,
  buildTestScript,
  escapeForPS,
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

// C7: credentials were previously interpolated into a double-quoted PS
// string (`"${credentials.password}"`), where `$(...)`/backticks execute and
// an unescaped `"` breaks out of the literal. Single-quoted + escapeForPS
// closes both: single-quoted PS strings never interpolate `$(...)`, and the
// only special character left is `'`, which escapeForPS doubles.
Deno.test("escapeForPS doubles embedded single quotes", () => {
  assertEquals(escapeForPS("plain"), "plain");
  assertEquals(escapeForPS("O'Brien"), "O''Brien");
  assertEquals(escapeForPS("a'b'c"), "a''b''c");
});

Deno.test("buildTestScript embeds credentials as escaped single-quoted PS literals", () => {
  const script = buildTestScript(
    "Cronus28",
    { username: "u'ser", password: `p'$(Remove-Item C:\\ -Recurse -Force)` },
    "C:\\some\\app.app",
    "00000000-cafe-0000-0000-be4c00decade",
    80052,
  );
  assertStringIncludes(
    script,
    `ConvertTo-SecureString 'p''$(Remove-Item C:\\ -Recurse -Force)' -AsPlainText -Force`,
  );
  assertStringIncludes(script, `New-Object PSCredential('u''ser', $password)`);
  // Must NOT contain the old, injectable double-quoted interpolation form.
  assert(
    !/ConvertTo-SecureString "/.test(script),
    "password must not be embedded in a double-quoted PS string",
  );
});

Deno.test("buildPrepareCandidateScript embeds dev-endpoint credentials as escaped single-quoted PS literals", () => {
  const script = buildPrepareCandidateScript(
    "Cronus28",
    "C:\\\\some\\\\app.app",
    "CG Test Harness",
    { username: "u'ser", password: `p'$(Remove-Item C:\\ -Recurse -Force)` },
  );
  assertStringIncludes(
    script,
    `ConvertTo-SecureString 'p''$(Remove-Item C:\\ -Recurse -Force)' -AsPlainText -Force`,
  );
  assertStringIncludes(
    script,
    `New-Object PSCredential('u''ser', $cgPubPassword)`,
  );
  assert(
    !/ConvertTo-SecureString "/.test(script),
    "password must not be embedded in a double-quoted PS string",
  );
});

// GH #13: every BCH script must carry the loud-fail version guard so a
// silently-fallen-back module version can never run a bench step.
Deno.test("buildTestScript embeds the loud-fail BCH version guard", () => {
  const script = buildTestScript(
    "Cronus28",
    { username: "u", password: "p" },
    "C:\\some\\app.app",
    "00000000-cafe-0000-0000-be4c00decade",
    80052,
  );
  assertStringIncludes(script, "Get-Command Invoke-ScriptInBcContainer");
  assertStringIncludes(script, "version mismatch");
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

Deno.test("buildPrepareCandidateScript uses -useDevEndpoint by default", () => {
  const prev = Deno.env.get("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH");
  Deno.env.delete("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH");
  try {
    const script = buildPrepareCandidateScript(
      "Cronus28",
      "C:\\\\some\\\\app.app",
      "CG Test Harness",
      { username: "u", password: "p" },
    );
    // Default ON: flag + credential ride the SAME publish call, after -install.
    assert(
      /Publish-BcContainerApp[^\n]*-install -useDevEndpoint -credential \$cgPubCredential/
        .test(script),
      "dev-endpoint publish must be on by default with a credential",
    );
    assertStringIncludes(script, `New-Object PSCredential('u'`);
  } finally {
    if (prev === undefined) {
      Deno.env.delete("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH");
    } else {
      Deno.env.set("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH", prev);
    }
  }
});

Deno.test("buildPrepareCandidateScript omits -useDevEndpoint when CENTRALGAUGE_DEV_ENDPOINT_PUBLISH=0", () => {
  const prev = Deno.env.get("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH");
  Deno.env.set("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH", "0");
  try {
    const script = buildPrepareCandidateScript(
      "Cronus28",
      "C:\\\\some\\\\app.app",
      "CG Test Harness",
    );
    assert(
      !script.includes("-useDevEndpoint"),
      "must fall back to the legacy wrapper publish when opted out",
    );
    // No stray credential setup on the legacy path.
    assert(
      !script.includes("$cgPubCredential"),
      "legacy path must not build a publish credential",
    );
  } finally {
    if (prev === undefined) {
      Deno.env.delete("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH");
    } else {
      Deno.env.set("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH", prev);
    }
  }
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

// =============================================================================
// buildPrereqCleanupScript: in-container, leaf-first topological orphan-prereq
// sweep. Fixes GitHub issue #10 (host-side pwsh-7 sweep silently no-opped ->
// cross-task object-ID collisions -> false `infra` failures) and the chained-
// dependency wedge ("required by the following apps" -> INCOMPLETE).
// =============================================================================

Deno.test("buildPrereqCleanupScript routes the unpublish through Invoke-ScriptInBcContainer", () => {
  // The whole point of the fix: the uninstall/unpublish runs INSIDE the
  // container (works regardless of host shell), not host-side under pwsh 7.
  const script = buildPrereqCleanupScript(
    "Cronus28",
    ["CG-AL-E002 Prereq"],
    "CG Test Harness",
  );
  assertStringIncludes(script, "Invoke-ScriptInBcContainer");
});

Deno.test("buildPrereqCleanupScript uses in-container NAV cmdlets, not host-side Unpublish-BcContainerApp", () => {
  const script = buildPrereqCleanupScript("Cronus28", [], "CG Test Harness");
  assertStringIncludes(script, "Uninstall-NAVApp");
  assertStringIncludes(script, "Unpublish-NAVApp");
  assert(
    !script.includes("Unpublish-BcContainerApp"),
    "must NOT use the host-side BCH wrapper that fails under pwsh 7",
  );
});

Deno.test("buildPrereqCleanupScript scopes to CentralGauge publisher", () => {
  const script = buildPrereqCleanupScript("Cronus28", [], "CG Test Harness");
  assertStringIncludes(script, `$a.Publisher -ne "CentralGauge"`);
});

Deno.test("buildPrereqCleanupScript removes empirically leaf-first (progress-based, no .Dependencies)", () => {
  // The hardened sweep attempts every removable app each pass; non-leaves throw
  // "required by" and are retried next pass. Progress is measured by re-querying
  // the removable count (NOT by reading the unreliable .Dependencies metadata).
  const script = buildPrereqCleanupScript("Cronus28", [], "CG Test Harness");
  assertStringIncludes(script, "$isRemovable");
  assertStringIncludes(script, "Unpublish-NAVApp"); // attempt-based removal
  assertStringIncludes(script, "$after -ge $before"); // no-progress detection
  assert(
    !script.includes(".Dependencies"),
    "must NOT read Get-NAVAppInfo .Dependencies (unreliably populated)",
  );
});

Deno.test("buildPrereqCleanupScript keeps the current task's expected prereqs", () => {
  const script = buildPrereqCleanupScript(
    "Cronus28",
    ["CG-AL-H022 Prereq", "CG-AL-H023 Prereq"],
    "CG Test Harness",
  );
  assertStringIncludes(script, `'CG-AL-H022 Prereq'`);
  assertStringIncludes(script, `'CG-AL-H023 Prereq'`);
  assertStringIncludes(script, "$expected -notcontains $a.Name");
});

Deno.test("buildPrereqCleanupScript excludes the harness by the supplied name", () => {
  const script = buildPrereqCleanupScript("Cronus28", [], "CG Alt Harness");
  assertStringIncludes(script, `"CG Alt Harness"`);
  assertStringIncludes(script, "$a.Name -eq $harnessName");
});

Deno.test("buildPrereqCleanupScript empty expected set yields @()", () => {
  const script = buildPrereqCleanupScript("Cronus28", [], "CG Test Harness");
  assertStringIncludes(script, "$expectedNames = @()");
});

Deno.test("buildPrereqCleanupScript loops bounded, leaf-first, with stuck diagnostics", () => {
  // Inter-prereq dependency chains (H024 -> H022) unwind over repeated leaf-first
  // passes; the loop is bounded and emits BLOCKED diagnostics when a removable
  // app can never become a leaf (a kept app depends on it).
  const script = buildPrereqCleanupScript("Cronus28", [], "CG Test Harness");
  assert(
    /for \(\$pass = 1; \$pass -le/.test(script),
    "must have a bounded pass loop",
  );
  assertStringIncludes(script, "if ($after -ge $before)"); // stuck detection
  assertStringIncludes(script, "PREREQ_CLEANUP_BLOCKED:");
});

Deno.test("buildPrereqCleanupScript emits the marker keys the host parser expects", () => {
  const script = buildPrereqCleanupScript("Cronus28", [], "CG Test Harness");
  for (
    const marker of [
      "PREREQ_CLEANUP_NONE",
      "PREREQ_CLEANUP_FOUND:",
      "PREREQ_CLEANUP_REMOVE:",
      "PREREQ_CLEANUP_WARN:",
      "PREREQ_CLEANUP_INCOMPLETE:",
      "PREREQ_CLEANUP_DONE",
    ]
  ) {
    assertStringIncludes(script, marker);
  }
});

Deno.test("buildPrereqCleanupScript targets the given container", () => {
  const script = buildPrereqCleanupScript("Cronus281", [], "CG Test Harness");
  assertStringIncludes(script, `-containerName "Cronus281"`);
});

Deno.test("buildPrereqCleanupScript escapes single quotes in expected names", () => {
  const script = buildPrereqCleanupScript(
    "Cronus28",
    ["O'Brien Prereq"],
    "CG Test Harness",
  );
  assertStringIncludes(script, `'O''Brien Prereq'`);
});
