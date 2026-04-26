import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCfgPresent } from "../../../../../src/doctor/sections/ingest/check-cfg-present.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return {
    cwd,
    fetchFn: globalThis.fetch,
    previousResults: new Map(),
  };
}

describe("checkCfgPresent", () => {
  it("passes when both home and project configs exist with full ingest section", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x.example.com\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n`,
    );
    // Inject HOME env so the check finds a "home" config in the same tmp.
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgPresent.run(ctx(tmp));
      assertEquals(result.id, "cfg.present");
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when no ingest section is reachable and includes remediation", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `# no ingest section\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgPresent.run(ctx(tmp));
      assertEquals(result.status, "failed");
      assertEquals(
        result.remediation?.command,
        "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
      );
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when required field key_path is missing", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: https://x.example.com\n  key_id: 1\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkCfgPresent.run(ctx(tmp));
      assertEquals(result.status, "failed");
      const missing = (result.details?.["missing"] as string[]) ?? [];
      assertEquals(missing.includes("key_path"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
