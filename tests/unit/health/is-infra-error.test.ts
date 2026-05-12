import { assertEquals } from "@std/assert";
import { isInfraError } from "../../../src/health/is-infra-error.ts";
import {
  ContainerError,
  LLMProviderError,
  PwshSessionError,
  QueueTimeoutError,
  ValidationError,
} from "../../../src/errors.ts";

Deno.test("ContainerError is infra", () => {
  assertEquals(isInfraError(new ContainerError("x", "C", "test")), true);
});

Deno.test("PwshSessionError is infra", () => {
  assertEquals(
    isInfraError(new PwshSessionError("x", "session_crashed")),
    true,
  );
});

Deno.test("QueueTimeoutError is infra (container or queue wedge)", () => {
  assertEquals(
    isInfraError(new QueueTimeoutError("x", "compile", 60000)),
    true,
  );
});

Deno.test("LLMProviderError is NOT container-infra (model-scope)", () => {
  assertEquals(isInfraError(new LLMProviderError("x", "openai")), false);
});

Deno.test("ValidationError is NOT infra", () => {
  assertEquals(isInfraError(new ValidationError("x", [])), false);
});

Deno.test("Plain Error with timeout message is infra", () => {
  assertEquals(isInfraError(new Error("Operation timed out")), true);
});

Deno.test("Plain Error with random message is not infra", () => {
  assertEquals(isInfraError(new Error("Bad input")), false);
});

Deno.test("Plain Error with single-word 'timeout' is infra", () => {
  assertEquals(isInfraError(new Error("Read timeout after 30s")), true);
  assertEquals(isInfraError(new Error("kill timeout")), true);
});

Deno.test("Plain Error 'Publish failed' without infra context is NOT infra", () => {
  // After narrowing publish pattern, a bare "publish failed" message
  // (which could be an AL compile error wrapped wrong) should not auto-flag.
  assertEquals(isInfraError(new Error("Publish failed: missing field")), false);
});

Deno.test("Plain Error with Publish-BcContainerApp + timed out IS infra", () => {
  assertEquals(
    isInfraError(
      new Error("Publish-BcContainerApp : The operation has timed out."),
    ),
    true,
  );
});
