import { assertEquals } from "@std/assert";
import { endpointFor, providerRouteFor } from "../../../src/llm/endpoint.ts";

Deno.test("endpointFor follows the adapters' transport choice", () => {
  assertEquals(endpointFor("anthropic", "claude-opus-5"), "/v1/messages");
  assertEquals(endpointFor("openai", "gpt-6-astra"), "/v1/chat/completions");
  assertEquals(endpointFor("openai", "gpt-5.5-codex"), "/v1/responses");
  assertEquals(
    endpointFor("openrouter", "google/gemini-3.8-flash"),
    "/v1/chat/completions",
  );
  assertEquals(
    endpointFor("gemini", "gemini-3.8-flash"),
    "/v1beta/models:generateContent",
  );
  assertEquals(endpointFor("mock", "mock-gpt-4"), "unknown");
});

Deno.test("providerRouteFor names the OpenRouter target model", () => {
  assertEquals(providerRouteFor("anthropic", "claude-opus-5"), "anthropic");
  assertEquals(
    providerRouteFor("openrouter", "google/gemini-3.8-flash"),
    "openrouter:google/gemini-3.8-flash",
  );
});
