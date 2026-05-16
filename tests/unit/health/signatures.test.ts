// tests/unit/health/signatures.test.ts
import { assertEquals, assertExists } from "@std/assert";
import {
  INFRA_SIGNATURES,
  matchSignature,
} from "../../../src/health/signatures.ts";

Deno.test("library defines all expected signatures", () => {
  const ids = INFRA_SIGNATURES.map((s) => s.id);
  for (
    const expected of [
      "syslib0014",
      "pssession_lost",
      "container_oom",
      "publish_timeout",
      "container_offline",
      "sql_service_down",
    ]
  ) {
    assertEquals(
      ids.includes(expected),
      true,
      `Missing signature: ${expected}`,
    );
  }
});

Deno.test("matches SYSLIB0014 from real fixture", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/infra-logs/syslib0014.txt",
  );
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "syslib0014");
  assertEquals(sig!.scope, "container");
  assertEquals(sig!.severity, "critical");
});

Deno.test("matches pssession_lost", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/infra-logs/pssession-lost.txt",
  );
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "pssession_lost");
});

Deno.test("matches container_oom", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/infra-logs/container-oom.txt",
  );
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "container_oom");
});

Deno.test("matches publish_timeout", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/infra-logs/publish-timeout.txt",
  );
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "publish_timeout");
});

Deno.test("matches container_offline", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/infra-logs/container-offline.txt",
  );
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "container_offline");
});

Deno.test("matches sql_service_down", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/infra-logs/sql-service-down.txt",
  );
  const sig = matchSignature(text);
  assertExists(sig);
  assertEquals(sig!.id, "sql_service_down");
  assertEquals(sig!.scope, "container");
  assertEquals(sig!.severity, "critical");
});

Deno.test("returns undefined on AL compile error fixture (not infra)", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/infra-logs/al-compile-error.txt",
  );
  assertEquals(matchSignature(text), undefined);
});
