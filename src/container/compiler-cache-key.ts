/**
 * Artifact-URL-keyed compiler cache naming.
 *
 * BCH repopulates a compiler cache only when its `symbols/` folder is absent,
 * so a single unkeyed cache directory serves every artifact URL forever once
 * populated — meaning a BC artifact upgrade would silently compile against the
 * previous version's symbols. Keying the directory by artifact URL makes an
 * upgrade land in a fresh directory that BCH populates normally.
 *
 * This lives in TypeScript (not the PowerShell script that calls
 * New-BcCompilerFolder) because the artifact URL is resolved host-side via
 * `docker inspect`. Keep it that way: two implementations of the same hash
 * that must agree and cannot be compared is worse than one that is tested.
 */

/**
 * Strip the query string. Some artifact URLs carry a SAS token; hashing it
 * would produce a different key on every run and defeat the cache entirely.
 * BCH normalizes the same way (`New-BcCompilerFolder.ps1:46` uses
 * `$artifactUrl.Split('?')[0]`).
 */
export function normalizeArtifactUrl(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/** 12 lowercase hex chars of SHA-256 over the normalized artifact URL. */
export async function compilerCacheKey(artifactUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeArtifactUrl(artifactUrl));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}
