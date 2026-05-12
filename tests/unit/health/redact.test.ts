import { assertEquals } from "@std/assert";
import { redactSensitive } from "../../../src/health/redact.ts";

Deno.test("redactSensitive masks password fields", () => {
  const input = "credential password=secret123 user=admin";
  const out = redactSensitive(input);
  assertEquals(out.includes("secret123"), false);
  assertEquals(out.includes("[REDACTED]"), true);
});

Deno.test("redactSensitive masks bearer tokens", () => {
  const input = "Authorization: Bearer eyJhbGc...XYZ";
  const out = redactSensitive(input);
  assertEquals(out.includes("eyJhbGc"), false);
});

Deno.test("redactSensitive masks BC license tail", () => {
  const input =
    "Importing license file C:\\Path\\BC_LICENSE_KEY_XXXXX.flf successfully";
  const out = redactSensitive(input);
  assertEquals(out.includes("XXXXX.flf"), false);
});

Deno.test("redactSensitive preserves normal log lines", () => {
  const input = "Compilation ended at 17:14:33.206";
  assertEquals(redactSensitive(input), input);
});

Deno.test("redactSensitive masks token= values", () => {
  const input = "config token=abc123def456 and more";
  const out = redactSensitive(input);
  assertEquals(out.includes("abc123def456"), false);
  assertEquals(out.includes("token=[REDACTED]"), true);
});

Deno.test("redactSensitive masks api_key with separator variants", () => {
  const input1 = "api_key=sk-prod-xxx";
  const input2 = "api-key: sk-prod-yyy";
  const input3 = "apikey=sk-prod-zzz";
  const out1 = redactSensitive(input1);
  const out2 = redactSensitive(input2);
  const out3 = redactSensitive(input3);
  assertEquals(out1.includes("sk-prod-xxx"), false);
  assertEquals(out2.includes("sk-prod-yyy"), false);
  assertEquals(out3.includes("sk-prod-zzz"), false);
});

Deno.test("redactSensitive does not swallow URL query after credential", () => {
  const input = "url?password=secret&user=admin&q=hello";
  const out = redactSensitive(input);
  assertEquals(out.includes("secret"), false);
  assertEquals(out.includes("user=admin"), true); // not swallowed
  assertEquals(out.includes("q=hello"), true);
});
