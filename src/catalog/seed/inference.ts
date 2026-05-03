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

// ---------------------------------------------------------------------------
// inferFamilySlug
// ---------------------------------------------------------------------------

export function inferFamilySlug(
  provider: string,
  model: string,
  subVendor?: string | null,
): string {
  switch (provider) {
    case "anthropic":
      if (model.startsWith("claude-")) return "claude";
      break;
    case "openai":
      if (
        model.startsWith("gpt-") ||
        model.startsWith("o1-") ||
        model.startsWith("o3-")
      ) {
        return "gpt";
      }
      break;
    case "google":
      if (model.startsWith("gemini-") || model.startsWith("models/gemini-")) {
        return "gemini";
      }
      break;
    case "openrouter": {
      const tail = model.split("/").pop()!;
      const firstSegment = tail.split("-")[0];
      if (firstSegment) return firstSegment;
      break;
    }
  }
  throw new Error(
    `cannot infer family for ${provider}/${model}` +
      (subVendor ? ` (sub-vendor=${subVendor})` : ""),
  );
}

// ---------------------------------------------------------------------------
// inferDisplayName
// ---------------------------------------------------------------------------

export function inferDisplayName(
  slug: string,
  openRouterName: string | null,
): string {
  if (openRouterName && openRouterName.trim().length > 0) {
    return openRouterName;
  }
  const tail = slug.split("/").pop() ?? slug;
  return tail
    .split("-")
    .map((word) => {
      if (word.length === 0) return word;
      return word[0]!.toUpperCase() + word.slice(1);
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// inferGeneration
// ---------------------------------------------------------------------------

export function inferGeneration(model: string): number | null {
  const match = model.match(/[a-z]+-?(\d+)/i);
  if (!match || !match[1]) return null;
  return parseInt(match[1], 10);
}

// ---------------------------------------------------------------------------
// inferReleasedAt
// ---------------------------------------------------------------------------

export function inferReleasedAt(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  if (!Number.isFinite(epochSeconds)) return null;
  const ms = epochSeconds * 1000;
  const date = new Date(ms);
  return date.toISOString().slice(0, 10);
}
