import { ApiError } from "./errors";

/**
 * Validate the R2 key path-component for the lifecycle blob endpoints
 * against C2's threat model:
 *  - must start with `lifecycle/`
 *  - charset restricted to [A-Za-z0-9._/-]
 *  - length 1..1024
 *  - no `..` or `.` segments (parent-directory traversal)
 *  - no empty path segments (`//`)
 *  - no control chars / null bytes / unicode (covered by charset)
 *
 * Lives in `$lib/server/` (not the route file) because SvelteKit reserves
 * route files for handler exports only. Unit-tested directly — HTTP-layer
 * URL normalization (in fetch / SvelteKit / SELF) collapses traversal
 * patterns before they reach the route, so the most rigorous coverage is
 * driving this function with pathological input directly.
 *
 * Throws `ApiError(400, 'invalid_key', '<concrete reason>')`.
 */
export function validateR2Key(key: string | undefined): string {
  if (!key || key.length === 0) {
    throw new ApiError(400, "invalid_key", "r2 key required");
  }
  if (key.length > 1024) {
    throw new ApiError(
      400,
      "invalid_key",
      `key exceeds 1024 chars (got ${key.length})`,
    );
  }
  if (!key.startsWith("lifecycle/")) {
    throw new ApiError(400, "invalid_key", 'key must start with "lifecycle/"');
  }
  // Charset: alphanumeric + dot, dash, underscore, slash. NO whitespace, NO
  // unicode, NO control chars. Hard line.
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) {
    throw new ApiError(
      400,
      "invalid_key",
      "key contains characters outside [A-Za-z0-9._/-] (control chars / null / unicode rejected)",
    );
  }
  // Path-traversal: forbid `..` and `.` as a path segment anywhere.
  const segments = key.split("/");
  if (segments.some((s) => s === ".." || s === ".")) {
    throw new ApiError(
      400,
      "invalid_key",
      'key contains "." or ".." segment (path traversal rejected)',
    );
  }
  // Defensive: empty segments mean `//` — should never happen with the
  // charset regex above, but check explicitly.
  if (segments.some((s) => s.length === 0)) {
    throw new ApiError(
      400,
      "invalid_key",
      'key contains empty path segment ("//")',
    );
  }
  return key;
}
