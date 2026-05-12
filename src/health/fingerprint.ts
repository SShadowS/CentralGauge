import type { InfraFingerprint } from "./types.ts";

interface FingerprintInput {
  operation: string; // "compile" | "publish" | "test" | "setup"...
  rawOutput?: string;
  errorMessage?: string; // optional, used when rawOutput is empty
}

/**
 * Normalize an infra error into a stable identifier.
 *
 * Strategy: extract structural "key lines" (first non-noise error-ish line,
 * cmdlet name if obvious), strip variable parts (timestamps, GUIDs, paths
 * with container-specific segments), then hash the combination with the
 * operation.
 */
export function fingerprintInfraError(
  input: FingerprintInput,
): InfraFingerprint {
  const op = input.operation;
  const text = (input.rawOutput || input.errorMessage || "").trim();

  if (!text) return `${op}:empty`;

  const lines = text.split(/\r?\n/);
  const keyLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Pick error-ish lines only
    if (
      /\b(error|exception|failed|timeout|TEST_ERROR|COMPILE_ERROR|out of memory|not running|not recognized)\b/i
        .test(
          line,
        )
    ) {
      keyLines.push(normalize(line));
      if (keyLines.length >= 3) break;
    }
  }

  if (keyLines.length === 0) {
    // Fallback: first non-empty line, normalized
    const firstNonEmpty = lines.find((l) => l.trim());
    keyLines.push(firstNonEmpty ? normalize(firstNonEmpty.trim()) : "noise");
  }

  return `${op}:${djb2(keyLines.join("|"))}`;
}

/**
 * Strip variable parts so the same logical error fingerprints identically.
 */
function normalize(line: string): string {
  return line
    .replace(/\b\d{10,}\b/g, "<TS>") // unix-ms timestamps
    .replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      "<UUID>",
    )
    .replace(/\\Cronus\d+/g, "\\<CONTAINER>") // container-specific paths
    .replace(/\b\d+(\.\d+)?Gb\b/g, "<MEM>Gb") // memory sizes
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h &= 0xffffffff;
  }
  // Unsigned 32-bit hex
  return (h >>> 0).toString(16).padStart(8, "0");
}
