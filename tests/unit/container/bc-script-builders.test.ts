import { assert, assertStringIncludes } from "@std/assert";
import {
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
