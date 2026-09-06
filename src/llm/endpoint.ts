/**
 * Provider transport routing (spec section 10, D4).
 *
 * The invocation record persists which literal endpoint path and provider
 * route an attempt talked to, so a batch-mode run (which changes both) is
 * distinguishable from a sync run in the settings profile without threading
 * the adapter's own internal state through the capture layer.
 * @module src/llm/endpoint
 */
import { isResponsesOnlyModel } from "./openai-adapter.ts";

/** The provider endpoint path the adapter for `provider` talks to. Enters the settings profile (spec section 10). */
export function endpointFor(provider: string, apiModelId: string): string {
  switch (provider) {
    case "anthropic":
      return "/v1/messages";
    case "openai":
      return isResponsesOnlyModel(apiModelId)
        ? "/v1/responses"
        : "/v1/chat/completions";
    case "openrouter":
      return "/v1/chat/completions";
    case "gemini":
      return "/v1beta/models:generateContent";
    case "azure-openai":
      return "/openai/deployments/chat/completions";
    default:
      return "unknown";
  }
}

/** The provider route an invocation actually used: `"openrouter:<model>"` for OpenRouter, else the bare provider name. */
export function providerRouteFor(provider: string, apiModelId: string): string {
  return provider === "openrouter" ? `openrouter:${apiModelId}` : provider;
}
