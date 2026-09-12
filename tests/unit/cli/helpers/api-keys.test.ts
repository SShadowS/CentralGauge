// tests/unit/cli/helpers/api-keys.test.ts
//
// `getApiKeyForProvider` moved out of `models-command.ts` so `bench` can read
// a provider key without importing a command module. These pin the behaviour
// the move had to preserve: the env-var map, and `undefined` for a provider
// that has no key.
import { assertEquals } from "@std/assert";
import { getApiKeyForProvider } from "../../../../cli/helpers/api-keys.ts";
import { MockEnv } from "../../../utils/test-helpers.ts";

Deno.test("getApiKeyForProvider reads each provider's own environment variable", () => {
  const env = new MockEnv();
  try {
    env.set("OPENAI_API_KEY", "k-openai");
    env.set("ANTHROPIC_API_KEY", "k-anthropic");
    env.set("GOOGLE_API_KEY", "k-gemini");
    env.set("AZURE_OPENAI_API_KEY", "k-azure");
    env.set("OPENROUTER_API_KEY", "k-openrouter");

    assertEquals(getApiKeyForProvider("openai"), "k-openai");
    assertEquals(getApiKeyForProvider("anthropic"), "k-anthropic");
    assertEquals(getApiKeyForProvider("gemini"), "k-gemini");
    assertEquals(getApiKeyForProvider("azure-openai"), "k-azure");
    assertEquals(getApiKeyForProvider("openrouter"), "k-openrouter");
  } finally {
    env.restore();
  }
});

Deno.test("getApiKeyForProvider returns undefined for an unmapped provider and an unset variable", () => {
  const env = new MockEnv();
  try {
    env.delete("OPENROUTER_API_KEY");
    assertEquals(getApiKeyForProvider("openrouter"), undefined);
    assertEquals(getApiKeyForProvider("local"), undefined);
    assertEquals(getApiKeyForProvider("mock"), undefined);
    assertEquals(getApiKeyForProvider("nope"), undefined);
  } finally {
    env.restore();
  }
});
