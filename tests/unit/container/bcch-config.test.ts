// tests/unit/container/bcch-config.test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  bcchUsePwshForBc24,
  bcchUsePwshForBc24Line,
  bcchUsePwshForBc24Sentinel,
} from "../../../src/container/bcch-config.ts";
import { MockEnv } from "../../utils/test-helpers.ts";

const KEY = "CENTRALGAUGE_BCCH_USE_PWSH_BC24";

Deno.test("bcchUsePwshForBc24 - default is false (pinned/verified behavior)", () => {
  const env = new MockEnv();
  try {
    env.delete(KEY);
    assertEquals(bcchUsePwshForBc24(), false);
    assertStringIncludes(
      bcchUsePwshForBc24Line(),
      "usePwshForBc24 = $false",
    );
    assertEquals(bcchUsePwshForBc24Sentinel(), "False");
  } finally {
    env.restore();
  }
});

Deno.test("bcchUsePwshForBc24 - opt-in truthy values enable fast pwsh-7 mode", () => {
  const env = new MockEnv();
  try {
    for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) {
      env.set(KEY, v);
      assertEquals(bcchUsePwshForBc24(), true, `value=${JSON.stringify(v)}`);
      assertStringIncludes(bcchUsePwshForBc24Line(), "usePwshForBc24 = $true");
      assertEquals(bcchUsePwshForBc24Sentinel(), "True");
    }
  } finally {
    env.restore();
  }
});

Deno.test("bcchUsePwshForBc24 - falsey / garbage values keep the pin", () => {
  const env = new MockEnv();
  try {
    for (const v of ["0", "false", "no", "off", "", "  ", "maybe"]) {
      env.set(KEY, v);
      assertEquals(bcchUsePwshForBc24(), false, `value=${JSON.stringify(v)}`);
    }
  } finally {
    env.restore();
  }
});
