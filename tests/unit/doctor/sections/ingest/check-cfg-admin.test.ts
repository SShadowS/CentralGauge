import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCfgAdmin } from "../../../../../src/doctor/sections/ingest/check-cfg-admin.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return { cwd, fetchFn: globalThis.fetch, previousResults: new Map() };
}

describe("checkCfgAdmin", () => {
  it("passes when admin_key_id and admin_key_path are both set", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n  admin_key_id: 2\n  admin_key_path: /tmp/a\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgAdmin.run(ctx(tmp));
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("warns (not fails) when admin keys are absent — admin actions just won't be available", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgAdmin.run(ctx(tmp));
      assertEquals(result.status, "warning");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when only one of the two admin fields is set (incomplete pair)", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n  admin_key_id: 2\n`, // path missing
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgAdmin.run(ctx(tmp));
      assertEquals(result.status, "failed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
