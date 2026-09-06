import { canonicalJSON } from "./canonical.ts";

export type InvocationMode = "sync" | "batch";
export type FallbackPolicy = "requested" | "unavailable";

export interface CanonicalSettingsExtras {
  invocation_mode: InvocationMode;
  continuation: { enabled: boolean; max: number };
  empty_retry: { enabled: boolean; max: number };
  fallback_policy: FallbackPolicy;
  provider_route: string;
  endpoint: string;
  thinking_budget: number | string | null;
  prompt_profile_digest: string;
  infra_retries_per_attempt: number;
}

/** The six keys the server hashes. Unchanged since migration 0001. */
export interface CanonicalSettings {
  temperature: number | null;
  max_attempts: number | null;
  max_tokens: number | null;
  prompt_version: string | null;
  bc_version: string | null;
  extra_json: string | null;
}

export interface SettingsBase {
  temperature?: number | null;
  max_attempts?: number | null;
  max_tokens?: number | null;
  prompt_version?: string | null;
  bc_version?: string | null;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

export function extrasJson(extras: CanonicalSettingsExtras): string {
  return canonicalJSON(extras);
}

export function buildCanonicalSettings(
  base: SettingsBase,
  extras: CanonicalSettingsExtras,
): CanonicalSettings {
  return {
    temperature: base.temperature ?? null,
    max_attempts: base.max_attempts ?? null,
    max_tokens: base.max_tokens ?? null,
    prompt_version: base.prompt_version ?? null,
    bc_version: base.bc_version ?? null,
    extra_json: extrasJson(extras),
  };
}

/** Byte-identical to the server's historical settings hash. */
export function settingsHashOf(
  settings: SettingsBase & { extra_json?: string | null },
): Promise<string> {
  return sha256Hex(canonicalJSON({
    temperature: settings.temperature ?? null,
    max_attempts: settings.max_attempts ?? null,
    max_tokens: settings.max_tokens ?? null,
    prompt_version: settings.prompt_version ?? null,
    bc_version: settings.bc_version ?? null,
    extra_json: settings.extra_json ?? null,
  }));
}

/** sha256 over the resolved prompt overrides, knowledge text and variant system prompt. */
export function promptProfileDigest(input: {
  overrides: Record<string, unknown> | null;
  knowledge: string | null;
  variantSystemPrompt: string | null;
}): Promise<string> {
  return sha256Hex(canonicalJSON({
    overrides: input.overrides,
    knowledge: input.knowledge,
    variant_system_prompt: input.variantSystemPrompt,
  }));
}
