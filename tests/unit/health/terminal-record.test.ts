// tests/unit/health/terminal-record.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { ContainerError } from "../../../src/errors.ts";
import { synthesizeInfraFailureResult } from "../../../src/health/terminal-record.ts";

Deno.test("synthesized result has correct shape", () => {
  const err = new ContainerError("Boom", "Cronus281", "test", {
    rawOutput: "TEST_ERROR: SYSLIB0014",
    rawOutputArtifactPath: "/h/Temp3/test-output/foo.log",
    exitCode: 1,
  });
  const ctx = {
    taskId: "CG-AL-H024",
    llmProvider: "anthropic",
    llmModel: "claude-opus-4-6",
    variantId: "anthropic/claude-opus-4-6",
    temperature: 0.0,
    maxTokens: 4096,
    containerProvider: "bccontainer",
    containerName: "Cronus281",
    templateDir: "templates/",
    outputDir: "results/",
    promptVersion: "1.0",
  };
  const startTime = new Date();
  const r = synthesizeInfraFailureResult({
    manifestId: "CG-AL-H024",
    context: ctx,
    error: err,
    // Omit signature key entirely — exactOptionalPropertyTypes disallows
    // assigning `undefined` to an optional field; omitting is the clean form.
    classification: { fingerprint: "test:abc" },
    startTime,
  });
  assertEquals(r.taskId, "CG-AL-H024");
  assertEquals(r.success, false);
  assertEquals(r.finalScore, 0);
  assertEquals(r.attempts.length, 1);
  // Array element access returns T | undefined with noUncheckedIndexedAccess;
  // assertExists narrows and documents the intent.
  const a = r.attempts[0];
  assertExists(a);
  assertEquals(a.success, false);
  const firstReason = a.failureReasons[0];
  assertExists(firstReason);
  assertEquals(firstReason.toLowerCase().includes("infra"), true);
  assertExists(r.executionId);
});

Deno.test("synthesized infra attempt stamps containerName from ContainerError", () => {
  const result = synthesizeInfraFailureResult({
    manifestId: "T1",
    context: { variantId: "v", containerName: "Cronus28" },
    error: new ContainerError(
      "publish exploded",
      "Cronus284",
      "publish",
    ),
    classification: { fingerprint: "test:xyz" },
    startTime: new Date(0),
  });
  assertEquals(result.attempts[0]?.containerName, "Cronus284");
});

Deno.test("synthesized infra attempt has undefined containerName for generic error", () => {
  const result = synthesizeInfraFailureResult({
    manifestId: "T1",
    context: { variantId: "v" },
    error: new Error("misc"),
    classification: { fingerprint: "test:xyz" },
    startTime: new Date(0),
  });
  assertEquals(result.attempts[0]?.containerName, undefined);
});

Deno.test("executionId is unique across calls", () => {
  const err = new ContainerError("X", "C", "test");
  const ctx = {
    taskId: "t",
    llmProvider: "p",
    llmModel: "m",
    variantId: "p/m",
    temperature: 0,
    maxTokens: 1,
    containerProvider: "x",
    containerName: "C",
    templateDir: "",
    outputDir: "",
    promptVersion: "1",
  };
  const a = synthesizeInfraFailureResult({
    manifestId: "t",
    context: ctx,
    error: err,
    classification: { fingerprint: "x" },
    startTime: new Date(),
  });
  const b = synthesizeInfraFailureResult({
    manifestId: "t",
    context: ctx,
    error: err,
    classification: { fingerprint: "x" },
    startTime: new Date(),
  });
  assertEquals(a.executionId === b.executionId, false);
});
