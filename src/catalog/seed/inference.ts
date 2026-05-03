/**
 * Pure inference functions for catalog auto-seed.
 * No I/O — derives catalog fields from slugs, OpenRouter metadata, and
 * LiteLLM pricing data.
 * @module catalog/seed/inference
 */

// ---------------------------------------------------------------------------
// parseSlug
// ---------------------------------------------------------------------------

export interface ParsedSlug {
  provider: string;
  subVendor: string | null;
  model: string;
}

export function parseSlug(slug: string): ParsedSlug {
  if (!slug.includes("/")) {
    throw new Error(`invalid slug (must contain '/'): ${slug}`);
  }
  const parts = slug.split("/");
  const provider = parts[0]!;
  if (provider === "openrouter" && parts.length >= 3) {
    return {
      provider,
      subVendor: parts[1]!,
      model: parts.slice(2).join("/"),
    };
  }
  return {
    provider,
    subVendor: null,
    model: parts.slice(1).join("/"),
  };
}
