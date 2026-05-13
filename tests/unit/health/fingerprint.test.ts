import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { fingerprintInfraError } from "../../../src/health/fingerprint.ts";

Deno.test("fingerprint is stable across timestamps/GUIDs in same kind of error", async () => {
  const a = await Deno.readTextFile("tests/fixtures/infra-logs/syslib0014.txt");
  const b = a
    .replace("1778515615905", "1999999999999")
    .replace(
      "84b12b40-3d1f-4c0f-96c7-3c090ebd2733",
      "00000000-0000-0000-0000-000000000000",
    );
  const fpA = fingerprintInfraError({ operation: "test", rawOutput: a });
  const fpB = fingerprintInfraError({ operation: "test", rawOutput: b });
  assertEquals(fpA, fpB, "Same error class must produce same fingerprint");
});

Deno.test("different operations on same output → different fingerprints", async () => {
  const a = await Deno.readTextFile("tests/fixtures/infra-logs/syslib0014.txt");
  const fpTest = fingerprintInfraError({ operation: "test", rawOutput: a });
  const fpCompile = fingerprintInfraError({
    operation: "compile",
    rawOutput: a,
  });
  assertNotEquals(fpTest, fpCompile);
});

Deno.test("oom and syslib produce different fingerprints", async () => {
  const oom = await Deno.readTextFile(
    "tests/fixtures/infra-logs/container-oom.txt",
  );
  const sys = await Deno.readTextFile(
    "tests/fixtures/infra-logs/syslib0014.txt",
  );
  const fp1 = fingerprintInfraError({ operation: "test", rawOutput: oom });
  const fp2 = fingerprintInfraError({ operation: "test", rawOutput: sys });
  assertNotEquals(fp1, fp2);
});

Deno.test("empty output yields stable 'unknown' fingerprint", () => {
  const fp = fingerprintInfraError({ operation: "test", rawOutput: "" });
  assert(fp.startsWith("test:"));
});
