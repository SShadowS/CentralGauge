/**
 * Provider API keys, resolved from the environment.
 *
 * One env-var map for the whole CLI. It lives beside the other helpers rather
 * than inside a command module so a second command can read a key without
 * importing a command (`bench` needs the OpenRouter key for its upstream
 * precheck), which would otherwise close a cycle through
 * `bench/upstream-precheck.ts`.
 *
 * @module cli/helpers/api-keys
 */

/** Which environment variable holds each provider's key. */
const API_KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GOOGLE_API_KEY",
  "azure-openai": "AZURE_OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Resolve a provider's API key. Returns `undefined` for a provider with no
 * key in this map (`local`, `mock`) and for one whose variable is unset.
 */
export function getApiKeyForProvider(provider: string): string | undefined {
  const envKey = API_KEY_ENV[provider];
  return envKey ? Deno.env.get(envKey) : undefined;
}
