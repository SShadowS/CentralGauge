import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ingestSection } from "../../../../../src/doctor/sections/ingest/mod.ts";

describe("ingestSection", () => {
  it("contains the 8 expected checks in matrix order", () => {
    assertEquals(ingestSection.id, "ingest");
    assertEquals(ingestSection.checks.map((c) => c.id), [
      "cfg.present",
      "cfg.admin",
      "keys.files",
      "catalog.local",
      "clock.skew",
      "net.health",
      "auth.probe",
      "catalog.bench",
    ]);
  });

  it("dependency declarations are consistent (every requires id exists earlier)", () => {
    const seen = new Set<string>();
    for (const c of ingestSection.checks) {
      for (const dep of c.requires ?? []) {
        if (!seen.has(dep)) {
          throw new Error(
            `Check '${c.id}' requires '${dep}' which is not declared earlier`,
          );
        }
      }
      seen.add(c.id);
    }
  });
});
