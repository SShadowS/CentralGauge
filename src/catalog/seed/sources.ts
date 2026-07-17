/**
 * I/O fetchers for catalog seeding metadata.
 * @module catalog/seed/sources
 */

import type { OpenRouterMeta } from "./types.ts";
import { CatalogSeedError } from "../../errors.ts";
import { inferReleasedAt } from "./inference.ts";

interface OpenRouterModelEntry {
  id: string;
  name: string;
  created?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  context_length?: number;
  top_provider?: { max_completion_tokens?: number };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
}

/**
 * Derive catalog capability flag names from an OpenRouter entry's
 * `supported_parameters` + `architecture.input_modalities`. Returns undefined
 * when the entry exposes neither (so the field stays absent rather than empty).
 */
function deriveOpenRouterCapabilities(
  entry: OpenRouterModelEntry,
): string[] | undefined {
  const params = entry.supported_parameters ?? [];
  const modalities = entry.architecture?.input_modalities ?? [];
  if (params.length === 0 && modalities.length === 0) return undefined;

  const flags: string[] = [];
  if (params.includes("reasoning") || params.includes("include_reasoning")) {
    flags.push("thinking");
  }
  if (modalities.includes("image")) flags.push("image");
  if (modalities.includes("file")) flags.push("pdf");
  if (
    params.includes("structured_outputs") || params.includes("response_format")
  ) {
    flags.push("structured");
  }
  if (params.includes("tools")) flags.push("tools");
  return flags;
}

interface OpenRouterListResponse {
  data: OpenRouterModelEntry[];
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Module-level cache: keyed by API key to avoid leaking across users.
let cachedList: { apiKey: string; data: OpenRouterModelEntry[] } | null = null;

/** Reset the in-memory cache. Exported for tests. */
export function clearOpenRouterCache(): void {
  cachedList = null;
}

export async function fetchOpenRouterMeta(
  orSlug: string,
): Promise<OpenRouterMeta | null> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new CatalogSeedError(
      "OPENROUTER_API_KEY required to query OpenRouter",
      "SEED_MISSING_KEY",
      { slug: orSlug },
    );
  }

  let entries: OpenRouterModelEntry[];
  if (cachedList && cachedList.apiKey === apiKey) {
    entries = cachedList.data;
  } else {
    let resp: Response;
    try {
      resp = await fetch(OPENROUTER_MODELS_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (e) {
      throw new CatalogSeedError(
        `OpenRouter unreachable: ${e instanceof Error ? e.message : String(e)}`,
        "SEED_NETWORK",
        { slug: orSlug },
      );
    }

    if (resp.status >= 500) {
      throw new CatalogSeedError(
        `OpenRouter returned ${resp.status}; cannot seed ${orSlug}`,
        "SEED_NETWORK",
        { slug: orSlug, status: resp.status },
      );
    }
    if (!resp.ok) {
      return null;
    }

    const body = (await resp.json()) as OpenRouterListResponse;
    entries = body.data;
    cachedList = { apiKey, data: entries };
  }

  const entry = entries.find((m) => m.id === orSlug);
  if (!entry) return null;

  const promptStr = entry.pricing?.prompt;
  const completionStr = entry.pricing?.completion;
  if (!promptStr || !completionStr) return null;

  const promptPerToken = parseFloat(promptStr);
  const completionPerToken = parseFloat(completionStr);
  if (
    !Number.isFinite(promptPerToken) || !Number.isFinite(completionPerToken)
  ) {
    return null;
  }

  // OpenRouter returns price per token; convert to per-1M.
  const inputPerMtoken = promptPerToken * 1_000_000;
  const outputPerMtoken = completionPerToken * 1_000_000;

  // Vendor parsed from "Vendor: Display Name" pattern in `name`.
  const colonIdx = entry.name.indexOf(":");
  const vendor = colonIdx > 0 ? entry.name.slice(0, colonIdx).trim() : "";

  return {
    pricing: { input: inputPerMtoken, output: outputPerMtoken },
    displayName: entry.name,
    vendor,
    releasedAt: inferReleasedAt(entry.created ?? null),
    maxInputTokens: entry.context_length,
    maxOutputTokens: entry.top_provider?.max_completion_tokens,
    capabilities: deriveOpenRouterCapabilities(entry),
    // OpenRouter's explicit free-tier convention: the `:free` slug suffix.
    // This is the ONLY automated source allowed to vouch for $0 pricing.
    marksFree: orSlug.endsWith(":free"),
  };
}
