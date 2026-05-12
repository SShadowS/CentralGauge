// tests/unit/health/classify.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { classifyInfraError } from "../../../src/health/classify.ts";
import { ContainerError } from "../../../src/errors.ts";

Deno.test("classify SYSLIB0014 → signature + fingerprint", async () => {
  const raw = await Deno.readTextFile(
    "tests/fixtures/infra-logs/syslib0014.txt",
  );
  const err = new ContainerError("Test failed", "Cronus281", "test", {
    rawOutput: raw,
  });
  const c = classifyInfraError(err);
  assertExists(c.signature);
  assertEquals(c.signature!.id, "syslib0014");
  assertEquals(typeof c.fingerprint, "string");
});

Deno.test("classify unknown infra: signature undefined, fingerprint defined", () => {
  const err = new ContainerError("Weird thing", "Cronus28", "test", {
    rawOutput: "Some entirely novel error: kablooey at line 42",
  });
  const c = classifyInfraError(err);
  assertEquals(c.signature, undefined);
  assertEquals(typeof c.fingerprint, "string");
});

Deno.test("classify plain Error → fingerprint from message", () => {
  const err = new Error("Queue timeout after 60000 ms");
  const c = classifyInfraError(err);
  assertEquals(typeof c.fingerprint, "string");
});
