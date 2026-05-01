import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import {
  collectEnvelope,
  collectToolVersions,
  computeSettingsHash,
} from "../../../src/lifecycle/envelope.ts";

describe("envelope", () => {
  it("collectToolVersions returns at least deno", async () => {
    const v = await collectToolVersions();
    assertExists(v.deno);
    assert(/^\d+\.\d+\.\d+$/.test(v.deno!));
  });

  it("collectEnvelope contains machine_id and settings_hash", async () => {
    const e = await collectEnvelope({
      machineId: "test-mach",
      settings: { temperature: 0 },
    });
    assertEquals(e.machine_id, "test-mach");
    assertExists(e.settings_hash);
  });

  it("computeSettingsHash is deterministic", async () => {
    const h1 = await computeSettingsHash({ a: 1, b: 2 });
    const h2 = await computeSettingsHash({ b: 2, a: 1 });
    assertEquals(h1, h2);
  });
});
