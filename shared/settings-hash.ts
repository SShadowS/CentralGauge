import { canonicalJSON } from "./canonical.ts";

export type InvocationMode = "sync" | "batch";
export type FallbackPolicy = "requested" | "unavailable";

/**
 * The extras shape from before the upstream lock (schema 1): nine keys, no
 * schema marker. Kept as a distinct type so a legacy run can be rebuilt
 * with exactly its old key set and hash. See `buildLegacyCanonicalSettings`.
 */
export interface LegacyCanonicalSettingsExtras {
  /**
   * Absent by construction: on a schema-1 record the key's absence IS the
   * schema. Declared optional-and-undefined rather than omitted so that
   * `CanonicalSettingsExtras | LegacyCanonicalSettingsExtras` is a genuinely
   * discriminated union - without it the schema-2 type is a subtype of this
   * one and `isLegacyExtras`'s false branch narrows to `never`.
   */
  settings_extras_schema?: undefined;
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

export interface CanonicalSettingsExtras
  extends Omit<LegacyCanonicalSettingsExtras, "settings_extras_schema"> {
  /** Named distinctly from IngestMeta.schema and invocation_schema. 2 = carries upstream_pin. */
  settings_extras_schema: 2;
  /** OpenRouter upstream slug the run was pinned to, or null (spec 2026-09-11 D4). */
  upstream_pin: string | null;
}

/**
 * True for an extras object written before the upstream lock: it carries no
 * `settings_extras_schema` key at all. Discriminates on that key's presence,
 * never on the pin, because a schema-2 unpinned run has `upstream_pin: null`
 * and must still hash on the schema-2 profile.
 */
export function isLegacyExtras(
  v: unknown,
): v is LegacyCanonicalSettingsExtras {
  return !!v && typeof v === "object" &&
    !("settings_extras_schema" in (v as Record<string, unknown>)) &&
    typeof (v as Record<string, unknown>)["provider_route"] === "string";
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

/**
 * Byte-identical to what schema-1 runs hashed: exactly the nine legacy keys,
 * so a run frozen before the upstream lock reproduces its recorded settings
 * hash. Never feed a legacy record through `buildCanonicalSettings` - that
 * would add the two schema-2 keys and move it onto a new profile.
 */
export function buildLegacyCanonicalSettings(
  base: SettingsBase,
  extras: LegacyCanonicalSettingsExtras,
): CanonicalSettings {
  // Rebuilt key by key rather than spread, so a caller that hands in an
  // object carrying schema-2 keys cannot leak them into the legacy hash.
  const nine: LegacyCanonicalSettingsExtras = {
    invocation_mode: extras.invocation_mode,
    continuation: extras.continuation,
    empty_retry: extras.empty_retry,
    fallback_policy: extras.fallback_policy,
    provider_route: extras.provider_route,
    endpoint: extras.endpoint,
    thinking_budget: extras.thinking_budget,
    prompt_profile_digest: extras.prompt_profile_digest,
    infra_retries_per_attempt: extras.infra_retries_per_attempt,
  };
  return {
    temperature: base.temperature ?? null,
    max_attempts: base.max_attempts ?? null,
    max_tokens: base.max_tokens ?? null,
    prompt_version: base.prompt_version ?? null,
    bc_version: base.bc_version ?? null,
    extra_json: canonicalJSON(nine),
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
