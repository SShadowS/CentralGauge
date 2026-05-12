import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  CatalogSeedError,
  ContainerError,
  PwshSessionError,
} from "../../src/errors.ts";

describe("CatalogSeedError", () => {
  it("captures slug + reason in context", () => {
    const err = new CatalogSeedError(
      "no pricing source for openrouter/x-ai/grok-4.3",
      "SEED_NO_PRICING",
      { slug: "openrouter/x-ai/grok-4.3" },
    );
    assertEquals(err.code, "SEED_NO_PRICING");
    assertEquals(err.context, { slug: "openrouter/x-ai/grok-4.3" });
    assert(err instanceof Error);
  });

  it("accepts the five documented codes", () => {
    const codes: Array<CatalogSeedError["code"]> = [
      "SEED_NO_PRICING",
      "SEED_NETWORK",
      "SEED_MISSING_KEY",
      "SEED_YAML_WRITE",
      "SEED_INVALID_SLUG",
    ];
    for (const c of codes) {
      const e = new CatalogSeedError("x", c);
      assertEquals(e.code, c);
    }
  });
});

describe("PwshSessionError", () => {
  it("captures container + reason in context", () => {
    const err = new PwshSessionError(
      "session crashed mid-task",
      "session_crashed",
      { container: "Cronus28", lastOutput: "..." },
    );
    assertEquals(err.code, "session_crashed");
    assertEquals(err.context, {
      container: "Cronus28",
      lastOutput: "...",
    });
    assert(err instanceof Error);
    assert(err instanceof PwshSessionError);
    assertEquals(err.name, "PwshSessionError");
  });

  it("accepts the five documented codes", () => {
    const codes: Array<PwshSessionError["code"]> = [
      "session_init_failed",
      "session_crashed",
      "session_timeout",
      "session_recycle_failed",
      "session_state_violation",
    ];
    for (const c of codes) {
      const e = new PwshSessionError("x", c);
      assertEquals(e.code, c);
      assertEquals(e.context, undefined);
    }
  });
});

Deno.test("ContainerError carries rawOutput, exitCode, artifactPath", () => {
  const err = new ContainerError(
    "Test publish failed",
    "Cronus281",
    "test",
    {
      rawOutput: "TEST_ERROR: SYSLIB0014",
      exitCode: 1,
      rawOutputArtifactPath: "/h/Temp3/test-output/test-123.txt",
    },
  );
  assertEquals(err.containerName, "Cronus281");
  assertEquals(err.operation, "test");
  assertEquals(err.rawOutput, "TEST_ERROR: SYSLIB0014");
  assertEquals(err.exitCode, 1);
  assertEquals(err.rawOutputArtifactPath, "/h/Temp3/test-output/test-123.txt");
});

Deno.test("ContainerError rawOutput is optional", () => {
  const err = new ContainerError("X", "Cronus28", "compile");
  assertEquals(err.rawOutput, undefined);
  assertEquals(err.exitCode, undefined);
});
