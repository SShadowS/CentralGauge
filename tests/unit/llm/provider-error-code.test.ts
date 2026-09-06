import { assertEquals } from "@std/assert";
import { providerErrorCode } from "../../../src/llm/provider-error-code.ts";

Deno.test("providerErrorCode reads SDK-style status and error type", () => {
  const sdkError = Object.assign(new Error("Bad Request"), {
    status: 400,
    error: { type: "invalid_request_error", message: "x" },
  });
  assertEquals(providerErrorCode(sdkError), "http_400:invalid_request_error");
  assertEquals(
    providerErrorCode(Object.assign(new Error("x"), { status: 529 })),
    "http_529",
  );
  assertEquals(
    providerErrorCode(
      Object.assign(new Error("x"), { error: { code: "rate_limit_exceeded" } }),
    ),
    "rate_limit_exceeded",
  );
});

Deno.test("providerErrorCode walks the cause chain and returns undefined when nothing is structured", () => {
  const inner = Object.assign(new Error("inner"), { status: 503 });
  const wrapped = new Error("wrapped", { cause: inner });
  assertEquals(providerErrorCode(wrapped), "http_503");
  assertEquals(providerErrorCode(new Error("plain")), undefined);
  assertEquals(providerErrorCode("string"), undefined);
  assertEquals(providerErrorCode(undefined), undefined);
});
