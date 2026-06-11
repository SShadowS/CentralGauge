// tests/unit/container/bcch-config.test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  BCCH_PINNED_VERSION,
  bcchConfigInit,
  bcchImport,
  bcchUsePsSessionForBc28,
  bcchUsePwshForBc24,
  bcchUsePwshForBc24Sentinel,
} from "../../../src/container/bcch-config.ts";
import { MockEnv } from "../../utils/test-helpers.ts";

const PWSH = "CENTRALGAUGE_BCCH_USE_PWSH_BC24";
const PSSESSION = "CENTRALGAUGE_BCCH_USE_PSSESSION_BC28";

Deno.test("defaults: fast pwsh ON, PS7 session OFF (docker exec) — no env needed", () => {
  const env = new MockEnv();
  try {
    env.delete(PWSH);
    env.delete(PSSESSION);
    assertEquals(bcchUsePwshForBc24(), true);
    assertEquals(bcchUsePsSessionForBc28(), false);
    assertEquals(bcchUsePwshForBc24Sentinel(), "True");
    const init = bcchConfigInit();
    assertStringIncludes(init, "usePsSessionForBc28 = $false");
    assertStringIncludes(init, "usePwshForBc24 = $true");
  } finally {
    env.restore();
  }
});

Deno.test("usePwshForBc24 off-switch forces the slow WinPS workaround", () => {
  const env = new MockEnv();
  try {
    for (const v of ["0", "false", "no", "off"]) {
      env.set(PWSH, v);
      assertEquals(bcchUsePwshForBc24(), false, `value=${JSON.stringify(v)}`);
      assertStringIncludes(bcchConfigInit(), "usePwshForBc24 = $false");
      assertEquals(bcchUsePwshForBc24Sentinel(), "False");
    }
  } finally {
    env.restore();
  }
});

Deno.test("usePwshForBc24 stays ON for truthy / unrecognized values", () => {
  const env = new MockEnv();
  try {
    for (const v of ["1", "true", "yes", "on", "garbage"]) {
      env.set(PWSH, v);
      assertEquals(bcchUsePwshForBc24(), true, `value=${JSON.stringify(v)}`);
    }
  } finally {
    env.restore();
  }
});

Deno.test("usePsSessionForBc28 opt-in re-enables the PS7 remote session", () => {
  const env = new MockEnv();
  try {
    for (const v of ["1", "true", "yes", "on"]) {
      env.set(PSSESSION, v);
      assertEquals(
        bcchUsePsSessionForBc28(),
        true,
        `value=${JSON.stringify(v)}`,
      );
      assertStringIncludes(bcchConfigInit(), "usePsSessionForBc28 = $true");
    }
    for (const v of ["0", "false", "", "nope"]) {
      env.set(PSSESSION, v);
      assertEquals(
        bcchUsePsSessionForBc28(),
        false,
        `value=${JSON.stringify(v)}`,
      );
    }
  } finally {
    env.restore();
  }
});

// GH #13: `Import-Module -RequiredVersion X` silently resolves to whatever
// version is already loaded when X isn't installed (or another version was
// imported earlier in the session) — the pin can *appear* validated while a
// different BCH runs underneath. bcchImport() must verify the version the
// cmdlets actually resolve to and throw loudly on mismatch.
Deno.test("bcchImport pins the module to BCCH_PINNED_VERSION", () => {
  const script = bcchImport();
  assertStringIncludes(
    script,
    `Import-Module bccontainerhelper -RequiredVersion ${BCCH_PINNED_VERSION}`,
  );
});

Deno.test("bcchImport verifies the RESOLVED version, not the requested one", () => {
  const script = bcchImport();
  // Get-Command resolves to the module the cmdlets will actually dispatch to,
  // which is the truth even when two versions are loaded side-by-side.
  assertStringIncludes(script, "Get-Command Invoke-ScriptInBcContainer");
});

Deno.test("bcchImport throws loudly on version mismatch", () => {
  const script = bcchImport();
  assertStringIncludes(script, "throw");
  assertStringIncludes(script, "version mismatch");
  assertStringIncludes(script, BCCH_PINNED_VERSION);
});

Deno.test("bcchConfigInit emits both settings, newline-separated", () => {
  const env = new MockEnv();
  try {
    env.delete(PWSH);
    env.delete(PSSESSION);
    const lines = bcchConfigInit().split("\n");
    assertEquals(lines.length, 2);
    assertStringIncludes(lines[0]!, "usePsSessionForBc28");
    assertStringIncludes(lines[1]!, "usePwshForBc24");
  } finally {
    env.restore();
  }
});
