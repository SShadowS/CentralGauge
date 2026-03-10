import { assertEquals } from "@std/assert";
import {
  getRetryDelayMs,
  isAgentRetryableError,
} from "../../../src/agents/retry.ts";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";

Deno.test("isAgentRetryableError", async (t) => {
  await t.step("plain Error with transient message is retryable", () => {
    assertEquals(isAgentRetryableError(new Error("EPIPE")), true);
  });

  await t.step("error with 'rate limit' message is retryable", () => {
    assertEquals(isAgentRetryableError(new Error("rate limit exceeded")), true);
  });

  await t.step("error with 'timeout' message is retryable", () => {
    assertEquals(isAgentRetryableError(new Error("request timeout")), true);
  });

  await t.step("error with 'econnreset' message is retryable", () => {
    assertEquals(
      isAgentRetryableError(new Error("socket hang up ECONNRESET")),
      true,
    );
  });

  await t.step("max_turns SDK result is NOT retryable", () => {
    assertEquals(
      isAgentRetryableError({ subtype: "error_max_turns" }),
      false,
    );
  });

  await t.step("max_budget SDK result is NOT retryable", () => {
    assertEquals(
      isAgentRetryableError({ subtype: "error_max_budget_usd" }),
      false,
    );
  });

  await t.step("null/undefined is not retryable", () => {
    assertEquals(isAgentRetryableError(null), false);
    assertEquals(isAgentRetryableError(undefined), false);
  });

  await t.step("string error is retryable (process crash output)", () => {
    assertEquals(isAgentRetryableError("connection refused"), true);
  });

  await t.step("ValidationError is NOT retryable", () => {
    const err = new ValidationError("bad config", ["error"], []);
    assertEquals(isAgentRetryableError(err), false);
  });

  await t.step("ConfigurationError is NOT retryable", () => {
    const err = new ConfigurationError("invalid path", "config.yml");
    assertEquals(isAgentRetryableError(err), false);
  });

  await t.step(
    "generic Error without transient keywords is retryable (crash)",
    () => {
      assertEquals(isAgentRetryableError(new Error("unexpected EOF")), true);
    },
  );

  await t.step("TypeError is NOT retryable (deterministic bug)", () => {
    assertEquals(
      isAgentRetryableError(new TypeError("Cannot read properties")),
      false,
    );
  });

  await t.step("RangeError is NOT retryable (deterministic bug)", () => {
    assertEquals(
      isAgentRetryableError(new RangeError("Maximum call stack")),
      false,
    );
  });
});

Deno.test("getRetryDelayMs", async (t) => {
  await t.step("scales linearly with attempt number", () => {
    assertEquals(getRetryDelayMs(1, 5000), 5000);
    assertEquals(getRetryDelayMs(2, 5000), 10000);
    assertEquals(getRetryDelayMs(3, 5000), 15000);
  });

  await t.step("uses default base delay of 5000ms", () => {
    assertEquals(getRetryDelayMs(1), 5000);
  });
});
