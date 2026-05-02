import { canonicalJSON } from "$lib/shared/canonical";
import { sha256Hex } from "$lib/shared/hash";
import type { SettingsInput } from "$lib/shared/types";

/**
 * Canonical hash of a settings profile. Used as the primary key in settings_profiles.
 */
export async function settingsHash(settings: SettingsInput): Promise<string> {
  const canonical = canonicalJSON({
    temperature: settings.temperature ?? null,
    max_attempts: settings.max_attempts ?? null,
    max_tokens: settings.max_tokens ?? null,
    prompt_version: settings.prompt_version ?? null,
    bc_version: settings.bc_version ?? null,
    extra_json: settings.extra_json ?? null,
  });
  return await sha256Hex(canonical);
}

/**
 * Collect the set of blob hashes referenced by a payload.
 */
export function payloadBlobHashes(payload: {
  reproduction_bundle_sha256?: string;
  results: Array<{ transcript_sha256?: string; code_sha256?: string }>;
}): string[] {
  const hashes = new Set<string>();
  if (payload.reproduction_bundle_sha256) {
    hashes.add(payload.reproduction_bundle_sha256);
  }
  for (const r of payload.results) {
    if (r.transcript_sha256) hashes.add(r.transcript_sha256);
    if (r.code_sha256) hashes.add(r.code_sha256);
  }
  return Array.from(hashes);
}

/**
 * Given a list of sha256 hashes, return the subset that is NOT already in R2.
 */
export async function findMissingBlobs(
  bucket: R2Bucket,
  hashes: string[],
): Promise<string[]> {
  const heads = await Promise.all(hashes.map((h) => bucket.head(blobKey(h))));
  return hashes.filter((_, i) => heads[i] === null);
}

export function blobKey(sha256: string): string {
  return `blobs/${sha256}`;
}

export function blobHashFromKey(key: string): string {
  return key.replace(/^blobs\//, "");
}
